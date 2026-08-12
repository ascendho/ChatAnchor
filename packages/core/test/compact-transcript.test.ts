import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseCompactTranscriptEvents,
  renderCompactTranscript,
  writeCompactTranscriptFromFile,
} from "../src/compact-transcript.js";
import type { CompactTranscriptSource } from "../src/compact-transcript.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

describe("compact transcript generation", () => {
  it("parses Codex JSONL into user, assistant, and tool events", () => {
    const raw = [
      JSON.stringify({
        type: "session_meta",
        cwd: "/repo/project",
      }),
      JSON.stringify({
        type: "user_message",
        message: "Implement compact transcript support",
      }),
      JSON.stringify({
        item: {
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "I will add a parser and tests.",
          }],
        },
      }),
      JSON.stringify({
        item: {
          type: "function_call",
          name: "shell",
          arguments: JSON.stringify({ cmd: "pnpm test" }),
        },
      }),
      JSON.stringify({
        item: {
          type: "function_call_output",
          output: "PASS compact-transcript.test.ts",
        },
      }),
      "not-json",
    ].join("\n");

    expect(parseCompactTranscriptEvents("codex", raw)).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "Implement compact transcript support",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "I will add a parser and tests.",
      }),
      expect.objectContaining({
        kind: "tool",
        command: "pnpm test",
      }),
      expect.objectContaining({
        kind: "tool",
        text: "PASS compact-transcript.test.ts",
      }),
    ]);
  });

  it("parses current Codex rollout payload shapes", () => {
    const raw = [
      JSON.stringify({
        timestamp: "2026-08-12T00:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Please inspect the plugin." }],
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "AgentMessage",
            content: [{ type: "text", text: "The parser misses payload." }],
          },
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            command: "pnpm test",
            status: "completed",
            stdout: "68 tests passed",
            exit_code: 0,
          },
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: 123 },
        },
      }),
    ].join("\n");

    expect(parseCompactTranscriptEvents("codex", raw)).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "Please inspect the plugin.",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "The parser misses payload.",
      }),
      expect.objectContaining({
        kind: "tool",
        command: "pnpm test",
        status: "completed",
        text: expect.stringContaining("68 tests passed") as string,
      }),
    ]);
  });

  it("renders a bounded Markdown transcript from Cursor JSONL", () => {
    const raw = [
      JSON.stringify({
        role: "user",
        content: "Continue the migration from the previous agent.",
      }),
      JSON.stringify({
        role: "assistant",
        content: "The registry schema is already updated.",
      }),
      JSON.stringify({
        role: "tool",
        tool: "shell",
        command: "npm test",
        output: "x".repeat(500),
        exitCode: 0,
      }),
    ].join("\n");
    const events = parseCompactTranscriptEvents("cursor", raw);
    const source: CompactTranscriptSource = {
      provider: "cursor",
      threadId: "chat-1",
      filePath: "/tmp/cursor.jsonl",
      title: "Cursor migration",
      cwd: "/repo/project",
    };

    const markdown = renderCompactTranscript(source, events, {
      generatedAt: new Date("2026-08-12T00:00:00.000Z"),
      maxToolOutputChars: 80,
    });

    expect(markdown).toContain("# ChatAnchor Compact Transcript");
    expect(markdown).toContain("- Provider: cursor");
    expect(markdown).toContain("- Title: Cursor migration");
    expect(markdown).toContain("Check the omitted-content counters");
    expect(markdown).toContain("Continue the migration");
    expect(markdown).toContain("The registry schema is already updated.");
    expect(markdown).toContain("Command: `npm test`");
    expect(markdown).toContain("Events with truncated text: 1");
  });

  it("parses OpenCode export JSON with nested messages and tools", () => {
    const raw = JSON.stringify({
      sessionID: "ses-1",
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: "Read the prior Codex context." }],
        },
        {
          role: "assistant",
          content: "I found the tests that need to change.",
        },
        {
          role: "tool",
          tool: "bash",
          input: { cmd: "pnpm --filter @threadrelink/core test" },
          output: "Tests passed",
        },
      ],
    });

    expect(parseCompactTranscriptEvents("opencode", raw)).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "Read the prior Codex context.",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "I found the tests that need to change.",
      }),
      expect.objectContaining({
        kind: "tool",
        command: "pnpm --filter @threadrelink/core test",
        text: "Tests passed",
      }),
    ]);
  });

  it("parses native OpenCode export messages with info roles", () => {
    const raw = JSON.stringify({
      info: {
        id: "ses-1",
        title: "询问 AI 身份",
      },
      messages: [
        {
          info: {
            role: "user",
            time: { created: 1_786_520_000_000 },
          },
          parts: [
            {
              id: "part-user-text",
              sessionID: "ses-1",
              messageID: "msg-user",
              type: "text",
              text: "询问 AI 身份",
            },
          ],
        },
        {
          info: {
            role: "assistant",
            time: { created: 1_786_520_001_000 },
          },
          parts: [
            { type: "step-start", snapshot: "snap-1" },
            { type: "text", text: "我是一个 AI 编程助手。" },
            {
              type: "step-finish",
              reason: "stop",
              snapshot: "snap-2",
            },
          ],
        },
      ],
    });

    expect(parseCompactTranscriptEvents("opencode", raw)).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "询问 AI 身份",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "我是一个 AI 编程助手。",
      }),
    ]);
  });

  it("summarizes native OpenCode tools, patches, and files without reasoning", () => {
    const raw = JSON.stringify({
      info: { id: "ses-1" },
      messages: [
        {
          info: { role: "assistant" },
          parts: [
            { type: "reasoning", text: "internal chain of thought" },
            { type: "text", text: "I will inspect the project." },
            {
              type: "tool",
              tool: "bash",
              state: {
                status: "completed",
                title: "List files",
                input: { cmd: "ls" },
                output: "README.md\npackages",
              },
            },
            {
              type: "patch",
              files: ["packages/core/src/compact-transcript.ts"],
            },
            {
              type: "file",
              filename: "notes.md",
              mime: "text/markdown",
              source: "uploaded",
            },
          ],
        },
      ],
    });

    const events = parseCompactTranscriptEvents("opencode", raw);

    expect(events).toEqual([
      expect.objectContaining({
        kind: "assistant",
        text: "I will inspect the project.",
      }),
      expect.objectContaining({
        kind: "tool",
        toolName: "bash",
        command: "ls",
        status: "completed",
        text: expect.stringContaining("README.md") as string,
      }),
      expect.objectContaining({
        kind: "tool",
        toolName: "patch",
        text: expect.stringContaining("compact-transcript.ts") as string,
      }),
      expect.objectContaining({
        kind: "system",
        text: expect.stringContaining("notes.md") as string,
      }),
    ]);
    expect(events.map((event) => event.text).join("\n")).not.toContain(
      "internal chain of thought",
    );
  });

  it("parses ChatAnchor OpenCode database fallback JSON", () => {
    const raw = JSON.stringify({
      exportSource: "opencode-db-fallback",
      info: {
        id: "ses-1",
        title: "OpenCode fallback",
      },
      messages: [
        {
          id: "msg-user",
          role: "user",
          parts: [
            { id: "part-user", type: "text", text: "Continue from here." },
          ],
        },
        {
          id: "msg-assistant",
          role: "assistant",
          parts: [
            {
              id: "part-assistant",
              type: "text",
              text: "The fallback export is readable.",
            },
          ],
        },
      ],
    });

    expect(parseCompactTranscriptEvents("opencode", raw)).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "Continue from here.",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "The fallback export is readable.",
      }),
    ]);
  });

  it("writes compact transcripts to a stable temporary path", async () => {
    const inputDir = await makeTempDir("threadrelink-compact-input-");
    const outputDir = await makeTempDir("threadrelink-compact-output-");
    const transcript = join(inputDir, "rollout.jsonl");
    await writeFile(transcript, [
      JSON.stringify({ role: "user", content: "First request" }),
      JSON.stringify({ role: "assistant", content: "First answer" }),
    ].join("\n"), "utf8");
    const source: CompactTranscriptSource = {
      provider: "codex",
      threadId: "thread/same",
      filePath: transcript,
      title: "Original title",
      cwd: "/repo/project",
    };

    const first = await writeCompactTranscriptFromFile(source, {
      outputBaseDir: outputDir,
      generatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    await writeFile(transcript, [
      JSON.stringify({ role: "user", content: "Second request" }),
      JSON.stringify({ role: "assistant", content: "Second answer" }),
    ].join("\n"), "utf8");
    const second = await writeCompactTranscriptFromFile(source, {
      outputBaseDir: outputDir,
      generatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(second.filePath).toBe(first.filePath);
    expect(first.atPath).toBe(`@${first.filePath}`);
    await expect(readFile(second.filePath, "utf8")).resolves.toContain(
      "Second request",
    );
    await expect(readFile(second.filePath, "utf8")).resolves.not.toContain(
      "First request",
    );
  });

  it("fails instead of writing an empty compact transcript", async () => {
    const inputDir = await makeTempDir("threadrelink-compact-empty-");
    const transcript = join(inputDir, "rollout.jsonl");
    await writeFile(transcript, [
      JSON.stringify({ type: "token_count", payload: { total: 1 } }),
      JSON.stringify({ type: "world_state", payload: { state: {} } }),
    ].join("\n"), "utf8");

    await expect(writeCompactTranscriptFromFile({
      provider: "codex",
      threadId: "empty-thread",
      filePath: transcript,
    }, {
      outputBaseDir: inputDir,
    })).rejects.toMatchObject({
      code: "COMPACT_TRANSCRIPT_EMPTY",
    });
  });

  it("omits middle events when the transcript exceeds the output budget", async () => {
    const inputDir = await makeTempDir("threadrelink-compact-long-");
    const transcript = join(inputDir, "cursor.jsonl");
    const lines = Array.from({ length: 80 }, (_, index) =>
      JSON.stringify({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `event ${index} ${"x".repeat(120)}`,
      })
    );
    await writeFile(transcript, lines.join("\n"), "utf8");

    const result = await writeCompactTranscriptFromFile({
      provider: "cursor",
      threadId: "long-chat",
      filePath: transcript,
    }, {
      outputBaseDir: inputDir,
      maxOutputChars: 8_000,
      generatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });

    expect(result.omittedEvents).toBeGreaterThan(0);
    await expect(readFile(result.filePath, "utf8")).resolves.toContain(
      "Timeline events omitted:",
    );
  });
});
