import { computed, watch } from "vue";
import {
  approvalModeForRun,
  acceptsRunEvent,
  getEditProposal,
  listEditProposals,
  markToolConflict,
  updateEditProposal,
  upsertEditProposal
} from "./agent-conversation/approvals";
import {
  createAgentConversationState,
  nextConversationTimestamp,
  type AgentConversationContext
} from "./agent-conversation/context";
import { handleEvent } from "./agent-conversation/events";
import {
  capturePersistenceSnapshot,
  currentStoredConversation,
  emitPersistenceSnapshot,
  hasConversationContent,
  holdPersistenceEmits,
  observePersistenceResult,
  releasePersistenceEmits,
  reportPersistenceError,
  restorePersistenceSnapshot
} from "./agent-conversation/persistence-io";
import {
  applyModelSettings,
  applyRunSettings,
  cancelPendingGeneration,
  newConversation,
  selectApprovalMode,
  selectConversation,
  selectModel,
  selectTemperature,
  selectThinkingLevel,
  sendAssistantMessage,
  sendLongMessage,
  sendMessage,
  stopGeneration,
  stopStreamingMessages
} from "./agent-conversation/send-stop";
import { historyItemFor } from "./agent-conversation/shared";

export type {
  AgentConversationController,
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot,
  AgentRunSettings,
  ConversationStorage,
  UseAgentConversationOptions,
  WorkspaceContextAttachments
} from "./agent-conversation/types";
export {
  mergeAgentConversationPersistenceSnapshots,
  mergeStoredConversationHistories,
  parseAgentConversationPersistenceSnapshot
} from "./agent-conversation/parse";

import type {
  AgentConversationController,
  UseAgentConversationOptions
} from "./agent-conversation/types";

