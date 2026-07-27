import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { CodexAppServerClient, runCodexResume } from "./codex.js";
import { ThreadRelinkError } from "./errors.js";
import {
  ensureGitProjectId,
  excludeFolderIdentity,
  findGitRoot,
  gitShaExists,
  readGitProjectId,
  readProjectContext,
  removeGitProjectId,
  type GitProjectContext,
} from "./git.js";
import {
  existingFolderIdentityPaths,
  readFolderIdentity,
  removeFolderIdentity,
  writeFolderIdentity,
} from "./identity.js";
import { matchThreadToProject } from "./matcher.js";
import {
  canonicalizeExistingPath,
  isPathInside,
  normalizeAbsolutePath,
  pathKey,
  relativeToRoot,
} from "./path.js";
import { RegistryStore } from "./registry.js";
import type {
  HistoryAdapterFactory,
  ForgetProjectPreview,
  ForgetProjectResult,
  LinkEvidence,
  MatchDecision,
  ProjectProbe,
  ProjectRecord,
  RegistryFile,
  RelinkResult,
  SetupMode,
  SyncResult,
  ThreadLink,
  ThreadMetadata,
} from "./types.js";

export interface ThreadRelinkServiceOptions {
  registryHome?: string;
  legacyRegistryHome?: string;
  codexPath?: string;
  historyAdapterFactory?: HistoryAdapterFactory;
  now?: () => Date;
}

/** @deprecated Use ThreadRelinkServiceOptions. */
export type RepoRecallServiceOptions = ThreadRelinkServiceOptions;

