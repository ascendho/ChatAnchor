import { normalizeRemoteUrl } from "./git.js";
import {
  isPathInside,
  pathBasename,
  relativeToRoot,
} from "./path.js";
import type {
  LinkEvidence,
  MatchDecision,
  ProjectRecord,
  ThreadExclusion,
  ThreadLink,
  ThreadMetadata,
} from "./types.js";

export interface MatchContext {
  project: ProjectRecord;
  existingLink: ThreadLink | null;
  exclusion?: ThreadExclusion | null;
  gitRoot: string | null;
  shaExists: (sha: string) => Promise<boolean>;
}
function decision(
  thread: ThreadMetadata,
  status: MatchDecision["status"],
  projectId: string | null,
  evidence: LinkEvidence[],
  relativeCwd: string | null = null,
): MatchDecision {
  return { thread, status, projectId, evidence, relativeCwd };
}

export async function matchThreadToProject(
  thread: ThreadMetadata,
  context: MatchContext,
): Promise<MatchDecision> {
  const { project, existingLink } = context;
  if (context.exclusion) {
    return decision(thread, "ignored", project.id, [
      {
        kind: "user-ignored",
        confidence: 1,
        description:
          "User explicitly removed this conversation from this ChatAnchor project.",
      },
    ]);
  }
  if (existingLink?.projectId === project.id) {
    return decision(
      thread,
      "linked",
      project.id,
      [
        {
          kind: "stored-link",
          confidence: 1,
          description: "Conversation was already linked to this ChatAnchor project.",
        },
      ],
      existingLink.relativeCwd,
    );
  }
  if (existingLink?.linkedBy === "manual") {
    return decision(thread, "unlinked", null, [
      {
        kind: "stored-link",
        confidence: 1,
        description:
          "Conversation was manually linked to another ChatAnchor project.",
      },
    ]);
  }

  const threadRemote = thread.gitInfo?.originUrl
    ? normalizeRemoteUrl(thread.gitInfo.originUrl)
    : null;
  const remoteMatches = Boolean(
    threadRemote && project.remotes.includes(threadRemote),
  );
  const remoteConflicts = Boolean(
    threadRemote
    && project.remotes.length > 0
    && !remoteMatches,
  );
  const matchingAlias = project.aliases.find((alias) =>
    isPathInside(thread.cwd, alias.path)
  );
  if (matchingAlias && !remoteConflicts) {
    return decision(
      thread,
      "linked",
      project.id,
      [
        {
          kind: "path-alias",
          confidence: 1,
          description: `Recorded cwd belongs to known path alias ${matchingAlias.path}.`,
        },
      ],
      relativeToRoot(thread.cwd, matchingAlias.path),
    );
  }

  const shaMatches = Boolean(
    context.gitRoot
    && thread.gitInfo?.sha
    && await context.shaExists(thread.gitInfo.sha),
  );

  if (remoteMatches && shaMatches) {
    return decision(thread, "linked", project.id, [
      {
        kind: "git-remote-and-sha",
        confidence: 0.98,
        description: "Git remote and recorded commit both match the current repository.",
      },
    ]);
  }
  if (shaMatches) {
    return decision(thread, "suggested", project.id, [
      {
        kind: "git-sha",
        confidence: 0.78,
        description: "The recorded commit exists in the current repository.",
      },
    ]);
  }
  if (remoteMatches) {
    return decision(thread, "suggested", project.id, [
      {
        kind: "git-remote",
        confidence: 0.72,
        description: "The recorded Git remote matches the current repository.",
      },
    ]);
  }

  const aliasBasenames = new Set(
    project.aliases.map((alias) => pathBasename(alias.path)),
  );
  if (aliasBasenames.has(pathBasename(thread.cwd))) {
    return decision(thread, "suggested", project.id, [
      {
        kind: "basename",
        confidence: 0.35,
        description: "The old cwd has the same directory name; confirmation is required.",
      },
    ]);
  }

  if (existingLink) {
    return decision(thread, "unlinked", null, [
      {
        kind: "stored-link",
        confidence: 1,
        description:
          "Conversation has an automatic link to another ChatAnchor project and no stronger evidence was found.",
      },
    ]);
  }

  return decision(thread, "unlinked", null, []);
}
