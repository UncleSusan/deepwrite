<script setup lang="ts">
import {
  computed,
  reactive,
  ref,
  watch
} from "vue";
import type {
  LongCharacterGroup,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch,
  LongWorldbuildingFormat
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  createLongStructureMutationBuilder,
  type LongOrderDirection,
  type LongStructureMutationBuilder
} from "../types/longStructureMutations";
import { isLongMigrationEvidenceCategoryId } from "../types/longWorkspace";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";
import LongPlotStructureManager from "./LongPlotStructureManager.vue";

type ManagerSection =
  | "worldbuilding"
  | "character"
  | "volume"
  | "arc"
  | "chapter";

interface ManagerRow {
  id: string;
  title: string;
  detail: string;
  scopeId: string;
  readOnly?: boolean;
  editLocked?: boolean;
  deleteLocked?: boolean;
  reorderLocked?: boolean;
}

interface StructureDraft {
  id: string | null;
  title: string;
  format: LongWorldbuildingFormat;
  group: LongCharacterGroup;
  aliasesText: string;
  summary: string;
  outline: string;
  worldConstraints: string;
  volumeId: string;
  primaryArcId: string;
  characterIds: string[];
}

const props = withDefaults(
  defineProps<{
    snapshot: LongWorkspaceIndexSnapshot;
    disabled?: boolean;
    previewError?: string | null;
  }>(),
  {
    disabled: false,
    previewError: null
  }
);

const emit = defineEmits<{
  proposal: [batch: LongWorkspaceOperationBatch];
}>();

const sectionOptions: readonly PopupSelectOption[] = [
  { value: "worldbuilding", label: "世界观分类" },
  { value: "character", label: "人物" },
  { value: "volume", label: "卷" },
  { value: "arc", label: "剧情弧" },
  { value: "chapter", label: "章卡" }
];

const formatOptions: readonly PopupSelectOption[] = [
  { value: "list", label: "条目列表" },
  { value: "text", label: "连续文本" }
];

const groupLabels: Record<LongCharacterGroup, string> = {
  protagonist: "主角",
  major_supporting: "重要配角",
  minor_supporting: "次要配角",
  passerby: "过场人物"
};

const groupOptions: readonly PopupSelectOption[] = (
  Object.entries(groupLabels) as Array<[LongCharacterGroup, string]>
).map(([value, label]) => ({ value, label }));

const sectionLabels: Record<ManagerSection, string> = {
  worldbuilding: "世界观分类",
  character: "人物",
  volume: "卷",
  arc: "剧情弧",
  chapter: "章卡"
};

const activeSection = ref<ManagerSection>("worldbuilding");
const formOpen = ref(false);
const formMode = ref<"create" | "edit">("create");
const pendingDelete = ref<ManagerRow | null>(null);
const cascadeDelete = ref(false);

function emptyDraft(): StructureDraft {
  return {
    id: null,
    title: "",
    format: "text",
    group: "protagonist",
    aliasesText: "",
    summary: "",
    outline: "",
    worldConstraints: "",
    volumeId: "",
    primaryArcId: "",
    characterIds: []
  };
}

const draft = reactive<StructureDraft>(emptyDraft());

const volumeById = computed(
  () =>
    new Map(
      props.snapshot.plot.volumes.map((volume) => [volume.id, volume] as const)
    )
);

const arcById = computed(
  () =>
    new Map(props.snapshot.plot.arcs.map((arc) => [arc.id, arc] as const))
);

