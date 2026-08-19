import {
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import {
  beginAgentEditProposalCommit,
  createAgentEditProposalRevisionLane,
  stageAgentEditProposalRevision
} from "../../utils/agentEditProposalRevisionLane";
import {
  expectedMutationDurableRevision,
  latestAgentEditProposalInLane
} from "../../utils/agentEditReview";
import type { DraftSectionCreationRevisionCursor } from "../../utils/draftSectionCreationRevision";
import { createKeyedSerialTaskQueue } from "../../utils/keyedSerialTaskQueue";
import type { AgentConversationController } from "../useAgentConversation";
import type {
  ProposalLaneContext,
  QueuedAgentEdit
} from "./types";

export function createProposalQueue(ctx: ProposalLaneContext) {
  const {
    uiMessage,
    catalogBook
  } = ctx;

  const applyAgentEdit: ProposalLaneContext["applyAgentEdit"] = (...args) =>
    ctx.applyAgentEdit(...args);

  const queuedAgentEdits = new Map<string, QueuedAgentEdit>();
  const agentEditCommitQueue = createKeyedSerialTaskQueue<string>();
  const activeCoordinatorInvocations = new Set<Promise<void>>();
  const activeAgentEditCommitTasks = new Set<Promise<void>>();
  const acceptedDraftSectionCreationRevisions = new Map<
    string,
    DraftSectionCreationRevisionCursor
  >();
  let coordinatorDisposed = false;
  let coordinatorDisposePromise: Promise<void> | undefined;
  let agentEditDecisionSequence = 0;

  ctx.queuedAgentEdits = queuedAgentEdits;
  ctx.agentEditCommitQueue = agentEditCommitQueue;
  ctx.activeCoordinatorInvocations = activeCoordinatorInvocations;
  ctx.activeAgentEditCommitTasks = activeAgentEditCommitTasks;
  ctx.acceptedDraftSectionCreationRevisions = acceptedDraftSectionCreationRevisions;

  function isDisposed(): boolean {
    return coordinatorDisposed;
  }

  function autoApproveEditPriority(
    conversation: AgentConversationController,
    runId: string,
    proposalId: string
  ): number {
    const proposal = conversation.getEditProposal(runId, proposalId);
    if (!proposal) return 2;
    if (proposal.draftSectionCreationTarget) return 0;
    if (proposal.characterStructureTarget?.mutation.type === "createItem") return 0;
    if (
      proposal.longWorldbuildingTarget?.file.operation === "create"
    ) return 0;
    if (
      proposal.longCharacterTarget?.files.every(
        ({ operation }) => operation === "create"
      )
    ) return 0;
    if (proposal.longWorldbuildingTarget?.file.beforeRevision !== null) {
      return proposal.predecessorProposalId ? 1 : 2;
    }
    if (
      proposal.longCharacterTarget &&
      proposal.longCharacterTarget.files.some(
        ({ beforeRevision }) => beforeRevision !== null
      )
    ) {
      return proposal.predecessorProposalId ? 1 : 2;
    }
    if (proposal.longPlotDesignTarget) {
      return 2;
    }
    if (proposal.longDraftTarget) {
      return proposal.predecessorProposalId ? 1 : 2;
    }
    if (proposal.provisionalExpertSection) return 1;
    if (proposal.provisionalCharacterItemId) return 1;
    return 2;
  }

  function agentEditQueueKey(
    sessionId: string,
    runId: string,
    proposalId: string
  ): string {
    return `${sessionId}\u0000${runId}\u0000${proposalId}`;
  }

  function nextAgentEditDecisionToken(proposal: AgentEditProposal): string {
    agentEditDecisionSequence += 1;
    return `${proposal.runId}:${proposal.id}:${proposal.generation ?? 1}:${agentEditDecisionSequence}`;
  }

  function latestProposalForLane(
    conversation: AgentConversationController,
    runId: string,
    laneId: string
  ): AgentEditProposal | undefined {
    return latestAgentEditProposalInLane(
      conversation.listEditProposals(runId),
      laneId
    );
  }

  function expectedLaneDurableRevision(
    conversation: AgentConversationController,
    runId: string,
    existing: AgentEditProposal | undefined,
    currentText: string
  ): string {
    let cursor = existing;
    const seen = new Set<string>();
    while (
      cursor?.predecessorProposalId &&
      cursor.status !== "accepted" &&
      !seen.has(cursor.id)
    ) {
      seen.add(cursor.id);
      const predecessor = conversation.getEditProposal(
        runId,
        cursor.predecessorProposalId
      );
      if (!predecessor || predecessor.status === "accepted") break;
      cursor = predecessor;
    }
    return expectedMutationDurableRevision(cursor, currentText);
  }

  function laneDurableRevisionMatches(
    conversation: AgentConversationController,
    runId: string,
    existing: AgentEditProposal | undefined,
    currentText: string,
    currentRevision: string
  ): boolean {
    if (!existing) {
      return (
        currentRevision === createShortWorkspaceContentRevision(currentText)
      );
    }
    const compatible = new Set<string>();
    let cursor: AgentEditProposal | undefined = existing;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      compatible.add(cursor.baseRevision);
      if (
        cursor.status === "accepting" ||
        cursor.status === "accepted"
      ) {
        compatible.add(cursor.proposedRevision);
      }
      cursor = cursor.predecessorProposalId
        ? conversation.getEditProposal(runId, cursor.predecessorProposalId)
        : undefined;
    }
    compatible.add(
      expectedLaneDurableRevision(
        conversation,
        runId,
        existing,
        currentText
      )
    );
    return compatible.has(currentRevision);
  }

  function blockedAgentEditLaneMessage(
    proposal: AgentEditProposal | undefined
  ): string | undefined {
    if (proposal?.status === "rejected") {
      return "此前版本已被拒绝；为避免把被拒内容随后续全文重新带回，本次变更已阻断。";
    }
    if (proposal?.status === "conflict") {
      return "此前版本存在冲突，本次后续变更已阻断，未覆盖当前文稿。";
    }
    return undefined;
  }

  function isShortOrScriptAgentEdit(proposal: AgentEditProposal): boolean {
    if (proposal.libraryTarget) return false;
    const book = catalogBook(proposal.workspaceId);
    return book?.bookType === "short" || book?.bookType === "script";
  }

  function canReviewAgentEditDuringRun(proposal: AgentEditProposal): boolean {
    return (
      Boolean(proposal.libraryTarget) ||
      Boolean(proposal.longWorldbuildingTarget) ||
      Boolean(proposal.longCharacterTarget) ||
      Boolean(proposal.longPlotDesignTarget) ||
      Boolean(proposal.longDraftTarget) ||
      isShortOrScriptAgentEdit(proposal)
    );
  }

  function removeQueuedAgentEdit(
    conversation: AgentConversationController,
    runId: string,
    proposalId: string
  ): void {
    for (const [key, queued] of queuedAgentEdits) {
      if (
        queued.conversation === conversation &&
        queued.runId === runId &&
        queued.proposalId === proposalId
      ) {
        queuedAgentEdits.delete(key);
      }
    }
  }

  function blockLaterAgentEditGenerations(
    conversation: AgentConversationController,
    rejected: AgentEditProposal
  ): void {
    const laneId = rejected.laneId ?? rejected.id;
    const generation = rejected.generation ?? 1;
    for (const candidate of conversation.listEditProposals(rejected.runId)) {
      if (
        candidate.id === rejected.id ||
        (candidate.laneId ?? candidate.id) !== laneId ||
        (candidate.generation ?? 1) <= generation ||
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
        statusMessage:
          "此前正文版本已被拒绝；该版本继承了被拒内容，因此未写入本地文件。"
      });
    }
  }

  function queueAgentEdit(
    conversation: AgentConversationController,
    sessionId: string,
    runId: string,
    proposalId: string,
    automatic: boolean,
    scheduleImmediately: boolean
  ): void {
    const proposal = conversation.getEditProposal(runId, proposalId);
    if (
      !proposal ||
      (proposal.status !== "pending" && proposal.status !== "error")
    ) {
      return;
    }

    const key = agentEditQueueKey(sessionId, runId, proposalId);
    const existingQueued = queuedAgentEdits.get(key);
    if (
      existingQueued?.expectedProposedRevision === proposal.proposedRevision
    ) {
      if (scheduleImmediately) {
        scheduleQueuedAgentEdits(
          (queued) => queued === queuedAgentEdits.get(key)
        );
      }
      return;
    }
    const decisionToken = nextAgentEditDecisionToken(proposal);
    const staged = stageAgentEditProposalRevision(
      createAgentEditProposalRevisionLane<AgentEditProposal>({
        targetKey: proposal.laneId ?? proposal.id,
        durableRevision: proposal.baseRevision,
        overlayRevision: proposal.sourceBaseRevision ?? proposal.baseRevision,
        generation: Math.max(0, (proposal.generation ?? 1) - 1)
      }),
      {
        approvalMode:
          proposal.approvalMode ??
          (automatic ? "auto-approve" : "request-approval"),
        sourceBaseRevision:
          proposal.sourceBaseRevision ?? proposal.baseRevision,
        proposedRevision: proposal.proposedRevision,
        proposal
      }
    );
    if (staged.status !== "staged") {
      return;
    }
    const started = beginAgentEditProposalCommit(staged.lane, {
      generation: proposal.generation ?? 1,
      token: decisionToken
    });
    if (started.status !== "started") {
      return;
    }
    if (scheduleImmediately && !automatic) {
      conversation.updateEditProposal(runId, proposalId, {
        status: "accepting",
        decisionToken,
        statusMessage: automatic
          ? "已进入实时自动保存队列…"
          : "已批准，正在等待本作品的保存队列…"
      });
    }
    queuedAgentEdits.set(key, {
      conversation,
      sessionId,
      runId,
      proposalId,
      workspaceId: proposal.workspaceId,
      automatic,
      expectedProposedRevision: proposal.proposedRevision,
      decisionToken,
      snapshot: started.snapshot
    });
    if (scheduleImmediately) {
      scheduleQueuedAgentEdits((queued) => queued === queuedAgentEdits.get(key));
    }
  }

  async function drainQueuedAgentEditsForWorkspace(
    workspaceId: string
  ): Promise<void> {
    const entries = [...queuedAgentEdits.entries()]
      .filter(([, queued]) => queued.workspaceId === workspaceId)
      .sort(([, left], [, right]) => {
        const priority =
          autoApproveEditPriority(
            left.conversation,
            left.runId,
            left.proposalId
          ) -
          autoApproveEditPriority(
            right.conversation,
            right.runId,
            right.proposalId
          );
        if (priority !== 0) return priority;
        const leftProposal = left.conversation.getEditProposal(
          left.runId,
          left.proposalId
        );
        const rightProposal = right.conversation.getEditProposal(
          right.runId,
          right.proposalId
        );
        return (
          (leftProposal?.generation ?? 1) -
            (rightProposal?.generation ?? 1) ||
          Date.parse(leftProposal?.createdAt ?? "") -
            Date.parse(rightProposal?.createdAt ?? "")
        );
      });

    for (const [key, queued] of entries) {
      if (queuedAgentEdits.get(key) !== queued) {
        continue;
      }
      const current = queued.conversation.getEditProposal(
        queued.runId,
        queued.proposalId
      );
      if (
        !current ||
        queued.snapshot.token !== queued.decisionToken ||
        queued.snapshot.proposal.id !== queued.proposalId ||
        queued.snapshot.proposedRevision !== queued.expectedProposedRevision ||
        current.proposedRevision !== queued.expectedProposedRevision ||
        (current.status !== "pending" &&
          current.status !== "error" &&
          !(
            current.status === "accepting" &&
            current.decisionToken === queued.decisionToken
          ))
      ) {
        if (queuedAgentEdits.get(key) === queued) {
          queuedAgentEdits.delete(key);
        }
        continue;
      }
      if (
        current.status === "pending" ||
        current.status === "error"
      ) {
        queued.conversation.updateEditProposal(
          queued.runId,
          queued.proposalId,
          {
            status: "accepting",
            decisionToken: queued.decisionToken,
            statusMessage: queued.automatic
              ? "已进入自动保存队列…"
              : "已批准，正在等待本作品的保存队列…"
          }
        );
      }

      if (queuedAgentEdits.get(key) !== queued) {
        continue;
      }
      queuedAgentEdits.delete(key);
      await applyAgentEdit(
        queued.conversation,
        {
          runId: queued.runId,
          proposalId: queued.proposalId,
          decision: "accept"
        },
        queued.automatic,
        {
          decisionToken: queued.decisionToken,
          expectedProposedRevision: queued.expectedProposedRevision
        }
      );
    }
  }

  function scheduleQueuedAgentEdits(
    matches: (queued: QueuedAgentEdit) => boolean
  ): void {
    const workspaceIds = new Set(
      [...queuedAgentEdits.values()]
        .filter(matches)
        .map((queued) => queued.workspaceId)
    );
    for (const workspaceId of workspaceIds) {
      const task = agentEditCommitQueue
        .enqueue(workspaceId, () =>
          drainQueuedAgentEditsForWorkspace(workspaceId)
        )
        .catch((error: unknown) => {
          uiMessage.error(
            error instanceof Error ? error.message : "批准智能体修改失败。"
          );
        });
      activeAgentEditCommitTasks.add(task);
      void task.then(
        () => {
          activeAgentEditCommitTasks.delete(task);
        },
        () => {
          activeAgentEditCommitTasks.delete(task);
        }
      );
    }
  }

  function hasQueuedAgentEdits(): boolean {
    return queuedAgentEdits.size > 0 || activeAgentEditCommitTasks.size > 0;
  }

  function invokeWhileActive(operation: () => Promise<void>): Promise<void> {
    if (coordinatorDisposed) return Promise.resolve();
    const invocation = operation();
    activeCoordinatorInvocations.add(invocation);
    void invocation.then(
      () => {
        activeCoordinatorInvocations.delete(invocation);
      },
      () => {
        activeCoordinatorInvocations.delete(invocation);
      }
    );
    return invocation;
  }

  async function drain(): Promise<void> {
    while (
      activeCoordinatorInvocations.size > 0 ||
      activeAgentEditCommitTasks.size > 0
    ) {
      await Promise.allSettled([
        ...activeCoordinatorInvocations,
        ...activeAgentEditCommitTasks
      ]);
    }
  }

  function dispose(): Promise<void> {
    if (coordinatorDisposePromise) return coordinatorDisposePromise;
    coordinatorDisposed = true;
    coordinatorDisposePromise = drain().finally(() => {
      // Unscheduled proposals remain durable in their conversations and can be
      // recovered by the next coordinator. This map is only an in-memory lane.
      queuedAgentEdits.clear();
    });
    return coordinatorDisposePromise;
  }

  return {
    autoApproveEditPriority,
    latestProposalForLane,
    expectedLaneDurableRevision,
    laneDurableRevisionMatches,
    blockedAgentEditLaneMessage,
    canReviewAgentEditDuringRun,
    removeQueuedAgentEdit,
    blockLaterAgentEditGenerations,
    queueAgentEdit,
    scheduleQueuedAgentEdits,
    hasQueuedAgentEdits,
    invokeWhileActive,
    drain,
    dispose,
    isDisposed
  };
}
