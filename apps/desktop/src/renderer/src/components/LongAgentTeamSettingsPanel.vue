<script setup lang="ts">
import {
  BUILT_IN_REASONING_LEVELS,
  LONG_AGENT_IDS,
  LongAgentTeamSettingsInputSchema,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  type BuiltInReasoningLevel,
  type LongAgentId,
  type LongAgentTeamSettings,
  type LongAgentTeamSettingsInput,
  type ModelConfig,
  type ShortAgentSubagentDefinition,
  type ShortAgentSubagentModelMode,
  type ThinkingLevel
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

const props = defineProps<{
  settings: LongAgentTeamSettings | null;
  models: readonly ModelConfig[];
  loading: boolean;
  saving: boolean;
  loadError?: string | null;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  save: [settings: LongAgentTeamSettingsInput];
}>();

const PARENT_AGENTS = [
  {
    id: "worldbuilding",
    label: "世界观",
    description: "配置规则校验、设定研究和冲突审阅等专项助手。"
  },
  {
    id: "character_design",
    label: "人物",
    description: "配置人物关系、状态连续性和人物弧等专项助手。"
  },
  {
    id: "plot_design",
    label: "剧情",
    description: "配置时间线、叙事顺序、章卡和伏笔等专项助手。"
  },
  {
    id: "draft",
    label: "正文统筹",
    description: "配置章节计划、跨章审阅和调度检查等专项助手。"
  },
  {
    id: "expert_section_writer",
    label: "单章写手",
    description: "配置场景、对白、文风和细节审阅等专项助手。"
  },
  {
    id: "continuity_ledger",
    label: "连续性",
    description: "配置事实核验、伏笔决策和提交审计等专项助手。"
  }
] as const satisfies readonly {
  id: LongAgentId;
  label: string;
  description: string;
}[];

const activeParentAgentId = ref<LongAgentId>(LONG_AGENT_IDS[0]);
const draftTeams = ref<LongAgentTeamSettingsInput["teams"]>([]);
let generatedIdSequence = 0;

const formDisabled = computed(
  () =>
    props.loading ||
    props.saving ||
    Boolean(props.loadError) ||
    !props.runtimeAvailable
);
const activeParentMeta = computed(
  () =>
    PARENT_AGENTS.find(
      (agent) => agent.id === activeParentAgentId.value
    ) ?? PARENT_AGENTS[0]
);
const activeTeam = computed(() =>
  draftTeams.value.find(
    (team) => team.parentAgentId === activeParentAgentId.value
  )
);
const modelById = computed(
  () => new Map(props.models.map((model) => [model.id, model]))
);
const modelOptions = computed<PopupSelectOption[]>(() =>
  props.models.map((model) => ({ value: model.id, label: model.label }))
);

const THINKING_LABELS: Record<BuiltInReasoningLevel, string> = {
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};

watch(
  () => props.settings,
  (settings) => {
    draftTeams.value = settings
      ? settings.teams.map((team) => ({
          parentAgentId: team.parentAgentId,
          subagents: team.subagents.map((definition) => ({
            ...definition
          }))
        }))
      : [];
  },
  { immediate: true, deep: true }
);

function thinkingLabel(level: ThinkingLevel): string {
  if (level === "off") return "关闭";
  return BUILT_IN_REASONING_LEVELS.includes(level as BuiltInReasoningLevel)
    ? THINKING_LABELS[level as BuiltInReasoningLevel]
    : `自定义（${level}）`;
}

function thinkingOptionsFor(
  definition: ShortAgentSubagentDefinition
): PopupSelectOption[] {
  const model = definition.modelId
    ? modelById.value.get(definition.modelId)
    : undefined;
  return [
    { value: "off", label: "关闭" },
    ...(model?.thinkingLevelOptions ?? BUILT_IN_REASONING_LEVELS).map(
      (level) => ({
        value: level,
        label: thinkingLabel(level)
      })
    )
  ];
}

function temperatureOptionsFor(
  definition: ShortAgentSubagentDefinition
): PopupSelectOption[] {
  const model = definition.modelId
    ? modelById.value.get(definition.modelId)
    : undefined;
  return (model?.temperatureOptions ?? [0.1, 0.7, 1]).map(
    (temperature) => ({
      value: temperature,
      label: `温度 ${temperature}`
    })
  );
}

function applyModelDefaults(
  definition: ShortAgentSubagentDefinition,
  modelId: string | undefined
): void {
  const model = modelId ? modelById.value.get(modelId) : undefined;
  definition.thinkingLevel = model?.defaultThinkingLevel ?? "medium";
  definition.temperature = model?.temperatureOptions[1] ?? 0.7;
}

function setModelMode(
  definition: ShortAgentSubagentDefinition,
  mode: ShortAgentSubagentModelMode
): void {
  if (formDisabled.value) return;
  definition.modelMode = mode;
  if (mode === "inherit") {
    delete definition.modelId;
    delete definition.thinkingLevel;
    delete definition.temperature;
    return;
  }
  if (!definition.modelId && props.models[0]) {
    definition.modelId = props.models[0].id;
  }
  applyModelDefaults(definition, definition.modelId);
}

function setModelId(
  definition: ShortAgentSubagentDefinition,
  modelId: string
): void {
  definition.modelId = modelId;
  applyModelDefaults(definition, modelId);
}

function setThinkingLevel(
  definition: ShortAgentSubagentDefinition,
  level: ThinkingLevel
): void {
  definition.thinkingLevel = level;
  if (level === "off" && definition.temperature === undefined) {
    definition.temperature = Number(
      temperatureOptionsFor(definition)[1]?.value ?? 0.7
    );
  }
}

function nextSubagentId(): string {
  generatedIdSequence += 1;
  return `long_subagent_${Date.now().toString(36)}_${generatedIdSequence.toString(36)}`;
}

function addSubagent(): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value) return;
  if (team.subagents.length >= SHORT_AGENT_SUBAGENT_MAX_COUNT) {
    uiMessage.warning(
      `每个长篇主智能体最多配置 ${SHORT_AGENT_SUBAGENT_MAX_COUNT} 个子智能体`
    );
    return;
  }
  const index = team.subagents.length + 1;
  team.subagents.push({
    id: nextSubagentId(),
    name: `新子智能体 ${index}`,
    description: "",
    systemPrompt: "",
    enabled: true,
    modelMode: "inherit"
  });
}

