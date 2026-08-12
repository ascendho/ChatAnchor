import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadRelinkError } from "./errors.js";
import { normalizeAbsolutePath } from "./path.js";
import type { ConversationProvider } from "./types.js";

export type CompactTranscriptEventKind =
  | "user"
  | "assistant"
  | "tool"
  | "system";

export interface CompactTranscriptSource {
  provider: ConversationProvider;
  threadId: string;
  filePath: string;
  title?: string | null;
  cwd?: string | null;
}

export interface CompactTranscriptOptions {
  outputBaseDir?: string;
  generatedAt?: Date;
  maxOutputChars?: number;
  maxMessageChars?: number;
  maxToolOutputChars?: number;
}

export interface CompactTranscriptEvent {
  kind: CompactTranscriptEventKind;
  text: string;
  timestamp?: string | null;
  toolName?: string | null;
  command?: string | null;
  status?: string | null;
}

export interface CompactTranscriptParseStats {
  inputEvents: number;
  parsedEvents: number;
  invalidJsonLines: number;
  unknownEvents: number;
}

export interface CompactTranscriptResult {
  atPath: string;
  filePath: string;
  eventCount: number;
  omittedEvents: number;
  truncatedEvents: number;
}

interface ParseResult {
  events: CompactTranscriptEvent[];
  stats: CompactTranscriptParseStats;
}

interface RenderResult {
  markdown: string;
  omittedEvents: number;
  truncatedEvents: number;
}

const DEFAULT_MAX_OUTPUT_CHARS = 60_000;
const DEFAULT_MAX_MESSAGE_CHARS = 6_000;
const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 1_500;
const CARRY_OVER_LIMIT = 5;

function safeCompactTranscriptFilename(
  provider: ConversationProvider,
  threadId: string,
): string {
  const stem = threadId.trim().replace(/[^A-Za-z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
  const hash = createHash("sha256")
    .update(`${provider}:${threadId}`)
    .digest("hex")
    .slice(0, 10);
  return `chatanchor-compact-${provider}-${stem || "session"}-${hash}.md`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringField(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function numberOrStringField(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function nestedRecords(value: Record<string, unknown>): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const seen = new WeakSet<object>();
  const stack: Array<{ record: Record<string, unknown>; depth: number }> = [{
    record: value,
    depth: 0,
  }];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || seen.has(current.record)) {
      continue;
    }
    seen.add(current.record);
    records.push(current.record);
    if (current.depth >= 4) {
      continue;
    }
    for (const key of [
      "payload",
      "item",
      "event",
      "message",
      "msg",
      "data",
      "record",
      "response",
      "delta",
    ]) {
      const nested = asRecord(current.record[key]);
      if (nested) {
        stack.push({ record: nested, depth: current.depth + 1 });
      }
    }
  }
  return records;
}

function collectText(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): string[] {
  if (depth > 8 || value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [];
  }
  if (typeof value !== "object") {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectText(item, depth + 1, seen));
  }
  const record = value as Record<string, unknown>;
  const textKeys = [
    "text",
    "content",
    "message",
    "markdown",
    "summary",
    "input_text",
    "output_text",
    "transcript",
  ];
  const text: string[] = [];
  for (const key of textKeys) {
    if (key in record) {
      text.push(...collectText(record[key], depth + 1, seen));
    }
  }
  for (const key of ["parts", "items", "messages", "segments"]) {
    if (key in record) {
      text.push(...collectText(record[key], depth + 1, seen));
    }
  }
  return text;
}

function collectToolOutput(value: unknown): string {
  const record = asRecord(value);
  if (!record) {
    return collectText(value).join("\n\n");
  }
  const outputKeys = [
    "output",
    "stdout",
    "stderr",
    "aggregated_output",
    "formatted_output",
    "result",
    "error",
    "message",
    "content",
    "changes",
    "query",
    "action",
  ];
  const output: string[] = [];
  for (const key of outputKeys) {
    if (key in record) {
      output.push(...collectText(record[key]));
    }
  }
  return output.join("\n\n").trim();
}

function parseCommandArguments(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const direct = stringField(record, [
    "command",
    "cmd",
    "commandLine",
    "command_line",
    "shell_command",
  ]);
  if (direct) {
    return direct;
  }
  for (const key of ["arguments", "args", "input", "parameters"]) {
    const nested = record[key];
    const nestedRecord = asRecord(nested);
    if (nestedRecord) {
      const command = parseCommandArguments(nestedRecord);
      if (command) {
        return command;
      }
      continue;
    }
    if (typeof nested === "string" && nested.trim().length > 0) {
      try {
        const parsed = JSON.parse(nested) as unknown;
        const command = parseCommandArguments(parsed);
        if (command) {
          return command;
        }
      } catch {
        return nested.trim();
      }
    }
  }
  return null;
}

function eventText(value: Record<string, unknown>): string {
  return collectText(value).join("\n\n").trim();
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    })
    : [];
}

