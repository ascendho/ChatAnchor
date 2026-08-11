import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readGitProjectId,
  removeGitProjectId,
} from "../src/git.js";
import {
  readFolderIdentity,
  removeFolderIdentity,
} from "../src/identity.js";
import { ThreadRelinkService } from "../src/service.js";
import type {
  HistoryAdapter,
  ThreadMetadata,
} from "../src/types.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];
let originalOpenCodeHome: string | undefined;

beforeEach(async () => {
  originalOpenCodeHome = process.env.THREADRELINK_OPENCODE_HOME;
  const emptyOpenCodeHome = await mkdtemp(join(tmpdir(), "threadrelink-opencode-test-"));
  cleanup.push(emptyOpenCodeHome);
  process.env.THREADRELINK_OPENCODE_HOME = emptyOpenCodeHome;
});

afterEach(async () => {
  if (originalOpenCodeHome === undefined) {
    delete process.env.THREADRELINK_OPENCODE_HOME;
  } else {
    process.env.THREADRELINK_OPENCODE_HOME = originalOpenCodeHome;
  }
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

function adapterFor(threads: ThreadMetadata[]): HistoryAdapter {
  return {
    listThreads: async () => threads,
    close: async () => undefined,
  };
}

describe("ThreadRelinkService", () => {
  it("migrates a legacy Git project ID without changing its UUID", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-legacy-git-"));
    cleanup.push(base);
    const root = join(base, "project");
    const projectId = "9d8e0147-9995-4364-b3bd-b86b57e8c890";
    await mkdir(root);
    await execFileAsync("git", ["init", root]);
    await execFileAsync("git", [
      "-C",
      root,
      "config",
      "--local",
      "reporecall.projectId",
      projectId,
    ]);

    expect(await readGitProjectId(root)).toBe(projectId);
    expect(
      (
        await execFileAsync("git", [
          "-C",
          root,
          "config",
          "--local",
          "--get",
          "threadrelink.projectId",
        ])
      ).stdout.trim(),
    ).toBe(projectId);
    expect(await removeGitProjectId(root, projectId)).toBe(true);
    for (const key of ["threadrelink.projectId", "reporecall.projectId"]) {
      await expect(
        execFileAsync("git", [
          "-C",
          root,
          "config",
          "--local",
          "--get",
          key,
        ]),
      ).rejects.toBeDefined();
    }
  });

  it("copies a legacy directory identity into .threadrelink", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-legacy-folder-"));
    cleanup.push(base);
    const workspace = join(base, "project");
    const legacyDirectory = join(workspace, ".reporecall");
    const projectId = "98b11d61-c073-43e2-ac3a-495499cab470";
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(
      join(legacyDirectory, "project.json"),
      `${JSON.stringify({ schemaVersion: 1, projectId })}\n`,
      "utf8",
    );

    expect(await readFolderIdentity(workspace)).toMatchObject({ projectId });
    expect(
      JSON.parse(
        await readFile(
          join(workspace, ".threadrelink", "project.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ projectId });
    expect(await removeFolderIdentity(workspace, projectId)).toBe(true);
    await expect(
      access(join(workspace, ".threadrelink", "project.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(join(workspace, ".reporecall", "project.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps conversations linked after a Git project directory is renamed", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-rename-"));
    cleanup.push(base);
    const oldRoot = join(base, "ToolSpec");
    const newRoot = join(base, "FinSpec");
    const registryHome = join(base, "state");
    await mkdir(oldRoot);
    await execFileAsync("git", ["init", oldRoot]);

    const oldThread: ThreadMetadata = {
      provider: "codex",
      id: "019f88a4-1b7c-75c2-b699-99b7f46946ab",
      name: "Explain ToolSpec",
      preview: "Explain ToolSpec",
      cwd: oldRoot,
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
    };
    const service = new ThreadRelinkService({
      registryHome,
      historyAdapterFactory: async () => adapterFor([oldThread]),
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    const original = await service.initProject(oldRoot);
    await service.sync(oldRoot);
    const canonicalNewParent = await realpath(base);
    await rename(oldRoot, newRoot);
    const result = await service.sync(newRoot);

    expect(result.project.id).toBe(original.id);
    expect(result.linked.map((item) => item.thread.id)).toContain(oldThread.id);
    expect(result.project.aliases.map((alias) => alias.path))
      .toEqual(expect.arrayContaining([
        oldRoot,
        join(canonicalNewParent, "FinSpec"),
      ]));
  });

  it("merges OpenCode sessions into the sync result and links them", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-opencode-sync-"));
    cleanup.push(base);
    const root = join(base, "OpenSpec");
    const registryHome = join(base, "state");
    const openCodeHome = join(base, "opencode-home");
    await mkdir(root);
    await mkdir(openCodeHome);
    await execFileAsync("git", ["init", root]);

    const database = new DatabaseSync(join(openCodeHome, "opencode.db"));
    try {
      database.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          parent_id TEXT,
          directory TEXT NOT NULL,
          title TEXT NOT NULL,
          version TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          time_archived INTEGER
        );
      `);
      database.prepare(
        "INSERT INTO project (id, worktree) VALUES (?, ?)",
      ).run("project-1", root);
      database.prepare(
        `INSERT INTO session
           (id, project_id, parent_id, directory, title, version,
            time_created, time_updated, time_archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "ses_01",
        "project-1",
        null,
        root,
        "OpenSpec session",
        "1.18.14",
        1_700_000_000_000,
        1_700_000_300_000,
        null,
      );
      database.prepare(
        `INSERT INTO session
           (id, project_id, parent_id, directory, title, version,
            time_created, time_updated, time_archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "ses_02",
        "project-1",
        "ses_01",
        root,
        "Subagent session",
        "1.18.14",
        1_700_000_100_000,
        1_700_000_200_000,
        null,
      );
    } finally {
      database.close();
    }

    const service = new ThreadRelinkService({
      registryHome,
      openCodeHome,
      historyAdapterFactory: async () => adapterFor([]),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });
    await service.initProject(root);
    const result = await service.sync(root);

    expect(result.linked.map((item) => item.thread.id)).toEqual(["ses_01"]);
    expect(result.linked[0]?.thread).toMatchObject({
      provider: "opencode",
      cliVersion: "1.18.14",
    });
  }, 20_000);

  it("resolves OpenCode resume targets after a project directory is renamed", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-opencode-move-"));
    cleanup.push(base);
    const oldRoot = join(base, "threadrelink");
    const newRoot = join(base, "ChatAnchor");
    const registryHome = join(base, "state");
    const openCodeHome = join(base, "opencode-home");
    await mkdir(oldRoot);
    await mkdir(openCodeHome);
    await execFileAsync("git", ["init", oldRoot]);

    const database = new DatabaseSync(join(openCodeHome, "opencode.db"));
    try {
      database.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          parent_id TEXT,
          directory TEXT NOT NULL,
          title TEXT NOT NULL,
          version TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          time_archived INTEGER
        );
      `);
      database.prepare(
        "INSERT INTO project (id, worktree) VALUES (?, ?)",
      ).run("project-1", oldRoot);
      database.prepare(
        `INSERT INTO session
           (id, project_id, parent_id, directory, title, version,
            time_created, time_updated, time_archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "ses_rename",
        "project-1",
        null,
        oldRoot,
        "OpenCode moved project",
        "1.18.14",
        1_700_000_000_000,
        1_700_000_300_000,
        null,
      );
    } finally {
      database.close();
    }

    const service = new ThreadRelinkService({
      registryHome,
      openCodeHome,
      historyAdapterFactory: async () => adapterFor([]),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });
    await service.setupProject(oldRoot);
    expect((await service.sync(oldRoot)).linked.map((item) => item.thread.id))
      .toContain("ses_rename");

    await rename(oldRoot, newRoot);
    const moved = await service.sync(newRoot);
    const target = await service.resolveResumeTarget(
      "ses_rename",
      newRoot,
      "opencode",
    );

    expect(moved.linked.map((item) => item.thread.id)).toContain("ses_rename");
    expect(target).toMatchObject({
      path: await realpath(newRoot),
      mode: "project-root",
      warning: null,
    });
  }, 20_000);

  it("moves a stale automatic link when the current project has stronger evidence", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-stale-link-"));
    cleanup.push(base);
    const root = join(base, "internship-notes");
    const registryHome = join(base, "state");
    await mkdir(root);
    await execFileAsync("git", ["init", root]);

    const conversation: ThreadMetadata = {
      provider: "codex",
      id: "thread-stale-parent",
      name: "Internship notes",
      preview: "Internship notes",
      cwd: root,
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
    };
    const service = new ThreadRelinkService({
      registryHome,
      historyAdapterFactory: async () => adapterFor([conversation]),
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    });
    const currentProject = await service.initProject(root);
    const originalCreatedAt = "2026-07-27T00:00:00.000Z";
    await service.registry.update((draft) => {
      draft.projects.push({
        id: "legacy-parent",
        name: "home",
        kind: "git",
        aliases: [{
          path: base,
          key: base,
          firstSeenAt: originalCreatedAt,
          lastSeenAt: originalCreatedAt,
        }],
        remotes: [],
        createdAt: originalCreatedAt,
        updatedAt: originalCreatedAt,
      });
      draft.threadLinks.push({
        provider: "codex",
        threadId: conversation.id,
        projectId: "legacy-parent",
        linkedBy: "automatic",
        originalCwd: conversation.cwd,
        relativeCwd: "internship-notes",
        evidence: [{
          kind: "path-alias",
          confidence: 1,
          description: "Legacy parent path match.",
        }],
        createdAt: originalCreatedAt,
        updatedAt: originalCreatedAt,
      });
    });

    const result = await service.sync(root);
    const repairedLink = (await service.registry.read()).threadLinks.find(
      (candidate) => candidate.threadId === conversation.id,
    );

    expect(result.linked.map((item) => item.thread.id))
      .toContain(conversation.id);
    expect(repairedLink).toMatchObject({
      projectId: currentProject.id,
      linkedBy: "automatic",
      createdAt: originalCreatedAt,
      evidence: [{ kind: "path-alias" }],
    });
  });

  it("persists an explicit relink for an otherwise unverifiable move", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-relink-"));
    cleanup.push(base);
    const target = join(base, "FinSpec");
    const oldRoot = join(base, "ToolSpec");
    await mkdir(target);
    await execFileAsync("git", ["init", target]);

    const oldThread: ThreadMetadata = {
      provider: "codex",
      id: "thread-manual",
      name: "Old conversation",
      preview: "Old conversation",
      cwd: oldRoot,
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
    };
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => adapterFor([oldThread]),
    });
    await service.setupProject(target);
    await service.sync(target);
    const result = await service.relink(oldRoot, target);

    expect(result.linkedThreads).toBe(1);
    expect((await service.registry.read()).threadLinks[0]).toMatchObject({
      threadId: oldThread.id,
      projectId: result.project.id,
      linkedBy: "manual",
    });
  });

  it("does not initialize or scan a workspace nested in a parent Git repository", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-parent-boundary-"));
    cleanup.push(base);
    const parent = join(base, "parent");
    const workspace = join(parent, "test");
    await mkdir(workspace, { recursive: true });
    await execFileAsync("git", ["init", parent]);
    let scans = 0;
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => ({
        listThreads: async () => {
          scans += 1;
          return [];
        },
        close: async () => undefined,
      }),
    });

    const probe = await service.probeProject(workspace);

    expect(probe).toMatchObject({
      state: "parent-choice-required",
      workspacePath: await realpath(workspace),
      gitRoot: await realpath(parent),
      projectId: null,
    });
    await expect(service.sync(workspace)).rejects.toMatchObject({
      code: "PROJECT_NOT_INITIALIZED",
    });
    expect(scans).toBe(0);
    await expect(
      execFileAsync("git", [
        "-C",
        parent,
        "config",
        "--local",
        "--get",
        "threadrelink.projectId",
      ]),
    ).rejects.toBeDefined();
  });

  it("can explicitly treat a nested workspace as an independent directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-independent-"));
    cleanup.push(base);
    const parent = join(base, "parent");
    const workspace = join(parent, "test");
    await mkdir(workspace, { recursive: true });
    await execFileAsync("git", ["init", parent]);
    const threads: ThreadMetadata[] = [
      {
        provider: "codex",
        id: "thread-test",
        name: "Test conversation",
        preview: "Test conversation",
        cwd: workspace,
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        cliVersion: "0.145.0",
        modelProvider: "openai",
        gitInfo: null,
      },
      {
        provider: "codex",
        id: "thread-parent",
        name: "Parent conversation",
        preview: "Parent conversation",
        cwd: parent,
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        cliVersion: "0.145.0",
        modelProvider: "openai",
        gitInfo: null,
      },
    ];
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => adapterFor(threads),
    });

    const project = await service.setupProject(workspace, "directory");
    const result = await service.sync(workspace);

    expect(project.kind).toBe("directory");
    expect(result.linked.map((item) => item.thread.id)).toEqual(["thread-test"]);
    expect(result.unlinked.map((item) => item.thread.id))
      .toEqual(["thread-parent"]);
    expect(
      JSON.parse(
        await readFile(join(workspace, ".threadrelink", "project.json"), "utf8"),
      ),
    ).toMatchObject({ schemaVersion: 1, projectId: project.id });
    expect(await readFile(join(parent, ".git", "info", "exclude"), "utf8"))
      .toContain("/test/.threadrelink/");
    await expect(
      execFileAsync("git", [
        "-C",
        parent,
        "config",
        "--local",
        "--get",
        "threadrelink.projectId",
      ]),
    ).rejects.toBeDefined();
  });

  it("resolves resume targets for linked Cursor conversations", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-cursor-resume-"));
    cleanup.push(base);
    const root = join(base, "project");
    const cursorHome = join(base, "cursor-home");
    await mkdir(root);
    await execFileAsync("git", ["init", root]);
    const canonicalRoot = await realpath(root);
    const chatId = "a4efc723-68f4-45f5-8474-952597e995e8";
    const { cursorChatBucketId } = await import("../src/cursor.js");
    const chatDir = join(
      cursorHome,
      "chats",
      cursorChatBucketId(canonicalRoot),
      chatId,
    );
    await mkdir(chatDir, { recursive: true });
    await writeFile(
      join(chatDir, "meta.json"),
      JSON.stringify({
        hasConversation: true,
        title: "Project Conversation Location",
        cwd: canonicalRoot,
        createdAtMs: 1_700_000_000_000,
        updatedAtMs: 1_700_000_100_000,
      }),
    );
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => adapterFor([]),
      cursorHome,
    });
    await service.setupProject(root);
    const synced = await service.sync(root);
    expect(synced.linked.some((item) =>
      item.thread.provider === "cursor" && item.thread.id === chatId
    )).toBe(true);
    const target = await service.resolveResumeTarget(chatId, root, "cursor");
    expect(target).toMatchObject({
      path: canonicalRoot,
      mode: "project-root",
      warning: null,
    });
  });

  it("reports a new project location and resumes from the preserved subdirectory", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-subdirectory-"));
    cleanup.push(base);
    const oldRoot = join(base, "ToolSpec");
    const oldSubdirectory = join(oldRoot, "packages", "api");
    const newRoot = join(base, "FinSpec");
    const newSubdirectory = join(newRoot, "packages", "api");
    await mkdir(oldSubdirectory, { recursive: true });
    await execFileAsync("git", ["init", oldRoot]);
    const thread: ThreadMetadata = {
      provider: "codex",
      id: "thread-subdirectory",
      name: "Implement the API",
      preview: "Implement the API",
      cwd: oldSubdirectory,
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
    };
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => adapterFor([thread]),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });

    await service.setupProject(oldRoot);
    expect((await service.sync(oldRoot)).relocationReport).toBeNull();
    const canonicalOldRoot = await realpath(oldRoot);
    await rename(oldRoot, newRoot);
    const moved = await service.sync(newRoot);
    const target = await service.resolveResumeTarget(thread.id, newRoot);

    expect(moved.relocationReport).toMatchObject({
      previousPath: canonicalOldRoot,
      currentPath: await realpath(newRoot),
      linkedThreads: 1,
      preservedSubdirectories: 1,
      fallbackThreads: 0,
    });
    expect(moved.relocationReport?.conversations[0]).toMatchObject({
      threadId: thread.id,
      relativeCwd: "packages/api",
      targetPath: await realpath(newSubdirectory),
      targetMode: "preserved-subdirectory",
    });
    expect(target).toMatchObject({
      path: await realpath(newSubdirectory),
      relativeCwd: "packages/api",
      mode: "preserved-subdirectory",
      warning: null,
    });
    expect((await service.sync(newRoot)).relocationReport).toBeNull();
  });

  it("falls back to the project root when a recorded subdirectory is missing or unsafe", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-resume-fallback-"));
    cleanup.push(base);
    const root = join(base, "project");
    const subdirectory = join(root, "packages", "api");
    await mkdir(subdirectory, { recursive: true });
    await execFileAsync("git", ["init", root]);
    const thread: ThreadMetadata = {
      provider: "codex",
      id: "thread-fallback",
      name: "Fallback",
      preview: "Fallback",
      cwd: subdirectory,
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
    };
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => adapterFor([thread]),
    });

    await service.setupProject(root);
    await service.sync(root);
    await rm(subdirectory, { recursive: true });
    expect(await service.resolveResumeTarget(thread.id, root)).toMatchObject({
      path: await realpath(root),
      mode: "missing-subdirectory-fallback",
    });

    const outside = join(base, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      subdirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await service.resolveResumeTarget(thread.id, root)).toMatchObject({
      path: await realpath(root),
      mode: "unsafe-subdirectory-fallback",
    });
    await rm(subdirectory);

    await writeFile(subdirectory, "not a directory", "utf8");
    expect(await service.resolveResumeTarget(thread.id, root)).toMatchObject({
      path: await realpath(root),
      mode: "not-directory-fallback",
    });

    await service.registry.update((draft) => {
      const link = draft.threadLinks.find((item) => item.threadId === thread.id);
      if (link) {
        link.relativeCwd = "../../outside";
      }
    });
    expect(await service.resolveResumeTarget(thread.id, root)).toMatchObject({
      path: await realpath(root),
      mode: "unsafe-subdirectory-fallback",
    });
  });

  it("persists ignore, move, and restore decisions without automatic relinking", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-correction-"));
    cleanup.push(base);
    const projectAPath = join(base, "project-a");
    const projectBPath = join(base, "project-b");
    await mkdir(projectAPath);
    await mkdir(projectBPath);
    const thread: ThreadMetadata = {
      provider: "codex",
      id: "thread-correction",
      name: "Correct project",
      preview: "Correct project",
      cwd: projectAPath,
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
    };
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => adapterFor([thread]),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });
    const projectA = await service.setupProject(projectAPath, "directory");
    const projectB = await service.setupProject(projectBPath, "directory");
    await service.sync(projectAPath);

    const moved = await service.linkThreadToProject(thread.id, projectB.id);
    expect(moved).toMatchObject({
      previousProjectId: projectA.id,
      currentProjectId: projectB.id,
      link: {
        projectId: projectB.id,
        linkedBy: "manual",
      },
    });
    expect(moved.exclusionProjectIds).toContain(projectA.id);
    expect((await service.sync(projectAPath)).ignored).toHaveLength(1);
    expect((await service.sync(projectBPath)).linked.map((item) => item.thread.id))
      .toEqual([thread.id]);

    const restored = await service.linkThreadToProject(thread.id, projectA.id);
    expect(restored.exclusionProjectIds).not.toContain(projectA.id);
    expect(restored.exclusionProjectIds).toContain(projectB.id);
    expect((await service.sync(projectAPath)).linked.map((item) => item.thread.id))
      .toEqual([thread.id]);
    expect((await service.sync(projectBPath)).ignored.map((item) => item.thread.id))
      .toEqual([thread.id]);

    await service.ignoreThreadForProject(thread.id, projectA.id);
    expect((await service.sync(projectAPath)).ignored.map((item) => item.thread.id))
      .toEqual([thread.id]);
    const relinked = await service.linkThreadToProject(thread.id, projectA.id);
    expect(relinked.exclusionProjectIds).not.toContain(projectA.id);
    expect((await service.sync(projectAPath)).linked.map((item) => item.thread.id))
      .toEqual([thread.id]);
  });

  it("forgets ThreadRelink links and identities without deleting thread snapshots", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-forget-"));
    cleanup.push(base);
    const root = join(base, "project");
    await mkdir(root);
    await execFileAsync("git", ["init", root]);
    const thread: ThreadMetadata = {
      provider: "codex",
      id: "thread-forget",
      name: "Keep transcript",
      preview: "Keep transcript",
      cwd: root,
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
    };
    const service = new ThreadRelinkService({
      registryHome: join(base, "state"),
      historyAdapterFactory: async () => adapterFor([thread]),
    });
    const project = await service.setupProject(root);
    await service.sync(root);

    const preview = await service.previewForgetProject(project.id);
    const result = await service.forgetProject(project.id);
    const registry = await service.registry.read();

    expect(preview.linkedThreads).toBe(1);
    expect(result.removedLinks).toBe(1);
    expect(registry.projects).toHaveLength(0);
    expect(registry.threadLinks).toHaveLength(0);
    expect(registry.threadExclusions).toHaveLength(0);
    expect(registry.threads.map((item) => item.id)).toEqual([thread.id]);
    await expect(
      execFileAsync("git", [
        "-C",
        root,
        "config",
        "--local",
        "--get",
        "threadrelink.projectId",
      ]),
    ).rejects.toBeDefined();
  });
});
