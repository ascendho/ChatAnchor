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
      unlinked: [],
      scannedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(formatSyncResult(result)).toContain("Implement FinSpec");
    expect(formatSyncResult(result)).toContain("thread-1");
    expect(formatSyncResult(result)).not.toContain("\nUnlinked\n");
  });
});
