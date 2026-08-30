<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { LONG_AGENTS_MD_MAX_CHARACTERS } from "@deepwrite/contracts";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch,
  LongWorldbuildingFormat,
  LongWorldbuildingItemLayout
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  useLongStructureDeleteConfirmation,
  type LongStructureDeleteRow
} from "../composables/useLongStructureDeleteConfirmation";
import { useLongStructureFormImpact } from "../composables/useLongStructureFormImpact";
import {
  createLongStructureMutationBuilder,
  type LongOrderDirection,
  type LongStructureMutationBuilder
} from "../types/longStructureMutations";
import {
  isLongMigrationEvidenceCategoryId,
  type LongStructureMutationCompletion,
  type LongWorldbuildingSyncCompletion,
  type LongWorldbuildingSyncPreparedChange,
  type LongWorldbuildingSyncRequest
} from "../types/longWorkspace";
import type { LongWorldbuildingSyncBookOption } from "../utils/longWorldbuildingSync";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";
import LongImpactConfirmationDetails from "./LongImpactConfirmationDetails.vue";
import LongStructureDeleteDialog from "./LongStructureDeleteDialog.vue";
import LongWorldbuildingSyncDialog from "./LongWorldbuildingSyncDialog.vue";

type StructurePanel = "foundation" | "features" | "agents";
type FoundationSection = "worldbuilding" | "characterTypes";

type ManagerRow = LongStructureDeleteRow;

interface StructureDraft {
  id: string | null;
  title: string;
  format: LongWorldbuildingFormat;
}

const props = withDefaults(
  defineProps<{
    snapshot: LongWorkspaceIndexSnapshot;
    currentBookId?: string | null | undefined;
    agentsMd?: string | null | undefined;
    agentsMdPending?: boolean;
    syncBookOptions?: readonly LongWorldbuildingSyncBookOption[] | undefined;
    disabled?: boolean;
    previewError?: string | null;
  }>(),
  {
    currentBookId: null,
    agentsMd: null,
    agentsMdPending: false,
    syncBookOptions: () => [],
    disabled: false,
    previewError: null
  }
);

