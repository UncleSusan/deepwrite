import { describe, expect, it } from "vitest";
import appSource from "./WorkspaceShell.vue?raw";
import applyReviewSource from "./composables/proposal-coordinator/apply-review.ts?raw";
import characterStructureLaneSource from "./composables/proposal-coordinator/character-structure-lane.ts?raw";
import queueSource from "./composables/proposal-coordinator/queue.ts?raw";

describe("App character structure agent approvals", () => {
  it("stages character file and structure proposals through the shared review flow", () => {
    const coordinatorSource = [
      characterStructureLaneSource,
      applyReviewSource,
      queueSource
    ].join("\n");
    expect(coordinatorSource).toContain('mutationTarget?.kind === "character-structure"');
    expect(coordinatorSource).toContain('mutationTarget?.kind === "character-file"');
    expect(coordinatorSource).toContain("characterStructureTarget: {");
    expect(coordinatorSource).toContain("acceptCharacterStructureProposal(");
    expect(coordinatorSource).toContain(
      "await currentApi.catalog.mutateCharacterStructure({"
    );
    expect(coordinatorSource).toContain("provisionalCharacterItemId");
    expect(coordinatorSource).toContain("findPendingCharacterCreationForProvisional(");
    expect(coordinatorSource).toContain(
      'proposal.characterStructureTarget?.mutation.type === "createItem"'
    );
    expect(coordinatorSource).toContain("await loadCatalogSnapshot()");
    expect(appSource).toContain("useLazyProposalCoordinator({");
  });
});
