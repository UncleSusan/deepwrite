<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  LongBookAnalysisPreset,
  MaterialKind,
  MaterialStageId,
  SkillKind,
  SkillStageId
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";

const props = defineProps<{
  open: boolean;
  presets: readonly LongBookAnalysisPreset[];
  saving: boolean;
}>();
const emit = defineEmits<{
  close: [];
  save: [presets: LongBookAnalysisPreset[]];
  reset: [presetId?: string];
}>();

const materialKinds: PopupSelectOption[] = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
].map((value) => ({ value, label: value }));
const skillKinds: PopupSelectOption[] = [
  "general",
  "plot",
  "style",
  "other"
].map((value) => ({ value, label: value }));
const materialStages: PopupSelectOption[] = [
  "gimmick",
  "character",
  "pacing",
  "intro",
  "plot_refine",
  "draft_excerpt",
  "other"
].map((value) => ({ value, label: value }));
const skillStages: PopupSelectOption[] = [
  "character_design",
  "plot_design",
  "outline",
  "draft",
  "expert_section_writer"
].map((value) => ({ value, label: value }));
const domainOptions: PopupSelectOption[] = [
  { value: "material", label: "素材库" },
  { value: "skill", label: "技能库" }
];

const draft = ref<LongBookAnalysisPreset[]>([]);
const draggedIndex = ref<number | null>(null);

watch(
  () => [props.open, props.presets] as const,
  ([open]) => {
    if (open)
      draft.value = props.presets.map((preset) => structuredClone(preset));
  },
  { immediate: true }
);

function addPreset(): void {
  if (draft.value.length >= 50) {
    uiMessage.warning("预设最多 50 项。");
    return;
  }
  draft.value.push({
    id: createId("analysis_preset"),
    name: `新预设 ${draft.value.length + 1}`,
    description: "说明这个预设要从长篇中提炼什么。",
    systemPrompt:
      "你是长篇拆书分析智能体。请基于章节证据提炼可复用的方法与结构，避免大段复制原文。",
    output: { domain: "material", kind: "other", stageId: "other" }
  });
}

function copyPreset(index: number): void {
  const current = draft.value[index];
  if (!current || draft.value.length >= 50) return;
  draft.value.splice(index + 1, 0, {
    ...structuredClone(current),
    id: createId("analysis_preset"),
    name: `${current.name} 副本`,
    builtin: false
  });
}

function removePreset(index: number): void {
  const current = draft.value[index];
  if (!current) return;
  if (!window.confirm(`确认删除预设“${current.name}”吗？`)) return;
  draft.value.splice(index, 1);
}

function dropAt(targetIndex: number): void {
  const sourceIndex = draggedIndex.value;
  draggedIndex.value = null;
  if (sourceIndex === null || sourceIndex === targetIndex) return;
  const [preset] = draft.value.splice(sourceIndex, 1);
  if (preset) draft.value.splice(targetIndex, 0, preset);
}

function setDomain(
  preset: LongBookAnalysisPreset,
  value: string | number
): void {
  preset.output =
    value === "skill"
      ? { domain: "skill", kind: "general", stageId: "draft" }
      : { domain: "material", kind: "other", stageId: "other" };
}

function setKind(preset: LongBookAnalysisPreset, value: string | number): void {
  preset.output =
    preset.output.domain === "material"
      ? { ...preset.output, kind: value as MaterialKind }
      : { ...preset.output, kind: value as SkillKind };
}