const emit = defineEmits<{
  previewMutation: [
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
  syncWorldbuilding: [
    payload: LongWorldbuildingSyncRequest,
    completion: LongWorldbuildingSyncCompletion
  ];
  saveAgentsMd: [content: string, completion: LongStructureMutationCompletion];
  modalActiveChange: [active: boolean];
}>();
const formatOptions: readonly PopupSelectOption[] = [
  { value: "list", label: "条目列表" },
  { value: "text", label: "连续文本" }
];
const worldbuildingItemLayoutOptions: readonly PopupSelectOption[] = [
  { value: "top-tabs", label: "上方横向标签" },
  { value: "right-list", label: "右侧纵向列表" },
  { value: "left-tree", label: "左侧树形结构" }
];

const panelOptions: ReadonlyArray<{
  value: StructurePanel;
  label: string;
  description: string;
}> = [
  {
    value: "agents",
    label: "长篇上下文",
    description: "五阶段作用说明"
  },
  {
    value: "foundation",
    label: "基础结构",
    description: "世界观分类"
  },
  {
    value: "features",
    label: "功能配置",
    description: "世界观条目样式"
  }
];

const activePanel = ref<StructurePanel>("foundation");
const activeFoundationSection = ref<FoundationSection>("worldbuilding");
const agentsMdDraft = ref(props.agentsMd ?? "");
const formOpen = ref(false);
const formMode = ref<"create" | "edit">("create");
const syncOpen = ref(false);
const selectedSyncBookId = ref<string>("");
const syncPreparedChange = ref<LongWorldbuildingSyncPreparedChange | null>(
  null
);
type MutationSurface = "form" | "sync" | "background" | "agents";
const pendingMutation = ref<{
  id: number;
  surface: MutationSurface;
} | null>(null);
let mutationClock = 0;
const {
  pendingDelete,
  moveCharactersToTypeId,
  characterTypeDeleteMode,
  submitting: deleteSubmitting,
  deletingCharacterCount,
  deletingLastCharacterType,
  characterTypeMoveOptions,
  pendingWorldbuildingDeleteDescription,
  openDelete,
  closeDelete,
  setMoveCharactersToTypeId,
  setCharacterTypeDeleteMode,
  confirmDelete
} = useLongStructureDeleteConfirmation({
  snapshot: computed(() => props.snapshot),
  locked: () => props.disabled || pendingMutation.value !== null,
  preview: (batch, completion) => emit("previewMutation", batch, completion),
  mutate: (batch, completion) => emit("mutation", batch, completion),
  notify: uiMessage
});
const mutationLocked = computed(
  () =>
    props.disabled || pendingMutation.value !== null || deleteSubmitting.value
);
const activeModal = computed<"form" | "sync" | "delete" | null>(() =>
  formOpen.value
    ? "form"
    : syncOpen.value
      ? "sync"
      : pendingDelete.value
        ? "delete"
        : null
);

const syncBookSelectOptions = computed<PopupSelectOption[]>(() =>
  props.syncBookOptions
    .filter((book) => book.id !== props.currentBookId)
    .map((book) => ({
      value: book.id,
      label:
        book.categoryCount > 0
          ? `${book.title}（${book.categoryCount} 个分类）`
          : book.title
    }))
);

const selectedSyncBook = computed(
  () =>
    props.syncBookOptions.find(
      (book) => book.id === selectedSyncBookId.value
    ) ?? null
);
function emptyDraft(): StructureDraft {
  return {
    id: null,
    title: "",
    format: "text"
  };
}

const draft = reactive<StructureDraft>(emptyDraft());
const {
  pendingFormImpact,
  clearPendingFormImpact,
  capturePendingFormImpact,
  confirmedFormBatch
} = useLongStructureFormImpact({
  fields: () => [draft.title, draft.format] as const,
  mutationPending: () => pendingMutation.value !== null
});

const worldbuildingRows = computed<ManagerRow[]>(() =>
  [...props.snapshot.worldbuilding]
    .sort((left, right) => left.order - right.order)
    .map((category) => ({
      kind: "worldbuilding" as const,
      id: category.id,
      title: category.title,
      detail: category.format === "list" ? "条目列表" : "连续文本",
      readOnly: isLongMigrationEvidenceCategoryId(category.id)
    }))
);

const characterTypeRows = computed<ManagerRow[]>(() =>
  [...props.snapshot.characterTypes]
    .sort((left, right) => left.order - right.order)
    .map((characterType) => {
      const count = props.snapshot.characters.filter(
        ({ group }) => group === characterType.id
      ).length;
      return {
        kind: "characterType" as const,
        id: characterType.id,
        title: characterType.title,
        detail: `连续文本 · ${count} 人`
      };
    })
);
const rows = computed(() =>
  activeFoundationSection.value === "worldbuilding"
    ? worldbuildingRows.value
    : characterTypeRows.value
);
const formTitle = computed(() =>
  activeFoundationSection.value === "characterTypes"
    ? formMode.value === "create"
      ? "新建人物类型"
      : "编辑人物类型"
    : formMode.value === "create"
      ? "新建世界观分类"
      : "编辑世界观分类"
);

watch(
  () => props.previewError,
  (message) => {
    if (message) {
      uiMessage.warning(message);
    }
  }
);

watch(
  () => activeModal.value !== null,
  (active) => emit("modalActiveChange", active),
  { immediate: true }
);

watch(
  () => props.agentsMd,
  (content) => {
    if (pendingMutation.value?.surface === "agents") return;
    agentsMdDraft.value = content ?? "";
  }
);

const agentsMdDirty = computed(
  () => agentsMdDraft.value !== (props.agentsMd ?? "")
);
const agentsMdCharacterCount = computed(
  () => Array.from(agentsMdDraft.value).length
);
const agentsMdOverLimit = computed(
  () => agentsMdCharacterCount.value > LONG_AGENTS_MD_MAX_CHARACTERS
);

function setPanel(panel: StructurePanel): void {
  if (panel === activePanel.value || mutationLocked.value) return;
  void (async () => {
    if (!(await flushAgentsMdIfNeeded())) return;
    closeForm();
    closeDelete();
    closeSync();
    activePanel.value = panel;
  })();
}

function setFoundationSection(section: FoundationSection): void {
  if (section === activeFoundationSection.value || mutationLocked.value) return;
  closeForm();
  closeDelete();
  closeSync();
  activeFoundationSection.value = section;
}

function setFormat(value: PopupSelectValue): void {
  if (value === "list" || value === "text") {
    draft.format = value;
  }
}

function setWorldbuildingItemLayout(value: PopupSelectValue): void {
  if (
    (value !== "top-tabs" && value !== "right-list" && value !== "left-tree") ||
    value === props.snapshot.featureSettings.worldbuildingItemLayout
  ) {
    return;
  }
  emitMutation((builder) =>
    builder.updateFeatureSettings({
      worldbuildingItemLayout: value as LongWorldbuildingItemLayout
    })
  );
}

function setCharacterAndContinuityItemLayout(value: PopupSelectValue): void {
  if (
    (value !== "top-tabs" && value !== "right-list" && value !== "left-tree") ||
    value === props.snapshot.featureSettings.characterAndContinuityItemLayout
  ) {
    return;
  }
  emitMutation((builder) =>
    builder.updateFeatureSettings({
      characterAndContinuityItemLayout: value as LongWorldbuildingItemLayout
    })
  );
}

function setPlotItemLayout(value: PopupSelectValue): void {
  if (
    (value !== "top-tabs" && value !== "right-list" && value !== "left-tree") ||
    value === props.snapshot.featureSettings.plotItemLayout
  ) {
    return;
  }
  emitMutation((builder) =>
    builder.updateFeatureSettings({
      plotItemLayout: value as LongWorldbuildingItemLayout
    })
  );
}

function resetDraft(): void {
  Object.assign(draft, emptyDraft());
}

function openCreate(): void {
  resetDraft();
  clearPendingFormImpact();
  formMode.value = "create";
  formOpen.value = true;
}

function openEdit(row: ManagerRow): void {
  if (row.readOnly) {
    uiMessage.info("迁移证据是只读资料，不能改名、改格式或删除。");
    return;
  }
  resetDraft();
  clearPendingFormImpact();
  formMode.value = "edit";
  if (row.kind === "characterType") {
    const characterType = props.snapshot.characterTypes.find(
      (candidate) => candidate.id === row.id
    );
    if (!characterType) return;
    draft.id = characterType.id;
    draft.title = characterType.title;
    draft.format = "text";
  } else {
    const category = props.snapshot.worldbuilding.find(
      (candidate) => candidate.id === row.id
    );
    if (!category) return;
    draft.id = category.id;
    draft.title = category.title;
    draft.format = category.format;
  }
  formOpen.value = true;
}

function closeForm(): void {
  if (mutationLocked.value) return;
  formOpen.value = false;
  clearPendingFormImpact();
}

function finishMutation(
  requestId: number,
  outcome: "succeeded" | "failed" | "applied-refresh-failed"
): void {
  const pending = pendingMutation.value;
  if (!pending || pending.id !== requestId) return;
  pendingMutation.value = null;
  if (outcome === "failed") return;
  if (pending.surface === "form") {
    formOpen.value = false;
    clearPendingFormImpact();
  } else if (pending.surface === "sync") {
    syncOpen.value = false;
    selectedSyncBookId.value = "";
    syncPreparedChange.value = null;
  }
}

function openSync(): void {
  if (mutationLocked.value) return;
  if (!syncBookSelectOptions.value.length) {
    uiMessage.warning("当前没有其他可同步的长篇书籍。");
    return;
  }
  selectedSyncBookId.value = String(
    syncBookSelectOptions.value[0]?.value ?? ""
  );
  syncPreparedChange.value = null;
  syncOpen.value = true;
}

function closeSync(): void {
  if (mutationLocked.value) return;
  syncOpen.value = false;
  selectedSyncBookId.value = "";
  syncPreparedChange.value = null;
}

function setSyncBook(value: PopupSelectValue): void {
  selectedSyncBookId.value = typeof value === "string" ? value : "";
  syncPreparedChange.value = null;
}

function confirmSync(): void {
  if (mutationLocked.value) return;
  const source = selectedSyncBook.value;
  if (!source) {
    uiMessage.warning("请选择要同步的长篇书籍。");
    return;
  }
  if (source.categoryCount <= 0) {
    uiMessage.warning("所选长篇没有可同步的世界观分类。");
    return;
  }
  const prepared = syncPreparedChange.value;
  const requestId = ++mutationClock;
  pendingMutation.value = { id: requestId, surface: "sync" };
  emit(
    "syncWorldbuilding",
    {
      sourceBookId: source.id,
      sourceTitle: source.title,
      ...(prepared ? { prepared } : {})
    },
    {
      succeed: () => finishMutation(requestId, "succeeded"),
      fail: (_message, changedImpact) => {
        finishMutation(requestId, "failed");
        if (!changedImpact || !prepared) return;
        syncPreparedChange.value = {
          ...prepared,
          confirmation: changedImpact
        };
      },
      appliedButRefreshFailed: () =>
        finishMutation(requestId, "applied-refresh-failed"),
      review: (nextPrepared) => {
        const pending = pendingMutation.value;
        if (!pending || pending.id !== requestId) return;
        pendingMutation.value = null;
        syncPreparedChange.value = nextPrepared;
      }
    }
  );
}

function emitMutation(
  build: (builder: LongStructureMutationBuilder) => LongWorkspaceOperationBatch,
  surface: MutationSurface = "background"
): boolean {
  if (mutationLocked.value) return false;
  try {
    const batch = build(createLongStructureMutationBuilder(props.snapshot));
    return applyMutationBatch(batch, surface);
  } catch (error) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法生成长篇结构变更。"
    );
    return false;
  }
}

