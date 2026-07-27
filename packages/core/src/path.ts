import { homedir } from "node:os";
import {
  basename,
  isAbsolute,
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
