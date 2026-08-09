import { describe, expect, it } from "vitest";
import appSource from "../App.vue?raw";
import source from "./SettingsPage.vue?raw";

describe("SettingsPage", () => {
  it("can open directly on a requested settings category", () => {
    expect(source).toContain("initialCategory?: string");
    expect(source).toContain('ref(props.initialCategory ?? "general")');
  });

  it("offers a persisted auto-save switch in general settings", () => {
    expect(source).toContain("<strong>自动保存</strong>");
    expect(source).toContain(':checked="autoSaveEnabled"');
    expect(source).toContain("emit('updateAutoSave'");
  });

  it("keeps only the requested general controls and makes permission modes exclusive", () => {
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('type="radio"');
    expect(source).toContain("permissionMode === 'request-approval'");
    expect(source).toContain("permissionMode === 'auto-approve'");
    expect(source).toContain("<strong>请求批准</strong>");
    expect(source).toContain("<strong>替我审批</strong>");
    expect(source).not.toContain("permissionMode === 'full-access'");
    expect(source).not.toContain("<strong>完全访问权限</strong>");
    expect(source).toContain("emit('updatePermissionMode'");
    expect(source).not.toContain("<strong>默认文件打开目标</strong>");
  });

  it("wires language and menu-bar controls to persisted settings", () => {
    expect(source).toContain(':model-value="language"');
    expect(source).toContain("emit('updateLanguage'");
    expect(source).toContain(':checked="showInMenuBar"');
    expect(source).toContain("emit('updateShowInMenuBar'");
  });

  it("keeps the language selector from squeezing its label column", () => {
    expect(source).toContain('class="settings-item settings-select-item"');
    expect(source).toContain(".settings-select-item { flex-wrap: wrap; }");
    expect(source).toContain("flex: 0 1 210px;");
  });

  it("provides a dedicated learning-imitation prompt category", () => {
    expect(source).toContain('label: "学习仿写设置"');
    expect(source).toContain("<LearningImitationSettingsPanel");
    expect(source).toContain("emit('saveLearningImitation', $event)");
  });

  it("keeps agent-team management outside the settings page", () => {
    expect(source).not.toContain('id: "agent-teams"');
    expect(source).not.toContain("<AgentTeamSettingsPanel");
    expect(source).not.toContain("saveAgentTeams");
  });

  it("provides dedicated skill and material library agent categories", () => {
    expect(source).toContain('label: "技能库配置"');
    expect(source).toContain('label: "素材库配置"');
    expect(source).toContain("<LibraryAgentSettingsPanel");
    expect(source).toContain('domain="skill"');
    expect(source).toContain('domain="material"');
    expect(source).toContain("emit('saveLibraryAgents', $event)");
    expect(source).toContain("emit('resetLibraryAgent', $event)");
  });

  it("shows usage above the official models entry", () => {
    const usageIndex = source.indexOf('{ id: "usage", label: "用量"');
    const customModelsIndex = source.indexOf(
      '{ id: "custom-models", label: "自定义模型配置"'
    );
    const officialModelsIndex = source.indexOf(
      '{ id: "official-models", label: "DeepWrite 官方国内模型"'
    );

    expect(usageIndex).toBeGreaterThan(-1);
    expect(customModelsIndex).toBeGreaterThan(usageIndex);
    expect(officialModelsIndex).toBeGreaterThan(customModelsIndex);
    expect(source).toContain('model-scope="custom"');
    expect(source).toContain('emit("loadModels")');
    expect(source).toContain("emit('saveModels', $event)");
    expect(source).toContain("emit('testModel', $event)");
    expect(source).toContain("<OfficialModelsPanel");
    expect(source).toContain("emit('saveOfficialToken', $event)");
    expect(source).toContain('if (id === "official-models")');
    expect(source).toContain('emit("loadOfficialModels")');
  });

  it("connects custom model management to the existing app model state and actions", () => {
    expect(appSource).toContain(':model-loading="modelLoading"');
    expect(appSource).toContain(':model-saving="modelSaving"');
    expect(appSource).toContain('@load-models="loadModelSettings"');
    expect(appSource).toContain('@save-models="saveModelSettings"');
    expect(appSource).toContain('@test-model="testModel"');
  });

  it("lets users replace a font-size value and previews valid input immediately", () => {
    expect(source).toContain('@input="previewFontSize(\'uiFontSize\', $event)"');
    expect(source).toContain('@change="commitFontSize(\'uiFontSize\', $event)"');
    expect(source).not.toContain("restoreEmptyFontSize");
  });

  it("previews valid typed colors and validates incomplete values on commit", () => {
    expect(source).toContain('@input="previewColor(\'background\', $event)"');
    expect(source).toContain('@change="commitColor(\'background\', $event)"');
    expect(source).toContain("preset: \"custom\"");
    expect(source).toContain("editingTheme.accent.toLowerCase()");
    expect(source).toContain("editingTheme.background.toLowerCase()");
    expect(source).toContain("editingTheme.foreground.toLowerCase()");
    expect(source).toContain("openColorPicker(");
    expect(source).toContain("appearance.whenReady()");
    expect(source).not.toContain(
      'appearance.updateTheme(editingScheme.value, { preset: "custom" })'
    );
  });
});
