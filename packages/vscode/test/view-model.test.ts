import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  conversationLabel,
  formatRelocationReport,
  relativeDate,
} from "../src/view-model.js";
import type { MatchDecision } from "@threadrelink/core";

function decision(): MatchDecision {
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
