<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import AnalysisResultPanel from "./AnalysisResultPanel.vue";
import ChapterEditor from "./ChapterEditor.vue";
import PresetManager from "./PresetManager.vue";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";
import "./long-book-analysis.css";

const props = defineProps<{
  controller: LongBookAnalysisController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
}>();

const selectedPresetId = ref("");
const resultPresetId = ref("");
const startOrder = ref(1);
const endOrder = ref(1);
const presetManagerOpen = ref(false);
const presetSaving = ref(false);
const resultSaving = ref(false);

const source = computed(() => props.controller.source.value);
const presets = computed(() => props.controller.presets.value);
const selectedPreset = computed(
  () =>
    presets.value.find((preset) => preset.id === selectedPresetId.value) ?? null
);
const resultPreset = computed(
  () =>
    presets.value.find((preset) => preset.id === resultPresetId.value) ?? null
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
const selectionCount = computed(() =>
  Math.max(0, endOrder.value - startOrder.value + 1)
);
const runStatusLabel = computed(() => {
  const labels = {
    idle: "等待开始",
    running: "后台分析中",
    stopping: "正在停止",
    stopped: "已停止，可继续",
    error: "阶段失败，可重试",
    completed: "分析完成"
  } as const;
  return labels[props.controller.status.value];
});

watch(
  presets,
  (next) => {
    if (!next.some((preset) => preset.id === selectedPresetId.value)) {
      selectedPresetId.value = next[0]?.id ?? "";
    }
  },
  { immediate: true }
);

watch(source, (next) => {
  if (!next) return;
  startOrder.value = 1;
  endOrder.value = Math.min(50, next.chapters.length);
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
  if (anchor === "start") {
    endOrder.value = Math.max(
      startOrder.value,
      Math.min(endOrder.value, startOrder.value + 49)
    );
  } else {
    startOrder.value = Math.min(
      endOrder.value,
      Math.max(startOrder.value, endOrder.value - 49)
    );
  }
}

async function importSource(kind: "txt" | "directory"): Promise<void> {
  try {
    if (await props.controller.chooseSource(kind)) {
      uiMessage.success(
        kind === "txt" ? "TXT 已解析为章节。" : "章节文件夹已导入。"
      );
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "导入来源失败。");
  }
}

async function start(): Promise<void> {
  try {
    const started = await props.controller.start({
      presetId: selectedPresetId.value,
      startOrder: startOrder.value,
      endOrder: endOrder.value,
      modelId: props.controller.selectedModelId.value
    });
    if (started) resultPresetId.value = selectedPresetId.value;
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法开始分析。"
    );
  }
}

async function savePresets(next: LongBookAnalysisPreset[]): Promise<void> {
  presetSaving.value = true;
  try {
    await props.controller.savePresets(next);
    presetManagerOpen.value = false;
    uiMessage.success("拆书预设已保存。");
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "保存预设失败。");
  } finally {
    presetSaving.value = false;
  }
}

async function resetPresets(presetId?: string): Promise<void> {
  try {
    await props.controller.resetPresets(presetId);
    uiMessage.success(presetId ? "该默认预设已恢复。" : "全部默认预设已恢复。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "恢复默认预设失败。"
    );
  }
}

async function persistResult(input: {
  libraryId?: string;
  newLibraryName?: string;
  baseProjectRevision?: number;
}): Promise<void> {
  resultSaving.value = true;
  try {
    const createdLibrary = await props.controller.persistResult(input);
    if (!input.libraryId && !createdLibrary) {
      uiMessage.info("已取消新建资料库，结果仍保留在预览中。");
      return;
    }
    emit("refreshCatalog");
    uiMessage.success("拆书结果已作为新条目写入资料库。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "创建资料条目失败。"
    );
  } finally {
    resultSaving.value = false;
  }
}

onMounted(() => {
  void props.controller.loadPresets().catch((error: unknown) => {
    uiMessage.error(
      error instanceof Error ? error.message : "加载拆书预设失败。"
    );
  });
});
</script>

