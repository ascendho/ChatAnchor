import { access } from "node:fs/promises";
import { join } from "node:path";
import { CodexAppServerClient, readCodexVersion } from "./codex.js";
import { listCursorThreads, resolveCursorHome } from "./cursor.js";
import { errorMessage } from "./errors.js";
import { readGitVersion } from "./git.js";
import {
  listOpenCodeThreads,
  readOpenCodeVersion,
  resolveOpenCodeHome,
} from "./opencode.js";
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
  cursorHome?: string;
  openCodePath?: string;
  openCodeHome?: string;
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
    message: `Node.js ${process.versions.node}; ChatAnchor requires Node.js 22 or newer.`,
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

  const cursorHome = resolveCursorHome(options.cursorHome);
  try {
    await access(join(cursorHome, "chats"));
    const sample = await listCursorThreads({
      projectPaths: [options.cwd ?? process.cwd()],
      cursorHome,
    });
    checks.push({
      name: "Cursor Agent CLI home",
      status: "pass",
      message:
        `${cursorHome}; ${sample.length} conversation(s) visible for the current project path.`,
    });
  } catch (error) {
    checks.push({
      name: "Cursor Agent CLI home",
      status: "warn",
      message:
        `${cursorHome} is not readable yet (${errorMessage(error)}). Cursor listing will be empty until Agent CLI chats exist.`,
    });
  }

  try {
    const version = await readOpenCodeVersion(options.openCodePath);
    checks.push({
      name: "OpenCode CLI",
      status: "pass",
      message: version,
    });
  } catch (error) {
    checks.push({
      name: "OpenCode CLI",
      status: "fail",
      message: errorMessage(error),
    });
  }

  const openCodeHome = resolveOpenCodeHome(options.openCodeHome);
  try {
    await access(join(openCodeHome, "opencode.db"));
    const openCodeThreads = await listOpenCodeThreads({
      openCodeHome,
    });
    checks.push({
      name: "OpenCode data",
      status: "pass",
      message:
        `${openCodeHome}; ${openCodeThreads.length} conversation(s) in the local database.`,
    });
  } catch (error) {
    checks.push({
      name: "OpenCode data",
      status: "warn",
      message:
        `${openCodeHome} is not readable yet (${errorMessage(error)}). OpenCode listing will be empty until OpenCode sessions exist.`,
    });
  }

  try {
    const probe = await new ThreadRelinkService({
      registryHome: options.registryHome,
      legacyRegistryHome: options.legacyRegistryHome,
      codexPath: options.codexPath,
      cursorHome: options.cursorHome,
      openCodePath: options.openCodePath,
      openCodeHome: options.openCodeHome,
      historyAdapterFactory: options.historyAdapterFactory,
    }).probeProject(options.cwd ?? process.cwd());
    checks.push({
      name: "Current project",
      status: probe.state === "ready" ? "pass" : "warn",
      message: probe.state === "ready"
        ? `${probe.project?.name ?? probe.workspacePath} (${probe.project?.kind ?? "project"}, ready)`
        : probe.state === "parent-choice-required"
          ? `${probe.workspacePath} is inside ${probe.gitRoot}; project setup requires an explicit boundary choice.`
          : `${probe.workspacePath} is not set up for ChatAnchor.`,
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
