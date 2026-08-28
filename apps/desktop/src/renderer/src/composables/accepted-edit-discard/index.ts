import type { AgentEditProposal } from "../../types/conversation";
import { replaceLongBookSummary } from "../../types/longWorkspace";
import {
  AcceptedEditDiscardConflictError,
  agentProposalSupportsDiscard,
  approvalUsesModificationTool,
  discardStatePatch
} from "../../utils/acceptedEditDiscard";
import type { AgentConversationController } from "../useAgentConversation";
import type {
  AgentEditReviewRequest,
  ProposalCoordinatorContext
} from "../proposal-coordinator/types";
import {
  discardAcceptedLongFileEdit,
  discardAcceptedLongOperationEdit
} from "./long";
import {
  discardAcceptedCatalogTextEdit,
  discardAcceptedShortStructureEdit
} from "./short";

function proposalUsesModificationTool(
  conversation: AgentConversationController,
  proposal: AgentEditProposal
): boolean {
  return conversation.messages.value.some((message) =>
    approvalUsesModificationTool(message, proposal.toolCallIds)
  );
}

function updateDiscardState(
  conversation: AgentConversationController,
  proposal: AgentEditProposal,
  status: NonNullable<AgentEditProposal["discardState"]>["status"],
  message: string
): void {
  const state = discardStatePatch(status, message);
  conversation.updateEditProposal(proposal.runId, proposal.id, {
    discardState: state,
    updatedAt: state.updatedAt
  });
}

function conflictDependentProposals(
  conversation: AgentConversationController,
  proposal: AgentEditProposal
): void {
  for (const candidate of conversation.listEditProposals(proposal.runId)) {
    if (
      candidate.predecessorProposalId !== proposal.id ||
      (candidate.status !== "pending" && candidate.status !== "error")
    ) {
      continue;
    }
    conversation.updateEditProposal(candidate.runId, candidate.id, {
      status: "conflict",
      proposedText: undefined,
      statusMessage: "前一版修改已被舍弃，请基于当前文件重新生成本项修改。"
    });
  }
}

export function createAcceptedEditDiscardCoordinator(
  context: ProposalCoordinatorContext
) {
  async function discardLongAgentProposal(
    proposal: AgentEditProposal
  ): Promise<void> {
    const api = context.api()?.long;
    const target =
      proposal.longWorldbuildingTarget ??
      proposal.longCharacterTarget ??
      proposal.longDraftTarget ??
      proposal.longPlotDesignTarget;
    if (!api || !target) throw new Error("长篇工作区服务当前不可用。");
    if (context.longWorkspace.activeBookId.value === target.bookId) {
      if (!(await context.longWorkspace.saveActiveEditorChanges())) {
        throw new AcceptedEditDiscardConflictError(
          "当前长篇编辑内容尚未保存，未舍弃本次修改。"
        );
      }
    }
    let summary;
    if (proposal.longWorldbuildingTarget) {
      summary = (
        await discardAcceptedLongFileEdit(
          api,
          target.bookId,
          proposal.longWorldbuildingTarget.file
        )
      ).summary;
    } else if (proposal.longCharacterTarget) {
      const file = proposal.longCharacterTarget.files[0];
      if (!file || proposal.longCharacterTarget.files.length !== 1) {
        throw new Error("人物档案修改缺少唯一目标文件。");
      }
      summary = (await discardAcceptedLongFileEdit(api, target.bookId, file))
        .summary;
    } else if (proposal.longDraftTarget) {
      summary = (
        await discardAcceptedLongFileEdit(
          api,
          target.bookId,
          proposal.longDraftTarget.file
        )
      ).summary;
    } else {
      const snapshot = proposal.discardSnapshot;
      if (!snapshot?.longUndoBatch) {
        throw new Error("缺少剧情结构修改前的完整快照。");
      }
      summary = (
        await discardAcceptedLongOperationEdit(
          api,
          target.bookId,
          snapshot.longUndoBatch,
          snapshot.appliedProjectRevision
        )
      ).summary;
    }
    context.longWorkspace.books.value = replaceLongBookSummary(
      context.longWorkspace.books.value,
      summary
    );
    await context.longWorkspace.refreshWorkspaceAfterProposal(target.bookId);
  }

  async function discardProposal(
    conversation: AgentConversationController,
    request: Omit<AgentEditReviewRequest, "decision">
  ): Promise<void> {
    const proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (
      !proposal ||
      !proposalUsesModificationTool(conversation, proposal) ||
      !agentProposalSupportsDiscard(proposal) ||
      proposal.discardState?.status === "discarding"
    ) {
      return;
    }
    if (context.editor.acceptingWorkspaceIds.value.has(proposal.workspaceId)) {
      context.notifications.info("同一作品正在保存其他修改，请稍候再舍弃");
      return;
    }
    updateDiscardState(
      conversation,
      proposal,
      "discarding",
      "正在校验当前版本并舍弃本次修改…"
    );
    context.editor.setWorkspaceAccepting(proposal.workspaceId, true);
    try {
      if (
        proposal.longWorldbuildingTarget ||
        proposal.longCharacterTarget ||
        proposal.longDraftTarget ||
        proposal.longPlotDesignTarget
      ) {
        await discardLongAgentProposal(proposal);
      } else if (
        !(await discardAcceptedShortStructureEdit(context, proposal))
      ) {
        await discardAcceptedCatalogTextEdit(context, proposal);
      }
      updateDiscardState(
        conversation,
        proposal,
        "discarded",
        "已舍弃本次修改，并恢复修改前的内容。"
      );
      conflictDependentProposals(conversation, proposal);
      context.notifications.success("已舍弃本次修改");
    } catch (error: unknown) {
      const conflict =
        error instanceof AcceptedEditDiscardConflictError ||
        context.catalog.isConflict(error);
      const message =
        error instanceof Error ? error.message : "舍弃本次修改失败。";
      updateDiscardState(
        conversation,
        proposal,
        conflict ? "conflict" : "error",
        message
      );
      if (conflict) context.notifications.warning(message);
      else context.notifications.error(message);
    } finally {
      context.editor.setWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return {
    discardAgentEdit: (request: Omit<AgentEditReviewRequest, "decision">) =>
      discardProposal(context.conversations.active.value, request),
    discardLongAgentEdit: (
      request: Omit<AgentEditReviewRequest, "decision">
    ) => {
      const conversation = context.conversations.activeLong.value;
      return conversation
        ? discardProposal(conversation, request)
        : Promise.resolve();
    }
  };
}
