<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  LongBookAnalysisResult
} from "@deepwrite/contracts/renderer";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import {
  analysisLibraryOption,
  analysisOutputTypeLabel,
  compatibleAnalysisLibraries
} from "./task-options";

const props = defineProps<{
  result: LongBookAnalysisResult;
  preset: LongBookAnalysisPreset;
  catalogSnapshot: CatalogSnapshot | null;
  targetLibraryId: string;
  saving: boolean;
}>();
const emit = defineEmits<{
  update: [result: LongBookAnalysisResult];
  save: [
    input: {
      libraryId: string;
      baseProjectRevision?: number;
    }
  ];
}>();

const targetId = ref("");
const compatibleLibraries = computed(() =>
  compatibleAnalysisLibraries(props.preset, props.catalogSnapshot)
);
const targetOptions = computed<PopupSelectOption[]>(() =>
  compatibleLibraries.value.map(analysisLibraryOption)
);
const targetLibrary = computed(() => {
  return compatibleLibraries.value.find(
    (library) => library.id === targetId.value
  );
});
const outputTypeLabel = computed(() => analysisOutputTypeLabel(props.preset));

watch(
  [() => props.targetLibraryId, compatibleLibraries],
  ([preferredId, libraries]) => {
    if (libraries.some((library) => library.id === targetId.value)) return;
    const presetDefaultId = props.preset.output.libraryId ?? "";
    targetId.value =
      [preferredId, presetDefaultId].find((id) =>
        libraries.some((library) => library.id === id)
      ) ??
      libraries[0]?.id ??
      "";
  },
  { immediate: true }
);

function updateTitle(event: Event): void {
  const element = event.target;
  if (element instanceof HTMLInputElement)
    emit("update", { ...props.result, title: element.value });
}

function updateBody(event: Event): void {
  const element = event.target;
  if (element instanceof HTMLTextAreaElement)
    emit("update", { ...props.result, body: element.value });
}

function save(): void {
  if (!targetLibrary.value) return;
  emit("save", {
    libraryId: targetLibrary.value.id,
    ...(targetLibrary.value.projectRevision === undefined
      ? {}
      : { baseProjectRevision: targetLibrary.value.projectRevision })
  });
}
</script>

<template>
  <section class="analysis-card result-card">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">分析与结果</p>
        <h2>“{{ preset.name }}”生成结果</h2>
      </div>
      <span
        >{{ preset.output.domain === "material" ? "素材" : "技能" }} ·
        {{ outputTypeLabel }}</span
      >
    </header>
    <input
      class="result-title"
      :value="result.title"
      maxlength="256"
      aria-label="结果标题"
      @input="updateTitle"
    />
    <textarea
      class="result-body"
      :value="result.body"
      maxlength="200000"
      aria-label="Markdown 结果正文"
      @input="updateBody"
    />
    <div class="result-save-row">
      <div class="result-target-library">
        <label>
          <span
            >写入到{{
              preset.output.domain === "material" ? "素材库" : "技能库"
            }}</span
          >
          <PopupSelect
            v-model="targetId"
            :options="targetOptions"
            accessible-label="结果写入目标资料库"
            :placeholder="
              targetOptions.length ? '选择具体资料库' : '没有兼容的资料库'
            "
            :disabled="saving || targetOptions.length === 0"
            :menu-min-width="280"
          />
        </label>
        <small>{{ outputTypeLabel }} · 生成后可随时更换目标库</small>
      </div>
      <button
        class="analysis-primary-button"
        type="button"
        :disabled="saving || !targetLibrary"
        @click="save"
      >
        {{
          saving
            ? "写入中…"
            : `写入${preset.output.domain === "material" ? "素材库" : "技能库"}`
        }}
      </button>
    </div>
    <p class="analysis-help">
      结果会一直保留在当前预览中；每次写入只创建新条目，不会覆盖已有内容。
    </p>
  </section>
</template>

<style scoped>
.result-card {
  display: grid;
  gap: 12px;
}
.result-title,
.result-body,
.result-target-library {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
}
.result-title {
  font-size: 16px;
  font-weight: 650;
}
.result-body {
  min-height: 420px;
  resize: vertical;
  line-height: 1.7;
}
.result-save-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}
.result-save-row > .analysis-primary-button {
  flex: 0 0 auto;
  min-width: 110px;
  white-space: nowrap;
}
.result-target-library {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.result-target-library label {
  display: grid;
  grid-template-columns: auto minmax(220px, 1fr);
  align-items: center;
  gap: 8px;
}
.result-target-library label > span,
.result-target-library small {
  color: var(--text-tertiary);
  font-size: 12px;
}
.analysis-help {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
}
@media (max-width: 800px) {
  .result-save-row {
    align-items: stretch;
    flex-direction: column;
  }
  .result-target-library label {
    grid-template-columns: 1fr;
  }
}
</style>
