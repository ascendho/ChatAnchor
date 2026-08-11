import type { ConversationProvider, ResumeTarget } from "@threadrelink/core";

export interface ResumeTerminalIdentity {
  provider: ConversationProvider;
  threadId: string;
  projectId: string;
  targetPath: string;
}

export interface ShowableTerminal {
  show(): void;
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
