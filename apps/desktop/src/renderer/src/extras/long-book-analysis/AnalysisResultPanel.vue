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

const NEW_LIBRARY = "__new_library__";
const props = defineProps<{
  result: LongBookAnalysisResult;
  preset: LongBookAnalysisPreset;
  catalogSnapshot: CatalogSnapshot | null;
  saving: boolean;
}>();
const emit = defineEmits<{
  update: [result: LongBookAnalysisResult];
  save: [
    input: {
      libraryId?: string;
      newLibraryName?: string;
      baseProjectRevision?: number;
    }
  ];
}>();

const targetId = ref("");
const newLibraryName = ref("");
const compatibleLibraries = computed(() => {
  const output = props.preset.output;
  if (output.domain === "material") {
    return (props.catalogSnapshot?.materials ?? []).filter(
      (library) =>
        library.materialKind === output.kind || library.materialKind === "mixed"
    );
  }
  return (props.catalogSnapshot?.skills ?? []).filter(
    (library) => library.skillKind === output.kind && !library.isBuiltin
  );
});
const targetOptions = computed<PopupSelectOption[]>(() => [
  ...compatibleLibraries.value.map((library) => ({
    value: library.id,
    label: library.title
  })),
  { value: NEW_LIBRARY, label: "新建兼容资料库" }
]);

watch(
  compatibleLibraries,
  (libraries) => {
    if (
      targetId.value &&
      (targetId.value === NEW_LIBRARY ||
        libraries.some((library) => library.id === targetId.value))
    )
      return;
    targetId.value = libraries[0]?.id ?? NEW_LIBRARY;
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
  const selected = compatibleLibraries.value.find(
    (library) => library.id === targetId.value
  );
  emit(
    "save",
    targetId.value === NEW_LIBRARY
      ? { newLibraryName: newLibraryName.value }
      : {
          libraryId: targetId.value,
          ...(selected?.projectRevision === undefined
            ? {}
            : { baseProjectRevision: selected.projectRevision })
        }
  );
}
</script>

<template>
  <section class="analysis-card result-card">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">分析与结果</p>
        <h2>可编辑 Markdown 预览</h2>
      </div>
      <span
        >{{ preset.output.domain === "material" ? "素材" : "技能" }} ·
        {{ preset.output.kind }} / {{ preset.output.stageId }}</span
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
      <PopupSelect
        v-model="targetId"
        :options="targetOptions"
        accessible-label="目标资料库"
        :menu-min-width="260"
      />
      <input
        v-if="targetId === NEW_LIBRARY"
        v-model="newLibraryName"
        maxlength="120"
        placeholder="新资料库名称"
        aria-label="新资料库名称"
      />
      <button
        class="analysis-primary-button"
        type="button"
        :disabled="
          saving ||
          !targetId ||
          (targetId === NEW_LIBRARY && !newLibraryName.trim())
        "
        @click="save"
      >
        {{ saving ? "创建中…" : "确认创建新条目" }}
      </button>
    </div>
    <p class="analysis-help">
      只会创建新条目，不会覆盖已有内容。结果在确认前不会落盘。
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
.result-save-row > input {
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
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(200px, 1fr) auto;
  gap: 10px;
  align-items: center;
}
.analysis-help {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
}
@media (max-width: 800px) {
  .result-save-row {
    grid-template-columns: 1fr;
  }
}
</style>