function removeSubagent(index: number): void {
  if (formDisabled.value) return;
  activeTeam.value?.subagents.splice(index, 1);
  uiMessage.info("已从长篇团队草稿移除；保存后生效。");
}

function validationMessage(): string | null {
  for (const team of draftTeams.value) {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const definition of team.subagents) {
      if (!definition.name.trim()) return "子智能体名称不能为空";
      if (!definition.description.trim()) return "子智能体能力说明不能为空";
      if (!definition.systemPrompt.trim()) return "子智能体系统提示词不能为空";
      const normalizedId = definition.id.toLocaleLowerCase();
      const normalizedName = definition.name.trim().toLocaleLowerCase();
      if (ids.has(normalizedId)) return "同一主智能体下的子智能体 ID 不能重复";
      if (names.has(normalizedName)) return "同一主智能体下的子智能体名称不能重复";
      ids.add(normalizedId);
      names.add(normalizedName);
      if (definition.modelMode === "custom") {
        const model = definition.modelId
          ? modelById.value.get(definition.modelId)
          : undefined;
        if (!model) return "单独配置模型时必须选择有效模型";
        if (definition.thinkingLevel === undefined) {
          return "单独配置模型时必须选择思考等级";
        }
        if (
          definition.thinkingLevel !== "off" &&
          !model.thinkingLevelOptions.includes(definition.thinkingLevel)
        ) {
          return `子智能体「${definition.name}」的思考等级不受所选模型支持`;
        }
        if (
          definition.thinkingLevel === "off" &&
          (definition.temperature === undefined ||
            !model.temperatureOptions.includes(definition.temperature))
        ) {
          return `子智能体「${definition.name}」必须选择模型支持的温度`;
        }
      }
    }
  }
  return null;
}

