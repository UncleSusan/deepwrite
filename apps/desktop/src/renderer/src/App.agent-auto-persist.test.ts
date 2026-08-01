import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App agent realtime auto persistence", () => {
  it("keeps editor writes behind the active run and review revision barrier", () => {
    expect(source).toContain("function agentRunScopeHasWriteBarrier");
    expect(source).toContain(
      "conversation.isBusy.value || conversation.hasPendingEditReview.value"
    );
    const autoSaveSource =
      source
        .split("async function runEditorAutoSave(")[1]
        ?.split("function applyDocument(")[0] ?? "";
    expect(autoSaveSource).toContain(
      "agentRunScopeHasWriteBarrier(agentRunScopeForDocument(document))"
    );
    expect(source).toContain("请先接受或拒绝待审阅变更");
  });

  it("allows every short, script, library, and long content proposal to commit during a run", () => {
    const eligibilityStart = source.indexOf(
      "function canReviewAgentEditDuringRun"
    );
    const eligibilityEnd = source.indexOf(
      "function removeQueuedAgentEdit",
      eligibilityStart
    );
    const eligibility = source.slice(eligibilityStart, eligibilityEnd);

    expect(eligibility).toContain("Boolean(proposal.libraryTarget)");
    expect(eligibility).toContain(
      "Boolean(proposal.longWorldbuildingTarget)"
    );
    expect(eligibility).toContain(
      "Boolean(proposal.longCharacterTarget)"
    );
    expect(eligibility).toContain(
      "Boolean(proposal.longPlotDesignTarget)"
    );
    expect(eligibility).toContain("Boolean(proposal.longDraftTarget)");
    expect(eligibility).toContain("isShortOrScriptAgentEdit(proposal)");
    expect(eligibility).not.toContain('proposal.stageId === "draft"');
  });

  it("routes long chapter drafts into the standard conversation approval flow", () => {
    expect(source).toContain(
      '} else if (event.type === "long.chapter_write_proposal")'
    );
    expect(source).toContain("stageLongDraftEditProposal(event)");
    expect(source).toContain('stageId: "long-draft"');
    expect(source).toContain("async function acceptLongDraftProposal");
    expect(source).toContain("await acceptLongDraftProposal(");
    const acceptance = source
      .split("async function acceptLongDraftProposal(")[1]
      ?.split("async function applyAgentEdit(")[0] ?? "";
    expect(acceptance).toContain("await api.previewOperations(");
    expect(acceptance).toContain("await api.applyOperations(");
    expect(acceptance).not.toContain("api.writeChapter(");
  });

  it("routes long worldbuilding files into the standard conversation approval flow", () => {
    expect(source).toContain(
      'if (event.type === "long.worldbuilding_file_proposal")'
    );
    expect(source).toContain("stageLongWorldbuildingEditProposal(event)");
    expect(source).toContain(
      'stageId: "long-worldbuilding"'
    );
    expect(source).toContain(
      "async function acceptLongWorldbuildingFileProposal"
    );
    expect(source).toContain(
      "await acceptLongWorldbuildingFileProposal("
    );
  });

  it("routes long character files into the standard conversation approval flow", () => {
    expect(source).toContain(
      '} else if (event.type === "long.character_file_proposal")'
    );
    expect(source).toContain("stageLongCharacterEditProposal(event)");
    expect(source).toContain('stageId: "long-character"');
    expect(source).toContain(
      "async function acceptLongCharacterFileProposal"
    );
    expect(source).toContain(
      "await acceptLongCharacterFileProposal("
    );
  });

  it("routes plot design mutations into the standard conversation approval flow only", () => {
    expect(source).toContain(
      'event.type === "long.mutation_proposal" &&'
    );
    expect(source).toContain(
      'event.payload.agentId === "plot_design"'
    );
    expect(source).toContain("stageLongPlotDesignEditProposal(event)");
    expect(source).toContain('stageId: "long-plot-design"');
    expect(source).toContain("async function acceptLongPlotDesignProposal");
    expect(source).toContain("await acceptLongPlotDesignProposal(");

    const eventRouting = source.slice(
      source.indexOf("function handleSystemEvent"),
      source.indexOf("async function loadModelSettings")
    );
    expect(eventRouting).toMatch(
      /stageLongPlotDesignEditProposal\(event\);\s*} else if/s
    );
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
