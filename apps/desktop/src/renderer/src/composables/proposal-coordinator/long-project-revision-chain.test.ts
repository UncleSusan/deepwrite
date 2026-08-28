import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../../types/conversation";
import coordinatorSource from "../useProposalCoordinator.ts?raw";
import extractedDraftLaneSource from "./long-draft-lane.ts?raw";
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
  it("allows different chapters in one run to follow the last accepted chapter revision", () => {
    const firstChapter = proposal("chapter-eleven", {
      status: "accepted",
      stageId: "long-draft",
      documentId: "longfile_chapter-eleven_body",
      longDraftTarget: {
        appliedProjectRevision: 11
      } as NonNullable<AgentEditProposal["longDraftTarget"]>
    });
    const secondChapter = proposal("chapter-fifteen", {
      stageId: "long-draft",
      documentId: "longfile_chapter-fifteen_body"
    });

    expect(
      longProjectRevisionMatchesProposalChain({
        proposals: [firstChapter, secondChapter],
        proposal: secondChapter,
        baseProjectRevision: 10,
        latestProjectRevision: 11
      })
    ).toBe(true);
  });

  it("uses the run-wide revision chain in both long-draft implementations", () => {
    for (const source of [coordinatorSource, extractedDraftLaneSource]) {
      const acceptance = source.split(
        "async function acceptLongDraftProposal("
      )[1];

      expect(acceptance).toContain("longProjectRevisionMatchesProposalChain({");
      expect(acceptance).toContain(
        "proposals: conversation.listEditProposals(request.runId)"
      );
      expect(acceptance).not.toContain("predecessorProjectRevision");
    }
  });

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