function compactStructuredValue(value: unknown): string {
  const text = collectText(value).join("\n\n").trim();
  if (text) {
    return text;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (
    typeof value === "number"
    || typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function classifyEvent(value: unknown): CompactTranscriptEvent | null {
  const root = asRecord(value);
  if (!root) {
    return null;
  }
  for (const candidate of nestedRecords(root)) {
    const role = stringField(candidate, ["role", "author", "speaker"]);
    const type = stringField(candidate, ["type", "kind", "event", "name"]);
    const label = `${role ?? ""} ${type ?? ""}`.toLowerCase();
    const timestamp = numberOrStringField(candidate, [
      "timestamp",
      "time",
      "created_at",
      "createdAt",
    ]);
    const toolName = stringField(candidate, [
      "toolName",
      "tool_name",
      "tool",
      "name",
      "function",
    ]);
    const command = parseCommandArguments(candidate);
    const status = numberOrStringField(candidate, [
      "status",
      "exitCode",
      "exit_code",
      "code",
    ]);

    if (
      role === "user"
      || label.includes("user_message")
      || label.includes("user-message")
      || label.includes("user message")
      || label.includes("usermessage")
    ) {
      const text = eventText(candidate);
      return text ? { kind: "user", text, timestamp } : null;
    }

    if (
      role === "assistant"
      || role === "agent"
      || label.includes("assistant")
      || label.includes("agent_message")
      || label.includes("agent-message")
      || label.includes("agentmessage")
    ) {
      const text = eventText(candidate);
      return text ? { kind: "assistant", text, timestamp } : null;
    }

    if (
      role === "system"
      || role === "developer"
      || label.includes("system")
      || label.includes("developer")
      || label.includes("compacted")
    ) {
      const text = eventText(candidate);
      return text ? { kind: "system", text, timestamp } : null;
    }

    if (
      role === "tool"
      || label.includes("tool")
      || label.includes("function_call")
      || label.includes("function-call")
      || label.includes("command")
      || label.includes("exec")
      || label.includes("patch")
      || label.includes("filechange")
      || label.includes("websearch")
      || command
    ) {
      const text = collectToolOutput(candidate);
      return {
        kind: "tool",
        text: text || command || toolName || "Tool call",
        timestamp,
        toolName,
        command,
        status,
      };
    }
  }
  return null;
}

function parseJsonl(raw: string): ParseResult {
  const stats: CompactTranscriptParseStats = {
    inputEvents: 0,
    parsedEvents: 0,
    invalidJsonLines: 0,
    unknownEvents: 0,
  };
  const events: CompactTranscriptEvent[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    stats.inputEvents += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      stats.invalidJsonLines += 1;
      continue;
    }
    const event = classifyEvent(parsed);
    if (event) {
      events.push(event);
      stats.parsedEvents += 1;
    } else {
      stats.unknownEvents += 1;
    }
  }
  return { events, stats };
}

function walkJsonEvents(
  value: unknown,
  events: CompactTranscriptEvent[],
  stats: CompactTranscriptParseStats,
  depth = 0,
  seen = new WeakSet<object>(),
): void {
  if (depth > 10 || value === null || value === undefined) {
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      walkJsonEvents(item, events, stats, depth + 1, seen);
    }
    return;
  }
  stats.inputEvents += 1;
  const event = classifyEvent(value);
  if (event) {
    events.push(event);
    stats.parsedEvents += 1;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["messages", "events", "items", "turns", "parts"]) {
    const nested = record[key];
    if (nested) {
      walkJsonEvents(nested, events, stats, depth + 1, seen);
    }
  }
}

function parseJson(raw: string): ParseResult {
  const stats: CompactTranscriptParseStats = {
    inputEvents: 0,
    parsedEvents: 0,
    invalidJsonLines: 0,
    unknownEvents: 0,
  };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const events: CompactTranscriptEvent[] = [];
    walkJsonEvents(parsed, events, stats);
    stats.unknownEvents = Math.max(0, stats.inputEvents - stats.parsedEvents);
    return { events, stats };
  } catch {
    stats.invalidJsonLines = 1;
    return { events: [], stats };
  }
}