const committedChapterIds = computed(
  () =>
    new Set(
      props.snapshot.ledger.commits.map(({ chapterCardId }) => chapterCardId)
    )
);
const committedEventIds = computed(() => {
  const ids = new Set<string>();
  for (const placement of props.snapshot.plot.narrativePlacements) {
    if (placement.commitId !== null) ids.add(placement.eventId);
  }
  for (const thread of props.snapshot.plot.foreshadowing) {
    const hasCommittedBeat = thread.beats.some(
      ({ commitId }) => commitId !== null
    );
    if (hasCommittedBeat && thread.truthEventId) {
      ids.add(thread.truthEventId);
    }
    for (const beat of thread.beats) {
      if (beat.commitId !== null && beat.eventId) {
        ids.add(beat.eventId);
      }
    }
  }
  return ids;
});
const committedCharacterIds = computed(() => {
  const ids = new Set<string>();
  for (const chapter of props.snapshot.plot.chapterCards) {
    if (!committedChapterIds.value.has(chapter.id)) continue;
    chapter.characterIds.forEach((id) => ids.add(id));
  }
  for (const event of props.snapshot.plot.storyEvents) {
    if (!committedEventIds.value.has(event.id)) continue;
    event.characterIds.forEach((id) => ids.add(id));
  }
  return ids;
});
const committedCharacterGroups = computed(
  () =>
    new Set(
      props.snapshot.characters
        .filter(({ id }) => committedCharacterIds.value.has(id))
        .map(({ group }) => group)
    )
);
const committedArcIds = computed(() => {
  const ids = new Set<string>();
  for (const chapter of props.snapshot.plot.chapterCards) {
    if (committedChapterIds.value.has(chapter.id)) {
      ids.add(chapter.primaryArcId);
    }
  }
  for (const event of props.snapshot.plot.storyEvents) {
    if (!committedEventIds.value.has(event.id)) continue;
    event.arcIds.forEach((id) => ids.add(id));
  }
  return ids;
});
const committedVolumeIds = computed(
  () =>
    new Set(
      [
        ...props.snapshot.plot.chapterCards
          .filter(({ id }) => committedChapterIds.value.has(id))
          .map(({ volumeId }) => volumeId),
        ...props.snapshot.plot.arcs
          .filter(({ id }) => committedArcIds.value.has(id))
          .map(({ volumeId }) => volumeId)
      ]
    )
);

const volumeOptions = computed<PopupSelectOption[]>(() =>
  [...props.snapshot.plot.volumes]
    .sort((left, right) => left.order - right.order)
    .map((volume) => ({
      value: volume.id,
      label: volume.title
    }))
);

const draftArcOptions = computed<PopupSelectOption[]>(() =>
  props.snapshot.plot.arcs
    .filter((arc) => arc.volumeId === draft.volumeId)
    .sort((left, right) => left.order - right.order)
    .map((arc) => ({
      value: arc.id,
      label: arc.title
    }))
);

const rows = computed<ManagerRow[]>(() => {
  switch (activeSection.value) {
    case "worldbuilding":
      return [...props.snapshot.worldbuilding]
        .sort((left, right) => left.order - right.order)
        .map((category) => ({
          id: category.id,
          title: category.title,
          detail: category.format === "list" ? "条目列表" : "连续文本",
          scopeId: "worldbuilding",
          readOnly: isLongMigrationEvidenceCategoryId(category.id)
        }));
    case "character":
      return [...props.snapshot.characters]
        .sort((left, right) => {
          const groupOrder = groupOptions.findIndex(
            (option) => option.value === left.group
          );
          const otherGroupOrder = groupOptions.findIndex(
            (option) => option.value === right.group
          );
          return groupOrder - otherGroupOrder || left.order - right.order;
        })
        .map((character) => ({
          id: character.id,
          title: character.name,
          detail: `${groupLabels[character.group]}${
            character.aliases.length > 0
              ? ` · 别名：${character.aliases.join("、")}`
              : ""
          }`,
          scopeId: character.group,
          deleteLocked: committedCharacterIds.value.has(character.id),
          reorderLocked: committedCharacterGroups.value.has(character.group)
        }));
    case "volume":
      return [...props.snapshot.plot.volumes]
        .sort((left, right) => left.order - right.order)
        .map((volume) => ({
          id: volume.id,
          title: volume.title,
          detail: volume.summary || "尚未填写卷概要",
          scopeId: "volume",
          deleteLocked: committedVolumeIds.value.has(volume.id),
          reorderLocked: committedVolumeIds.value.size > 0
        }));
    case "arc":
      return [...props.snapshot.plot.arcs]
        .sort((left, right) => {
          const leftVolumeOrder =
            volumeById.value.get(left.volumeId)?.order ?? 0;
          const rightVolumeOrder =
            volumeById.value.get(right.volumeId)?.order ?? 0;
          return leftVolumeOrder - rightVolumeOrder || left.order - right.order;
        })
        .map((arc) => ({
          id: arc.id,
          title: arc.title,
          detail: `${volumeById.value.get(arc.volumeId)?.title ?? "未知卷"}${
            arc.outline ? ` · ${arc.outline}` : ""
          }`,
          scopeId: arc.volumeId,
          deleteLocked: committedArcIds.value.has(arc.id),
          reorderLocked: committedVolumeIds.value.has(arc.volumeId)
        }));
    case "chapter":
      return [...props.snapshot.plot.chapterCards]
        .sort((left, right) => {
          const leftVolumeOrder =
            volumeById.value.get(left.volumeId)?.order ?? 0;
          const rightVolumeOrder =
            volumeById.value.get(right.volumeId)?.order ?? 0;
          return (
            leftVolumeOrder - rightVolumeOrder ||
            left.narrativeOrder - right.narrativeOrder
          );
        })
        .map((chapter) => {
          const committed = committedChapterIds.value.has(chapter.id);
          return {
            id: chapter.id,
            title: chapter.title,
            detail: `${
              volumeById.value.get(chapter.volumeId)?.title ?? "未知卷"
            } · ${
              arcById.value.get(chapter.primaryArcId)?.title ?? "未知剧情弧"
            } · ${chapter.characterIds.length} 位人物`,
            scopeId: chapter.volumeId,
            editLocked: committed,
            deleteLocked: committed,
            reorderLocked: committedVolumeIds.value.has(chapter.volumeId)
          };
        });
  }
});

