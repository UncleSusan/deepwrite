import { describe, expect, it } from "vitest";
import appSource from "./App.vue?raw";
import editorSource from "./components/LongWorkspaceEditor.vue?raw";

describe("accepted approval navigation wiring", () => {
  it("routes both approval card families into the central navigator", () => {
    expect(appSource).toContain(
      '@locate-edit-proposal="locateAcceptedEditProposal"'
    );
    expect(appSource).toContain(
      '@locate-long-proposal="locateAcceptedLongProposal"'
    );
    expect(appSource).toContain("resolveAgentEditApprovalTarget(proposal)");
    expect(appSource).toContain("resolveLongProposalApprovalTarget(item)");
  });

  it("preserves the long editor save barrier and retries stale indexes", () => {
    expect(appSource).toContain("await saveActiveLongEditorChanges()");
    expect(appSource).toContain("resolved.candidateIndex > 0");
    expect(appSource).toContain("await refreshActiveLongWorkspace(target.bookId)");
    expect(appSource).toContain("resolveLongApprovalNavigation(");
    expect(appSource).toContain("rightCollapsed.value = false");
  });

  it("selects exact left-tree items and uses parent fallbacks", () => {
    expect(appSource).toContain("preferredLongResourceIdForSelection(");
    expect(appSource).toContain("if (!target.sectionId)");
    expect(appSource).toContain("await loadCatalogSnapshot()");
    expect(appSource).toContain(
      'uiMessage.warning("目标文件或所属条目已不存在，无法跳转。")'
    );
  });

  it("lets the long editor focus exact files and structured targets", () => {
    expect(editorSource).toContain("async function focusFile(fileId: string)");
    expect(editorSource).toContain(
      "async function focusTarget(target: LongApprovalEditorFocus)"
    );
    expect(editorSource).toContain("selectWorldbuildingItem(item.id)");
    expect(editorSource).toContain('selectPlotPointTab("storyline")');
    expect(editorSource).toContain("foreshadowingWorkspace.value?.focusTarget(");
    expect(editorSource).toContain("defineExpose({");
  });
});
