import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { access, readdir, stat } from "node:fs/promises";
import { resolveCursorConversationPath } from "./cursor.js";
import { ThreadRelinkError } from "./errors.js";
import { canonicalizeExistingPath, normalizeAbsolutePath } from "./path.js";
import type { ConversationProvider } from "./types.js";

const STATE_DB_PATTERN = /^state_(\d+)\.sqlite$/u;

export function resolveCodexHome(explicitHome?: string): string {
  const raw = explicitHome
    ?? process.env.CODEX_HOME
    ?? join(homedir(), ".codex");
  return normalizeAbsolutePath(raw);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findLatestStateDatabase(
  codexHome: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(codexHome);
  } catch {
    return null;
  }

  let bestVersion = -1;
  let bestPath: string | null = null;
  for (const entry of entries) {
    const match = STATE_DB_PATTERN.exec(entry);
    if (!match) {
      continue;
    }
    const version = Number(match[1]);
    if (version > bestVersion) {
      bestVersion = version;
      bestPath = join(codexHome, entry);
    }
  }
  return bestPath;
}

function readRolloutPathFromStateDb(
  databasePath: string,
  threadId: string,
): string | null {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database
      .prepare("SELECT rollout_path AS rolloutPath FROM threads WHERE id = ?")
      .get(threadId) as { rolloutPath?: unknown } | undefined;
    if (!row || typeof row.rolloutPath !== "string" || row.rolloutPath.length === 0) {
      return null;
    }
    return row.rolloutPath;
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

async function findRolloutPathUnderSessions(
  codexHome: string,
  threadId: string,
): Promise<string | null> {
  const sessionsRoot = join(codexHome, "sessions");
  if (!(await pathExists(sessionsRoot))) {
    return null;
  }

  const needle = threadId.toLowerCase();
  const stack = [sessionsRoot];
  const matches: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (
        entry.isFile()
        && entry.name.toLowerCase().includes(needle)
        && entry.name.endsWith(".jsonl")
      ) {
        matches.push(fullPath);
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  const ranked = await Promise.all(
    matches.map(async (path) => {
      try {
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      } catch {
        return { path, mtimeMs: 0 };
      }
    }),
  );
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return ranked[0]?.path ?? null;
}

/**
 * Resolve the on-disk Codex rollout/transcript path for a thread.
 * Reads only the `rollout_path` metadata column (or filename match); never
 * opens transcript message bodies.
 */
export async function resolveConversationRolloutPath(
  threadId: string,
  options: { codexHome?: string } = {},
): Promise<string> {
  return resolveConversationFilePath("codex", threadId, options);
}

/**
 * Resolve a local conversation file/directory for reveal-in-OS.
 * Never opens transcript message bodies.
 */
export async function resolveConversationFilePath(
  provider: ConversationProvider,
  threadId: string,
  options: {
    codexHome?: string;
    cursorHome?: string;
    cwdHint?: string | null;
  } = {},
): Promise<string> {
  const id = threadId.trim();
  if (!id) {
    throw new ThreadRelinkError(
      "CONVERSATION_FILE_NOT_FOUND",
      "A conversation id is required to reveal its local file.",
    );
  }

  if (provider === "opencode") {
    throw new ThreadRelinkError(
      "CONVERSATION_FILE_NOT_SUPPORTED",
      "OpenCode sessions are stored in the local opencode.db database and do not map to a standalone conversation file.",
    );
  }

  if (provider === "cursor") {
    const path = await resolveCursorConversationPath(id, {
      cursorHome: options.cursorHome,
      cwdHint: options.cwdHint,
    });
    return canonicalizeExistingPath(path);
  }

  const codexHome = resolveCodexHome(options.codexHome);
  const stateDb = await findLatestStateDatabase(codexHome);
  if (stateDb) {
    const fromDb = readRolloutPathFromStateDb(stateDb, id);
    if (fromDb && await pathExists(fromDb)) {
      return canonicalizeExistingPath(fromDb);
    }
  }

  const fromSessions = await findRolloutPathUnderSessions(codexHome, id);
  if (fromSessions) {
    return canonicalizeExistingPath(fromSessions);
  }

  throw new ThreadRelinkError(
    "CONVERSATION_FILE_NOT_FOUND",
    `Could not find a local Codex conversation file for ${id}.`,
  );
}