const selectedSectionLabel = computed(
  () => sectionLabels[activeSection.value]
);

const formTitle = computed(() =>
  formMode.value === "create"
    ? `新建${selectedSectionLabel.value}`
    : `编辑${selectedSectionLabel.value}`
);

const arcVolumeLocked = computed(
  () =>
    formMode.value === "edit" &&
    activeSection.value === "arc" &&
    draft.id !== null &&
    committedArcIds.value.has(draft.id)
);

const emptyDescription = computed(
  () => `还没有${selectedSectionLabel.value}，可先创建第一项。`
);

watch(
  () => props.previewError,
  (message) => {
    if (message) {
      uiMessage.warning(message);
    }
  }
);

function setSection(value: PopupSelectValue): void {
  if (
    value === "worldbuilding" ||
    value === "character" ||
    value === "volume" ||
    value === "arc" ||
    value === "chapter"
  ) {
    activeSection.value = value;
    closeForm();
    closeDelete();
  }
}

function setFormat(value: PopupSelectValue): void {
  if (value === "list" || value === "text") {
    draft.format = value;
  }
}

function setGroup(value: PopupSelectValue): void {
  if (
    value === "protagonist" ||
    value === "major_supporting" ||
    value === "minor_supporting" ||
    value === "passerby"
  ) {
    draft.group = value;
  }
}

function setDraftVolume(value: PopupSelectValue): void {
  if (typeof value !== "string") {
    return;
  }
  draft.volumeId = value;
  if (!draftArcOptions.value.some((option) => option.value === draft.primaryArcId)) {
    const firstArc = draftArcOptions.value[0];
    draft.primaryArcId =
      typeof firstArc?.value === "string" ? firstArc.value : "";
  }
}

function setDraftArc(value: PopupSelectValue): void {
  if (typeof value === "string") {
    draft.primaryArcId = value;
  }
}

function resetDraft(): void {
  Object.assign(draft, emptyDraft());
}

function openCreate(): void {
  if (
    (activeSection.value === "arc" || activeSection.value === "chapter") &&
    volumeOptions.value.length === 0
  ) {
    uiMessage.warning("请先创建至少一个卷。");
    return;
  }
  resetDraft();
  formMode.value = "create";
  const firstVolume = volumeOptions.value[0];
  draft.volumeId =
    typeof firstVolume?.value === "string" ? firstVolume.value : "";
  const firstArc = props.snapshot.plot.arcs
    .filter((arc) => arc.volumeId === draft.volumeId)
    .sort((left, right) => left.order - right.order)[0];
  draft.primaryArcId = firstArc?.id ?? "";
  if (activeSection.value === "chapter" && !draft.primaryArcId) {
    uiMessage.warning("请先在目标卷中创建至少一个剧情弧。");
    return;
  }
  formOpen.value = true;
}

