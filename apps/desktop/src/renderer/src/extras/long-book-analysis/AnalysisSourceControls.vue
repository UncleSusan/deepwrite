<script setup lang="ts">
import { computed, onMounted } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";

const props = defineProps<{
  controller: LongBookAnalysisController;
}>();
const emit = defineEmits<{
  managePresets: [];
}>();

const importedAtFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short"
});
const sourceId = computed(() => props.controller.source.value?.id ?? "");
const savedSourceOptions = computed<PopupSelectOption[]>(() =>
  props.controller.savedSources.value.map((savedSource) => ({
    value: savedSource.id,
    label: savedSource.name,
    description: `${savedSource.kind === "txt" ? "TXT" : "章节文件夹"} · ${savedSource.chapterCount.toLocaleString("zh-CN")} 章 · ${savedSource.characterCount.toLocaleString("zh-CN")} 字 · ${importedAtFormatter.format(new Date(savedSource.importedAt))}`
  }))
);
const savedSourcePlaceholder = computed(() => {
  if (props.controller.sourcesLoading.value) return "正在加载已导入长篇…";
  return savedSourceOptions.value.length > 0
    ? "选择已导入长篇"
    : "暂无已导入长篇";
});

async function importSource(kind: "txt" | "directory"): Promise<void> {
  try {
    if (await props.controller.chooseSource(kind)) {
      uiMessage.success(
        kind === "txt"
          ? "TXT 已解析并备份到工作目录。"
          : "章节文件夹已导入并备份到工作目录。"
      );
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "导入来源失败。");
  }
}

async function loadSavedSource(value: string | number): Promise<void> {
  try {
    if (await props.controller.loadSavedSource(String(value))) {
      uiMessage.success("已加载工作目录中的长篇。");
    }
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "加载已导入长篇失败。"
    );
  }
}

onMounted(() => {
  void props.controller.loadSavedSources().catch((error: unknown) => {
    uiMessage.error(
      error instanceof Error ? error.message : "加载已导入长篇失败。"
    );
  });
});
</script>

<template>
  <div class="analysis-page-controls">
    <div class="analysis-source-picker">
      <PopupSelect
        :model-value="sourceId"
        :options="savedSourceOptions"
        accessible-label="选择已导入长篇"
        :placeholder="savedSourcePlaceholder"
        :disabled="
          controller.isBusy.value ||
          controller.sourcesLoading.value ||
          savedSourceOptions.length === 0
        "
        :menu-min-width="320"
        @change="loadSavedSource"
      >
        <template #prefix>
          <AppIcon name="book" :size="15" />
        </template>
      </PopupSelect>
    </div>
    <div class="analysis-page-actions">
      <button
        type="button"
        :disabled="controller.isBusy.value"
        @click="importSource('txt')"
      >
        <AppIcon name="file" :size="16" />
        导入 TXT
      </button>
      <button
        type="button"
        :disabled="controller.isBusy.value"
        @click="importSource('directory')"
      >
        <AppIcon name="folder" :size="16" />
        章节文件夹
      </button>
      <button
        class="analysis-icon-button"
        type="button"
        title="管理拆书预设"
        aria-label="管理拆书预设"
        :disabled="controller.isBusy.value"
        @click="emit('managePresets')"
      >
        <AppIcon name="settings" :size="17" />
      </button>
    </div>
  </div>
</template>
