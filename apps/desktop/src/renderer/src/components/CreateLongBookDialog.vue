<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  LONG_BOOK_GENRES,
  LongBookGenreSchema,
  type CreateLongBookInput,
  type MaterialKind,
  type MaterialLibrary,
  type SkillKind,
  type SkillLibrary
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    materials?: readonly MaterialLibrary[];
    skills?: readonly SkillLibrary[];
    loading?: boolean;
    submitting?: boolean;
  }>(),
  {
    materials: () => [],
    skills: () => [],
    loading: false,
    submitting: false
  }
);

const emit = defineEmits<{
  close: [];
  submit: [input: CreateLongBookInput];
}>();

const title = ref("");
const genre = ref<string>(LONG_BOOK_GENRES[0]);
const selectedMaterialIds = reactive<Record<MaterialKind, string>>({
  character: "",
  gimmick: "",
  plot: "",
  draft: "",
  other: ""
});
const selectedSkillIds = reactive<Record<SkillKind, string>>({
  general: "",
  plot: "",
  style: "",
  other: ""
});
const titleInput = ref<HTMLInputElement | null>(null);
const genreOptions = LONG_BOOK_GENRES.map((value) => ({
  value,
  label: value
}));
const materialKinds: ReadonlyArray<{
  id: MaterialKind;
  label: string;
  description: string;
}> = [
  { id: "character", label: "人设素材库", description: "人物与关系设定" },
  { id: "gimmick", label: "梗素材库", description: "核心创意与钩子" },
  { id: "plot", label: "剧情素材库", description: "长线情节与结构参考" },
  { id: "draft", label: "正文素材库", description: "正文片段与表达参考" },
  { id: "other", label: "其他素材库", description: "自定义长篇素材" }
];
const skillKinds: ReadonlyArray<{
  id: SkillKind;
  label: string;
  description: string;
}> = [
  { id: "general", label: "通用技能库", description: "多个长篇阶段均可使用" },
  { id: "plot", label: "剧情技能库", description: "人物、剧情与大纲方法" },
  { id: "style", label: "文风技能库", description: "章节与分节写作方法" },
  { id: "other", label: "其他技能库", description: "自定义写作方法" }
];
const longMaterials = computed(() =>
  props.materials.filter((library) => library.materialType === "long")
);
const longSkills = computed(() =>
  props.skills.filter((library) => library.skillType === "long")
);

function materialOptions(kind: MaterialKind): Array<{
  value: string;
  label: string;
}> {
  return [
    { value: "", label: "不关联" },
    ...longMaterials.value
      .filter(
        (library) =>
          library.materialKind === kind || library.materialKind === "mixed"
      )
      .map((library) => ({ value: library.id, label: library.title }))
  ];
}

function skillOptions(kind: SkillKind): Array<{
  value: string;
  label: string;
}> {
  return [
    { value: "", label: "不绑定" },
    ...longSkills.value
      .filter((library) => library.skillKind === kind)
      .map((library) => ({
        value: library.id,
        label: library.isBuiltin ? `${library.title} · 官方` : library.title
      }))
  ];
}

function resetDraft(): void {
  title.value = "";
  genre.value = LONG_BOOK_GENRES[0];
  for (const { id } of materialKinds) selectedMaterialIds[id] = "";
  for (const { id } of skillKinds) selectedSkillIds[id] = "";
}

function requestClose(): void {
  if (!props.submitting) {
    emit("close");
  }
}

