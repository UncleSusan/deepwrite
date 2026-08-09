import { describe, expect, it } from "vitest";
import longPanelSource from "./LongAgentSettingsPanel.vue?raw";
import workspacePanelSource from "./ShortAgentSettingsPanel.vue?raw";
import settingsPageSource from "./SettingsPage.vue?raw";

describe("long agent settings UI", () => {
  it("exposes all six long-form roles in the creation settings page", () => {
    for (const id of [
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "expert_section_writer",
      "continuity_ledger"
    ]) {
      expect(longPanelSource).toContain(`id: "${id}"`);
    }
    expect(workspacePanelSource).toContain(
      "@click=\"activeWorkspaceType = 'long'\""
    );
    expect(workspacePanelSource).not.toContain(
      "长篇 <small>尚未接入</small>"
    );
    expect(settingsPageSource).toContain(
      "@save-long=\"emit('saveLongAgents', $event)\""
    );
  });

  it("only edits prompts, shortcuts and read access", () => {
    expect(longPanelSource).toContain("LongAgentSettingsInputSchema.safeParse");
    expect(longPanelSource).toContain("readAccess");
    expect(longPanelSource).toContain("系统提示词");
    expect(longPanelSource).toContain("欢迎快捷按钮");
    expect(longPanelSource).not.toContain("v-model=\"activeAgent.writeAccess");
    expect(longPanelSource).not.toContain("patchWriteAccess");
  });

  it("shows immutable write boundaries and locks their required read roots", () => {
    expect(longPanelSource).toContain("isRequiredWorkspaceRoot");
    expect(longPanelSource).toContain(
      ":disabled=\"formDisabled || isRequiredWorkspaceRoot(option.id)\""
    );
    expect(longPanelSource).toContain("写入与工具边界");
    expect(longPanelSource).toContain("不能通过设置扩大");
  });

  it("removes stage read controls only from short and script settings", () => {
    expect(workspacePanelSource).not.toContain("<legend>创作空间</legend>");
    expect(workspacePanelSource).not.toContain("REQUIRED_WORKSPACE_STAGES");
    expect(workspacePanelSource).not.toContain("readAccess.workspace");
    expect(workspacePanelSource).toContain("创作空间各阶段始终可按需读取");
    expect(longPanelSource).toContain("<legend>长篇工作区</legend>");
    expect(longPanelSource).toContain("readAccess.workspaceRoots");
  });

  it("uses global theme surfaces and remains responsive in narrow windows", () => {
    expect(longPanelSource).toContain("var(--surface-raised)");
    expect(longPanelSource).toContain("var(--theme-line-soft)");
    expect(longPanelSource).toContain("var(--text-primary)");
    expect(longPanelSource).toContain("@media (max-width: 760px)");
    expect(longPanelSource).not.toContain("<select");
  });

  it("uses loading, saving and feedback state isolated from short and script", () => {
    expect(workspacePanelSource).toContain("longLoading: boolean");
    expect(workspacePanelSource).toContain("longSaving: boolean");
    expect(workspacePanelSource).toContain("longErrorMessage: string | null");
    expect(workspacePanelSource).toContain('import { uiMessage } from "../ui-feedback"');
    expect(workspacePanelSource).not.toContain("toast-stack");
    expect(workspacePanelSource).not.toContain("settings-toast");
    expect(workspacePanelSource).not.toContain("statusMessage");
    expect(workspacePanelSource).not.toContain("errorMessage: string | null");
    expect(workspacePanelSource).toContain(':loading="longLoading"');
    expect(workspacePanelSource).toContain(':saving="longSaving"');
    expect(settingsPageSource).toContain(':long-loading="longAgentLoading"');
    expect(settingsPageSource).toContain(':long-saving="longAgentSaving"');
    expect(settingsPageSource).not.toContain("workspaceAgentStatus");
    expect(settingsPageSource).not.toContain("longAgentStatus");
    expect(longPanelSource).toContain("loadError?: string | null");
    expect(longPanelSource).toContain('v-else-if="loadError"');
    expect(longPanelSource).toContain("@click=\"emit('retry')\"");
    expect(workspacePanelSource).toContain("@retry=\"emit('retryLong')\"");
    expect(settingsPageSource).toContain(
      "@retry-long=\"emit('retryLongAgents')\""
    );
  });
});