function saveSettings(): void {
  if (formDisabled.value) return;
  const message = validationMessage();
  if (message) {
    uiMessage.warning(message);
    return;
  }
  const parsed = LongAgentTeamSettingsInputSchema.safeParse({
    workspaceType: "long",
    teams: LONG_AGENT_IDS.map((parentAgentId) => {
      const team = draftTeams.value.find(
        (candidate) => candidate.parentAgentId === parentAgentId
      );
      return {
        parentAgentId,
        subagents: (team?.subagents ?? []).map((definition) => ({
          id: definition.id,
          name: definition.name.trim(),
          description: definition.description.trim(),
          systemPrompt: definition.systemPrompt.trim(),
          enabled: definition.enabled,
          modelMode: definition.modelMode ?? "inherit",
          ...(definition.modelMode === "custom" && definition.modelId
            ? {
                modelId: definition.modelId,
                thinkingLevel: definition.thinkingLevel,
                ...(definition.thinkingLevel === "off"
                  ? { temperature: definition.temperature }
                  : {})
              }
            : {})
        }))
      };
    })
  });
  if (!parsed.success) {
    uiMessage.warning(
      parsed.error.issues[0]?.message ?? "长篇智能体团队配置不完整"
    );
    return;
  }
  emit("save", parsed.data);
}
</script>

