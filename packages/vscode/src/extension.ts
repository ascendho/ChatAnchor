import * as vscode from "vscode";
import {
  ThreadRelinkService,
  errorMessage,
  runDoctor,
  type MatchDecision,
  type ProjectProbe,
  type SetupMode,
} from "@threadrelink/core";
import {
  ThreadRelinkTreeProvider,
  type ThreadRelinkTreeNode,
} from "./tree.js";
import {
  confidenceLabel,
  conversationLabel,
  formatRelocationReport,
  relativeDate,
  type WorkspaceResult,
} from "./view-model.js";
import {
  ONBOARDING_SHOWN_KEY,
  walkthroughTarget,
} from "./onboarding.js";

const CONSENT_KEY = "threadrelink.metadataConsent.v1";
const REPAIR_WARNING_PREFIX = "threadrelink.repairWarning.v1";

interface Settings {
  codexPath: string;
  registryHome: string | undefined;
  legacyRegistryHome: string | undefined;
  autoSync: boolean;
}

interface RecoveryPick extends vscode.QuickPickItem {
  recoveryKind: "decision" | "ignored" | "search";
  decision?: MatchDecision;
}

function explicitSetting<T>(
  config: vscode.WorkspaceConfiguration,
  key: string,
): T | undefined {
  const inspected = config.inspect<T>(key);
  return inspected?.workspaceFolderLanguageValue
    ?? inspected?.workspaceFolderValue
    ?? inspected?.workspaceLanguageValue
    ?? inspected?.workspaceValue
    ?? inspected?.globalLanguageValue
    ?? inspected?.globalValue;
}

function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration("threadrelink");
  const legacy = vscode.workspace.getConfiguration("reporecall");
  const registryHome = (
    explicitSetting<string>(config, "registryHome") ?? ""
  ).trim();
  const legacyRegistryHome = (
    explicitSetting<string>(legacy, "registryHome") ?? ""
  ).trim();
  const codexPath = (
    explicitSetting<string>(config, "codexPath")
    ?? explicitSetting<string>(legacy, "codexPath")
    ?? "codex"
  ).trim();
  return {
    codexPath: codexPath || "codex",
    registryHome: registryHome || undefined,
    legacyRegistryHome: legacyRegistryHome || undefined,
    autoSync:
      explicitSetting<boolean>(config, "autoSync")
      ?? explicitSetting<boolean>(legacy, "autoSync")
      ?? true,
  };
}

function makeService(): ThreadRelinkService {
  const settings = readSettings();
  return new ThreadRelinkService({
    codexPath: settings.codexPath,
    registryHome: settings.registryHome,
    legacyRegistryHome: settings.legacyRegistryHome,
  });
}

async function chooseWorkspaceFolder(
  placeHolder: string,
  requestedPath?: string,
): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(
      "ThreadRelink needs an open workspace folder.",
    );
    return undefined;
  }
  if (requestedPath) {
    const requested = folders.find(
      (folder) => folder.uri.fsPath === requestedPath,
    );
    if (requested) {
      return requested;
    }
  }
  if (folders.length === 1) {
    return folders[0];
  }
  const selected = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder },
  );
  return selected?.folder;
}

async function chooseThread(
  nodes: ThreadRelinkTreeNode[],
  placeHolder: string,
): Promise<ThreadRelinkTreeNode | undefined> {
  if (nodes.length === 0) {
    void vscode.window.showInformationMessage("No project conversations found.");
    return undefined;
  }
  if (nodes.length === 1) {
    return nodes[0];
  }
  const selected = await vscode.window.showQuickPick(
    nodes.flatMap((node) =>
      node.kind === "thread"
        ? [{
            label: conversationLabel(node.decision),
            description: node.workspace.name,
            detail: node.decision.thread.cwd,
            node,
          }]
        : []
    ),
    { placeHolder, matchOnDescription: true, matchOnDetail: true },
  );
  return selected?.node;
}

