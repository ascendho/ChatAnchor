import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProjectContextPack,
  deleteProjectContextPack,
  readProjectContextPackManifest,
  searchProjectContextPack,
} from "../src/context-pack.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "chatanchor-context-pack-"));
  cleanup.push(path);
  return path;
}

function transcript(): string {
  const events: unknown[] = [];
  for (let index = 1; index <= 8; index += 1) {
    events.push({ role: "user", text: `Request ${index} 密钥 api_key=secret-${index}` });
    events.push({
      role: "assistant",
      text: `Answer ${index} changed /project/src/file-${index}.ts and /outside/private.txt`,
    });
    events.push({
      type: "function_call",
      name: "shell",
      arguments: { cmd: `cat /project/src/file-${index}.ts` },
      output: "full tool output must not be retained",
      status: 0,
    });
  }
  events.push({ role: "system", text: "system instructions must be omitted" });
  return events.map((event) => JSON.stringify(event)).join("\n");
}

describe("project context packs", () => {
  it("builds a private redacted pack with deterministic turn selection", async () => {
    const home = await temp();
    const result = await buildProjectContextPack({
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/project",
      registryHome: home,
      generatedAt: new Date("2026-09-17T00:00:00.000Z"),
      sources: [{
        provider: "codex",
        threadId: "thread-1",
        title: "Implementation",
        updatedAt: 1_700_000_000_000,
        raw: transcript(),
      }],
    });
    const markdown = await readFile(result.filePath, "utf8");
    expect(markdown).toContain("untrusted historical context");
    expect(markdown).toContain("Request 1");
    expect(markdown).toContain("Request 2");
    expect(markdown).not.toContain("Request 3");
    expect(markdown).toContain("Request 4");
    expect(markdown).toContain("Request 8");
    expect(markdown).toContain("api_key=[REDACTED]");
    expect(markdown).toContain("src/file-8.ts");
    expect(markdown).toContain("paths=./src/file-8.ts");
    expect(markdown).toContain("<external-path>");
    expect(markdown).not.toContain("full tool output must not be retained");
    expect(markdown).not.toContain("system instructions must be omitted");
    expect((await readProjectContextPackManifest("project-id", home)).sources)
      .toHaveLength(1);
    if (process.platform !== "win32") {
      expect((await stat(result.filePath)).mode & 0o777).toBe(0o600);
      expect((await stat(join(home, "context-packs", "project-id"))).mode & 0o777)
        .toBe(0o700);
    }
  });

  it("keeps the previous pack when any selected source cannot be parsed", async () => {
    const home = await temp();
    const input = {
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/project",
      registryHome: home,
      sources: [{
        provider: "codex" as const,
        threadId: "thread-1",
        title: "Good",
        updatedAt: 1,
        raw: transcript(),
      }],
    };
    const first = await buildProjectContextPack(input);
    const previous = await readFile(first.filePath, "utf8");
    await expect(buildProjectContextPack({
      ...input,
      sources: [...input.sources, {
        provider: "cursor",
        threadId: "broken",
        title: "Broken",
        updatedAt: 2,
        raw: "not-json",
      }],
    })).rejects.toThrow(/No user messages/u);
    expect(await readFile(first.filePath, "utf8")).toBe(previous);
  });

  it("searches Latin terms and Chinese bigrams into a temporary @path", async () => {
    const home = await temp();
    const output = await temp();
    await buildProjectContextPack({
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/project",
      registryHome: home,
      sources: [{
        provider: "codex",
        threadId: "thread-1",
        title: "Search",
        updatedAt: 1,
        raw: [
          JSON.stringify({ role: "user", text: "设计发布流程 release workflow" }),
          JSON.stringify({ role: "assistant", text: "更新 changelog 并验证版本" }),
        ].join("\n"),
      }],
    });
    const result = await searchProjectContextPack({
      projectId: "project-id",
      query: "发布流程",
      registryHome: home,
      outputBaseDir: output,
    });
    expect(result.matchCount).toBeGreaterThan(0);
    expect(result.atPath).toBe(`@${result.filePath}`);
    expect(await readFile(result.filePath, "utf8")).toContain("发布流程");
    expect(await deleteProjectContextPack("project-id", home)).toBe(true);
    expect(await deleteProjectContextPack("project-id", home)).toBe(false);
  });
});
