import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { realpath } from "node:fs/promises";

function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith(`~${sep}`) || input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return input;
}
export function normalizeAbsolutePath(input: string): string {
  const expanded = expandHome(input.trim());
  return normalize(isAbsolute(expanded) ? expanded : resolve(expanded));
}

export async function canonicalizeExistingPath(input: string): Promise<string> {
  return normalize(await realpath(normalizeAbsolutePath(input)));
}

export function pathKey(
  input: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const value = normalizeAbsolutePath(input).normalize("NFC");
  return platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

export function isPathInside(candidate: string, root: string): boolean {
  const candidatePath = normalizeAbsolutePath(candidate);
  const rootPath = normalizeAbsolutePath(root);
  const value = relative(rootPath, candidatePath);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

export function relativeToRoot(candidate: string, root: string): string | null {
  if (!isPathInside(candidate, root)) {
    return null;
  }

  return relative(
    normalizeAbsolutePath(root),
    normalizeAbsolutePath(candidate),
  ).split(sep).join("/");
}

export function pathBasename(input: string): string {
  return basename(normalizeAbsolutePath(input)).toLocaleLowerCase("en-US");
}

/** Locate a bare command name in the given PATH directories. */
export function findExecutableOnPath(
  command: string,
  pathDirs: string[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  const extensions = platform === "win32"
    ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")]
    : [""];
  for (const dir of pathDirs) {
    if (!dir) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

let cachedLoginShellPathDirs: string[] | null = null;

function loginShellPathDirs(): string[] {
  if (cachedLoginShellPathDirs !== null) {
    return cachedLoginShellPathDirs;
  }
  const dirs: string[] = [];
  if (process.platform !== "win32") {
    const shell = process.env.SHELL ?? "sh";
    try {
      const output = execFileSync(shell, ["-lc", "printf %s \"$PATH\""], {
        encoding: "utf8",
        timeout: 3_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const dir of output.split(delimiter)) {
        const trimmed = dir.trim();
        if (trimmed) {
          dirs.push(trimmed);
        }
      }
    } catch {
      // Best-effort; the host PATH and well-known directories still apply.
    }
  }
  cachedLoginShellPathDirs = dirs;
  return dirs;
}

function executableSearchDirs(): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string): void => {
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      dirs.push(dir);
    }
  };
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    add(dir.trim());
  }
  for (const dir of loginShellPathDirs()) {
    add(dir);
  }
  if (process.platform !== "win32") {
    for (const dir of [
      join(homedir(), ".opencode", "bin"),
      join(homedir(), ".local", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]) {
      add(dir);
    }
  }
  return dirs;
}

/**
 * Resolve a configured executable to an absolute path. Paths pass through
 * unchanged; bare command names are looked up on the host PATH, the login
 * shell PATH, and well-known directories. Returns null when not found.
 */
export function resolveExecutablePath(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  if (
    isAbsolute(trimmed)
    || trimmed.startsWith("~")
    || trimmed.includes("/")
    || trimmed.includes("\\")
  ) {
    return normalizeAbsolutePath(trimmed);
  }
  const hit = findExecutableOnPath(trimmed, executableSearchDirs());
  return hit ? normalize(hit) : null;
}