function applyMutationBatch(
  batch: LongWorkspaceOperationBatch,
  surface: MutationSurface
): boolean {
  if (mutationLocked.value) return false;
  const requestId = ++mutationClock;
  pendingMutation.value = { id: requestId, surface };
  emit("mutation", batch, {
    succeed: () => finishMutation(requestId, "succeeded"),
    fail: (_message, changedImpact) => {
      finishMutation(requestId, "failed");
      if (surface === "form" && changedImpact) {
        capturePendingFormImpact(batch, changedImpact);
      }
    },
    appliedButRefreshFailed: () =>
      finishMutation(requestId, "applied-refresh-failed")
  });
  return true;
}

function submitForm(): void {
  const title = draft.title.trim();
  if (!title) {
    uiMessage.warning("请输入标题。");
    return;
  }

  const confirmed = confirmedFormBatch();
  if (confirmed) {
    applyMutationBatch(confirmed, "form");
    return;
  }

  emitMutation((builder) => {
    if (activeFoundationSection.value === "characterTypes") {
      if (formMode.value === "create") {
        return builder.createCharacterType({ title });
      }
      if (!draft.id) throw new Error("缺少待编辑人物类型的稳定 ID。");
      return builder.updateCharacterType(draft.id, { title });
    }
    if (formMode.value === "create") {
      return builder.createWorldbuilding({
        title,
        format: draft.format
      });
    }
    if (!draft.id) {
      throw new Error("缺少待编辑条目的稳定 ID。");
    }
    return builder.updateWorldbuilding(draft.id, {
      title,
      format: draft.format
    });
  }, "form");
}

