<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialKind,
  MaterialLibrary,
  SkillKind,
  SkillLibrary
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    bookTitle: string;
    materials?: readonly MaterialLibrary[];
    skills?: readonly SkillLibrary[];
    linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
    linkedSkillIdsByKind: LinkedSkillIdsByKind;
    submitting?: boolean;
  }>(),
  {
    materials: () => [],
    skills: () => [],
    submitting: false
  }
);

const emit = defineEmits<{
  close: [];
  submit: [
    payload: {
      linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
      linkedSkillIdsByKind: LinkedSkillIdsByKind;
    }
  ];
}>();

const materialKinds: ReadonlyArray<{ id: MaterialKind; label: string }> = [
  { id: "character", label: "人设素材库" },
  { id: "gimmick", label: "梗素材库" },
  { id: "plot", label: "剧情素材库" },
  { id: "draft", label: "正文素材库" },
  { id: "other", label: "其他素材库" }
];
const skillKinds: ReadonlyArray<{ id: SkillKind; label: string }> = [
  { id: "general", label: "通用技能库" },
  { id: "plot", label: "剧情技能库" },
  { id: "style", label: "文风技能库" },
  { id: "other", label: "其他技能库" }
];
const selectedMaterials = reactive<Record<MaterialKind, string[]>>({
  character: [],
  gimmick: [],
  plot: [],
  draft: [],
  other: []
});
const selectedSkills = reactive<Record<SkillKind, string[]>>({
  general: [],
  plot: [],
  style: [],
  other: []
});
const materialCandidates = reactive<Record<MaterialKind, string>>({
  character: "",
  gimmick: "",
  plot: "",
  draft: "",
  other: ""
});
const skillCandidates = reactive<Record<SkillKind, string>>({
  general: "",
  plot: "",
  style: "",
  other: ""
});
const dialog = ref<HTMLElement | null>(null);

function materialOptions(kind: MaterialKind): Array<{
  value: string;
  label: string;
}> {
  const libraries = props.materials.filter(
    (library) =>
      library.materialType === "long" &&
      (library.materialKind === kind || library.materialKind === "mixed")
  );
  const selected = new Set(selectedMaterials[kind]);
  return [
    { value: "", label: "添加一个素材库…" },
    ...libraries
      .filter((library) => !selected.has(library.id))
      .map((library) => ({
        value: library.id,
        label: library.title
      }))
  ];
}

function skillOptions(kind: SkillKind): Array<{
  value: string;
  label: string;
}> {
  const libraries = props.skills.filter(
    (library) =>
      library.skillType === "long" && library.skillKind === kind
  );
  const selected = new Set(selectedSkills[kind]);
  return [
    { value: "", label: "添加一个技能库…" },
    ...libraries
      .filter((library) => !selected.has(library.id))
      .map((library) => ({
        value: library.id,
        label: library.isBuiltin ? `${library.title} · 官方` : library.title
      }))
  ];
}

function reset(): void {
  for (const { id } of materialKinds) {
    selectedMaterials[id] = [...props.linkedMaterialIdsByKind[id]];
    materialCandidates[id] = "";
  }
  for (const { id } of skillKinds) {
    selectedSkills[id] = [...props.linkedSkillIdsByKind[id]];
    skillCandidates[id] = "";
  }
}

function selectedMaterialLinks(): LinkedMaterialIdsByKind {
  return Object.fromEntries(
    materialKinds.map(({ id }) => [id, [...selectedMaterials[id]]])
  ) as LinkedMaterialIdsByKind;
}

function selectedSkillLinks(): LinkedSkillIdsByKind {
  return Object.fromEntries(
    skillKinds.map(({ id }) => [id, [...selectedSkills[id]]])
  ) as LinkedSkillIdsByKind;
}

function addMaterial(kind: MaterialKind, value: unknown): void {
  const id = String(value ?? "").trim();
  materialCandidates[kind] = "";
  if (!id || selectedMaterials[kind].includes(id)) return;
  selectedMaterials[kind] = [...selectedMaterials[kind], id];
}

function addSkill(kind: SkillKind, value: unknown): void {
  const id = String(value ?? "").trim();
  skillCandidates[kind] = "";
  if (!id || selectedSkills[kind].includes(id)) return;
  selectedSkills[kind] = [...selectedSkills[kind], id];
}

function materialLabel(id: string): string {
  const library = props.materials.find((candidate) => candidate.id === id);
  return library?.title ?? `${id} · Catalog 中缺失`;
}