<template>
  <div class="long-book-analysis-page">
    <header class="analysis-page-header">
      <div>
        <p class="analysis-eyebrow">更多功能</p>
        <h1>长篇拆书分析</h1>
        <p>
          导入章节，选择一个动态预设，让 Pi Agent
          分批提炼并生成可编辑素材或技能。
        </p>
      </div>
      <div class="analysis-page-actions">
        <button
          type="button"
          :disabled="controller.isBusy.value"
          @click="importSource('txt')"
        >
          导入 TXT
        </button>
        <button
          type="button"
          :disabled="controller.isBusy.value"
          @click="importSource('directory')"
        >
          导入章节文件夹
        </button>
        <button
          type="button"
          :disabled="controller.isBusy.value"
          @click="presetManagerOpen = true"
        >
          管理预设
        </button>
      </div>
    </header>

    <div class="analysis-content">
      <ChapterEditor
        v-if="source"
        :source="source"
        :disabled="controller.isBusy.value"
        @update="controller.replaceChapters($event)"
      />
      <section v-else class="analysis-card analysis-empty-source">
        <strong>先导入一本长篇</strong>
        <p>
          支持单个 TXT，或递归读取按章节保存的 TXT / Markdown
          文件夹。源文件不会被修改。
        </p>
      </section>

      <section class="analysis-card setup-card">
        <header class="analysis-card-heading">
          <div>
            <p class="analysis-eyebrow">选择范围与预设</p>
            <h2>配置本次拆书任务</h2>
          </div>
          <span>{{ runStatusLabel }}</span>
        </header>
        <div class="setup-grid">
          <label
            ><span>拆书预设</span
            ><PopupSelect
              v-model="selectedPresetId"
              :options="presetOptions"
              accessible-label="拆书预设"
              :disabled="controller.isBusy.value"
              :menu-min-width="280"
          /></label>
          <label
            ><span>分析模型</span
            ><PopupSelect
              v-model="controller.selectedModelId.value"
              :options="modelOptions"
              accessible-label="分析模型"
              :disabled="controller.isBusy.value"
              :menu-min-width="280"
          /></label>
          <label
            ><span>起始章节</span
            ><input
              v-model.number="startOrder"
              type="number"
              min="1"
              :max="source?.chapters.length ?? 1"
              :disabled="!source || controller.isBusy.value"
              @change="normalizeRange('start')"
          /></label>
          <label
            ><span>结束章节</span
            ><input
              v-model.number="endOrder"
              type="number"
              min="1"
              :max="source?.chapters.length ?? 1"
              :disabled="!source || controller.isBusy.value"
              @change="normalizeRange('end')"
          /></label>
        </div>
        <div v-if="selectedPreset" class="preset-summary">
          <strong>{{ selectedPreset.name }}</strong>
          <span>{{ selectedPreset.description }}</span>
          <small
            >输出到
            {{
              selectedPreset.output.domain === "material" ? "素材库" : "技能库"
            }}
            · {{ selectedPreset.output.kind }} /
            {{ selectedPreset.output.stageId }}</small
          >
        </div>
        <div class="analysis-run-bar">
          <div>
            <strong>{{ selectionCount }} 章</strong
            ><span>{{ controller.progressText.value }}</span>
          </div>
          <div class="analysis-run-actions">
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
                selectionCount < 1 ||
                selectionCount > 50
              "
              @click="start"
            >
              一键拆书
            </button>
          </div>
        </div>
      </section>

      <AnalysisResultPanel
        v-if="controller.result.value && resultPreset"
        :result="controller.result.value"
        :preset="resultPreset"
        :catalog-snapshot="catalogSnapshot"
        :saving="resultSaving"
        @update="controller.result.value = $event"
        @save="persistResult"
      />
    </div>

    <PresetManager
      :open="presetManagerOpen"
      :presets="presets"
      :saving="presetSaving"
      @close="presetManagerOpen = false"
      @save="savePresets"
      @reset="resetPresets"
    />
  </div>
</template>

<style scoped>
.analysis-page-header h1 {
  margin: 3px 0 6px;
  font-size: clamp(24px, 3vw, 34px);
}
.analysis-page-header p {
  max-width: 720px;
  margin: 0;
  line-height: 1.55;
}
.analysis-empty-source {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-secondary);
}
.analysis-empty-source strong {
  color: var(--text-primary);
  font-size: 18px;
}
.setup-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.2fr 0.6fr 0.6fr;
  gap: 10px;
}
.setup-grid label {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}
.setup-grid input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  padding: 9px 10px;
  background: var(--surface-main);
  color: var(--text-primary);
}
.preset-summary {
  display: grid;
  grid-template-columns: auto minmax(180px, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-muted);
}
.preset-summary span,
.preset-summary small {
  color: var(--text-secondary);
}
.analysis-run-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--theme-line-soft);
}
.analysis-run-bar > div:first-child {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.analysis-run-bar span {
  color: var(--text-secondary);
}
@media (max-width: 900px) {
  .setup-grid {
    grid-template-columns: 1fr 1fr;
  }
  .preset-summary {
    grid-template-columns: 1fr;
  }
}
</style>