function openEdit(row: ManagerRow): void {
  if (row.readOnly || row.editLocked) {
    uiMessage.info(
      row.readOnly
        ? "迁移证据是只读资料，不能改名、改格式或删除。"
        : "该结构已被已提交的连续性事实引用，不能编辑或移动；请先回滚相关提交。"
    );
    return;
  }
  resetDraft();
  formMode.value = "edit";
  draft.id = row.id;
  switch (activeSection.value) {
    case "worldbuilding": {
      const category = props.snapshot.worldbuilding.find(
        (candidate) => candidate.id === row.id
      );
      if (!category) return;
      draft.title = category.title;
      draft.format = category.format;
      break;
    }
    case "character": {
      const character = props.snapshot.characters.find(
        (candidate) => candidate.id === row.id
      );
      if (!character) return;
      draft.title = character.name;
      draft.group = character.group;
      draft.aliasesText = character.aliases.join("、");
      break;
    }
    case "volume": {
      const volume = props.snapshot.plot.volumes.find(
        (candidate) => candidate.id === row.id
      );
      if (!volume) return;
      draft.title = volume.title;
      draft.summary = volume.summary;
      break;
    }
    case "arc": {
      const arc = props.snapshot.plot.arcs.find(
        (candidate) => candidate.id === row.id
      );
      if (!arc) return;
      draft.title = arc.title;
      draft.volumeId = arc.volumeId;
      draft.outline = arc.outline;
      break;
    }
    case "chapter": {
      const chapter = props.snapshot.plot.chapterCards.find(
        (candidate) => candidate.id === row.id
      );
      if (!chapter) return;
      draft.title = chapter.title;
      draft.volumeId = chapter.volumeId;
      draft.primaryArcId = chapter.primaryArcId;
      draft.outline = chapter.outline;
      draft.worldConstraints = chapter.worldConstraints;
      draft.characterIds = [...chapter.characterIds];
      break;
    }
  }
  formOpen.value = true;
}

function closeForm(): void {
  formOpen.value = false;
}

function aliasesFromDraft(): string[] {
  return draft.aliasesText
    .split(/[,，、\n]/u)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function propose(
  build: (builder: LongStructureMutationBuilder) => LongWorkspaceOperationBatch
): boolean {
  try {
    emit(
      "proposal",
      build(createLongStructureMutationBuilder(props.snapshot))
    );
    return true;
  } catch (error) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法生成长篇结构变更提案。"
    );
    return false;
  }
}

function submitForm(): void {
  const title = draft.title.trim();
  if (!title) {
    uiMessage.warning(
      activeSection.value === "character" ? "请输入人物姓名。" : "请输入标题。"
    );
    return;
  }

  const succeeded = propose((builder) => {
    if (formMode.value === "create") {
      switch (activeSection.value) {
        case "worldbuilding":
          return builder.createWorldbuilding({
            title,
            format: draft.format
          });
        case "character":
          return builder.createCharacter({
            name: title,
            group: draft.group,
            aliases: aliasesFromDraft()
          });
        case "volume":
          return builder.createVolume({
            title,
            summary: draft.summary
          });
        case "arc":
          return builder.createArc({
            title,
            volumeId: draft.volumeId,
            outline: draft.outline
          });
        case "chapter":
          return builder.createChapter({
            title,
            volumeId: draft.volumeId,
            primaryArcId: draft.primaryArcId,
            outline: draft.outline,
            worldConstraints: draft.worldConstraints,
            characterIds: draft.characterIds
          });
      }
    }

    if (!draft.id) {
      throw new Error("缺少待编辑条目的稳定 ID。");
    }
    switch (activeSection.value) {
      case "worldbuilding":
        return builder.updateWorldbuilding(draft.id, {
          title,
          format: draft.format
        });
      case "character":
        return builder.updateCharacter(draft.id, {
          name: title,
          group: draft.group,
          aliases: aliasesFromDraft()
        });
      case "volume":
        return builder.updateVolume(draft.id, {
          title,
          summary: draft.summary
        });
      case "arc":
        return builder.updateArc(draft.id, {
          title,
          volumeId: draft.volumeId,
          outline: draft.outline
        });
      case "chapter":
        return builder.updateChapter(draft.id, {
          title,
          volumeId: draft.volumeId,
          primaryArcId: draft.primaryArcId,
          outline: draft.outline,
          worldConstraints: draft.worldConstraints,
          characterIds: draft.characterIds
        });
    }
  });

  if (succeeded) {
    closeForm();
  }
}

