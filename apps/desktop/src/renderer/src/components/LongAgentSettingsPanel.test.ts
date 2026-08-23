import { describe, expect, it } from "vitest";
import longPanelSource from "./LongAgentSettingsPanel.vue?raw";
import workspacePanelSource from "./ShortAgentSettingsPanel.vue?raw";
import settingsPageSource from "./SettingsPage.vue?raw";

describe("long agent settings UI", () => {
  it("exposes a single unified long-form agent in the creation settings page", () => {
    expect(longPanelSource).toContain("LONG_AGENT_IDS");
    expect(longPanelSource).toContain('id: "worldbuilding"');
    expect(longPanelSource).toContain('id: "character_design"');
    expect(longPanelSource).toContain('id: "plot_design"');
    expect(longPanelSource).toContain('id: "draft"');
    expect(longPanelSource).toContain('id: "continuity_ledger"');
    expect(longPanelSource).not.toContain('id: "setting"');
    expect(longPanelSource).not.toContain("expert_section_writer");
    expect(longPanelSource).toContain("长篇智能体已恢复内置值");
    expect(workspacePanelSource).toContain(
      "@click=\"activeWorkspaceType = 'long'\""
    );
    expect(workspacePanelSource).not.toContain("长篇 <small>尚未接入</small>");
    expect(settingsPageSource).toContain(
      "@save-long=\"emit('saveLongAgents', $event)\""
    );
  });

  it("edits prompts, shortcuts and catalog read scopes", () => {
    expect(longPanelSource).toContain("LongAgentSettingsInputSchema.safeParse");
    expect(longPanelSource).toContain("readAccess.materialKinds");
    expect(longPanelSource).toContain("readAccess.skillKinds");
    expect(longPanelSource).toContain("系统提示词");
    expect(longPanelSource).toContain("欢迎快捷按钮");
    expect(longPanelSource).toContain("素材库");
    expect(longPanelSource).toContain("技能库");
    expect(longPanelSource).not.toContain('v-model="activeAgent.writeAccess');
    expect(longPanelSource).not.toContain("patchWriteAccess");
  });

  it("shows fixed full read access and immutable write boundaries", () => {
    expect(longPanelSource).not.toContain("isRequiredWorkspaceRoot");
    expect(longPanelSource).toContain("阶段读取、写入与工具边界");
    expect(longPanelSource).toContain(
      "阶段范围与写入边界由应用内置并在 Main 与工具层强制校验。"
    );
    expect(longPanelSource).toContain(
      "阶段读取范围：世界观、人物、剧情、正文与连续性账本全部可读"
    );
  });

  it("removes stage read controls from short, script and long settings", () => {
    expect(workspacePanelSource).not.toContain("<legend>创作空间</legend>");
    expect(workspacePanelSource).not.toContain("REQUIRED_WORKSPACE_STAGES");
    expect(workspacePanelSource).not.toContain("readAccess.workspace");
    expect(workspacePanelSource).toContain("创作空间各阶段始终可按需读取");
    expect(longPanelSource).not.toContain("<legend>长篇工作区</legend>");
    expect(longPanelSource).not.toContain(
      "handleCheckboxChange('workspaceRoots'"
    );
  });

  it("uses global theme surfaces and remains responsive in narrow windows", () => {
    expect(longPanelSource).toContain("var(--surface-raised)");
    expect(longPanelSource).toContain("var(--theme-line-soft)");
    expect(longPanelSource).toContain("var(--text-primary)");
    expect(longPanelSource).toContain(
      'v-else class="long-agent-settings-layout"'
    );
    expect(longPanelSource).not.toContain('v-else class="settings-layout"');
    expect(longPanelSource).toContain("@media (max-width: 760px)");
    expect(longPanelSource).not.toContain("<select");
  });

  it("uses loading, saving and feedback state isolated from short and script", () => {
    expect(workspacePanelSource).toContain("longLoading: boolean");
    expect(workspacePanelSource).toContain("longSaving: boolean");
    expect(workspacePanelSource).toContain("longErrorMessage: string | null");
    expect(workspacePanelSource).toContain(
      'import { uiMessage } from "../ui-feedback"'
    );
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
