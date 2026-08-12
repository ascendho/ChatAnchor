import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOpenCodeExportCommand,
  buildOpenCodeNewSessionArgs,
  buildOpenCodeResumeArgs,
  exportOpenCodeSessionToTempFile,
  listOpenCodeThreads,
  mapOpenCodeRowToThread,
  resolveOpenCodeHome,
  resolveOpenCodePath,
  resolveOpenCodeSessionDirectory,
} from "../src/opencode.js";
import { normalizeAbsolutePath } from "../src/path.js";

const cleanup: string[] = [];
const executableScriptTest = process.platform === "win32" ? it.skip : it;

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

function createExportFixtureDatabase(openCodeHome: string): void {
  const database = new DatabaseSync(join(openCodeHome, "opencode.db"));
  try {
    database.exec(`
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
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    database.prepare(
      `INSERT INTO session
         (id, project_id, parent_id, directory, title, version,
          time_created, time_updated, time_archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "ses_invalid",
      "project-one",
      null,
      normalizeAbsolutePath("/work/proj-old"),
      "Fallback export",
      "1.18.16",
      1_700_000_000_000,
      1_700_000_100_000,
      null,
    );
    database.prepare(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg_user",
      "ses_invalid",
      1_700_000_010_000,
      1_700_000_010_000,
      JSON.stringify({ role: "user" }),
    );
    database.prepare(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg_assistant",
      "ses_invalid",
      1_700_000_020_000,
      1_700_000_020_000,
      JSON.stringify({ role: "assistant", model: "test-model" }),
    );
    database.prepare(
      "INSERT INTO part (id, session_id, message_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "part_user_text",
      "ses_invalid",
      "msg_user",
      1_700_000_010_000,
      1_700_000_010_000,
      JSON.stringify({ type: "text", text: "Please carry this context." }),
    );
    database.prepare(
      "INSERT INTO part (id, session_id, message_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "part_assistant_text",
      "ses_invalid",
      "msg_assistant",
      1_700_000_020_000,
      1_700_000_020_000,
      JSON.stringify({ type: "text", text: "Fallback context is available." }),
    );
  } finally {
    database.close();
  }
}

async function writeFakeOpenCode(
  path: string,
  lines: string[],
): Promise<void> {
  await writeFile(path, [
    "#!/usr/bin/env node",
    ...lines,
    "",
  ].join("\n"), "utf8");
  await chmod(path, 0o755);
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
    expect(buildOpenCodeResumeArgs("ses_01", "/work/proj-new")).toEqual([
      normalizeAbsolutePath("/work/proj-new"),
      "--session",
      "ses_01",
    ]);
  });

  it("builds new session args for opencode project", () => {
    expect(buildOpenCodeNewSessionArgs("/work/proj-new")).toEqual([
      normalizeAbsolutePath("/work/proj-new"),
    ]);
  });

  it("builds POSIX OpenCode export commands without reading transcripts", () => {
    const command = buildOpenCodeExportCommand("ses ' one", {
      openCodePath: "/opt/open code/opencode",
      shell: "posix",
    });

    expect(command).toContain(
      "dir=\"$(mktemp -d \"${TMPDIR:-/tmp}/chatanchor-opencode.XXXXXX\")\"",
    );
    expect(command).toContain("file=\"$dir/chatanchor-opencode-ses_one.json\"");
    expect(command).toContain(
      "'/opt/open code/opencode' export 'ses '\\'' one' > \"$file\"",
    );
    expect(command).toContain("printf '@%s\\n' \"$file\"");
  });

  it("builds PowerShell OpenCode export commands", () => {
    const command = buildOpenCodeExportCommand("ses ' one", {
      openCodePath: "C:\\Program Files\\OpenCode\\opencode.exe",
      shell: "powershell",
    });

    expect(command).toContain(
      "$dir = Join-Path ([System.IO.Path]::GetTempPath())",
    );
    expect(command).toContain(
      "$file = Join-Path $dir 'chatanchor-opencode-ses_one.json'",
    );
    expect(command).toContain(
      "& 'C:\\Program Files\\OpenCode\\opencode.exe' export 'ses '' one' > $file",
    );
    expect(command).toContain("Write-Output \"@$file\"");
  });

  it("requires a session id for OpenCode export commands", () => {
    expect(() => buildOpenCodeExportCommand("   ")).toThrow(
      "An OpenCode session id is required",
    );
  });

  executableScriptTest("exports an OpenCode session to a stable @path", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "threadrelink-opencode-bin-"));
    const outputDir = await mkdtemp(
      join(tmpdir(), "threadrelink-opencode-export-"),
    );
    cleanup.push(binDir, outputDir);
    const fakeOpenCode = join(binDir, "opencode");
    await writeFakeOpenCode(fakeOpenCode, [
      "const [command, sessionId] = process.argv.slice(2);",
      "if (command !== 'export') { process.exit(2); }",
      "process.stdout.write(JSON.stringify({ sessionId, messages: ['history'] }));",
    ]);

    const result = await exportOpenCodeSessionToTempFile("ses/one", {
      baseDir: outputDir,
      openCodePath: fakeOpenCode,
    });

    const expectedPath = join(
      outputDir,
      "chatanchor-opencode-exports",
      "chatanchor-opencode-ses_one.json",
    );
    expect(result.filePath).toBe(expectedPath);
    expect(result.atPath).toBe(`@${result.filePath}`);
    expect(result.exportSource).toBe("cli");
    await expect(readFile(result.filePath, "utf8")).resolves.toBe(
      JSON.stringify({ sessionId: "ses/one", messages: ["history"] }),
    );
  });

  executableScriptTest("overwrites the same OpenCode export file", async () => {
    const binDir = await mkdtemp(
      join(tmpdir(), "threadrelink-opencode-overwrite-"),
    );
    const outputDir = await mkdtemp(
      join(tmpdir(), "threadrelink-opencode-export-overwrite-"),
    );
    cleanup.push(binDir, outputDir);
    const fakeOpenCode = join(binDir, "opencode");
    await writeFakeOpenCode(fakeOpenCode, [
      "process.stdout.write('{\"version\":1}');",
    ]);

    const first = await exportOpenCodeSessionToTempFile("ses_same", {
      baseDir: outputDir,
      openCodePath: fakeOpenCode,
    });
    await writeFakeOpenCode(fakeOpenCode, [
      "process.stdout.write('{\"version\":2}');",
    ]);
    const second = await exportOpenCodeSessionToTempFile("ses_same", {
      baseDir: outputDir,
      openCodePath: fakeOpenCode,
    });

    expect(second.filePath).toBe(first.filePath);
    await expect(readFile(second.filePath, "utf8")).resolves.toBe(
      "{\"version\":2}",
    );
  });

  executableScriptTest(
    "reports OpenCode export failures and preserves old exports",
    async () => {
      const binDir = await mkdtemp(join(
        tmpdir(),
        "threadrelink-opencode-fail-",
      ));
      const outputDir = await mkdtemp(
        join(tmpdir(), "threadrelink-opencode-export-fail-"),
      );
      cleanup.push(binDir, outputDir);
      const fakeOpenCode = join(binDir, "opencode");
      await writeFakeOpenCode(fakeOpenCode, [
        "process.stdout.write('{\"original\":true}');",
      ]);
      const original = await exportOpenCodeSessionToTempFile("ses_missing", {
        baseDir: outputDir,
        openCodePath: fakeOpenCode,
      });
      await writeFakeOpenCode(fakeOpenCode, [
        "process.stderr.write('missing session');",
        "process.exit(7);",
      ]);

      await expect(exportOpenCodeSessionToTempFile("ses_missing", {
        baseDir: outputDir,
        openCodePath: fakeOpenCode,
      })).rejects.toThrow("OpenCode export exited with code 7. missing session");
      await expect(readFile(original.filePath, "utf8")).resolves
        .toBe("{\"original\":true}");
      await expect(readdir(join(outputDir, "chatanchor-opencode-exports")))
        .resolves.toEqual(["chatanchor-opencode-ses_missing.json"]);
    },
  );

  executableScriptTest(
    "falls back to the OpenCode database when export JSON is incomplete",
    async () => {
      const binDir = await mkdtemp(join(
        tmpdir(),
        "threadrelink-opencode-invalid-json-fallback-",
      ));
      const outputDir = await mkdtemp(
        join(tmpdir(), "threadrelink-opencode-export-fallback-"),
      );
      const openCodeHome = await mkdtemp(
        join(tmpdir(), "threadrelink-opencode-home-fallback-"),
      );
      cleanup.push(binDir, outputDir, openCodeHome);
      createExportFixtureDatabase(openCodeHome);
      const fakeOpenCode = join(binDir, "opencode");
      await writeFakeOpenCode(fakeOpenCode, [
        "process.stdout.write('{\"version\":');",
      ]);

      const result = await exportOpenCodeSessionToTempFile("ses_invalid", {
        baseDir: outputDir,
        openCodeHome,
        openCodePath: fakeOpenCode,
      });

      expect(result.exportSource).toBe("database-fallback");
      const exported = JSON.parse(
        await readFile(result.filePath, "utf8"),
      ) as Record<string, unknown>;
      expect(exported).toMatchObject({
        exportSource: "opencode-db-fallback",
        info: {
          id: "ses_invalid",
          title: "Fallback export",
        },
      });
      expect(exported.messages).toEqual([
        expect.objectContaining({
          id: "msg_user",
          info: expect.objectContaining({
            role: "user",
          }),
          parts: [
            expect.objectContaining({
              text: "Please carry this context.",
              type: "text",
            }),
          ],
        }),
        expect.objectContaining({
          id: "msg_assistant",
          info: expect.objectContaining({
            role: "assistant",
          }),
          parts: [
            expect.objectContaining({
              text: "Fallback context is available.",
              type: "text",
            }),
          ],
        }),
      ]);
    },
  );

  executableScriptTest(
    "rejects incomplete OpenCode export JSON when fallback is unavailable",
    async () => {
      const binDir = await mkdtemp(join(
        tmpdir(),
        "threadrelink-opencode-invalid-json-",
      ));
      const outputDir = await mkdtemp(
        join(tmpdir(), "threadrelink-opencode-export-invalid-json-"),
      );
      const openCodeHome = await mkdtemp(
        join(tmpdir(), "threadrelink-opencode-home-invalid-json-"),
      );
      cleanup.push(binDir, outputDir, openCodeHome);
      const fakeOpenCode = join(binDir, "opencode");
      await writeFakeOpenCode(fakeOpenCode, [
        "process.stdout.write('{\"version\":1}');",
      ]);
      const original = await exportOpenCodeSessionToTempFile("ses_invalid", {
        baseDir: outputDir,
        openCodeHome,
        openCodePath: fakeOpenCode,
      });
      await writeFakeOpenCode(fakeOpenCode, [
        "process.stdout.write('{\"version\":');",
      ]);

      await expect(exportOpenCodeSessionToTempFile("ses_invalid", {
        baseDir: outputDir,
        openCodeHome,
        openCodePath: fakeOpenCode,
      })).rejects.toThrow("local database fallback failed");
      await expect(readFile(original.filePath, "utf8")).resolves.toBe(
        "{\"version\":1}",
      );
      await expect(readdir(join(outputDir, "chatanchor-opencode-exports")))
        .resolves.toEqual(["chatanchor-opencode-ses_invalid.json"]);
    },
  );

  it("requires a session id for OpenCode automatic exports", async () => {
    await expect(exportOpenCodeSessionToTempFile("   ")).rejects.toThrow(
      "An OpenCode session id is required",
    );
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
  }, 20_000);

  it("returns an empty list when the database is missing or unreadable", async () => {
    const openCodeHome = await mkdtemp(join(tmpdir(), "threadrelink-opencode-empty-"));
    cleanup.push(openCodeHome);
    await expect(listOpenCodeThreads({ openCodeHome })).resolves.toEqual([]);

    await writeFile(join(openCodeHome, "opencode.db"), "{broken", "utf8");
    await expect(listOpenCodeThreads({ openCodeHome })).resolves.toEqual([]);
  }, 20_000);

  it("resolves the stored session directory for resume pre-flight", async () => {
    const openCodeHome = await mkdtemp(join(tmpdir(), "threadrelink-opencode-resolve-"));
    cleanup.push(openCodeHome);
    createFixtureDatabase(openCodeHome);

    await expect(resolveOpenCodeSessionDirectory("ses_recent", { openCodeHome }))
      .resolves.toBe(normalizeAbsolutePath("/work/proj-old"));
    await expect(
      resolveOpenCodeSessionDirectory("ses_missing", { openCodeHome }),
    ).resolves.toBeNull();
  }, 20_000);
});