function openCodeRoleKind(role: string | null): CompactTranscriptEventKind | null {
  if (role === "user") {
    return "user";
  }
  if (role === "assistant" || role === "agent") {
    return "assistant";
  }
  if (role === "system" || role === "developer") {
    return "system";
  }
  return null;
}

function openCodeMessageText(
  message: Record<string, unknown>,
  info: Record<string, unknown> | null,
  parts: Array<Record<string, unknown>>,
): string {
  const partText = parts
    .filter((part) => stringField(part, ["type"]) === "text")
    .flatMap((part) => collectText(part.text))
    .join("\n\n")
    .trim();
  if (partText) {
    return partText;
  }

  const directText = [
    ...collectText(message.text),
    ...collectText(message.content),
    ...collectText(message.message),
    ...collectText(info?.text),
    ...collectText(info?.content),
    ...collectText(info?.message),
  ].join("\n\n").trim();
  return directText;
}

function openCodeToolPartEvent(
  part: Record<string, unknown>,
): CompactTranscriptEvent | null {
  const type = stringField(part, ["type"]);
  if (type !== "tool") {
    return null;
  }
  const state = asRecord(part.state);
  const input = state?.input;
  const output = state?.output;
  const title = state ? stringField(state, ["title"]) : null;
  const toolName = stringField(part, ["tool"]) ?? stringField(part, ["name"]);
  const command = parseCommandArguments(input)
    ?? parseCommandArguments(state)
    ?? parseCommandArguments(part);
  const status = state
    ? numberOrStringField(state, ["status", "exitCode", "exit_code", "code"])
    : numberOrStringField(part, ["status", "exitCode", "exit_code", "code"]);
  const timestamp = state
    ? numberOrStringField(state, ["time", "timestamp", "created_at", "createdAt"])
    : numberOrStringField(part, ["time", "timestamp", "created_at", "createdAt"]);
  const inputPreview = command ? "" : compactStructuredValue(input);
  const outputPreview = compactStructuredValue(output);
  const text = [
    title,
    inputPreview ? `Input: ${inputPreview}` : null,
    outputPreview ? `Output: ${outputPreview}` : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n\n")
    .trim();

  return {
    kind: "tool",
    text: text || command || toolName || "OpenCode tool call",
    timestamp,
    toolName,
    command,
    status,
  };
}

function openCodePatchPartEvent(
  part: Record<string, unknown>,
): CompactTranscriptEvent | null {
  if (stringField(part, ["type"]) !== "patch") {
    return null;
  }
  const files = Array.isArray(part.files)
    ? part.files.flatMap((file) => {
      if (typeof file === "string" && file.trim()) {
        return [file.trim()];
      }
      const record = asRecord(file);
      const label = record
        ? stringField(record, ["path", "filename", "file", "name"])
        : null;
      return label ? [label] : [];
    })
    : [];
  const listed = files.slice(0, 20).join(", ");
  const suffix = files.length > 20 ? `, and ${files.length - 20} more` : "";
  return {
    kind: "tool",
    text: files.length > 0
      ? `Patch changed ${files.length} file(s): ${listed}${suffix}`
      : "Patch changed files.",
    toolName: "patch",
  };
}

function openCodeFilePartEvent(
  part: Record<string, unknown>,
): CompactTranscriptEvent | null {
  if (stringField(part, ["type"]) !== "file") {
    return null;
  }
  const filename = stringField(part, ["filename", "name", "path"])
    ?? "attached file";
  const mime = stringField(part, ["mime", "mimeType"]);
  const source = stringField(part, ["source", "url"]);
  return {
    kind: "system",
    text: [
      `Attached file: ${filename}`,
      mime ? `MIME: ${mime}` : null,
      source ? `Source: ${source}` : null,
    ].filter((line): line is string => typeof line === "string").join("\n"),
  };
}

function parseOpenCodeStructuredJson(parsed: unknown): ParseResult | null {
  const root = asRecord(parsed);
  const messages = root ? arrayRecords(root.messages) : [];
  if (!root || messages.length === 0) {
    return null;
  }

  const stats: CompactTranscriptParseStats = {
    inputEvents: 0,
    parsedEvents: 0,
    invalidJsonLines: 0,
    unknownEvents: 0,
  };
  const events: CompactTranscriptEvent[] = [];

  for (const message of messages) {
    stats.inputEvents += 1;
    const info = asRecord(message.info);
    const role = stringField(info ?? message, ["role", "author", "speaker"]);
    const timestamp = numberOrStringField(info ?? message, [
      "time",
      "timestamp",
      "created_at",
      "createdAt",
      "time_created",
      "timeCreated",
    ]);
    const parts = arrayRecords(message.parts);
    const kind = openCodeRoleKind(role);
    if (kind) {
      const text = openCodeMessageText(message, info, parts);
      if (text) {
        events.push({ kind, text, timestamp });
        stats.parsedEvents += 1;
      }
    } else {
      const event = classifyEvent(message);
      if (event) {
        events.push(event);
        stats.parsedEvents += 1;
      }
    }

    for (const part of parts) {
      stats.inputEvents += 1;
      const event = openCodeToolPartEvent(part)
        ?? openCodePatchPartEvent(part)
        ?? openCodeFilePartEvent(part);
      if (event) {
        events.push(event);
        stats.parsedEvents += 1;
      }
    }
  }

  stats.unknownEvents = Math.max(0, stats.inputEvents - stats.parsedEvents);
  return { events, stats };
}

function parseOpenCodeJson(raw: string): ParseResult {
  const stats: CompactTranscriptParseStats = {
    inputEvents: 0,
    parsedEvents: 0,
    invalidJsonLines: 0,
    unknownEvents: 0,
  };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const structured = parseOpenCodeStructuredJson(parsed);
    if (structured) {
      return structured;
    }
    return parseJson(raw);
  } catch {
    stats.invalidJsonLines = 1;
    return { events: [], stats };
  }
}

