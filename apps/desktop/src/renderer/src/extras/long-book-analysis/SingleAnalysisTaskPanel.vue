<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import AnalysisProcessPanel from "./AnalysisProcessPanel.vue";
import {
  analysisLibraryOption,
  analysisOutputTypeLabel,
  analysisThinkingOptions,
  compatibleAnalysisLibraries
} from "./task-options";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";

const props = defineProps<{
  controller: LongBookAnalysisController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{ showResult: [] }>();

const selectedPresetId = ref("");
const selectedTargetLibraryId = ref("");
const startOrder = ref(1);
const endOrder = ref(1);
const processOpen = ref(false);
const source = computed(() => props.controller.source.value);
const presets = computed(() => props.controller.presets.value);
const selectedPreset = computed(
  () => presets.value.find(({ id }) => id === selectedPresetId.value) ?? null
);
const presetOptions = computed<PopupSelectOption[]>(() =>
  presets.value.map((preset) => ({
    value: preset.id,
    label: preset.name,
    description: preset.description
  }))
);
const modelOptions = computed<PopupSelectOption[]>(() =>
  props.models.map((model) => ({
    value: model.id,
    label: model.label,
    description: model.contextWindow
      ? `${model.provider} · ${model.contextWindow.toLocaleString()} tokens`
      : `${model.provider} · 默认按 272,000 tokens 计算`
  }))
);
const selectedModel = computed(
  () =>
    props.models.find(
      ({ id }) => id === props.controller.selectedModelId.value
    ) ?? null
);
const thinkingOptions = computed<PopupSelectOption[]>(() =>
  analysisThinkingOptions(selectedModel.value)
);
const compatibleLibraries = computed(() =>
  compatibleAnalysisLibraries(selectedPreset.value, props.catalogSnapshot)
);
const targetLibraryOptions = computed<PopupSelectOption[]>(() =>
  compatibleLibraries.value.map(analysisLibraryOption)
);
const outputTypeLabel = computed(() =>
  analysisOutputTypeLabel(selectedPreset.value)
);
const selectionCount = computed(() =>
  Math.max(0, endOrder.value - startOrder.value + 1)
);
const runStatusLabel = computed(
  () =>
    ({
      idle: "等待开始",
      running: "后台分析中",
      stopping: "正在停止",
      stopped: "已停止，可继续",
      error: "阶段失败，可重试",
      completed: "当前预设已完成"
    })[props.controller.status.value]
);

watch(
  presets,
  (next) => {
    if (!next.some(({ id }) => id === selectedPresetId.value)) {
      selectedPresetId.value = next[0]?.id ?? "";
    }
  },
  { immediate: true }
);
watch(source, (next) => {
  if (!next) return;
  startOrder.value = 1;
  endOrder.value = next.chapters.length;
});
watch(
  selectedPresetId,
  () => {
    const defaultId = selectedPreset.value?.output.libraryId ?? "";
    selectedTargetLibraryId.value = compatibleLibraries.value.some(
      ({ id }) => id === defaultId
    )
      ? defaultId
      : "";
  },
  { immediate: true }
);
watch(compatibleLibraries, (libraries) => {
  if (libraries.some(({ id }) => id === selectedTargetLibraryId.value)) return;
  const defaultId = selectedPreset.value?.output.libraryId ?? "";
  selectedTargetLibraryId.value = libraries.some(({ id }) => id === defaultId)
    ? defaultId
    : "";
});

function normalizeRange(anchor: "start" | "end"): void {
  const maximum = source.value?.chapters.length ?? 1;
  startOrder.value = Math.max(
    1,
    Math.min(maximum, Math.round(startOrder.value || 1))
  );
  endOrder.value = Math.max(
    1,
    Math.min(maximum, Math.round(endOrder.value || 1))
  );
  if (anchor === "start")
    endOrder.value = Math.max(startOrder.value, endOrder.value);
  else startOrder.value = Math.min(startOrder.value, endOrder.value);
}

async function start(): Promise<void> {
  try {
    const started = await props.controller.start({
      presetId: selectedPresetId.value,
      startOrder: startOrder.value,
      endOrder: endOrder.value,
      modelId: props.controller.selectedModelId.value,
      thinkingLevel: props.controller.selectedThinkingLevel.value,
      libraryId: selectedTargetLibraryId.value
    });
    if (started) processOpen.value = true;
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法开始分析。"
    );
  }
}
</script>

