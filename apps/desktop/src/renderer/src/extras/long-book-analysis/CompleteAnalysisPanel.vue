<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  LongBookAnalysisScopeMode,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import AnalysisProcessPanel from "./AnalysisProcessPanel.vue";
import { LONG_BOOK_ANALYSIS_SCOPE_LABELS } from "./analysis-scope";
import { analysisThinkingOptions } from "./task-options";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";

const props = defineProps<{
  controller: LongBookAnalysisController;
  models: readonly ModelConfig[];
}>();

const scopeMode = ref<LongBookAnalysisScopeMode>("full");
const styleFullText = ref(false);
const processOpen = ref(false);
const complete = props.controller.complete;
const task = computed(() => complete.task.value);
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
const canResume = computed(
  () =>
    task.value?.status === "stopped" &&
    task.value.items.some(
      ({ status }) => status === "pending" || status === "stopped"
    )
);
const taskStatusLabel = computed(
  () =>
    ({
      pending: "等待执行",
      running: "完整拆书进行中",
      stopping: "正在停止",
      stopped: "已中断，可续跑",
      completed: "五项均已完成",
      partial: "部分项目失败"
    })[task.value?.status ?? "pending"]
);

function itemProgress(completed: number, estimated: number): number {
  return Math.round(
    (Math.min(completed, Math.max(1, estimated)) / Math.max(1, estimated)) * 100
  );
}

function itemStatusLabel(status: string): string {
  return (
    {
      pending: "等待",
      running: "执行中",
      stopped: "已中断",
      completed: "已完成",
      error: "失败"
    }[status] ?? status
  );
}

function strategyLabel(presetId: string): string {
  if (scopeMode.value !== "full") {
    return LONG_BOOK_ANALYSIS_SCOPE_LABELS[scopeMode.value];
  }
  if (presetId === "method-distillation") return "全文分阶段";
  if (presetId === "style" && !styleFullText.value) return "前中后及分卷抽样";
  return "全文";
}

async function start(): Promise<void> {
  try {
    const started = await complete.start({
      scopeMode: scopeMode.value,
      styleFullText: styleFullText.value,
      modelId: props.controller.selectedModelId.value,
      thinkingLevel: props.controller.selectedThinkingLevel.value
    });
    if (started) processOpen.value = true;
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "无法开始完整拆书。"
    );
  }
}

async function resume(): Promise<void> {
  try {
    processOpen.value = true;
    await complete.resume();
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "续跑完整拆书失败。"
    );
  }
}

async function retryItem(presetId: string): Promise<void> {
  try {
    processOpen.value = true;
    await complete.retryItem(presetId);
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "重试拆书项目失败。"
    );
  }
}
</script>

<template>
  <section class="analysis-card complete-analysis-card">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">五管线编排</p>
        <h2>完整拆书</h2>
      </div>
      <span class="analysis-status" :class="`is-${task?.status ?? 'idle'}`">
        <i aria-hidden="true"></i>{{ taskStatusLabel }}
      </span>
    </header>

    <div class="complete-scope-control" role="group" aria-label="完整拆书范围">
      <button
        v-for="mode in ['opening', 'sampled', 'full'] as const"
        :key="mode"
        type="button"
        :class="{ 'is-active': scopeMode === mode }"
        :disabled="controller.isBusy.value"
        @click="scopeMode = mode"
      >
        {{ LONG_BOOK_ANALYSIS_SCOPE_LABELS[mode] }}
      </button>
    </div>

    <div class="complete-config-grid">
      <label class="setup-field"
        ><span class="setup-field-label">分析模型</span>
        <PopupSelect
          v-model="controller.selectedModelId.value"
          :options="modelOptions"
          accessible-label="完整拆书分析模型"
          :disabled="controller.isBusy.value"
          :menu-min-width="280"
        />
      </label>
      <label class="setup-field"
        ><span class="setup-field-label">思考等级</span>
        <PopupSelect
          v-model="controller.selectedThinkingLevel.value"
          :options="thinkingOptions"
          accessible-label="完整拆书思考等级"
          :disabled="controller.isBusy.value || !selectedModel"
          :menu-min-width="180"
        />
      </label>
      <label v-if="scopeMode === 'full'" class="complete-style-toggle">
        <input
          v-model="styleFullText"
          type="checkbox"
          :disabled="controller.isBusy.value"
        />
        <span>文风也分析全文</span>
        <small>默认按前中后及分卷抽样</small>
      </label>
    </div>

    <div class="complete-strategy-line">
      <span>剧情结构 · {{ strategyLabel("plot-structure") }}</span
      ><span>人物 · {{ strategyLabel("character") }}</span
      ><span>作品设定集 · {{ strategyLabel("story-bible") }}</span>
      <span>方法蒸馏 · {{ strategyLabel("method-distillation") }}</span
      ><span>文风 · {{ strategyLabel("style") }}</span>
    </div>

    <div v-if="task" class="complete-progress-list">
      <div
        v-for="item in task.items"
        :key="item.presetId"
        class="complete-progress-item"
      >
        <div class="complete-progress-copy">
          <strong>{{ item.presetName }}</strong>
          <span
            >{{ LONG_BOOK_ANALYSIS_SCOPE_LABELS[item.scopeMode] }} ·
            {{ item.chapterOrders.length }} 章</span
          >
        </div>
        <div class="complete-progress-track" aria-hidden="true">
          <i
            :style="{
              width: `${itemProgress(item.completedUnits, item.estimatedUnits)}%`
            }"
          ></i>
        </div>
        <span class="complete-item-status">{{
          itemStatusLabel(item.status)
        }}</span>
        <button
          v-if="item.status === 'error'"
          type="button"
          :disabled="controller.isBusy.value"
          @click="retryItem(item.presetId)"
        >
          重试
        </button>
      </div>
      <div class="complete-overall-progress">
        {{ complete.overallProgressText.value }}
      </div>
    </div>

    <div class="analysis-run-bar">
      <div class="analysis-run-progress">
        <strong>独立执行五条专业管线</strong
        ><span>单个窗口最多 50 章，自动多级归并</span>
      </div>
      <div class="analysis-run-actions">
        <button
          v-if="task"
          type="button"
          :aria-expanded="processOpen"
          @click="processOpen = !processOpen"
        >
          {{ processOpen ? "收起执行过程" : "查看当前过程" }}
        </button>
        <button
          v-if="canResume && !controller.isBusy.value"
          type="button"
          @click="resume"
        >
          从中断处继续
        </button>
        <button
          v-if="controller.isBusy.value"
          class="analysis-danger-button"
          type="button"
          @click="complete.stop"
        >
          停止
        </button>
        <button
          v-else
          class="analysis-primary-button"
          type="button"
          :disabled="
            !controller.source.value || !controller.selectedModelId.value
          "
          @click="start"
        >
          一键执行完整拆书
        </button>
      </div>
    </div>
    <AnalysisProcessPanel
      v-if="processOpen"
      :entries="complete.processEntries.value"
      :current-activity="complete.currentActivity.value"
      :live-output="complete.liveOutput.value"
      :error="complete.pipelineError.value"
    />
  </section>
</template>