function setStage(
  preset: LongBookAnalysisPreset,
  value: string | number
): void {
  preset.output =
    preset.output.domain === "material"
      ? { ...preset.output, stageId: value as MaterialStageId }
      : { ...preset.output, stageId: value as SkillStageId };
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="analysis-modal-backdrop"
      @click.self="emit('close')"
    >
      <section
        class="analysis-preset-modal"
        role="dialog"
        aria-modal="true"
        aria-label="拆书预设管理"
      >
        <header>
          <div>
            <p>动态配置</p>
            <h2>拆书预设管理</h2>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">
            ×
          </button>
        </header>
        <div class="preset-toolbar">
          <button type="button" @click="addPreset">新增预设</button>
          <button type="button" @click="emit('reset')">恢复全部默认</button>
          <span>{{ draft.length }} / 50</span>
        </div>
        <div class="preset-list">
          <article
            v-for="(preset, index) in draft"
            :key="preset.id"
            draggable="true"
            @dragstart="draggedIndex = index"
            @dragover.prevent
            @drop="dropAt(index)"
          >
            <div class="preset-card-heading">
              <span class="drag-handle">⋮⋮</span>
              <input
                v-model="preset.name"
                maxlength="80"
                aria-label="预设名称"
              />
              <button type="button" @click="copyPreset(index)">复制</button>
              <button
                v-if="preset.builtin"
                type="button"
                @click="emit('reset', preset.id)"
              >
                恢复默认
              </button>
              <button
                class="delete-button"
                type="button"
                @click="removePreset(index)"
              >
                删除
              </button>
            </div>
            <input
              v-model="preset.description"
              maxlength="500"
              aria-label="预设说明"
            />
            <div class="preset-output-row">
              <PopupSelect
                :model-value="preset.output.domain"
                :options="domainOptions"
                accessible-label="结果领域"
                :menu-z-index="3200"
                @update:model-value="setDomain(preset, $event)"
              />
              <PopupSelect
                :model-value="preset.output.kind"
                :options="
                  preset.output.domain === 'material'
                    ? materialKinds
                    : skillKinds
                "
                accessible-label="资料类型"
                :menu-z-index="3200"
                @update:model-value="setKind(preset, $event)"
              />
              <PopupSelect
                :model-value="preset.output.stageId"
                :options="
                  preset.output.domain === 'material'
                    ? materialStages
                    : skillStages
                "
                accessible-label="资料阶段"
                :menu-z-index="3200"
                @update:model-value="setStage(preset, $event)"
              />
            </div>
            <textarea
              v-model="preset.systemPrompt"
              maxlength="200000"
              aria-label="预设系统提示词"
            />
          </article>
        </div>
        <footer>
          <button type="button" @click="emit('close')">取消</button>
          <button
            class="analysis-primary-button"
            type="button"
            :disabled="saving"
            @click="emit('save', draft)"
          >
            {{ saving ? "保存中…" : "保存预设" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.analysis-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #000 44%, transparent);
  color: var(--text-primary);
}
.analysis-preset-modal {
  display: flex;
  flex-direction: column;
  width: min(960px, 94vw);
  max-height: 90vh;
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  box-shadow: 0 24px 70px color-mix(in srgb, #000 30%, transparent);
}
.analysis-preset-modal > header,
.analysis-preset-modal > footer,
.preset-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--theme-line-soft);
}
.analysis-preset-modal > header p,
.analysis-preset-modal > header h2 {
  margin: 0;
}
.analysis-preset-modal > header p {
  color: var(--text-tertiary);
  font-size: 12px;
}
.analysis-preset-modal > header button,
.preset-toolbar button,
.preset-card-heading button,
.analysis-preset-modal > footer button {
  border: 0;
  border-radius: 8px;
  padding: 7px 10px;
  background: var(--surface-muted);
  color: var(--text-primary);
  cursor: pointer;
}
.preset-toolbar span {
  margin-left: auto;
  color: var(--text-tertiary);
}
.preset-list {
  overflow: auto;
  padding: 14px 18px;
}
.preset-list article {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-main);
}
.preset-list input,
.preset-list textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font: inherit;
}
.preset-list textarea {
  min-height: 150px;
  resize: vertical;
  line-height: 1.6;
}
.preset-card-heading {
  display: grid;
  grid-template-columns: auto minmax(180px, 1fr) auto auto auto;
  gap: 7px;
  align-items: center;
}
.drag-handle {
  color: var(--text-tertiary);
  cursor: grab;
}
.preset-output-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.analysis-preset-modal > footer {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
  border-bottom: 0;
}
.analysis-preset-modal .analysis-primary-button {
  background: var(--text-primary);
  color: var(--surface-main);
}
.delete-button {
  color: var(--danger, #c64b4b) !important;
}
@media (max-width: 720px) {
  .preset-output-row {
    grid-template-columns: 1fr;
  }
  .preset-card-heading {
    grid-template-columns: auto 1fr auto;
  }
}
</style>
