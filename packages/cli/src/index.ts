#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  buildProjectContextPack,
  deleteProjectContextPack,
  errorMessage,
  readProjectContextPackManifest,
  resolveProjectContextPackPath,
  searchProjectContextPack,
  ThreadRelinkError,
  ThreadRelinkService,
  type ConversationProvider,
} from "@threadrelink/core";

const EXIT_USAGE = 2;
const EXIT_PROJECT = 3;
const EXIT_SOURCE = 4;
const EXIT_CONSENT = 5;
const EXIT_PACK = 6;

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1_024 && index < units.length - 1) {
    value /= 1_024;
    index += 1;
  }
  return `${index === 0 ? value : value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function usage(): never {
  console.error(`Usage:
  chatanchor context build --cwd <path> --thread <provider:id>... [--yes]
  chatanchor context list --cwd <path>
  chatanchor context path --cwd <path>
  chatanchor context search --cwd <path> --query <text> [--limit 5]
  chatanchor context delete --cwd <path> [--yes]`);
  process.exit(EXIT_USAGE);
}

function values(args: string[], name: string): string[] {
  const output: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      output.push(args[index + 1] as string);
      index += 1;
    }
  }
  return output;
}

function value(args: string[], name: string): string | undefined {
  return values(args, name).at(-1);
}

async function confirm(message: string, yes: boolean): Promise<boolean> {
  if (yes) {
    return true;
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    return false;
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    return /^y(?:es)?$/iu.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function parseThread(reference: string): {
  provider: ConversationProvider;
  threadId: string;
} {
  const separator = reference.indexOf(":");
  const provider = reference.slice(0, separator);
  const threadId = reference.slice(separator + 1);
  if (
    separator < 1
    || !["codex", "cursor", "opencode"].includes(provider)
    || !threadId
  ) {
    throw new ThreadRelinkError(
      "CONTEXT_PACK_INVALID_SOURCE",
      `Invalid conversation reference “${reference}”; use provider:id.`,
    );
  }
  return { provider: provider as ConversationProvider, threadId };
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] !== "context" || !args[1]) {
    usage();
  }
  const action = args[1];
  if (!["build", "list", "path", "search", "delete"].includes(action)) {
    usage();
  }
  const cwd = value(args, "--cwd") ?? process.cwd();
  const yes = args.includes("--yes");
  const service = new ThreadRelinkService();
  const info = await service.listProjectContextSources(cwd);

  if (action === "list") {
    for (const source of info.sources) {
      console.log(`${source.provider}:${source.id}\t${source.name ?? source.preview ?? source.id}`);
    }
    return;
  }

  if (action === "build") {
    const references = values(args, "--thread");
    if (references.length === 0) {
      throw new ThreadRelinkError(
        "CONTEXT_PACK_SOURCE_COUNT",
        "Build requires at least one --thread provider:id argument.",
      );
    }
    if (!(await confirm(
      "Read the selected local conversations and prepare a complete, unredacted project context pack? It can include credentials, cookies, absolute paths, system/developer messages, and full tool output. Nothing is uploaded.",
      yes,
    ))) {
      console.error("Context pack creation was not confirmed. Pass --yes for non-interactive use.");
      process.exit(EXIT_CONSENT);
    }
    const selected = references.map(parseThread);
    const sources = [];
    for (const source of selected) {
      sources.push(await service.readProjectContextSource(
        cwd,
        source.provider,
        source.threadId,
      ));
    }
    const sourceBytes = sources.reduce(
      (sum, source) => sum + source.estimatedBytes,
      0,
    );
    if (!(await confirm(
      `Build from ${sources.length} conversation(s) totaling ${formatBytes(sourceBytes)}? Originals plus readable transcripts may require about ${formatBytes(sourceBytes * 2 + 10 * 1_024 * 1_024)}.`,
      yes,
    ))) {
      console.error("Context pack creation was not confirmed.");
      process.exit(EXIT_CONSENT);
    }
    const result = await buildProjectContextPack({
      projectId: info.project.id,
      projectName: info.project.name,
      projectRoot: info.projectRoot,
      sources,
      registryHome: service.registry.home,
    });
    console.log(result.atPath);
    return;
  }

  if (action === "path") {
    await readProjectContextPackManifest(info.project.id, service.registry.home);
    console.log(`@${resolveProjectContextPackPath(info.project.id, service.registry.home)}/context.md`);
    return;
  }

  if (action === "search") {
    const query = value(args, "--query");
    if (!query) {
      usage();
    }
    const rawLimit = value(args, "--limit");
    const limit = rawLimit === undefined ? 5 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new ThreadRelinkError(
        "CONTEXT_PACK_INVALID_LIMIT",
        "--limit must be an integer between 1 and 20.",
      );
    }
    const result = await searchProjectContextPack({
      projectId: info.project.id,
      query,
      limit,
      registryHome: service.registry.home,
    });
    console.log(result.atPath);
    return;
  }

  if (action === "delete") {
    await readProjectContextPackManifest(info.project.id, service.registry.home);
    if (!(await confirm("Delete this project's generated context pack?", yes))) {
      console.error("Context pack deletion was not confirmed. Pass --yes for non-interactive use.");
      process.exit(EXIT_CONSENT);
    }
    await deleteProjectContextPack(info.project.id, service.registry.home);
    console.log(`Deleted context pack for ${info.project.name}.`);
    return;
  }

  usage();
}

try {
  await run();
} catch (error) {
  console.error(`ChatAnchor: ${errorMessage(error)}`);
  if (error instanceof ThreadRelinkError) {
    if (error.code.includes("PROJECT")) {
      process.exit(EXIT_PROJECT);
    }
    if (error.code.includes("SOURCE") || error.code.includes("TRANSCRIPT")) {
      process.exit(EXIT_SOURCE);
    }
    if (error.code.includes("CONTEXT_PACK")) {
      process.exit(EXIT_PACK);
    }
  }
  process.exit(1);
}
