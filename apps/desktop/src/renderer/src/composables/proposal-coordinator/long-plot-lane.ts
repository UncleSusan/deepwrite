import {
  LongWorkspaceOperationBatchSchema,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
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
  LongPlotDesignMutationEvent,
  ProposalLaneContext
} from "./types";

export function createLongPlotLane(ctx: ProposalLaneContext) {
  const {
    uiMessage,
    acceptingAgentEditWorkspaceIds,
    rememberWorkspaceMutationEvent,
    setAgentEditWorkspaceAccepting,
    longConversationForProposalEvent,
    activeLongBookId,
    longBooks,
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

  function longPlotDesignProposalText(
    batch: LongWorkspaceOperationBatch
  ): string {
    return JSON.stringify(
      {
        structureOperations: batch.operations,
        documentWrites: batch.documentWrites
      },
      null,
      2
    );
  }

  function stageLongPlotDesignEditProposal(
    event: LongPlotDesignMutationEvent
  ): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-plot-design",
      "plot-design"
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
    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const sourceRevision = `long-plot:${event.payload.baseProjectRevision}:${event.payload.batch.baseRevision}`;
    const proposedRevision = `${sourceRevision}:${event.payload.toolCallId}`;
    const proposalText = longPlotDesignProposalText(event.payload.batch);
    const diff = buildAgentTextDiff("", proposalText);
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: sourceRevision,
      ...(existing ? { predecessorProposalId: existing.id } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-plot-design",
      documentId: "plot-design",
      title: "剧情设计变更",
      summary: event.payload.summary,
      status: "pending",
      baseRevision: sourceRevision,
      proposedRevision,
      proposedText: proposalText,
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longPlotDesignTarget: {
        bookId: event.payload.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse(event.payload.batch),
        baseProjectRevision: event.payload.baseProjectRevision
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (runApprovalMode === "auto-approve") {
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

  async function acceptLongPlotDesignProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longPlotDesignTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇剧情设计服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，剧情设计实时自动落盘已暂停，请稍后重试。"
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
        ? "正在自动批准、校验影响并保存剧情设计…"
        : "正在校验影响并保存剧情设计…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖剧情设计。");
        }
      }
      const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
      const predecessor = proposal.predecessorProposalId
        ? conversation.getEditProposal(
            request.runId,
            proposal.predecessorProposalId
          )
        : undefined;
      const predecessorProjectRevision =
        predecessor?.status === "accepted"
          ? predecessor.longPlotDesignTarget?.appliedProjectRevision
          : undefined;
      if (
        latest.projectRevision !== target.baseProjectRevision &&
        latest.projectRevision !== predecessorProjectRevision
      ) {
        const message =
          "剧情设计已在审阅期间发生变化，未覆盖最新结构。请基于当前内容重新生成。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
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
        throw new Error(
          "长篇项目已在审批期间更新，请基于最新剧情设计重新生成。"
        );
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
        longPlotDesignTarget: {
          ...target,
          appliedProjectRevision: result.projectRevision
        },
        statusMessage: refreshed
          ? `${automatic ? "已自动批准并" : "已接受并"}保存剧情设计。`
          : "剧情设计已保存，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (!automatic) {
        uiMessage.success("已接受并保存剧情设计");
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "保存剧情设计失败，当前结构保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `剧情设计已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`剧情设计已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return {
    longPlotDesignProposalText,
    stageLongPlotDesignEditProposal,
    acceptLongPlotDesignProposal
  };
}