function parseRawTranscript(
  provider: ConversationProvider,
  raw: string,
): ParseResult {
  return provider === "opencode" ? parseOpenCodeJson(raw) : parseJsonl(raw);
}

export function parseCompactTranscriptEvents(
  provider: ConversationProvider,
  raw: string,
): CompactTranscriptEvent[] {
  return parseRawTranscript(provider, raw).events;
}

function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const head = Math.max(0, Math.floor(maxChars * 0.65));
  const tail = Math.max(0, maxChars - head - 120);
  return {
    text: `${text.slice(0, head).trimEnd()}\n\n[... truncated ${text.length - maxChars} chars ...]\n\n${text.slice(-tail).trimStart()}`,
    truncated: true,
  };
}

function oneLine(text: string, maxChars = 240): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length > maxChars
    ? `${compact.slice(0, maxChars - 1)}…`
    : compact;
}

function renderBulletEvents(
  label: string,
  events: CompactTranscriptEvent[],
): string[] {
  if (events.length === 0) {
    return [`- ${label}: none detected.`];
  }
  return [
    `- ${label}:`,
    ...events.map((event) => `  - ${oneLine(event.text)}`),
  ];
}

function renderToolSummary(events: CompactTranscriptEvent[]): string[] {
  const tools = events.filter((event) => event.kind === "tool")
    .slice(-CARRY_OVER_LIMIT);
  if (tools.length === 0) {
    return ["- Recent tools: none detected."];
  }
  return [
    "- Recent tools:",
    ...tools.map((event) => {
      const command = event.command ? ` \`${oneLine(event.command, 120)}\`` : "";
      const status = event.status ? ` status=${event.status}` : "";
      const output = oneLine(event.text, 120);
      return `  - ${event.toolName ?? "tool"}${command}${status}: ${output}`;
    }),
  ];
}

