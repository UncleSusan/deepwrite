<script setup lang="ts">
import {
  SINGLE_MODEL_LONG_ROLE_PRESETS,
  createSingleModelLongTeamSettings,
  type LongAgentTeamSettings,
  type LongAgentTeamSettingsInput,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

const props = defineProps<{
  settings: LongAgentTeamSettings;
  models: readonly ModelConfig[];
  preferredModelId: string | null;
  saving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  apply: [settings: LongAgentTeamSettingsInput];
}>();

const selectedModelId = ref("");
const confirmOpen = ref(false);
const ollamaModels = computed(() =>
  props.models.filter(
    ({ provider }) => provider.trim().toLowerCase() === "ollama"
  )
);
const modelOptions = computed<PopupSelectOption[]>(() =>
  ollamaModels.value.map((model) => ({
    value: model.id,
    label: model.label,
    description: `${model.provider} · ${model.modelId}`
  }))
);
const existingRoleCount = computed(() =>
  props.settings.teams.reduce((total, team) => total + team.subagents.length, 0)
);

watch(
  () => [props.models, props.preferredModelId] as const,
  () => {
    if (ollamaModels.value.some(({ id }) => id === selectedModelId.value))
      return;
    const autodl = ollamaModels.value.find(
      ({ deploymentTarget }) => deploymentTarget === "autodl-ollama"
    );
    const preferred = ollamaModels.value.find(
      ({ id }) => id === props.preferredModelId
    );
    selectedModelId.value =
      autodl?.id ?? preferred?.id ?? ollamaModels.value[0]?.id ?? "";
  },
  { immediate: true }
);

function requestApply(): void {
  if (!selectedModelId.value) {
    uiMessage.warning("请先在模型配置中添加并选择 AutoDL Ollama 模型。");
    return;
  }
  if (existingRoleCount.value > 0) {
    confirmOpen.value = true;
    return;
  }
  applyPreset();
}

function applyPreset(): void {
  confirmOpen.value = false;
  emit("apply", createSingleModelLongTeamSettings(selectedModelId.value));
}
</script>

<template>
  <section class="single-model-preset" aria-labelledby="single-model-title">
    <header>
      <div>
        <span>本地推理模板</span>
        <h3 id="single-model-title">单模型多角色</h3>
        <p>五个角色复用同一模型，系统提示、会话与采样温度相互隔离。</p>
      </div>
      <div class="preset-actions">
        <PopupSelect
          v-model="selectedModelId"
          :options="modelOptions"
          accessible-label="单模型团队使用的模型"
          placeholder="选择已配置模型"
          :disabled="saving || !runtimeAvailable"
          :menu-min-width="300"
          :menu-z-index="1200"
        />
        <button
          type="button"
          class="primary-button"
          :disabled="saving || !runtimeAvailable || !selectedModelId"
          @click="requestApply"
        >
          <AppIcon name="wand" :size="15" />应用五角色模板
        </button>
      </div>
    </header>

    <div class="role-strip">
      <div v-for="role in SINGLE_MODEL_LONG_ROLE_PRESETS" :key="role.id">
        <strong>{{ role.name }}</strong>
        <span
          >温度 {{ role.temperature }} · {{ role.contextRecommendation }}</span
        >
      </div>
    </div>
    <p class="workflow-note">
      默认串行：拆书按章节窗口、分卷和全书多级归并；交付前由审计终审执行反方复核。
    </p>
  </section>

  <Teleport to="body">
    <div
      v-if="confirmOpen"
      class="dialog-backdrop"
      @mousedown.self="confirmOpen = false"
      @keydown.esc.stop="confirmOpen = false"
    >
      <section class="preset-confirm" role="dialog" aria-modal="true">
        <header>
          <span>智能体团队</span>
          <h2>替换现有角色配置？</h2>
        </header>
        <p>
          当前团队已有
          {{ existingRoleCount }} 个角色。应用模板会替换为五个单模型角色。
        </p>
        <footer>
          <button type="button" @click="confirmOpen = false">取消</button>
          <button type="button" class="primary-button" @click="applyPreset">
            确认替换
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.single-model-preset {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.single-model-preset > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.single-model-preset header span,
.preset-confirm header span {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  font-weight: 650;
}

.single-model-preset h3,
.preset-confirm h2 {
  margin: 3px 0 4px;
  color: var(--text-primary);
  font-size: 1rem;
  letter-spacing: 0;
}

.single-model-preset p,
.preset-confirm p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.5;
}

.preset-actions {
  display: grid;
  grid-template-columns: minmax(180px, 260px) auto;
  gap: 8px;
  min-width: min(100%, 470px);
}

.role-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 7px;
}

.role-strip > div {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-muted);
}

.role-strip strong {
  color: var(--text-primary);
  font-size: 0.75rem;
}

.role-strip span {
  overflow-wrap: anywhere;
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.workflow-note {
  color: var(--text-tertiary) !important;
}

.preset-confirm {
  width: min(430px, calc(100vw - 32px));
  padding: 18px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: 0 18px 60px rgb(0 0 0 / 0.24);
}

.preset-confirm footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

@media (max-width: 900px) {
  .single-model-preset > header {
    display: grid;
  }

  .preset-actions {
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }

  .role-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
