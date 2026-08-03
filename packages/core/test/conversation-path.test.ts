import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findLatestStateDatabase,
  resolveCodexHome,
  resolveConversationRolloutPath,
} from "../src/conversation-path.js";
import type { ThreadRelinkError } from "../src/errors.js";
import { canonicalizeExistingPath } from "../src/path.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function makeCodexHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "threadrelink-codex-home-"));
  cleanup.push(root);
  return root;
}

function writeStateDb(
  databasePath: string,
  rows: Array<{ id: string; rolloutPath: string }>,
): void {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL
    );
  `);
  const insert = database.prepare(
    "INSERT INTO threads (id, rollout_path) VALUES (?, ?)",
  );
  for (const row of rows) {
    insert.run(row.id, row.rolloutPath);
  }
  database.close();
}

describe("conversation path resolution", () => {
  it("prefers CODEX_HOME over the default home directory", () => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = "/tmp/custom-codex-home";
    try {
      expect(resolveCodexHome()).toBe(resolveCodexHome("/tmp/custom-codex-home"));
    } finally {
      if (previous === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previous;
      }
    }
  });

  it("picks the highest-numbered state database", async () => {
    const home = await makeCodexHome();
    await writeFile(join(home, "state_3.sqlite"), "");
    await writeFile(join(home, "state_12.sqlite"), "");
    await writeFile(join(home, "state_7.sqlite"), "");
    expect(await findLatestStateDatabase(home)).toBe(join(home, "state_12.sqlite"));
  });

  it("resolves a rollout path from the Codex state database", async () => {
    const home = await makeCodexHome();
    const threadId = "019faca6-afbe-74b2-9b13-1a10bf13db43";
    const sessionsDir = join(home, "sessions", "2026", "07", "29");
    await mkdir(sessionsDir, { recursive: true });
    const rolloutPath = join(
      sessionsDir,
      `rollout-2026-07-29T14-53-52-${threadId}.jsonl`,
    );
    await writeFile(rolloutPath, "{}\n");
    writeStateDb(join(home, "state_5.sqlite"), [
      { id: threadId, rolloutPath },
    ]);

    await expect(resolveConversationRolloutPath(threadId, { codexHome: home }))
      .resolves.toBe(await canonicalizeExistingPath(rolloutPath));
  });

  it("falls back to sessions filename search when the db path is stale", async () => {
    const home = await makeCodexHome();
    const threadId = "019faca6-afbe-74b2-9b13-1a10bf13db43";
    const sessionsDir = join(home, "sessions", "2026", "07", "29");
    await mkdir(sessionsDir, { recursive: true });
    const rolloutPath = join(
      sessionsDir,
      `rollout-2026-07-29T14-53-52-${threadId}.jsonl`,
    );
    await writeFile(rolloutPath, "{}\n");
    writeStateDb(join(home, "state_5.sqlite"), [
      { id: threadId, rolloutPath: join(home, "missing.jsonl") },
    ]);

    await expect(resolveConversationRolloutPath(threadId, { codexHome: home }))
      .resolves.toBe(await canonicalizeExistingPath(rolloutPath));
  });

  it("errors when the conversation file cannot be found", async () => {
    const home = await makeCodexHome();
    writeStateDb(join(home, "state_1.sqlite"), []);

    await expect(
      resolveConversationRolloutPath("missing-thread", { codexHome: home }),
    ).rejects.toMatchObject({
      code: "CONVERSATION_FILE_NOT_FOUND",
    } satisfies Partial<ThreadRelinkError>);
  });
});
