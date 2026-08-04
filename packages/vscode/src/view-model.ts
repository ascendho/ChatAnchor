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

const SHORT_TITLE_MAX = 48;
const DISPLAY_LABEL_MAX = 40;

function codePoints(value: string): string[] {
  return [...value];
}

function truncateLabel(value: string, max = DISPLAY_LABEL_MAX): string {
  const points = codePoints(value);
  if (points.length <= max) {
    return value;
  }
  return `${points.slice(0, Math.max(1, max - 1)).join("")}…`;
}

function cleanConversationText(value: string): string {
  return value
    .replace(/!\[[\s\S]*?\]\([^)]*\)/gu, " ")
    .replace(/\[Image\s*#?\d+\]/giu, " ")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function firstSentence(value: string): string {
  const match = /^([\s\S]*?)(?:[。！？\n]|[.!?](?=\s|$)|$)/u.exec(value);
  const sentence = match?.[1]?.trim() || value.trim();
  return sentence || value.trim();
}

/** Compact sidebar label from metadata only (never reads message bodies). */
export function formatConversationLabel(
  name: string | null | undefined,
  preview: string | null | undefined,
  id: string,
): string {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (trimmedName) {
    const cleanedName = cleanConversationText(trimmedName);
    if (cleanedName && codePoints(cleanedName).length <= SHORT_TITLE_MAX) {
      return cleanedName;
    }
    if (cleanedName) {
      return truncateLabel(firstSentence(cleanedName));
    }
  }

  const trimmedPreview = typeof preview === "string" ? preview.trim() : "";
  if (trimmedPreview) {
    const cleanedPreview = cleanConversationText(trimmedPreview);
    if (cleanedPreview) {
      return truncateLabel(firstSentence(cleanedPreview));
    }
  }

  const shortId = id.trim();
  if (!shortId) {
    return "Untitled conversation";
  }
  return codePoints(shortId).slice(0, 8).join("");
}

export function conversationLabel(decision: MatchDecision): string {
  return formatConversationLabel(
    decision.thread.name,
    decision.thread.preview,
    decision.thread.id,
  );
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
