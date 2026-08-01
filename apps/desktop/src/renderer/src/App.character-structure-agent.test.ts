import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App character structure agent approvals", () => {
  it("stages character file and structure proposals through the shared review flow", () => {
    expect(source).toContain('mutationTarget?.kind === "character-structure"');
    expect(source).toContain('mutationTarget?.kind === "character-file"');
    expect(source).toContain("characterStructureTarget: {");
    expect(source).toContain("acceptCharacterStructureProposal(");
    expect(source).toContain(
      "await window.deepwrite.catalog.mutateCharacterStructure({"
    );
    expect(source).toContain("provisionalCharacterItemId");
    expect(source).toContain("findPendingCharacterCreationForProvisional(");
    expect(source).toContain(
      'proposal.characterStructureTarget?.mutation.type === "createItem"'
    );
    expect(source).toContain(
      "applyCatalogSnapshot(await window.deepwrite.catalog.snapshot())"
    );
  });
});
