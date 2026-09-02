<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisResult
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../../ui-feedback";
import { analysisOutputTypeLabel } from "./task-options";
import { completeAnalysisGroupTitle } from "./complete-analysis-catalog";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";

const props = defineProps<{
  controller: LongBookAnalysisController;
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{ refreshCatalog: [] }>();

const activePresetId = ref("");
const saving = ref(false);
const drafts = reactive<Record<string, LongBookAnalysisResult>>({});
const dirty = new Set<string>();
const task = computed(() => props.controller.complete.task.value);
const presets = computed(() => props.controller.presets.value);
const activeItem = computed(() =>
  task.value?.items.find(({ presetId }) => presetId === activePresetId.value)
);
const activePreset = computed(() =>
  presets.value.find(({ id }) => id === activePresetId.value)
);
const activeResult = computed(() => drafts[activePresetId.value]);
const targetGroupTitle = computed(() =>
  task.value ? completeAnalysisGroupTitle(task.value.sourceTitle) : ""
);

watch(
  [task, presets],
  ([nextTask]) => {
    if (!nextTask) return;
    if (
      !nextTask.items.some(({ presetId }) => presetId === activePresetId.value)
    ) {
      activePresetId.value = nextTask.items[0]?.presetId ?? "";
    }
    for (const item of nextTask.items) {
      if (item.result && !dirty.has(item.presetId)) {
        drafts[item.presetId] = structuredClone(item.result);
      }
    }
  },
  { immediate: true }
);

function updateDraft(field: "title" | "body", event: Event): void {
  const element = event.target;
  if (!(
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ))
    return;
  const current = drafts[activePresetId.value];
  if (!current) return;
  drafts[activePresetId.value] = { ...current, [field]: element.value };
  dirty.add(activePresetId.value);
}

async function saveDraft(presetId = activePresetId.value): Promise<void> {
  const draft = drafts[presetId];
  if (!draft || !dirty.has(presetId)) return;
  await props.controller.complete.updateResult(presetId, draft);
  dirty.delete(presetId);
}

async function persistAll(): Promise<void> {
  const current = task.value;
  if (!current) return;
  saving.value = true;
  try {
    for (const item of current.items) await saveDraft(item.presetId);
    const result = await props.controller.complete.persistAll();
    emit("refreshCatalog");
    uiMessage.success(
      `已将 ${result.written} 条拆书结果归档到“${result.groupTitle}”。`
    );
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "批量写入拆书结果失败。"
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section v-if="task" class="analysis-card complete-results-card">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">五类独立产物</p>
        <h2>完整拆书结果</h2>
      </div>
      <button
        class="analysis-primary-button"
        type="button"
        :disabled="saving || task.items.some(({ result }) => !result)"
        @click="persistAll"
      >
        {{ saving ? "归档中…" : "一键归档到资料组" }}
      </button>
    </header>
    <div
      class="complete-result-tabs"
      role="tablist"
      aria-label="完整拆书结果类型"
    >
      <button
        v-for="item in task.items"
        :key="item.presetId"
        type="button"
        role="tab"
        :aria-selected="activePresetId === item.presetId"
        :class="{ 'is-active': activePresetId === item.presetId }"
        @click="activePresetId = item.presetId"
      >
        {{ item.presetName }}<span :class="`is-${item.status}`"></span>
      </button>
    </div>
    <template v-if="activeItem && activePreset && activeResult">
      <div class="complete-result-meta">
        <span
          >{{ activePreset.output.domain === "material" ? "素材" : "技能" }} ·
          {{ analysisOutputTypeLabel(activePreset) }}</span
        >
        <span>归档到：{{ targetGroupTitle }}</span>
      </div>
      <input
        class="result-title"
        :value="activeResult.title"
        maxlength="256"
        aria-label="完整拆书结果标题"
        @input="updateDraft('title', $event)"
        @blur="saveDraft()"
      />
      <textarea
        class="result-body"
        :value="activeResult.body"
        maxlength="200000"
        aria-label="完整拆书 Markdown 结果正文"
        @input="updateDraft('body', $event)"
        @blur="saveDraft()"
      />
    </template>
    <div v-else class="complete-result-empty">
      <strong>{{ activeItem?.presetName ?? "当前项目" }}尚无结果</strong>
      <span>{{
        activeItem?.error ?? "执行完成后可在这里独立预览和编辑。"
      }}</span>
    </div>
  </section>
</template>
