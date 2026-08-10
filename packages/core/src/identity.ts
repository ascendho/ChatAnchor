import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ThreadRelinkError } from "./errors.js";
import { canonicalizeExistingPath } from "./path.js";

const FolderIdentitySchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
});

export interface FolderIdentity {
  schemaVersion: 1;
  projectId: string;
}

export function folderIdentityPath(workspacePath: string): string {
  return join(workspacePath, ".threadrelink", "project.json");
}

export function legacyFolderIdentityPath(workspacePath: string): string {
  return join(workspacePath, ".reporecall", "project.json");
}

async function readIdentityFile(identityPath: string): Promise<FolderIdentity | null> {
  try {
    const parsed = FolderIdentitySchema.safeParse(
      JSON.parse(await readFile(identityPath, "utf8")),
    );
    if (!parsed.success) {
      throw new ThreadRelinkError(
        "INVALID_PROJECT_IDENTITY",
        `ChatAnchor identity is invalid: ${identityPath}`,
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
    if (error instanceof SyntaxError) {
      throw new ThreadRelinkError(
        "INVALID_PROJECT_IDENTITY",
        `ChatAnchor identity is invalid: ${identityPath}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function readFolderIdentity(
  workspacePath: string,
): Promise<FolderIdentity | null> {
  const canonicalWorkspace = await canonicalizeExistingPath(workspacePath);
  const current = await readIdentityFile(
    folderIdentityPath(canonicalWorkspace),
  );
  if (current) {
    return current;
  }
  const legacy = await readIdentityFile(
    legacyFolderIdentityPath(canonicalWorkspace),
  );
  if (legacy) {
    await writeFolderIdentity(canonicalWorkspace, legacy.projectId);
  }
  return legacy;
}

export async function existingFolderIdentityPaths(
  workspacePath: string,
  expectedProjectId: string,
): Promise<string[]> {
  const canonicalWorkspace = await canonicalizeExistingPath(workspacePath);
  const paths = [
    folderIdentityPath(canonicalWorkspace),
    legacyFolderIdentityPath(canonicalWorkspace),
  ];
  const identities = await Promise.all(
    paths.map((path) => readIdentityFile(path).catch(() => null)),
  );
  return paths.filter(
    (_path, index) => identities[index]?.projectId === expectedProjectId,
  );
}

export async function writeFolderIdentity(
  workspacePath: string,
  projectId: string = randomUUID(),
): Promise<FolderIdentity> {
  const canonicalWorkspace = await canonicalizeExistingPath(workspacePath);
  const identityPath = folderIdentityPath(canonicalWorkspace);
  const identity = FolderIdentitySchema.parse({
    schemaVersion: 1,
    projectId,
  });
  await mkdir(dirname(identityPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${identityPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(identity, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, identityPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return identity;
}

export async function removeFolderIdentity(
  workspacePath: string,
  expectedProjectId: string,
): Promise<boolean> {
  const paths = await existingFolderIdentityPaths(
    workspacePath,
    expectedProjectId,
  );
  for (const path of paths) {
    await unlink(path);
  }
  return paths.length > 0;
}
