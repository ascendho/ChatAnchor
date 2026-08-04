import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { ThreadRelinkError } from "./errors.js";
import { normalizeAbsolutePath } from "./path.js";
import type { ThreadMetadata } from "./types.js";

const CursorMetaSchema = z.object({
  schemaVersion: z.number().optional(),
  createdAtMs: z.number().optional(),
  updatedAtMs: z.number().optional(),
  hasConversation: z.boolean().optional(),
  title: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  isSubagent: z.boolean().nullable().optional(),
}).passthrough();

export function resolveCursorHome(explicitHome?: string): string {
  const raw = explicitHome
    ?? process.env.CURSOR_HOME
    ?? join(homedir(), ".cursor");
  return normalizeAbsolutePath(raw);
}

export function resolveAgentPath(explicitPath?: string): string {
  return explicitPath
    ?? process.env.THREADRELINK_AGENT_PATH
    ?? "agent";
}

/** Args for `agent --resume <chatId> --workspace <path>`. */
export function buildCursorResumeArgs(
  chatId: string,
  workspacePath: string,
): string[] {
  return [
    "--resume",
    chatId,
    "--workspace",
    normalizeAbsolutePath(workspacePath),
  ];
}

export async function runCursorResume(
  chatId: string,
  workspacePath: string,
  options: { agentPath?: string } = {},
): Promise<number> {
  const cwd = normalizeAbsolutePath(workspacePath);
  return await new Promise((resolve, reject) => {
    const child = spawn(
      resolveAgentPath(options.agentPath),
      buildCursorResumeArgs(chatId, cwd),
      {
        cwd,
        stdio: "inherit",
        windowsHide: false,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(
          new ThreadRelinkError(
            "CURSOR_RESUME_INTERRUPTED",
            `Cursor Agent resume was interrupted by ${signal}.`,
          ),
        );
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

/** MD5 of the absolute project cwd (no trailing slash), as used by Cursor Agent CLI. */
export function cursorChatBucketId(absolutePath: string): string {
  const normalized = normalizeAbsolutePath(absolutePath);
  return createHash("md5").update(normalized).digest("hex");
}

/** Cursor project slug used under ~/.cursor/projects/. */
export function cursorProjectSlug(absolutePath: string): string {
  const normalized = normalizeAbsolutePath(absolutePath);
  return normalized.replace(/^[/\\]/u, "").replace(/[/\\]/gu, "-");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function msToSeconds(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

export function mapCursorMetaToThread(
  chatId: string,
  meta: z.infer<typeof CursorMetaSchema>,
  fallbackCwd: string,
): ThreadMetadata | null {
  if (meta.isSubagent === true) {
    return null;
  }
  if (meta.hasConversation !== true) {
    return null;
  }
  const cwd = typeof meta.cwd === "string" && meta.cwd.trim().length > 0
    ? normalizeAbsolutePath(meta.cwd)
    : fallbackCwd;
  if (!cwd) {
    return null;
  }
  const title = typeof meta.title === "string" && meta.title.trim().length > 0
    ? meta.title.trim()
    : null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    provider: "cursor",
    id: chatId,
    name: title,
    preview: title ?? "Untitled Cursor conversation",
    cwd,
    createdAt: msToSeconds(meta.createdAtMs, nowSeconds),
    updatedAt: msToSeconds(meta.updatedAtMs, nowSeconds),
    archived: false,
    cliVersion: "",
    modelProvider: "cursor",
    gitInfo: null,
  };
}

export async function listCursorThreads(options: {
  projectPaths: string[];
  cursorHome?: string;
}): Promise<ThreadMetadata[]> {
  const cursorHome = resolveCursorHome(options.cursorHome);
  const chatsRoot = join(cursorHome, "chats");
  if (!(await pathExists(chatsRoot))) {
    return [];
  }

  const pathByBucket = new Map<string, string>();
  for (const projectPath of options.projectPaths) {
    const normalized = normalizeAbsolutePath(projectPath);
    pathByBucket.set(cursorChatBucketId(normalized), normalized);
  }

  const byId = new Map<string, ThreadMetadata>();
  for (const [bucketId, fallbackCwd] of pathByBucket) {
    const bucketPath = join(chatsRoot, bucketId);
    if (!(await pathExists(bucketPath))) {
      continue;
    }
    let entries: string[];
    try {
      entries = await readdir(bucketPath);
    } catch {
      continue;
    }
    for (const chatId of entries) {
      const metaPath = join(bucketPath, chatId, "meta.json");
      try {
        const raw = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
        const meta = CursorMetaSchema.parse(raw);
        const thread = mapCursorMetaToThread(chatId, meta, fallbackCwd);
        if (!thread) {
          continue;
        }
        const existing = byId.get(thread.id);
        if (!existing || thread.updatedAt >= existing.updatedAt) {
          byId.set(thread.id, thread);
        }
      } catch {
        // Ignore unreadable or invalid meta files.
      }
    }
  }

  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function resolveCursorConversationPath(
  threadId: string,
  options: {
    cursorHome?: string;
    cwdHint?: string | null;
  } = {},
): Promise<string> {
  const id = threadId.trim();
  const cursorHome = resolveCursorHome(options.cursorHome);
  const cwdHint = options.cwdHint
    ? normalizeAbsolutePath(options.cwdHint)
    : null;

  if (cwdHint) {
    const transcript = join(
      cursorHome,
      "projects",
      cursorProjectSlug(cwdHint),
      "agent-transcripts",
      id,
      `${id}.jsonl`,
    );
    if (await pathExists(transcript)) {
      return transcript;
    }
    const chatDir = join(
      cursorHome,
      "chats",
      cursorChatBucketId(cwdHint),
      id,
    );
    if (await pathExists(chatDir)) {
      return chatDir;
    }
  }

  const chatsRoot = join(cursorHome, "chats");
  if (await pathExists(chatsRoot)) {
    let buckets: string[];
    try {
      buckets = await readdir(chatsRoot);
    } catch {
      buckets = [];
    }
    for (const bucket of buckets) {
      const chatDir = join(chatsRoot, bucket, id);
      if (await pathExists(chatDir)) {
        return chatDir;
      }
    }
  }

  const projectsRoot = join(cursorHome, "projects");
  if (await pathExists(projectsRoot)) {
    let projects: string[];
    try {
      projects = await readdir(projectsRoot);
    } catch {
      projects = [];
    }
    for (const project of projects) {
      const transcript = join(
        projectsRoot,
        project,
        "agent-transcripts",
        id,
        `${id}.jsonl`,
      );
      if (await pathExists(transcript)) {
        return transcript;
      }
    }
  }

  throw new ThreadRelinkError(
    "CONVERSATION_FILE_NOT_FOUND",
    `Could not find a local Cursor conversation file for ${id}.`,
  );
}
