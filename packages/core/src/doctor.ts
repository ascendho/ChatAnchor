import { CodexAppServerClient, readCodexVersion } from "./codex.js";
import { errorMessage } from "./errors.js";
import { readGitVersion } from "./git.js";
import { RegistryStore } from "./registry.js";
import { ThreadRelinkService } from "./service.js";
import type {
  DoctorCheck,
  DoctorReport,
  HistoryAdapterFactory,
} from "./types.js";

export interface DoctorOptions {
  cwd?: string;
  codexPath?: string;
  registryHome?: string;
  legacyRegistryHome?: string;
  historyAdapterFactory?: HistoryAdapterFactory;
}

export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "Node.js",
    status: nodeMajor >= 22 ? "pass" : "fail",
    message: `Node.js ${process.versions.node}; ThreadRelink requires Node.js 22 or newer.`,
  });

  const gitVersion = await readGitVersion();
  checks.push({
    name: "Git",
    status: gitVersion ? "pass" : "warn",
    message: gitVersion ?? "Git is unavailable; only manual directory linking will work.",
  });

  try {
    const version = await readCodexVersion(options.codexPath);
    checks.push({
      name: "Codex CLI",
      status: "pass",
      message: version,
    });
  } catch (error) {
    checks.push({
      name: "Codex CLI",
      status: "fail",
      message: errorMessage(error),
    });
  }

  const factory =
    options.historyAdapterFactory
    ?? (() => CodexAppServerClient.start({ codexPath: options.codexPath }));
  try {
    const adapter = await factory();
    try {
      const threads = await adapter.listThreads({ includeArchived: false });
      checks.push({
        name: "Codex app-server",
        status: "pass",
        message: `Connected successfully; ${threads.length} active conversations visible.`,
      });
    } finally {
      await adapter.close();
    }
  } catch (error) {
    checks.push({
      name: "Codex app-server",
      status: "fail",
      message: errorMessage(error),
    });
  }

  try {
    const probe = await new ThreadRelinkService({
      registryHome: options.registryHome,
      legacyRegistryHome: options.legacyRegistryHome,
      codexPath: options.codexPath,
      historyAdapterFactory: options.historyAdapterFactory,
    }).probeProject(options.cwd ?? process.cwd());
    checks.push({
      name: "Current project",
      status: probe.state === "ready" ? "pass" : "warn",
      message: probe.state === "ready"
        ? `${probe.project?.name ?? probe.workspacePath} (${probe.project?.kind ?? "project"}, ready)`
        : probe.state === "parent-choice-required"
          ? `${probe.workspacePath} is inside ${probe.gitRoot}; project setup requires an explicit boundary choice.`
          : `${probe.workspacePath} is not set up for ThreadRelink.`,
    });
  } catch (error) {
    checks.push({
      name: "Current project",
      status: "fail",
      message: errorMessage(error),
    });
  }

  try {
    const store = new RegistryStore(
      options.registryHome,
      options.legacyRegistryHome,
    );
    const registry = await store.read();
    checks.push({
      name: "Registry",
      status: "pass",
      message: `${store.registryPath}; ${registry.projects.length} projects and ${registry.threads.length} cached conversations.`,
    });
  } catch (error) {
    checks.push({
      name: "Registry",
      status: "fail",
      message: errorMessage(error),
    });
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}
