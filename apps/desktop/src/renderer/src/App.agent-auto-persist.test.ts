import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App agent realtime auto persistence", () => {
  it("allows every short, script, and library proposal to commit during a run", () => {
    const eligibilityStart = source.indexOf(
      "function canReviewAgentEditDuringRun"
    );
    const eligibilityEnd = source.indexOf(
      "function removeQueuedAgentEdit",
      eligibilityStart
    );
    const eligibility = source.slice(eligibilityStart, eligibilityEnd);

    expect(eligibility).toContain("Boolean(proposal.libraryTarget)");
    expect(eligibility).toContain("isShortOrScriptAgentEdit(proposal)");
    expect(eligibility).not.toContain('proposal.stageId === "draft"');
  });

  it("immediately schedules ordinary workspace and library auto approvals", () => {
    const workspaceQueueStart = source.lastIndexOf(
      "queueAgentEdit(",
      source.indexOf("function stageLibraryEditProposal")
    );
    const workspaceQueue = source.slice(
      workspaceQueueStart,
      source.indexOf("function stageLibraryEditProposal")
    );
    expect(workspaceQueue).toContain("proposal.id");
    expect(workspaceQueue).toMatch(/proposal\.id,\s*true,\s*true/s);

    const libraryStageStart = source.indexOf(
      "function stageLibraryEditProposal"
    );
    const libraryStageEnd = source.indexOf(
      "async function acceptDraftSectionCreationProposal",
      libraryStageStart
    );
    const libraryStage = source.slice(libraryStageStart, libraryStageEnd);
    expect(libraryStage).toMatch(/proposalId,\s*true,\s*true/s);
  });

  it("enables live proposal handling for every main conversation context", () => {
    expect(source).toContain("allow-live-edit-review");
    expect(source).not.toContain(
      ":allow-live-edit-review=\"\n          activeAgentDocument.domain === 'creation'"
    );
  });
});
