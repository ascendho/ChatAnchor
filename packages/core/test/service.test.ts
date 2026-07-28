import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
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

afterEach(async () => {
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
    await rename(oldRoot, newRoot);
    const result = await service.sync(newRoot);

    expect(result.project.id).toBe(original.id);
    expect(result.linked.map((item) => item.thread.id)).toContain(oldThread.id);
    expect(result.project.aliases.map((alias) => alias.path))
      .toEqual(expect.arrayContaining([oldRoot, newRoot]));
  });

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
