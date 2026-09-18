import * as vscode from "vscode";
import { statfs } from "node:fs/promises";
import {
  buildConversationHandoff,
  buildCodexHandoffArgs,
  buildProjectContextPack,
  buildCodexNewSessionArgs,
  deleteProjectContextPack,
  ThreadRelinkService,
  buildCodexResumeArgs,
  buildCursorNewSessionArgs,
  buildCursorHandoffArgs,
  buildCursorResumeArgs,
  buildOpenCodeNewSessionArgs,
  buildOpenCodeHandoffArgs,
  buildOpenCodeResumeArgs,
  errorMessage,
  exportOpenCodeSessionToTempFile,
  readProjectContextPackManifest,
  resolveProjectContextPackPath,
  resolveExecutablePath,
  runDoctor,
  searchProjectContextPack,
  writeCompactTranscriptFromFile,
  type ContextPackSource,
  type ConversationProvider,
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
  formatConversationLabel,
  formatRelocationReport,
  relativeDate,
  type WorkspaceResult,
} from "./view-model.js";
import {
  ONBOARDING_SHOWN_KEY,
  walkthroughTarget,
} from "./onboarding.js";
import {
  findExistingResumeTerminal,
  isActiveResumeTerminal,
  ResumeTerminalRegistry,
  resumeTerminalEnv,
  resumeTerminalIdentity,
} from "./resume-terminals.js";
import { hiddenConversationCount } from "./conversation-display.js";
import { buildAgentHandoffPrompt } from "./handoff-prompt.js";

const CONSENT_KEY = "threadrelink.metadataConsent.v1";
const COMPACT_TRANSCRIPT_CONSENT_KEY =
  "threadrelink.compactTranscriptConsent.v1";
const CONTEXT_PACK_CONSENT_KEY = "threadrelink.contextPackConsent.v2";
const HANDOFF_CONSENT_KEY = "threadrelink.handoffConsent.v1";
const REPAIR_WARNING_PREFIX = "threadrelink.repairWarning.v1";

interface Settings {
  codexPath: string;
  agentPath: string;
  cursorHome: string | undefined;
  openCodePath: string;
  openCodeHome: string | undefined;
  registryHome: string | undefined;
  legacyRegistryHome: string | undefined;
  autoSync: boolean;
}

interface RecoveryPick extends vscode.QuickPickItem {
  recoveryKind: "decision" | "ignored" | "search";
  decision?: MatchDecision;
}

interface AgentProviderPick extends vscode.QuickPickItem {
  provider: ConversationProvider;
}

