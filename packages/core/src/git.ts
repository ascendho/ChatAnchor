import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalizeExistingPath, pathKey } from "./path.js";

const execFileAsync = promisify(execFile);
const PROJECT_ID_KEY = "threadrelink.projectId";
const LEGACY_PROJECT_ID_KEY = "reporecall.projectId";

export interface GitProjectContext {
  kind: "git" | "directory";
  root: string;
  projectId: string | null;
  remotes: string[];
  headSha: string | null;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout.trim();
}

async function optionalGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const value = await git(cwd, args);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function findGitRoot(inputPath: string): Promise<string | null> {
  const existingPath = await canonicalizeExistingPath(inputPath);
  const root = await optionalGit(existingPath, ["rev-parse", "--show-toplevel"]);
  return root ? canonicalizeExistingPath(root) : null;
}

export async function readGitProjectId(root: string): Promise<string | null> {
  const current = await optionalGit(
    root,
    ["config", "--local", "--get", PROJECT_ID_KEY],
  );
  if (current) {
    return current;
  }
  const legacy = await optionalGit(
    root,
    ["config", "--local", "--get", LEGACY_PROJECT_ID_KEY],
  );
  if (legacy) {
    await git(
      root,
      ["config", "--local", PROJECT_ID_KEY, legacy],
    ).catch(() => undefined);
  }
  return legacy;
}

export async function ensureGitProjectId(root: string): Promise<string> {
  const existing = await readGitProjectId(root);
  if (existing) {
    return existing;
  }
  const projectId = randomUUID();
  await git(root, ["config", "--local", PROJECT_ID_KEY, projectId]);
  return projectId;
}

export async function removeGitProjectId(
  root: string,
  expectedProjectId: string,
): Promise<boolean> {
  const [current, legacy] = await Promise.all([
    optionalGit(root, ["config", "--local", "--get", PROJECT_ID_KEY]),
    optionalGit(root, ["config", "--local", "--get", LEGACY_PROJECT_ID_KEY]),
  ]);
  if (current !== expectedProjectId && legacy !== expectedProjectId) {
    return false;
  }
  if (current === expectedProjectId) {
    await git(root, ["config", "--local", "--unset-all", PROJECT_ID_KEY]);
  }
  if (legacy === expectedProjectId) {
    await git(root, ["config", "--local", "--unset-all", LEGACY_PROJECT_ID_KEY]);
  }
  return true;
}

export async function excludeFolderIdentity(
  gitRoot: string,
  workspacePath: string,
): Promise<void> {
  const relativeWorkspace = relative(gitRoot, workspacePath);
  if (
    relativeWorkspace === ""
    || relativeWorkspace === ".."
    || relativeWorkspace.startsWith(`..${sep}`)
    || isAbsolute(relativeWorkspace)
  ) {
    return;
  }
  const gitPath = await git(gitRoot, ["rev-parse", "--git-path", "info/exclude"]);
  const excludePath = isAbsolute(gitPath) ? gitPath : resolve(gitRoot, gitPath);
  const pattern = `/${relativeWorkspace.split(sep).join("/")}/.threadrelink/`;
  let existing = "";
  try {
    existing = await readFile(excludePath, "utf8");
  } catch (error) {
    if (
      !(error instanceof Error)
      || !("code" in error)
      || error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  if (existing.split(/\r?\n/u).includes(pattern)) {
    return;
  }
  await mkdir(dirname(excludePath), { recursive: true });
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(excludePath, `${prefix}${pattern}\n`, "utf8");
}

export function normalizeRemoteUrl(input: string): string {
  let value = input.trim();
  if (value.length === 0) {
    return value;
  }

  const scpLike = value.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/u);
  if (scpLike?.[1] && scpLike[2] && !value.includes("://")) {
    value = `${scpLike[1]}/${scpLike[2]}`;
  } else {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "file:") {
        return `file:${pathKey(parsed.pathname)}`;
      }
      value = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value)) {
        return `file:${pathKey(value)}`;
      }
    }
  }

  return value
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "")
    .toLocaleLowerCase("en-US");
}

async function readRemotes(root: string): Promise<string[]> {
  const names = (await optionalGit(root, ["remote"]))
    ?.split(/\r?\n/u)
    .map((name) => name.trim())
    .filter(Boolean) ?? [];

  const values = await Promise.all(
    names.map(async (name) => {
      const output = await optionalGit(root, ["remote", "get-url", "--all", name]);
      return output?.split(/\r?\n/u).filter(Boolean) ?? [];
    }),
  );

  return [...new Set(values.flat().map(normalizeRemoteUrl).filter(Boolean))].sort();
}

export async function readProjectContext(
  inputPath: string,
  options: { createProjectId?: boolean } = {},
): Promise<GitProjectContext> {
  const existingPath = await canonicalizeExistingPath(inputPath);
  const root = await findGitRoot(existingPath);

  if (!root) {
    return {
      kind: "directory",
      root: existingPath,
      projectId: null,
      remotes: [],
      headSha: null,
    };
  }

  const canonicalRoot = await canonicalizeExistingPath(root);
  let projectId = await readGitProjectId(canonicalRoot);

  if (!projectId && options.createProjectId) {
    projectId = await ensureGitProjectId(canonicalRoot);
  }

  return {
    kind: "git",
    root: canonicalRoot,
    projectId,
    remotes: await readRemotes(canonicalRoot),
    headSha: await optionalGit(canonicalRoot, ["rev-parse", "HEAD"]),
  };
}

export async function gitShaExists(
  root: string,
  sha: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{7,64}$/iu.test(sha)) {
    return false;
  }
  try {
    await git(root, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export async function readGitVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"], {
      encoding: "utf8",
    });
    return stdout.trim();
  } catch {
    return null;
  }
}
