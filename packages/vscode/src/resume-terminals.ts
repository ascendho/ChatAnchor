import { createHash } from "node:crypto";
import type { ConversationProvider, ResumeTarget } from "@threadrelink/core";

export const RESUME_TERMINAL_ENV_KEY = "THREADRELINK_RESUME_KEY";

export interface ResumeTerminalIdentity {
  provider: ConversationProvider;
  threadId: string;
  projectId: string;
  targetPath: string;
}

export interface ShowableTerminal {
  show(): void;
}

export interface ResumeTerminalCommand {
  shellPath: string;
  shellArgs: string[];
  cwd: string;
}

interface TerminalCreationOptions {
  shellPath?: string;
  shellArgs?: string[] | string;
  cwd?: string | { fsPath?: string; path?: string };
  env?: Record<string, string | null | undefined>;
  pty?: unknown;
}

export interface ResumableTerminal extends ShowableTerminal {
  readonly creationOptions?: Readonly<TerminalCreationOptions>;
  readonly exitStatus?: unknown;
}

export function resumeTerminalKey(identity: ResumeTerminalIdentity): string {
  return [
    identity.provider,
    identity.projectId,
    identity.threadId,
    identity.targetPath,
  ].join("\0");
}

export function resumeTerminalIdentity(
  provider: ConversationProvider,
  target: ResumeTarget,
): ResumeTerminalIdentity {
  return {
    provider,
    threadId: target.threadId,
    projectId: target.projectId,
    targetPath: target.path,
  };
}

export function resumeTerminalToken(identity: ResumeTerminalIdentity): string {
  return createHash("sha256").update(resumeTerminalKey(identity)).digest("hex");
}

export function resumeTerminalEnv(
  identity: ResumeTerminalIdentity,
): Record<string, string> {
  return {
    [RESUME_TERMINAL_ENV_KEY]: resumeTerminalToken(identity),
  };
}

export function isActiveResumeTerminal(
  terminal: ResumableTerminal,
): boolean {
  return terminal.exitStatus === undefined;
}

function cwdToString(
  cwd: TerminalCreationOptions["cwd"],
): string | undefined {
  if (typeof cwd === "string") {
    return cwd;
  }
  if (cwd && typeof cwd.fsPath === "string") {
    return cwd.fsPath;
  }
  if (cwd && typeof cwd.path === "string") {
    return cwd.path;
  }
  return undefined;
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function terminalMatchesResumeIdentity(
  terminal: ResumableTerminal,
  identity: ResumeTerminalIdentity,
): boolean {
  return terminal.creationOptions?.env?.[RESUME_TERMINAL_ENV_KEY]
    === resumeTerminalToken(identity);
}

export function terminalMatchesResumeCommand(
  terminal: ResumableTerminal,
  command: ResumeTerminalCommand,
): boolean {
  const options = terminal.creationOptions;
  if (!options || typeof options.shellPath !== "string") {
    return false;
  }
  if (!Array.isArray(options.shellArgs)) {
    return false;
  }
  return options.shellPath === command.shellPath
    && stringArraysEqual(options.shellArgs, command.shellArgs)
    && cwdToString(options.cwd) === command.cwd;
}

export function findExistingResumeTerminal<Terminal extends ResumableTerminal>(
  terminals: readonly Terminal[],
  identity: ResumeTerminalIdentity,
  command?: ResumeTerminalCommand,
): Terminal | undefined {
  const activeTerminals = terminals.filter(isActiveResumeTerminal);
  const byIdentity = activeTerminals.find((terminal) =>
    terminalMatchesResumeIdentity(terminal, identity)
  );
  if (byIdentity) {
    return byIdentity;
  }
  if (!command) {
    return undefined;
  }
  return activeTerminals.find((terminal) =>
    terminalMatchesResumeCommand(terminal, command)
  );
}

export class ResumeTerminalRegistry<Terminal extends ShowableTerminal> {
  private readonly terminals = new Map<string, Terminal>();

  public get(identity: ResumeTerminalIdentity): Terminal | undefined {
    return this.terminals.get(resumeTerminalKey(identity));
  }

  public set(identity: ResumeTerminalIdentity, terminal: Terminal): void {
    this.terminals.set(resumeTerminalKey(identity), terminal);
  }

  public deleteTerminal(terminal: Terminal): void {
    for (const [key, candidate] of this.terminals) {
      if (candidate === terminal) {
        this.terminals.delete(key);
      }
    }
  }
}