function siblingIds(row: ManagerRow): string[] {
  return rows.value
    .filter((candidate) => candidate.scopeId === row.scopeId)
    .map((candidate) => candidate.id);
}

function canMove(row: ManagerRow, direction: LongOrderDirection): boolean {
  if (row.readOnly || row.reorderLocked) return false;
  const ids = siblingIds(row);
  const index = ids.indexOf(row.id);
  return direction === "up" ? index > 0 : index >= 0 && index < ids.length - 1;
}

function reorder(row: ManagerRow, direction: LongOrderDirection): void {
  if (row.readOnly || row.reorderLocked) {
    uiMessage.info(
      row.readOnly
        ? "迁移证据保持稳定顺序，不能重排。"
        : "该顺序范围包含已提交的连续性事实，不能重排。"
    );
    return;
  }
  propose((builder) => {
    switch (activeSection.value) {
      case "worldbuilding":
        return builder.reorderWorldbuilding(row.id, direction);
      case "character":
        return builder.reorderCharacter(row.id, direction);
      case "volume":
        return builder.reorderVolume(row.id, direction);
      case "arc":
        return builder.reorderArc(row.id, direction);
      case "chapter":
        return builder.reorderChapter(row.id, direction);
    }
  });
}

function openDelete(row: ManagerRow): void {
  if (row.readOnly || row.deleteLocked) {
    uiMessage.info(
      row.readOnly
        ? "迁移证据是只读资料，不能删除。"
        : "该结构已被已提交的连续性事实引用，不能删除。"
    );
    return;
  }
  cascadeDelete.value = false;
  pendingDelete.value = row;
}

function closeDelete(): void {
  pendingDelete.value = null;
  cascadeDelete.value = false;
}

function confirmDelete(): void {
  const target = pendingDelete.value;
  if (!target) {
    return;
  }
  const succeeded = propose((builder) => {
    switch (activeSection.value) {
      case "worldbuilding":
        return builder.deleteWorldbuilding(target.id, cascadeDelete.value);
      case "character":
        return builder.deleteCharacter(target.id, cascadeDelete.value);
      case "volume":
        return builder.deleteVolume(target.id, cascadeDelete.value);
      case "arc":
        return builder.deleteArc(target.id, cascadeDelete.value);
      case "chapter":
        return builder.deleteChapter(target.id, cascadeDelete.value);
    }
  });
  if (succeeded) {
    uiMessage.info(
      cascadeDelete.value
        ? "已生成级联删除提案，等待外层预览确认。"
        : "已生成安全删除提案；若依赖检查不通过，可改用级联删除。"
    );
  }
}

function handleCharacterToggle(characterId: string, event: Event): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  if (input.checked) {
    if (!draft.characterIds.includes(characterId)) {
      draft.characterIds.push(characterId);
    }
  } else {
    draft.characterIds = draft.characterIds.filter((id) => id !== characterId);
  }
}

function forwardPlotProposal(batch: LongWorkspaceOperationBatch): void {
  emit("proposal", batch);
}
</script>

