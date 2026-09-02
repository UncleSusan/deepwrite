<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import { uiMessage } from "../../ui-feedback";
import AnalysisResultPanel from "./AnalysisResultPanel.vue";
import AnalysisSourceControls from "./AnalysisSourceControls.vue";
import ChapterEditor from "./ChapterEditor.vue";
import CompleteAnalysisPanel from "./CompleteAnalysisPanel.vue";
import CompleteAnalysisResults from "./CompleteAnalysisResults.vue";
import PresetManager from "./PresetManager.vue";
import SingleAnalysisTaskPanel from "./SingleAnalysisTaskPanel.vue";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";
import "./long-book-analysis.css";

const props = defineProps<{
  controller: LongBookAnalysisController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{ refreshCatalog: [] }>();

const taskMode = ref<"single" | "complete">("single");
const presetManagerOpen = ref(false);
const presetSaving = ref(false);
const resultSaving = ref(false);
const resultAnchor = ref<HTMLElement | null>(null);
const source = computed(() => props.controller.source.value);
const presets = computed(() => props.controller.presets.value);
const resultPreset = computed(
  () =>
    presets.value.find(
      ({ id }) => id === props.controller.activePresetId.value
    ) ?? null
);

async function showResult(): Promise<void> {
  await nextTick();
  resultAnchor.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

watch(
  () => props.controller.status.value,
  (status) => {
    if (
      taskMode.value === "single" &&
      status === "completed" &&
      props.controller.result.value
    ) {
      void showResult();
    }
  }
);

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
  libraryId: string;
  baseProjectRevision?: number;
}): Promise<void> {
  resultSaving.value = true;
  try {
    await props.controller.persistResult(input);
    emit("refreshCatalog");
    uiMessage.success("拆书结果已作为新条目写入目标资料库。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "创建资料条目失败。"
    );
  } finally {
    resultSaving.value = false;
  }
}

onMounted(async () => {
  try {
    await props.controller.loadPresets();
    await props.controller.complete.loadLatest();
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "加载拆书配置失败。"
    );
  }
});
</script>

<template>
  <div class="long-book-analysis-page">
    <header class="analysis-page-header">
      <div class="analysis-page-intro">
        <p class="analysis-eyebrow">更多功能</p>
        <h1>长篇拆书分析</h1>
        <p>
          导入章节，独立提炼剧情、人物、设定、方法与文风，生成可编辑的素材或技能。
        </p>
      </div>
      <AnalysisSourceControls
        :controller="controller"
        @manage-presets="presetManagerOpen = true"
      />
    </header>

    <div class="analysis-content">
      <ChapterEditor
        v-if="source"
        :source="source"
        :disabled="controller.isBusy.value"
        @update="controller.replaceChapters($event)"
      />
      <section v-else class="analysis-card analysis-empty-source">
        <div class="analysis-empty-icon">
          <AppIcon name="book" :size="26" />
        </div>
        <div class="analysis-empty-copy">
          <strong>先导入一本长篇</strong>
          <p>
            支持单个 TXT，或递归读取按章节保存的 TXT / Markdown
            文件夹；导入后会备份到工作目录。
          </p>
        </div>
        <div class="analysis-empty-meta" aria-label="支持的导入格式">
          <span>TXT</span><span>Markdown</span><span>单窗口最多 50 章</span>
        </div>
      </section>

      <div
        class="analysis-mode-switch"
        role="tablist"
        aria-label="拆书任务模式"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="taskMode === 'single'"
          :class="{ 'is-active': taskMode === 'single' }"
          :disabled="controller.isBusy.value"
          @click="taskMode = 'single'"
        >
          单项拆书
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="taskMode === 'complete'"
          :class="{ 'is-active': taskMode === 'complete' }"
          :disabled="controller.isBusy.value"
          @click="taskMode = 'complete'"
        >
          完整拆书
        </button>
      </div>

      <SingleAnalysisTaskPanel
        v-if="taskMode === 'single'"
        :controller="controller"
        :models="models"
        :catalog-snapshot="catalogSnapshot"
        @show-result="showResult"
      />
      <CompleteAnalysisPanel v-else :controller="controller" :models="models" />

      <div
        v-if="taskMode === 'single' && controller.result.value && resultPreset"
        ref="resultAnchor"
        class="analysis-result-anchor"
      >
        <AnalysisResultPanel
          :result="controller.result.value"
          :preset="resultPreset"
          :catalog-snapshot="catalogSnapshot"
          :target-library-id="controller.targetLibraryId.value"
          :saving="resultSaving"
          @update="controller.result.value = $event"
          @save="persistResult"
        />
      </div>
      <CompleteAnalysisResults
        v-if="taskMode === 'complete' && controller.complete.task.value"
        :controller="controller"
        :catalog-snapshot="catalogSnapshot"
        @refresh-catalog="emit('refreshCatalog')"
      />
    </div>

    <PresetManager
      :open="presetManagerOpen"
      :presets="presets"
      :saving="presetSaving"
      :catalog-snapshot="catalogSnapshot"
      @close="presetManagerOpen = false"
      @save="savePresets"
      @reset="resetPresets"
    />
  </div>
</template>
