<script setup lang="ts">
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_DEFAULT_PLOT_STAGE_IDS,
  ShortWorkspaceAgentSettingsInputSchema,
  type CreativePlotStage,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import WorkspaceAgentProfileForm from "./WorkspaceAgentProfileForm.vue";

type EditableAgent = ShortWorkspaceAgentSettingsInput["agents"][number];

const props = defineProps<{
  settings: ShortWorkspaceAgentSettings | null;
  plotStages: readonly CreativePlotStage[];
  loading: boolean;
  saving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  save: [input: ShortWorkspaceAgentSettingsInput];
}>();

const draft = ref<EditableAgent | null>(null);
const defaultPlotStageIds = ref<string[]>([]);
const STAGE_POLICY = [
  "人物：人物素材；通用、剧情、其他技能",
  "剧情：卖点、人物、剧情素材；通用、剧情、其他技能",
  "正文：全部素材；文风、通用、其他技能"
];
const selectedDefaultPlotStageIds = computed(() => {
  const availableIds = new Set(props.plotStages.map(({ id }) => id));
  return defaultPlotStageIds.value.filter((id) => availableIds.has(id));
});

const defaultPlotStages = computed(() =>
  props.plotStages.map((stage) => ({
    ...stage,
    enabled: selectedDefaultPlotStageIds.value.includes(stage.id),
    locked:
      selectedDefaultPlotStageIds.value.length === 1 &&
      selectedDefaultPlotStageIds.value.includes(stage.id)
  }))
);

function cloneAgent(
  agent: ShortWorkspaceAgentSettings["agents"][number]
): EditableAgent {
  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    welcomeShortcuts: [...agent.welcomeShortcuts],
    readAccess: {
      material: [...agent.readAccess.material],
      skill: [...agent.readAccess.skill]
    }
  };
}

watch(
  () => props.settings,
  (settings) => {
    draft.value = settings?.agents[0] ? cloneAgent(settings.agents[0]) : null;
    defaultPlotStageIds.value = settings
      ? [...settings.defaultPlotStageIds]
      : [...SHORT_DEFAULT_PLOT_STAGE_IDS];
  },
  { immediate: true, deep: true }
);

function patchAccess(
  scope: "material" | "skill",
  id: string,
  checked: boolean
): void {
  if (!draft.value) return;
  const values = new Set(draft.value.readAccess[scope] as readonly string[]);
  if (checked) values.add(id);
  else values.delete(id);
  Object.assign(draft.value.readAccess, { [scope]: [...values] });
}

function patchShortcut(index: number, value: string): void {
  if (draft.value) draft.value.welcomeShortcuts[index] = value;
}

function patchDefaultPlotStage(id: string, enabled: boolean): void {
  const next = new Set(selectedDefaultPlotStageIds.value);
  if (enabled) next.add(id);
  else next.delete(id);
  if (next.size === 0) {
    uiMessage.warning("至少保留一个默认剧情阶段。");
    return;
  }
  defaultPlotStageIds.value = props.plotStages
    .filter((stage) => next.has(stage.id))
    .map((stage) => stage.id);
}

function reset(): void {
  const builtin = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0];
  if (!builtin) return;
  draft.value = cloneAgent(builtin);
  defaultPlotStageIds.value = [...SHORT_DEFAULT_PLOT_STAGE_IDS];
  uiMessage.info("短篇智能体已恢复内置默认值；点击保存后生效。");
}

function save(): void {
  if (!draft.value) return;
  const shortcuts = draft.value.welcomeShortcuts.map((value) => value.trim());
  const parsed = ShortWorkspaceAgentSettingsInputSchema.safeParse({
    workspaceType: "short",
    defaultPlotStageIds: selectedDefaultPlotStageIds.value,
    agents: [
      {
        ...draft.value,
        welcomeShortcuts: shortcuts
      }
    ]
  });
  if (!parsed.success) {
    uiMessage.warning(
      parsed.error.issues[0]?.message ?? "短篇智能体设置不完整"
    );
    return;
  }
  emit("save", parsed.data);
}
</script>

<template>
  <div v-if="loading" class="panel-state">正在加载短篇智能体设置…</div>
  <div v-else-if="!settings || !draft" class="panel-state">
    暂无可用的短篇智能体设置。
  </div>
  <WorkspaceAgentProfileForm
    v-else
    :agent="draft"
    :label="settings.agents[0]?.label ?? '短篇智能体'"
    :description="settings.agents[0]?.description ?? ''"
    eyebrow="统一智能体"
    :disabled="saving || !runtimeAvailable"
    :saving="saving"
    save-label="保存短篇智能体设置"
    :stage-policy="STAGE_POLICY"
    :default-plot-stages="defaultPlotStages"
    @prompt="draft.systemPrompt = $event"
    @shortcut="patchShortcut"
    @access="patchAccess"
    @default-plot-stage="patchDefaultPlotStage"
    @reset="reset"
    @save="save"
  />
</template>

<style scoped>
.panel-state {
  padding: 48px 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: center;
}
</style>
