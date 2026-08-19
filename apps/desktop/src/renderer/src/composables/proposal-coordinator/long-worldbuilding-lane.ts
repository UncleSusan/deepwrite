import {
  nextTick
} from "vue";
import {
  LongWorkspaceOperationBatchSchema,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
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
import { findLongWorldbuildingFile } from "../../utils/longWorldbuildingFiles";
import type { AgentConversationController } from "../useAgentConversation";
import type {
  AgentEditReviewRequest,
  LongWorldbuildingFileMutationEvent,
  ProposalLaneContext
} from "./types";

export function createLongWorldbuildingLane(ctx: ProposalLaneContext) {
  const {
    api,
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
  const removeQueuedAgentEdit: ProposalLaneContext["removeQueuedAgentEdit"] = (...args) =>
    ctx.removeQueuedAgentEdit(...args);
  const latestProposalForLane: ProposalLaneContext["latestProposalForLane"] = (...args) =>
    ctx.latestProposalForLane(...args);
  const blockedAgentEditLaneMessage: ProposalLaneContext["blockedAgentEditLaneMessage"] = (...args) =>
    ctx.blockedAgentEditLaneMessage(...args);

  function longWorldbuildingBatchForFile(
    event: LongWorldbuildingFileMutationEvent
  ): LongWorkspaceOperationBatch | undefined {
    const file = event.payload.files[0];
    if (!file || event.payload.files.length !== 1) return undefined;
    const operations = event.payload.batch.operations.filter(
      (operation) =>
        file.operation === "create" &&
        operation.type === "worldbuildingItem.create" &&
        operation.categoryId === file.categoryId &&
        operation.item.id === file.itemId &&
        operation.item.file.id === file.fileId
    );
    const documentWrites = event.payload.batch.documentWrites.filter(
      (write) =>
        file.operation !== "create" && write.fileId === file.fileId
    );
    if (
      (file.operation === "create" &&
        (operations.length !== 1 || documentWrites.length !== 0)) ||
      (file.operation !== "create" &&
        (operations.length !== 0 || documentWrites.length !== 1))
    ) {
      return undefined;
    }
    return LongWorkspaceOperationBatchSchema.parse({
      ...event.payload.batch,
      operations,
      documentWrites
    });
  }

  function stageLongWorldbuildingEditProposal(
    event: LongWorldbuildingFileMutationEvent
  ): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const file = event.payload.files[0];
    const batch = longWorldbuildingBatchForFile(event);
    if (!file || !batch) {
      const message =
        "世界观文件工具必须一次只形成一个独立文件变更，本次结果未进入审批。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneDocumentId =
      file.operation === "create"
        ? `create:${file.fileId}`
        : file.fileId;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-worldbuilding",
      laneDocumentId
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
    if (
      existing &&
      file.beforeRevision !== existing.proposedRevision
    ) {
      const message =
        "世界观文件的待审批版本链已经变化，本次变更未进入审批。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const creationPredecessor =
      file.operation === "create"
        ? undefined
        : sourceConversation
            .listEditProposals(event.payload.runId)
            .find(
              (proposal) =>
                proposal.longWorldbuildingTarget?.file.fileId ===
                  file.fileId &&
                proposal.longWorldbuildingTarget.file.operation ===
                  "create" &&
                proposal.longWorldbuildingTarget.file.nextRevision ===
                  file.beforeRevision &&
                proposal.status !== "rejected" &&
                proposal.status !== "conflict"
            );
    const generation = existing
      ? (existing.generation ?? 1) + 1
      : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const predecessorProposalId =
      existing?.id ?? creationPredecessor?.id;
    const beforeRevision =
      file.beforeRevision ?? `long-missing:${file.fileId}`;
    const diff = buildAgentTextDiff(file.beforeText, file.afterText);
    const noChanges =
      file.operation !== "create" &&
      file.beforeText === file.afterText;
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: beforeRevision,
      ...(predecessorProposalId ? { predecessorProposalId } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-worldbuilding",
      documentId: file.fileId,
      title: file.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: beforeRevision,
      proposedRevision: file.nextRevision,
      ...(noChanges ? {} : { proposedText: file.afterText }),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges
        ? { statusMessage: "文本没有实际变化，无需保存。" }
        : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longWorldbuildingTarget: {
        bookId: event.payload.bookId,
        batch,
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

  function conflictDependentLongWorldbuildingProposals(
    conversation: AgentConversationController,
    proposal: AgentEditProposal,
    message: string
  ): void {
    for (const candidate of conversation.listEditProposals(proposal.runId)) {
      if (
        candidate.predecessorProposalId !== proposal.id ||
        !candidate.longWorldbuildingTarget ||
        (candidate.status !== "pending" && candidate.status !== "error")
      ) {
        continue;
      }
      removeQueuedAgentEdit(
        conversation,
        candidate.runId,
        candidate.id
      );
      conversation.updateEditProposal(candidate.runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
    }
  }

  async function acceptLongWorldbuildingFileProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longWorldbuildingTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇世界观文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，实时自动落盘已暂停，请稍后重试。"
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
      statusMessage:
        target.file.operation === "create"
          ? automatic
            ? "正在自动批准并创建空白世界观文件…"
            : "正在校验目录版本并创建空白世界观文件…"
          : automatic
            ? "正在自动批准、校验版本并保存世界观文件…"
            : "正在校验版本并保存世界观文件…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error(
            "当前长篇编辑内容尚未保存，未覆盖世界观文件。"
          );
        }
      }
      const latest = await api.getWorkspaceIndex({
        bookId: target.bookId
      });
      const currentFile = findLongWorldbuildingFile(
        latest.workspaceIndex.worldbuilding,
        target.file.fileId
      );
      if (currentFile?.revision === target.file.nextRevision) {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "accepted",
          proposedText: undefined,
          statusMessage:
            "该世界观文件变更已经存在于本地 Markdown 中。"
        });
        await refreshLongWritingSaveBarrier(target.bookId);
        return;
      }
      if (target.file.operation === "create") {
        if (currentFile) {
          const message =
            "世界观目录已存在同一文件，未重复创建。";
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          uiMessage.warning(message);
          return;
        }
      } else if (
        !currentFile ||
        currentFile.revision !== target.file.beforeRevision
      ) {
        const message =
          "世界观文件已在审阅期间发生变化，未覆盖最新内容。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        await refreshLongWritingSaveBarrier(target.bookId);
        uiMessage.warning(message);
        return;
      }

      const nextOrderByCategory = new Map<string, number>();
      const batch = LongWorkspaceOperationBatchSchema.parse({
        ...target.batch,
        baseRevision: latest.workspaceIndex.revision,
        operations: target.batch.operations.map((operation) => {
          if (operation.type !== "worldbuildingItem.create") {
            return operation;
          }
          const category = latest.workspaceIndex.worldbuilding.find(
            ({ id }) => id === operation.categoryId
          );
          if (!category || category.format !== "list") {
            throw new Error(
              "世界观文件的目标分类已不存在或不再是列表型。"
            );
          }
          const nextOrder =
            (nextOrderByCategory.get(category.id) ??
              category.items.length) + 1;
          nextOrderByCategory.set(category.id, nextOrder);
          return {
            ...operation,
            item: {
              ...operation.item,
              order: nextOrder
            }
          };
        })
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
          "长篇项目已在审批期间更新，请基于最新世界观重新生成。"
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
      longBooks.value = replaceLongBookSummary(
        longBooks.value,
        result.summary
      );
      const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage:
          target.file.operation === "create"
            ? automatic
              ? "已自动批准并创建空白世界观文件。"
              : "已创建空白世界观文件并保存到本地 Markdown。"
            : refreshed
              ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
              : "已保存到本地 Markdown，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (!automatic) {
        uiMessage.success(
          target.file.operation === "create"
            ? "已创建空白世界观文件"
            : "已接受并保存世界观文件"
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "保存世界观文件失败，原文件保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `世界观文件已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`世界观文件已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return {
    longWorldbuildingBatchForFile,
    stageLongWorldbuildingEditProposal,
    conflictDependentLongWorldbuildingProposals,
    acceptLongWorldbuildingFileProposal
  };
}