<template>
  <section class="long-structure-manager" aria-label="长篇结构管理">
    <header class="manager-header">
      <div>
        <p class="manager-eyebrow">LONG-FORM STRUCTURE</p>
        <h2>结构管理</h2>
        <p>手工维护核心、剧情与叙事结构；所有操作仅生成待预览的变更提案。</p>
      </div>
      <div class="manager-toolbar">
        <PopupSelect
          :model-value="activeSection"
          :options="sectionOptions"
          accessible-label="选择长篇结构类型"
          variant="compact"
          size="small"
          :disabled="disabled"
          :menu-z-index="2300"
          @update:model-value="setSection"
        />
        <button
          class="primary-button"
          type="button"
          :disabled="disabled"
          @click="openCreate"
        >
          新建{{ selectedSectionLabel }}
        </button>
      </div>
    </header>

    <div v-if="rows.length === 0" class="manager-empty">
      <strong>{{ emptyDescription }}</strong>
      <span>创建后会生成完整稳定 ID；需要 Markdown 的结构也会带齐空文件引用。</span>
    </div>

    <ol v-else class="manager-list">
      <li v-for="row in rows" :key="row.id" class="manager-row">
        <div class="row-copy">
          <strong>{{ row.title }}</strong>
          <span>
            {{ row.detail
            }}{{
              row.readOnly
                ? " · 迁移证据只读"
                : row.editLocked || row.deleteLocked || row.reorderLocked
                  ? " · 连续性保护"
                  : ""
            }}
          </span>
          <code>{{ row.id }}</code>
        </div>
        <div class="row-actions">
          <button
            type="button"
            :aria-label="`上移${row.title}`"
            title="上移"
            :disabled="disabled || !canMove(row, 'up')"
            @click="reorder(row, 'up')"
          >
            ↑
          </button>
          <button
            type="button"
            :aria-label="`下移${row.title}`"
            title="下移"
            :disabled="disabled || !canMove(row, 'down')"
            @click="reorder(row, 'down')"
          >
            ↓
          </button>
          <button
            type="button"
            :aria-label="`编辑${row.title}`"
            :disabled="disabled || row.readOnly || row.editLocked"
            @click="openEdit(row)"
          >
            编辑
          </button>
          <button
            class="delete-button"
            type="button"
            :aria-label="`删除${row.title}`"
            :disabled="disabled || row.readOnly || row.deleteLocked"
            @click="openDelete(row)"
          >
            删除
          </button>
        </div>
      </li>
    </ol>

    <p class="manager-footnote">
      排序只在同一人物分组、卷或剧情弧作用域内调整，不会重排现有短篇或剧本资源。
    </p>

    <LongPlotStructureManager
      :snapshot="snapshot"
      :disabled="disabled"
      @proposal="forwardPlotProposal"
    />

    <Teleport to="body">
      <div
        v-if="formOpen"
        class="structure-modal-overlay"
        @mousedown.self="closeForm"
      >
        <section
          class="structure-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="formTitle"
        >
          <form @submit.prevent="submitForm">
            <header class="modal-header">
              <div>
                <span>{{ formMode === "create" ? "CREATE" : "EDIT" }}</span>
                <h3>{{ formTitle }}</h3>
              </div>
              <button
                class="close-button"
                type="button"
                aria-label="关闭"
                @click="closeForm"
              >
                ×
              </button>
            </header>

            <div class="modal-body">
              <label class="form-field">
                <span>{{
                  activeSection === "character" ? "人物姓名" : "标题"
                }}</span>
                <input
                  v-model="draft.title"
                  maxlength="256"
                  autocomplete="off"
                  required
                />
              </label>

              <label
                v-if="activeSection === 'worldbuilding'"
                class="form-field"
              >
                <span>内容格式</span>
                <PopupSelect
                  :model-value="draft.format"
                  :options="formatOptions"
                  accessible-label="选择世界观内容格式"
                  :menu-z-index="2300"
                  @update:model-value="setFormat"
                />
              </label>

              <template v-if="activeSection === 'character'">
                <label class="form-field">
                  <span>人物分组</span>
                  <PopupSelect
                    :model-value="draft.group"
                    :options="groupOptions"
                    accessible-label="选择人物分组"
                    :menu-z-index="2300"
                    @update:model-value="setGroup"
                  />
                </label>
                <label class="form-field">
                  <span>别名</span>
                  <textarea
                    v-model="draft.aliasesText"
                    rows="2"
                    maxlength="8000"
                    placeholder="多个别名可用逗号、顿号或换行分隔"
                  />
                </label>
              </template>

              <label
                v-if="activeSection === 'volume'"
                class="form-field"
              >
                <span>卷概要</span>
                <textarea
                  v-model="draft.summary"
                  rows="4"
                  maxlength="200000"
                />
              </label>

              <template
                v-if="activeSection === 'arc' || activeSection === 'chapter'"
              >
                <label class="form-field">
                  <span>所属卷</span>
                  <PopupSelect
                    :model-value="draft.volumeId"
                    :options="volumeOptions"
                    accessible-label="选择所属卷"
                    :disabled="arcVolumeLocked"
                    :menu-z-index="2300"
                    @update:model-value="setDraftVolume"
                  />
                  <small v-if="arcVolumeLocked">
                    已提交剧情弧可更新标题与提纲，但不能迁移到其他卷。
                  </small>
                </label>
                <label
                  v-if="activeSection === 'chapter'"
                  class="form-field"
                >
                  <span>主剧情弧</span>
                  <PopupSelect
                    :model-value="draft.primaryArcId"
                    :options="draftArcOptions"
                    accessible-label="选择章卡主剧情弧"
                    placeholder="当前卷还没有剧情弧"
                    :menu-z-index="2300"
                    @update:model-value="setDraftArc"
                  />
                </label>
                <label class="form-field">
                  <span>{{ activeSection === "arc" ? "剧情弧提纲" : "章卡提纲" }}</span>
                  <textarea
                    v-model="draft.outline"
                    rows="4"
                    maxlength="200000"
                  />
                </label>
              </template>

              <template v-if="activeSection === 'chapter'">
                <label class="form-field">
                  <span>世界观约束</span>
                  <textarea
                    v-model="draft.worldConstraints"
                    rows="3"
                    maxlength="200000"
                  />
                </label>
                <fieldset class="character-picker">
                  <legend>关联人物</legend>
                  <p v-if="snapshot.characters.length === 0">
                    尚未创建人物，可稍后再关联。
                  </p>
                  <label
                    v-for="character in snapshot.characters"
                    v-else
                    :key="character.id"
                  >
                    <input
                      type="checkbox"
                      :checked="draft.characterIds.includes(character.id)"
                      @change="handleCharacterToggle(character.id, $event)"
                    />
                    <span>{{ character.name }}</span>
                    <small>{{ groupLabels[character.group] }}</small>
                  </label>
                </fieldset>
              </template>
            </div>

            <footer class="modal-actions">
              <button type="button" @click="closeForm">取消</button>
              <button class="primary-button" type="submit">
                生成变更提案
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="pendingDelete"
        class="structure-modal-overlay"
        @mousedown.self="closeDelete"
      >
        <section
          class="structure-modal delete-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="long-structure-delete-title"
          aria-describedby="long-structure-delete-description"
        >
          <header class="modal-header">
            <div>
              <span>DELETE PROPOSAL</span>
              <h3 id="long-structure-delete-title">
                删除“{{ pendingDelete.title }}”
              </h3>
            </div>
          </header>
          <div class="modal-body">
            <p id="long-structure-delete-description" class="delete-copy">
              默认先用 <code>cascade: false</code>
              生成安全删除提案，由外层预览依赖冲突；本组件不会直接删除任何文件。
            </p>
            <label class="cascade-option">
              <input v-model="cascadeDelete" type="checkbox" />
              <span>
                同时删除依赖项
                <small>仅在预览确认依赖范围后使用 cascade: true。</small>
              </span>
            </label>
          </div>
          <footer class="modal-actions">
            <button type="button" @click="closeDelete">取消</button>
            <button
              class="danger-button"
              type="button"
              :disabled="disabled"
              @click="confirmDelete"
            >
              {{
                cascadeDelete
                  ? "生成级联删除提案"
                  : "生成安全删除提案"
              }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.long-structure-manager {
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 0.85rem;
  padding: clamp(0.85rem, 2vw, 1.25rem);
  border: 1px solid var(--theme-line);
  border-radius: 0.85rem;
  color: var(--text-primary);
  background: var(--surface-main);
  font-size: 0.875rem;
}

.manager-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}