const AGENT_PROVIDER_LABEL: Record<ConversationProvider, string> = {
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_024;
  let unit = units[0] as string;
  for (const candidate of units.slice(1)) {
    if (value < 1_024) {
      break;
    }
    value /= 1_024;
    unit = candidate;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

const AGENT_PROVIDER_PICKS: AgentProviderPick[] = [
  {
    provider: "codex",
    label: "Codex",
    description: "codex --cd <project>",
  },
  {
    provider: "cursor",
    label: "Cursor",
    description: "agent --workspace <project>",
  },
  {
    provider: "opencode",
    label: "OpenCode",
    description: "opencode <project>",
  },
];

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
  const agentPath = (
    explicitSetting<string>(config, "agentPath") ?? "agent"
  ).trim();
  const cursorHome = (
    explicitSetting<string>(config, "cursorHome") ?? ""
  ).trim();
  const openCodePath = (
    explicitSetting<string>(config, "opencodePath") ?? "opencode"
  ).trim();
  const openCodeHome = (
    explicitSetting<string>(config, "opencodeHome") ?? ""
  ).trim();
  return {
    codexPath: codexPath || "codex",
    agentPath: agentPath || "agent",
    cursorHome: cursorHome || undefined,
    openCodePath: openCodePath || "opencode",
    openCodeHome: openCodeHome || undefined,
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
    agentPath: settings.agentPath,
    cursorHome: settings.cursorHome,
    openCodePath: settings.openCodePath,
    openCodeHome: settings.openCodeHome,
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
      "ChatAnchor needs an open workspace folder.",
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

function projectIdForThreadNode(
  node: ThreadRelinkTreeNode,
): string | undefined {
  if (node.kind !== "thread") {
    return undefined;
  }
  return node.workspace.sync?.project.id ?? node.workspace.probe?.project?.id;
}

function hiddenCount(workspace: WorkspaceResult): number {
  return hiddenConversationCount(workspace);
}

function normalizedCustomLabelLength(value: string): number {
  return [...value.replace(/\s+/gu, " ").trim()].length;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const provider = new ThreadRelinkTreeProvider(context.extensionUri);
  const output = vscode.window.createOutputChannel("ChatAnchor");
  const resumeTerminals = new ResumeTerminalRegistry<vscode.Terminal>();
  const view = vscode.window.createTreeView("threadrelink.conversations", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(provider, output, view);

  const hasConsent = (): boolean =>
    context.globalState.get<boolean>(CONSENT_KEY, false);

  const hasCompactTranscriptConsent = (): boolean =>
    context.globalState.get<boolean>(COMPACT_TRANSCRIPT_CONSENT_KEY, false);

  const ensureCompactTranscriptConsent = async (): Promise<boolean> => {
    if (hasCompactTranscriptConsent()) {
      return true;
    }
    const action = await vscode.window.showWarningMessage(
      "ChatAnchor will read this conversation's local transcript and write a compact Markdown copy in your system temporary directory. Nothing is uploaded.",
      { modal: true },
      "Generate Compact Transcript",
    );
    if (action !== "Generate Compact Transcript") {
      return false;
    }
    await context.globalState.update(COMPACT_TRANSCRIPT_CONSENT_KEY, true);
    return true;
  };

  const ensureContextPackConsent = async (): Promise<boolean> => {
    if (context.globalState.get<boolean>(CONTEXT_PACK_CONSENT_KEY, false)) {
      return true;
    }
    const action = await vscode.window.showWarningMessage(
      "ChatAnchor will copy the complete local records for the conversations you select into a project context pack under ~/.threadrelink. The pack is unredacted and can include system/developer messages, complete tool input and output, credentials, cookies, and absolute paths. Nothing is uploaded.",
      { modal: true },
      "Allow Full Context Packs",
    );
    if (action !== "Allow Full Context Packs") {
      return false;
    }
    await context.globalState.update(CONTEXT_PACK_CONSENT_KEY, true);
    return true;
  };

  const ensureHandoffConsent = async (): Promise<boolean> => {
    if (context.globalState.get<boolean>(HANDOFF_CONSENT_KEY, false)) {
      return true;
    }
    const action = await vscode.window.showWarningMessage(
      "ChatAnchor will read this conversation's complete local record and create an unredacted handoff under ~/.threadrelink. It can include system/developer messages, complete tool input and output, credentials, cookies, and absolute paths. Nothing is uploaded.",
      { modal: true },
      "Allow Agent Handoffs",
    );
    if (action !== "Allow Agent Handoffs") {
      return false;
    }
    await context.globalState.update(HANDOFF_CONSENT_KEY, true);
    return true;
  };

  const setTreeCollapsedContext = async (collapsed: boolean): Promise<void> => {
    await vscode.commands.executeCommand(
      "setContext",
      "threadrelink.treeCollapsed",
      collapsed,
    );
  };

  const updateContexts = async (
    workspaces = provider.getWorkspaces(),
  ): Promise<void> => {
    const hasHiddenConversations = provider.hasHiddenConversations();
    let showingHiddenConversations = provider.isShowingHiddenConversations();
    if (!hasHiddenConversations && showingHiddenConversations) {
      provider.setShowHiddenConversations(false);
      showingHiddenConversations = false;
    }
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
      vscode.commands.executeCommand(
        "setContext",
        "threadrelink.hasHiddenConversations",
        hasHiddenConversations,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "threadrelink.showingHiddenConversations",
        showingHiddenConversations,
      ),
      setTreeCollapsedContext(provider.isTreeCollapsed()),
    ]);
  };

  const collapseTree = async (): Promise<void> => {
    provider.setPreferredCollapsed(true);
    await setTreeCollapsedContext(true);
  };

  const expandTree = async (): Promise<void> => {
    provider.setPreferredCollapsed(false);
    await setTreeCollapsedContext(false);
    for (const workspaceNode of provider.workspaceNodes()) {
      try {
        await view.reveal(workspaceNode, {
          expand: 2,
          focus: false,
          select: false,
        });
      } catch {
        // Reveal can fail if the view is hidden or the node disappeared.
      }
    }
  };

  const showHiddenConversations = async (): Promise<void> => {
    if (!provider.hasHiddenConversations()) {
      void vscode.window.showInformationMessage("No hidden conversations.");
      return;
    }
    provider.setShowHiddenConversations(true);
    await updateContexts();
  };

  const noHiddenConversations = (): void => {
    void vscode.window.showInformationMessage("No hidden conversations.");
  };

  const hideHiddenConversations = async (): Promise<void> => {
    provider.setShowHiddenConversations(false);
    await updateContexts();
  };

  const openGettingStarted = async (): Promise<void> => {
    await vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      walkthroughTarget(context.extension.id),
      false,
    );
  };

  const chooseReadyWorkspace = async (
    placeHolder: string,
    requestedPath?: unknown,
  ): Promise<WorkspaceResult | undefined> => {
    const ready = provider.getWorkspaces().filter((workspace) =>
      workspace.probe?.state === "ready"
    );
    if (typeof requestedPath === "string" && requestedPath) {
      const requested = ready.find((workspace) =>
        workspace.path === requestedPath
      );
      if (!requested) {
        void vscode.window.showInformationMessage(
          "Set up this project in ChatAnchor before using this action.",
        );
      }
      return requested;
    }
    if (ready.length === 0) {
      void vscode.window.showInformationMessage(
        "Set up a ChatAnchor project before using this action.",
      );
      return undefined;
    }
    if (ready.length === 1) {
      return ready[0];
    }
    const selected = await vscode.window.showQuickPick(
      ready.map((workspace) => ({
        label: workspace.name,
        description: workspace.probe?.project?.kind === "git"
          ? "Git project"
          : "directory",
        detail: workspace.path,
        workspace,
      })),
      {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      },
    );
    return selected?.workspace;
  };

  const chooseAgentProvider = async (): Promise<ConversationProvider | undefined> => {
    const settings = readSettings();
    const paths: Record<ConversationProvider, string> = {
      codex: settings.codexPath,
      cursor: settings.agentPath,
      opencode: settings.openCodePath,
    };
    const available = AGENT_PROVIDER_PICKS.filter((item) =>
      resolveExecutablePath(paths[item.provider]) !== null
    );
    if (available.length === 0) {
      void vscode.window.showInformationMessage(
        "ChatAnchor could not find a supported agent CLI.",
        "Run Diagnostics",
      ).then((choice) => {
        if (choice === "Run Diagnostics") {
          void vscode.commands.executeCommand("threadrelink.doctor");
        }
      });
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(available, {
      placeHolder: "Choose an agent CLI to start",
      ignoreFocusOut: true,
    });
    return selected?.provider;
  };

  const ensureConsent = async (): Promise<boolean> => {
    if (hasConsent()) {
      return true;
    }
    const choice = await vscode.window.showInformationMessage(
      "ChatAnchor reads local Codex, Cursor Agent CLI, and OpenCode conversation metadata (thread ID, title, cwd, timestamps, and Git info). It does not copy message bodies or upload data.",
      { modal: true },
      "Enable ChatAnchor",
    );
    if (choice !== "Enable ChatAnchor") {
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
        "Trust this workspace before ChatAnchor can scan local agent metadata.",
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
            `ChatAnchor detected a new location for ${report.projectName} and reconnected ${report.linkedThreads} conversation${report.linkedThreads === 1 ? "" : "s"}.`,
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
        "Trust this workspace before setting up ChatAnchor.",
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
        `ChatAnchor set up ${project.name}. Project ID: ${project.id}`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const confirmRecoveryLink = async (
    decision: MatchDecision,
    workspacePath: string,
  ): Promise<void> => {
    const choice = await vscode.window.showWarningMessage(
      `Link “${conversationLabel(decision)}” to this project? This changes only ChatAnchor's local registry.`,
      { modal: true },
      "Link conversation",
    );
    if (choice !== "Link conversation") {
      return;
    }
    await makeService().linkThread(
      decision.thread.id,
      workspacePath,
      decision.thread.provider,
    );
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
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
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
          placeHolder: "Choose a ChatAnchor project to forget",
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
        `Forget ChatAnchor project “${preview.project.name}” at ${root}? ${preview.linkedThreads} ChatAnchor link(s), matching local identities, generated handoffs, and any project context pack will be removed. Agent conversations and source transcripts will not be deleted.`,
        { modal: true },
        "Forget project",
      );
      if (choice !== "Forget project") {
        return;
      }
      const result = await service.forgetProject(projectId, workspacePaths);
      void vscode.window.showInformationMessage(
        `Forgot ${preview.project.name}: removed ${result.removedLinks} ChatAnchor link(s)${result.removedHandoffs ? " and its generated handoffs" : ""}${result.removedContextPack ? " and its context pack" : ""}. No agent conversations were deleted.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const removeThreadLink = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    const selected = node?.kind === "thread"
      ? node
      : await chooseThread(
          provider.allLinked(),
          "Choose a project conversation to remove from this project",
        );
    if (!selected || selected.kind !== "thread") {
      return;
    }
    const projectId = projectIdForThreadNode(selected);
    if (!projectId) {
      return;
    }
    const label = conversationLabel(selected.decision);
    const choice = await vscode.window.showWarningMessage(
      `Remove “${label}” from this project and ignore future automatic matches? This changes only ChatAnchor's local registry.`,
      { modal: true },
      "Remove link",
    );
    if (choice !== "Remove link") {
      return;
    }
    try {
      await makeService().ignoreThreadForProject(
        selected.decision.thread.id,
        projectId,
        selected.decision.thread.provider,
      );
      void vscode.window.showInformationMessage(
        `Removed “${label}” from this project. You can restore it from Find Old Conversations.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const editThreadDescription = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    if (node?.kind !== "thread") {
      return;
    }
    const projectId = projectIdForThreadNode(node);
    if (!projectId) {
      return;
    }
    const originalLabel = formatConversationLabel(
      node.decision.thread.name,
      node.decision.thread.preview,
      node.decision.thread.id,
    );
    const value = await vscode.window.showInputBox({
      prompt:
        "Set a custom conversation description. Leave empty to use the original title.",
      placeHolder: originalLabel,
      value: node.decision.display?.customLabel ?? "",
      ignoreFocusOut: true,
      validateInput: (input) =>
        normalizedCustomLabelLength(input) > 120
          ? "Descriptions are limited to 120 characters."
          : undefined,
    });
    if (value === undefined) {
      return;
    }
    try {
      const state = await makeService().setThreadCustomLabel(
        node.decision.thread.id,
        projectId,
        value,
        node.decision.thread.provider,
      );
      void vscode.window.showInformationMessage(
        state.customLabel
          ? `Updated “${originalLabel}”.`
          : `Cleared custom description for “${originalLabel}”.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const hideThread = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    if (node?.kind !== "thread") {
      return;
    }
    const projectId = projectIdForThreadNode(node);
    if (!projectId) {
      return;
    }
    const label = conversationLabel(node.decision);
    try {
      await makeService().setThreadHidden(
        node.decision.thread.id,
        projectId,
        true,
        node.decision.thread.provider,
      );
      provider.setShowHiddenConversations(false);
      void vscode.window.showInformationMessage(`Hidden “${label}”.`);
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const showThread = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    if (node?.kind !== "thread") {
      return;
    }
    const projectId = projectIdForThreadNode(node);
    if (!projectId) {
      return;
    }
    const label = conversationLabel(node.decision);
    try {
      await makeService().setThreadHidden(
        node.decision.thread.id,
        projectId,
        false,
        node.decision.thread.provider,
      );
      void vscode.window.showInformationMessage(`Unhidden “${label}”.`);
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const restoreHiddenConversations = async (): Promise<void> => {
    const workspaces = provider.getWorkspaces().filter((workspace) =>
      workspace.probe?.state === "ready" && hiddenCount(workspace) > 0
    );
    if (workspaces.length === 0) {
      void vscode.window.showInformationMessage(
        "No hidden project conversations to unhide.",
      );
      return;
    }
    const workspace = workspaces.length === 1
      ? workspaces[0]
      : (await vscode.window.showQuickPick(
          workspaces.map((candidate) => ({
            label: candidate.name,
            description: `${hiddenCount(candidate)} hidden`,
            detail: candidate.path,
            workspace: candidate,
          })),
          {
            placeHolder: "Choose a project to unhide conversations",
            matchOnDetail: true,
            ignoreFocusOut: true,
          },
        ))?.workspace;
    const projectId = workspace?.sync?.project.id ?? workspace?.probe?.project?.id;
    if (!workspace || !projectId) {
      return;
    }
    try {
      const restored = await makeService().restoreHiddenThreads(projectId);
      void vscode.window.showInformationMessage(
        `Unhid ${restored} hidden conversation${restored === 1 ? "" : "s"} in ${workspace.name}.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const moveThreadLink = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    const threadNode = node?.kind === "thread"
      ? node
      : await chooseThread(
          provider.allLinked(),
          "Choose a project conversation to move",
        );
    if (!threadNode || threadNode.kind !== "thread") {
      return;
    }
    const currentProjectId = projectIdForThreadNode(threadNode);
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
          "Set up another ChatAnchor project before moving this conversation.",
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
      const selectedProject = await vscode.window.showQuickPick(choices, {
        placeHolder: "Choose the project that owns this conversation",
        matchOnDetail: true,
        ignoreFocusOut: true,
      });
      if (!selectedProject) {
        return;
      }
      const label = conversationLabel(threadNode.decision);
      const choice = await vscode.window.showWarningMessage(
        `Move “${label}” to ${selectedProject.label}? The old project will ignore future automatic matches for this conversation.`,
        { modal: true },
        "Move conversation",
      );
      if (choice !== "Move conversation") {
        return;
      }
      await service.linkThreadToProject(
        threadNode.decision.thread.id,
        selectedProject.projectId,
        threadNode.decision.thread.provider,
      );
      void vscode.window.showInformationMessage(
        `Moved “${label}” to ${selectedProject.label}.`,
      );
      await refresh(false);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const manageThreadLink = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    const selected = node?.kind === "thread"
      ? node
      : await chooseThread(
          provider.allLinked(),
          "Choose a project conversation to manage",
        );
    if (!selected || selected.kind !== "thread") {
      return;
    }
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(arrow-swap) Move Link to Another Project",
          description: "Assign this conversation to a different ChatAnchor project.",
          action: "move" as const,
        },
        {
          label: "$(remove-close) Remove Link and Ignore for This Project",
          description: "Remove it here and prevent future automatic matches.",
          action: "remove" as const,
        },
      ],
      {
        placeHolder: `Manage “${conversationLabel(selected.decision)}”`,
        ignoreFocusOut: true,
      },
    );
    if (choice?.action === "move") {
      await moveThreadLink(selected);
    } else if (choice?.action === "remove") {
      await removeThreadLink(selected);
    }
  };

  const startNewAgentSession = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "Trust this workspace before ChatAnchor can start an agent CLI.",
      );
      return;
    }
    const workspace = node?.kind === "category"
      ? await chooseReadyWorkspace(
          "Choose a project for the new agent session",
          node.workspace.path,
        )
      : await chooseReadyWorkspace(
          "Choose a project for the new agent session",
        );
    if (!workspace) {
      return;
    }
    const providerId = node?.kind === "category"
      ? node.provider
      : await chooseAgentProvider();
    if (!providerId) {
      return;
    }

    const settings = readSettings();
    let shellPath: string | null;
    let shellArgs: string[];
    if (providerId === "cursor") {
      shellPath = resolveExecutablePath(settings.agentPath);
      shellArgs = buildCursorNewSessionArgs(workspace.path);
    } else if (providerId === "opencode") {
      shellPath = resolveExecutablePath(settings.openCodePath);
      shellArgs = buildOpenCodeNewSessionArgs(workspace.path);
    } else {
      shellPath = resolveExecutablePath(settings.codexPath);
      shellArgs = buildCodexNewSessionArgs(workspace.path);
    }

    if (!shellPath) {
      const settingName = providerId === "cursor"
        ? "threadrelink.agentPath"
        : providerId === "opencode"
          ? "threadrelink.opencodePath"
          : "threadrelink.codexPath";
      const configuredPath = providerId === "cursor"
        ? settings.agentPath
        : providerId === "opencode"
          ? settings.openCodePath
          : settings.codexPath;
      void vscode.window.showErrorMessage(
        `ChatAnchor: Could not find the "${configuredPath}" executable on PATH. Set "${settingName}" to its absolute path.`,
      );
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: `ChatAnchor: New ${AGENT_PROVIDER_LABEL[providerId]}`,
      shellPath,
      shellArgs,
      cwd: workspace.path,
      iconPath: new vscode.ThemeIcon("terminal"),
    });
    terminal.show();
  };

  const exportOpenCodeAtPath = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    const selected = node?.kind === "thread"
      ? node
      : await chooseThread(
          provider.allLinked().filter((candidate) =>
            candidate.kind === "thread"
            && candidate.decision.thread.provider === "opencode"
          ),
          "Choose an OpenCode conversation to export",
        );
    if (
      !selected
      || selected.kind !== "thread"
      || selected.decision.thread.provider !== "opencode"
    ) {
      return;
    }
    try {
      const settings = readSettings();
      const openCodeExecutable = resolveExecutablePath(settings.openCodePath);
      if (!openCodeExecutable) {
        void vscode.window.showErrorMessage(
          `ChatAnchor: Could not find the "${settings.openCodePath}" executable on PATH. Set "threadrelink.opencodePath" to its absolute path.`,
        );
        return;
      }
      const result = await exportOpenCodeSessionToTempFile(
        selected.decision.thread.id,
        {
          openCodeHome: settings.openCodeHome,
          openCodePath: openCodeExecutable,
        },
      );
      await vscode.env.clipboard.writeText(result.atPath);
      const fallbackNote = result.exportSource === "database-fallback"
        ? " OpenCode CLI export was incomplete, so ChatAnchor used the local database fallback."
        : "";
      const action = await vscode.window.showInformationMessage(
        `Exported “${conversationLabel(selected.decision)}” and copied ${result.atPath}. The JSON may include conversation history.${fallbackNote}`,
        "Reveal in OS",
      );
      if (action === "Reveal in OS") {
        await vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(result.filePath),
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const copyCompactAtPath = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    const selected = node?.kind === "thread"
      ? node
      : await chooseThread(
          provider.allLinked(),
          "Choose a conversation to compact",
        );
    if (!selected || selected.kind !== "thread") {
      return;
    }
    if (!(await ensureCompactTranscriptConsent())) {
      return;
    }

    try {
      const thread = selected.decision.thread;
      const settings = readSettings();
      let sourcePath: string;
      let usedOpenCodeExportFallback = false;
      if (thread.provider === "opencode") {
        const openCodeExecutable = resolveExecutablePath(settings.openCodePath);
        if (!openCodeExecutable) {
          void vscode.window.showErrorMessage(
            `ChatAnchor: Could not find the "${settings.openCodePath}" executable on PATH. Set "threadrelink.opencodePath" to its absolute path.`,
          );
          return;
        }
        const exportResult = await exportOpenCodeSessionToTempFile(
          thread.id,
          {
            openCodeHome: settings.openCodeHome,
            openCodePath: openCodeExecutable,
          },
        );
        sourcePath = exportResult.filePath;
        usedOpenCodeExportFallback =
          exportResult.exportSource === "database-fallback";
      } else {
        sourcePath = await makeService().resolveConversationFilePath(
          thread.provider,
          thread.id,
          thread.cwd,
        );
      }

      const result = await writeCompactTranscriptFromFile({
        provider: thread.provider,
        threadId: thread.id,
        filePath: sourcePath,
        title: conversationLabel(selected.decision),
        cwd: thread.cwd,
      });
      await vscode.env.clipboard.writeText(result.atPath);
      const fallbackNote = usedOpenCodeExportFallback
        ? " OpenCode CLI export was incomplete, so ChatAnchor used the local database fallback first."
        : "";
      const action = await vscode.window.showInformationMessage(
        `Copied ${result.atPath}. Paste it into any agent to carry over compact context.${fallbackNote}`,
        "Reveal in OS",
      );
      if (action === "Reveal in OS") {
        await vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(result.filePath),
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const continueInAnotherAgent = async (
    node?: ThreadRelinkTreeNode,
  ): Promise<void> => {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "Trust this workspace before ChatAnchor can start an agent CLI.",
      );
      return;
    }
    const selected = node?.kind === "thread"
      ? node
      : await chooseThread(
          provider.allLinked(),
          "Choose a conversation to continue in another agent",
        );
    if (!selected || selected.kind !== "thread") {
      return;
    }
    const sourceThread = selected.decision.thread;
    const settings = readSettings();
    const configuredPaths: Record<ConversationProvider, string> = {
      codex: settings.codexPath,
      cursor: settings.agentPath,
      opencode: settings.openCodePath,
    };
    const targets = AGENT_PROVIDER_PICKS.filter((item) =>
      item.provider !== sourceThread.provider
      && resolveExecutablePath(configuredPaths[item.provider]) !== null
    );
    if (targets.length === 0) {
      void vscode.window.showInformationMessage(
        "ChatAnchor could not find another supported agent CLI.",
        "Run Diagnostics",
      ).then((choice) => {
        if (choice === "Run Diagnostics") {
          void vscode.commands.executeCommand("threadrelink.doctor");
        }
      });
      return;
    }
    const target = await vscode.window.showQuickPick(targets, {
      placeHolder: `Continue this ${AGENT_PROVIDER_LABEL[sourceThread.provider]} conversation in…`,
      ignoreFocusOut: true,
    });
    if (!target || !(await ensureHandoffConsent())) {
      return;
    }

    try {
      const preparationController = new AbortController();
      const prepared = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "ChatAnchor: Preparing agent handoff",
          cancellable: true,
        },
        async (progress, token) => {
          const cancellation = token.onCancellationRequested(() => {
            preparationController.abort();
          });
          const service = makeService();
          try {
            progress.report({ message: "Locating the complete conversation" });
            const [info, source] = await Promise.all([
              service.listProjectContextSources(selected.workspace.path),
              service.readProjectContextSource(
                selected.workspace.path,
                sourceThread.provider,
                sourceThread.id,
                preparationController.signal,
              ),
            ]);
            return { info, service, source };
          } finally {
            cancellation.dispose();
          }
        },
      );
      const confirmation = await vscode.window.showWarningMessage(
        `Create an unredacted local handoff from “${conversationLabel(selected.decision)}” and continue it in ${AGENT_PROVIDER_LABEL[target.provider]}? The complete source is ${formatBytes(prepared.source.estimatedBytes)} across ${prepared.source.estimatedFiles} file(s). The handoff keeps the complete original and readable transcript, while its entry file starts with a bounded current working set.`,
        { modal: true },
        "Build and Continue",
      );
      if (confirmation !== "Build and Continue") {
        return;
      }

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "ChatAnchor: Building agent handoff",
          cancellable: true,
        },
        async (progress, token) => {
          const buildController = new AbortController();
          const cancellation = token.onCancellationRequested(() => {
            buildController.abort();
          });
          try {
            return await buildConversationHandoff({
              projectId: prepared.info.project.id,
              projectName: prepared.info.project.name,
              projectRoot: prepared.info.projectRoot,
              source: prepared.source,
              registryHome: prepared.service.registry.home,
              signal: buildController.signal,
              onProgress: (message) => progress.report({ message }),
            });
          } finally {
            cancellation.dispose();
          }
        },
      );
      await vscode.env.clipboard.writeText(result.atPath);

      const prompt = buildAgentHandoffPrompt(sourceThread.provider, result.atPath);
      const executable = resolveExecutablePath(configuredPaths[target.provider]);
      if (!executable) {
        void vscode.window.showErrorMessage(
          `ChatAnchor built the handoff and copied ${result.atPath}, but could not find the ${AGENT_PROVIDER_LABEL[target.provider]} executable.`,
        );
        return;
      }
      let shellArgs: string[];
      if (target.provider === "cursor") {
        shellArgs = buildCursorHandoffArgs(prepared.info.projectRoot, prompt);
      } else if (target.provider === "opencode") {
        shellArgs = buildOpenCodeHandoffArgs(prepared.info.projectRoot, prompt);
      } else {
        shellArgs = buildCodexHandoffArgs(prepared.info.projectRoot, prompt);
      }
      const terminalIdentity = {
        provider: target.provider,
        threadId: `${sourceThread.provider}:${sourceThread.id}:${result.manifest.source.sha256}`,
        projectId: prepared.info.project.id,
        targetPath: prepared.info.projectRoot,
      };
      const existingTerminal = findExistingResumeTerminal(
        vscode.window.terminals,
        terminalIdentity,
        {
          shellPath: executable,
          shellArgs,
          cwd: prepared.info.projectRoot,
        },
      );
      if (existingTerminal) {
        resumeTerminals.set(terminalIdentity, existingTerminal);
        existingTerminal.show();
      } else {
        const terminal = vscode.window.createTerminal({
          name: `ChatAnchor: ${AGENT_PROVIDER_LABEL[sourceThread.provider]} → ${AGENT_PROVIDER_LABEL[target.provider]}`,
          shellPath: executable,
          shellArgs,
          cwd: prepared.info.projectRoot,
          env: resumeTerminalEnv(terminalIdentity),
          iconPath: new vscode.ThemeIcon("arrow-swap"),
        });
        resumeTerminals.set(terminalIdentity, terminal);
        terminal.show();
      }
      void vscode.window.showInformationMessage(
        `${result.reused ? "Reused" : "Built"} the local handoff, copied ${result.atPath}, and started ${AGENT_PROVIDER_LABEL[target.provider]}.`,
        "Reveal Handoff",
      ).then(async (action) => {
        if (action === "Reveal Handoff") {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(result.filePath),
          );
        }
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("cancelled")) {
        void vscode.window.showInformationMessage("Agent handoff creation cancelled.");
        return;
      }
      void vscode.window.showErrorMessage(`ChatAnchor: ${message}`);
    }
  };

  const createProjectContextPack = async (
    requestedPath?: string,
  ): Promise<void> => {
    const workspace = await chooseReadyWorkspace(
      "Choose a project for the context pack",
      requestedPath,
    );
    if (!workspace || !(await ensureContextPackConsent())) {
      return;
    }
    const candidates = provider.allLinked().filter((node) =>
      node.kind === "thread" && node.workspace.path === workspace.path
    );
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(
        "Link at least one conversation to this project first.",
      );
      return;
    }
    const selected = await vscode.window.showQuickPick(
      candidates.flatMap((node) => node.kind === "thread" ? [{
        label: conversationLabel(node.decision),
        description: AGENT_PROVIDER_LABEL[node.decision.thread.provider],
        detail: `${relativeDate(node.decision.thread.updatedAt)} · ${node.decision.thread.id}`,
        node,
      }] : []),
      {
        canPickMany: true,
        placeHolder: "Select linked conversations for a complete local copy",
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      },
    );
    if (!selected || selected.length === 0) {
      return;
    }
    try {
      const controller = new AbortController();
      const prepared = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "ChatAnchor: Preparing full project context pack",
          cancellable: true,
        },
        async (progress, token) => {
          const cancellation = token.onCancellationRequested(() => {
            controller.abort();
          });
          const service = makeService();
          try {
            const info = await service.listProjectContextSources(workspace.path);
            const sources: ContextPackSource[] = [];
            for (const [index, item] of selected.entries()) {
              const thread = item.node.decision.thread;
              progress.report({
                message: `Inspecting ${index + 1}/${selected.length}: ${conversationLabel(item.node.decision)}`,
              });
              sources.push(await service.readProjectContextSource(
                workspace.path,
                thread.provider,
                thread.id,
                controller.signal,
              ));
            }
            return { info, service, sources };
          } finally {
            cancellation.dispose();
          }
        },
      );
      const sourceBytes = prepared.sources.reduce(
        (sum, source) => sum + source.estimatedBytes,
        0,
      );
      const estimatedOutputBytes = sourceBytes * 2 + 10 * 1_024 * 1_024;
      let diskWarning = "";
      try {
        const fileSystem = await statfs(prepared.service.registry.home);
        const availableBytes = fileSystem.bavail * fileSystem.bsize;
        if (availableBytes < estimatedOutputBytes) {
          diskWarning = ` Only ${formatBytes(availableBytes)} appears available, so creation may fail.`;
        }
      } catch {
        // Some virtual filesystems do not expose capacity. The build still has
        // an atomic staging directory and leaves the previous pack intact.
      }
      const confirmation = await vscode.window.showWarningMessage(
        `Create a complete, unredacted local copy of ${prepared.sources.length} conversation(s)? The source records total ${formatBytes(sourceBytes)}; originals plus readable transcripts may require about ${formatBytes(estimatedOutputBytes)}. Secrets, cookies, absolute paths, system/developer messages, and full tool output are preserved.${diskWarning}`,
        { modal: true },
        "Build Full Context Pack",
      );
      if (confirmation !== "Build Full Context Pack") {
        return;
      }
      let lastCompleted = 0;
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "ChatAnchor: Building full project context pack",
          cancellable: true,
        },
        async (progress, token) => {
          const buildController = new AbortController();
          const cancellation = token.onCancellationRequested(() => {
            buildController.abort();
          });
          try {
            return await buildProjectContextPack({
              projectId: prepared.info.project.id,
              projectName: prepared.info.project.name,
              projectRoot: prepared.info.projectRoot,
              sources: prepared.sources,
              registryHome: prepared.service.registry.home,
              signal: buildController.signal,
              onProgress: ({ completed, total, source }) => {
                const increment = total > 0
                  ? ((completed - lastCompleted) / total) * 100
                  : 0;
                lastCompleted = completed;
                progress.report({
                  increment,
                  message: `${Math.min(completed + 1, total)}/${total}: ${source.title || source.threadId}`,
                });
              },
            });
          } finally {
            cancellation.dispose();
          }
        },
      );
      await vscode.env.clipboard.writeText(result.atPath);
      void vscode.window.showInformationMessage(
        `Built a full context pack from ${result.manifest.sources.length} conversation(s) and copied ${result.atPath}.`,
        "Reveal in OS",
      ).then(async (action) => {
        if (action === "Reveal in OS") {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(result.filePath),
          );
        }
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("cancelled")) {
        void vscode.window.showInformationMessage("Context pack creation cancelled.");
      } else {
        void vscode.window.showErrorMessage(`ChatAnchor: ${message}`);
      }
    }
  };

  const copyProjectContextAtPath = async (
    requestedPath?: string,
  ): Promise<void> => {
    const workspace = await chooseReadyWorkspace(
      "Choose a project context pack",
      requestedPath,
    );
    if (!workspace) {
      return;
    }
    try {
      const service = makeService();
      const info = await service.listProjectContextSources(workspace.path);
      await readProjectContextPackManifest(info.project.id, service.registry.home);
      const filePath = `${resolveProjectContextPackPath(info.project.id, service.registry.home)}/context.md`;
      await vscode.env.clipboard.writeText(`@${filePath}`);
      void vscode.window.showInformationMessage(`Copied @${filePath}.`);
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const searchProjectContext = async (requestedPath?: string): Promise<void> => {
    const workspace = await chooseReadyWorkspace(
      "Choose a project context pack to search",
      requestedPath,
    );
    if (!workspace) {
      return;
    }
    const query = await vscode.window.showInputBox({
      prompt: "Search the local project context pack",
      placeHolder: "Feature, decision, error, or file name",
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : "Enter a search query.",
    });
    if (!query) {
      return;
    }
    try {
      const service = makeService();
      const info = await service.listProjectContextSources(workspace.path);
      const result = await searchProjectContextPack({
        projectId: info.project.id,
        query,
        registryHome: service.registry.home,
      });
      await vscode.env.clipboard.writeText(result.atPath);
      void vscode.window.showInformationMessage(
        `Copied ${result.atPath} with ${result.matchCount} context match(es).`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
    }
  };

  const deleteProjectContext = async (requestedPath?: string): Promise<void> => {
    const workspace = await chooseReadyWorkspace(
      "Choose a project context pack to delete",
      requestedPath,
    );
    if (!workspace) {
      return;
    }
    try {
      const service = makeService();
      const info = await service.listProjectContextSources(workspace.path);
      await readProjectContextPackManifest(info.project.id, service.registry.home);
      const action = await vscode.window.showWarningMessage(
        `Delete the generated context pack for “${info.project.name}”? Source conversations are not changed.`,
        { modal: true },
        "Delete Context Pack",
      );
      if (action !== "Delete Context Pack") {
        return;
      }
      await deleteProjectContextPack(info.project.id, service.registry.home);
      void vscode.window.showInformationMessage(
        `Deleted the context pack for ${info.project.name}.`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
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
        `ChatAnchor found a legacy parent project at ${probe.gitRoot} with ${preview.linkedThreads} linked conversation(s). This workspace will not use it unless you explicitly choose the parent repository.`,
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
    vscode.window.onDidCloseTerminal((terminal) => {
      resumeTerminals.deleteTerminal(terminal);
    }),
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
      "threadrelink.collapseTree",
      collapseTree,
    ),
    vscode.commands.registerCommand(
      "threadrelink.expandTree",
      expandTree,
    ),
    vscode.commands.registerCommand(
      "threadrelink.noHiddenConversations",
      noHiddenConversations,
    ),
    vscode.commands.registerCommand(
      "threadrelink.showHiddenConversations",
      showHiddenConversations,
    ),
    vscode.commands.registerCommand(
      "threadrelink.hideHiddenConversations",
      hideHiddenConversations,
    ),
    vscode.commands.registerCommand(
      "threadrelink.restoreHiddenConversations",
      restoreHiddenConversations,
    ),
    view.onDidExpandElement(() => {
      provider.markPreferredExpanded();
      void setTreeCollapsedContext(false);
    }),
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
      "threadrelink.editDescription",
      editThreadDescription,
    ),
    vscode.commands.registerCommand(
      "threadrelink.hideConversation",
      hideThread,
    ),
    vscode.commands.registerCommand(
      "threadrelink.showConversation",
      showThread,
    ),
    vscode.commands.registerCommand(
      "threadrelink.manageLink",
      manageThreadLink,
    ),
    vscode.commands.registerCommand(
      "threadrelink.startNewSession",
      startNewAgentSession,
    ),
    vscode.commands.registerCommand(
      "threadrelink.exportOpenCodeAtPath",
      exportOpenCodeAtPath,
    ),
    vscode.commands.registerCommand(
      "threadrelink.copyOpenCodeExportCommand",
      exportOpenCodeAtPath,
    ),
    vscode.commands.registerCommand(
      "threadrelink.copyCompactAtPath",
      copyCompactAtPath,
    ),
    vscode.commands.registerCommand(
      "threadrelink.continueInAnotherAgent",
      continueInAnotherAgent,
    ),
    vscode.commands.registerCommand(
      "threadrelink.createProjectContextPack",
      createProjectContextPack,
    ),
    vscode.commands.registerCommand(
      "threadrelink.copyProjectContextAtPath",
      copyProjectContextAtPath,
    ),
    vscode.commands.registerCommand(
      "threadrelink.searchProjectContext",
      searchProjectContext,
    ),
    vscode.commands.registerCommand(
      "threadrelink.deleteProjectContextPack",
      deleteProjectContext,
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
        const conversationProvider = selected.decision.thread.provider;
        try {
          const target = await makeService().resolveResumeTarget(
            selected.decision.thread.id,
            selected.workspace.path,
            conversationProvider,
          );
          if (target.warning) {
            void vscode.window.showWarningMessage(target.warning);
          }
          const terminalIdentity = resumeTerminalIdentity(
            conversationProvider,
            target,
          );
          const registeredTerminal = resumeTerminals.get(terminalIdentity);
          if (registeredTerminal) {
            if (isActiveResumeTerminal(registeredTerminal)) {
              registeredTerminal.show();
              return;
            }
            resumeTerminals.deleteTerminal(registeredTerminal);
          }
          const settings = readSettings();
          let shellPath: string;
          let shellArgs: string[];
          if (conversationProvider === "cursor") {
            const executable = resolveExecutablePath(settings.agentPath);
            if (!executable) {
              void vscode.window.showErrorMessage(
                `ChatAnchor: Could not find the "${settings.agentPath}" executable on PATH. Set "threadrelink.agentPath" to its absolute path.`,
              );
              return;
            }
            shellPath = executable;
            shellArgs = buildCursorResumeArgs(
              selected.decision.thread.id,
              target.path,
            );
          } else if (conversationProvider === "opencode") {
            const openCodeExecutable = resolveExecutablePath(settings.openCodePath);
            if (!openCodeExecutable) {
              void vscode.window.showErrorMessage(
                `ChatAnchor: Could not find the "${settings.openCodePath}" executable on PATH. Set "threadrelink.opencodePath" to its absolute path.`,
              );
              return;
            }
            shellPath = openCodeExecutable;
            shellArgs = buildOpenCodeResumeArgs(
              selected.decision.thread.id,
              target.path,
            );
          } else {
            const executable = resolveExecutablePath(settings.codexPath);
            if (!executable) {
              void vscode.window.showErrorMessage(
                `ChatAnchor: Could not find the "${settings.codexPath}" executable on PATH. Set "threadrelink.codexPath" to its absolute path.`,
              );
              return;
            }
            shellPath = executable;
            shellArgs = buildCodexResumeArgs(
              selected.decision.thread.id,
              target.path,
            );
          }
          const existingTerminal = findExistingResumeTerminal(
            vscode.window.terminals,
            terminalIdentity,
            { shellPath, shellArgs, cwd: target.path },
          );
          if (existingTerminal) {
            resumeTerminals.set(terminalIdentity, existingTerminal);
            existingTerminal.show();
            return;
          }
          const terminal = vscode.window.createTerminal({
            name: `ChatAnchor: ${conversationLabel(selected.decision)}`,
            shellPath,
            shellArgs,
            cwd: target.path,
            env: resumeTerminalEnv(terminalIdentity),
            iconPath: new vscode.ThemeIcon("history"),
          });
          resumeTerminals.set(terminalIdentity, terminal);
          terminal.show();
        } catch (error) {
          void vscode.window.showErrorMessage(
            `ChatAnchor: ${errorMessage(error)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "threadrelink.copyAtPath",
      async (node?: ThreadRelinkTreeNode) => {
        const selected = node?.kind === "thread"
          ? node
          : await chooseThread(
              provider.allLinked(),
              "Choose a project conversation to copy",
            );
        if (!selected || selected.kind !== "thread") {
          return;
        }
        try {
          const conversationPath = await makeService()
            .resolveConversationFilePath(
              selected.decision.thread.provider,
              selected.decision.thread.id,
              selected.decision.thread.cwd,
            );
          const atPath = `@${conversationPath}`;
          await vscode.env.clipboard.writeText(atPath);
          const action = await vscode.window.showInformationMessage(
            `Copied ${atPath}. Paste it into Cursor Chat or Agent to attach that conversation file.`,
            "Reveal in OS",
          );
          if (action === "Reveal in OS") {
            await vscode.commands.executeCommand(
              "revealFileInOS",
              vscode.Uri.file(conversationPath),
            );
          }
        } catch (error) {
          void vscode.window.showErrorMessage(
            `ChatAnchor: ${errorMessage(error)}`,
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
          const conversationPath = await makeService()
            .resolveConversationFilePath(
              selected.decision.thread.provider,
              selected.decision.thread.id,
              selected.decision.thread.cwd,
            );
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(conversationPath),
          );
        } catch (error) {
          void vscode.window.showErrorMessage(
            `ChatAnchor: ${errorMessage(error)}`,
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
          `ChatAnchor linked ${result.linkedThreads} conversation(s) from the old path.`,
        );
        await refresh(false);
      } catch (error) {
        void vscode.window.showErrorMessage(`ChatAnchor: ${errorMessage(error)}`);
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
        agentPath: settings.agentPath,
        cursorHome: settings.cursorHome,
        openCodePath: settings.openCodePath,
        openCodeHome: settings.openCodeHome,
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
          ? "ChatAnchor diagnostics passed."
          : "ChatAnchor found problems. See the ChatAnchor output.",
      );
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await refresh(false);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration("threadrelink.codexPath")
        || event.affectsConfiguration("threadrelink.agentPath")
        || event.affectsConfiguration("threadrelink.cursorHome")
        || event.affectsConfiguration("threadrelink.opencodePath")
        || event.affectsConfiguration("threadrelink.opencodeHome")
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
    "editDescription",
    "hideConversation",
    "showConversation",
    "noHiddenConversations",
    "showHiddenConversations",
    "hideHiddenConversations",
    "restoreHiddenConversations",
    "manageLink",
    "startNewSession",
    "exportOpenCodeAtPath",
    "copyOpenCodeExportCommand",
    "copyCompactAtPath",
    "continueInAnotherAgent",
    "createProjectContextPack",
    "copyProjectContextAtPath",
    "searchProjectContext",
    "deleteProjectContextPack",
    "resume",
    "copyAtPath",
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
      "ChatAnchor is ready. Set up each project explicitly to keep its local Codex, Cursor, and OpenCode conversations discoverable after a rename.",
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
