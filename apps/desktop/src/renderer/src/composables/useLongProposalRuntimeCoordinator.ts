import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRuntimeContext,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import { computed, nextTick, type Ref } from "vue";
import type {
  AgentConversationController,
  AgentRunSettings
} from "./useAgentConversation";
import {
  useLongWorkspaceProposals,
  type LongWorkspaceProposalEvent,
  type LongWorkspaceProposalItem
} from "./useLongWorkspaceProposals";
import type { LongWorkspaceRevisionSyncRequirement } from "../stores/longWorkspaceStore";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import {
  AcceptedEditDiscardConflictError,
  approvalUsesModificationTool,
  discardStatePatch,
  longProposalSupportsDiscard
} from "../utils/acceptedEditDiscard";
import { discardAcceptedLongWorkspaceProposal } from "./accepted-edit-discard/long-proposal";

export interface LongProposalRuntimeNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface LongProposalRuntimeState {
  activeBookId: Ref<string | null>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Ref<LongWorkspaceIndexSnapshot | null>;
  proposalApprovalPending: Ref<boolean>;
  revisionRequirement: Ref<LongWorkspaceRevisionSyncRequirement | null>;
}

export interface LongProposalConversationRegistry {
  byKey: Map<string, AgentConversationController>;
  remove(key: string, options?: { clearPersistence?: boolean }): void;
  active(): AgentConversationController | null;
}

export interface LongProposalWorkspacePort {
  saveActiveEditorChanges(): Promise<boolean>;
  refreshActiveWorkspace(bookId: string): Promise<boolean>;
  refreshBookList(): Promise<void>;
  synchronizeEditorRevisions(
    workspaceRevision: number,
    projectRevision: number
  ): void;
}

export interface LongProposalRuntimeCoordinatorContext {
  state: LongProposalRuntimeState;
  api(): LongWorkspaceRendererApi | undefined;
  conversations: LongProposalConversationRegistry;
  workspace: LongProposalWorkspacePort;
  removeAgentRunPreferences(scope: string): void;
  navigateToAcceptedProposal(item: LongWorkspaceProposalItem): Promise<boolean>;
  notifications: LongProposalRuntimeNotifications;
}

