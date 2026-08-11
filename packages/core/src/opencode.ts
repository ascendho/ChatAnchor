import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ThreadRelinkError, errorMessage } from "./errors.js";
import { normalizeAbsolutePath } from "./path.js";
import type { ThreadMetadata } from "./types.js";

const execFileAsync = promisify(execFile);

const OPENCODE_DIRNAME = "opencode";

/** Resolve the OpenCode data directory (XDG-style, like OpenCode itself). */
export function resolveOpenCodeHome(explicitHome?: string): string {
  const raw = explicitHome
    ?? process.env.THREADRELINK_OPENCODE_HOME
    ?? (
      process.env.XDG_DATA_HOME
        ? join(process.env.XDG_DATA_HOME, OPENCODE_DIRNAME)
        : join(homedir(), ".local", "share", OPENCODE_DIRNAME)
    );
  return normalizeAbsolutePath(raw);
}

export function resolveOpenCodePath(explicitPath?: string): string {
  return explicitPath
    ?? process.env.THREADRELINK_OPENCODE_PATH
    ?? "opencode";
}

/** Args for `opencode [project] --session <id>`. */
export function buildOpenCodeResumeArgs(
  sessionId: string,
  projectPath?: string,
): string[] {
  return projectPath
    ? [normalizeAbsolutePath(projectPath), "--session", sessionId]
    : ["--session", sessionId];
}

export async function readOpenCodeVersion(
  openCodePath?: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      resolveOpenCodePath(openCodePath),
      ["--version"],
      { encoding: "utf8" },
    );
    return stdout.trim();
  } catch (error) {
    throw new ThreadRelinkError(
      "OPENCODE_NOT_FOUND",
      `Could not run OpenCode: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export async function runOpenCodeResume(
  sessionId: string,
  cwd: string,
  options: { openCodePath?: string } = {},
): Promise<number> {
  const target = normalizeAbsolutePath(cwd);
  return await new Promise((resolve, reject) => {
    const child = spawn(
      resolveOpenCodePath(options.openCodePath),
      buildOpenCodeResumeArgs(sessionId, target),
      {
        cwd: target,
        stdio: "inherit",
        windowsHide: false,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(
          new ThreadRelinkError(
            "OPENCODE_RESUME_INTERRUPTED",
            `OpenCode resume was interrupted by ${signal}.`,
          ),
        );
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function msToSeconds(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value > 1_000_000_000_000
    ? Math.floor(value / 1000)
    : Math.floor(value);
}

interface OpenCodeSessionRow {
  id: string;
  directory: string | null;
  worktree: string | null;
  title: string | null;
  version: string | null;
  time_created: number | null;
  time_updated: number | null;
  time_archived: number | null;
  parent_id: string | null;
}

export function mapOpenCodeRowToThread(
  row: OpenCodeSessionRow,
): ThreadMetadata | null {
  const cwdRaw =
    typeof row.directory === "string" && row.directory.trim().length > 0
      ? row.directory
      : typeof row.worktree === "string" && row.worktree.trim().length > 0
        ? row.worktree
        : null;
  if (!cwdRaw) {
    return null;
  }
  const title =
    typeof row.title === "string" && row.title.trim().length > 0
      ? row.title.trim()
      : null;
  const now = Math.floor(Date.now() / 1000);
  return {
    provider: "opencode",
    id: row.id,
    name: title,
    preview: title ?? "Untitled OpenCode conversation",
    cwd: normalizeAbsolutePath(cwdRaw),
    createdAt: msToSeconds(row.time_created, now),
    updatedAt: msToSeconds(row.time_updated, now),
    archived: row.time_archived != null,
    cliVersion: typeof row.version === "string" ? row.version : "",
    modelProvider: "opencode",
    gitInfo: null,
  };
}

/**
 * List OpenCode sessions from the local SQLite database.
 * Reads metadata only (id, directory, title, timestamps, archived flag);
 * never opens message bodies.
 */
export async function listOpenCodeThreads(options: {
  openCodeHome?: string;
} = {}): Promise<ThreadMetadata[]> {
  const home = resolveOpenCodeHome(options.openCodeHome);
  const dbPath = join(home, "opencode.db");
  if (!(await pathExists(dbPath))) {
    return [];
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(dbPath, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT
           s.id AS id,
           s.directory AS directory,
           p.worktree AS worktree,
           s.title AS title,
           s.version AS version,
           s.time_created AS time_created,
           s.time_updated AS time_updated,
           s.time_archived AS time_archived,
           s.parent_id AS parent_id
         FROM session s
         LEFT JOIN project p ON p.id = s.project_id
         WHERE s.parent_id IS NULL`,
      )
      .all() as unknown as OpenCodeSessionRow[];
    const threads: ThreadMetadata[] = [];
    for (const row of rows) {
      const thread = mapOpenCodeRowToThread(row);
      if (thread) {
        threads.push(thread);
      }
    }
    return threads.sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

/** Returns the stored OpenCode session directory metadata. */
export async function resolveOpenCodeSessionDirectory(
  sessionId: string,
  options: { openCodeHome?: string } = {},
): Promise<string | null> {
  const home = resolveOpenCodeHome(options.openCodeHome);
  const dbPath = join(home, "opencode.db");
  if (!(await pathExists(dbPath))) {
    return null;
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(dbPath, { readOnly: true });
    const row = database
      .prepare("SELECT directory AS directory FROM session WHERE id = ?")
      .get(sessionId) as { directory?: unknown } | undefined;    if (!row || typeof row.directory !== "string" || row.directory.length === 0) {
      return null;
    }
    return normalizeAbsolutePath(row.directory);
  } catch {
    return null;
  } finally {
    database?.close();
  }
}
