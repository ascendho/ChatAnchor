import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCodexHandoffArgs,
  buildConversationHandoff,
  buildCursorHandoffArgs,
  buildOpenCodeHandoffArgs,
  deleteProjectConversationHandoffs,
} from "../src/index.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

describe("conversation handoffs", () => {
  it("preserves the original and builds a reusable layered handoff", async () => {
    const registryHome = await temporaryDirectory("chatanchor-handoff-home-");
    const sourceDirectory = await temporaryDirectory("chatanchor-handoff-source-");
    const sourcePath = join(sourceDirectory, "rollout.jsonl");
    const source = [
      JSON.stringify({ type: "user_message", message: "Implement login." }),
      JSON.stringify({
        role: "assistant",
        content: "I will inspect the authentication service.",
      }),
      JSON.stringify({
        role: "tool",
        tool: "shell",
        input: { command: "pnpm test" },
        output: "Tests failed",
        status: "failed",
      }),
    ].join("\n");
    await writeFile(sourcePath, source, "utf8");

    const first = await buildConversationHandoff({
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/repo/example",
      registryHome,
      generatedAt: new Date("2026-09-18T00:00:00.000Z"),
      source: {
        provider: "codex",
        threadId: "thread-1",
        title: "Login work",
        updatedAt: Date.parse("2026-09-18T00:00:00.000Z"),
        sourcePath,
        sourceKind: "file",
        estimatedBytes: Buffer.byteLength(source),
        estimatedFiles: 1,
      },
    });

    expect(first.manifest.workingSet.strategy).toBe("complete");
    expect(first.manifest.source.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(await readFile(first.filePath, "utf8")).toContain("Implement login.");
    expect(await readFile(first.filePath, "utf8")).toContain("Result: failed");
    expect(await readFile(first.transcriptPath, "utf8")).toContain(source);
    expect(await readFile(join(first.originalPath, "rollout.jsonl"), "utf8"))
      .toBe(source);

    const second = await buildConversationHandoff({
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/repo/example",
      registryHome,
      source: {
        provider: "codex",
        threadId: "thread-1",
        title: "Login work",
        updatedAt: Date.parse("2026-09-18T00:00:00.000Z"),
        sourcePath,
        sourceKind: "file",
        estimatedBytes: Buffer.byteLength(source),
        estimatedFiles: 1,
      },
    });
    expect(second.reused).toBe(true);
    expect(second.filePath).toBe(first.filePath);
    expect(await deleteProjectConversationHandoffs("project-id", registryHome))
      .toBe(true);
    expect(await deleteProjectConversationHandoffs("project-id", registryHome))
      .toBe(false);
  });

  it("uses the last compaction for a large source while keeping the full record", async () => {
    const registryHome = await temporaryDirectory("chatanchor-handoff-home-");
    const sourceDirectory = await temporaryDirectory("chatanchor-handoff-source-");
    const sourcePath = join(sourceDirectory, "rollout.jsonl");
    const records = [
      JSON.stringify({ role: "user", content: "Initial task " + "x".repeat(140_000) }),
      JSON.stringify({ type: "compacted", summary: "The parser is implemented." }),
      JSON.stringify({ role: "user", content: "Run the release checks." }),
      JSON.stringify({ role: "assistant", content: "Release checks passed." }),
    ].join("\n");
    await writeFile(sourcePath, records, "utf8");

    const result = await buildConversationHandoff({
      projectId: "project-id",
      projectName: "Example",
      projectRoot: "/repo/example",
      registryHome,
      source: {
        provider: "codex",
        threadId: "thread-large",
        title: "Large thread",
        updatedAt: 1,
        sourcePath,
        sourceKind: "file",
        estimatedBytes: Buffer.byteLength(records),
        estimatedFiles: 1,
      },
    });

    expect(result.manifest.workingSet.strategy).toBe("since_compaction");
    const handoff = await readFile(result.filePath, "utf8");
    expect(handoff).toContain("The parser is implemented.");
    expect(handoff).toContain("Run the release checks.");
    expect(await readFile(result.transcriptPath, "utf8")).toContain(
      "Initial task",
    );
  });

  it("builds provider-specific launch arguments with a small seed prompt", () => {
    const prompt = "Read @/tmp/handoff.md first.";
    expect(buildCodexHandoffArgs("/repo", prompt)).toEqual([
      "--cd",
      "/repo",
      prompt,
    ]);
    expect(buildCursorHandoffArgs("/repo", prompt)).toEqual([
      "--workspace",
      "/repo",
      prompt,
    ]);
    expect(buildOpenCodeHandoffArgs("/repo", prompt)).toEqual([
      "/repo",
      "--prompt",
      prompt,
    ]);
  });
});
