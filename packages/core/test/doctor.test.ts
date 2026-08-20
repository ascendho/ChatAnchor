import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";
import type { HistoryAdapter } from "../src/types.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

function emptyAdapter(): HistoryAdapter {
  return {
    listThreads: async () => [],
    close: async () => undefined,
  };
}

describe("ChatAnchor doctor", () => {
  it("treats missing optional CLIs as warnings when one provider works", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-doctor-provider-"));
    cleanup.push(base);
    const project = join(base, "project");
    await mkdir(project);

    const report = await runDoctor({
      cwd: project,
      codexPath: join(base, "missing-codex"),
      agentPath: join(base, "missing-agent"),
      cursorHome: join(base, "cursor-home"),
      openCodePath: join(base, "missing-opencode"),
      openCodeHome: join(base, "opencode-home"),
      registryHome: join(base, "registry"),
      historyAdapterFactory: async () => emptyAdapter(),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.name === "Codex CLI"))
      .toMatchObject({ status: "warn" });
    expect(report.checks.find((check) => check.name === "Codex app-server"))
      .toMatchObject({ status: "pass" });
    expect(report.checks.some((check) => check.name === "Supported agents"))
      .toBe(false);
  });

  it("reports an error when no supported CLI or history exists", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-doctor-empty-"));
    cleanup.push(base);
    const project = join(base, "project");
    await mkdir(project);

    const report = await runDoctor({
      cwd: project,
      codexPath: join(base, "missing-codex"),
      agentPath: join(base, "missing-agent"),
      cursorHome: join(base, "cursor-home"),
      openCodePath: join(base, "missing-opencode"),
      openCodeHome: join(base, "opencode-home"),
      registryHome: join(base, "registry"),
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "Supported agents"))
      .toMatchObject({ status: "fail" });
  });
});
