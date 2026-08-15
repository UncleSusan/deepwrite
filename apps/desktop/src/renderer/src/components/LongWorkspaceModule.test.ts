import { describe, expect, it } from "vitest";
import shellSource from "../WorkspaceShell.vue?raw";
import source from "./LongWorkspaceModule.vue?raw";

describe("LongWorkspaceModule boundary", () => {
  it("owns the long conversation and editor surface", () => {
    expect(shellSource).toContain("<LongWorkspaceModule");
    expect(shellSource).not.toContain("<LongWorkspaceEditor");
    expect(source).toContain("<AgentConversation");
    expect(source).toContain("<LongWorkspaceEditor");
    expect(source).toContain('class="long-workspace-main-view"');
    expect(source).toContain('v-show="!rightCollapsed"');
  });

  it("reads high-frequency conversation state below the shell boundary", () => {
    expect(shellSource).toContain(
      ':conversation-controller="activeLongConversation"'
    );
    expect(shellSource).toContain(
      ':writing-orchestrator="longWritingOrchestrator"'
    );
    expect(shellSource).not.toContain("const longMessages = computed(");
    expect(shellSource).not.toContain("const longComposerDraft = computed(");
    expect(source).toContain("conversationController.messages.value");
    expect(source).toContain("props.conversationController?.draft.value");
    expect(source).toContain("conversationController.isBusy.value");
    expect(source).toContain("writingOrchestrator.state.value.phase");
    expect(source).not.toMatch(/\bany\b/u);
  });

  it("preserves the inner editor port and multi-argument event contracts", () => {
    expect(source).toContain('editorPortChange: [port: LongWorkspaceEditorPort | null]');
    expect(source).toContain(':ref="captureEditorPort"');
    expect(source).toContain('emit("editorPortChange", null)');
    expect(shellSource).toContain(
      '@editor-port-change="updateLongWorkspaceEditorPort"'
    );
    expect(source).toContain(
      'emit("renameStructureTitle", input, completion)'
    );
    expect(source).toContain('emit("mutation", batch, completion)');
  });
});
