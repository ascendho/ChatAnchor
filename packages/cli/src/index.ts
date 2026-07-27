#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import {
  ThreadRelinkError,
  ThreadRelinkService,
  errorMessage,
  runDoctor,
  type SetupMode,
} from "@threadrelink/core";
import {
  formatDoctorReport,
  formatSyncResult,
} from "./format.js";

interface GlobalOptions {
  codexPath?: string;
  registryHome?: string;
}

function serviceFor(command: Command): ThreadRelinkService {
  const options = command.optsWithGlobals<GlobalOptions>();
  return new ThreadRelinkService({
    codexPath: options.codexPath,
    registryHome: options.registryHome,
  });
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const program = new Command()
  .name("threadrelink")
  .description(
    "Find and resume local Codex conversations after a project path changes.",
  )
  .version("0.4.0")
  .option(
    "--codex-path <path>",
    "Path to the Codex executable (or set THREADRELINK_CODEX_PATH)",
  )
  .option(
    "--registry-home <path>",
    "ThreadRelink state directory (or set THREADRELINK_HOME)",
  );

program
  .command("init")
  .description("Explicitly set up a project with a stable local ThreadRelink ID")
  .argument("[path]", "Project path", process.cwd())
  .option(
    "--use-parent-repo",
    "Use a parent Git repository when the path is a nested workspace",
  )
  .option(
    "--as-directory",
    "Treat the exact folder as an independent directory project",
  )
  .option("--json", "Print machine-readable JSON")
  .action(async (
    path: string,
    options: {
      asDirectory?: boolean;
      json?: boolean;
      useParentRepo?: boolean;
    },
    command: Command,
  ) => {
    if (options.asDirectory && options.useParentRepo) {
      throw new ThreadRelinkError(
        "INVALID_SETUP_MODE",
        "Choose either --use-parent-repo or --as-directory, not both.",
      );
    }
    const mode: SetupMode | undefined = options.useParentRepo
      ? "parent-git"
      : options.asDirectory
        ? "directory"
        : undefined;
    const project = await serviceFor(command).setupProject(path, mode);
    if (options.json) {
      printJson(project);
      return;
    }
    process.stdout.write(
      [
        `Initialized ${project.name}`,
        `Project ID: ${project.id}`,
        `Identity: ${project.kind === "git" ? "git config --local threadrelink.projectId" : ".threadrelink/project.json"}`,
        `Path: ${project.aliases.at(-1)?.path ?? path}`,
      ].join("\n") + "\n",
    );
  });

program
  .command("forget")
  .description("Forget ThreadRelink project links and identity without deleting Codex conversations")
  .argument("[path]", "Project or nested workspace path", process.cwd())
  .option("--project-id <id>", "Forget a project by ThreadRelink ID")
  .option("--yes", "Skip the interactive confirmation")
  .option("--json", "Print machine-readable JSON")
  .action(async (
    path: string,
    options: { json?: boolean; projectId?: string; yes?: boolean },
    command: Command,
  ) => {
    const service = serviceFor(command);
    let projectId = options.projectId;
    if (!projectId) {
      const probe = await service.probeProject(path);
      projectId = probe.project?.id ?? probe.parentProject?.id;
    }
    if (!projectId) {
      throw new ThreadRelinkError(
        "PROJECT_NOT_FOUND",
        "No ThreadRelink project identity was found for this path.",
      );
    }
    const preview = await service.previewForgetProject(projectId, [path]);
    if (!options.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new ThreadRelinkError(
          "CONFIRMATION_REQUIRED",
          "Run again with --yes after reviewing the project and linked count.",
        );
      }
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await prompt.question(
        `Forget ${preview.project.name} and ${preview.linkedThreads} ThreadRelink link(s)? Codex conversations will be kept. [y/N] `,
      );
      prompt.close();
      if (!/^y(?:es)?$/iu.test(answer.trim())) {
        process.stdout.write("Cancelled.\n");
        return;
      }
    }
    const result = await service.forgetProject(projectId, [path]);
    if (options.json) {
      printJson(result);
      return;
    }
    process.stdout.write(
      `Forgot ${preview.project.name}; removed ${result.removedLinks} ThreadRelink link(s). No Codex conversations were deleted.\n`,
    );
  });

program
  .command("sync")
  .description("Scan Codex metadata and update project conversation links")
  .argument("[path]", "Project path", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(async (path: string, options: { json?: boolean }, command: Command) => {
    const result = await serviceFor(command).sync(path);
    if (options.json) {
      printJson(result);
      return;
    }
    process.stdout.write(`${formatSyncResult(result)}\n`);
  });

program
  .command("list")
  .alias("ls")
  .description("List conversations associated with a project")
  .argument("[path]", "Project path", process.cwd())
  .option("--all", "Also print unlinked conversations")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (
      path: string,
      options: { all?: boolean; json?: boolean },
      command: Command,
    ) => {
      const result = await serviceFor(command).sync(path);
      if (options.json) {
        printJson(
          options.all
            ? result
            : {
                project: result.project,
                linked: result.linked,
                suggested: result.suggested,
                scannedAt: result.scannedAt,
              },
        );
        return;
      }
      process.stdout.write(
        `${formatSyncResult(result, { includeAll: options.all })}\n`,
      );
    },
  );

program
  .command("relink")
  .description("Map an old project path to the current project")
  .requiredOption("--from <old-path>", "Previous project root")
  .option("--to <new-path>", "Current project root", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(
    async (
      options: { from: string; to: string; json?: boolean },
      command: Command,
    ) => {
      const service = serviceFor(command);
      await service.sync(options.to);
      const result = await service.relink(options.from, options.to);
      if (options.json) {
        printJson(result);
        return;
      }
      process.stdout.write(
        `Linked ${result.linkedThreads} conversation(s) from ${result.oldPath} to ${result.newPath}.\n`,
      );
    },
  );

program
  .command("resume")
  .description("Resume a Codex conversation in a new working directory")
  .argument("<thread-id>", "Codex thread UUID")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action(
    async (
      threadId: string,
      options: { cwd: string },
      command: Command,
    ) => {
      const exitCode = await serviceFor(command).resume(threadId, options.cwd);
      process.exitCode = exitCode;
    },
  );

program
  .command("doctor")
  .description("Check Codex, app-server, Git, and ThreadRelink state")
  .option("--cwd <path>", "Project path", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(
    async (
      options: { cwd: string; json?: boolean },
      command: Command,
    ) => {
      const globals = command.optsWithGlobals<GlobalOptions>();
      const report = await runDoctor({
        cwd: options.cwd,
        codexPath: globals.codexPath,
        registryHome: globals.registryHome,
      });
      if (options.json) {
        printJson(report);
      } else {
        process.stdout.write(`${formatDoctorReport(report)}\n`);
      }
      if (!report.ok) {
        process.exitCode = 1;
      }
    },
  );

program.parseAsync().catch((error: unknown) => {
  const prefix = error instanceof ThreadRelinkError
    ? `[${error.code}] `
    : "";
  process.stderr.write(`ThreadRelink: ${prefix}${errorMessage(error)}\n`);
  process.exitCode = 1;
});
