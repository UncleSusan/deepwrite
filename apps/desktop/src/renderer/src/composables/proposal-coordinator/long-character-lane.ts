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
  LongCharacterFileMutationEvent,
  ProposalLaneContext
} from "./types";

export function createLongCharacterLane(ctx: ProposalLaneContext) {
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
  const removeQueuedAgentEdit: ProposalLaneContext["removeQueuedAgentEdit"] = (
    ...args
  ) => ctx.removeQueuedAgentEdit(...args);
  const latestProposalForLane: ProposalLaneContext["latestProposalForLane"] = (
    ...args
  ) => ctx.latestProposalForLane(...args);
  const blockedAgentEditLaneMessage: ProposalLaneContext["blockedAgentEditLaneMessage"] =
    (...args) => ctx.blockedAgentEditLaneMessage(...args);

  function longCharacterBatchForFiles(
    event: LongCharacterFileMutationEvent
  ): LongWorkspaceOperationBatch | undefined {
    const files = event.payload.files;
    if (!files.length) return undefined;
    const isCreation = files.every(({ operation }) => operation === "create");
    if (isCreation) {
      const characterIds = new Set(files.map(({ characterId }) => characterId));
      const documents = new Set(files.map(({ document }) => document));
      const operation = event.payload.batch.operations.find(
        (candidate) => candidate.type === "character.create"
      );
      if (
        characterIds.size !== 1 ||
        documents.size !== 4 ||
        files.length !== 4 ||
        event.payload.batch.operations.length !== 1 ||
        event.payload.batch.documentWrites.length !== 0 ||
        !operation ||
        operation.character.id !== files[0]?.characterId ||
        !files.every((file) => {
          const operationFiles = operation.files;
          switch (file.document) {
            case "core_profile":
              return operationFiles.coreProfile.id === file.fileId;
            case "relationships":
              return operationFiles.relationships.id === file.fileId;
            case "current_state":
              return operationFiles.currentState.id === file.fileId;
            case "history":
              return operationFiles.history.id === file.fileId;
            case "overview":
              return false;
          }
        })
      ) {
        return undefined;
      }
      return LongWorkspaceOperationBatchSchema.parse(event.payload.batch);
    }
    const file = files[0];
    if (
      files.length !== 1 ||
      !file ||
      file.operation === "create" ||
      event.payload.batch.operations.length !== 0
    ) {
      return undefined;
    }
    const documentWrites = event.payload.batch.documentWrites.filter(
      (write) => write.fileId === file.fileId
    );
    if (
      documentWrites.length !== 1 ||
      event.payload.batch.documentWrites.length !== 1
    ) {
      return undefined;
    }
    return LongWorkspaceOperationBatchSchema.parse({
      ...event.payload.batch,
      operations: [],
      documentWrites
    });
  }

  function stageLongCharacterEditProposal(
    event: LongCharacterFileMutationEvent
  ): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const files = event.payload.files;
    const batch = longCharacterBatchForFiles(event);
    if (!files.length || !batch) {
      const message =
        "人物文件工具必须形成一名人物的完整创建变更，或一次只修改一份人物档案；本次结果未进入审批。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const isCreation = files.every(({ operation }) => operation === "create");
    const primaryFile = files[0]!;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneDocumentId = isCreation
      ? `create:${primaryFile.characterId}`
      : primaryFile.fileId;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-character",
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
      !isCreation &&
      existing &&
      primaryFile.beforeRevision !== existing.proposedRevision
    ) {
      const message = "人物档案的待审批版本链已经变化，本次变更未进入审批。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const creationPredecessor = isCreation
      ? undefined
      : sourceConversation
          .listEditProposals(event.payload.runId)
          .find(
            (proposal) =>
              proposal.longCharacterTarget?.files.some(
                (file) =>
                  file.fileId === primaryFile.fileId &&
                  file.operation === "create" &&
                  file.nextRevision === primaryFile.beforeRevision
              ) &&
              proposal.status !== "rejected" &&
              proposal.status !== "conflict"
          );
    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const predecessorProposalId = existing?.id ?? creationPredecessor?.id;
    const beforeRevision = isCreation
      ? `long-missing:${primaryFile.characterId}`
      : (primaryFile.beforeRevision ?? `long-missing:${primaryFile.fileId}`);
    const proposedRevision = isCreation
      ? `long-character-create:${files.map(({ nextRevision }) => nextRevision).join(":")}`
      : primaryFile.nextRevision;
    const diff = buildAgentTextDiff(
      isCreation ? "" : primaryFile.beforeText,
      isCreation ? "" : primaryFile.afterText
    );
    const noChanges =
      !isCreation && primaryFile.beforeText === primaryFile.afterText;
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: beforeRevision,
      ...(predecessorProposalId ? { predecessorProposalId } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-character",
      documentId: laneDocumentId,
      title: isCreation
        ? `${primaryFile.characterName} / 新建人物`
        : primaryFile.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: beforeRevision,
      proposedRevision,
      ...(!noChanges && !isCreation
        ? { proposedText: primaryFile.afterText }
        : {}),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longCharacterTarget: {
        bookId: event.payload.bookId,
        batch,
        baseProjectRevision: event.payload.baseProjectRevision,
        files
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

  function conflictDependentLongCharacterProposals(
    conversation: AgentConversationController,
    proposal: AgentEditProposal,
    message: string
  ): void {
    const createdFileIds = new Set(
      proposal.longCharacterTarget?.files
        .filter(({ operation }) => operation === "create")
        .map(({ fileId }) => fileId) ?? []
    );
    if (!createdFileIds.size) return;
    for (const candidate of conversation.listEditProposals(proposal.runId)) {
      if (
        candidate.predecessorProposalId !== proposal.id ||
        !candidate.longCharacterTarget?.files.some(({ fileId }) =>
          createdFileIds.has(fileId)
        ) ||
        (candidate.status !== "pending" && candidate.status !== "error")
      ) {
        continue;
      }
      removeQueuedAgentEdit(conversation, candidate.runId, candidate.id);
      conversation.updateEditProposal(candidate.runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
    }
  }

  async function acceptLongCharacterFileProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longCharacterTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇人物文件服务当前不可用。";
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

    const isCreation = target.files.every(
      ({ operation }) => operation === "create"
    );
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: isCreation
        ? automatic
          ? "正在自动批准并创建人物档案…"
          : "正在校验目录版本并创建人物档案…"
        : automatic
          ? "正在自动批准、校验版本并保存人物档案…"
          : "正在校验版本并保存人物档案…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖人物档案。");
        }
      }
      const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
      const currentFiles = new Map([
        ...(latest.workspaceIndex.characterOverview
          ? [
              [
                latest.workspaceIndex.characterOverview.id,
                latest.workspaceIndex.characterOverview
              ] as const
            ]
          : []),
        ...latest.workspaceIndex.characterFiles.flatMap((entry) => [
          [entry.coreProfile.id, entry.coreProfile] as const,
          [entry.relationships.id, entry.relationships] as const,
          [entry.currentState.id, entry.currentState] as const,
          [entry.history.id, entry.history] as const
        ])
      ]);
      if (
        target.files.every(
          (file) =>
            currentFiles.get(file.fileId)?.revision === file.nextRevision
        )
      ) {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "accepted",
          proposedText: undefined,
          statusMessage: "该人物档案变更已经存在于本地 Markdown 中。"
        });
        await refreshLongWritingSaveBarrier(target.bookId);
        return;
      }
      if (isCreation) {
        if (target.files.some((file) => currentFiles.has(file.fileId))) {
          const message = "人物目录已存在同一人物的部分档案，未重复创建。";
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          uiMessage.warning(message);
          return;
        }
      } else {
        const changed = target.files.find((file) => {
          const current = currentFiles.get(file.fileId);
          return !current || current.revision !== file.beforeRevision;
        });
        if (changed) {
          const message = "人物档案已在审阅期间发生变化，未覆盖最新内容。";
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          await refreshLongWritingSaveBarrier(target.bookId);
          uiMessage.warning(message);
          return;
        }
      }

      const nextOrderByGroup = new Map<string, number>();
      const batch = LongWorkspaceOperationBatchSchema.parse({
        ...target.batch,
        baseRevision: latest.workspaceIndex.revision,
        operations: target.batch.operations.map((operation) => {
          if (operation.type !== "character.create") return operation;
          const group = operation.character.group;
          const nextOrder =
            (nextOrderByGroup.get(group) ??
              latest.workspaceIndex.characters.filter(
                (character) => character.group === group
              ).length) + 1;
          nextOrderByGroup.set(group, nextOrder);
          return {
            ...operation,
            character: { ...operation.character, order: nextOrder }
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
          "长篇项目已在审批期间更新，请基于最新人物档案重新生成。"
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
        statusMessage: isCreation
          ? automatic
            ? "已自动批准并创建人物及四份空白档案。"
            : "已创建人物及四份空白档案并保存到本地 Markdown。"
          : refreshed
            ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
            : "已保存到本地 Markdown，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (!automatic) {
        uiMessage.success(
          isCreation ? "已创建人物档案" : "已接受并保存人物档案"
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "保存人物档案失败，原文件保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `人物档案已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`人物档案已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return {
    longCharacterBatchForFiles,
    stageLongCharacterEditProposal,
    conflictDependentLongCharacterProposals,
    acceptLongCharacterFileProposal
  };
}
