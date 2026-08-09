import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App right pane preference integration", () => {
  it("restores a stage-specific width and persists explicit resize actions", () => {
    expect(source).toContain("const activeRightPanePreferenceKey = computed");
    expect(source).toContain('workspaceType: "long"');
    expect(source).toContain("stageId: activeLongRoot.value");
    expect(source).toContain("watch(activeRightPanePreferenceKey");
    expect(source).toContain("restoreRightPaneWidthForNavigation(key)");
    expect(source).toContain("persistActiveRightPaneWidth(rightPaneWidth.value)");
    expect(source).toContain("rightPaneWidth.value !== currentWidth");
  });

  it("restores navigation widths without animating the whole workspace", () => {
    expect(source).toContain("const paneTransitionSuppressed = ref(false)");
    expect(source).toContain(
      '"is-pane-transition-suppressed": paneTransitionSuppressed.value'
    );
    expect(source).toContain('{ flush: "sync" }');
    expect(source).toContain("window.requestAnimationFrame(() => {");
  });

  it("keys short and script widths from the selected stage rather than the shared agent", () => {
    const preferenceBlock = source.slice(
      source.indexOf("const activeRightPanePreferenceKey = computed"),
      source.indexOf("const liveWorkspaceDocuments = computed")
    );
    expect(preferenceBlock).toContain("const document = activeDocument.value");
    expect(preferenceBlock).toContain("const stageId = document.stageId ?? nodeStageId");
    expect(preferenceBlock).toContain("const workspaceType = document.workspaceType");
    expect(preferenceBlock).not.toContain("activeAgentDocument.value.stageId");
  });

  it("uses saved widths when reconciling window size without replacing them", () => {
    expect(source).toContain("restoreRightPaneWidth();");
    expect(source).toContain("rightPanePreferences.value.widths[key] ?? defaultRightPaneWidth");
    expect(source).toContain(": defaultRightPaneWidth;");
    expect(source).not.toContain("saveRightPanePreferences(window.localStorage, { widths: {} })");
  });
});