/** Owns long-form proposal queues and their conversation/runtime association. */
export function useLongProposalRuntimeCoordinator(
  context: LongProposalRuntimeCoordinatorContext
) {
  const { state, notifications } = context;
  let disposed = false;

  const workspaceProposals = useLongWorkspaceProposals({
    api: context.api,
    acceptsEvent: acceptsProposalEvent,
    approvalModeForEvent: proposalApprovalMode,
    prepareAutoApprove: prepareAutomaticProposal,
    onApplied: handleProposalApplied,
    notifications
  });
  const activeProposalItems = computed(() =>
    workspaceProposals.itemsForBook(state.activeBookId.value)
  );
  const activeConversationProposalItems = computed(() => {
    const sessionId = context.conversations.active()?.sessionId.value;
    return activeProposalItems.value.filter(
      (item) => item.event.payload.sessionId === sessionId
    );
  });

  function conversationKey(
    bookId: string,
    activeRoot: LongWorkspaceRuntimeContext["activeRoot"],
    chapterCardId?: string
  ): string {
    const conversationChapterCardId =
      activeRoot === "continuity_ledger" ? chapterCardId : undefined;
    return `long:${encodeURIComponent(bookId)}:${activeRoot}:${encodeURIComponent(
      conversationChapterCardId ?? "__book__"
    )}`;
  }

  function conversationForProposalEvent(
    event:
      | LongWorkspaceProposalEvent
      | Extract<SystemEventEnvelope, { type: "long.chapter_write_proposal" }>
  ): AgentConversationController | undefined {
    const prefix = `long:${encodeURIComponent(event.payload.bookId)}:`;
    for (const [key, conversation] of context.conversations.byKey) {
      if (
        key.startsWith(prefix) &&
        conversation.acceptsRunEvent(
          event.payload.sessionId,
          event.payload.runId
        )
      ) {
        return conversation;
      }
    }
    return undefined;
  }

  function acceptsProposalEvent(event: LongWorkspaceProposalEvent): boolean {
    return !disposed && conversationForProposalEvent(event) !== undefined;
  }

  function proposalApprovalMode(
    event: LongWorkspaceProposalEvent
  ): AgentRunSettings["approvalMode"] | undefined {
    return conversationForProposalEvent(event)?.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    );
  }

  async function refreshWorkspaceAfterProposal(
    bookId: string
  ): Promise<boolean> {
    if (disposed) return false;
    const refreshed = await context.workspace.refreshActiveWorkspace(bookId);
    if (
      !disposed &&
      refreshed &&
      state.activeBookId.value === bookId &&
      state.workspaceIndex.value &&
      state.activeBookSummary.value?.id === bookId
    ) {
      context.workspace.synchronizeEditorRevisions(
        state.workspaceIndex.value.revision,
        state.activeBookSummary.value.projectRevision
      );
    }
    await context.workspace.refreshBookList();
    return !disposed && refreshed;
  }

  async function handleProposalApplied(
    event: LongWorkspaceProposalEvent
  ): Promise<void> {
    await refreshWorkspaceAfterProposal(event.payload.bookId);
  }

  async function prepareAutomaticProposal(): Promise<void> {
    await nextTick();
    if (!(await context.workspace.saveActiveEditorChanges())) {
      throw new Error(
        "当前长篇编辑内容尚未保存，智能体提案未自动覆盖；请处理编辑器保存状态后重试。"
      );
    }
  }

  function bookConversationEntries(
    bookId: string
  ): Array<[string, AgentConversationController]> {
    const prefix = `long:${encodeURIComponent(bookId)}:`;
    return [...context.conversations.byKey.entries()].filter(([key]) =>
      key.startsWith(prefix)
    );
  }

  async function stopBookAgentRuns(bookId: string): Promise<void> {
    const entries = bookConversationEntries(bookId);
    for (const [, conversation] of entries) {
      const sessionId = conversation.sessionId.value;
      if (sessionId) {
        workspaceProposals.quarantineSession(bookId, sessionId);
      }
    }
    for (const [, conversation] of entries) {
      if (!conversation.isBusy.value) continue;
      const stopAccepted = await conversation.stopGeneration();
      if (!stopAccepted) {
        throw new Error(
          "长篇智能体正在启动，暂时无法安全移除项目；请稍后重试。"
        );
      }
    }
    workspaceProposals.discardBook(bookId);
  }

  function disposeBookConversations(bookId: string): void {
    for (const [key] of bookConversationEntries(bookId)) {
      context.conversations.remove(key, { clearPersistence: true });
    }
  }

  function disposeBookProposalState(bookId: string): void {
    workspaceProposals.discardBook(bookId);
    if (state.revisionRequirement.value?.bookId === bookId) {
      state.revisionRequirement.value = null;
    }
    context.removeAgentRunPreferences(`long:${bookId}`);
  }

  function disposeBookRuntime(bookId: string): void {
    disposeBookConversations(bookId);
    disposeBookProposalState(bookId);
  }

  async function stopActiveGeneration(): Promise<void> {
    const conversation = context.conversations.active();
    if (!conversation) return;
    try {
      if (await conversation.stopGeneration()) {
        notifications.info("已停止长篇生成。");
      }
    } catch (error: unknown) {
      notifications.error(
        error instanceof Error
          ? error.message
          : "停止长篇生成失败，请稍后重试。"
      );
    }
  }

  async function approveProposal(eventId: string): Promise<void> {
    const bookId = state.activeBookId.value;
    if (!bookId || state.proposalApprovalPending.value) return;
    const item = workspaceProposals
      .itemsForBook(bookId)
      .find(({ event }) => event.id === eventId);
    if (!item) return;
    state.proposalApprovalPending.value = true;
    try {
      await nextTick();
      if (!(await context.workspace.saveActiveEditorChanges())) return;
      if (state.activeBookId.value !== bookId) {
        notifications.info("活动长篇已切换，本次审批已取消。");
        return;
      }
      if (
        !workspaceProposals
          .itemsForBook(bookId)
          .some(({ event }) => event.id === eventId)
      ) {
        return;
      }
      await workspaceProposals.approve(bookId, eventId);
    } finally {
      state.proposalApprovalPending.value = false;
    }
  }

  function rejectProposal(eventId: string): void {
    const bookId = state.activeBookId.value;
    if (!bookId) return;
    if (workspaceProposals.reject(bookId, eventId)) {
      notifications.info("已拒绝该长篇提案，未写入任何文件。");
    }
  }

  function retryProposalPreview(eventId: string): void {
    const bookId = state.activeBookId.value;
    if (!bookId) return;
    void workspaceProposals.retryPreview(bookId, eventId);
  }

  async function locateAcceptedProposal(eventId: string): Promise<void> {
    const bookId = state.activeBookId.value;
    if (!bookId) return;
    const item = workspaceProposals
      .itemsForBook(bookId)
      .find(({ event }) => event.id === eventId);
    if (!item || item.status !== "accepted") return;
    if (!(await context.navigateToAcceptedProposal(item))) {
      notifications.warning("目标文件或所属条目已不存在，无法跳转。");
    }
  }

  async function discardAcceptedProposal(eventId: string): Promise<void> {
    const bookId = state.activeBookId.value;
    const api = context.api();
    if (!bookId || !api || state.proposalApprovalPending.value) return;
    const item = workspaceProposals
      .itemsForBook(bookId)
      .find(({ event }) => event.id === eventId);
    const conversation = item
      ? conversationForProposalEvent(item.event)
      : undefined;
    if (
      !item ||
      !conversation ||
      !longProposalSupportsDiscard(item) ||
      !conversation.messages.value.some((message) =>
        approvalUsesModificationTool(message, [item.event.payload.toolCallId])
      ) ||
      item.discardState?.status === "discarding"
    ) {
      return;
    }
    state.proposalApprovalPending.value = true;
    workspaceProposals.setDiscardState(
      bookId,
      eventId,
      discardStatePatch("discarding", "正在校验当前版本并舍弃本次修改…")
    );
    try {
      await nextTick();
      if (!(await context.workspace.saveActiveEditorChanges())) {
        throw new AcceptedEditDiscardConflictError(
          "当前长篇编辑内容尚未保存，未舍弃本次修改。"
        );
      }
      await discardAcceptedLongWorkspaceProposal(api, item);
      workspaceProposals.setDiscardState(
        bookId,
        eventId,
        discardStatePatch("discarded", "已舍弃本次修改，并恢复修改前的内容。")
      );
      await refreshWorkspaceAfterProposal(bookId);
      notifications.success("已舍弃本次修改");
    } catch (error: unknown) {
      const conflict = error instanceof AcceptedEditDiscardConflictError;
      const message =
        error instanceof Error ? error.message : "舍弃本次修改失败。";
      workspaceProposals.setDiscardState(
        bookId,
        eventId,
        discardStatePatch(conflict ? "conflict" : "error", message)
      );
      if (conflict) notifications.warning(message);
      else notifications.error(message);
    } finally {
      state.proposalApprovalPending.value = false;
    }
  }

  function dispose(): void {
    disposed = true;
  }

  return {
    workspaceProposals,
    activeProposalItems,
    activeConversationProposalItems,
    conversationKey,
    conversationForProposalEvent,
    refreshWorkspaceAfterProposal,
    stopBookAgentRuns,
    disposeBookProposalState,
    disposeBookConversations,
    disposeBookRuntime,
    stopActiveGeneration,
    approveProposal,
    rejectProposal,
    retryProposalPreview,
    locateAcceptedProposal,
    discardAcceptedProposal,
    dispose
  };
}
