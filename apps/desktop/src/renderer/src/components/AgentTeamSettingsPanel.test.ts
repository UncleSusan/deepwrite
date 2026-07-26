import { describe, expect, it } from "vitest";
import source from "./AgentTeamSettingsPanel.vue?raw";
import longSource from "./LongAgentTeamSettingsPanel.vue?raw";

describe("AgentTeamSettingsPanel", () => {
  it("explains the isolated subagent prompt and skill boundary", () => {
    expect(source).toContain("不继承主智能体提示词、会话或技能库");
    expect(source).toContain("完全由你写的系统提示词决定");
    expect(source).toContain("从技能库加载");
  });

  it("enables short, script and independent long-form teams", () => {
    expect(source).toContain("短篇");
    expect(source).toContain("剧本");
    expect(source).toContain("长篇");
    expect(source).not.toContain("尚未接入");
    expect(source).toContain("@click=\"activeWorkspaceType = 'script'\"");
    expect(source).toContain(":aria-selected=\"activeWorkspaceType === 'script'\"");
    expect(source).toContain("@click=\"activeWorkspaceType = 'long'\"");
    expect(source).toContain(":settings=\"longSettings\"");
    expect(source.match(/role=\"tab\"/g)?.length).toBe(3);
  });

  it("maps all six long parent agents and preserves approval boundaries", () => {
    for (const id of [
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "expert_section_writer",
      "continuity_ledger"
    ]) {
      expect(longSource).toContain(`id: "${id}"`);
    }
    expect(longSource).toContain("不能继续创建子智能体");
    expect(longSource).toContain("不能绕过用户审批");
    expect(longSource).toContain("LongAgentTeamSettingsInputSchema.safeParse");
  });

  it("maps the five short parent agents and prevents recursive delegation", () => {
    for (const label of ["人设", "剧情", "大纲", "正文", "分节"]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).toContain("不能继续创建子智能体");
    expect(source).toContain("默认跟随所属主智能体的模型");
  });

  it("supports model mode inherit or custom with PopupSelect", () => {
    expect(source).toContain("跟随主智能体");
    expect(source).toContain("单独配置模型");
    expect(source).toContain('setSubagentModelMode(subagent, \'inherit\')');
    expect(source).toContain('setSubagentModelMode(subagent, \'custom\')');
    expect(source).toContain("PopupSelect");
    expect(source).toContain("models:");
    expect(source).toContain("setSubagentThinkingLevel");
    expect(source).toContain("setSubagentTemperature");
    expect(source).toContain('v-if="subagent.thinkingLevel === \'off\'"');
    expect(source.indexOf("模型配置")).toBeLessThan(source.indexOf("<span>名称</span>"));
  });

  it("supports adding, editing, enabling, deleting and saving subagents", () => {
    expect(source).toContain('@click="addSubagent()"');
    expect(source).toContain('@click="openLoadFromSkill"');
    expect(source).toContain('@click="editSubagent(subagent.id)"');
    expect(source).toContain('@change="toggleSubagent(subagent, $event)"');
    expect(source).toContain('@click="removeSubagent(index)"');
    expect(source).toContain('@click="saveSettings"');
    expect(source).toContain("WorkspaceAgentTeamSettingsInputSchema.safeParse");
  });

  it("isolates long loading failures and keeps a successfully loaded sibling editable", () => {
    expect(source).not.toContain("Boolean(props.loadError)");
    expect(source).toContain('v-else-if="loadError && !activeSettings"');
    expect(source).toContain(':loading="longLoading"');
    expect(source).toContain(':saving="longSaving"');
    expect(source).toContain(':load-error="longLoadError ?? null"');
    expect(source).toContain("emit('retry')");
  });
});
