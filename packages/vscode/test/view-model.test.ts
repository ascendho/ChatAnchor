import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  conversationLabel,
  formatConversationLabel,
  formatRelocationReport,
  relativeDate,
} from "../src/view-model.js";
import type { MatchDecision } from "@threadrelink/core";

function decision(overrides: Partial<MatchDecision["thread"]> = {}): MatchDecision {
  return {
    thread: {
      provider: "codex",
      id: "thread-1",
      name: "A conversation title",
      preview: "A conversation preview",
      cwd: "/repo/ToolSpec",
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "0.145.0",
      modelProvider: "openai",
      gitInfo: null,
      ...overrides,
    },
    status: "suggested",
    projectId: "project-1",
    evidence: [
      {
        kind: "git-remote",
        confidence: 0.72,
        description: "Remote matches.",
      },
    ],
    relativeCwd: null,
  };
}

describe("VS Code view model", () => {
  it("uses metadata-only titles and confidence labels", () => {
    expect(conversationLabel(decision())).toBe("A conversation title");
    expect(confidenceLabel(decision())).toBe("72% match");
  });

  it("keeps short Cursor-style titles as-is", () => {
    expect(formatConversationLabel(
      "Project Conversation Location",
      "Project Conversation Location",
      "a4efc723-68f4-45f5-8474-952597e995e8",
    )).toBe("Project Conversation Location");
  });

  it("shortens long Codex previews and strips image noise", () => {
    const preview = [
      "你先阅读此项目，然后： 1. [Image #1] 如图所示，这是 bug 吗？",
      "还是没有因为没有重启 vs code? 我不知道这个现象在以后是否还复现。",
    ].join(" ");
    const label = formatConversationLabel(null, preview, "thread-long");
    expect(label).not.toContain("[Image");
    expect(label.length).toBeLessThanOrEqual(41);
    expect(label.endsWith("…") || label.includes("你先阅读")).toBe(true);
    expect(conversationLabel(decision({
      name: null,
      preview,
      id: "thread-long",
    }))).toBe(label);
  });

  it("uses the first sentence when preview is multi-sentence", () => {
    expect(formatConversationLabel(
      null,
      "Fix the matcher. Then update docs and publish.",
      "thread-2",
    )).toBe("Fix the matcher");
  });

  it("falls back to a short id when name and preview are empty", () => {
    expect(formatConversationLabel(null, "", "abcdef12-3456-7890")).toBe("abcdef12");
  });

  it("formats recent dates compactly", () => {
    const now = Date.UTC(2026, 6, 27);
    expect(relativeDate(now / 1000, now)).toBe("today");
    expect(relativeDate((now - 86_400_000) / 1000, now)).toBe("yesterday");
  });

  it("formats a metadata-only relocation report", () => {
    const report = formatRelocationReport({
      projectId: "project-1",
      projectName: "FinSpec",
      previousPath: "/repo/ToolSpec",
      currentPath: "/repo/FinSpec",
      detectedAt: "2026-07-29T00:00:00.000Z",
      linkedThreads: 1,
      preservedSubdirectories: 1,
      fallbackThreads: 0,
      conversations: [{
        threadId: "thread-1",
        title: "A conversation title",
        originalCwd: "/repo/ToolSpec/packages/api",
        relativeCwd: "packages/api",
        targetPath: "/repo/FinSpec/packages/api",
        targetMode: "preserved-subdirectory",
        evidence: "Known project path.",
      }],
    });

    expect(report).toContain("Previous path: /repo/ToolSpec");
    expect(report).toContain("Resume target: /repo/FinSpec/packages/api");
    expect(report).not.toContain("message body");
  });
});