function submit(): void {
  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) {
    uiMessage.warning("请输入长篇书名");
    titleInput.value?.focus();
    return;
  }
  if (Array.from(normalizedTitle).length > 256) {
    uiMessage.warning("长篇书名不能超过 256 个字符");
    titleInput.value?.focus();
    return;
  }

  emit("submit", {
    title: normalizedTitle,
    genre: LongBookGenreSchema.parse(genre.value),
    linkedMaterialIdsByKind: Object.fromEntries(
      materialKinds.map(({ id }) => [
        id,
        materialOptions(id).some(
          (option) =>
            option.value !== "" && option.value === selectedMaterialIds[id]
        )
          ? [selectedMaterialIds[id]]
          : []
      ])
    ),
    linkedSkillIdsByKind: Object.fromEntries(
      skillKinds.map(({ id }) => [
        id,
        skillOptions(id).some(
          (option) =>
            option.value !== "" && option.value === selectedSkillIds[id]
        )
          ? [selectedSkillIds[id]]
          : []
      ])
    )
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") {
    requestClose();
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    resetDraft();
    void nextTick(() => titleInput.value?.focus());
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
      class="dialog-backdrop create-long-book-backdrop"
      @mousedown.self="requestClose"
    >
      <section
        class="workspace-dialog create-long-book-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-long-book-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">创作空间 · 长篇</span>
            <h2 id="create-long-book-title">新建长篇作品</h2>
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

        <form class="dialog-content create-long-book-form" @submit.prevent="submit">
          <div class="create-long-book-intro">
            <span class="create-long-book-icon">
              <AppIcon name="book" :size="20" />
            </span>
            <div>
              <strong>独立长篇工作区</strong>
              <p>创建后会生成世界观、人物设计、情节设计、正文和连续性账本五个根目录。</p>
            </div>
          </div>

          <label class="create-long-book-field">
            <span>书名</span>
            <input
              ref="titleInput"
              v-model="title"
              type="text"
              maxlength="256"
              autocomplete="off"
              placeholder="请输入长篇书名"
              :disabled="submitting"
            />
          </label>

          <label class="create-long-book-field">
            <span>题材</span>
            <PopupSelect
              :model-value="genre"
              :options="genreOptions"
              accessible-label="长篇题材"
              size="large"
              :disabled="submitting"
              :menu-min-width="220"
              :menu-z-index="220"
              @update:model-value="genre = String($event)"
            />
          </label>

          <section
            class="create-long-binding-section"
            aria-labelledby="create-long-material-heading"
          >
            <div class="create-long-binding-heading">
              <div>
                <h3 id="create-long-material-heading">关联素材库</h3>
                <p>仅显示适用于长篇的素材库，Agent 会再按当前职责过滤读取范围。</p>
              </div>
            </div>
            <div class="create-long-binding-grid">
              <label
                v-for="kind in materialKinds"
                :key="`material:${kind.id}`"
                class="create-long-binding-row"
              >
                <span>
                  <strong>{{ kind.label }}</strong>
                  <small>{{ kind.description }}</small>
                </span>
                <PopupSelect
                  :model-value="selectedMaterialIds[kind.id]"
                  :options="materialOptions(kind.id)"
                  :accessible-label="`选择${kind.label}`"
                  :disabled="submitting || loading"
                  :menu-min-width="240"
                  :menu-z-index="220"
                  @update:model-value="selectedMaterialIds[kind.id] = String($event)"
                />
              </label>
            </div>
          </section>

          <section
            class="create-long-binding-section"
            aria-labelledby="create-long-skill-heading"
          >
            <div class="create-long-binding-heading">
              <div>
                <h3 id="create-long-skill-heading">绑定技能库</h3>
                <p>技能正文按需加载，不会自动写入长篇项目文件。</p>
              </div>
            </div>
            <div class="create-long-binding-grid">
              <label
                v-for="kind in skillKinds"
                :key="`skill:${kind.id}`"
                class="create-long-binding-row"
              >
                <span>
                  <strong>{{ kind.label }}</strong>
                  <small>{{ kind.description }}</small>
                </span>
                <PopupSelect
                  :model-value="selectedSkillIds[kind.id]"
                  :options="skillOptions(kind.id)"
                  :accessible-label="`选择${kind.label}`"
                  :disabled="submitting || loading"
                  :menu-min-width="240"
                  :menu-z-index="220"
                  @update:model-value="selectedSkillIds[kind.id] = String($event)"
                />
              </label>
            </div>
          </section>

          <p v-if="loading" class="create-long-book-hint">
            正在加载长篇素材库和技能库目录…
          </p>
          <p class="create-long-book-hint">
            长篇使用独立索引和按文件加载机制，不会改变现有短篇或剧本项目。
          </p>

          <div class="dialog-actions create-long-book-actions">
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
              {{ submitting ? "创建中…" : "创建长篇" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.create-long-book-dialog {
  width: min(720px, calc(100vw - 48px));
  max-height: min(840px, calc(100vh - 40px));
  border-color: var(--theme-line);
  background: var(--surface-main);
}

.create-long-book-form {
  display: grid;
  gap: 18px;
  overflow-y: auto;
}

.create-long-book-intro {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 11px;
  background: var(--surface-muted);
}

.create-long-book-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
}

.create-long-book-intro strong,
.create-long-book-field > span {
  color: var(--text-primary);
  font-weight: 620;
}

.create-long-book-intro p,
.create-long-book-hint {
  margin-top: 3px;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  line-height: 1.6;
}

.create-long-binding-section {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 11px;
  background: var(--surface-muted);
}

.create-long-binding-heading h3,
.create-long-binding-heading p {
  margin: 0;
}

.create-long-binding-heading h3 {
  color: var(--text-primary);
  font-size: 0.928571rem;
}

.create-long-binding-heading p {
  margin-top: 3px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.create-long-binding-grid {
  display: grid;
  gap: 9px;
}

.create-long-binding-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(220px, 1.2fr);
  align-items: center;
  gap: 12px;
}

.create-long-binding-row > span {
  display: grid;
  gap: 2px;
}

.create-long-binding-row strong {
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 620;
}

.create-long-binding-row small {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.create-long-book-field {
  display: grid;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 0.785714rem;
}

.create-long-book-field input {
  width: 100%;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: 0;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.create-long-book-field input:focus {
  border-color: color-mix(in srgb, var(--accent) 58%, var(--theme-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
}

.create-long-book-field input::placeholder {
  color: var(--text-tertiary);
}

.create-long-book-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-muted);
}

.create-long-book-actions {
  margin-top: 2px;
}

.dialog-primary-button {
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
}

@media (max-width: 680px) {
  .create-long-binding-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