function upsertProject(
  registry: RegistryFile,
  context: GitProjectContext,
  id: string,
  now: string,
  observedRoot: string,
): ProjectRecord {
  let project = registry.projects.find((candidate) => candidate.id === id);
  if (!project) {
    project = {
      id,
      name: basename(context.root),
      kind: context.kind,
      aliases: [],
      remotes: [],
      createdAt: now,
      updatedAt: now,
    };
    registry.projects.push(project);
  }

  project.name = basename(context.root);
  project.kind = context.kind;
  project.updatedAt = now;
  project.remotes = [...new Set([...project.remotes, ...context.remotes])].sort();

  for (const observedPath of new Set([context.root, observedRoot])) {
    const key = pathKey(observedPath);
    const alias = project.aliases.find((candidate) => candidate.key === key);
    if (alias) {
      alias.path = observedPath;
      alias.lastSeenAt = now;
    } else {
      project.aliases.push({
        path: observedPath,
        key,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }
  return project;
}

function upsertSnapshots(
  registry: RegistryFile,
  threads: ThreadMetadata[],
): void {
  const snapshots = new Map(registry.threads.map((thread) => [thread.id, thread]));
  for (const thread of threads) {
    snapshots.set(thread.id, thread);
  }
  registry.threads = [...snapshots.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

function makeThreadLink(
  decision: MatchDecision,
  projectId: string,
  now: string,
  existing?: ThreadLink,
): ThreadLink {
  return {
    provider: "codex",
    threadId: decision.thread.id,
    projectId,
    linkedBy: existing?.linkedBy === "manual" ? "manual" : "automatic",
    originalCwd: decision.thread.cwd,
    relativeCwd: decision.relativeCwd,
    evidence:
      existing?.linkedBy === "manual"
        ? existing.evidence
        : decision.evidence,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export class ThreadRelinkService {
  public readonly registry: RegistryStore;
  public readonly codexPath?: string;
  private readonly historyAdapterFactory: HistoryAdapterFactory;
  private readonly now: () => Date;

  public constructor(options: ThreadRelinkServiceOptions = {}) {
    this.registry = new RegistryStore(
      options.registryHome,
      options.legacyRegistryHome,
    );
    this.codexPath = options.codexPath;
    this.historyAdapterFactory =
      options.historyAdapterFactory
      ?? (() => CodexAppServerClient.start({ codexPath: this.codexPath }));
    this.now = options.now ?? (() => new Date());
  }

  public async probeProject(inputPath = process.cwd()): Promise<ProjectProbe> {
    const workspacePath = await canonicalizeExistingPath(inputPath);
    const [registry, folderIdentity, gitRoot] = await Promise.all([
      this.registry.read(),
      readFolderIdentity(workspacePath),
      findGitRoot(workspacePath),
    ]);
    const gitProjectId = gitRoot ? await readGitProjectId(gitRoot) : null;

    if (folderIdentity) {
      const project = registry.projects.find(
        (candidate) => candidate.id === folderIdentity.projectId,
      ) ?? null;
      if (project) {
        if (
          project.kind === "git"
          && (!gitRoot || gitProjectId !== folderIdentity.projectId)
        ) {
          throw new ThreadRelinkError(
            "PROJECT_IDENTITY_CONFLICT",
            `Folder identity ${folderIdentity.projectId} does not match its parent Git repository.`,
          );
        }
        return {
          state: "ready",
          workspacePath,
          gitRoot: project.kind === "git" ? gitRoot : null,
          projectId: project.id,
          project,
          parentProject: null,
          identitySource: "folder-file",
        };
      }
      return {
        state: "uninitialized",
        workspacePath,
        gitRoot,
        projectId: folderIdentity.projectId,
        project: null,
        parentProject: null,
        identitySource: "folder-file",
      };
    }

    if (gitRoot && pathKey(gitRoot) === pathKey(workspacePath)) {
      const project = gitProjectId
        ? registry.projects.find((candidate) => candidate.id === gitProjectId) ?? null
        : null;
      return {
        state: project ? "ready" : "uninitialized",
        workspacePath,
        gitRoot,
        projectId: gitProjectId,
        project,
        parentProject: null,
        identitySource: gitProjectId ? "git-config" : null,
      };
    }

    if (gitRoot) {
      const parentProject = gitProjectId
        ? registry.projects.find((candidate) => candidate.id === gitProjectId) ?? null
        : null;
      return {
        state: "parent-choice-required",
        workspacePath,
        gitRoot,
        projectId: gitProjectId,
        project: null,
        parentProject,
        identitySource: null,
      };
    }

    return {
      state: "uninitialized",
      workspacePath,
      gitRoot: null,
      projectId: null,
      project: null,
      parentProject: null,
      identitySource: null,
    };
  }

  public async setupProject(
    inputPath = process.cwd(),
    mode?: SetupMode,
  ): Promise<ProjectRecord> {
    const probe = await this.probeProject(inputPath);
    if (probe.state === "ready" && probe.project) {
      return probe.project;
    }

    const selectedMode = mode
      ?? (
        probe.gitRoot && pathKey(probe.gitRoot) === pathKey(probe.workspacePath)
          ? "git-root"
          : probe.gitRoot
            ? null
            : "directory"
      );
    if (!selectedMode) {
      throw new ThreadRelinkError(
        "PARENT_GIT_REQUIRES_CHOICE",
        `This folder is inside ${probe.gitRoot}. Choose the parent Git project or an independent directory identity.`,
      );
    }

    let context: GitProjectContext;
    let projectId: string;
    if (selectedMode === "git-root") {
      if (
        !probe.gitRoot
        || pathKey(probe.gitRoot) !== pathKey(probe.workspacePath)
      ) {
        throw new ThreadRelinkError(
          "NOT_GIT_ROOT",
          "The selected workspace is not a Git repository root.",
        );
      }
      projectId = await ensureGitProjectId(probe.gitRoot);
      context = await readProjectContext(probe.gitRoot);
    } else if (selectedMode === "parent-git") {
      if (
        !probe.gitRoot
        || pathKey(probe.gitRoot) === pathKey(probe.workspacePath)
      ) {
        throw new ThreadRelinkError(
          "NO_PARENT_GIT",
          "The selected workspace is not inside a parent Git repository.",
        );
      }
      projectId = await ensureGitProjectId(probe.gitRoot);
      await writeFolderIdentity(probe.workspacePath, projectId);
      await excludeFolderIdentity(probe.gitRoot, probe.workspacePath);
      context = await readProjectContext(probe.gitRoot);
    } else {
      const identity = await writeFolderIdentity(
        probe.workspacePath,
        probe.identitySource === "folder-file" && probe.projectId
          ? probe.projectId
          : randomUUID(),
      );
      projectId = identity.projectId;
      if (probe.gitRoot) {
        await excludeFolderIdentity(probe.gitRoot, probe.workspacePath);
      }
      context = {
        kind: "directory",
        root: probe.workspacePath,
        projectId,
        remotes: [],
        headSha: null,
      };
    }

    if (context.projectId !== projectId) {
      throw new ThreadRelinkError(
        "PROJECT_IDENTITY_CONFLICT",
        "The selected project identity changed during setup.",
      );
    }

    const timestamp = this.now().toISOString();
    const observedRoot = selectedMode === "parent-git"
      ? context.root
      : normalizeAbsolutePath(inputPath);
    let result: ProjectRecord | null = null;
    await this.registry.update((draft) => {
      result = structuredClone(
        upsertProject(draft, context, projectId, timestamp, observedRoot),
      );
    });
    if (!result) {
      throw new ThreadRelinkError("PROJECT_INIT_FAILED", "Failed to initialize project.");
    }
    return result;
  }

  public async initProject(inputPath = process.cwd()): Promise<ProjectRecord> {
    return this.setupProject(inputPath);
  }

  private async readyProject(
    inputPath: string,
  ): Promise<{ project: ProjectRecord; context: GitProjectContext }> {
    const probe = await this.probeProject(inputPath);
    if (probe.state !== "ready" || !probe.project || !probe.projectId) {
      const detail = probe.state === "parent-choice-required"
        ? ` This folder is inside ${probe.gitRoot}; set it up explicitly first.`
        : " Set up this project first.";
      throw new ThreadRelinkError(
        "PROJECT_NOT_INITIALIZED",
        `ThreadRelink is not enabled for ${probe.workspacePath}.${detail}`,
      );
    }

    let context: GitProjectContext;
    if (probe.project.kind === "git") {
      if (!probe.gitRoot) {
        throw new ThreadRelinkError(
          "PROJECT_IDENTITY_CONFLICT",
          "The linked Git repository is no longer available.",
        );
      }
      context = await readProjectContext(probe.gitRoot);
      if (context.projectId !== probe.projectId) {
        throw new ThreadRelinkError(
          "PROJECT_IDENTITY_CONFLICT",
          "The Git project ID no longer matches the ThreadRelink registry.",
        );
      }
    } else {
      context = {
        kind: "directory",
        root: probe.workspacePath,
        projectId: probe.projectId,
        remotes: [],
        headSha: null,
      };
    }

    const timestamp = this.now().toISOString();
    const observedRoot =
      probe.project.kind === "git"
      && probe.identitySource === "folder-file"
        ? context.root
        : normalizeAbsolutePath(inputPath);
    let project = probe.project;
    await this.registry.update((draft) => {
      project = structuredClone(
        upsertProject(
          draft,
          context,
          probe.projectId as string,
          timestamp,
          observedRoot,
        ),
      );
    });
    return { project, context };
  }

  public async sync(inputPath = process.cwd()): Promise<SyncResult> {
    const { project, context } = await this.readyProject(inputPath);
    const adapter = await this.historyAdapterFactory();
    let threads: ThreadMetadata[];
    try {
      threads = await adapter.listThreads({ includeArchived: true });
    } finally {
      await adapter.close();
    }

    const registry = await this.registry.read();
    const linkByThread = new Map(
      registry.threadLinks.map((link) => [link.threadId, link]),
    );
    const shaCache = new Map<string, Promise<boolean>>();
    const shaExists = (sha: string): Promise<boolean> => {
      const existing = shaCache.get(sha);
      if (existing) {
        return existing;
      }
      const check = context.kind === "git"
        ? gitShaExists(context.root, sha)
        : Promise.resolve(false);
      shaCache.set(sha, check);
      return check;
    };

    const decisions = await Promise.all(
      threads.map((thread) =>
        matchThreadToProject(thread, {
          project,
          existingLink: linkByThread.get(thread.id) ?? null,
          gitRoot: context.kind === "git" ? context.root : null,
          shaExists,
        })
      ),
    );

    const timestamp = this.now().toISOString();
    await this.registry.update((draft) => {
      upsertSnapshots(draft, threads);
      const links = new Map(
        draft.threadLinks.map((link) => [link.threadId, link]),
      );
      for (const linked of decisions.filter((item) => item.status === "linked")) {
        const existing = links.get(linked.thread.id);
        const updated = makeThreadLink(linked, project.id, timestamp, existing);
        links.set(linked.thread.id, updated);
      }
      draft.threadLinks = [...links.values()];
    });

    return {
      project,
      linked: decisions.filter((item) => item.status === "linked"),
      suggested: decisions.filter((item) => item.status === "suggested"),
      unlinked: decisions.filter((item) => item.status === "unlinked"),
      scannedAt: timestamp,
    };
  }

  public async linkThread(
    threadId: string,
    inputPath = process.cwd(),
  ): Promise<ThreadLink> {
    const { project } = await this.readyProject(inputPath);
    let registry = await this.registry.read();
    if (!registry.threads.some((thread) => thread.id === threadId)) {
      await this.sync(inputPath);
      registry = await this.registry.read();
    }
    const thread = registry.threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      throw new ThreadRelinkError(
        "THREAD_NOT_FOUND",
        `Codex conversation not found: ${threadId}`,
      );
    }

    const timestamp = this.now().toISOString();
    const evidence: LinkEvidence[] = [
      {
        kind: "manual",
        confidence: 1,
        description: "User explicitly linked this conversation.",
      },
    ];
    const matchingAlias = project.aliases.find((alias) =>
      isPathInside(thread.cwd, alias.path)
    );
    const link: ThreadLink = {
      provider: "codex",
      threadId,
      projectId: project.id,
      linkedBy: "manual",
      originalCwd: thread.cwd,
      relativeCwd: matchingAlias
        ? relativeToRoot(thread.cwd, matchingAlias.path)
        : null,
      evidence,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.registry.update((draft) => {
      const existing = draft.threadLinks.find(
        (candidate) => candidate.threadId === threadId,
      );
      if (existing) {
        link.createdAt = existing.createdAt;
      }
      draft.threadLinks = draft.threadLinks.filter(
        (candidate) => candidate.threadId !== threadId,
      );
      draft.threadLinks.push(link);
    });
    return link;
  }

  public async relink(
    fromPath: string,
    toPath = process.cwd(),
  ): Promise<RelinkResult> {
    const { project } = await this.readyProject(toPath);
    const oldPath = normalizeAbsolutePath(fromPath);
    const newPath = await canonicalizeExistingPath(toPath);
    const timestamp = this.now().toISOString();
    let linkedThreads = 0;
    let updatedProject: ProjectRecord | null = null;

    await this.registry.update((draft) => {
      const target = draft.projects.find((candidate) => candidate.id === project.id);
      if (!target) {
        throw new ThreadRelinkError("PROJECT_NOT_FOUND", "Target project disappeared.");
      }

      const oldKey = pathKey(oldPath);
      const alias = target.aliases.find((candidate) => candidate.key === oldKey);
      if (alias) {
        alias.lastSeenAt = timestamp;
      } else {
        target.aliases.push({
          path: oldPath,
          key: oldKey,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
        });
      }
      target.updatedAt = timestamp;

      for (const thread of draft.threads.filter((candidate) =>
        isPathInside(candidate.cwd, oldPath)
      )) {
        const existing = draft.threadLinks.find(
          (candidate) => candidate.threadId === thread.id,
        );
        const link: ThreadLink = {
          provider: "codex",
          threadId: thread.id,
          projectId: target.id,
          linkedBy: "manual",
          originalCwd: thread.cwd,
          relativeCwd: relativeToRoot(thread.cwd, oldPath),
          evidence: [
            {
              kind: "manual",
              confidence: 1,
              description: `User relinked ${oldPath} to ${newPath}.`,
            },
          ],
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        draft.threadLinks = draft.threadLinks.filter(
          (candidate) => candidate.threadId !== thread.id,
        );
        draft.threadLinks.push(link);
        linkedThreads += 1;
      }
      updatedProject = structuredClone(target);
    });

    if (!updatedProject) {
      throw new ThreadRelinkError("RELINK_FAILED", "Failed to relink project.");
    }
    return {
      project: updatedProject,
      oldPath,
      newPath,
      linkedThreads,
    };
  }

  public async resume(
    threadId: string,
    cwd = process.cwd(),
  ): Promise<number> {
    const target = await canonicalizeExistingPath(cwd);
    return runCodexResume(threadId, target, { codexPath: this.codexPath });
  }

  public async listProjects(): Promise<ProjectRecord[]> {
    return (await this.registry.read()).projects;
  }

  public async previewForgetProject(
    projectId: string,
    workspacePaths: string[] = [],
  ): Promise<ForgetProjectPreview> {
    const registry = await this.registry.read();
    const project = registry.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) {
      throw new ThreadRelinkError(
        "PROJECT_NOT_FOUND",
        `ThreadRelink project not found: ${projectId}`,
      );
    }
    const identityPaths = new Set<string>();
    for (const alias of project.aliases) {
      if (
        project.kind === "git"
        && await readGitProjectId(alias.path).catch(() => null) === projectId
      ) {
        identityPaths.add(`${alias.path}/.git/config`);
      }
      const folderIdentity = await readFolderIdentity(alias.path)
        .catch(() => null);
      if (folderIdentity?.projectId === projectId) {
        for (
          const path of await existingFolderIdentityPaths(alias.path, projectId)
        ) {
          identityPaths.add(path);
        }
      }
    }
    for (const workspacePath of workspacePaths) {
      const folderIdentity = await readFolderIdentity(workspacePath)
        .catch(() => null);
      if (folderIdentity?.projectId === projectId) {
        for (
          const path of await existingFolderIdentityPaths(
            workspacePath,
            projectId,
          )
        ) {
          identityPaths.add(path);
        }
      }
    }
    return {
      project,
      linkedThreads: registry.threadLinks.filter(
        (link) => link.projectId === projectId,
      ).length,
      identityPaths: [...identityPaths],
    };
  }

  public async forgetProject(
    projectId: string,
    workspacePaths: string[] = [],
  ): Promise<ForgetProjectResult> {
    const preview = await this.previewForgetProject(projectId, workspacePaths);
    const removedIdentityPaths: string[] = [];
    for (const alias of preview.project.aliases) {
      if (
        preview.project.kind === "git"
        && await removeGitProjectId(alias.path, projectId).catch(() => false)
      ) {
        removedIdentityPaths.push(`${alias.path}/.git/config`);
      }
      const folderPaths = await existingFolderIdentityPaths(
        alias.path,
        projectId,
      ).catch(() => []);
      if (await removeFolderIdentity(alias.path, projectId).catch(() => false)) {
        removedIdentityPaths.push(...folderPaths);
      }
    }
    for (const workspacePath of workspacePaths) {
      const folderPaths = await existingFolderIdentityPaths(
        workspacePath,
        projectId,
      ).catch(() => []);
      if (
        await removeFolderIdentity(workspacePath, projectId).catch(() => false)
      ) {
        removedIdentityPaths.push(...folderPaths);
      }
    }
    await this.registry.update((draft) => {
      draft.projects = draft.projects.filter(
        (project) => project.id !== projectId,
      );
      draft.threadLinks = draft.threadLinks.filter(
        (link) => link.projectId !== projectId,
      );
    });
    return {
      projectId,
      removedLinks: preview.linkedThreads,
      removedIdentityPaths: [...new Set(removedIdentityPaths)],
    };
  }
}

/** @deprecated Use ThreadRelinkService. */
export { ThreadRelinkService as RepoRecallService };