function renderEvent(
  event: CompactTranscriptEvent,
  index: number,
  options: Required<Pick<
    CompactTranscriptOptions,
    "maxMessageChars" | "maxToolOutputChars"
  >>,
): { markdown: string; truncated: boolean } {
  const limit = event.kind === "tool"
    ? options.maxToolOutputChars
    : options.maxMessageChars;
  const result = truncateText(event.text, limit);
  const title = event.kind === "tool"
    ? `${String(index + 1).padStart(3, "0")} Tool${event.toolName ? `: ${event.toolName}` : ""}`
    : `${String(index + 1).padStart(3, "0")} ${event.kind[0]?.toUpperCase() ?? ""}${event.kind.slice(1)}`;
  const metadata: string[] = [];
  if (event.timestamp) {
    metadata.push(`Time: ${event.timestamp}`);
  }
  if (event.command) {
    metadata.push(`Command: \`${event.command}\``);
  }
  if (event.status) {
    metadata.push(`Status: ${event.status}`);
  }
  return {
    markdown: [
      `### ${title}`,
      ...metadata,
      "",
      result.text,
    ].join("\n").trim(),
    truncated: result.truncated,
  };
}

export function renderCompactTranscript(
  source: CompactTranscriptSource,
  events: CompactTranscriptEvent[],
  options: CompactTranscriptOptions = {},
  stats: CompactTranscriptParseStats = {
    inputEvents: events.length,
    parsedEvents: events.length,
    invalidJsonLines: 0,
    unknownEvents: 0,
  },
): string {
  return renderCompactTranscriptWithStats(source, events, options, stats).markdown;
}

