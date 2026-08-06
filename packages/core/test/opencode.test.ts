import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOpenCodeResumeArgs,
  listOpenCodeThreads,
  mapOpenCodeRowToThread,
  resolveOpenCodeHome,
  resolveOpenCodePath,
  resolveOpenCodeSessionDirectory,
} from "../src/opencode.js";
import { normalizeAbsolutePath } from "../src/path.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

function createFixtureDatabase(openCodeHome: string): void {
  const database = new DatabaseSync(join(openCodeHome, "opencode.db"));
  try {
    database.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        worktree TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
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
    const insertProject = database.prepare(
      "INSERT INTO project (id, worktree, time_created, time_updated) VALUES (?, ?, 0, 0)",
    );
    insertProject.run("project-old", normalizeAbsolutePath("/work/proj-old"));
    insertProject.run("project-global", normalizeAbsolutePath("/"));
    const insertSession = database.prepare(
      `INSERT INTO session
         (id, project_id, parent_id, directory, title, version,
          time_created, time_updated, time_archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertSession.run(
      "ses_recent",
      "project-global",
      null,
      normalizeAbsolutePath("/work/proj-old"),
      "Recent session",
      "1.18.14",
      1_700_000_200_000,
      1_700_000_900_000,
      null,
    );
    insertSession.run(
      "ses_archived",
      "project-old",
      null,
      normalizeAbsolutePath("/work/proj-old"),
      "Archived session",
      "1.17.0",
      1_700_000_000_000,
      1_700_000_500_000,
      1_700_000_800_000,
    );
    insertSession.run(
      "ses_subagent",
      "project-old",
      "ses_recent",
      normalizeAbsolutePath("/work/proj-old"),
      "Subagent session",
      "1.18.14",
      1_700_000_600_000,
      1_700_000_700_000,
      null,
    );
  } finally {
    database.close();
  }
}

describe("OpenCode adapter", () => {
  it("resolves the OpenCode home from env, XDG, then the default", () => {
    expect(resolveOpenCodePath()).toBe("opencode");
    expect(resolveOpenCodePath("/opt/opencode")).toBe("/opt/opencode");
    expect(resolveOpenCodeHome("/explicit/home")).toBe(
      normalizeAbsolutePath("/explicit/home"),
    );
  });

  it("builds resume args for opencode --session", () => {
    expect(buildOpenCodeResumeArgs("ses_01")).toEqual(["--session", "ses_01"]);
  });

  it("maps rows and filters subagents / missing cwds", () => {
    expect(mapOpenCodeRowToThread({
      id: "ses_01",
      directory: "/work/proj-old",
      worktree: "/work/proj-old",
      title: "Hello",
      version: "1.18.14",
      time_created: 1_700_000_000_000,
      time_updated: 1_700_000_100_000,
      time_archived: null,
      parent_id: null,
    })).toMatchObject({
      provider: "opencode",
      id: "ses_01",
      name: "Hello",
      cwd: normalizeAbsolutePath("/work/proj-old"),
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      archived: false,
      cliVersion: "1.18.14",
      modelProvider: "opencode",
    });

    expect(mapOpenCodeRowToThread({
      id: "ses_02",
      directory: "/work/proj-old",
      worktree: "/work/proj-old",
      title: "Archived",
      version: "1.17.0",
      time_created: 1_700_000_000_000,
      time_updated: 1_700_000_100_000,
      time_archived: 1_700_000_200_000,
      parent_id: null,
    })?.archived).toBe(true);

    expect(mapOpenCodeRowToThread({
      id: "ses_03",
      directory: null,
      worktree: "/work/proj-old",
      title: "Fallback cwd",
      version: "1.18.14",
      time_created: null,
      time_updated: null,
      time_archived: null,
      parent_id: null,
    })).toMatchObject({
      cwd: normalizeAbsolutePath("/work/proj-old"),
      createdAt: expect.any(Number),
    });

    expect(mapOpenCodeRowToThread({
      id: "ses_04",
      directory: null,
      worktree: null,
      title: "No cwd",
      version: "1.18.14",
      time_created: 1_700_000_000_000,
      time_updated: 1_700_000_100_000,
      time_archived: null,
      parent_id: null,
    })).toBeNull();
  });

  it("lists sessions from the local database, skipping subagents", async () => {
    const openCodeHome = await mkdtemp(join(tmpdir(), "threadrelink-opencode-"));
    cleanup.push(openCodeHome);
    createFixtureDatabase(openCodeHome);

    const threads = await listOpenCodeThreads({ openCodeHome });
    expect(threads.map((thread) => thread.id)).toEqual([
      "ses_recent",
      "ses_archived",
    ]);
    expect(threads[0]).toMatchObject({
      provider: "opencode",
      id: "ses_recent",
      name: "Recent session",
      cliVersion: "1.18.14",
      archived: false,
    });
    expect(threads[1]).toMatchObject({
      archived: true,
    });
    expect(threads[0]!.updatedAt).toBeGreaterThan(threads[1]!.updatedAt);
  });

  it("returns an empty list when the database is missing or unreadable", async () => {
    const openCodeHome = await mkdtemp(join(tmpdir(), "threadrelink-opencode-empty-"));
    cleanup.push(openCodeHome);
    await expect(listOpenCodeThreads({ openCodeHome })).resolves.toEqual([]);

    await writeFile(join(openCodeHome, "opencode.db"), "{broken", "utf8");
    await expect(listOpenCodeThreads({ openCodeHome })).resolves.toEqual([]);
  });

  it("resolves the stored session directory for resume pre-flight", async () => {
    const openCodeHome = await mkdtemp(join(tmpdir(), "threadrelink-opencode-resolve-"));
    cleanup.push(openCodeHome);
    createFixtureDatabase(openCodeHome);

    await expect(resolveOpenCodeSessionDirectory("ses_recent", { openCodeHome }))
      .resolves.toBe(normalizeAbsolutePath("/work/proj-old"));
    await expect(
      resolveOpenCodeSessionDirectory("ses_missing", { openCodeHome }),
    ).resolves.toBeNull();
  });
});