.manager-header h2,
.modal-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.1rem;
  line-height: 1.3;
}

.manager-header p,
.modal-header span,
.manager-footnote {
  margin: 0.25rem 0 0;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.manager-eyebrow {
  color: var(--accent) !important;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.11em;
}

.manager-toolbar,
.row-actions,
.modal-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

button,
input,
textarea {
  font: inherit;
}

button {
  min-height: 2rem;
  padding: 0.38rem 0.7rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.55rem;
  color: var(--text-secondary);
  background: var(--surface-raised);
  cursor: pointer;
}

button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--surface-hover);
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 0.2rem var(--accent-soft);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.primary-button {
  border-color: var(--neutral-solid);
  color: var(--accent-contrast);
  background: var(--neutral-solid);
  font-weight: 650;
}

.primary-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--neutral-solid) 86%, var(--text-primary));
  color: var(--accent-contrast);
  background: color-mix(in srgb, var(--neutral-solid) 86%, var(--text-primary));
}

.manager-list {
  display: grid;
  gap: 0.55rem;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.manager-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  padding: 0.75rem;
  border: 1px solid var(--theme-line-soft);
  border-radius: 0.7rem;
  background: var(--surface-raised);
}

.manager-row:hover {
  border-color: var(--theme-line);
  background: var(--surface-hover);
}

