import * as vscode from "vscode";
import type { ConversationProvider, MatchDecision } from "@threadrelink/core";
import {
  conversationLabel,
  relativeDate,
  type WorkspaceResult,
} from "./view-model.js";

const PROVIDER_CATEGORIES: ReadonlyArray<{
  provider: ConversationProvider;
  label: string;
}> = [
  { provider: "codex", label: "Codex" },
  { provider: "cursor", label: "Cursor" },
  { provider: "opencode", label: "OpenCode" },
];

const PROVIDER_ICON_NAME: Record<ConversationProvider, string> = {
  codex: "codex",
  cursor: "cursor",
  opencode: "opencode",
};

const PROVIDER_LABEL: Record<ConversationProvider, string> = {
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

function linkedForProvider(
  workspace: WorkspaceResult,
  provider: ConversationProvider,
): MatchDecision[] {
  return (workspace.sync?.linked ?? []).filter(
    (decision) => decision.thread.provider === provider,
  );
}

function providerCategoryNode(
  workspace: WorkspaceResult,
  provider: ConversationProvider,
): ThreadRelinkTreeNode {
  return {
    kind: "category",
    workspace,
    provider,
    decisions: linkedForProvider(workspace, provider),
  };
}

export type ThreadRelinkTreeNode =
  | {
      kind: "workspace";
      workspace: WorkspaceResult;
    }
  | {
      kind: "category";
      workspace: WorkspaceResult;
      provider: ConversationProvider;
      decisions: MatchDecision[];
    }
  | {
      kind: "thread";
      workspace: WorkspaceResult;
      decision: MatchDecision;
    }
  | {
      kind: "message";
      label: string;
      workspacePath?: string;
      provider?: ConversationProvider;
    }
  | {
      kind: "action";
      label: string;
      description?: string;
      command: string;
      arguments?: unknown[];
      icon: string;
      workspacePath?: string;
    };

export class ThreadRelinkTreeProvider
implements vscode.TreeDataProvider<ThreadRelinkTreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<
    ThreadRelinkTreeNode | undefined | null | void
  >();
  private workspaces: WorkspaceResult[] = [];
  private expansionEpoch = 0;
  private preferredCollapsibleState =
    vscode.TreeItemCollapsibleState.Expanded;

  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public dispose(): void {
    this.changed.dispose();
  }

  private providerIcon(
    provider: ConversationProvider,
  ): { light: vscode.Uri; dark: vscode.Uri } {
    const name = PROVIDER_ICON_NAME[provider] ?? "codex";
    return {
      light: vscode.Uri.joinPath(
        this.extensionUri,
        "resources",
        "providers",
        `${name}-light.svg`,
      ),
      dark: vscode.Uri.joinPath(
        this.extensionUri,
        "resources",
        "providers",
        `${name}-dark.svg`,
      ),
    };
  }

  public setWorkspaces(workspaces: WorkspaceResult[]): void {
    this.workspaces = workspaces;
    this.changed.fire();
  }

  public getWorkspaces(): WorkspaceResult[] {
    return this.workspaces;
  }

  public isTreeCollapsed(): boolean {
    return this.preferredCollapsibleState
      === vscode.TreeItemCollapsibleState.Collapsed;
  }

  public setPreferredCollapsed(collapsed: boolean): void {
    this.preferredCollapsibleState = collapsed
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    this.expansionEpoch += 1;
    this.changed.fire();
  }

  /** Update expansion preference without resetting TreeItem identities. */
  public markPreferredExpanded(): void {
    this.preferredCollapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  }

  public workspaceNodes(): ThreadRelinkTreeNode[] {
    return this.workspaces.map((workspace) => ({
      kind: "workspace" as const,
      workspace,
    }));
  }

  public allLinked(): ThreadRelinkTreeNode[] {
    return this.workspaces.flatMap((workspace) =>
      (workspace.sync?.linked ?? []).map((decision) => ({
        kind: "thread" as const,
        workspace,
        decision,
      }))
    );
  }

  public getParent(
    element: ThreadRelinkTreeNode,
  ): ThreadRelinkTreeNode | undefined {
    if (element.kind === "workspace") {
      return undefined;
    }
    if (element.kind === "category") {
      return { kind: "workspace", workspace: element.workspace };
    }
    if (element.kind === "thread") {
      return providerCategoryNode(
        element.workspace,
        element.decision.thread.provider,
      );
    }
    if (element.kind === "message" && element.provider && element.workspacePath) {
      const workspace = this.workspaces.find(
        (candidate) => candidate.path === element.workspacePath,
      );
      return workspace
        ? providerCategoryNode(workspace, element.provider)
        : undefined;
    }
    const workspacePath = element.workspacePath;
    if (!workspacePath) {
      return undefined;
    }
    const workspace = this.workspaces.find(
      (candidate) => candidate.path === workspacePath,
    );
    return workspace ? { kind: "workspace", workspace } : undefined;
  }

  public getTreeItem(element: ThreadRelinkTreeNode): vscode.TreeItem {
    if (element.kind === "workspace") {
      const item = new vscode.TreeItem(
        element.workspace.name,
        this.preferredCollapsibleState,
      );
      const probe = element.workspace.probe;
      if (!probe) {
        item.description = "Checking project…";
      } else if (probe.state !== "ready") {
        item.description = probe.state === "parent-choice-required"
          ? "Not set up · parent Git detected"
          : "Not set up";
      } else if (
        probe.project?.kind === "git"
        && probe.gitRoot
        && probe.gitRoot !== probe.workspacePath
      ) {
        item.description = `Parent Git: ${probe.project.name}`;
      } else {
        item.description = probe.project?.kind === "git"
          ? "Git project"
          : "directory";
      }
      item.tooltip = [
        `Workspace: ${element.workspace.path}`,
        probe?.gitRoot && probe.gitRoot !== probe.workspacePath
          ? `Git root: ${probe.gitRoot}`
          : null,
      ].filter(Boolean).join("\n");
      item.iconPath = new vscode.ThemeIcon("repo");
      item.contextValue = probe?.state === "ready"
        ? "threadrelink.readyWorkspace"
        : "threadrelink.uninitializedWorkspace";
      item.id = `workspace:${this.expansionEpoch}:${element.workspace.path}`;
      return item;
    }

    if (element.kind === "category") {
      const label = PROVIDER_LABEL[element.provider] ?? "Codex";
      const item = new vscode.TreeItem(
        label,
        this.preferredCollapsibleState,
      );
      item.description = String(element.decisions.length);
      item.iconPath = this.providerIcon(element.provider);
      item.contextValue = `threadrelink.linked.${element.provider}`;
      item.id =
        `category:${this.expansionEpoch}:${element.workspace.path}:${element.provider}`;
      return item;
    }

    if (element.kind === "message") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("info");
      item.id = `message:${this.expansionEpoch}:${element.workspacePath ?? ""}:${element.provider ?? ""}:${element.label}`;
      return item;
    }

    if (element.kind === "action") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.command = {
        command: element.command,
        title: element.label,
        arguments: element.arguments,
      };
      item.contextValue = "threadrelink.action";
      item.id = `action:${this.expansionEpoch}:${element.workspacePath ?? ""}:${element.command}:${element.label}`;
      return item;
    }

    const { decision } = element;
    const item = new vscode.TreeItem(
      conversationLabel(decision),
      vscode.TreeItemCollapsibleState.None,
    );
    const providerLabel = PROVIDER_LABEL[decision.thread.provider] ?? "Codex";
    item.description = [
      relativeDate(decision.thread.updatedAt),
      decision.thread.archived ? "archived" : null,
    ].filter(Boolean).join(" · ");
    item.tooltip = [
      decision.thread.name ?? decision.thread.preview ?? decision.thread.id,
      `Provider: ${providerLabel}`,
      `Thread: ${decision.thread.id}`,
      `Recorded cwd: ${decision.thread.cwd}`,
      ...decision.evidence.map((evidence) => evidence.description),
    ].join("\n");
    item.iconPath = decision.thread.archived
      ? new vscode.ThemeIcon("archive")
      : this.providerIcon(decision.thread.provider);
    item.contextValue =
      `threadrelink.linkedThread.${decision.thread.provider}`;
    item.id =
      `thread:${this.expansionEpoch}:${element.workspace.path}:${decision.thread.provider}:${decision.thread.id}`;
    return item;
  }

  public getChildren(
    element?: ThreadRelinkTreeNode,
  ): vscode.ProviderResult<ThreadRelinkTreeNode[]> {
    if (!element) {
      return this.workspaceNodes();
    }
    if (element.kind === "workspace") {
      if (element.workspace.error) {
        return [{
          kind: "message",
          label: element.workspace.error,
          workspacePath: element.workspace.path,
        }];
      }
      const probe = element.workspace.probe;
      if (!probe) {
        return [{
          kind: "message",
          label: "Checking project identity…",
          workspacePath: element.workspace.path,
        }];
      }
      if (probe.state !== "ready") {
        const detail = probe.state === "parent-choice-required"
          ? `This folder is inside ${probe.gitRoot}.`
          : "ThreadRelink is off for this workspace.";
        return [
          {
            kind: "message",
            label: detail,
            workspacePath: element.workspace.path,
          },
          {
            kind: "action",
            label: "Set up this project",
            command: "threadrelink.initialize",
            arguments: [element.workspace.path],
            icon: "key",
            workspacePath: element.workspace.path,
          },
        ];
      }

      const sync = element.workspace.sync;
      if (!sync) {
        return [
          {
            kind: "action",
            label: "Refresh project conversations",
            command: "threadrelink.refresh",
            icon: "refresh",
            workspacePath: element.workspace.path,
          },
        ];
      }

      return PROVIDER_CATEGORIES.map(({ provider }) =>
        providerCategoryNode(element.workspace, provider)
      );
    }
    if (element.kind === "category") {
      if (element.decisions.length === 0) {
        const label = `No ${PROVIDER_LABEL[element.provider] ?? "Codex"} conversations for this project.`;
        return [{
          kind: "message",
          label,
          workspacePath: element.workspace.path,
          provider: element.provider,
        }];
      }
      return element.decisions.map((decision) => ({
        kind: "thread" as const,
        workspace: element.workspace,
        decision,
      }));
    }
    return [];
  }
}