function canMove(row: ManagerRow, direction: LongOrderDirection): boolean {
  if (row.readOnly) return false;
  const index = rows.value.findIndex((candidate) => candidate.id === row.id);
  return direction === "up"
    ? index > 0
    : index >= 0 && index < rows.value.length - 1;
}

function reorder(row: ManagerRow, direction: LongOrderDirection): void {
  if (row.readOnly) {
    uiMessage.info("迁移证据保持稳定顺序，不能重排。");
    return;
  }
  emitMutation((builder) =>
    row.kind === "characterType"
      ? builder.reorderCharacterType(row.id, direction)
      : builder.reorderWorldbuilding(row.id, direction)
  );
}

function saveAgentsMd(): boolean {
  if (mutationLocked.value || props.agentsMdPending) return false;
  if (agentsMdOverLimit.value) {
    uiMessage.warning(
      `长篇上下文不能超过 ${LONG_AGENTS_MD_MAX_CHARACTERS} 个字符。`
    );
    return false;
  }
  const requestId = ++mutationClock;
  pendingMutation.value = { id: requestId, surface: "agents" };
  emit("saveAgentsMd", agentsMdDraft.value, {
    succeed: () => {
      finishMutation(requestId, "succeeded");
      uiMessage.success("已保存长篇上下文。");
    },
    fail: () => finishMutation(requestId, "failed"),
    appliedButRefreshFailed: () =>
      finishMutation(requestId, "applied-refresh-failed")
  });
  return true;
}