.row-copy {
  display: grid;
  min-width: 0;
  gap: 0.18rem;
}

.row-copy strong,
.row-copy span,
.row-copy code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-copy span {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.row-copy code,
.delete-copy code {
  color: var(--text-tertiary);
  font: 0.72rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.row-actions button {
  min-width: 2rem;
  padding-inline: 0.5rem;
}

.delete-button {
  color: var(--danger);
}

.manager-empty {
  display: grid;
  place-items: center;
  gap: 0.35rem;
  padding: clamp(1.5rem, 5vw, 3rem) 1rem;
  border: 1px dashed var(--theme-line);
  border-radius: 0.75rem;
  color: var(--text-secondary);
  text-align: center;
  background: var(--surface-muted);
}

.manager-empty span {
  color: var(--text-tertiary);
  font-size: 0.8rem;
}

.structure-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: grid;
  place-items: center;
  overflow: auto;
  padding: 1rem;
  background: color-mix(in srgb, var(--theme-foreground) 28%, transparent);
  backdrop-filter: blur(0.2rem);
}

.structure-modal {
  width: min(36rem, 100%);
  max-height: min(88vh, 48rem);
  overflow: auto;
  border: 1px solid var(--theme-line);
  border-radius: 0.9rem;
  color: var(--text-primary);
  background: var(--surface-main);
  box-shadow: 0 1.2rem 3.5rem
    color-mix(in srgb, var(--theme-foreground) 24%, transparent);
  font-size: 0.875rem;
}

.modal-header,
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
}

.modal-header {
  border-bottom: 1px solid var(--theme-line-soft);
}

.modal-header span {
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.close-button {
  width: 2rem;
  padding: 0;
  border-color: transparent;
  background: transparent;
  font-size: 1.2rem;
}

.modal-body {
  display: grid;
  gap: 0.85rem;
  padding: 1rem;
}

.form-field {
  display: grid;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.form-field input,
.form-field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.6rem 0.65rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.6rem;
  color: var(--text-primary);
  background: var(--surface-raised);
  font-weight: 400;
  line-height: 1.5;
}

.form-field textarea {
  resize: vertical;
}

.character-picker {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.65rem;
  background: var(--surface-muted);
}

.character-picker legend {
  padding-inline: 0.25rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.character-picker > label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem;
  border-radius: 0.45rem;
  background: var(--surface-raised);
}

.character-picker p,
.delete-copy {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}

.character-picker small,
.cascade-option small {
  color: var(--text-tertiary);
}

.modal-actions {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.delete-modal {
  width: min(31rem, 100%);
}

.cascade-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.65rem;
  color: var(--text-primary);
  background: var(--surface-muted);
}

.cascade-option span {
  display: grid;
  gap: 0.2rem;
}

.cascade-option input {
  margin-top: 0.18rem;
  accent-color: var(--danger);
}

.danger-button {
  border-color: var(--danger);
  color: var(--surface-main);
  background: var(--danger);
  font-weight: 650;
}

.danger-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--danger) 84%, var(--text-primary));
  color: var(--surface-main);
  background: color-mix(in srgb, var(--danger) 84%, var(--text-primary));
}

@media (max-width: 42rem) {
  .manager-header,
  .manager-row {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .manager-header {
    display: grid;
  }

  .manager-toolbar {
    justify-content: space-between;
  }

  .row-actions {
    flex-wrap: wrap;
  }

  .row-actions button {
    flex: 1 1 auto;
  }
}
</style>
