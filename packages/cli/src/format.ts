import type {
  DoctorReport,
  MatchDecision,
  SyncResult,
} from "@threadrelink/core";

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
function truncate(value: string, length: number): string {
  const normalized = singleLine(value);
  return normalized.length <= length
    ? normalized
    : `${normalized.slice(0, Math.max(0, length - 1))}…`;
}

function title(decision: MatchDecision): string {
  return truncate(
    decision.thread.name
      ?? decision.thread.preview
      ?? decision.thread.id,
    54,
  );
}

export function formatDecision(
  decision: MatchDecision,
  includeEvidence = false,
): string {
  const timestamp = new Date(decision.thread.updatedAt * 1000)
    .toISOString()
    .slice(0, 10);
  const archived = decision.thread.archived ? " archived" : "";
  const confidence = decision.evidence[0]
    ? ` ${Math.round(decision.evidence[0].confidence * 100)}%`
    : "";
  const summary = `${decision.thread.id}  ${timestamp}${archived}  ${title(decision)}${confidence}`;
  if (!includeEvidence || !decision.evidence[0]) {
    return summary;
  }
  return `${summary}\n  ${decision.evidence[0].description}\n  old cwd: ${decision.thread.cwd}`;
}

export function formatSyncResult(
  result: SyncResult,
  options: { includeAll?: boolean } = {},
): string {
  const lines = [
    `ThreadRelink project: ${result.project.name} (${result.project.id})`,
    `Known paths: ${result.project.aliases.map((alias) => alias.path).join(", ")}`,
    `Linked: ${result.linked.length}  Suggested: ${result.suggested.length}  Unlinked: ${result.unlinked.length}`,
  ];

  if (result.linked.length > 0) {
    lines.push("", "Conversations");
    lines.push(...result.linked.map((item) => formatDecision(item)));
  }
  if (result.suggested.length > 0) {
    lines.push("", "Suggested links");
    lines.push(...result.suggested.map((item) => formatDecision(item, true)));
  }
  if (options.includeAll && result.unlinked.length > 0) {
    lines.push("", "Unlinked");
    lines.push(...result.unlinked.map((item) => formatDecision(item)));
  }
  return lines.join("\n");
}

export function formatDoctorReport(report: DoctorReport): string {
  return report.checks
    .map((check) => {
      const mark = check.status === "pass"
        ? "✓"
        : check.status === "warn"
          ? "!"
          : "✗";
      return `${mark} ${check.name}: ${check.message}`;
    })
    .join("\n");
}