function flushAgentsMdIfNeeded(): Promise<boolean> {
  if (!agentsMdDirty.value || activePanel.value !== "agents") {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    if (mutationLocked.value || props.agentsMdPending) {
      resolve(false);
      return;
    }
    if (agentsMdOverLimit.value) {
      uiMessage.warning(
        `长篇上下文不能超过 ${LONG_AGENTS_MD_MAX_CHARACTERS} 个字符。`
      );
      resolve(false);
      return;
    }
    const requestId = ++mutationClock;
    pendingMutation.value = { id: requestId, surface: "agents" };
    emit("saveAgentsMd", agentsMdDraft.value, {
      succeed: () => {
        finishMutation(requestId, "succeeded");
        resolve(true);
      },
      fail: () => {
        finishMutation(requestId, "failed");
        resolve(false);
      },
      appliedButRefreshFailed: () => {
        finishMutation(requestId, "applied-refresh-failed");
        resolve(true);
      }
    });
  });
}

defineExpose({
  flushAgentsMdIfNeeded
});
</script>

<template>
  <section class="long-structure-manager" aria-label="结构管理">
    <header class="manager-header">
      <div>
        <p class="manager-eyebrow">LONG-FORM STRUCTURE</p>
        <h2>结构管理</h2>
        <p>
          在这里管理世界观分类、人物类型、功能配置和长篇上下文；具体内容请在对应工作区编辑。
        </p>
      </div>
    </header>

    <div class="structure-panel-tabs" role="tablist" aria-label="结构管理分区">
      <button
        v-for="panel in panelOptions"
        :id="`long-structure-panel-${panel.value}`"
        :key="panel.value"
        class="structure-panel-tab"
        type="button"
        role="tab"
        :aria-selected="activePanel === panel.value"
        :aria-controls="`long-structure-panel-content-${panel.value}`"
        :disabled="mutationLocked"
        @click="setPanel(panel.value)"
      >
        <strong>{{ panel.label }}</strong>
        <span>{{ panel.description }}</span>
      </button>
    </div>

    <div
      v-if="activePanel === 'foundation'"
      id="long-structure-panel-content-foundation"
      class="structure-panel-content"
      role="tabpanel"
      aria-labelledby="long-structure-panel-foundation"
    >
      <header class="manager-toolbar">
        <div class="section-tabs" role="tablist" aria-label="基础结构类型">
          <button
            id="long-structure-section-worldbuilding"
            type="button"
            role="tab"
            :aria-selected="activeFoundationSection === 'worldbuilding'"
            :disabled="mutationLocked"
            @click="setFoundationSection('worldbuilding')"
          >
            世界观分类
          </button>
          <button
            id="long-structure-section-character-types"
            type="button"
            role="tab"
            :aria-selected="activeFoundationSection === 'characterTypes'"
            :disabled="mutationLocked"
            @click="setFoundationSection('characterTypes')"
          >
            人物类型
          </button>
        </div>
        <div class="toolbar-actions">
          <button
            v-if="activeFoundationSection === 'worldbuilding'"
            type="button"
            :disabled="mutationLocked"
            @click="openSync"
          >
            加载其他书籍世界观
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="mutationLocked"
            @click="openCreate"
          >
            {{
              activeFoundationSection === "characterTypes"
                ? "新建人物类型"
                : "新建世界观分类"
            }}
          </button>
        </div>
      </header>

      <div v-if="rows.length === 0" class="manager-empty">
        <strong>
          {{
            activeFoundationSection === "characterTypes"
              ? "还没有人物类型，可先创建第一项。"
              : "还没有世界观分类，可先创建第一项。"
          }}
        </strong>
        <span>
          {{
            activeFoundationSection === "characterTypes"
              ? "人物类型只管理分类，人物内容始终使用连续文本。"
              : "创建后会生成完整稳定 ID，并带齐对应的空文件引用。"
          }}
        </span>
      </div>

      <ol v-else class="manager-list">
        <li v-for="row in rows" :key="row.id" class="manager-row">
          <div class="row-copy">
            <strong>{{ row.title }}</strong>
            <span>
              {{ row.detail }}{{ row.readOnly ? " · 迁移证据只读" : "" }}
            </span>
            <code>{{ row.id }}</code>
          </div>
          <div class="row-actions">
            <button
              type="button"
              :aria-label="`上移${row.title}`"
              title="上移"
              :disabled="mutationLocked || !canMove(row, 'up')"
              @click="reorder(row, 'up')"
            >
              ↑
            </button>
            <button
              type="button"
              :aria-label="`下移${row.title}`"
              title="下移"
              :disabled="mutationLocked || !canMove(row, 'down')"
              @click="reorder(row, 'down')"
            >
              ↓
            </button>
            <button
              type="button"
              :aria-label="`编辑${row.title}`"
              :disabled="mutationLocked || row.readOnly"
              @click="openEdit(row)"
            >
              编辑
            </button>
            <button
              class="delete-button"
              type="button"
              :aria-label="`删除${row.title}`"
              :disabled="mutationLocked || row.readOnly"
              @click="openDelete(row)"
            >
              删除
            </button>
          </div>
        </li>
      </ol>

      <p class="manager-footnote">
        {{
          activeFoundationSection === "characterTypes"
            ? "排序只调整人物类型的展示顺序；人物仍保留核心档案和人物关系两份文本文档。"
            : "排序只调整世界观分类的展示顺序，不会改动分类中的现有内容。"
        }}
      </p>
    </div>

    <div
      v-else-if="activePanel === 'features'"
      id="long-structure-panel-content-features"
      class="structure-panel-content"
      role="tabpanel"
      aria-labelledby="long-structure-panel-features"
    >
      <div class="feature-settings-list">
        <section class="feature-setting-card">
          <div class="feature-setting-copy">
            <strong>世界观条目样式</strong>
            <span>
              选择列表型世界观分类中的概览与条目如何排列。
              左侧树形结构会把概览与条目放到世界观分类下方。
            </span>
          </div>
          <PopupSelect
            :model-value="snapshot.featureSettings.worldbuildingItemLayout"
            :options="worldbuildingItemLayoutOptions"
            accessible-label="选择世界观条目样式"
            :disabled="mutationLocked"
            :menu-z-index="2300"
            @update:model-value="setWorldbuildingItemLayout"
          />
        </section>
        <section class="feature-setting-card">
          <div class="feature-setting-copy">
            <strong>人物与连续性条目样式</strong>
            <span>
              统一选择人物集合与连续性账本文件的排列方式。
              左侧树形结构会把人物与账本文件放到对应标题下方。
            </span>
          </div>
          <PopupSelect
            :model-value="
              snapshot.featureSettings.characterAndContinuityItemLayout
            "
            :options="worldbuildingItemLayoutOptions"
            accessible-label="选择人物与连续性条目样式"
            :disabled="mutationLocked"
            :menu-z-index="2300"
            @update:model-value="setCharacterAndContinuityItemLayout"
          />
        </section>
        <section class="feature-setting-card">
          <div class="feature-setting-copy">
            <strong>剧情设计条目样式</strong>
            <span>
              选择全书故事线、剧情点和章卡集合的排列方式；左侧树形结构不会改变故事情节面板。
            </span>
          </div>
          <PopupSelect
            :model-value="snapshot.featureSettings.plotItemLayout"
            :options="worldbuildingItemLayoutOptions"
            accessible-label="选择剧情设计条目样式"
            :disabled="mutationLocked"
            :menu-z-index="2300"
            @update:model-value="setPlotItemLayout"
          />
        </section>
      </div>
    </div>

    <div
      v-else
      id="long-structure-panel-content-agents"
      class="structure-panel-content agents-panel-content"
      role="tabpanel"
      aria-labelledby="long-structure-panel-agents"
    >
      <section class="agents-context-card">
        <div class="section-heading">
          <div>
            <h3>长篇上下文</h3>
            <p>
              介绍世界观、人物、剧情点、正文和持续性账本五个阶段的作用。
              对话时会注入给当前智能体；内容保存在本书目录的 AGENTS.md。
            </p>
          </div>
          <span
            >{{ agentsMdCharacterCount }} /
            {{ LONG_AGENTS_MD_MAX_CHARACTERS }} 字符</span
          >
        </div>
        <textarea
          v-model="agentsMdDraft"
          :disabled="mutationLocked || agentsMdPending"
          spellcheck="false"
          aria-label="长篇上下文"
          placeholder="介绍五个阶段各自负责什么…"
        />
        <footer class="agents-context-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="
              mutationLocked ||
              agentsMdPending ||
              !agentsMdDirty ||
              agentsMdOverLimit
            "
            @click="saveAgentsMd"
          >
            {{ pendingMutation?.surface === "agents" ? "保存中…" : "保存" }}
          </button>
        </footer>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="activeModal === 'form'"
        class="dialog-backdrop structure-modal-overlay"
        @mousedown.self="closeForm"
        @keydown.esc.stop="closeForm"
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
                :disabled="mutationLocked"
                @click="closeForm"
              >
                ×
              </button>
            </header>

            <fieldset class="modal-body" :disabled="mutationLocked">
              <label class="form-field">
                <span>标题</span>
                <input
                  v-model="draft.title"
                  maxlength="256"
                  autocomplete="off"
                  autofocus
                  required
                />
              </label>

              <label
                v-if="activeFoundationSection === 'worldbuilding'"
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
              <LongImpactConfirmationDetails
                v-if="pendingFormImpact"
                :confirmation="pendingFormImpact.confirmation"
                fallback="格式转换不会删除现有从属内容。"
              />
            </fieldset>

            <footer class="modal-actions">
              <button
                type="button"
                :disabled="mutationLocked"
                @click="closeForm"
              >
                取消
              </button>
              <button
                class="primary-button"
                type="submit"
                :disabled="mutationLocked"
              >
                {{
                  pendingMutation?.surface === "form"
                    ? "保存中…"
                    : pendingFormImpact
                      ? "确认按上述影响转换并保存"
                      : formMode === "create"
                        ? "创建"
                        : "保存修改"
                }}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Teleport>

    <LongWorldbuildingSyncDialog
      :open="activeModal === 'sync'"
      :current-book-id="currentBookId"
      :selected-book-id="selectedSyncBookId"
      :book-options="syncBookOptions"
      :prepared="syncPreparedChange"
      :locked="mutationLocked"
      :pending="pendingMutation?.surface === 'sync'"
      @close="closeSync"
      @confirm="confirmSync"
      @update:selected-book-id="setSyncBook"
    />

    <LongStructureDeleteDialog
      :open="activeModal === 'delete'"
      :target="pendingDelete"
      :locked="mutationLocked"
      :pending="deleteSubmitting"
      :worldbuilding-fallback="pendingWorldbuildingDeleteDescription"
      :character-count="deletingCharacterCount"
      :last-character-type="deletingLastCharacterType"
      :character-delete-mode="characterTypeDeleteMode"
      :move-target-id="moveCharactersToTypeId"
      :move-options="characterTypeMoveOptions"
      @close="closeDelete"
      @confirm="confirmDelete"
      @update:character-delete-mode="setCharacterTypeDeleteMode"
      @update:move-target-id="setMoveCharactersToTypeId"
    />
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