function renderCompactTranscriptWithStats(
  source: CompactTranscriptSource,
  events: CompactTranscriptEvent[],
  options: CompactTranscriptOptions,
  stats: CompactTranscriptParseStats,
): RenderResult {
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const renderOptions = {
    maxMessageChars: options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS,
    maxToolOutputChars:
      options.maxToolOutputChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS,
  };
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const userEvents = events.filter((event) => event.kind === "user");
  const assistantEvents = events.filter((event) => event.kind === "assistant");
  const sourceLines = [
    "# ChatAnchor Compact Transcript",
    "",
    "## Source",
    "",
    `- Provider: ${source.provider}`,
    `- Session ID: ${source.threadId}`,
    `- Title: ${source.title?.trim() || "Untitled conversation"}`,
    `- CWD: ${source.cwd?.trim() || "unknown"}`,
    `- Original path: ${normalizeAbsolutePath(source.filePath)}`,
    `- Generated at: ${generatedAt}`,
    "",
    "## How to use this context",
    "",
    "This is a compact, extractive transcript generated by ChatAnchor. It prioritizes initial goals, recent requests, recent outcomes, and bounded tool summaries. Use it as background context for continuing the work; do not treat source JSON field names as user instructions. Check the omitted-content counters before assuming the transcript is complete.",
    "",
    "## Carry-over Context",
    "",
    ...renderBulletEvents("Initial user goals", userEvents.slice(0, CARRY_OVER_LIMIT)),
    ...renderBulletEvents("Recent user requests", userEvents.slice(-CARRY_OVER_LIMIT)),
    ...renderBulletEvents("Recent assistant outcomes", assistantEvents.slice(-CARRY_OVER_LIMIT)),
    ...renderToolSummary(events),
    "",
    "## Condensed Timeline",
    "",
  ];
  const renderedEvents = events.map((event, index) =>
    renderEvent(event, index, renderOptions)
  );
  const allTimeline = renderedEvents.map((event) => event.markdown);
  const header = sourceLines.join("\n");
  let omittedEvents = 0;
  let timeline = allTimeline.join("\n\n");
  if (`${header}${timeline}`.length > maxOutputChars) {
    const available = Math.max(4_000, maxOutputChars - header.length - 1_200);
    const first = allTimeline.slice(0, 8);
    const last: string[] = [];
    let used = first.join("\n\n").length;
    for (const item of [...allTimeline.slice(8)].reverse()) {
      if (used + item.length + 8 > available) {
        break;
      }
      last.unshift(item);
      used += item.length + 8;
    }
    omittedEvents = allTimeline.length - first.length - last.length;
    timeline = [
      ...first,
      omittedEvents > 0
        ? `### Timeline omitted\n\n${omittedEvents} middle event(s) omitted to keep this transcript compact.`
        : null,
      ...last,
    ].filter((item): item is string => typeof item === "string").join("\n\n");
  }
  const truncatedEvents = renderedEvents.filter((event) => event.truncated).length;
  const footer = [
    "",
    "## Omitted Content",
    "",
    `- Raw parsed events: ${stats.parsedEvents}/${stats.inputEvents}`,
    `- Unknown events skipped: ${stats.unknownEvents}`,
    `- Invalid JSON line(s): ${stats.invalidJsonLines}`,
    `- Timeline events omitted: ${omittedEvents}`,
    `- Events with truncated text: ${truncatedEvents}`,
  ].join("\n");
  return {
    markdown: `${header}${timeline}${footer}\n`,
    omittedEvents,
    truncatedEvents,
  };
}

export async function writeCompactTranscriptFromFile(
  source: CompactTranscriptSource,
  options: CompactTranscriptOptions = {},
): Promise<CompactTranscriptResult> {
  const filePath = normalizeAbsolutePath(source.filePath);
  const raw = await readFile(filePath, "utf8");
  const parsed = parseRawTranscript(source.provider, raw);
  if (parsed.events.length === 0) {
    throw new ThreadRelinkError(
      "COMPACT_TRANSCRIPT_EMPTY",
      `ChatAnchor could not find readable conversation events in this ${source.provider} transcript.`,
    );
  }
  const renderResult = renderCompactTranscriptWithStats(
    { ...source, filePath },
    parsed.events,
    options,
    parsed.stats,
  );
  const baseDir = normalizeAbsolutePath(options.outputBaseDir ?? tmpdir());
  const outputDir = join(baseDir, "chatanchor-compact-transcripts");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(
    outputDir,
    safeCompactTranscriptFilename(source.provider, source.threadId),
  );
  const tempPath = join(
    outputDir,
    `${safeCompactTranscriptFilename(source.provider, source.threadId)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, renderResult.markdown, "utf8");
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  return {
    atPath: `@${outputPath}`,
    filePath: outputPath,
    eventCount: parsed.events.length,
    omittedEvents: renderResult.omittedEvents,
    truncatedEvents: renderResult.truncatedEvents,
  };
}
