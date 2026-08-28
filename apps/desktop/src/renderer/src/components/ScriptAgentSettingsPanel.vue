<script setup lang="ts">
import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  ScriptWorkspaceAgentSettingsInputSchema,
  type ScriptWorkspaceAgentSettings,
  type ScriptWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import WorkspaceAgentProfileForm from "./WorkspaceAgentProfileForm.vue";

type EditableAgent = ScriptWorkspaceAgentSettingsInput["agents"][number];

const props = defineProps<{
  settings: ScriptWorkspaceAgentSettings | null;
  loading: boolean;
  saving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  save: [input: ScriptWorkspaceAgentSettingsInput];
}>();

const draft = ref<EditableAgent | null>(null);
const STAGE_POLICY = [
  "人物：人物素材；通用、剧情、其他技能",
  "剧情：卖点、人物、剧情素材；通用、剧情、其他技能",
  "正文：全部素材；文风、通用、其他技能"
];

function cloneAgent(
  agent: ScriptWorkspaceAgentSettings["agents"][number]
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

function reset(): void {
  const builtin = DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0];
  if (!builtin) return;
  draft.value = cloneAgent(builtin);
  uiMessage.info("剧本智能体已恢复内置默认值；点击保存后生效。");
}

function save(): void {
  if (!draft.value) return;
  const parsed = ScriptWorkspaceAgentSettingsInputSchema.safeParse({
    workspaceType: "script",
    agents: [
      {
        ...draft.value,
        welcomeShortcuts: draft.value.welcomeShortcuts.map((value) =>
          value.trim()
        )
      }
    ]
  });
  if (!parsed.success) {
    uiMessage.warning(
      parsed.error.issues[0]?.message ?? "剧本智能体设置不完整"
    );
    return;
  }
  emit("save", parsed.data);
}
</script>

<template>
  <div v-if="loading" class="panel-state">正在加载剧本智能体设置…</div>
  <div v-else-if="!settings || !draft" class="panel-state">
    暂无可用的剧本智能体设置。
  </div>
  <WorkspaceAgentProfileForm
    v-else
    :agent="draft"
    :label="settings.agents[0]?.label ?? '剧本智能体'"
    :description="settings.agents[0]?.description ?? ''"
    eyebrow="统一智能体"
    :disabled="saving || !runtimeAvailable"
    :saving="saving"
    save-label="保存剧本智能体设置"
    :stage-policy="STAGE_POLICY"
    @prompt="draft.systemPrompt = $event"
    @shortcut="patchShortcut"
    @access="patchAccess"
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
