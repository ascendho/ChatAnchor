import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findExecutableOnPath,
  isPathInside,
  normalizeAbsolutePath,
  pathKey,
  relativeToRoot,
  resolveExecutablePath,
} from "../src/path.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe("path helpers", () => {
  it("recognizes a project root and its descendants", () => {
    expect(isPathInside("/work/ToolSpec", "/work/ToolSpec")).toBe(true);
    expect(isPathInside("/work/ToolSpec/packages/core", "/work/ToolSpec")).toBe(true);
    expect(isPathInside("/work/ToolSpec-old", "/work/ToolSpec")).toBe(false);
    expect(relativeToRoot("/work/ToolSpec/packages/core", "/work/ToolSpec"))
      .toBe("packages/core");
  });

  it("normalizes Windows keys case-insensitively", () => {
    expect(pathKey("C:\\Users\\Ada\\Repo", "win32"))
      .toBe(pathKey("c:\\users\\ada\\repo", "win32"));
  });

  it("finds a bare command in PATH directories and returns null when missing", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "threadrelink-bin-"));
    cleanup.push(binDir);
    await writeFile(join(binDir, "fakecmd"), "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(join(binDir, "fakecmd"), 0o755);

    expect(findExecutableOnPath("fakecmd", [binDir]))
      .toBe(join(binDir, "fakecmd"));
    expect(findExecutableOnPath("fakecmd", ["/nonexistent", binDir]))
      .toBe(join(binDir, "fakecmd"));
    expect(findExecutableOnPath("not-a-real-command-xyz", [binDir])).toBeNull();
  });

  it("matches Windows PATHEXT extensions when platform is win32", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "threadrelink-bin-win-"));
    cleanup.push(binDir);
    await writeFile(join(binDir, "fakecmd.CMD"), "@echo off\n", "utf8");
    await chmod(join(binDir, "fakecmd.CMD"), 0o755);

    expect(findExecutableOnPath("fakecmd", [binDir], "win32"))
      .toBe(join(binDir, "fakecmd.CMD"));
    expect(findExecutableOnPath("fakecmd", [binDir], "linux")).toBeNull();
  });

  it("passes explicit paths through and resolves nothing else", () => {
    expect(resolveExecutablePath("/abs/path/opencode")).toBe(
      normalizeAbsolutePath("/abs/path/opencode"),
    );
    expect(resolveExecutablePath("~/bin/opencode")).toBe(
      normalizeAbsolutePath("~/bin/opencode"),
    );
    expect(resolveExecutablePath("not-a-real-command-xyz")).toBeNull();
    expect(resolveExecutablePath("")).toBeNull();
  });
});
