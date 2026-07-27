import { describe, expect, it } from "vitest";
import { matchThreadToProject } from "../src/matcher.js";
import type {
  ProjectRecord,
  ThreadMetadata,
} from "../src/types.js";

const project: ProjectRecord = {
  id: "project-1",
  name: "FinSpec",
  kind: "git",
  aliases: [
    {
      path: "/repo/ToolSpec",
      key: "/repo/ToolSpec",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
    {
      path: "/repo/FinSpec",
      key: "/repo/FinSpec",
      firstSeenAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  remotes: ["github.com/ascendho/finspec"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function thread(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  return {
    provider: "codex",
    id: "thread-1",
    name: "Design schema",
    preview: "Design schema",
    cwd: "/repo/ToolSpec",
    createdAt: 1,
    updatedAt: 2,
    archived: false,
    cliVersion: "0.145.0",
    modelProvider: "openai",
    gitInfo: null,
    ...overrides,
  };
}

describe("conversation matching", () => {
  it("automatically links a known historical path alias", async () => {
    const result = await matchThreadToProject(thread(), {
      project,
      existingLink: null,
      gitRoot: "/repo/FinSpec",
      shaExists: async () => false,
    });

    expect(result.status).toBe("linked");
    expect(result.projectId).toBe(project.id);
    expect(result.evidence[0]?.kind).toBe("path-alias");
  });

  it("automatically links when both remote and commit match", async () => {
    const result = await matchThreadToProject(
      thread({
        cwd: "/old/location/ToolSpec",
        gitInfo: {
          branch: "main",
          originUrl: "git@github.com:ascendho/FinSpec.git",
          sha: "abcdef1234567",
        },
      }),
      {
        project,
        existingLink: null,
        gitRoot: "/repo/FinSpec",
        shaExists: async () => true,
      },
    );

    expect(result.status).toBe("linked");
    expect(result.evidence[0]?.kind).toBe("git-remote-and-sha");
  });

  it("requires confirmation for a remote-only match", async () => {
    const result = await matchThreadToProject(
      thread({
        cwd: "/old/location/Unknown",
        gitInfo: {
          branch: null,
          originUrl: "https://github.com/ascendho/FinSpec.git",
          sha: null,
        },
      }),
      {
        project,
        existingLink: null,
        gitRoot: "/repo/FinSpec",
        shaExists: async () => false,
      },
    );

    expect(result.status).toBe("suggested");
    expect(result.evidence[0]?.confidence).toBeLessThan(0.9);
  });
});
