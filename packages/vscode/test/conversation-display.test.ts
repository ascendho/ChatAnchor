import { describe, expect, it } from "vitest";
import {
  hiddenConversationCount,
  hiddenForProvider,
  isHiddenConversation,
  linkedForProvider,
} from "../src/conversation-display.js";
import type { ConversationProvider, MatchDecision } from "@threadrelink/core";
import type { WorkspaceResult } from "../src/view-model.js";

function decision(
  provider: ConversationProvider,
  id: string,
  hidden = false,
): MatchDecision {
  return {
    thread: {
      provider,
      id,
      name: id,
      preview: id,
      cwd: "/repo/ChatAnchor",
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      cliVersion: "",
      modelProvider: provider,
      gitInfo: null,
    },
    status: "linked",
    projectId: "project-1",
    evidence: [],
    relativeCwd: null,
    display: {
      customLabel: null,
      hidden,
    },
  };
}

function workspace(linked: MatchDecision[]): WorkspaceResult {
  return {
    name: "ChatAnchor",
    path: "/repo/ChatAnchor",
    probe: null,
    sync: {
      project: {
        id: "project-1",
        name: "ChatAnchor",
        kind: "git",
        aliases: [],
        remotes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      linked,
      suggested: [],
      ignored: [],
      unlinked: [],
      relocationReport: null,
      scannedAt: "2026-01-01T00:00:00.000Z",
    },
    error: null,
  };
}

describe("conversation display helpers", () => {
  it("filters hidden conversations unless show hidden is enabled", () => {
    const visible = decision("opencode", "visible");
    const hidden = decision("opencode", "hidden", true);
    const otherProvider = decision("codex", "codex-hidden", true);
    const result = workspace([visible, hidden, otherProvider]);

    expect(isHiddenConversation(hidden)).toBe(true);
    expect(linkedForProvider(result, "opencode", false).map((item) =>
      item.thread.id
    )).toEqual(["visible"]);
    expect(linkedForProvider(result, "opencode", true).map((item) =>
      item.thread.id
    )).toEqual(["visible", "hidden"]);
    expect(hiddenForProvider(result, "opencode").map((item) => item.thread.id))
      .toEqual(["hidden"]);
    expect(hiddenConversationCount(result)).toBe(2);
  });
});
