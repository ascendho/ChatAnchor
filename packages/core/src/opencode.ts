import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { finished } from "node:stream/promises";
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

export function buildOpenCodeNewSessionArgs(projectPath: string): string[] {
  return [normalizeAbsolutePath(projectPath)];
}

export type OpenCodeExportShell = "posix" | "powershell";

function safeOpenCodeExportFilename(sessionId: string): string {
  const stem = sessionId.trim().replace(/[^A-Za-z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
  return `chatanchor-opencode-${stem || "session"}.json`;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

/**
 * Legacy helper for building a user-run OpenCode export command.
 * The VS Code UI now calls exportOpenCodeSessionToTempFile instead.
 */
export function buildOpenCodeExportCommand(
  sessionId: string,
  options: {
    openCodePath?: string;
    shell?: OpenCodeExportShell;
  } = {},
): string {
  const id = sessionId.trim();
  if (!id) {
    throw new ThreadRelinkError(
      "OPENCODE_EXPORT_COMMAND_INVALID_SESSION",
      "An OpenCode session id is required to build an export command.",
    );
  }
  const executable = resolveOpenCodePath(options.openCodePath);
  const filename = safeOpenCodeExportFilename(id);
  if (options.shell === "powershell") {
    return [
      "$dir = Join-Path ([System.IO.Path]::GetTempPath()) (\"chatanchor-opencode-\" + [guid]::NewGuid().ToString(\"N\"))",
      "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
      `$file = Join-Path $dir ${quotePowerShell(filename)}`,
      `& ${quotePowerShell(executable)} export ${quotePowerShell(id)} > $file`,
      "Write-Output \"@$file\"",
    ].join("; ");
  }
  return [
    "dir=\"$(mktemp -d \"${TMPDIR:-/tmp}/chatanchor-opencode.XXXXXX\")\"",
    `file="$dir/${filename}"`,
    `${quotePosix(executable)} export ${quotePosix(id)} > "$file"`,
    "printf '@%s\\n' \"$file\"",
  ].join("; ");
}

export interface OpenCodeExportResult {
  atPath: string;
  exportSource: "cli" | "database-fallback";
  filePath: string;
}

function parseOpenCodeRowJson(
  value: unknown,
  fallbackKey: "data" | "text",
): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { [fallbackKey]: parsed };
  } catch {
    return { [fallbackKey]: value };
  }
}

function readOpenCodeExportJsonFromDatabase(
  sessionId: string,
  openCodeHome?: string,
): string {
  const databasePath = join(resolveOpenCodeHome(openCodeHome), "opencode.db");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const session = database.prepare("SELECT * FROM session WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!session) {
      throw new ThreadRelinkError(
        "OPENCODE_EXPORT_FALLBACK_UNAVAILABLE",
        `Could not find OpenCode session ${sessionId} in the local database fallback.`,
      );
    }

    const messageRows = database.prepare(
      `SELECT id, time_created, time_updated, data
       FROM message
       WHERE session_id = ?
       ORDER BY time_created, id`,
    ).all(sessionId) as Array<Record<string, unknown>>;

    const partRows = database.prepare(
      `SELECT id, message_id, session_id, time_created, time_updated, data
       FROM part
       WHERE session_id = ?
       ORDER BY time_created, id`,
    ).all(sessionId) as Array<Record<string, unknown>>;

    if (messageRows.length === 0 && partRows.length === 0) {
      throw new ThreadRelinkError(
        "OPENCODE_EXPORT_FALLBACK_UNAVAILABLE",
        `OpenCode session ${sessionId} has no messages in the local database fallback.`,
      );
    }

    const partsByMessage = new Map<string, Array<Record<string, unknown>>>();
    for (const row of partRows) {
      const messageId = typeof row.message_id === "string"
        ? row.message_id
        : "";
      if (!messageId) {
        continue;
      }
      const parsed = parseOpenCodeRowJson(row.data, "text");
      const part = {
        id: row.id,
        messageID: row.message_id,
        sessionID: row.session_id,
        timeCreated: row.time_created,
        timeUpdated: row.time_updated,
        ...parsed,
      };
      const existing = partsByMessage.get(messageId);
      if (existing) {
        existing.push(part);
      } else {
        partsByMessage.set(messageId, [part]);
      }
    }

    const messages = messageRows.map((row) => {
      const parsed = parseOpenCodeRowJson(row.data, "data");
      const id = typeof row.id === "string" ? row.id : "";
      return {
        id: row.id,
        info: {
          id: row.id,
          sessionID: sessionId,
          timeCreated: row.time_created,
          timeUpdated: row.time_updated,
          ...parsed,
        },
        parts: partsByMessage.get(id) ?? [],
      };
    });

    return JSON.stringify({
      exportSource: "opencode-db-fallback",
      info: session,
      messages,
    }, null, 2);
  } finally {
    database.close();
  }
}

