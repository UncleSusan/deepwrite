import type { AgentEditProposal } from "../../types/conversation";

function appliedLongProjectRevision(
  proposal: AgentEditProposal
): number | undefined {
  return (
    proposal.longWorldbuildingTarget?.appliedProjectRevision ??
    proposal.longCharacterTarget?.appliedProjectRevision ??
    proposal.longPlotDesignTarget?.appliedProjectRevision ??
    proposal.longDraftTarget?.appliedProjectRevision
  );
}

/**
 * A long-form proposal may safely follow an earlier accepted proposal from the
 * same run and book. Other project-revision changes still require regeneration.
 */
export function longProjectRevisionMatchesProposalChain(input: {
  proposals: readonly AgentEditProposal[];
  proposal: AgentEditProposal;
  baseProjectRevision: number;
  latestProjectRevision: number;
}): boolean {
  if (input.latestProjectRevision === input.baseProjectRevision) return true;

  const proposalIndex = input.proposals.findIndex(
    ({ id }) => id === input.proposal.id
  );
  if (proposalIndex < 0) return false;

  return input.proposals.slice(0, proposalIndex).some((candidate) => {
    return (
      candidate.runId === input.proposal.runId &&
      candidate.workspaceId === input.proposal.workspaceId &&
      candidate.status === "accepted" &&
      appliedLongProjectRevision(candidate) === input.latestProjectRevision
    );
  });
}
