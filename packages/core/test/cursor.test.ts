import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCursorResumeArgs,
  cursorChatBucketId,
  cursorProjectSlug,
  listCursorThreads,
  mapCursorMetaToThread,
  resolveAgentPath,
  resolveCursorConversationPath,
} from "../src/cursor.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe("Cursor Agent CLI listing", () => {
  it("builds resume args for agent --resume --workspace", () => {
    expect(resolveAgentPath()).toBe("agent");
    expect(resolveAgentPath("/opt/agent")).toBe("/opt/agent");
    expect(buildCursorResumeArgs(
      "a4efc723-68f4-45f5-8474-952597e995e8",
      "/Users/ascendho/Downloads/repo/threadrelink",
    )).toEqual([
      "--resume",
      "a4efc723-68f4-45f5-8474-952597e995e8",
      "--workspace",
      "/Users/ascendho/Downloads/repo/threadrelink",
    ]);
  });

  it("hashes absolute project paths the way Cursor chats buckets do", () => {
    const path = "/Users/ascendho/Downloads/repo/threadrelink";
    expect(cursorChatBucketId(path)).toBe(
      createHash("md5").update(path).digest("hex"),
    );
    expect(cursorProjectSlug(path)).toBe(
      "Users-ascendho-Downloads-repo-threadrelink",
    );
  });

  it("maps meta.json and filters subagents / empty chats", () => {
    expect(mapCursorMetaToThread("chat-1", {
      hasConversation: true,
      title: "Hello",
      cwd: "/work/ToolSpec",
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_100_000,
    }, "/fallback")).toMatchObject({
      provider: "cursor",
      id: "chat-1",
      name: "Hello",
      cwd: "/work/ToolSpec",
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
    });

    expect(mapCursorMetaToThread("chat-2", {
      hasConversation: true,
      isSubagent: true,
      cwd: "/work/ToolSpec",
    }, "/fallback")).toBeNull();

    expect(mapCursorMetaToThread("chat-3", {
      hasConversation: false,
      cwd: "/work/ToolSpec",
    }, "/fallback")).toBeNull();
  });

  it("lists chats from alias path buckets and prefers transcript reveal paths", async () => {
    const cursorHome = await mkdtemp(join(tmpdir(), "threadrelink-cursor-"));
    cleanup.push(cursorHome);
    const oldPath = "/old/ToolSpec";
    const chatId = "019faca6-afbe-74b2-9b13-1a10bf13db43";
    const bucket = join(cursorHome, "chats", cursorChatBucketId(oldPath));
    await mkdir(join(bucket, chatId), { recursive: true });
    await writeFile(
      join(bucket, chatId, "meta.json"),
      JSON.stringify({
        hasConversation: true,
        title: "Old path chat",
        cwd: oldPath,
        createdAtMs: 1_700_000_000_000,
        updatedAtMs: 1_700_000_200_000,
      }),
    );

    const threads = await listCursorThreads({
      projectPaths: ["/new/ToolSpec", oldPath],
      cursorHome,
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      provider: "cursor",
      id: chatId,
      name: "Old path chat",
      cwd: oldPath,
    });

    const transcript = join(
      cursorHome,
      "projects",
      cursorProjectSlug(oldPath),
      "agent-transcripts",
      chatId,
      `${chatId}.jsonl`,
    );
    await mkdir(dirname(transcript), { recursive: true });
    await writeFile(transcript, "{}\n");

    await expect(resolveCursorConversationPath(chatId, {
      cursorHome,
      cwdHint: oldPath,
    })).resolves.toBe(transcript);
  });
});
