import { describe, expect, it } from "vitest";
import { buildAgentHandoffPrompt } from "../src/handoff-prompt.js";

describe("agent handoff prompt", () => {
  it("asks the target agent to inspect and plan before changing the project", () => {
    const prompt = buildAgentHandoffPrompt(
      "codex",
      "@/tmp/handoffs/example/handoff.md",
    );

    expect(prompt).toContain("First, read @/tmp/handoffs/example/handoff.md.");
    expect(prompt).toContain("inspect the current project state");
    expect(prompt).toContain("propose a concrete plan");
    expect(prompt).toContain("Do not edit files, install dependencies, commit changes");
    expect(prompt).toContain("Wait for the user's approval");
    expect(prompt).toContain("full-transcript.md or files under original/");
    expect(prompt).toContain("Do not read all historical material indiscriminately");
  });
});
