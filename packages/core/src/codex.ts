import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { promisify } from "node:util";
import { z } from "zod";
import { ThreadRelinkError, errorMessage } from "./errors.js";
import type { HistoryAdapter, ThreadMetadata } from "./types.js";

const execFileAsync = promisify(execFile);

const GitInfoSchema = z.object({
  branch: z.string().nullable().optional(),
  originUrl: z.string().nullable().optional(),
  sha: z.string().nullable().optional(),
}).passthrough();

const ThreadSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  preview: z.string().default(""),
  cwd: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  cliVersion: z.string().default(""),
  modelProvider: z.string().default("openai"),
  gitInfo: GitInfoSchema.nullable().optional(),
}).passthrough();

const ThreadListResponseSchema = z.object({
  data: z.array(ThreadSchema),
  nextCursor: z.string().nullable().optional(),
}).passthrough();

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CodexClientOptions {
  codexPath?: string;
  requestTimeoutMs?: number;
}

export function resolveCodexPath(explicitPath?: string): string {
  return explicitPath
    ?? process.env.THREADRELINK_CODEX_PATH
    ?? process.env.REPORECALL_CODEX_PATH
    ?? "codex";
}

export class CodexAppServerClient implements HistoryAdapter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private nextId = 1;
  private closing = false;
  private stderr = "";

  private constructor(options: CodexClientOptions) {
    const codexPath = resolveCodexPath(options.codexPath);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-8_192);
    });
    this.child.on("error", (error) => this.failPending(error));
    this.child.on("exit", (code, signal) => {
      if (!this.closing) {
        this.failPending(
          new ThreadRelinkError(
            "CODEX_APP_SERVER_EXITED",
            `Codex app-server exited unexpectedly (${code ?? signal ?? "unknown"}). ${this.stderr.trim()}`,
          ),
        );
      }
    });
  }

  public static async start(
    options: CodexClientOptions = {},
  ): Promise<CodexAppServerClient> {
    const client = new CodexAppServerClient(options);
    try {
      await client.initialize();
      return client;
    } catch (error) {
      await client.close();
      throw new ThreadRelinkError(
        "CODEX_APP_SERVER_UNAVAILABLE",
        `Could not initialize Codex app-server: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  public async listThreads(
    options: { includeArchived?: boolean } = {},
  ): Promise<ThreadMetadata[]> {
    const archivedStates = options.includeArchived === false ? [false] : [false, true];
    const threads: ThreadMetadata[] = [];

    for (const archived of archivedStates) {
      let cursor: string | null = null;
      do {
        const response = ThreadListResponseSchema.parse(
          await this.request("thread/list", {
            archived,
            cursor,
            limit: 100,
            sourceKinds: ["cli", "vscode", "appServer"],
            sortKey: "updated_at",
            sortDirection: "desc",
          }),
        );
        for (const thread of response.data) {
          threads.push({
            provider: "codex",
            id: thread.id,
            name: thread.name ?? null,
            preview: thread.preview,
            cwd: thread.cwd,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            archived,
            cliVersion: thread.cliVersion,
            modelProvider: thread.modelProvider,
            gitInfo: thread.gitInfo
              ? {
                  branch: thread.gitInfo.branch ?? null,
                  originUrl: thread.gitInfo.originUrl ?? null,
                  sha: thread.gitInfo.sha ?? null,
                }
              : null,
          });
        }
        cursor = response.nextCursor ?? null;
      } while (cursor);
    }

    return [...new Map(threads.map((thread) => [thread.id, thread])).values()];
  }

  public async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.lines.close();
    this.child.stdin.end();

    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
      await Promise.race([
        new Promise<void>((resolve) => this.child.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    this.failPending(
      new ThreadRelinkError("CODEX_APP_SERVER_CLOSED", "Codex app-server was closed."),
    );
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "threadrelink",
        title: "ThreadRelink",
        version: "0.6.1",
      },
    });
    this.send({
      method: "initialized",
      params: {},
    });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ThreadRelinkError(
            "CODEX_REQUEST_TIMEOUT",
            `Codex app-server request timed out: ${method}`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: unknown): void {
    if (!this.child.stdin.writable) {
      throw new ThreadRelinkError(
        "CODEX_APP_SERVER_NOT_WRITABLE",
        "Codex app-server stdin is not writable.",
      );
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(request.timer);

    if (message.error && typeof message.error === "object") {
      const rpcError = message.error as { code?: unknown; message?: unknown };
      request.reject(
        new ThreadRelinkError(
          `CODEX_RPC_${String(rpcError.code ?? "ERROR")}`,
          String(rpcError.message ?? "Codex app-server returned an error."),
        ),
      );
      return;
    }
    request.resolve(message.result);
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

export async function readCodexVersion(codexPath?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveCodexPath(codexPath), ["--version"], {
      encoding: "utf8",
    });
    return stdout.trim();
  } catch (error) {
    throw new ThreadRelinkError(
      "CODEX_NOT_FOUND",
      `Could not run Codex: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export async function runCodexResume(
  threadId: string,
  cwd: string,
  options: { codexPath?: string } = {},
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      resolveCodexPath(options.codexPath),
      ["resume", "--cd", cwd, threadId],
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
            "CODEX_RESUME_INTERRUPTED",
            `Codex resume was interrupted by ${signal}.`,
          ),
        );
      } else {
        resolve(code ?? 1);
      }
    });
  });
}
