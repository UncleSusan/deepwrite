<script setup lang="ts">
import { computed } from "vue";
import {
  LONG_WORKSPACE_ROOTS,
  type LongWorkspaceRoot
} from "@deepwrite/contracts";

type LongBindingDomain = "skill" | "material";

const props = defineProps<{
  domain: LongBindingDomain;
  libraries: readonly { id: string; label: string }[];
  stagesFor(domain: LongBindingDomain, libraryId: string): LongWorkspaceRoot[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  updateStages: [
    domain: LongBindingDomain,
    libraryId: string,
    stages: readonly LongWorkspaceRoot[]
  ];
}>();

const stageOptions: ReadonlyArray<{
  id: LongWorkspaceRoot;
  label: string;
}> = [
  { id: "worldbuilding", label: "世界观" },
  { id: "character_design", label: "人物" },
  { id: "plot_design", label: "剧情" },
  { id: "draft", label: "正文" },
  { id: "continuity_ledger", label: "持续性账本" }
];

const resourceLabel = computed(() =>
  props.domain === "skill" ? "技能库" : "素材库"
);

function allStagesSelected(libraryId: string): boolean {
  const selected = new Set(props.stagesFor(props.domain, libraryId));
  return LONG_WORKSPACE_ROOTS.every((stage) => selected.has(stage));
}

function selectAll(libraryId: string): void {
  emit("updateStages", props.domain, libraryId, [...LONG_WORKSPACE_ROOTS]);
}

function toggleStage(
  libraryId: string,
  stage: LongWorkspaceRoot,
  enabled: boolean
): void {
  const selected = new Set(props.stagesFor(props.domain, libraryId));
  if (enabled) {
    selected.add(stage);
  } else if (selected.size > 1) {
    selected.delete(stage);
  }
  emit(
    "updateStages",
    props.domain,
    libraryId,
    LONG_WORKSPACE_ROOTS.filter((candidate) => selected.has(candidate))
  );
}
</script>

<template>
  <div class="stage-scope-panel">
    <p class="stage-scope-intro">
      仅在用户当前所处阶段装配已启用的{{
        resourceLabel
      }}。新绑定默认启用全部阶段。
    </p>
    <div v-if="libraries.length" class="stage-scope-list">
      <section
        v-for="library in libraries"
        :key="library.id"
        class="stage-scope-item"
      >
        <div class="stage-scope-heading">
          <strong>{{ library.label }}</strong>
          <button
            type="button"
            :disabled="disabled || allStagesSelected(library.id)"
            @click="selectAll(library.id)"
          >
            全部阶段
          </button>
        </div>
        <div class="stage-scope-options">
          <label v-for="stage in stageOptions" :key="stage.id">
            <input
              type="checkbox"
              :checked="stagesFor(domain, library.id).includes(stage.id)"
              :disabled="disabled"
              @change="
                toggleStage(
                  library.id,
                  stage.id,
                  ($event.target as HTMLInputElement).checked
                )
              "
            />
            <span>{{ stage.label }}</span>
          </label>
        </div>
      </section>
    </div>
    <p v-else class="stage-scope-empty">
      请先在“{{ domain === "skill" ? "选择技能" : "选择素材" }}”中添加{{
        resourceLabel
      }}。
    </p>
  </div>
</template>

<style scoped>
.stage-scope-panel,
.stage-scope-list {
  display: grid;
  gap: 12px;
}

.stage-scope-intro,
.stage-scope-empty {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  line-height: 1.6;
}

.stage-scope-item {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-main);
}

.stage-scope-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.stage-scope-heading strong {
  overflow-wrap: anywhere;
}

.stage-scope-heading button {
  flex: none;
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.714286rem;
}

.stage-scope-heading button:hover:not(:disabled) {
  background: var(--surface-hover);
}

.stage-scope-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stage-scope-options label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  cursor: pointer;
}

.stage-scope-options input {
  accent-color: var(--accent);
}
</style>