export function useAgentConversation(
  options: UseAgentConversationOptions
): AgentConversationController {
  const state = createAgentConversationState(options);
  const isBusy = computed(
    () =>
      state.pendingAttemptId.value !== null ||
      state.submitting.value ||
      state.activeRunId.value !== null
  );
  const hasPendingEditReview = computed(() =>
    state.messages.value.some((message) =>
      message.editProposals?.some(
        (proposal) => proposal.status === "pending" || proposal.status === "accepting"
      )
    )
  );
  const ctx: AgentConversationContext = {
    ...state,
    isBusy,
    hasPendingEditReview
  };
  const canSend = computed(
    () =>
      Boolean(options.api()) &&
      !isBusy.value &&
      !hasPendingEditReview.value &&
      ctx.draft.value.trim().length > 0
  );
  const canSendAttachments = computed(
    () =>
      Boolean(options.api()) &&
      !isBusy.value &&
      !hasPendingEditReview.value
  );
  const canStop = computed(
    () => Boolean(options.api()) && ctx.activeRunId.value !== null && !ctx.stopping.value
  );
  const history = computed(() => {
    const activeSnapshot = currentStoredConversation(ctx);
    const conversations = ctx.storedConversations.value.filter(
      (conversation) => conversation.sessionId !== ctx.sessionId.value
    );
    if (hasConversationContent(ctx, activeSnapshot)) {
      conversations.push(activeSnapshot);
    }
    return conversations
      .map((conversation) => historyItemFor(conversation, ctx.sessionId.value))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  });

  const stopPersistenceWatch = watch(
    [
      ctx.sessionId,
      ctx.messages,
      ctx.draft,
      ctx.approvalMode,
      ctx.selectedModelId,
      ctx.thinkingLevel,
      ctx.temperature
    ],
    () => {
      if (
        ctx.applyingPersistenceSnapshot ||
        !ctx.persistenceNotificationsEnabled ||
        ctx.persistenceEmitHold > 0
      ) {
        return;
      }
      ctx.persistenceMutationRevision += 1;
      ctx.currentUpdatedAt.value = nextConversationTimestamp(ctx);
      if (ctx.persistenceBatchDepth > 0) {
        ctx.persistenceBatchChanged = true;
        return;
      }
      emitPersistenceSnapshot(ctx);
    },
    { deep: true, flush: "sync" }
  );

  return {
    messages: ctx.messages,
    draft: ctx.draft,
    sessionId: ctx.sessionId,
    approvalMode: ctx.approvalMode,
    thinkingLevel: ctx.thinkingLevel,
    temperature: ctx.temperature,
    configuredModels: ctx.configuredModels,
    selectedModelId: ctx.selectedModelId,
    runtime: ctx.runtime,
    conversationError: ctx.conversationError,
    history,
    isBusy,
    hasPendingEditReview,
    canSend,
    canSendAttachments,
    canStop,
    acceptsRunEvent: (eventSessionId, runId) =>
      acceptsRunEvent(ctx, eventSessionId, runId),
    approvalModeForRun: (eventSessionId, runId) =>
      approvalModeForRun(ctx, eventSessionId, runId),
    markToolConflict: (runId, toolCallId, summary) =>
      markToolConflict(ctx, runId, toolCallId, summary),
    getEditProposal: (runId, proposalId) => getEditProposal(ctx, runId, proposalId),
    listEditProposals: (runId) => listEditProposals(ctx, runId),
    upsertEditProposal: (runId, proposal) => upsertEditProposal(ctx, runId, proposal),
    updateEditProposal: (runId, proposalId, patch) =>
      updateEditProposal(ctx, runId, proposalId, patch),
    handleEvent: (event) => handleEvent(ctx, event),
    sendMessage: (
      activeDocument,
      workspaceDocuments,
      attachments,
      promptAttachments
    ) => sendMessage(ctx, activeDocument, workspaceDocuments, attachments, promptAttachments),
    sendAssistantMessage: (context) => sendAssistantMessage(ctx, context),
    sendLongMessage: (context, attachments, promptAttachments) =>
      sendLongMessage(ctx, context, attachments, promptAttachments),
    stopGeneration: () => stopGeneration(ctx),
    cancelPendingGeneration: () => cancelPendingGeneration(ctx),
    newConversation: () => newConversation(ctx),
    selectConversation: (sessionId) => selectConversation(ctx, sessionId),
    applyModelSettings: (settings) => applyModelSettings(ctx, settings),
    applyRunSettings: (settings) => applyRunSettings(ctx, settings),
    selectModel: (modelId) => selectModel(ctx, modelId),
    selectThinkingLevel: (level) => selectThinkingLevel(ctx, level),
    selectTemperature: (temperature) => selectTemperature(ctx, temperature),
    selectApprovalMode: (mode) => selectApprovalMode(ctx, mode),
    capturePersistenceSnapshot: () => capturePersistenceSnapshot(ctx),
    restorePersistenceSnapshot: (snapshot) => restorePersistenceSnapshot(ctx, snapshot),
    holdPersistenceEmits: () => holdPersistenceEmits(ctx),
    releasePersistenceEmits: () => releasePersistenceEmits(ctx),
    useSuggestion(value: string): void {
      ctx.draft.value = value;
    },
    dispose(disposeOptions): void {
      ctx.persistenceNotificationsEnabled = false;
      stopPersistenceWatch();
      // Disposing invalidates the run ownership below. Settle presentation
      // state first so `status: streaming` cannot outlive `activeRunId`.
      stopStreamingMessages(ctx);
      if (disposeOptions?.clearPersistence && options.onPersistenceRemove) {
        void Promise.resolve().then(() => {
          try {
            observePersistenceResult(ctx, options.onPersistenceRemove?.());
          } catch {
            reportPersistenceError(ctx);
          }
        });
      }
      ctx.epoch += 1;
      ctx.pendingAttemptId.value = null;
      ctx.activeRunId.value = null;
      ctx.approvalModeByAttempt.clear();
      ctx.approvalModeByRun.clear();
      ctx.turnCheckpointByRun.clear();
      ctx.subagentTurnCheckpointByRun.clear();
      ctx.seenTurnIds.clear();
      ctx.seenSubagentTurnIds.clear();
      ctx.stopping.value = false;
      if (ctx.idleTimer !== undefined) {
        globalThis.clearTimeout(ctx.idleTimer);
        ctx.idleTimer = undefined;
      }
    }
  };
}
