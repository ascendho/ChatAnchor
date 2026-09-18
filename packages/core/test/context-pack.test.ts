import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProjectContextPack,
  deleteProjectContextPack,
  measureContextPackArtifact,
  readProjectContextPackManifest,
  searchProjectContextPack,
  type ContextPackSource,
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
  return [
    { role: "system", text: "system instructions must be preserved" },
    { role: "developer", text: "developer instructions must be preserved" },
    { role: "user", text: "密钥 api_key=secret-value Cookie: session=abc" },
    {
      type: "function_call",
      name: "shell",
      arguments: { cmd: "cat /outside/private.txt" },
      output: "full tool output must be preserved",
      status: 0,
    },
    {
      role: "assistant",
      text: "Answer changed /project/src/file.ts and /outside/private.txt",
    },
  ].map((event) => JSON.stringify(event)).join("\n");
}

async function source(
  root: string,
  overrides: Partial<ContextPackSource> = {},
): Promise<ContextPackSource> {
  const sourcePath = join(root, "conversation.jsonl");
  await writeFile(sourcePath, transcript(), "utf8");
  const measure = await measureContextPackArtifact(sourcePath);
  return {
    provider: "codex",
    threadId: "thread-1",
    title: "Implementation",
    updatedAt: 1_700_000_000_000,
    sourcePath,
    sourceKind: "file",
    estimatedBytes: measure.bytes,
    estimatedFiles: measure.files,
    ...overrides,
  };
}

describe("project context packs", () => {
  it("preserves the complete original and writes a readable v2 transcript", async () => {
    const home = await temp();
    const inputs = await temp();
    const input = await source(inputs);
    const result = await buildProjectContextPack({
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/project",
      registryHome: home,
      generatedAt: new Date("2026-09-17T00:00:00.000Z"),
      sources: [input],
    });

    expect(result.manifest.schemaVersion).toBe("context_pack.v2");
    expect(result.manifest.sources).toHaveLength(1);
    const manifestSource = result.manifest.sources[0];
    expect(manifestSource).toBeDefined();
    const originalPath = join(
      home,
      "context-packs",
      "project-id",
      manifestSource?.artifactPath ?? "",
    );
    const transcriptPath = join(
      home,
      "context-packs",
      "project-id",
      manifestSource?.transcriptFile ?? "",
    );
    expect(await readFile(originalPath, "utf8")).toBe(transcript());
    const readable = await readFile(transcriptPath, "utf8");
    expect(readable).toContain("system instructions must be preserved");
    expect(readable).toContain("developer instructions must be preserved");
    expect(readable).toContain("api_key=secret-value");
    expect(readable).toContain("Cookie: session=abc");
    expect(readable).toContain("full tool output must be preserved");
    expect(readable).toContain("/outside/private.txt");
    expect(await readFile(result.filePath, "utf8")).toContain(
      `@${transcriptPath}`,
    );
    if (process.platform !== "win32") {
      expect((await stat(result.filePath)).mode & 0o777).toBe(0o600);
      expect((await stat(originalPath)).mode & 0o777).toBe(0o600);
      expect((await stat(join(home, "context-packs", "project-id"))).mode & 0o777)
        .toBe(0o700);
    }
  });

  it("keeps the previous pack when a selected source cannot be copied", async () => {
    const home = await temp();
    const inputs = await temp();
    const good = await source(inputs);
    const options = {
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/project",
      registryHome: home,
      sources: [good],
    };
    const first = await buildProjectContextPack(options);
    const previous = await readFile(first.filePath, "utf8");
    await expect(buildProjectContextPack({
      ...options,
      sources: [good, {
        ...good,
        provider: "cursor",
        threadId: "missing",
        sourcePath: join(inputs, "missing.jsonl"),
      }],
    })).rejects.toThrow();
    expect(await readFile(first.filePath, "utf8")).toBe(previous);
  });

  it("searches v2 transcripts and deletes the pack", async () => {
    const home = await temp();
    const inputs = await temp();
    const output = await temp();
    const raw = [
      JSON.stringify({ role: "user", text: "设计发布流程 release workflow" }),
      JSON.stringify({ role: "assistant", text: "更新 changelog 并验证版本" }),
    ].join("\n");
    const input = await source(inputs);
    await writeFile(input.sourcePath, raw, "utf8");
    const measure = await measureContextPackArtifact(input.sourcePath);
    input.estimatedBytes = measure.bytes;
    await buildProjectContextPack({
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/project",
      registryHome: home,
      sources: [input],
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

  it("continues to read and search context_pack.v1 packs", async () => {
    const home = await temp();
    const output = await temp();
    const directory = join(home, "context-packs", "project-id");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "context.md"), "# Legacy\n\n## Decision\n\n保留旧版搜索。\n");
    await writeFile(join(directory, "manifest.json"), JSON.stringify({
      schemaVersion: "context_pack.v1",
      projectId: "project-id",
      projectName: "Legacy",
      generatedAt: "2026-09-17T00:00:00.000Z",
      contextFile: "context.md",
      sources: [],
      limits: {
        maxSources: 10,
        maxMessageChars: 4_000,
        maxSessionChars: 12_000,
        maxPackChars: 60_000,
      },
    }), "utf8");
    expect((await readProjectContextPackManifest("project-id", home)).schemaVersion)
      .toBe("context_pack.v1");
    const result = await searchProjectContextPack({
      projectId: "project-id",
      query: "旧版搜索",
      registryHome: home,
      outputBaseDir: output,
    });
    expect(result.matchCount).toBeGreaterThan(0);
  });
});
