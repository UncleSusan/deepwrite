import { LongWorkspaceOperationBatchSchema } from "@deepwrite/contracts";
import { nextTick } from "vue";
import type { AgentEditProposal } from "../../types/conversation";
import {
  replaceLongBookSummary,
  resolveLongWorkspaceApi
} from "../../types/longWorkspace";
import {
  agentEditProposalGenerationId,
  agentEditProposalId
} from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import type { AgentConversationController } from "../useAgentConversation";
import type {
  AgentEditReviewRequest,
  LongDraftMutationEvent,
  ProposalLaneContext
} from "./types";

export function createLongDraftLane(ctx: ProposalLaneContext) {
  const {
    uiMessage,
    acceptingAgentEditWorkspaceIds,
    rememberWorkspaceMutationEvent,
    setAgentEditWorkspaceAccepting,
    longConversationForProposalEvent,
    activeLongBookId,
    longBooks,
    longWritingOrchestrator,
    refreshLongWritingSaveBarrier,
    saveActiveLongEditorChanges
  } = ctx;

  const queueAgentEdit: ProposalLaneContext["queueAgentEdit"] = (...args) =>
    ctx.queueAgentEdit(...args);
  const latestProposalForLane: ProposalLaneContext["latestProposalForLane"] = (
    ...args
  ) => ctx.latestProposalForLane(...args);
  const blockedAgentEditLaneMessage: ProposalLaneContext["blockedAgentEditLaneMessage"] =
    (...args) => ctx.blockedAgentEditLaneMessage(...args);

  function stageLongDraftEditProposal(event: LongDraftMutationEvent): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const file = event.payload.file;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-draft",
      file.fileId
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    if (existing && file.beforeRevision !== existing.proposedRevision) {
      const message = "章节正文的待审批版本链已经变化，本次变更未进入审批。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const diff = buildAgentTextDiff(file.beforeText, file.afterText);
    const noChanges = file.beforeText === file.afterText;
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: file.beforeRevision,
      ...(existing ? { predecessorProposalId: existing.id } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-draft",
      documentId: file.fileId,
      title: `${file.chapterTitle} / 正文`,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: file.beforeRevision,
      proposedRevision: file.nextRevision,
      ...(noChanges ? {} : { proposedText: file.afterText }),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: "正文没有实际变化，无需保存。" } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longDraftTarget: {
        bookId: event.payload.bookId,
        batch: event.payload.batch,
        baseProjectRevision: event.payload.baseProjectRevision,
        file
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  async function acceptLongDraftProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longDraftTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇正文服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，正文实时自动落盘已暂停，请稍后重试。"
        : "同一本书正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准、校验版本并保存章节正文…"
        : "正在校验版本并保存章节正文…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖章节正文。");
        }
      }
      const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
      const chapter = latest.workspaceIndex.chapters.find(
        ({ chapterCardId }) => chapterCardId === target.file.chapterCardId
      );
      if (!chapter || chapter.body.id !== target.file.fileId) {
        const message = "目标章卡或章节正文已经不存在，未保存本次修改。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
      if (chapter.body.revision === target.file.nextRevision) {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "accepted",
          proposedText: undefined,
          statusMessage: "该章节正文变更已经存在于本地 Markdown 中。"
        });
        const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
        if (refreshed) {
          await longWritingOrchestrator.handleChapterSaved(
            target.bookId,
            target.file.chapterCardId
          );
        }
        return;
      }
      const predecessor = proposal.predecessorProposalId
        ? conversation.getEditProposal(
            request.runId,
            proposal.predecessorProposalId
          )
        : undefined;
      const predecessorProjectRevision =
        predecessor?.status === "accepted"
          ? predecessor.longDraftTarget?.appliedProjectRevision
          : undefined;
      if (
        latest.projectRevision !== target.baseProjectRevision &&
        latest.projectRevision !== predecessorProjectRevision
      ) {
        const message =
          "章节正文已在审阅期间发生变化，未覆盖最新内容。请基于当前正文重新生成。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
      if (chapter.body.revision !== target.file.beforeRevision) {
        const message = "章节正文已在审阅期间发生变化，未覆盖最新内容。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        await refreshLongWritingSaveBarrier(target.bookId);
        uiMessage.warning(message);
        return;
      }
      const batch = LongWorkspaceOperationBatchSchema.parse({
        ...target.batch,
        baseRevision: latest.workspaceIndex.revision
      });
      const preview = await api.previewOperations({
        bookId: target.bookId,
        batch
      });
      if (
        preview.bookId !== target.bookId ||
        preview.projectRevision !== latest.projectRevision
      ) {
        throw new Error("长篇项目已在审批期间更新，请基于最新正文重新生成。");
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...batch,
          expectedImpact: preview.preview.impact
        }),
        baseProjectRevision: latest.projectRevision
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        longDraftTarget: {
          ...target,
          appliedProjectRevision: result.projectRevision
        },
        statusMessage: refreshed
          ? `${automatic ? "已自动批准并" : "已接受并"}保存章节正文到本地 Markdown。`
          : "章节正文已保存，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (refreshed) {
        await longWritingOrchestrator.handleChapterSaved(
          target.bookId,
          target.file.chapterCardId
        );
      }
      if (!automatic) {
        uiMessage.success("已接受并保存章节正文");
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "保存章节正文失败，原文件保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `章节正文已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`章节正文已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return {
    stageLongDraftEditProposal,
    acceptLongDraftProposal
  };
}
