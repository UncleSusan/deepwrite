import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../../types/conversation";
import { longProjectRevisionMatchesProposalChain } from "./long-project-revision-chain";

function proposal(
  id: string,
  overrides: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  return {
    id,
    runId: "run_one",
    workspaceId: "long:book_one",
    stageId: "long-plot-design",
    documentId: id,
    title: id,
    summary: id,
    status: "pending",
    baseRevision: "base",
    proposedRevision: "next",
    toolCallIds: [`tool_${id}`],
    additions: 0,
    deletions: 0,
    hunks: [],
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides
  };
}

describe("longProjectRevisionMatchesProposalChain", () => {
  it("accepts the revision produced by earlier worldbuilding create and edit proposals", () => {
    const worldbuildingCreate = proposal("worldbuilding-create", {
      status: "accepted",
      longWorldbuildingTarget: {
        appliedProjectRevision: 11
      } as NonNullable<AgentEditProposal["longWorldbuildingTarget"]>
    });
    const worldbuildingEdit = proposal("worldbuilding-edit", {
      status: "accepted",
      longWorldbuildingTarget: {
        appliedProjectRevision: 12
      } as NonNullable<AgentEditProposal["longWorldbuildingTarget"]>
    });
    const chapter = proposal("chapter");

    expect(
      longProjectRevisionMatchesProposalChain({
        proposals: [worldbuildingCreate, worldbuildingEdit, chapter],
        proposal: chapter,
        baseProjectRevision: 10,
        latestProjectRevision: 12
      })
    ).toBe(true);
  });

  it("does not trust later, rejected, cross-run, or external revisions", () => {
    const chapter = proposal("chapter");
    const earlier = proposal("earlier", {
      status: "accepted",
      longWorldbuildingTarget: {
        appliedProjectRevision: 11
      } as NonNullable<AgentEditProposal["longWorldbuildingTarget"]>
    });
    const later = proposal("later", {
      status: "accepted",
      longPlotDesignTarget: {
        appliedProjectRevision: 12
      } as NonNullable<AgentEditProposal["longPlotDesignTarget"]>
    });
    const rejected = proposal("rejected", {
      status: "rejected",
      longCharacterTarget: {
        appliedProjectRevision: 12
      } as NonNullable<AgentEditProposal["longCharacterTarget"]>
    });
    const otherRun = proposal("other-run", {
      runId: "run_two",
      status: "accepted",
      longDraftTarget: {
        appliedProjectRevision: 12
      } as NonNullable<AgentEditProposal["longDraftTarget"]>
    });

    for (const proposals of [
      [chapter, later],
      [rejected, chapter],
      [otherRun, chapter],
      [chapter],
      [earlier, chapter]
    ]) {
      expect(
        longProjectRevisionMatchesProposalChain({
          proposals,
          proposal: chapter,
          baseProjectRevision: 10,
          latestProjectRevision: 12
        })
      ).toBe(false);
    }
  });

  it("continues to accept an unchanged base project revision", () => {
    const chapter = proposal("chapter");
    expect(
      longProjectRevisionMatchesProposalChain({
        proposals: [chapter],
        proposal: chapter,
        baseProjectRevision: 10,
        latestProjectRevision: 10
      })
    ).toBe(true);
  });
});
