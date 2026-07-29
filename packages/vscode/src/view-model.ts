import type {
  MatchDecision,
  ProjectProbe,
  RelocationReport,
  SyncResult,
} from "@threadrelink/core";

export interface WorkspaceResult {
  name: string;
  path: string;
  probe: ProjectProbe | null;
  sync: SyncResult | null;
  error: string | null;
}

export function conversationLabel(decision: MatchDecision): string {
  const value = (decision.thread.name ?? decision.thread.preview ?? decision.thread.id)
    .replace(/\s+/gu, " ")
    .trim();
  return value.length <= 72 ? value : `${value.slice(0, 71)}…`;
}

export function confidenceLabel(decision: MatchDecision): string | undefined {
  const evidence = decision.evidence[0];
  return evidence
    ? `${Math.round(evidence.confidence * 100)}% match`
    : undefined;
}

export function relativeDate(unixSeconds: number, now = Date.now()): string {
  const deltaDays = Math.floor((now - unixSeconds * 1000) / 86_400_000);
  if (deltaDays <= 0) {
    return "today";
  }
  if (deltaDays === 1) {
    return "yesterday";
  }
  if (deltaDays < 30) {
    return `${deltaDays}d ago`;
  }
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function formatRelocationReport(report: RelocationReport): string {
  const lines = [
    `Project location detected: ${report.projectName}`,
    `Previous path: ${report.previousPath}`,
    `Current path: ${report.currentPath}`,
    `Linked conversations: ${report.linkedThreads}`,
    `Preserved subdirectories: ${report.preservedSubdirectories}`,
    `Root fallbacks: ${report.fallbackThreads}`,
  ];
  for (const conversation of report.conversations) {
    lines.push(
      "",
      conversation.title,
      `  Thread: ${conversation.threadId}`,
      `  Original cwd: ${conversation.originalCwd}`,
      `  Resume target: ${conversation.targetPath}`,
      `  Target mode: ${conversation.targetMode}`,
    );
    if (conversation.evidence) {
      lines.push(`  Evidence: ${conversation.evidence}`);
    }
  }
  return lines.join("\n");
}
