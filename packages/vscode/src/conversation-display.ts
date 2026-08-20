import type {
  ConversationProvider,
  MatchDecision,
  ProviderSyncStatus,
} from "@threadrelink/core";
import type { WorkspaceResult } from "./view-model.js";

export function isHiddenConversation(decision: MatchDecision): boolean {
  return decision.display?.hidden === true;
}

export function linkedForProvider(
  workspace: WorkspaceResult,
  provider: ConversationProvider,
  showHidden: boolean,
): MatchDecision[] {
  return (workspace.sync?.linked ?? []).filter(
    (decision) =>
      decision.thread.provider === provider
      && (showHidden || !isHiddenConversation(decision)),
  );
}

export function hiddenForProvider(
  workspace: WorkspaceResult,
  provider: ConversationProvider,
): MatchDecision[] {
  return (workspace.sync?.linked ?? []).filter(
    (decision) =>
      decision.thread.provider === provider
      && isHiddenConversation(decision),
  );
}

export function hiddenConversationCount(workspace: WorkspaceResult): number {
  return (workspace.sync?.linked ?? []).filter(isHiddenConversation).length;
}

export function providerStatus(
  workspace: WorkspaceResult,
  provider: ConversationProvider,
): ProviderSyncStatus | undefined {
  return workspace.sync?.providers.find((status) =>
    status.provider === provider
  );
}

export function visibleProviderStatuses(
  workspace: WorkspaceResult,
): ProviderSyncStatus[] {
  return (workspace.sync?.providers ?? []).filter(
    (status) => status.availability !== "unavailable",
  );
}
