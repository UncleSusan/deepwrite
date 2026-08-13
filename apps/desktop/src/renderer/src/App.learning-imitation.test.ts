import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App learning-imitation integration", () => {
  it("lazily owns one long-lived controller and routes runtime events to it", () => {
    expect(source).toContain("useLazyLearningImitationController");
    expect(source).toContain("learningImitationFeature.handleEvent(event)");
    expect(source).toContain("learningImitationFeature.ensureLoaded()");
    expect(source).toContain(":controller=\"learningImitation\"");
  });

  it("opens learning imitation as a persistent workspace page", () => {
    expect(source).toContain('@open-dialog="openWorkspaceDialog"');
    expect(source).toContain("workspaceMainView.value = mode");
    expect(source).toContain("workspaceMainView === 'imitation'");
    expect(source).toContain(':active="workspaceMainView === \'imitation\'"');
    expect(source).toContain('class="learning-imitation-main-view"');
    expect(source).toContain('key="learning-imitation"');
    expect(source).not.toContain("learningImitationOpen");
  });

  it("shows a sidebar background marker and disposes lazy controllers with App", () => {
    expect(source).toContain(':imitation-running="learningImitationRunning"');
    expect(source).toContain("learningImitationFeature.dispose();");
    expect(source).toContain("subagentAuthoringFeature.dispose();");
  });

  it("surfaces rejected learning and subagent calls as floating messages", () => {
    expect(source).toContain("() => learningImitation.value?.error.value ?? null");
    expect(source).toContain("() => subagentAuthoring.value?.error.value ?? null");
    expect(source).toContain("uiMessage.error(message)");
  });
});
