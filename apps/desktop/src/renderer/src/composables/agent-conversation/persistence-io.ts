import { cloneJsonRecord, cloneMessage, cloneMessageForPersistence } from "./clone";
import type { AgentConversationContext } from "./context";
import { nextConversationTimestamp } from "./context";
import { parseAgentConversationPersistenceSnapshot } from "./parse";
import { resetTransientConversationState } from "./streaming";
import { MAX_STORED_CONVERSATIONS } from "./shared";
import type {
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot
} from "./types";

export function currentStoredConversation(ctx: AgentConversationContext): AgentConversationPersistenceRecord {
  return {
    sessionId: ctx.sessionId.value,
    messages: ctx.messages.value.map(cloneMessageForPersistence),
    draft: ctx.draft.value,
    approvalMode: ctx.approvalMode.value,
    createdAt: ctx.currentCreatedAt.value,
    updatedAt: ctx.currentUpdatedAt.value,
    temperature: ctx.temperature.value
  };
}

export function hasConversationContent(
  ctx: AgentConversationContext,
  conversation: AgentConversationPersistenceRecord
): boolean {
  return conversation.messages.length > 0 || conversation.draft.trim().length > 0;
}

export function storeCurrentConversation(ctx: AgentConversationContext): void {
  const current = currentStoredConversation(ctx);
  const next = ctx.storedConversations.value.filter(
    (conversation) => conversation.sessionId !== current.sessionId
  );
  if (hasConversationContent(ctx, current)) {
    next.push(current);
  }
  ctx.storedConversations.value = next
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_STORED_CONVERSATIONS);
}

export function capturePersistenceSnapshot(ctx: AgentConversationContext): AgentConversationPersistenceSnapshot {
  storeCurrentConversation(ctx);
  return cloneJsonRecord({
    version: 1 as const,
    activeSessionId: ctx.sessionId.value,
    conversations: [...ctx.storedConversations.value]
  });
}

export function reportPersistenceError(ctx: AgentConversationContext): void {
  if (ctx.persistenceErrorReported) return;
  ctx.persistenceErrorReported = true;
  ctx.options.onPersistenceError?.();
}

export function observePersistenceResult(ctx: AgentConversationContext, result: void | Promise<void>): void {
  if (!result || typeof result.then !== "function") {
    ctx.persistenceErrorReported = false;
    return;
  }
  void result.then(
    () => {
      ctx.persistenceErrorReported = false;
    },
    () => {
      reportPersistenceError(ctx);
    }
  );
}

export function holdPersistenceEmits(ctx: AgentConversationContext): void {
  ctx.persistenceEmitHold += 1;
}

export function releasePersistenceEmits(ctx: AgentConversationContext): void {
  ctx.persistenceEmitHold = Math.max(0, ctx.persistenceEmitHold - 1);
}

export function emitPersistenceSnapshot(ctx: AgentConversationContext): void {
  if (
    ctx.persistenceEmitHold > 0 ||
    !ctx.persistenceNotificationsEnabled ||
    ctx.applyingPersistenceSnapshot ||
    (!ctx.options.onPersistenceChange && !ctx.options.onPersistenceSnapshot)
  ) {
    return;
  }
  try {
    observePersistenceResult(ctx,
      ctx.options.onPersistenceChange
        ? ctx.options.onPersistenceChange()
        : ctx.options.onPersistenceSnapshot!(capturePersistenceSnapshot(ctx))
    );
  } catch {
    reportPersistenceError(ctx);
  }
}

export function runPersistenceBatch<T>(
  ctx: AgentConversationContext,
  operation: () => T
): T {
  ctx.persistenceBatchDepth += 1;
  try {
    return operation();
  } finally {
    ctx.persistenceBatchDepth -= 1;
    if (ctx.persistenceBatchDepth === 0 && ctx.persistenceBatchChanged) {
      ctx.persistenceBatchChanged = false;
      emitPersistenceSnapshot(ctx);
    }
  }
}

export async function restorePersistenceSnapshot(ctx: AgentConversationContext, snapshot: unknown): Promise<boolean> {
  const parsed = parseAgentConversationPersistenceSnapshot(snapshot);
  if (!parsed) return false;
  const expectedRevision = ctx.persistenceMutationRevision;

  // Yield once so edits made while an asynchronously loaded snapshot is
  // being handed to the controller win over the older persisted state.
  await Promise.resolve();
  if (
    !ctx.persistenceNotificationsEnabled ||
    expectedRevision !== 0 ||
    ctx.persistenceMutationRevision !== expectedRevision ||
    ctx.storedEnvelope !== undefined ||
    ctx.options.initialMessages?.length ||
    ctx.messages.value.length > 0 ||
    ctx.draft.value.length > 0 ||
    ctx.storedConversations.value.length > 0 ||
    ctx.isBusy.value
  ) {
    return false;
  }

  ctx.applyingPersistenceSnapshot = true;
  try {
    resetTransientConversationState(ctx);
    ctx.storedConversations.value = parsed.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map(cloneMessage)
    }));
    const active = ctx.storedConversations.value.find(
      (conversation) => conversation.sessionId === parsed.activeSessionId
    );
    const restoredTimestamp = active?.updatedAt ?? nextConversationTimestamp(ctx);
    ctx.conversationClock = Math.max(
      ctx.conversationClock,
      ...ctx.storedConversations.value.map((conversation) =>
        Date.parse(conversation.updatedAt)
      )
    );
    ctx.sessionId.value = active?.sessionId ?? parsed.activeSessionId;
    ctx.messages.value = (active?.messages ?? []).map(cloneMessage);
    ctx.draft.value = active?.draft ?? "";
    ctx.approvalMode.value = active?.approvalMode ?? "request-approval";
    ctx.temperature.value = active?.temperature ?? 0.7;
    ctx.currentCreatedAt.value = active?.createdAt ?? restoredTimestamp;
    ctx.currentUpdatedAt.value = restoredTimestamp;
    ctx.persistenceMutationRevision = 0;
    ctx.persistenceBatchChanged = false;
  } finally {
    ctx.applyingPersistenceSnapshot = false;
  }
  return true;
}
