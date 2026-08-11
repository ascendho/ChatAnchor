import { describe, expect, it } from "vitest";
import {
  ResumeTerminalRegistry,
  resumeTerminalIdentity,
  resumeTerminalKey,
  type ShowableTerminal,
} from "../src/resume-terminals.js";
import type { ResumeTarget } from "@threadrelink/core";

class FakeTerminal implements ShowableTerminal {
  public shown = 0;

  public show(): void {
    this.shown += 1;
  }
}

function target(overrides: Partial<ResumeTarget> = {}): ResumeTarget {
  return {
    threadId: "thread-1",
    projectId: "project-1",
    projectRoot: "/repo/ChatAnchor",
    path: "/repo/ChatAnchor",
    relativeCwd: null,
    mode: "project-root",
    warning: null,
    ...overrides,
  };
}

describe("Resume terminal registry", () => {
  it("keys resume terminals by provider, project, thread, and target path", () => {
    expect(resumeTerminalKey(
      resumeTerminalIdentity("codex", target()),
    )).toBe("codex\0project-1\0thread-1\0/repo/ChatAnchor");
  });

  it("reuses the same active terminal for the same resume target", () => {
    const registry = new ResumeTerminalRegistry<FakeTerminal>();
    const identity = resumeTerminalIdentity("codex", target());
    const terminal = new FakeTerminal();

    registry.set(identity, terminal);
    const existing = registry.get(identity);
    existing?.show();

    expect(existing).toBe(terminal);
    expect(terminal.shown).toBe(1);
  });

  it("does not collide across providers, threads, or target paths", () => {
    const registry = new ResumeTerminalRegistry<FakeTerminal>();
    const codexTerminal = new FakeTerminal();
    registry.set(resumeTerminalIdentity("codex", target()), codexTerminal);

    expect(registry.get(resumeTerminalIdentity("cursor", target())))
      .toBeUndefined();
    expect(registry.get(resumeTerminalIdentity("codex", target({
      threadId: "thread-2",
    })))).toBeUndefined();
    expect(registry.get(resumeTerminalIdentity("codex", target({
      path: "/repo/ChatAnchor/packages/core",
    })))).toBeUndefined();
  });

  it("forgets a terminal after it closes", () => {
    const registry = new ResumeTerminalRegistry<FakeTerminal>();
    const identity = resumeTerminalIdentity("codex", target());
    const terminal = new FakeTerminal();

    registry.set(identity, terminal);
    registry.deleteTerminal(terminal);

    expect(registry.get(identity)).toBeUndefined();
  });
});
