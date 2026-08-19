import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import longWorkspaceSource from "./components/LongWorkspaceModule.vue?raw";
import writingWorkspaceSource from "./components/WritingWorkspaceModule.vue?raw";
import autoSaveSource from "./composables/useEditorAutoSaveCoordinator.ts?raw";
import presentationCoordinatorSource from "./composables/useLongWorkspacePresentationCoordinator.ts?raw";
import applyReviewSource from "./composables/proposal-coordinator/apply-review.ts?raw";
import libraryLaneSource from "./composables/proposal-coordinator/library-lane.ts?raw";
import longCharacterLaneSource from "./composables/proposal-coordinator/long-character-lane.ts?raw";
import longDraftLaneSource from "./composables/proposal-coordinator/long-draft-lane.ts?raw";
import longPlotLaneSource from "./composables/proposal-coordinator/long-plot-lane.ts?raw";
import longWorldbuildingLaneSource from "./composables/proposal-coordinator/long-worldbuilding-lane.ts?raw";
import queueSource from "./composables/proposal-coordinator/queue.ts?raw";
import shortConversationSource from "./composables/useShortConversationCoordinator.ts?raw";
import eventRoutesSource from "./events/registerWorkspaceSystemEventRoutes.ts?raw";

describe("App agent realtime auto persistence", () => {
  it("keeps editor writes behind the active run and review revision barrier", () => {
    expect(presentationCoordinatorSource).toContain(
      "function agentRunScopeHasWriteBarrier"
    );
    expect(presentationCoordinatorSource).toContain("conversation.isBusy.value");
    expect(presentationCoordinatorSource).toContain(
      "conversation.hasPendingEditReview.value"
    );
    expect(presentationCoordinatorSource).toContain(
      "agentRunScopeHasWriteBarrier(agentRunScopeForDocument(document))"
    );
    expect(source).toContain("useLongWorkspacePresentationCoordinator({");
    expect(source).not.toContain("function agentRunScopeHasWriteBarrier");
    expect(autoSaveSource).toContain("options.isWriteBlocked(document)");
    expect(presentationCoordinatorSource).toContain(
      "请先接受或拒绝待审阅变更"
    );
  });

  it("allows every short, script, library, and long content proposal to commit during a run", () => {
    const eligibilityStart = queueSource.indexOf(
      "function canReviewAgentEditDuringRun"
    );
    const eligibilityEnd = queueSource.indexOf(
      "function removeQueuedAgentEdit",
      eligibilityStart
    );
    const eligibility = queueSource.slice(eligibilityStart, eligibilityEnd);

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
    expect(eventRoutesSource).toContain(
      '} else if (event.type === "long.chapter_write_proposal")'
    );
    expect(eventRoutesSource).toContain(
      "dependencies.stageLongDraftEditProposal(event)"
    );
    expect(source).toContain("stageLongDraftEditProposal,");
    expect(longDraftLaneSource).toContain('stageId: "long-draft"');
    expect(longDraftLaneSource).toContain(
      "async function acceptLongDraftProposal"
    );
    expect(applyReviewSource).toContain("await acceptLongDraftProposal(");
    const acceptance =
      longDraftLaneSource.split("async function acceptLongDraftProposal(")[1] ??
      "";
    expect(acceptance).toContain("await api.previewOperations(");
    expect(acceptance).toContain("await api.applyOperations(");
    expect(acceptance).not.toContain("api.writeChapter(");
  });

  it("routes long worldbuilding files into the standard conversation approval flow", () => {
    expect(eventRoutesSource).toContain(
      'if (event.type === "long.worldbuilding_file_proposal")'
    );
    expect(eventRoutesSource).toContain(
      "dependencies.stageLongWorldbuildingEditProposal(event)"
    );
    expect(source).toContain("stageLongWorldbuildingEditProposal,");
    expect(longWorldbuildingLaneSource).toContain(
      'stageId: "long-worldbuilding"'
    );
    expect(longWorldbuildingLaneSource).toContain(
      "async function acceptLongWorldbuildingFileProposal"
    );
    expect(applyReviewSource).toContain(
      "await acceptLongWorldbuildingFileProposal("
    );
  });

  it("routes long character files into the standard conversation approval flow", () => {
    expect(eventRoutesSource).toContain(
      '} else if (event.type === "long.character_file_proposal")'
    );
    expect(eventRoutesSource).toContain(
      "dependencies.stageLongCharacterEditProposal(event)"
    );
    expect(source).toContain("stageLongCharacterEditProposal,");
    expect(longCharacterLaneSource).toContain('stageId: "long-character"');
    expect(longCharacterLaneSource).toContain(
      "async function acceptLongCharacterFileProposal"
    );
    expect(applyReviewSource).toContain(
      "await acceptLongCharacterFileProposal("
    );
  });

  it("routes plot design mutations into the standard conversation approval flow only", () => {
    expect(eventRoutesSource).toContain(
      'event.type === "long.mutation_proposal" &&'
    );
    expect(eventRoutesSource).toContain(
      'event.payload.agentId === "plot_design"'
    );
    expect(eventRoutesSource).toContain(
      "dependencies.stageLongPlotDesignEditProposal(event)"
    );
    expect(source).toContain("stageLongPlotDesignEditProposal,");
    expect(longPlotLaneSource).toContain('stageId: "long-plot-design"');
    expect(longPlotLaneSource).toContain(
      "async function acceptLongPlotDesignProposal"
    );
    expect(applyReviewSource).toContain("await acceptLongPlotDesignProposal(");

    const eventRouting = eventRoutesSource.slice(
      eventRoutesSource.indexOf("export function registerWorkspaceSystemEventRoutes")
    );
    expect(eventRouting).toMatch(
      /dependencies\.stageLongPlotDesignEditProposal\(event\);\s*} else if/s
    );
  });

  it("immediately schedules ordinary workspace and library auto approvals", () => {
    expect(libraryLaneSource).toContain("function stageLibraryEditProposal");
    expect(libraryLaneSource).toContain("queueAgentEdit(");
    expect(libraryLaneSource).toMatch(/proposalId,\s*true,\s*true/s);
    expect(applyReviewSource).toContain("queueAgentEdit(");
    expect(applyReviewSource).toMatch(/proposal\.id,\s*true,\s*true/s);
  });

  it("enables live proposal handling for every main conversation context", () => {
    expect(shortConversationSource).toContain("allowLiveEditReview: true");
    expect(writingWorkspaceSource).toContain('v-bind="conversationContext"');
    expect(longWorkspaceSource).toContain("allow-live-edit-review");
    expect(source).not.toContain(
      ":allow-live-edit-review=\"\n          activeAgentDocument.domain === 'creation'"
    );
  });
});