<template>
  <section class="analysis-card setup-card">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">单项分析</p>
        <h2>配置本次拆书任务</h2>
      </div>
      <span class="analysis-status" :class="`is-${controller.status.value}`">
        <i aria-hidden="true"></i>{{ runStatusLabel }}
      </span>
    </header>
    <div class="setup-grid">
      <label class="setup-field"
        ><span class="setup-field-label">拆书预设</span>
        <PopupSelect
          v-model="selectedPresetId"
          :options="presetOptions"
          accessible-label="拆书预设"
          :disabled="controller.isBusy.value"
          :menu-min-width="280"
        />
      </label>
      <label class="setup-field"
        ><span class="setup-field-label">分析模型</span>
        <PopupSelect
          v-model="controller.selectedModelId.value"
          :options="modelOptions"
          accessible-label="分析模型"
          :disabled="controller.isBusy.value"
          :menu-min-width="280"
        />
      </label>
      <label class="setup-field setup-thinking-field"
        ><span class="setup-field-label">思考等级</span>
        <PopupSelect
          v-model="controller.selectedThinkingLevel.value"
          :options="thinkingOptions"
          accessible-label="思考等级"
          :disabled="controller.isBusy.value || !selectedModel"
          :menu-min-width="180"
        />
      </label>
      <div class="setup-field setup-range-field">
        <span class="setup-field-label"
          >章节范围 <small>自动拆成最多 50 章的窗口</small></span
        >
        <div class="chapter-range-inputs">
          <input
            v-model.number="startOrder"
            type="number"
            aria-label="起始章节"
            min="1"
            :max="source?.chapters.length ?? 1"
            :disabled="!source || controller.isBusy.value"
            @change="normalizeRange('start')"
          />
          <span>至</span>
          <input
            v-model.number="endOrder"
            type="number"
            aria-label="结束章节"
            min="1"
            :max="source?.chapters.length ?? 1"
            :disabled="!source || controller.isBusy.value"
            @change="normalizeRange('end')"
          />
        </div>
      </div>
    </div>
    <div v-if="selectedPreset" class="preset-summary">
      <div class="preset-summary-main">
        <div class="preset-summary-copy">
          <strong>{{ selectedPreset.name }}</strong
          ><span>{{ selectedPreset.description }}</span>
        </div>
        <small
          >{{
            selectedPreset.output.domain === "material"
              ? "素材条目"
              : "技能条目"
          }}
          · {{ outputTypeLabel }}</small
        >
      </div>
      <label class="preset-target-field"
        ><span
          >预选{{
            selectedPreset.output.domain === "material" ? "素材库" : "技能库"
          }}
          <small>生成后可修改</small></span
        >
        <PopupSelect
          v-model="selectedTargetLibraryId"
          :options="targetLibraryOptions"
          accessible-label="目标资料库"
          :placeholder="
            targetLibraryOptions.length
              ? '请选择具体资料库'
              : '没有兼容的资料库'
          "
          :disabled="
            controller.isBusy.value || targetLibraryOptions.length === 0
          "
          :menu-min-width="260"
        />
      </label>
    </div>
    <div class="analysis-run-bar">
      <div class="analysis-run-progress">
        <strong>已选 {{ selectionCount }} 章</strong
        ><span>{{ controller.progressText.value }}</span>
      </div>
      <div class="analysis-run-actions">
        <button
          v-if="controller.status.value !== 'idle'"
          type="button"
          :aria-expanded="processOpen"
          @click="processOpen = !processOpen"
        >
          {{ processOpen ? "收起执行过程" : "查看执行过程" }}
        </button>
        <button
          v-if="controller.result.value"
          type="button"
          @click="emit('showResult')"
        >
          查看生成结果
        </button>
        <button
          v-if="controller.canRetry.value"
          type="button"
          @click="controller.retry"
        >
          从失败阶段继续
        </button>
        <button
          v-if="controller.isBusy.value"
          class="analysis-danger-button"
          type="button"
          @click="controller.stop"
        >
          停止
        </button>
        <button
          v-else
          class="analysis-primary-button"
          type="button"
          :disabled="
            !source ||
            !selectedPreset ||
            !controller.selectedModelId.value ||
            selectionCount < 1
          "
          @click="start"
        >
          执行“{{ selectedPreset?.name ?? "当前" }}”预设
        </button>
      </div>
    </div>
    <AnalysisProcessPanel
      v-if="processOpen"
      :entries="controller.processEntries.value"
      :current-activity="controller.currentActivity.value"
      :live-output="controller.liveOutput.value"
      :error="controller.error.value"
    />
  </section>
</template>
