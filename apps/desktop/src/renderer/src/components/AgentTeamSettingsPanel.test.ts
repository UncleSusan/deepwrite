import { describe, expect, it } from "vitest";
import componentSource from "./AgentTeamSettingsPanel.vue?raw";
import templateSource from "./AgentTeamSettingsPanel.template.html?raw";
import longSource from "./LongAgentTeamSettingsPanel.vue?raw";
import metaSource from "./agentTeamSettingsMeta.ts?raw";

const source = `${componentSource}\n${templateSource}\n${metaSource}`;

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
    expect(source).toContain(
      ":aria-selected=\"activeWorkspaceType === 'script'\""
    );
    expect(source).toContain("@click=\"activeWorkspaceType = 'long'\"");
    expect(source).toContain(':settings="longSettings"');
    expect(source.match(/role="tab"/g)?.length).toBe(3);
    expect(source).toContain(
      "const activeSkills = computed(() => props.skills ?? [])"
    );
    expect(source).not.toContain(
      "skill.skillType === activeWorkspaceType.value"
    );
  });

  it("maps the unified long parent agent and preserves approval boundaries", () => {
    expect(longSource).toContain("LONG_AGENT_IDS");
    expect(longSource).toContain(
      "parentAgentId: LongAgentId = LONG_AGENT_IDS[0]"
    );
    expect(longSource).not.toContain('id: "setting"');
    expect(longSource).not.toContain("expert_section_writer");
    expect(longSource).toContain("由长篇智能体按需调用");
    expect(source).toContain("不能继续创建子智能体");
    expect(source).toContain("不能绕过用户审批");
    expect(longSource).toContain("LongAgentTeamSettingsInputSchema.safeParse");
  });

  it("keeps long-form subagent styling and editing features aligned", () => {
    for (const marker of [
      "从技能库加载",
      "subagent-summary",
      "subagentModelSummary",
      "editingSubagentId",
      "model-mode-options",
      "完成编辑",
      "当前主智能体"
    ]) {
      expect(longSource).toContain(marker);
    }
    expect(longSource).toContain("LoadSubagentFromSkillDialog");
    expect(longSource).toContain(
      '@change="toggleSubagent(definition, $event)"'
    );
    expect(longSource).toContain('@click="removeSubagent(index)"');
    expect(longSource).toContain('@click="saveSettings"');
  });

  it("uses one parent team for short and script workspaces", () => {
    expect(source).toContain('id: "short"');
    expect(source).toContain('label: "短篇智能体"');
    expect(source).toContain('id: "script"');
    expect(source).toContain('label: "剧本智能体"');
    expect(source).toContain('v-if="visibleParentAgents.length > 1"');
    expect(source).toContain("SCRIPT_PARENT_AGENTS");
    expect(source).toContain("SHORT_PARENT_AGENT");
    expect(source).toContain("activeSubagentLimit");
    expect(source).toContain("SCRIPT_AGENT_SUBAGENT_MAX_COUNT");
    expect(source).not.toContain('label: "人设"');
    expect(source).not.toContain('label: "剧情"');
    expect(source).not.toContain('label: "正文"');
    expect(source).not.toContain('label: "大纲"');
    expect(source).not.toContain('label: "分节"');
    expect(source).toContain("不能继续创建子智能体");
    expect(source).toContain("默认跟随所属主智能体的模型");
  });

  it("expands the editor when the single parent navigation is hidden", () => {
    expect(templateSource).toContain(
      `:class="{ 'is-single-column': visibleParentAgents.length === 1 }"`
    );
  });

  it("supports model mode inherit or custom with PopupSelect", () => {
    expect(source).toContain("跟随主智能体");
    expect(source).toContain("单独配置模型");
    expect(source).toContain("setSubagentModelMode(subagent, 'inherit')");
    expect(source).toContain("setSubagentModelMode(subagent, 'custom')");
    expect(source).toContain("PopupSelect");
    expect(source).toContain("models:");
    expect(source).toContain("setSubagentThinkingLevel");
    expect(source).toContain("setSubagentTemperature");
    expect(source).toContain("v-if=\"subagent.thinkingLevel === 'off'\"");
    expect(source.indexOf("模型配置")).toBeLessThan(
      source.indexOf("<span>名称</span>")
    );
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
