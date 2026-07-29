import { describe, expect, it } from "vitest";
import { formatSyncResult } from "../src/format.js";
import type { SyncResult } from "@threadrelink/core";

describe("CLI formatting", () => {
  it("prints linked and suggested conversations without full transcript text", () => {
    const result: SyncResult = {
      project: {
        id: "project-1",
        name: "FinSpec",
        kind: "git",
        aliases: [
          {
            path: "/repo/FinSpec",
            key: "/repo/FinSpec",
            firstSeenAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        remotes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      linked: [
        {
          thread: {
            provider: "codex",
            id: "thread-1",
            name: "Implement FinSpec",
            preview: "Implement FinSpec",
            cwd: "/repo/ToolSpec",
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            cliVersion: "0.145.0",
            modelProvider: "openai",
            gitInfo: null,
          },
          status: "linked",
          projectId: "project-1",
          evidence: [],
          relativeCwd: null,
        },
      ],
      suggested: [],
      ignored: [],
      unlinked: [],
      relocationReport: null,
      scannedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(formatSyncResult(result)).toContain("Implement FinSpec");
    expect(formatSyncResult(result)).toContain("thread-1");
    expect(formatSyncResult(result)).not.toContain("\nUnlinked\n");
  });

  it("prints relocation and ignored metadata when requested", () => {
    const ignoredDecision = {
      thread: {
        provider: "codex" as const,
        id: "thread-ignored",
        name: "Ignored conversation",
        preview: "Ignored conversation",
        cwd: "/repo/ToolSpec",
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        cliVersion: "0.145.0",
        modelProvider: "openai",
        gitInfo: null,
      },
      status: "ignored" as const,
      projectId: "project-1",
      evidence: [{
        kind: "user-ignored" as const,
        confidence: 1,
        description: "User explicitly removed this conversation.",
      }],
      relativeCwd: null,
    };
    const result: SyncResult = {
      project: {
        id: "project-1",
        name: "FinSpec",
        kind: "git",
        aliases: [],
        remotes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      linked: [],
      suggested: [],
      ignored: [ignoredDecision],
      unlinked: [],
      relocationReport: {
        projectId: "project-1",
        projectName: "FinSpec",
        previousPath: "/repo/ToolSpec",
        currentPath: "/repo/FinSpec",
        detectedAt: "2026-07-29T00:00:00.000Z",
        linkedThreads: 0,
        preservedSubdirectories: 0,
        fallbackThreads: 0,
        conversations: [],
      },
      scannedAt: "2026-07-29T00:00:00.000Z",
    };

    const output = formatSyncResult(result, { includeIgnored: true });
    expect(output).toContain(
      "New project location: /repo/ToolSpec -> /repo/FinSpec",
    );
    expect(output).toContain("Ignored conversation");
  });
});
