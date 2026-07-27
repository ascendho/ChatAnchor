import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { z } from "zod";
import { ThreadRelinkError } from "./errors.js";
import {
  REGISTRY_SCHEMA_VERSION,
  type RegistryFile,
} from "./types.js";

const GitInfoSchema = z.object({
  branch: z.string().nullable(),
  originUrl: z.string().nullable(),
  sha: z.string().nullable(),
});

const ThreadMetadataSchema = z.object({
  provider: z.literal("codex"),
  id: z.string(),
  name: z.string().nullable(),
  preview: z.string(),
  cwd: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean(),
  cliVersion: z.string(),
  modelProvider: z.string(),
  gitInfo: GitInfoSchema.nullable(),
});

const EvidenceSchema = z.object({
  kind: z.enum([
    "stored-link",
    "path-alias",
    "git-remote-and-sha",
    "git-remote",
    "git-sha",
    "basename",
    "manual",
  ]),
  confidence: z.number(),
  description: z.string(),
});

const RegistrySchema = z.object({
  schemaVersion: z.literal(REGISTRY_SCHEMA_VERSION),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["git", "directory"]),
      aliases: z.array(
        z.object({
          path: z.string(),
          key: z.string(),
          firstSeenAt: z.string(),
          lastSeenAt: z.string(),
        }),
      ),
      remotes: z.array(z.string()),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  threads: z.array(ThreadMetadataSchema),
  threadLinks: z.array(
    z.object({
      provider: z.literal("codex"),
      threadId: z.string(),
      projectId: z.string(),
      linkedBy: z.enum(["automatic", "manual"]),
      originalCwd: z.string(),
      relativeCwd: z.string().nullable(),
      evidence: z.array(EvidenceSchema),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

function emptyRegistry(): RegistryFile {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    projects: [],
    threads: [],
    threadLinks: [],
  };
}

const LEGACY_HOME_ENV = "REPORECALL_HOME";
const LEGACY_HOME_DIRECTORY = ".reporecall";

export function resolveThreadRelinkHome(explicitHome?: string): string {
  return explicitHome
    ?? process.env.THREADRELINK_HOME
    ?? join(homedir(), ".threadrelink");
}

export class RegistryStore {
  public readonly home: string;
  public readonly registryPath: string;
  private readonly lockPath: string;
  private readonly legacyRegistryPath: string | null;

  public constructor(home?: string, legacyHome?: string) {
    this.home = resolveThreadRelinkHome(home);
    this.registryPath = join(this.home, "registry.json");
    this.lockPath = join(this.home, "registry.lock");
    const canMigrateLegacy =
      home === undefined
      && process.env.THREADRELINK_HOME === undefined;
    this.legacyRegistryPath = legacyHome
      ? join(legacyHome, "registry.json")
      : canMigrateLegacy
        ? join(
            process.env[LEGACY_HOME_ENV]
              ?? join(homedir(), LEGACY_HOME_DIRECTORY),
            "registry.json",
          )
        : null;
  }

  public async read(): Promise<RegistryFile> {
    const current = await this.readFile(this.registryPath);
    if (current) {
      return current;
    }

    if (this.legacyRegistryPath) {
      const legacy = await this.readFile(this.legacyRegistryPath);
      if (legacy) {
        await this.writeAtomic(legacy);
        return legacy;
      }
    }
    return emptyRegistry();
  }

  private async readFile(path: string): Promise<RegistryFile | null> {
    try {
      const content = await readFile(path, "utf8");
      let value: unknown;
      try {
        value = JSON.parse(content);
      } catch (error) {
        throw new ThreadRelinkError(
          "INVALID_REGISTRY",
          `ThreadRelink registry is invalid JSON: ${path}`,
          { cause: error },
        );
      }
      const parsed = RegistrySchema.safeParse(value);
      if (!parsed.success) {
        throw new ThreadRelinkError(
          "INVALID_REGISTRY",
          `ThreadRelink registry is invalid (${path}): ${parsed.error.message}`,
        );
      }
      return parsed.data;
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  public async update(
    mutate: (registry: RegistryFile) => void | Promise<void>,
  ): Promise<RegistryFile> {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const lock = await this.acquireLock();
    try {
      const registry = structuredClone(await this.read());
      await mutate(registry);
      RegistrySchema.parse(registry);
      await this.writeAtomic(registry);
      return registry;
    } finally {
      await lock.close().catch(() => undefined);
      await unlink(this.lockPath).catch(() => undefined);
    }
  }

  private async acquireLock(): Promise<FileHandle> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        return await open(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (
          !(error instanceof Error)
          || !("code" in error)
          || error.code !== "EEXIST"
        ) {
          throw error;
        }

        try {
          const info = await stat(this.lockPath);
          if (Date.now() - info.mtimeMs > 30_000) {
            await unlink(this.lockPath);
            continue;
          }
        } catch {
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new ThreadRelinkError(
      "REGISTRY_LOCK_TIMEOUT",
      `Timed out waiting for ${this.lockPath}`,
    );
  }

  private async writeAtomic(registry: RegistryFile): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.registryPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(registry, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporaryPath, this.registryPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

/** @deprecated Use resolveThreadRelinkHome. */
export const resolveRepoRecallHome = resolveThreadRelinkHome;