export async function exportOpenCodeSessionToTempFile(
  sessionId: string,
  options: {
    baseDir?: string;
    openCodeHome?: string;
    openCodePath?: string;
  } = {},
): Promise<OpenCodeExportResult> {
  const id = sessionId.trim();
  if (!id) {
    throw new ThreadRelinkError(
      "OPENCODE_EXPORT_INVALID_SESSION",
      "An OpenCode session id is required to export a conversation.",
    );
  }

  const baseDir = normalizeAbsolutePath(options.baseDir ?? tmpdir());
  const exportDir = join(baseDir, "chatanchor-opencode-exports");
  await mkdir(exportDir, { recursive: true });
  const filename = safeOpenCodeExportFilename(id);
  const filePath = join(exportDir, filename);
  const tempPath = join(
    exportDir,
    `${filename}.${process.pid}.${randomUUID()}.tmp`,
  );
  const output = createWriteStream(tempPath, { encoding: "utf8" });
  let exportSource: OpenCodeExportResult["exportSource"] = "cli";
  let stderr = "";

  const child = spawn(
    resolveOpenCodePath(options.openCodePath),
    ["export", id],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8_192);
  });
  child.stdout.pipe(output);

  const outputFinished = finished(output);
  const exit = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      output.destroy();
      reject(
        new ThreadRelinkError(
          "OPENCODE_EXPORT_FAILED",
          `Could not run OpenCode export: ${errorMessage(error)}`,
          { cause: error },
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        output.destroy();
        reject(
          new ThreadRelinkError(
            "OPENCODE_EXPORT_INTERRUPTED",
            `OpenCode export was interrupted by ${signal}.`,
          ),
        );
        return;
      }
      if (code !== 0) {
        output.destroy();
        reject(
          new ThreadRelinkError(
            "OPENCODE_EXPORT_FAILED",
            `OpenCode export exited with code ${code ?? 1}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`,
          ),
        );
        return;
      }
      resolve();
    });
  });

  try {
    await exit;
    await outputFinished;
    JSON.parse(await readFile(tempPath, "utf8"));
  } catch (exportError) {
    output.destroy();
    await outputFinished.catch(() => undefined);
    try {
      const fallbackJson = readOpenCodeExportJsonFromDatabase(
        id,
        options.openCodeHome,
      );
      await writeFile(tempPath, fallbackJson, "utf8");
      exportSource = "database-fallback";
    } catch (fallbackError) {
      await rm(tempPath, { force: true });
      throw new ThreadRelinkError(
        "OPENCODE_EXPORT_UNAVAILABLE",
        `OpenCode export and the local database fallback both failed. Export error: ${errorMessage(exportError)}. Fallback error: ${errorMessage(fallbackError)}`,
        { cause: fallbackError },
      );
    }
  }
  await rename(tempPath, filePath);
  return {
    atPath: `@${filePath}`,
    exportSource,
    filePath,
  };
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
  strict?: boolean;
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
  } catch (error) {
    if (options.strict) {
      throw new ThreadRelinkError(
        "OPENCODE_METADATA_UNAVAILABLE",
        `Could not read OpenCode conversation metadata: ${errorMessage(error)}`,
        { cause: error },
      );
    }
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
