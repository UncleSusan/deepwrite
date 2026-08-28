import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import { saveCreatedCharacterContent } from "./creation-content";
import {
  createShortWorkspaceContentRevision,
  type CharacterStructureMutation
} from "@deepwrite/contracts";
import { agentEditProposalId } from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import type {
  AgentEditReviewRequest,
  ProposalLaneContext,
  WorkspaceEditorMutationEvent
} from "./types";

export function createCharacterStructureLane(ctx: ProposalLaneContext) {
  const {
    api,
    uiMessage,
    catalogBook,
    loadCatalogSnapshot,
    isCatalogConflict,
    setAgentEditWorkspaceAccepting
  } = ctx;

  const queueAgentEdit: ProposalLaneContext["queueAgentEdit"] = (...args) =>
    ctx.queueAgentEdit(...args);

  function findPendingCharacterCreationForProvisional(
    conversation: AgentConversationController,
    runId: string,
    itemId: string
  ): AgentEditProposal | undefined {
    return conversation.listEditProposals(runId).find((proposal) => {
      const mutation = proposal.characterStructureTarget?.mutation;
      return Boolean(
        mutation?.type === "createItem" &&
        mutation.itemId === itemId &&
        (proposal.status === "pending" ||
          proposal.status === "accepting" ||
          proposal.status === "error")
      );
    });
  }

  async function acceptCharacterStructureProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    )
      return;
    const target = proposal.characterStructureTarget;
    const book = catalogBook(proposal.workspaceId);
    const currentApi = api();
    if (!target || !book || book.projectRevision === undefined || !currentApi) {
      const message = "人物结构目标已不可用，无法应用本次变更。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const hasAcceptedSameRunPredecessor = conversation
      .listEditProposals(request.runId)
      .some(
        (candidate) =>
          candidate.id !== proposal.id &&
          candidate.workspaceId === proposal.workspaceId &&
          candidate.status === "accepted" &&
          candidate.createdAt <= proposal.createdAt
      );
    if (
      target.baseProjectRevision !== undefined &&
      book.projectRevision !== target.baseProjectRevision &&
      !hasAcceptedSameRunPredecessor
    ) {
      const message = "人物结构版本已变化，未接受本次智能体修改。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic ? "正在自动保存人物结构…" : "正在保存人物结构…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const updatedBook = await currentApi.catalog.mutateCharacterStructure({
        bookId: proposal.workspaceId,
        baseProjectRevision: book.projectRevision,
        mutation: target.mutation
      });
      if (
        target.mutation.type === "createItem" &&
        target.initialContent?.trim()
      ) {
        if (!target.mutation.itemId) {
          throw new Error("人物创建结果缺少稳定条目 id，无法写入人物正文。");
        }
        await saveCreatedCharacterContent(currentApi.catalog, {
          bookId: proposal.workspaceId,
          itemId: target.mutation.itemId,
          content: target.initialContent,
          ...(updatedBook.projectRevision === undefined
            ? {}
            : { projectRevision: updatedBook.projectRevision })
        });
      }
      await loadCatalogSnapshot();
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(updatedBook.projectRevision === undefined
          ? {}
          : {
              discardSnapshot: {
                ...proposal.discardSnapshot,
                appliedProjectRevision: updatedBook.projectRevision
              }
            }),
        statusMessage: automatic
          ? "已自动批准并保存人物结构变更。"
          : "人物结构变更已保存到本地。"
      });
      if (!automatic) uiMessage.success("人物结构变更已保存");
    } catch (error) {
      await loadCatalogSnapshot();
      const message =
        error instanceof Error ? error.message : "人物结构变更保存失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: isCatalogConflict(error) ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function stageCharacterStructureProposal(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: AgentConversationController,
    runApprovalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean {
    const mutationTarget = event.payload.mutationTarget;
    if (mutationTarget?.kind === "character-structure") {
      const book = catalogBook(event.payload.workspaceId);
      if (!book || book.characterStructure.format !== "list") {
        const message = "人物结构已变化，本次条目操作未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      const source = mutationTarget.mutation;
      const mutation: CharacterStructureMutation =
        source.type === "createItem"
          ? {
              type: "createItem",
              title: source.title,
              itemId: source.provisionalItemId
            }
          : source.type === "updateItem"
            ? { type: "updateItem", itemId: source.itemId, title: source.title }
            : source.type === "moveItem"
              ? {
                  type: "moveItem",
                  itemId: source.itemId,
                  direction: source.direction
                }
              : { type: "deleteItem", itemId: source.itemId };
      const documentId = `character-structure:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "character_design",
        documentId
      );
      if (sourceConversation.getEditProposal(event.payload.runId, proposalId)) {
        return true;
      }
      const beforeText =
        source.type === "deleteItem"
          ? source.deletedText
          : source.type === "updateItem"
            ? source.previousTitle
            : "";
      const afterText =
        source.type === "deleteItem"
          ? ""
          : source.type === "updateItem"
            ? source.title
            : source.type === "createItem"
              ? source.title
              : event.payload.text;
      const diff = buildAgentTextDiff(beforeText, afterText);
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "character_design",
        documentId,
        title:
          source.type === "createItem"
            ? `创建人物条目：${source.title}`
            : source.type === "updateItem"
              ? `修改人物名称：${source.previousTitle} → ${source.title}`
              : source.type === "moveItem"
                ? `${source.direction === "up" ? "上移" : "下移"}人物条目：${source.title}`
                : `删除人物条目：${source.title}`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(afterText),
        proposedText: afterText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        ...(source.type === "updateItem"
          ? {
              discardSnapshot: {
                beforeText: source.previousTitle,
                beforeTitle: source.previousTitle
              }
            }
          : {}),
        characterStructureTarget: {
          mutation,
          ...(mutationTarget.initialContent
            ? { initialContent: mutationTarget.initialContent }
            : {}),
          ...(book.projectRevision === undefined
            ? {}
            : { baseProjectRevision: book.projectRevision })
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }
    return false;
  }

  return {
    findPendingCharacterCreationForProvisional,
    acceptCharacterStructureProposal,
    stageCharacterStructureProposal
  };
}
