export const REGISTRY_SCHEMA_VERSION = 2 as const;

export type ProjectKind = "git" | "directory";
export type LinkStatus = "linked" | "suggested" | "ignored" | "unlinked";
export type LinkSource = "automatic" | "manual";
export type SetupMode = "git-root" | "parent-git" | "directory";
export type IdentitySource = "git-config" | "folder-file";
export type ResumeTargetMode =
  | "preserved-subdirectory"
  | "project-root"
  | "missing-subdirectory-fallback"
  | "unsafe-subdirectory-fallback"
  | "not-directory-fallback";

export interface GitInfo {
  branch: string | null;
  originUrl: string | null;
  sha: string | null;
}

export interface ThreadMetadata {
  provider: "codex";
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  cliVersion: string;
  modelProvider: string;
  gitInfo: GitInfo | null;
}

export interface PathAlias {
  path: string;
  key: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  kind: ProjectKind;
  aliases: PathAlias[];
  remotes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectProbe {
  state: "ready" | "uninitialized" | "parent-choice-required";
  workspacePath: string;
  gitRoot: string | null;
  projectId: string | null;
  project: ProjectRecord | null;
  parentProject: ProjectRecord | null;
  identitySource: IdentitySource | null;
}

export interface LinkEvidence {
  kind:
    | "stored-link"
    | "path-alias"
    | "git-remote-and-sha"
    | "git-remote"
    | "git-sha"
    | "basename"
    | "manual"
    | "user-ignored";
  confidence: number;
  description: string;
}

export interface ThreadLink {
  provider: "codex";
  threadId: string;
  projectId: string;
  linkedBy: LinkSource;
  originalCwd: string;
  relativeCwd: string | null;
  evidence: LinkEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface ThreadExclusion {
  provider: "codex";
  threadId: string;
  projectId: string;
  createdAt: string;
}

export interface RegistryFile {
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  projects: ProjectRecord[];
  threads: ThreadMetadata[];
  threadLinks: ThreadLink[];
  threadExclusions: ThreadExclusion[];
}

export interface MatchDecision {
  thread: ThreadMetadata;
  status: LinkStatus;
  projectId: string | null;
  evidence: LinkEvidence[];
  relativeCwd: string | null;
}

export interface SyncResult {
  project: ProjectRecord;
  linked: MatchDecision[];
  suggested: MatchDecision[];
  ignored: MatchDecision[];
  unlinked: MatchDecision[];
  relocationReport: RelocationReport | null;
  scannedAt: string;
}

export interface ResumeTarget {
  threadId: string;
  projectId: string;
  projectRoot: string;
  path: string;
  relativeCwd: string | null;
  mode: ResumeTargetMode;
  warning: string | null;
}

export interface RelocationThreadReport {
  threadId: string;
  title: string;
  originalCwd: string;
  relativeCwd: string | null;
  targetPath: string;
  targetMode: ResumeTargetMode;
  evidence: string | null;
}

export interface RelocationReport {
  projectId: string;
  projectName: string;
  previousPath: string;
  currentPath: string;
  detectedAt: string;
  linkedThreads: number;
  preservedSubdirectories: number;
  fallbackThreads: number;
  conversations: RelocationThreadReport[];
}

export interface ThreadCorrectionResult {
  threadId: string;
  previousProjectId: string | null;
  currentProjectId: string | null;
  link: ThreadLink | null;
  exclusionProjectIds: string[];
}

export interface RelinkResult {
  project: ProjectRecord;
  oldPath: string;
  newPath: string;
  linkedThreads: number;
}

export interface ForgetProjectPreview {
  project: ProjectRecord;
  linkedThreads: number;
  identityPaths: string[];
}

export interface ForgetProjectResult {
  projectId: string;
  removedLinks: number;
  removedIdentityPaths: string[];
}

export interface HistoryAdapter {
  listThreads(options?: { includeArchived?: boolean }): Promise<ThreadMetadata[]>;
  close(): Promise<void>;
}

export type HistoryAdapterFactory = () => Promise<HistoryAdapter>;

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}
