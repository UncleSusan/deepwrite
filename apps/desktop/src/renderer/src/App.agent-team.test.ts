import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App agent-team integration", () => {
  it("opens agent-team management from the workspace sidebar", () => {
    expect(source).toContain('@open-agent-teams="openAgentTeams"');
    expect(source).toContain('workspaceMainView.value = "agent-team"');
    expect(source).toContain('type WorkspaceMainView = "conversation" | "directory" | "models" | "imitation" | "agent-team"');
    expect(source).toContain("<AgentTeamSettingsPanel");
    expect(source).toContain(':models="modelSettings?.models ?? []"');
    expect(source).toContain("class=\"agent-team-main-view\"");
  });

  it("keeps agent-team persistence in App instead of SettingsPage", () => {
    expect(source).toContain('window.deepwrite.agentTeams.list("short")');
    expect(source).toContain("window.deepwrite.agentTeams.save(settings)");
    expect(source).toContain('@save="saveAgentTeamSettings"');
    expect(source).not.toContain(':agent-team-settings="agentTeamSettings"');
    expect(source).not.toContain('@save-agent-teams="saveAgentTeamSettings"');
  });

  it("keeps unsaved team drafts mounted and does not reload them on every click", () => {
    expect(source).toContain('v-show="workspaceMainView === \'agent-team\'"');
    expect(source).toContain('v-show="workspaceMainView === \'conversation\'"');
    expect(source).toContain("!agentTeamLoaded.value");
    expect(source).toContain(':load-error="agentTeamLoadError"');
    expect(source).toContain('@retry="loadAgentTeamSettings"');
  });

  it("returns to the writing workspace when a document or new conversation is selected", () => {
    expect(source.match(/workspaceMainView\.value = "conversation"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("workspaceMainView === 'conversation' && !rightCollapsed");
  });

  it("keeps workspace utilities beside agent-team as full main views", () => {
    expect(source).toContain('class="workspace-settings-main-view"');
    expect(source).toContain('class="learning-imitation-main-view"');
    expect(source).toContain(':active-primary-feature="activePrimaryFeature"');
  });

  it("loads and saves long teams independently in both failure directions", () => {
    expect(source).toContain("const longAgentTeamLoading = ref(false)");
    expect(source).toContain("const longAgentTeamSaving = ref(false)");
    expect(source).toContain("const longAgentTeamLoadError = ref<string | null>(null)");
    expect(source).toContain("loadShortAndScriptAgentTeamSettings()");
    expect(source).toContain("loadLongAgentTeamSettings()");
    expect(source).toContain("Promise.allSettled([");
    expect(source).toContain(
      "if (!agentTeamLoaded.value && !agentTeamLoading.value)"
    );
    expect(source).toContain(
      "if (!longAgentTeamLoaded.value && !longAgentTeamLoading.value)"
    );
    expect(source).toContain(':long-loading="longAgentTeamLoading"');
    expect(source).toContain(':long-saving="longAgentTeamSaving"');
    expect(source).toContain(':long-load-error="longAgentTeamLoadError"');
  });

  it("loads and saves long agent profiles independently from short and script", () => {
    expect(source).toContain("const longAgentLoading = ref(false)");
    expect(source).toContain("const longAgentSaving = ref(false)");
    expect(source).toContain("loadShortAndScriptAgentSettings()");
    expect(source).toContain("loadLongAgentSettings()");
    expect(source).toContain(':long-agent-loading="longAgentLoading"');
    expect(source).toContain(':long-agent-saving="longAgentSaving"');
    expect(source).toContain(
      "const longAgentLoadError = ref<string | null>(null)"
    );
    expect(source).toContain(
      "let longAgentLoadPromise: Promise<boolean> | null = null"
    );
    expect(source).toContain("ensureLongAgentSettingsLoaded()");
    expect(source).toContain(
      '@retry-long-agents="loadLongAgentSettings"'
    );
  });

  it("keeps short/script and long feedback timers independent in both directions", () => {
    const workspaceFeedback =
      source
        .split("function showWorkspaceAgentFeedback")[1]
        ?.split("function showLongAgentFeedback")[0] ?? "";
    const longFeedback =
      source
        .split("function showLongAgentFeedback")[1]
        ?.split("async function loadShortAndScriptAgentSettings")[0] ?? "";
    expect(workspaceFeedback).toContain("workspaceAgentFeedbackTimer");
    expect(workspaceFeedback).not.toContain("longAgentFeedbackTimer");
    expect(longFeedback).toContain("longAgentFeedbackTimer");
    expect(longFeedback).not.toContain("workspaceAgentFeedbackTimer");
    expect(source).toContain(
      "window.clearTimeout(longAgentFeedbackTimer)"
    );
  });

  it("keeps long loading outside the short/script startup and focus critical paths", () => {
    const mounted =
      source
        .split("onMounted(async () => {")[1]
        ?.split("onBeforeUnmount(() => {")[0] ?? "";
    const awaitedStartup =
      mounted.split("await Promise.all([")[1]?.split("]);")[0] ?? "";
    expect(awaitedStartup).toContain(
      "loadShortAndScriptAgentSettings()"
    );
    expect(awaitedStartup).toContain(
      "loadShortAndScriptAgentTeamSettings()"
    );
    expect(awaitedStartup).not.toContain("loadLongBookList");
    expect(awaitedStartup).not.toContain("loadLongAgentSettings");
    expect(awaitedStartup).not.toContain("loadLongAgentTeamSettings");
    expect(mounted.indexOf("scheduleDirtyEditorDraftsForAutoSave()")).toBeLessThan(
      mounted.indexOf("loadLongBookList({ notify: false })")
    );
    expect(mounted.indexOf("scheduleDirtyEditorDraftsForAutoSave()")).toBeLessThan(
      mounted.indexOf("loadLongAgentSettings()")
    );

    const focusRefresh =
      source
        .split("function refreshCatalogOnWindowFocus()")[1]
        ?.split("watch([leftCollapsed")[0] ?? "";
    expect(focusRefresh).toContain("if (bookId)");
    expect(focusRefresh).toContain(
      "loadLongBookList({ notify: true })"
    );
  });
});
