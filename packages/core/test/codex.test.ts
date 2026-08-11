import { describe, expect, it } from "vitest";
import {
  buildCodexResumeArgs,
  resolveCodexPath,
} from "../src/codex.js";

describe("Codex CLI", () => {
  it("builds resume args for codex resume --cd", () => {
    expect(resolveCodexPath()).toBe("codex");
    expect(resolveCodexPath("/opt/codex")).toBe("/opt/codex");
    expect(buildCodexResumeArgs(
      "019feff8-9bd4-74b2-bb54-1d8e38be037b",
      "/Users/ascendho/Downloads/repo/ChatAnchor",
    )).toEqual([
      "resume",
      "--cd",
      "/Users/ascendho/Downloads/repo/ChatAnchor",
      "019feff8-9bd4-74b2-bb54-1d8e38be037b",
    ]);
  });
});
