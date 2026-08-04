import * as vscode from "vscode";
import type { MatchDecision } from "@threadrelink/core";
import {
  conversationLabel,
  relativeDate,
  type WorkspaceResult,
} from "./view-model.js";

export type ThreadRelinkTreeNode =
  | {
      kind: "workspace";
      workspace: WorkspaceResult;
    }
  | {
      kind: "category";
      workspace: WorkspaceResult;
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

  public dispose(): void {
    this.changed.dispose();
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
      return {
        kind: "category",
        workspace: element.workspace,
        decisions: element.workspace.sync?.linked ?? [element.decision],
      };
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
      const item = new vscode.TreeItem(
        "Conversations",
        this.preferredCollapsibleState,
      );
      item.description = String(element.decisions.length);
      item.iconPath = new vscode.ThemeIcon("comment-discussion");
      item.contextValue = "threadrelink.linked";
      item.id =
        `category:${this.expansionEpoch}:${element.workspace.path}`;
      return item;
    }

    if (element.kind === "message") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("info");
      item.id = `message:${this.expansionEpoch}:${element.workspacePath ?? ""}:${element.label}`;
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
    item.description =
      `${relativeDate(decision.thread.updatedAt)}${decision.thread.archived ? " · archived" : ""}`;
    item.tooltip = [
      decision.thread.name ?? decision.thread.preview ?? decision.thread.id,
      `Thread: ${decision.thread.id}`,
      `Recorded cwd: ${decision.thread.cwd}`,
      ...decision.evidence.map((evidence) => evidence.description),
    ].join("\n");
    item.iconPath = new vscode.ThemeIcon(
      decision.thread.archived ? "archive" : "comment",
    );
    item.contextValue = "threadrelink.linkedThread";
    item.id =
      `thread:${this.expansionEpoch}:${element.workspace.path}:${decision.thread.id}`;
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

      if (sync.linked.length > 0) {
        return [{
          kind: "category",
          workspace: element.workspace,
          decisions: sync.linked,
        }];
      }
      return [{
        kind: "message",
        label: "No conversations for this project yet.",
        workspacePath: element.workspace.path,
      }];
    }
    if (element.kind === "category") {
      return element.decisions.map((decision) => ({
        kind: "thread" as const,
        workspace: element.workspace,
        decision,
      }));
    }
    return [];
  }
}