function recoveryItem(decision: MatchDecision): RecoveryPick {
  return {
    recoveryKind: "decision",
    decision,
    label: conversationLabel(decision),
    description: decision.status === "suggested"
      ? confidenceLabel(decision)
      : relativeDate(decision.thread.updatedAt),
    detail: `Recorded cwd: ${decision.thread.cwd}`,
  };
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const provider = new ThreadRelinkTreeProvider();
  const output = vscode.window.createOutputChannel("ThreadRelink");
  const view = vscode.window.createTreeView("threadrelink.conversations", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(provider, output, view);

  const hasConsent = (): boolean =>
    context.globalState.get<boolean>(CONSENT_KEY, false);

  const updateContexts = async (
    workspaces = provider.getWorkspaces(),
  ): Promise<void> => {
    await Promise.all([
      vscode.commands.executeCommand(
        "setContext",
        "threadrelink.enabled",
        hasConsent(),
      ),
      vscode.commands.executeCommand(
        "setContext",
        "threadrelink.hasReadyProject",
        workspaces.some((workspace) => workspace.probe?.state === "ready"),
      ),
      vscode.commands.executeCommand(
        "setContext",
        "threadrelink.hasUninitializedProject",
        workspaces.some((workspace) =>
          workspace.probe && workspace.probe.state !== "ready"
        ),
      ),
    ]);
  };

  const openGettingStarted = async (): Promise<void> => {
    await vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      walkthroughTarget(context.extension.id),
      false,
    );
  };

  const ensureConsent = async (): Promise<boolean> => {
    if (hasConsent()) {
      return true;
    }
    const choice = await vscode.window.showInformationMessage(
      "ThreadRelink reads local Codex conversation metadata (thread ID, title, cwd, timestamps, and Git info). It does not copy message bodies or upload data.",
      { modal: true },
      "Enable ThreadRelink",
    );
    if (choice !== "Enable ThreadRelink") {
      return false;
    }
    await context.globalState.update(CONSENT_KEY, true);
    await updateContexts();
    return true;
  };

  const probeWorkspaces = async (): Promise<WorkspaceResult[]> => {
    const service = makeService();
    const results: WorkspaceResult[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        results.push({
          name: folder.name,
          path: folder.uri.fsPath,
          probe: await service.probeProject(folder.uri.fsPath),
          sync: null,
          error: null,
        });
      } catch (error) {
        results.push({
          name: folder.name,
          path: folder.uri.fsPath,
          probe: null,
          sync: null,
          error: errorMessage(error),
        });
      }
    }
    return results;
  };

  const refresh = async (askForConsent = true): Promise<void> => {
    if (!vscode.workspace.isTrusted) {
      provider.setWorkspaces([]);
      void vscode.window.showWarningMessage(
        "Trust this workspace before ThreadRelink can start Codex.",
      );
      return;
    }

    const results = await probeWorkspaces();
    provider.setWorkspaces(results);
    await updateContexts(results);
    const ready = results.filter(
      (workspace) => workspace.probe?.state === "ready",
    );
    if (ready.length === 0) {
      return;
    }
    if (!hasConsent()) {
      if (!askForConsent || !(await ensureConsent())) {
        return;
      }
    }

    const service = makeService();
    for (const workspace of ready) {
      try {
        workspace.sync = await service.sync(workspace.path);
        workspace.probe = await service.probeProject(workspace.path);
        const report = workspace.sync.relocationReport;
        if (report) {
          output.appendLine("");
          output.appendLine(formatRelocationReport(report));
          void vscode.window.showInformationMessage(
            `ThreadRelink detected a new location for ${report.projectName} and reconnected ${report.linkedThreads} conversation${report.linkedThreads === 1 ? "" : "s"}.`,
            "View Report",
          ).then((choice) => {
            if (choice === "View Report") {
              output.show(true);
            }
          });
        }
      } catch (error) {
        workspace.error = errorMessage(error);
        output.appendLine(`${workspace.name}: ${errorMessage(error)}`);
      }
    }
    provider.setWorkspaces(results);
    await updateContexts(results);
  };

  const setupWorkspace = async (requestedPath?: string): Promise<void> => {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "Trust this workspace before setting up ThreadRelink.",
      );
      return;
    }
    const folder = await chooseWorkspaceFolder(
      "Choose a project to set up",
      requestedPath,
    );
    if (!folder || !(await ensureConsent())) {
      return;
    }

    try {
      const service = makeService();
      const probe = await service.probeProject(folder.uri.fsPath);
      let mode: SetupMode | undefined;
      if (probe.state === "parent-choice-required") {
        const selected = await vscode.window.showQuickPick(
          [
            {
              label: "$(folder) Treat this folder as independent",
              description: "Recommended",
              detail: `Create a local identity in ${probe.workspacePath}/.threadrelink`,
              mode: "directory" as const,
            },
            {
              label: "$(repo) Use the parent Git repository",
              description: probe.gitRoot ?? undefined,
              detail: "All conversations belonging to the parent repository may be shown.",
              mode: "parent-git" as const,
            },
          ],
          {
            placeHolder:
              "This folder is inside another Git repository. Choose its project boundary.",
            ignoreFocusOut: true,
          },
        );
        if (!selected) {
          return;
        }
        mode = selected.mode;
      } else if (probe.gitRoot === probe.workspacePath) {
        mode = "git-root";
      } else {
        mode = "directory";
      }

      const project = await service.setupProject(folder.uri.fsPath, mode);
      void vscode.window.showInformationMessage(
        `ThreadRelink set up ${project.name}. Project ID: ${project.id}`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ThreadRelink: ${errorMessage(error)}`);
    }
  };

  const confirmRecoveryLink = async (
    decision: MatchDecision,
    workspacePath: string,
  ): Promise<void> => {
    const choice = await vscode.window.showWarningMessage(
      `Link “${conversationLabel(decision)}” to this project? This changes only ThreadRelink's local registry.`,
      { modal: true },
      "Link conversation",
    );
    if (choice !== "Link conversation") {
      return;
    }
    await makeService().linkThread(decision.thread.id, workspacePath);
    void vscode.window.showInformationMessage(
      `Linked “${conversationLabel(decision)}” to this project.`,
    );
    await refresh(false);
  };

  const findOldConversations = async (
    requestedPath?: string,
  ): Promise<void> => {
    const folder = await chooseWorkspaceFolder(
      "Choose a project for conversation recovery",
      requestedPath,
    );
    if (!folder || !(await ensureConsent())) {
      return;
    }
    try {
      const service = makeService();
      const probe = await service.probeProject(folder.uri.fsPath);
      if (probe.state !== "ready") {
        void vscode.window.showInformationMessage(
          "Set up this project before searching old conversations.",
        );
        return;
      }
      const result = await service.sync(folder.uri.fsPath);
      const suggested = [...result.suggested].sort((left, right) =>
        (right.evidence[0]?.confidence ?? 0)
        - (left.evidence[0]?.confidence ?? 0)
      );
      const firstStep: RecoveryPick[] = [
        ...suggested.map(recoveryItem),
        ...(result.ignored.length > 0
          ? [{
              recoveryKind: "ignored" as const,
              label: "$(eye) Review ignored conversations…",
              description: `${result.ignored.length} ignored`,
              detail:
                "Review conversations explicitly removed from this project.",
            }]
          : []),
        {
          recoveryKind: "search",
          label: "$(search) Search all local conversations…",
          description: `${suggested.length} suggested match${suggested.length === 1 ? "" : "es"}`,
          detail: "Browse metadata for conversations not linked to this project.",
        },
      ];
      const selected = await vscode.window.showQuickPick(firstStep, {
        placeHolder: suggested.length > 0
          ? "Choose a suggested match or search all local conversations"
          : "No suggested matches. Search all local conversations if needed.",
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      });
      if (!selected) {
        return;
      }
      if (selected.recoveryKind === "decision" && selected.decision) {
        await confirmRecoveryLink(selected.decision, folder.uri.fsPath);
        return;
      }
      if (selected.recoveryKind === "ignored") {
        const ignoredSelected = await vscode.window.showQuickPick(
          result.ignored
            .sort((left, right) =>
              right.thread.updatedAt - left.thread.updatedAt
            )
            .map((decision) => ({
              ...recoveryItem(decision),
              description: relativeDate(decision.thread.updatedAt),
            })),
          {
            placeHolder: "Choose an ignored conversation to link again",
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: true,
          },
        );
        if (ignoredSelected?.decision) {
          await confirmRecoveryLink(
            ignoredSelected.decision,
            folder.uri.fsPath,
          );
        }
        return;
      }

      const allCandidates = [...result.suggested, ...result.unlinked]
        .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt)
        .map(recoveryItem);
      const allSelected = await vscode.window.showQuickPick(allCandidates, {
        placeHolder: "Search titles and recorded project paths",
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      });
      if (allSelected?.decision) {
        await confirmRecoveryLink(allSelected.decision, folder.uri.fsPath);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`ThreadRelink: ${errorMessage(error)}`);
    }
  };

  const forgetProject = async (requestedProjectId?: string): Promise<void> => {
    try {
      const service = makeService();
      const projects = await service.listProjects();
      let projectId = requestedProjectId;
      if (!projectId) {
        const choices = await Promise.all(projects.map(async (project) => {
          const preview = await service.previewForgetProject(project.id);
          return {
            label: project.name,
            description: `${preview.linkedThreads} linked conversation${preview.linkedThreads === 1 ? "" : "s"}`,
            detail: project.aliases.at(-1)?.path,
            projectId: project.id,
          };
        }));
        const selected = await vscode.window.showQuickPick(choices, {
          placeHolder: "Choose a ThreadRelink project to forget",
          matchOnDetail: true,
        });
        projectId = selected?.projectId;
      }
      if (!projectId) {
        return;
      }
      const workspacePaths = (vscode.workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath);
      const preview = await service.previewForgetProject(
        projectId,
        workspacePaths,
      );
      const root = preview.project.aliases.at(-1)?.path ?? preview.project.name;
      const choice = await vscode.window.showWarningMessage(
        `Forget ThreadRelink project “${preview.project.name}” at ${root}? ${preview.linkedThreads} ThreadRelink link(s) and matching local identities will be removed. Codex conversations and transcripts will not be deleted.`,
        { modal: true },
        "Forget project",
      );
      if (choice !== "Forget project") {
        return;
      }
      const result = await service.forgetProject(projectId, workspacePaths);
      void vscode.window.showInformationMessage(
        `Forgot ${preview.project.name}: removed ${result.removedLinks} ThreadRelink link(s). No Codex conversations were deleted.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ThreadRelink: ${errorMessage(error)}`);
    }
  };

  const removeThreadLink = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    if (node?.kind !== "thread") {
      return;
    }
    const projectId =
      node.workspace.sync?.project.id
      ?? node.workspace.probe?.project?.id;
    if (!projectId) {
      return;
    }
    const label = conversationLabel(node.decision);
    const choice = await vscode.window.showWarningMessage(
      `Remove “${label}” from this project and ignore future automatic matches? This changes only ThreadRelink's local registry.`,
      { modal: true },
      "Remove link",
    );
    if (choice !== "Remove link") {
      return;
    }
    try {
      await makeService().ignoreThreadForProject(
        node.decision.thread.id,
        projectId,
      );
      void vscode.window.showInformationMessage(
        `Removed “${label}” from this project. You can restore it from Find Old Conversations.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ThreadRelink: ${errorMessage(error)}`);
    }
  };

  const moveThreadLink = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    if (node?.kind !== "thread") {
      return;
    }
    const currentProjectId =
      node.workspace.sync?.project.id
      ?? node.workspace.probe?.project?.id;
    if (!currentProjectId) {
      return;
    }
    try {
      const service = makeService();
      const projects = (await service.listProjects()).filter(
        (project) => project.id !== currentProjectId,
      );
      if (projects.length === 0) {
        void vscode.window.showInformationMessage(
          "Set up another ThreadRelink project before moving this conversation.",
        );
        return;
      }
      const choices = await Promise.all(projects.map(async (project) => {
        const latestAlias = [...project.aliases].sort((left, right) =>
          Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
        )[0];
        let available = false;
        if (latestAlias) {
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(latestAlias.path));
            available = true;
          } catch {
            available = false;
          }
        }
        return {
          label: project.name,
          description: available ? "available" : "path unavailable",
          detail: latestAlias?.path ?? project.id,
          projectId: project.id,
        };
      }));
      const selected = await vscode.window.showQuickPick(choices, {
        placeHolder: "Choose the project that owns this conversation",
        matchOnDetail: true,
        ignoreFocusOut: true,
      });
      if (!selected) {
        return;
      }
      const label = conversationLabel(node.decision);
      const choice = await vscode.window.showWarningMessage(
        `Move “${label}” to ${selected.label}? The old project will ignore future automatic matches for this conversation.`,
        { modal: true },
        "Move conversation",
      );
      if (choice !== "Move conversation") {
        return;
      }
      await service.linkThreadToProject(
        node.decision.thread.id,
        selected.projectId,
      );
      void vscode.window.showInformationMessage(
        `Moved “${label}” to ${selected.label}.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ThreadRelink: ${errorMessage(error)}`);
    }
  };

  const warnAboutLegacyParent = async (
    workspaces: WorkspaceResult[],
  ): Promise<void> => {
    for (const workspace of workspaces) {
      const probe: ProjectProbe | null = workspace.probe;
      if (
        probe?.state !== "parent-choice-required"
        || !probe.parentProject
      ) {
        continue;
      }
      const warningKey =
        `${REPAIR_WARNING_PREFIX}.${probe.parentProject.id}.${probe.workspacePath}`;
      if (context.globalState.get<boolean>(warningKey, false)) {
        continue;
      }
      await context.globalState.update(warningKey, true);
      const preview = await makeService().previewForgetProject(
        probe.parentProject.id,
        [workspace.path],
      );
      void vscode.window.showWarningMessage(
        `ThreadRelink found a legacy parent project at ${probe.gitRoot} with ${preview.linkedThreads} linked conversation(s). This workspace will not use it unless you explicitly choose the parent repository.`,
        "Review project",
        "Use parent repository",
      ).then(async (choice) => {
        if (choice === "Review project") {
          await forgetProject(probe.parentProject?.id);
        } else if (choice === "Use parent repository") {
          if (!(await ensureConsent())) {
            return;
          }
          await makeService().setupProject(workspace.path, "parent-git");
          await refresh(false);
        }
      });
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "threadrelink.openGettingStarted",
      openGettingStarted,
    ),
    vscode.commands.registerCommand("threadrelink.openView", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.threadrelink",
      );
    }),
    vscode.commands.registerCommand("threadrelink.enable", async () => {
      if (await ensureConsent()) {
        await refresh(false);
      }
    }),
    vscode.commands.registerCommand("threadrelink.refresh", async () => {
      await refresh(true);
    }),
    vscode.commands.registerCommand(
      "threadrelink.initialize",
      async (requestedPath?: string) => {
        await setupWorkspace(requestedPath);
      },
    ),
    vscode.commands.registerCommand(
      "threadrelink.findOldConversations",
      async (requestedPath?: string) => {
        await findOldConversations(requestedPath);
      },
    ),
    vscode.commands.registerCommand(
      "threadrelink.forgetProject",
      async (projectId?: string) => {
        await forgetProject(projectId);
      },
    ),
    vscode.commands.registerCommand(
      "threadrelink.confirmLink",
      async (node?: ThreadRelinkTreeNode) => {
        if (node?.kind === "thread") {
          await confirmRecoveryLink(node.decision, node.workspace.path);
        } else {
          await findOldConversations();
        }
      },
    ),
    vscode.commands.registerCommand(
      "threadrelink.unlink",
      removeThreadLink,
    ),
    vscode.commands.registerCommand(
      "threadrelink.move",
      moveThreadLink,
    ),
    vscode.commands.registerCommand(
      "threadrelink.resume",
      async (node?: ThreadRelinkTreeNode) => {
        const selected = node?.kind === "thread"
          ? node
          : await chooseThread(
              provider.allLinked(),
              "Choose a project conversation to resume",
            );
        if (!selected || selected.kind !== "thread") {
          return;
        }
        try {
          const target = await makeService().resolveResumeTarget(
            selected.decision.thread.id,
            selected.workspace.path,
          );
          if (target.warning) {
            void vscode.window.showWarningMessage(target.warning);
          }
          const terminal = vscode.window.createTerminal({
            name: `ThreadRelink: ${conversationLabel(selected.decision)}`,
            shellPath: readSettings().codexPath,
            shellArgs: [
              "resume",
              "--cd",
              target.path,
              selected.decision.thread.id,
            ],
            cwd: target.path,
            iconPath: new vscode.ThemeIcon("history"),
          });
          terminal.show();
        } catch (error) {
          void vscode.window.showErrorMessage(
            `ThreadRelink: ${errorMessage(error)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "threadrelink.revealLocation",
      async (node?: ThreadRelinkTreeNode) => {
        const selected = node?.kind === "thread"
          ? node
          : await chooseThread(
              provider.allLinked(),
              "Choose a project conversation to reveal",
            );
        if (!selected || selected.kind !== "thread") {
          return;
        }
        try {
          const rolloutPath = await makeService()
            .resolveConversationRolloutPath(selected.decision.thread.id);
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(rolloutPath),
          );
        } catch (error) {
          void vscode.window.showErrorMessage(
            `ThreadRelink: ${errorMessage(error)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand("threadrelink.relink", async () => {
      if (!(await ensureConsent())) {
        return;
      }
      const folder = await chooseWorkspaceFolder("Choose the current project");
      if (!folder) {
        return;
      }
      const oldPath = await vscode.window.showInputBox({
        prompt: "Enter the previous absolute project path",
        placeHolder: "/path/to/ToolSpec",
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim().length === 0 ? "A previous path is required." : undefined,
      });
      if (!oldPath) {
        return;
      }
      try {
        const service = makeService();
        await service.sync(folder.uri.fsPath);
        const result = await service.relink(oldPath, folder.uri.fsPath);
        void vscode.window.showInformationMessage(
          `ThreadRelink linked ${result.linkedThreads} conversation(s) from the old path.`,
        );
        await refresh(false);
      } catch (error) {
        void vscode.window.showErrorMessage(`ThreadRelink: ${errorMessage(error)}`);
      }
    }),
    vscode.commands.registerCommand("threadrelink.doctor", async () => {
      const folder = await chooseWorkspaceFolder("Choose a project to diagnose");
      if (!folder) {
        return;
      }
      const settings = readSettings();
      const report = await runDoctor({
        cwd: folder.uri.fsPath,
        codexPath: settings.codexPath,
        registryHome: settings.registryHome,
        legacyRegistryHome: settings.legacyRegistryHome,
      });
      output.clear();
      for (const check of report.checks) {
        output.appendLine(
          `${check.status.toUpperCase().padEnd(4)} ${check.name}: ${check.message}`,
        );
      }
      output.show(true);
      void vscode.window.showInformationMessage(
        report.ok
          ? "ThreadRelink diagnostics passed."
          : "ThreadRelink found problems. See the ThreadRelink output.",
      );
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await refresh(false);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration("threadrelink.codexPath")
        || event.affectsConfiguration("threadrelink.registryHome")
        || event.affectsConfiguration("reporecall.codexPath")
        || event.affectsConfiguration("reporecall.registryHome")
      ) {
        await refresh(false);
      }
    }),
  );

  const legacyCommands = [
    "openGettingStarted",
    "openView",
    "enable",
    "refresh",
    "initialize",
    "findOldConversations",
    "forgetProject",
    "confirmLink",
    "resume",
    "revealLocation",
    "relink",
    "doctor",
  ];
  context.subscriptions.push(
    ...legacyCommands.map((name) =>
      vscode.commands.registerCommand(
        `reporecall.${name}`,
        (...args: unknown[]) =>
          vscode.commands.executeCommand(`threadrelink.${name}`, ...args),
      )
    ),
  );

  await updateContexts();
  const initialWorkspaces = await probeWorkspaces();
  provider.setWorkspaces(initialWorkspaces);
  await updateContexts(initialWorkspaces);
  void warnAboutLegacyParent(initialWorkspaces);

  if (!context.globalState.get<boolean>(ONBOARDING_SHOWN_KEY, false)) {
    await context.globalState.update(ONBOARDING_SHOWN_KEY, true);
    void vscode.window.showInformationMessage(
      "ThreadRelink is ready. Set up each project explicitly to keep its local Codex conversations discoverable after a rename.",
      "Open Getting Started",
    ).then(async (choice) => {
      if (choice === "Open Getting Started") {
        await openGettingStarted();
      }
    });
  }
  if (hasConsent() && readSettings().autoSync && vscode.workspace.isTrusted) {
    await refresh(false);
  }
}

export function deactivate(): void {
  // Every sync owns and closes its short-lived Codex app-server process.
}