function skillLabel(id: string): string {
  const library = props.skills.find((candidate) => candidate.id === id);
  if (!library) return `${id} · Catalog 中缺失`;
  return library.isBuiltin ? `${library.title} · 官方` : library.title;
}

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  emit("submit", {
    linkedMaterialIdsByKind: selectedMaterialLinks(),
    linkedSkillIdsByKind: selectedSkillLinks()
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    void nextTick(() => dialog.value?.focus());
  },
  { immediate: true }
);
onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop long-bindings-backdrop"
      @mousedown.self="requestClose"
    >
      <section
        ref="dialog"
        class="workspace-dialog long-bindings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="long-bindings-title"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">长篇资源</span>
            <h2 id="long-bindings-title">资源绑定 · {{ bookTitle }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭"
            :disabled="submitting"
            @click="requestClose"
          >
            ×
          </button>
        </header>
        <form class="dialog-content long-bindings-content" @submit.prevent="submit">
          <div class="long-bindings-note">
            <AppIcon name="library" :size="18" />
            <span>这里只更新当前长篇的独立清单。短篇、剧本及 Catalog 项目不会被修改。</span>
          </div>

          <fieldset>
            <legend>关联素材库</legend>
            <div
              v-for="kind in materialKinds"
              :key="`material:${kind.id}`"
              class="long-binding-row"
            >
              <span>
                {{ kind.label }}
                <small>可同时绑定多个；只有点击移除才会解除已有绑定。</small>
              </span>
              <div class="long-binding-picker">
                <div
                  v-if="selectedMaterials[kind.id].length"
                  class="long-binding-chips"
                >
                  <span
                    v-for="id in selectedMaterials[kind.id]"
                    :key="id"
                    class="long-binding-chip"
                  >
                    {{ materialLabel(id) }}
                    <button
                      type="button"
                      :aria-label="`解除${kind.label}绑定：${materialLabel(id)}`"
                      :disabled="submitting"
                      @click="
                        selectedMaterials[kind.id] =
                          selectedMaterials[kind.id].filter(
                            (candidate) => candidate !== id
                          )
                      "
                    >
                      ×
                    </button>
                  </span>
                </div>
                <small v-else>当前未绑定</small>
                <PopupSelect
                  :model-value="materialCandidates[kind.id]"
                  :options="materialOptions(kind.id)"
                  :accessible-label="`添加${kind.label}`"
                  :disabled="submitting || materialOptions(kind.id).length <= 1"
                  :menu-min-width="260"
                  :menu-z-index="230"
                  @update:model-value="addMaterial(kind.id, $event)"
                />
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>绑定技能库</legend>
            <div
              v-for="kind in skillKinds"
              :key="`skill:${kind.id}`"
              class="long-binding-row"
            >
              <span>
                {{ kind.label }}
                <small>可同时绑定多个；只有点击移除才会解除已有绑定。</small>
              </span>
              <div class="long-binding-picker">
                <div
                  v-if="selectedSkills[kind.id].length"
                  class="long-binding-chips"
                >
                  <span
                    v-for="id in selectedSkills[kind.id]"
                    :key="id"
                    class="long-binding-chip"
                  >
                    {{ skillLabel(id) }}
                    <button
                      type="button"
                      :aria-label="`解除${kind.label}绑定：${skillLabel(id)}`"
                      :disabled="submitting"
                      @click="
                        selectedSkills[kind.id] =
                          selectedSkills[kind.id].filter(
                            (candidate) => candidate !== id
                          )
                      "
                    >
                      ×
                    </button>
                  </span>
                </div>
                <small v-else>当前未绑定</small>
                <PopupSelect
                  :model-value="skillCandidates[kind.id]"
                  :options="skillOptions(kind.id)"
                  :accessible-label="`添加${kind.label}`"
                  :disabled="submitting || skillOptions(kind.id).length <= 1"
                  :menu-min-width="260"
                  :menu-z-index="230"
                  @update:model-value="addSkill(kind.id, $event)"
                />
              </div>
            </div>
          </fieldset>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              取消
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="submitting"
            >
              {{ submitting ? "保存中…" : "保存绑定" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.long-bindings-dialog {
  width: min(680px, calc(100vw - 48px));
  max-height: min(820px, calc(100vh - 40px));
  border-color: var(--theme-line);
  background: var(--surface-main);
}

.long-bindings-content {
  display: grid;
  gap: 16px;
  overflow-y: auto;
}

.long-bindings-note {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 9px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.785714rem;
}

fieldset {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 13px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
}

legend {
  padding: 0 6px;
  color: var(--text-primary);
  font-weight: 620;
}

.long-binding-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(240px, 1.2fr);
  align-items: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 0.785714rem;
}

.long-binding-row > span {
  display: grid;
  gap: 2px;
}

.long-binding-row small {
  color: var(--text-tertiary);
  font-size: 0.7rem;
  line-height: 1.4;
}

.long-binding-picker,
.long-binding-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.long-binding-picker {
  display: grid;
}

.long-binding-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 6px 4px 8px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.long-binding-chip button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--surface-hover);
  color: var(--text-tertiary);
}

.dialog-primary-button {
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
}

@media (max-width: 640px) {
  .long-binding-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