<template>
  <div v-if="loading" class="panel-state">正在加载长篇智能体团队设置…</div>
  <div v-else-if="loadError" class="panel-state panel-error" role="alert">
    <strong>长篇智能体团队设置未加载</strong>
    <p>{{ loadError }}</p>
    <button
      type="button"
      class="secondary-button"
      :disabled="loading"
      @click="emit('retry')"
    >
      重新加载
    </button>
  </div>
  <div v-else-if="!settings || !activeTeam" class="panel-state">
    暂无可用的长篇智能体团队设置。
  </div>
  <div v-else class="long-team-layout">
    <nav class="parent-nav" aria-label="长篇主智能体">
      <button
        v-for="parent in PARENT_AGENTS"
        :key="parent.id"
        type="button"
        :class="{ 'is-active': parent.id === activeParentAgentId }"
        @click="activeParentAgentId = parent.id"
      >
        <span>{{ parent.label }}</span>
        <small>
          {{
            draftTeams.find((team) => team.parentAgentId === parent.id)
              ?.subagents.length ?? 0
          }}
        </small>
      </button>
    </nav>

    <div class="team-editor">
      <header class="team-heading">
        <div>
          <span>长篇主智能体</span>
          <h3>{{ activeParentMeta.label }}</h3>
          <p>{{ activeParentMeta.description }}</p>
        </div>
        <button
          type="button"
          class="secondary-button"
          :disabled="
            formDisabled ||
            activeTeam.subagents.length >= SHORT_AGENT_SUBAGENT_MAX_COUNT
          "
          @click="addSubagent"
        >
          <AppIcon name="plus" :size="15" />
          新增子智能体
        </button>
      </header>

      <p class="boundary-note">
        子智能体不继承主智能体提示词或会话，只继承该长篇角色已经受限的查询与提案工具；不能继续创建子智能体，也不能绕过用户审批。
      </p>

      <div v-if="!activeTeam.subagents.length" class="empty-team">
        <strong>还没有子智能体</strong>
        <p>新增后，长篇主智能体会根据能力说明决定是否委派。</p>
      </div>

      <div v-else class="subagent-list">
        <article
          v-for="(definition, index) in activeTeam.subagents"
          :key="definition.id"
          class="subagent-card"
        >
          <header>
            <label class="enabled-toggle">
              <input
                v-model="definition.enabled"
                type="checkbox"
                :disabled="formDisabled"
              />
              <span>{{ definition.enabled ? "启用" : "停用" }}</span>
            </label>
            <button
              type="button"
              class="remove-button"
              :disabled="formDisabled"
              aria-label="删除长篇子智能体"
              @click="removeSubagent(index)"
            >
              删除
            </button>
          </header>

          <div class="field-grid">
            <label>
              <span>名称</span>
              <input
                v-model="definition.name"
                type="text"
                maxlength="80"
                :disabled="formDisabled"
              />
            </label>
            <label>
              <span>能力说明</span>
              <input
                v-model="definition.description"
                type="text"
                maxlength="1000"
                :disabled="formDisabled"
              />
            </label>
          </div>

          <label class="prompt-field">
            <span>系统提示词</span>
            <textarea
              v-model="definition.systemPrompt"
              :disabled="formDisabled"
              spellcheck="false"
            />
          </label>

          <div class="model-grid">
            <label>
              <span>模型方式</span>
              <PopupSelect
                :model-value="definition.modelMode ?? 'inherit'"
                :options="[
                  { value: 'inherit', label: '跟随主智能体' },
                  { value: 'custom', label: '单独配置' }
                ]"
                :disabled="formDisabled"
                accessible-label="长篇子智能体模型方式"
                @update:model-value="
                  setModelMode(
                    definition,
                    String($event) as ShortAgentSubagentModelMode
                  )
                "
              />
            </label>
            <template v-if="definition.modelMode === 'custom'">
              <label>
                <span>模型</span>
                <PopupSelect
                  :model-value="definition.modelId ?? ''"
                  :options="modelOptions"
                  :disabled="formDisabled || !modelOptions.length"
                  accessible-label="长篇子智能体模型"
                  @update:model-value="
                    setModelId(definition, String($event))
                  "
                />
              </label>
              <label>
                <span>思考等级</span>
                <PopupSelect
                  :model-value="definition.thinkingLevel ?? 'medium'"
                  :options="thinkingOptionsFor(definition)"
                  :disabled="formDisabled"
                  accessible-label="长篇子智能体思考等级"
                  @update:model-value="
                    setThinkingLevel(
                      definition,
                      String($event) as ThinkingLevel
                    )
                  "
                />
              </label>
              <label v-if="definition.thinkingLevel === 'off'">
                <span>温度</span>
                <PopupSelect
                  :model-value="definition.temperature ?? 0.7"
                  :options="temperatureOptionsFor(definition)"
                  :disabled="formDisabled"
                  accessible-label="长篇子智能体温度"
                  @update:model-value="
                    definition.temperature = Number($event)
                  "
                />
              </label>
            </template>
          </div>
        </article>
      </div>

      <footer class="panel-actions">
        <button
          type="button"
          class="primary-button"
          :disabled="formDisabled"
          @click="saveSettings"
        >
          {{ saving ? "保存中…" : "保存长篇智能体团队" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.panel-state,
.empty-team,
.boundary-note {
  padding: 16px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 11px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.panel-error strong {
  color: var(--text-primary);
}

.long-team-layout {
  display: grid;
  grid-template-columns: minmax(150px, 190px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.parent-nav {
  display: grid;
  gap: 7px;
  position: sticky;
  top: 18px;
}

.parent-nav button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 8px 11px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.parent-nav button.is-active {
  border-color: var(--theme-line);
  background: var(--surface-selected);
  color: var(--text-primary);
}

.parent-nav small {
  color: var(--text-tertiary);
}

.team-editor,
.subagent-list {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.team-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.team-heading span {
  color: var(--text-tertiary);
  font-size: 12px;
}

.team-heading h3 {
  margin: 4px 0;
  color: var(--text-primary);
  font-size: 20px;
}

.team-heading p,
.boundary-note,
.empty-team p {
  margin: 0;
  line-height: 1.55;
}

.subagent-card {
  padding: 15px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}

.subagent-card > header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.enabled-toggle {
  display: flex;
  gap: 7px;
  align-items: center;
  color: var(--text-secondary);
}

.remove-button {
  border: 0;
  background: transparent;
  color: var(--danger-text, #b42318);
  font: inherit;
  cursor: pointer;
}

.field-grid,
.model-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.prompt-field {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.field-grid label,
.model-grid label {
  display: grid;
  gap: 6px;
}

label > span {
  color: var(--text-secondary);
  font-size: 12px;
}

input[type="text"],
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: none;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
}

input[type="text"] {
  min-height: 38px;
  padding: 8px 10px;
}

textarea {
  min-height: 112px;
  padding: 10px;
  resize: vertical;
}

.model-grid {
  margin-top: 10px;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
}

.secondary-button,
.primary-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 8px 14px;
  border-radius: 9px;
  font: inherit;
  cursor: pointer;
}

.secondary-button {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.primary-button {
  border: 1px solid var(--text-primary);
  background: var(--text-primary);
  color: var(--surface-main);
}

button:disabled,
input:disabled,
textarea:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

@media (max-width: 760px) {
  .long-team-layout {
    grid-template-columns: 1fr;
  }

  .parent-nav {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field-grid,
  .model-grid {
    grid-template-columns: 1fr;
  }
}
</style>
