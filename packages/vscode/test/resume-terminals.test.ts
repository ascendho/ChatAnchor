import { describe, expect, it } from "vitest";
import {
  findExistingResumeTerminal,
  isActiveResumeTerminal,
  RESUME_TERMINAL_ENV_KEY,
  ResumeTerminalRegistry,
  resumeTerminalEnv,
  resumeTerminalIdentity,
  resumeTerminalKey,
  resumeTerminalToken,
  type ResumableTerminal,
} from "../src/resume-terminals.js";
import type { ResumeTarget } from "@threadrelink/core";

class FakeTerminal implements ResumableTerminal {
  public shown = 0;

  public constructor(
    public readonly creationOptions?: ResumableTerminal["creationOptions"],
    public readonly exitStatus?: unknown,
  ) {}

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

  it("hashes the terminal identity for environment tagging", () => {
    const identity = resumeTerminalIdentity("codex", target());

    expect(resumeTerminalEnv(identity)).toEqual({
      [RESUME_TERMINAL_ENV_KEY]: resumeTerminalToken(identity),
    });
    expect(resumeTerminalToken(identity)).toMatch(/^[a-f0-9]{64}$/u);
    expect(resumeTerminalToken(identity)).not.toContain(identity.targetPath);
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

  it("finds an active terminal by resume environment token", () => {
    const identity = resumeTerminalIdentity("codex", target());
    const terminal = new FakeTerminal({
      env: resumeTerminalEnv(identity),
    });
    const other = new FakeTerminal({
      env: resumeTerminalEnv(resumeTerminalIdentity("codex", target({
        threadId: "thread-2",
      }))),
    });

    expect(findExistingResumeTerminal([other, terminal], identity))
      .toBe(terminal);
  });

  it("finds an active legacy terminal by command options", () => {
    const identity = resumeTerminalIdentity("codex", target());
    const shellArgs = ["resume", "--cd", target().path, target().threadId];
    const terminal = new FakeTerminal({
      shellPath: "/opt/homebrew/bin/codex",
      shellArgs,
      cwd: { fsPath: target().path },
    });

    expect(findExistingResumeTerminal([terminal], identity, {
      shellPath: "/opt/homebrew/bin/codex",
      shellArgs,
      cwd: target().path,
    })).toBe(terminal);
  });

  it("does not reuse exited terminals", () => {
    const identity = resumeTerminalIdentity("codex", target());
    const terminal = new FakeTerminal(
      { env: resumeTerminalEnv(identity) },
      { code: 1 },
    );

    expect(isActiveResumeTerminal(terminal)).toBe(false);
    expect(findExistingResumeTerminal([terminal], identity)).toBeUndefined();
  });

  it("does not match different resume commands", () => {
    const terminal = new FakeTerminal({
      shellPath: "/opt/homebrew/bin/codex",
      shellArgs: ["resume", "--cd", target().path, target().threadId],
      cwd: target().path,
    });

    expect(findExistingResumeTerminal([terminal], resumeTerminalIdentity(
      "codex",
      target({ threadId: "thread-2" }),
    ), {
      shellPath: "/opt/homebrew/bin/codex",
      shellArgs: ["resume", "--cd", target().path, "thread-2"],
      cwd: target().path,
    })).toBeUndefined();
    expect(findExistingResumeTerminal([terminal], resumeTerminalIdentity(
      "codex",
      target({ path: "/repo/ChatAnchor/packages/core" }),
    ), {
      shellPath: "/opt/homebrew/bin/codex",
      shellArgs: [
        "resume",
        "--cd",
        "/repo/ChatAnchor/packages/core",
        target().threadId,
      ],
      cwd: "/repo/ChatAnchor/packages/core",
    })).toBeUndefined();
  });
});
