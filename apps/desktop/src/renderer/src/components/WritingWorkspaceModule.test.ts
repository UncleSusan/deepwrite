import { describe, expect, it } from "vitest";
import appSource from "../App.vue?raw";
import source from "./WritingWorkspaceModule.vue?raw";

describe("WritingWorkspaceModule boundary", () => {
  it("owns the default short and script conversation/editor surface", () => {
    expect(source).toContain("<AgentConversation");
    expect(source).toContain("<RightEditorPane");
    expect(source).toContain('class="pane-resizer pane-resizer-right"');
    expect(source).toContain('v-if="!viewModel.rightPane.collapsed"');
    expect(appSource).toContain("<WritingWorkspaceModule");
    expect(appSource).toContain(
      "workspaceMainView === 'conversation' && !isLongWorkspaceActive"
    );
    expect(appSource).not.toContain("<RightEditorPane");
  });

  it("accepts one typed view model and forwards domain events", () => {
    expect(source).toContain("interface WritingWorkspaceModuleViewModel");
    expect(source).toContain("viewModel: WritingWorkspaceModuleViewModel");
    expect(source).toContain('v-bind="viewModel.conversation"');
    expect(source).toContain('v-bind="viewModel.editor"');
    expect(source).toContain("AgentConversationPublicProps");
    expect(source).toContain("RightEditorPanePublicProps");
    expect(source).not.toMatch(/\bany\b/u);
    expect(appSource).toContain(':view-model="writingWorkspaceViewModel"');
    expect(appSource).toContain('@update:draft="composerDraft = $event"');
    expect(appSource).toContain('@save="applyDocument"');
    expect(appSource).toContain(
      '@resize-start="startPaneResize(\'right\', $event)"'
    );
  });

  it("keeps the left navigation resizer in the App shell", () => {
    expect(appSource).toContain('class="pane-resizer pane-resizer-left"');
    expect(source).not.toContain("pane-resizer-left");
    expect(source).not.toContain("workspaceMainView");
  });
});