.structure-panel-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
  padding: 0.3rem;
  border: 1px solid var(--theme-line-soft);
  border-radius: 0.75rem;
  background: var(--surface-muted);
}

.structure-panel-tab {
  display: grid;
  min-width: 0;
  min-height: 3.5rem;
  gap: 0.16rem;
  padding: 0.62rem 0.75rem;
  border-color: transparent;
  text-align: left;
  background: transparent;
}

.structure-panel-tab strong {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.structure-panel-tab span {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.structure-panel-tab[aria-selected="true"] {
  border-color: var(--theme-line);
  background: var(--surface-raised);
  box-shadow: 0 0.1rem 0.35rem
    color-mix(in srgb, var(--text-primary) 7%, transparent);
}

.structure-panel-tab[aria-selected="true"] strong {
  color: var(--accent);
}

.structure-panel-content {
  display: grid;
  min-width: 0;
  gap: 0.85rem;
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
.toolbar-actions,
.row-actions,
.modal-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.manager-toolbar {
  justify-content: space-between;
}

.toolbar-actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.section-tabs {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  padding: 0.18rem;
  border: 1px solid var(--theme-line-soft);
  border-radius: 0.65rem;
  background: var(--surface-muted);
}

.section-tabs button {
  flex: 0 0 auto;
  min-height: 1.9rem;
  padding: 0.34rem 0.58rem;
  border-color: transparent;
  color: var(--text-secondary);
  background: transparent;
  white-space: nowrap;
}

.section-tabs button[aria-selected="true"] {
  border-color: var(--theme-line);
  color: var(--accent);
  background: var(--surface-raised);
}

button,
input {
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
input:focus-visible {
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
  border-color: color-mix(
    in srgb,
    var(--neutral-solid) 86%,
    var(--text-primary)
  );
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

.row-copy code {
  color: var(--text-tertiary);
  font:
    0.72rem/1.4 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
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

.feature-settings-list {
  display: grid;
  gap: 0.65rem;
}

.feature-setting-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(12rem, 16rem);
  align-items: center;
  gap: 1rem;
  padding: 0.9rem;
  border: 1px solid var(--theme-line-soft);
  border-radius: 0.75rem;
  background: var(--surface-raised);
}

.feature-setting-copy {
  display: grid;
  min-width: 0;
  gap: 0.3rem;
}

.feature-setting-copy span {
  color: var(--text-tertiary);
  font-size: 0.8rem;
  line-height: 1.5;
}

.agents-panel-content {
  min-height: 22rem;
}

.agents-context-card {
  display: grid;
  grid-template-rows: auto minmax(16rem, 1fr) auto;
  min-height: 22rem;
  gap: 0.75rem;
  padding: 0.9rem;
  border: 1px solid var(--theme-line-soft);
  border-radius: 0.75rem;
  background: var(--surface-raised);
}

.agents-context-card .section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.agents-context-card h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.agents-context-card p,
.agents-context-card span {
  margin: 0.25rem 0 0;
  color: var(--text-tertiary);
  font-size: 0.8rem;
  line-height: 1.5;
}

.agents-context-card textarea {
  box-sizing: border-box;
  min-height: 16rem;
  width: 100%;
  resize: vertical;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.65rem;
  background: var(--surface-main);
  color: var(--text-primary);
  font: 0.9rem/1.55 inherit;
}

.agents-context-card textarea:focus {
  outline: 2px solid var(--accent-soft);
  outline-offset: 1px;
}

.agents-context-card textarea:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.agents-context-actions {
  display: flex;
  justify-content: flex-end;
}

.structure-modal-overlay {
  z-index: 2200;
  overflow: auto;
  padding: 1rem;
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
  min-inline-size: 0;
  gap: 0.85rem;
  margin: 0;
  padding: 1rem;
  border: 0;
}

.form-field {
  display: grid;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.form-field input {
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

.modal-actions {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

@media (max-width: 42rem) {
  .manager-toolbar,
  .manager-header,
  .manager-row {
    align-items: stretch;
  }

  .manager-toolbar .toolbar-actions,
  .manager-toolbar .primary-button {
    flex: 0 0 auto;
  }

  .toolbar-actions {
    width: 100%;
  }

  .toolbar-actions button {
    flex: 1 1 auto;
  }

  .manager-header,
  .manager-row {
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

  .feature-setting-card {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
}
</style>
