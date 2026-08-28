import type { LongWorkspaceOperationBatch } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type {
  AgentEditProposal,
  AgentToolTrace,
  ChatMessage
} from "../types/conversation";

const LEGACY_MODIFICATION_TOOL_PREFIXES = [
  "edit_",
  "replace_",
  "rename_",
  "move_"
];

export class AcceptedEditDiscardConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptedEditDiscardConflictError";
  }
}

export function isModificationTool(
  tool: Pick<AgentToolTrace, "name">
): boolean {
  return (
    tool.name === "edit" ||
    LEGACY_MODIFICATION_TOOL_PREFIXES.some((prefix) =>
      tool.name.startsWith(prefix)
    )
  );
}

export function approvalUsesModificationTool(
  message: Pick<ChatMessage, "toolCalls">,
  toolCallIds: readonly string[]
): boolean {
  const ids = new Set(toolCallIds);
  return Boolean(
    message.toolCalls?.some(
      (tool) => ids.has(tool.id) && isModificationTool(tool)
    )
  );
}

export function textEditDiscardSnapshot(
  existing: Pick<AgentEditProposal, "discardSnapshot"> | undefined,
  coalescesExisting: boolean,
  beforeText: string,
  beforeTitle: string
): NonNullable<AgentEditProposal["discardSnapshot"]> {
  return coalescesExisting && existing?.discardSnapshot
    ? existing.discardSnapshot
    : { beforeText, beforeTitle };
}

function isAgentCreationProposal(proposal: AgentEditProposal): boolean {
  return Boolean(
    proposal.libraryTarget?.operation === "create" ||
    proposal.draftSectionCreationTarget ||
    proposal.characterStructureTarget?.mutation.type === "createItem" ||
    proposal.plotStructureTarget?.mutation.type === "create" ||
    proposal.longWorldbuildingTarget?.file.operation === "create" ||
    proposal.longCharacterTarget?.files.some(
      ({ operation }) => operation === "create"
    ) ||
    proposal.provisionalExpertSection ||
    proposal.provisionalCharacterItemId
  );
}

export function agentProposalSupportsDiscard(
  proposal: AgentEditProposal
): boolean {
  if (
    proposal.status !== "accepted" ||
    proposal.discardState?.status === "discarded" ||
    isAgentCreationProposal(proposal)
  ) {
    return false;
  }
  if (proposal.longWorldbuildingTarget) {
    return proposal.longWorldbuildingTarget.file.operation !== "create";
  }
  if (proposal.longCharacterTarget) {
    return (
      proposal.longCharacterTarget.files.length === 1 &&
      proposal.longCharacterTarget.files[0]?.operation !== "create"
    );
  }
  if (proposal.longDraftTarget) {
    return proposal.longDraftTarget.file.operation !== "create";
  }
  if (proposal.longPlotDesignTarget) {
    return Boolean(proposal.discardSnapshot?.longUndoBatch);
  }
  if (proposal.characterStructureTarget) {
    return (
      proposal.characterStructureTarget.mutation.type === "updateItem" ||
      proposal.characterStructureTarget.mutation.type === "moveItem"
    );
  }
  if (proposal.plotStructureTarget) {
    return proposal.plotStructureTarget.mutation.type === "update";
  }
  if (proposal.draftSectionRenameTarget) return true;
  return Boolean(
    proposal.discardSnapshot?.beforeText !== undefined &&
    (proposal.proposedRevision !== proposal.baseRevision ||
      proposal.title !== proposal.discardSnapshot.beforeTitle)
  );
}

export function agentApprovalCanDiscard(
  message: Pick<ChatMessage, "toolCalls">,
  proposal: AgentEditProposal
): boolean {
  return (
    approvalUsesModificationTool(message, proposal.toolCallIds) &&
    agentProposalSupportsDiscard(proposal)
  );
}

function isLongContentEdit(item: LongWorkspaceProposalItem): boolean {
  const event = item.event;
  if (
    event.type !== "long.worldbuilding_file_proposal" &&
    event.type !== "long.character_file_proposal" &&
    event.type !== "long.continuity_file_proposal"
  ) {
    return false;
  }
  return (
    event.payload.files.length === 1 &&
    event.payload.files[0]?.operation !== "create"
  );
}

function isLongMutationEdit(item: LongWorkspaceProposalItem): boolean {
  return Boolean(
    item.event.type === "long.mutation_proposal" &&
    item.preview &&
    buildLongEditUndoBatch(item.event.payload.batch, item.preview)
  );
}

export function longProposalSupportsDiscard(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.status === "accepted" &&
    item.discardState?.status !== "discarded" &&
    (isLongContentEdit(item) || isLongMutationEdit(item))
  );
}

export function longApprovalCanDiscard(
  message: Pick<ChatMessage, "toolCalls">,
  item: LongWorkspaceProposalItem
): boolean {
  return (
    approvalUsesModificationTool(message, [item.event.payload.toolCallId]) &&
    longProposalSupportsDiscard(item)
  );
}

export function buildLongEditUndoBatch(
  batch: LongWorkspaceOperationBatch,
  preview: NonNullable<LongWorkspaceProposalItem["preview"]>
): LongWorkspaceOperationBatch | undefined {
  if (batch.documentWrites.length) return undefined;
  const operations: LongWorkspaceOperationBatch["operations"] = [];
  for (const operation of batch.operations) {
    if (!operation.type.endsWith(".update") || !("id" in operation)) {
      return undefined;
    }
    const before = preview.entityChanges.find(
      (change) => change.id === operation.id
    )?.before;
    if (!before || typeof before !== "object" || !("patch" in operation)) {
      return undefined;
    }
    const beforeRecord = before as unknown as Record<string, unknown>;
    const patch = Object.fromEntries(
      Object.keys(operation.patch).map((key) => [key, beforeRecord[key]])
    );
    if (Object.values(patch).some((value) => value === undefined)) {
      return undefined;
    }
    operations.push({ ...operation, patch } as typeof operation);
  }
  if (!operations.length) return undefined;
  return {
    baseRevision: batch.baseRevision,
    updatedAt: batch.updatedAt,
    operations,
    documentWrites: []
  };
}

export function discardStatePatch(
  status: NonNullable<AgentEditProposal["discardState"]>["status"],
  message: string
): NonNullable<AgentEditProposal["discardState"]> {
  return { status, message, updatedAt: new Date().toISOString() };
}
