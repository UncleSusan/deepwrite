import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App agent chapter-file creation", () => {
  it("stages one structural proposal and atomically persists its chapters", () => {
    expect(source).toContain(
      'mutationTarget?.kind === "expert-draft-section-creation"'
    );
    expect(source).toContain(
      'mutationTarget?.kind === "expert-draft-section-rename"'
    );
    expect(source).toContain(
      'mutationTarget?.kind === "expert-draft-section-deletion"'
    );
    expect(source).toContain("draftSectionCreationTarget: {");
    expect(source).toContain("draftSectionRenameTarget: {");
    expect(source).toContain("draftSectionDeletionTarget: {");
    expect(source).toContain("acceptDraftSectionCreationProposal(");
    expect(source).toContain("acceptDraftSectionRenameProposal(");
    expect(source).toContain("acceptDraftSectionDeletionProposal(");
    expect(source).toContain(
      "await window.deepwrite.catalog.deleteDraftSection({"
    );
    expect(source).toContain(
      "await window.deepwrite.catalog.createDraftSections({"
    );
    expect(source).toContain(
      "operationId: draftSectionCreationOperationId(proposal)"
    );
    expect(source).toContain(
      "clientSectionId: section.provisionalSectionId"
    );
    expect(source).toContain(
      "createdCount = created.sections.length"
    );
    expect(source).toContain(
      "applyCatalogSnapshot(await window.deepwrite.catalog.snapshot())"
    );
    expect(source).toContain(
      "expectedDraftSectionCreationBaseRevision(proposal)"
    );
    expect(source).toContain(
      "rememberAcceptedDraftSectionCreation(proposal, savedDirectoryRevision)"
    );
    expect(source).toContain("remapProvisionalExpertSectionFileProposals(");
    expect(source).toContain("restoreAcceptedDraftSectionCreationMappings(");
    expect(source).toContain("acceptedDirectoryRevision: savedDirectoryRevision");
    expect(source).toContain("realSectionId: createdMapping.get(");
    expect(source).toContain("requiresIdempotentRecoveryProbe");
    expect(source).toContain("resolveDraftSectionCreationCommitPlan({");
    expect(source).toContain("target.baseProjectRevision");
    expect(source).toContain("pauseDependentProvisionalFileProposals(");
    expect(source).toContain("provisionalExpertSection: true");
    expect(source).toContain("createExpertDraftDirectoryRevision(");
    expect(source).toContain("autoApproveEditPriority(");
    expect(source).toContain("scheduleQueuedAgentEdits(");
    expect(source).toContain("agentEditCommitQueue");
    expect(source).toContain("decisionToken");
    expect(source).toContain("section.hasBody && section.hasCharacterState");
    expect(source).toContain("expectedDirectoryRevision");
    expect(source).toContain("resolveProvisionalWriteStagingMode(");
    expect(source).toContain('stagingMode === "mapped-real"');
    expect(source).toContain("draftSectionCreationRevisionKey(");
    expect(source).toContain("resolveAgentEditProposalGeneration(");
    expect(source).toContain("expectedMutationDurableRevision(");
  });
});
