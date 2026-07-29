<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  LongFileRevisionSchema,
  LongLedgerCommitRecordSchema,
  parseLongWorldbuildingMarkdownList,
  serializeLongWorldbuildingMarkdownList,
  type LongLedgerCommitRecord,
  type LongLedgerCommitIndexEntry,
  type LongArcId,
  type LongChapterCardId,
  type LongCharacterId,
  type LongFileId,
  type LongFileRevision,
  type LongReadDocumentResult,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperationBatch,
  type LongWorldbuildingMarkdownItem,
  type LongWorkspaceFileReference,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { uiMessage } from "../ui-feedback";
import {
  isEditableLongFile,
  resolveLongWorkspaceApi,
  type LongStructureMutationCompletion,
  type LongWorkspaceFileRole,
  type LongWorkspaceSelection,
  type LongWorkspaceSelectionFile
} from "../types/longWorkspace";
import AppIcon from "./AppIcon.vue";
import LongForeshadowingWorkspace from "./LongForeshadowingWorkspace.vue";

const props = defineProps<{
  bookId: string;
  selection: LongWorkspaceSelection | null;
  workspaceIndex: LongWorkspaceIndexSnapshot | null;
  latestCommit?: LongLedgerCommitIndexEntry | undefined;
  locked?: boolean;
  lockedReason?: string | undefined;
}>();

const emit = defineEmits<{
  collapse: [];
  saved: [result: LongWriteDocumentResult];
  contextChange: [
    context: {
      bookId: string;
      fileId: LongFileId;
      fileRevision: LongFileRevision;
    } | null
  ];
  rollback: [];
  selectCharacter: [characterId: LongCharacterId];
  selectPlotPoint: [plotPointId: LongArcId];
  selectChapterCard: [chapterCardId: LongChapterCardId];
  renameCharacter: [
    input: { characterId: LongCharacterId; name: string },
    completion: (succeeded: boolean) => void
  ];
  renameStructureTitle: [
    input: {
      kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (succeeded: boolean) => void
  ];
  createCharacter: [];
  createPlotPoint: [];
  createChapterCard: [];
  createVolume: [];
  saveVolumeOutline: [
    input: { volumeId: string; outline: string },
    completion: (succeeded: boolean) => void
  ];
  savePlotPointContent: [
    input: {
      plotPointId: LongArcId;
      field: "summary" | "storyline";
      content: string;
    },
    completion: (succeeded: boolean) => void
  ];
  saveChapterCardContent: [
    input: {
      chapterCardId: LongChapterCardId;
      field: "outline" | "worldConstraints";
      content: string;
    },
      completion: (succeeded: boolean) => void
    ];
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
}>();

interface LongDocumentState {
  bookId: string;
  file: LongWorkspaceFileReference;
  content: string;
  savedContent: string;
  workspaceRevision: number;
  projectRevision: number;
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  loadError: string | null;
}

interface LongVolumeOutlineDraft {
  content: string;
  savedContent: string;
  saving: boolean;
}

interface LongStructureTitleTarget {
  kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
  id: string;
  title: string;
  inputLabel: string;
  emptyMessage: string;
}

const DOCUMENT_PAGE_CHARACTERS = 256 * 1024;
const RECOVERY_STORAGE_PREFIX = "deepwrite:long-editor-recovery:v1:";
const RECOVERY_WRITE_DEBOUNCE_MS = 300;
const RECOVERY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_MAX_RECORD_CHARACTERS = 4 * 1024 * 1024;
const RECOVERY_CLOCK_SKEW_MS = 5 * 60 * 1000;

interface LongEditorRecoveryRecord {
  schemaVersion: 1;
  bookId: string;
  fileId: LongFileId;
  filePath: string;
  content: string;
  savedContent: string;
  baseRevision: LongFileRevision;
  workspaceRevision: number;
  projectRevision: number;
  timestamp: number;
}

const documentStates = ref<Record<string, LongDocumentState>>({});
const staleRecoveryByKey = ref<Record<string, LongEditorRecoveryRecord>>({});
const activeRole = ref<LongWorkspaceFileRole>("content");
const activeWorldbuildingItemId = ref<string | null>(null);
const activeBookLineVolumeId = ref<string | null>(null);
const activeBookLineContentTab = ref<"outline" | "foreshadowing">(
  "outline"
);
const activePlotPointTab = ref<
  "summary" | "storyline" | "foreshadowing"
>("summary");
const activeChapterCardTab = ref<"outline" | "worldConstraints">("outline");
const volumeOutlineDrafts = ref<Record<string, LongVolumeOutlineDraft>>({});
const plotPointSummaryDrafts = ref<Record<string, LongVolumeOutlineDraft>>({});
const plotPointStorylineDrafts = ref<
  Record<string, LongVolumeOutlineDraft>
>({});
const chapterCardOutlineDrafts = ref<
  Record<string, LongVolumeOutlineDraft>
>({});
const chapterCardWorldConstraintDrafts = ref<
  Record<string, LongVolumeOutlineDraft>
>({});
const pendingWorldbuildingDeleteId = ref<string | null>(null);
const characterNameDraft = ref("");
const characterNameSaving = ref(false);
const structureTitleDraft = ref("");
const structureTitleSaving = ref(false);
const worldbuildingDeleteDialog = ref<HTMLElement>();
const worldbuildingDeleteCancelButton = ref<HTMLButtonElement>();
const workspaceSavePending = ref(false);
const editorInput = ref<HTMLTextAreaElement>();
const editorToolsElement = ref<HTMLElement>();
const findPanelElement = ref<HTMLElement>();
const findInput = ref<HTMLInputElement>();
const viewMode = ref<"edit" | "preview">("edit");
const findPanelOpen = ref(false);
const findPanelMode = ref<"find" | "replace">("find");
const searchQuery = ref("");
const replacementText = ref("");
const currentMatchIndex = ref(-1);
const searchAnchor = ref(0);
const undoHistory = ref<LongEditorHistorySnapshot[]>([]);
const redoHistory = ref<LongEditorHistorySnapshot[]>([]);
const requestClockByFile = new Map<string, number>();
const recoveryWriteTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
const recoveryWriteWarningKeys = new Set<string>();
let requestClock = 0;
let activeSavePromise: Promise<boolean> | null = null;
let worldbuildingDeletePreviousFocus: HTMLElement | null = null;
let volumeDraftBookId = "";
const HISTORY_LIMIT = 120;

interface LongEditorHistorySnapshot {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

interface LongEditorSearchMatch {
  start: number;
  end: number;
}

const currentSelectionFile = computed<LongWorkspaceSelectionFile | undefined>(
  () => {
    const selection = props.selection;
    if (!selection) return undefined;
    return (
      selection.files.find(({ role }) => role === activeRole.value) ??
      selection.files[0]
    );
  }
);

function stateKey(fileId: string, bookId = props.bookId): string {
  return `${bookId}\u0000${fileId}`;
}

const currentState = computed<LongDocumentState | undefined>(() => {
  const selectedFile = currentSelectionFile.value;
  return selectedFile
    ? documentStates.value[stateKey(selectedFile.file.id)]
    : undefined;
});
const currentIsBookLineWorkspace = computed(
  () =>
    props.selection?.key === "plot-design:book-line" &&
    props.selection.root === "plot_design"
);
const currentIsPlotPointWorkspace = computed(
  () =>
    props.selection?.key.startsWith("plot-design:plot-points:") &&
    props.selection.root === "plot_design"
);
const currentIsChapterCardWorkspace = computed(
  () =>
    props.selection?.key.startsWith("plot-design:chapter-cards:") &&
    props.selection.root === "plot_design"
);
const currentIsForeshadowingWorkspace = computed(
  () =>
    props.selection?.key === "plot-design:foreshadowing" &&
    props.selection.root === "plot_design"
);
const currentIsCharacterGroup = computed(
  () =>
    props.selection?.root === "character_design" &&
    Boolean(props.selection.characterGroup)
);
const currentIsCharacterDocument = computed(
  () =>
    props.selection?.root === "character_design" &&
    Boolean(props.selection.characterId)
);
const currentEmptyCollection = computed<{
  icon: "file" | "user";
  title: string;
  description: string;
  buttonLabel: string;
  action: "character" | "plotPoint" | "chapterCard";
} | null>(() => {
  const selection = props.selection;
  if (
    currentIsCharacterGroup.value &&
    selection?.characterTabs?.length === 0
  ) {
    return {
      icon: "user",
      title: `还没有${selection.title}`,
      description: "新建人物后，可通过上方 Tab 切换并编辑人物档案。",
      buttonLabel: "新建第一个人物",
      action: "character"
    };
  }
  if (
    currentIsPlotPointWorkspace.value &&
    selection?.plotPointTabs?.length === 0
  ) {
    return {
      icon: "file",
      title: "还没有剧情点",
      description: "新建剧情点后，可通过上方 Tab 切换并编辑内容。",
      buttonLabel: "新建第一个剧情点",
      action: "plotPoint"
    };
  }
  if (
    currentIsChapterCardWorkspace.value &&
    selection?.chapterCardTabs?.length === 0
  ) {
    return {
      icon: "file",
      title: "还没有章卡",
      description: "新建章卡后，可通过上方 Tab 切换并编辑内容。",
      buttonLabel: "新建第一张章卡",
      action: "chapterCard"
    };
  }
  return null;
});

function createFirstCollectionItem(): void {
  const action = currentEmptyCollection.value?.action;
  if (action === "character") {
    emit("createCharacter");
  } else if (action === "plotPoint") {
    emit("createPlotPoint");
  } else if (action === "chapterCard") {
    emit("createChapterCard");
  }
}
const currentStructureTitleTarget = computed<LongStructureTitleTarget | null>(
  () => {
    if (currentIsPlotPointWorkspace.value && currentPlotPoint.value) {
      return {
        kind: "plotPoint",
        id: currentPlotPoint.value.id,
        title: currentPlotPoint.value.title,
        inputLabel: "剧情点标题",
        emptyMessage: "剧情点标题不能为空。"
      };
    }
    if (currentIsVolumeOutline.value && currentBookLineVolume.value) {
      return {
        kind: "volume",
        id: currentBookLineVolume.value.id,
        title: currentBookLineVolume.value.title,
        inputLabel: "分卷名称",
        emptyMessage: "分卷名称不能为空。"
      };
    }
    if (
      (currentIsChapterCardWorkspace.value ||
        props.selection?.root === "draft") &&
      props.selection?.chapterCardId
    ) {
      const chapter = props.workspaceIndex?.plot.chapterCards.find(
        ({ id }) => id === props.selection?.chapterCardId
      );
      if (chapter) {
        return {
          kind: "chapterCard",
          id: chapter.id,
          title: chapter.title,
          inputLabel: "章卡标题",
          emptyMessage: "章卡标题不能为空。"
        };
      }
    }
    if (
      props.selection?.root === "worldbuilding" &&
      props.selection.key.startsWith("worldbuilding:")
    ) {
      const categoryId = props.selection.key.slice("worldbuilding:".length);
      const category = props.workspaceIndex?.worldbuilding.find(
        ({ id }) => id === categoryId
      );
      if (category) {
        return {
          kind: "worldbuilding",
          id: category.id,
          title: category.title,
          inputLabel: "世界观分类名称",
          emptyMessage: "世界观分类名称不能为空。"
        };
      }
    }
    return null;
  }
);
const currentStructureTitleReadOnly = computed(() => {
  const target = currentStructureTitleTarget.value;
  if (!target) return true;
  if (
    target.kind === "chapterCard" &&
    props.workspaceIndex?.chapters.some(
      ({ chapterCardId, commitId }) =>
        chapterCardId === target.id && commitId !== null
    )
  ) {
    return true;
  }
  return Boolean(
    props.locked || currentReadOnly.value || structureTitleSaving.value
  );
});
const orderedBookLineVolumes = computed(() =>
  [...(props.workspaceIndex?.plot.volumes ?? [])].sort(
    (left, right) =>
      left.order - right.order || left.id.localeCompare(right.id)
  )
);
const currentBookLineVolume = computed(
  () =>
    orderedBookLineVolumes.value.find(
      ({ id }) => id === activeBookLineVolumeId.value
    ) ?? null
);
const currentPlotPoint = computed(
  () =>
    props.workspaceIndex?.plot.arcs.find(
      ({ id }) => id === props.selection?.plotPointId
    ) ?? null
);
const currentChapterCard = computed(
  () =>
    props.workspaceIndex?.plot.chapterCards.find(
      ({ id }) => id === props.selection?.chapterCardId
    ) ?? null
);
const currentVolumeOutlineDraft = computed(() => {
  const volumeId =
    currentIsBookLineWorkspace.value &&
    activeBookLineContentTab.value === "outline"
    ? currentBookLineVolume.value?.id
    : undefined;
  return volumeId ? volumeOutlineDrafts.value[volumeId] : undefined;
});
const currentPlotPointDraft = computed(() => {
  const plotPointId = currentPlotPoint.value?.id;
  if (!plotPointId || activePlotPointTab.value === "foreshadowing") {
    return undefined;
  }
  return activePlotPointTab.value === "summary"
    ? plotPointSummaryDrafts.value[plotPointId]
    : plotPointStorylineDrafts.value[plotPointId];
});
const currentChapterCardDraft = computed(() => {
  const chapterCardId = currentChapterCard.value?.id;
  if (!chapterCardId) return undefined;
  return activeChapterCardTab.value === "outline"
    ? chapterCardOutlineDrafts.value[chapterCardId]
    : chapterCardWorldConstraintDrafts.value[chapterCardId];
});
const currentChapterCardCommitted = computed(() => {
  const chapterCardId = currentChapterCard.value?.id;
  return Boolean(
    chapterCardId &&
      props.workspaceIndex?.chapters.some(
        (entry) =>
          entry.chapterCardId === chapterCardId && entry.commitId !== null
      )
  );
});
const currentIsVolumeOutline = computed(
  () =>
    currentIsBookLineWorkspace.value &&
    currentBookLineVolume.value !== null &&
    activeBookLineContentTab.value === "outline"
);
const currentIsVolumeForeshadowing = computed(
  () =>
    currentIsBookLineWorkspace.value &&
    currentBookLineVolume.value !== null &&
    activeBookLineContentTab.value === "foreshadowing"
);
const currentIsPlotPointSummary = computed(
  () =>
    currentIsPlotPointWorkspace.value &&
    currentPlotPoint.value !== null &&
    activePlotPointTab.value === "summary"
);
const currentIsPlotPointStoryline = computed(
  () =>
    currentIsPlotPointWorkspace.value &&
    currentPlotPoint.value !== null &&
    activePlotPointTab.value === "storyline"
);
const currentIsPlotPointForeshadowing = computed(
  () =>
    currentIsPlotPointWorkspace.value &&
    currentPlotPoint.value !== null &&
    activePlotPointTab.value === "foreshadowing"
);
const currentIsForeshadowingView = computed(
  () =>
    currentIsForeshadowingWorkspace.value ||
    currentIsVolumeForeshadowing.value ||
    currentIsPlotPointForeshadowing.value
);
const currentForeshadowingMode = computed<
  "overview" | "volume" | "plotPoint"
>(() =>
  currentIsForeshadowingWorkspace.value
    ? "overview"
    : currentIsVolumeForeshadowing.value
      ? "volume"
      : "plotPoint"
);
const currentForeshadowingVolumeId = computed(
  () => {
    if (currentIsVolumeForeshadowing.value) {
      return currentBookLineVolume.value?.id;
    }
    if (currentIsPlotPointForeshadowing.value) {
      return currentPlotPoint.value?.volumeId;
    }
    return undefined;
  }
);
const currentIsChapterCardOutline = computed(
  () =>
    currentIsChapterCardWorkspace.value &&
    currentChapterCard.value !== null &&
    activeChapterCardTab.value === "outline"
);
const currentIsChapterCardWorldConstraints = computed(
  () =>
    currentIsChapterCardWorkspace.value &&
    currentChapterCard.value !== null &&
    activeChapterCardTab.value === "worldConstraints"
);
const currentIsStructuredText = computed(
  () =>
    currentIsVolumeOutline.value ||
    currentIsPlotPointSummary.value ||
    currentIsPlotPointStoryline.value ||
    currentIsChapterCardOutline.value ||
    currentIsChapterCardWorldConstraints.value
);
const currentReadOnly = computed(() => {
  const selectedFile = currentSelectionFile.value;
  return Boolean(
    props.locked ||
      currentChapterCardCommitted.value ||
      selectedFile?.readOnly ||
      (selectedFile && !isEditableLongFile(selectedFile.file))
  );
});
const currentDirty = computed(
  () => {
    if (currentIsVolumeForeshadowing.value) {
      const volumeId = currentBookLineVolume.value?.id;
      const draft = volumeId
        ? volumeOutlineDrafts.value[volumeId]
        : undefined;
      return Boolean(draft && draft.content !== draft.savedContent);
    }
    if (currentIsPlotPointForeshadowing.value) {
      const plotPointId = currentPlotPoint.value?.id;
      const summaryDraft = plotPointId
        ? plotPointSummaryDrafts.value[plotPointId]
        : undefined;
      const storylineDraft = plotPointId
        ? plotPointStorylineDrafts.value[plotPointId]
        : undefined;
      return Boolean(
        (summaryDraft &&
          summaryDraft.content !== summaryDraft.savedContent) ||
          (storylineDraft &&
            storylineDraft.content !== storylineDraft.savedContent)
      );
    }
    if (currentIsStructuredText.value) {
      const draft =
        currentChapterCardDraft.value ??
        currentPlotPointDraft.value ??
        currentVolumeOutlineDraft.value;
      return Boolean(draft && draft.content !== draft.savedContent);
    }
    return (
      Boolean(currentState.value?.loaded) &&
      currentState.value?.content !== currentState.value?.savedContent
    );
  }
);
const currentStaleRecovery = computed<LongEditorRecoveryRecord | null>(() => {
  const selectedFile = currentSelectionFile.value;
  return selectedFile
    ? staleRecoveryByKey.value[stateKey(selectedFile.file.id)] ?? null
    : null;
});
const currentStaleRecoveryPreview = computed(() => {
  const content = currentStaleRecovery.value?.content ?? "";
  return content.length > 600 ? `${content.slice(0, 600)}…` : content;
});
const currentIsWorldbuildingList = computed(
  () =>
    props.selection?.root === "worldbuilding" &&
    props.selection.worldbuildingFormat === "list" &&
    currentSelectionFile.value?.role === "content"
);
const currentWorldbuildingListState = computed<{
  items: LongWorldbuildingMarkdownItem[];
  error: string | null;
}>(() => {
  if (!currentIsWorldbuildingList.value || !currentState.value?.loaded) {
    return { items: [], error: null };
  }
  try {
    return {
      items: parseLongWorldbuildingMarkdownList(currentState.value.content),
      error: null
    };
  } catch (error: unknown) {
    return {
      items: [],
      error:
        error instanceof Error
          ? error.message
          : "无法读取列表型世界观内容。"
    };
  }
});
const currentWorldbuildingItems = computed(
  () => currentWorldbuildingListState.value.items
);
const currentWorldbuildingItem = computed(
  () =>
    currentWorldbuildingItems.value.find(
      ({ id }) => id === activeWorldbuildingItemId.value
    ) ??
    currentWorldbuildingItems.value[0] ??
    null
);
const pendingWorldbuildingDeleteItem = computed(
  () =>
    currentWorldbuildingItems.value.find(
      ({ id }) => id === pendingWorldbuildingDeleteId.value
    ) ?? null
);
const currentVisibleContent = computed(() => {
  if (
    currentIsChapterCardOutline.value ||
    currentIsChapterCardWorldConstraints.value
  ) {
    return currentChapterCardDraft.value?.content ?? "";
  }
  if (
    currentIsPlotPointStoryline.value ||
    currentIsPlotPointSummary.value
  ) {
    return currentPlotPointDraft.value?.content ?? "";
  }
  if (currentIsVolumeOutline.value) {
    return currentVolumeOutlineDraft.value?.content ?? "";
  }
  if (
    currentIsWorldbuildingList.value &&
    !currentWorldbuildingListState.value.error
  ) {
    return currentWorldbuildingItem.value?.content ?? "";
  }
  return currentState.value?.content ?? "";
});
const currentDocumentTitle = computed(
  () =>
    (currentIsChapterCardWorkspace.value
      ? currentChapterCard.value?.title
      : undefined) ??
    (currentIsPlotPointWorkspace.value
      ? currentPlotPoint.value?.title
      : undefined) ??
    (currentIsBookLineWorkspace.value
      ? currentBookLineVolume.value?.title
      : undefined) ??
    (currentIsBookLineWorkspace.value
      ? "全书总纲"
      : props.selection?.title ?? "")
);
const currentDocumentFormat = computed(() =>
  currentIsChapterCardWorldConstraints.value
    ? "世界约束"
    : currentIsChapterCardOutline.value
      ? "章节大纲"
      : currentIsPlotPointStoryline.value
        ? "故事情节"
        : currentIsPlotPointSummary.value
          ? "概要"
          : currentIsVolumeOutline.value
            ? "卷纲"
            : currentIsBookLineWorkspace.value
              ? "全书总纲"
              : currentSelectionFile.value?.label ?? ""
);
const currentSaving = computed(
  () =>
    characterNameSaving.value ||
    structureTitleSaving.value ||
    Boolean(
      currentChapterCardDraft.value?.saving ??
        currentPlotPointDraft.value?.saving ??
        currentVolumeOutlineDraft.value?.saving ??
        currentState.value?.saving ??
        false
    )
);
const previewParagraphs = computed(() =>
  currentVisibleContent.value.split(/\n{2,}/u).filter(Boolean)
);
const searchMatches = computed<LongEditorSearchMatch[]>(() => {
  const content = currentVisibleContent.value;
  const query = searchQuery.value;
  if (!query) return [];

  const matches: LongEditorSearchMatch[] = [];
  let start = 0;
  while (start <= content.length - query.length) {
    const index = content.indexOf(query, start);
    if (index < 0) break;
    matches.push({ start: index, end: index + query.length });
    start = index + query.length;
  }
  return matches;
});
const searchResultLabel = computed(() => {
  if (!searchQuery.value) return "0/0";
  if (!searchMatches.value.length) return "无结果";
  const current = currentMatchIndex.value >= 0 ? currentMatchIndex.value + 1 : 0;
  return `${current}/${searchMatches.value.length}`;
});
const documentEyebrow = computed(() => {
  const role = currentSelectionFile.value?.role;
  if (props.selection?.root === "draft") {
    if (role === "character-state") return "长篇 · 章节人物状态";
    if (role === "handoff") return "长篇 · 章节交接";
    return "长篇 · 章节正文";
  }
  if (props.selection?.root === "worldbuilding") return "长篇 · 世界设定";
  if (props.selection?.root === "character_design") return "长篇 · 人物档案";
  if (props.selection?.root === "plot_design") return "长篇 · 剧情设计";
  if (props.selection?.root === "continuity_ledger") {
    return "长篇 · 连续性记录";
  }
  return "长篇文稿";
});
const characterCount = computed(
  () => currentVisibleContent.value.replace(/\s/gu, "").length
);
const currentLedgerRecord = computed<LongLedgerCommitRecord | null>(() => {
  if (
    currentSelectionFile.value?.role !== "ledger-record" ||
    !currentState.value?.loaded
  ) {
    return null;
  }
  try {
    const parsed = LongLedgerCommitRecordSchema.safeParse(
      JSON.parse(currentState.value.content)
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});
const canUseTextTools = computed(
  () =>
    !currentIsForeshadowingView.value &&
    (Boolean(currentState.value?.loaded) ||
      currentIsStructuredText.value) &&
    !currentLedgerRecord.value &&
    Boolean(
      !currentIsWorldbuildingList.value ||
        currentWorldbuildingListState.value.error ||
        currentWorldbuildingItem.value
    )
);
const canUndo = computed(
  () =>
    canUseTextTools.value &&
    !currentReadOnly.value &&
    undoHistory.value.length > 0
);
const canRedo = computed(
  () =>
    canUseTextTools.value &&
    !currentReadOnly.value &&
    redoHistory.value.length > 0
);
const currentLedgerSummaryRows = computed(() => {
  const summary = currentLedgerRecord.value?.chapterSummary;
  return summary
    ? [
        ["时间线", summary.timeline],
        ["人物状态", summary.characterStates],
        ["势力状态", summary.factionStates],
        ["境界状态", summary.realmStates],
        ["伏笔状态", summary.foreshadowingStates],
        ["连续性备注", summary.continuityNotes]
      ]
    : [];
});
const hasUnsavedChanges = computed(() =>
  Object.values(documentStates.value).some(
    (state) => state.loaded && state.content !== state.savedContent
  ) ||
  Object.values(volumeOutlineDrafts.value).some(
    (draft) => draft.content !== draft.savedContent
  ) ||
  Object.values(plotPointSummaryDrafts.value).some(
    (draft) => draft.content !== draft.savedContent
  ) ||
  Object.values(plotPointStorylineDrafts.value).some(
    (draft) => draft.content !== draft.savedContent
  ) ||
  Object.values(chapterCardOutlineDrafts.value).some(
    (draft) => draft.content !== draft.savedContent
  ) ||
  Object.values(chapterCardWorldConstraintDrafts.value).some(
    (draft) => draft.content !== draft.savedContent
  )
);

function replaceDocumentState(key: string, state: LongDocumentState): void {
  documentStates.value = {
    ...documentStates.value,
    [key]: state
  };
}

function recoveryStorageKey(bookId: string, fileId: string): string {
  return `${RECOVERY_STORAGE_PREFIX}${encodeURIComponent(bookId)}:${encodeURIComponent(fileId)}`;
}

function resolveRecoveryStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function removeStaleRecoveryState(key: string): void {
  if (!staleRecoveryByKey.value[key]) return;
  const next = { ...staleRecoveryByKey.value };
  delete next[key];
  staleRecoveryByKey.value = next;
}

function cancelRecoveryWrite(key: string): void {
  const timer = recoveryWriteTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    recoveryWriteTimers.delete(key);
  }
}

function removeStoredRecovery(bookId: string, fileId: string): void {
  try {
    resolveRecoveryStorage()?.removeItem(recoveryStorageKey(bookId, fileId));
  } catch {
    // A disabled or unavailable localStorage must never break the editor.
  }
}

function clearRecoveryRecordForKey(
  key: string,
  bookId: string,
  fileId: string
): void {
  cancelRecoveryWrite(key);
  removeStoredRecovery(bookId, fileId);
  removeStaleRecoveryState(key);
  recoveryWriteWarningKeys.delete(key);
}

function parseStoredRecovery(
  raw: string,
  expectedBookId: string,
  expectedFileId: LongFileId
): LongEditorRecoveryRecord | null {
  if (raw.length > RECOVERY_MAX_RECORD_CHARACTERS) return null;
  try {
    const value = JSON.parse(raw) as Partial<LongEditorRecoveryRecord>;
    const revision = LongFileRevisionSchema.safeParse(value.baseRevision);
    const now = Date.now();
    if (
      value.schemaVersion !== 1 ||
      value.bookId !== expectedBookId ||
      value.fileId !== expectedFileId ||
      typeof value.filePath !== "string" ||
      value.filePath.length > 4096 ||
      typeof value.content !== "string" ||
      typeof value.savedContent !== "string" ||
      !revision.success ||
      !Number.isInteger(value.workspaceRevision) ||
      Number(value.workspaceRevision) < 0 ||
      !Number.isInteger(value.projectRevision) ||
      Number(value.projectRevision) < 0 ||
      typeof value.timestamp !== "number" ||
      !Number.isFinite(value.timestamp) ||
      value.timestamp <= 0 ||
      value.timestamp > now + RECOVERY_CLOCK_SKEW_MS ||
      now - value.timestamp > RECOVERY_MAX_AGE_MS
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      bookId: value.bookId,
      fileId: value.fileId,
      filePath: value.filePath,
      content: value.content,
      savedContent: value.savedContent,
      baseRevision: revision.data,
      workspaceRevision: Number(value.workspaceRevision),
      projectRevision: Number(value.projectRevision),
      timestamp: value.timestamp
    };
  } catch {
    return null;
  }
}

function readRecoveryRecord(
  bookId: string,
  fileId: LongFileId
): LongEditorRecoveryRecord | null {
  const storage = resolveRecoveryStorage();
  if (!storage) return null;
  const storageKey = recoveryStorageKey(bookId, fileId);
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return null;
    const record = parseStoredRecovery(raw, bookId, fileId);
    if (record) return record;
    storage.removeItem(storageKey);
  } catch {
    // Corrupt or inaccessible recovery state is ignored without blocking load.
  }
  return null;
}

function warnRecoveryWriteFailure(key: string, message: string): void {
  if (recoveryWriteWarningKeys.has(key)) return;
  recoveryWriteWarningKeys.add(key);
  uiMessage.warning(message);
}

function persistRecoveryForKey(key: string): void {
  cancelRecoveryWrite(key);
  const state = documentStates.value[key];
  if (!state || !state.loaded || !isEditableLongFile(state.file)) return;
  if (state.content === state.savedContent) {
    clearRecoveryRecordForKey(key, state.bookId, state.file.id);
    return;
  }

  const record: LongEditorRecoveryRecord = {
    schemaVersion: 1,
    bookId: state.bookId,
    fileId: state.file.id,
    filePath: state.file.path,
    content: state.content,
    savedContent: state.savedContent,
    baseRevision: state.file.revision,
    workspaceRevision: state.workspaceRevision,
    projectRevision: state.projectRevision,
    timestamp: Date.now()
  };
  if (
    state.content.length + state.savedContent.length >
    RECOVERY_MAX_RECORD_CHARACTERS - 16 * 1024
  ) {
    removeStoredRecovery(state.bookId, state.file.id);
    warnRecoveryWriteFailure(
      key,
      "当前长篇文件过大，无法写入本机崩溃恢复副本；请立即手动保存。"
    );
    return;
  }
  const serialized = JSON.stringify(record);
  if (serialized.length > RECOVERY_MAX_RECORD_CHARACTERS) {
    removeStoredRecovery(state.bookId, state.file.id);
    warnRecoveryWriteFailure(
      key,
      "当前长篇文件过大，无法写入本机崩溃恢复副本；请立即手动保存。"
    );
    return;
  }

  const storage = resolveRecoveryStorage();
  if (!storage) {
    warnRecoveryWriteFailure(
      key,
      "本机存储当前不可用，无法保存长篇崩溃恢复副本；请立即手动保存。"
    );
    return;
  }
  try {
    storage.setItem(
      recoveryStorageKey(state.bookId, state.file.id),
      serialized
    );
    recoveryWriteWarningKeys.delete(key);
  } catch {
    // setItem is atomic, but an older value may still exist after quota failure.
    // Removing it prevents a later restart from silently restoring stale text.
    removeStoredRecovery(state.bookId, state.file.id);
    warnRecoveryWriteFailure(
      key,
      "长篇崩溃恢复副本写入失败，请立即手动保存当前文件。"
    );
  }
}

function scheduleRecoveryWrite(key: string): void {
  cancelRecoveryWrite(key);
  recoveryWriteTimers.set(
    key,
    setTimeout(() => {
      recoveryWriteTimers.delete(key);
      persistRecoveryForKey(key);
    }, RECOVERY_WRITE_DEBOUNCE_MS)
  );
}

function flushAllRecoveryRecords(): void {
  for (const key of Object.keys(documentStates.value)) {
    const state = documentStates.value[key];
    if (
      state?.loaded &&
      isEditableLongFile(state.file) &&
      state.content !== state.savedContent
    ) {
      persistRecoveryForKey(key);
    }
  }
}

function updateCurrentContent(content: string): void {
  const state = currentState.value;
  const file = currentSelectionFile.value;
  if (!state || !file || currentReadOnly.value || state.loading) return;
  const key = stateKey(file.file.id);
  replaceDocumentState(key, {
    ...state,
    content
  });
  if (content === state.savedContent) {
    clearRecoveryRecordForKey(key, state.bookId, state.file.id);
  } else {
    scheduleRecoveryWrite(key);
  }
}

function replaceCurrentWorldbuildingItems(
  items: LongWorldbuildingMarkdownItem[]
): boolean {
  if (
    currentReadOnly.value ||
    !currentIsWorldbuildingList.value ||
    currentWorldbuildingListState.value.error
  ) {
    return false;
  }
  try {
    updateCurrentContent(serializeLongWorldbuildingMarkdownList(items));
    return true;
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error
        ? error.message
        : "无法更新世界观条目。"
    );
    return false;
  }
}

function selectWorldbuildingItem(itemId: string): void {
  activeWorldbuildingItemId.value = itemId;
}

function addWorldbuildingItem(): void {
  const items = currentWorldbuildingItems.value;
  if (currentReadOnly.value || items.length >= 10_000) {
    if (items.length >= 10_000) {
      uiMessage.warning("单个世界观分类最多支持 10000 个条目。");
    }
    return;
  }
  const usedTitles = new Set(items.map(({ title }) => title));
  let sequence = items.length + 1;
  let title = `新条目 ${sequence}`;
  while (usedTitles.has(title)) {
    sequence += 1;
    title = `新条目 ${sequence}`;
  }
  const item: LongWorldbuildingMarkdownItem = {
    id: createId("worlditem"),
    title,
    content: ""
  };
  if (replaceCurrentWorldbuildingItems([...items, item])) {
    activeWorldbuildingItemId.value = item.id;
  }
}

function updateWorldbuildingItemContent(
  itemId: string,
  content: string
): void {
  replaceCurrentWorldbuildingItems(
    currentWorldbuildingItems.value.map((item) =>
      item.id === itemId ? { ...item, content } : item
    )
  );
}

function updateVisibleContent(content: string): void {
  const chapterCard = currentChapterCard.value;
  if (currentIsChapterCardWorkspace.value && chapterCard) {
    const drafts =
      activeChapterCardTab.value === "outline"
        ? chapterCardOutlineDrafts
        : chapterCardWorldConstraintDrafts;
    const persistedContent =
      activeChapterCardTab.value === "outline"
        ? chapterCard.outline
        : chapterCard.worldConstraints;
    const current = drafts.value[chapterCard.id] ?? {
      content: persistedContent,
      savedContent: persistedContent,
      saving: false
    };
    drafts.value = {
      ...drafts.value,
      [chapterCard.id]: {
        ...current,
        content
      }
    };
    return;
  }
  const plotPoint = currentPlotPoint.value;
  if (
    currentIsPlotPointWorkspace.value &&
    plotPoint &&
    activePlotPointTab.value !== "foreshadowing"
  ) {
    const drafts =
      activePlotPointTab.value === "summary"
        ? plotPointSummaryDrafts
        : plotPointStorylineDrafts;
    const persistedContent =
      activePlotPointTab.value === "summary"
        ? plotPoint.summary ?? ""
        : plotPoint.outline;
    const current = drafts.value[plotPoint.id] ?? {
      content: persistedContent,
      savedContent: persistedContent,
      saving: false
    };
    drafts.value = {
      ...drafts.value,
      [plotPoint.id]: {
        ...current,
        content
      }
    };
    return;
  }
  const volume = currentBookLineVolume.value;
  if (currentIsVolumeOutline.value && volume) {
    const current = volumeOutlineDrafts.value[volume.id] ?? {
      content: volume.summary,
      savedContent: volume.summary,
      saving: false
    };
    volumeOutlineDrafts.value = {
      ...volumeOutlineDrafts.value,
      [volume.id]: {
        ...current,
        content
      }
    };
    return;
  }
  const item = currentWorldbuildingItem.value;
  if (
    currentIsWorldbuildingList.value &&
    !currentWorldbuildingListState.value.error &&
    item
  ) {
    updateWorldbuildingItemContent(item.id, content);
    return;
  }
  updateCurrentContent(content);
}

function resetEditorHistory(): void {
  undoHistory.value = [];
  redoHistory.value = [];
}

function selectBookLineOverview(): void {
  activeBookLineVolumeId.value = null;
  activeBookLineContentTab.value = "outline";
  resetEditorHistory();
}

function selectBookLineVolume(volumeId: string): void {
  if (!orderedBookLineVolumes.value.some(({ id }) => id === volumeId)) {
    return;
  }
  activeBookLineVolumeId.value = volumeId;
  activeBookLineContentTab.value = "outline";
  resetEditorHistory();
}

async function selectBookLineContentTab(
  tab: "outline" | "foreshadowing"
): Promise<void> {
  if (tab === "foreshadowing") {
    if (!(await saveAllChanges())) return;
    await nextTick();
  }
  activeBookLineContentTab.value = tab;
  resetEditorHistory();
}

async function selectPlotPointTab(
  tab: "summary" | "storyline" | "foreshadowing"
): Promise<void> {
  if (tab === "foreshadowing") {
    if (!(await saveAllChanges())) return;
    await nextTick();
  }
  activePlotPointTab.value = tab;
  resetEditorHistory();
}

function selectChapterCardContentTab(
  tab: "outline" | "worldConstraints"
): void {
  activeChapterCardTab.value = tab;
  resetEditorHistory();
}

function requestCreateVolume(): void {
  if (!currentReadOnly.value) {
    emit("createVolume");
  }
}

function forwardForeshadowingMutation(
  batch: LongWorkspaceOperationBatch,
  completion: LongStructureMutationCompletion
): void {
  emit("mutation", batch, completion);
}

async function saveVolumeOutline(volumeId: string): Promise<boolean> {
  const draft = volumeOutlineDrafts.value[volumeId];
  if (!draft || draft.saving || draft.content === draft.savedContent) {
    return Boolean(draft && !draft.saving);
  }
  const submittedContent = draft.content;
  volumeOutlineDrafts.value = {
    ...volumeOutlineDrafts.value,
    [volumeId]: { ...draft, saving: true }
  };
  return await new Promise<boolean>((resolve) => {
    emit(
      "saveVolumeOutline",
      { volumeId, outline: submittedContent },
      (succeeded) => {
        const latest = volumeOutlineDrafts.value[volumeId];
        if (latest) {
          volumeOutlineDrafts.value = {
            ...volumeOutlineDrafts.value,
            [volumeId]: {
              ...latest,
              ...(succeeded ? { savedContent: submittedContent } : {}),
              saving: false
            }
          };
        }
        resolve(succeeded);
      }
    );
  });
}

async function savePlotPointContent(
  plotPointId: LongArcId,
  field: "summary" | "storyline"
): Promise<boolean> {
  const drafts =
    field === "summary"
      ? plotPointSummaryDrafts
      : plotPointStorylineDrafts;
  const draft = drafts.value[plotPointId];
  if (!draft || draft.saving || draft.content === draft.savedContent) {
    return Boolean(draft && !draft.saving);
  }
  const submittedContent = draft.content;
  drafts.value = {
    ...drafts.value,
    [plotPointId]: { ...draft, saving: true }
  };
  return await new Promise<boolean>((resolve) => {
    emit(
      "savePlotPointContent",
      { plotPointId, field, content: submittedContent },
      (succeeded) => {
        const latest = drafts.value[plotPointId];
        if (latest) {
          drafts.value = {
            ...drafts.value,
            [plotPointId]: {
              ...latest,
              ...(succeeded ? { savedContent: submittedContent } : {}),
              saving: false
            }
          };
        }
        resolve(succeeded);
      }
    );
  });
}

async function saveChapterCardContent(
  chapterCardId: LongChapterCardId,
  field: "outline" | "worldConstraints"
): Promise<boolean> {
  const drafts =
    field === "outline"
      ? chapterCardOutlineDrafts
      : chapterCardWorldConstraintDrafts;
  const draft = drafts.value[chapterCardId];
  if (!draft || draft.saving || draft.content === draft.savedContent) {
    return Boolean(draft && !draft.saving);
  }
  const submittedContent = draft.content;
  drafts.value = {
    ...drafts.value,
    [chapterCardId]: { ...draft, saving: true }
  };
  return await new Promise<boolean>((resolve) => {
    emit(
      "saveChapterCardContent",
      { chapterCardId, field, content: submittedContent },
      (succeeded) => {
        const latest = drafts.value[chapterCardId];
        if (latest) {
          drafts.value = {
            ...drafts.value,
            [chapterCardId]: {
              ...latest,
              ...(succeeded ? { savedContent: submittedContent } : {}),
              saving: false
            }
          };
        }
        resolve(succeeded);
      }
    );
  });
}

function getEditorSnapshot(): LongEditorHistorySnapshot {
  const input = editorInput.value;
  const fallback = currentVisibleContent.value.length;
  return {
    content: currentVisibleContent.value,
    selectionStart: input?.selectionStart ?? fallback,
    selectionEnd: input?.selectionEnd ?? fallback
  };
}

function pushHistorySnapshot(
  history: LongEditorHistorySnapshot[],
  snapshot: LongEditorHistorySnapshot
): void {
  if (history.at(-1)?.content === snapshot.content) return;
  history.push(snapshot);
  if (history.length > HISTORY_LIMIT) history.shift();
}

function recordUndoSnapshot(snapshot = getEditorSnapshot()): void {
  pushHistorySnapshot(undoHistory.value, snapshot);
  redoHistory.value = [];
}

function handleEditorBeforeInput(event: InputEvent): void {
  if (currentReadOnly.value) return;
  if (event.inputType === "historyUndo") {
    event.preventDefault();
    undo();
    return;
  }
  if (event.inputType === "historyRedo") {
    event.preventDefault();
    redo();
    return;
  }
  const input = event.currentTarget as HTMLTextAreaElement;
  recordUndoSnapshot({
    content: currentVisibleContent.value,
    selectionStart:
      input.selectionStart ?? currentVisibleContent.value.length,
    selectionEnd: input.selectionEnd ?? currentVisibleContent.value.length
  });
}

async function restoreEditorSnapshot(
  snapshot: LongEditorHistorySnapshot
): Promise<void> {
  viewMode.value = "edit";
  updateVisibleContent(snapshot.content);
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(
    snapshot.selectionStart,
    snapshot.selectionEnd,
    "forward"
  );
  scrollEditorToRange(input, snapshot.selectionStart);
}

function undo(): void {
  if (!canUndo.value) return;
  const snapshot = undoHistory.value.pop();
  if (!snapshot) return;
  pushHistorySnapshot(redoHistory.value, getEditorSnapshot());
  void restoreEditorSnapshot(snapshot);
}

function redo(): void {
  if (!canRedo.value) return;
  const snapshot = redoHistory.value.pop();
  if (!snapshot) return;
  pushHistorySnapshot(undoHistory.value, getEditorSnapshot());
  void restoreEditorSnapshot(snapshot);
}

function closeFindPanel(): void {
  findPanelOpen.value = false;
  currentMatchIndex.value = -1;
}

async function toggleFindPanel(mode: "find" | "replace"): Promise<void> {
  if (!canUseTextTools.value) return;
  if (findPanelOpen.value && findPanelMode.value === mode) {
    closeFindPanel();
    return;
  }
  viewMode.value = "edit";
  findPanelMode.value = mode;
  findPanelOpen.value = true;
  searchAnchor.value = editorInput.value?.selectionStart ?? 0;
  currentMatchIndex.value = -1;
  await nextTick();
  findInput.value?.focus({ preventScroll: true });
  findInput.value?.select();
}

function resolveInitialMatchIndex(direction: 1 | -1): number {
  const matches = searchMatches.value;
  if (!matches.length) return -1;
  if (direction === 1) {
    const index = matches.findIndex(
      (match) => match.start >= searchAnchor.value
    );
    return index >= 0 ? index : 0;
  }
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index]!.end <= searchAnchor.value) return index;
  }
  return matches.length - 1;
}

function scrollEditorToRange(
  input: HTMLTextAreaElement,
  start: number
): void {
  const line = currentVisibleContent.value.slice(0, start).split("\n").length;
  const computedStyle = globalThis.getComputedStyle(input);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight);
  const resolvedLineHeight = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.parseFloat(computedStyle.fontSize) * 1.95;
  input.scrollTop = Math.max(
    0,
    (line - 1) * resolvedLineHeight - input.clientHeight / 3
  );
}

async function selectSearchMatch(index: number): Promise<void> {
  const match = searchMatches.value[index];
  if (!match) return;
  currentMatchIndex.value = index;
  viewMode.value = "edit";
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(match.start, match.end, "forward");
  scrollEditorToRange(input, match.start);
  await nextTick();
  findInput.value?.focus({ preventScroll: true });
}

function findMatch(direction: 1 | -1, quiet = false): void {
  if (!searchQuery.value) {
    if (!quiet) uiMessage.info("请输入要查找的文字");
    return;
  }
  if (!searchMatches.value.length) {
    currentMatchIndex.value = -1;
    if (!quiet) uiMessage.info("未找到匹配文字");
    return;
  }
  const nextIndex =
    currentMatchIndex.value < 0
      ? resolveInitialMatchIndex(direction)
      : (currentMatchIndex.value + direction + searchMatches.value.length) %
        searchMatches.value.length;
  void selectSearchMatch(nextIndex);
}

function handleFindInput(): void {
  currentMatchIndex.value = -1;
  if (searchQuery.value) findMatch(1, true);
}

function replaceCurrentMatch(): void {
  if (currentReadOnly.value) return;
  const index =
    currentMatchIndex.value >= 0
      ? currentMatchIndex.value
      : resolveInitialMatchIndex(1);
  const match = searchMatches.value[index];
  if (!match) {
    uiMessage.info(
      searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字"
    );
    return;
  }
  const content = currentVisibleContent.value;
  const nextContent =
    content.slice(0, match.start) +
    replacementText.value +
    content.slice(match.end);
  if (nextContent === content) {
    findMatch(1);
    return;
  }
  recordUndoSnapshot();
  updateVisibleContent(nextContent);
  searchAnchor.value = match.start + replacementText.value.length;
  void nextTick(() => findMatch(1, true));
}

function replaceAllMatches(): void {
  if (currentReadOnly.value) return;
  const matches = searchMatches.value;
  if (!searchQuery.value || !matches.length) {
    uiMessage.info(
      searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字"
    );
    return;
  }
  const content = currentVisibleContent.value;
  let cursor = 0;
  let nextContent = "";
  for (const match of matches) {
    nextContent +=
      content.slice(cursor, match.start) + replacementText.value;
    cursor = match.end;
  }
  nextContent += content.slice(cursor);
  if (nextContent === content) {
    uiMessage.info("查找文字与替换文字相同");
    return;
  }
  recordUndoSnapshot();
  updateVisibleContent(nextContent);
  searchAnchor.value = 0;
  uiMessage.success(`已替换 ${matches.length} 处文字`);
}

function handleEditorKeydown(event: KeyboardEvent): void {
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (modifier && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (event.ctrlKey && !event.metaKey && key === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (modifier && key === "f" && !(event.metaKey && event.altKey)) {
    event.preventDefault();
    void toggleFindPanel("find");
    return;
  }
  if (
    (event.ctrlKey && !event.metaKey && key === "h") ||
    (event.metaKey && event.altKey && key === "f")
  ) {
    event.preventDefault();
    void toggleFindPanel("replace");
  }
}

function handleWindowPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    !editorToolsElement.value?.contains(target) &&
    !findPanelElement.value?.contains(target)
  ) {
    closeFindPanel();
  }
}

function updateWorldbuildingItemTitle(itemId: string, event: Event): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const title = input.value.trim();
  const current = currentWorldbuildingItems.value.find(
    (item) => item.id === itemId
  );
  if (!current) return;
  if (!title) {
    input.value = current.title;
    uiMessage.warning("世界观条目名称不能为空。");
    return;
  }
  if (
    replaceCurrentWorldbuildingItems(
      currentWorldbuildingItems.value.map((item) =>
        item.id === itemId ? { ...item, title } : item
      )
    )
  ) {
    input.value = title;
  } else {
    input.value = current.title;
  }
}

function resetCharacterNameDraft(): void {
  characterNameDraft.value = props.selection?.title ?? "";
}

function saveCharacterName(): void {
  const characterId = props.selection?.characterId;
  if (
    !currentIsCharacterDocument.value ||
    !characterId ||
    characterNameSaving.value
  ) {
    return;
  }
  const name = characterNameDraft.value.trim();
  if (!name) {
    resetCharacterNameDraft();
    uiMessage.warning("人物姓名不能为空。");
    return;
  }
  if (name === props.selection?.title) {
    characterNameDraft.value = name;
    return;
  }

  characterNameDraft.value = name;
  characterNameSaving.value = true;
  emit("renameCharacter", { characterId, name }, (succeeded) => {
    characterNameSaving.value = false;
    if (!succeeded) {
      resetCharacterNameDraft();
    }
  });
}

function handleCharacterNameKeydown(event: KeyboardEvent): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    input.blur();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    resetCharacterNameDraft();
    input.blur();
  }
}

function resetStructureTitleDraft(): void {
  structureTitleDraft.value = currentStructureTitleTarget.value?.title ?? "";
}

function saveStructureTitle(): void {
  const target = currentStructureTitleTarget.value;
  if (!target || currentStructureTitleReadOnly.value) return;
  const title = structureTitleDraft.value.trim();
  if (!title) {
    resetStructureTitleDraft();
    uiMessage.warning(target.emptyMessage);
    return;
  }
  if (title === target.title) {
    structureTitleDraft.value = title;
    return;
  }

  structureTitleDraft.value = title;
  structureTitleSaving.value = true;
  emit(
    "renameStructureTitle",
    { kind: target.kind, id: target.id, title },
    (succeeded) => {
      structureTitleSaving.value = false;
      if (!succeeded) {
        resetStructureTitleDraft();
      }
    }
  );
}

function handleStructureTitleKeydown(event: KeyboardEvent): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    input.blur();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    resetStructureTitleDraft();
    input.blur();
  }
}

function openWorldbuildingItemDelete(itemId: string): void {
  if (currentReadOnly.value) return;
  worldbuildingDeletePreviousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  pendingWorldbuildingDeleteId.value = itemId;
  void nextTick(() => {
    worldbuildingDeleteCancelButton.value?.focus({ preventScroll: true });
  });
}

function closeWorldbuildingItemDelete(): void {
  pendingWorldbuildingDeleteId.value = null;
  const previousFocus = worldbuildingDeletePreviousFocus;
  worldbuildingDeletePreviousFocus = null;
  void nextTick(() => {
    if (previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  });
}

function handleWorldbuildingDeleteKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeWorldbuildingItemDelete();
    return;
  }
  if (event.key !== "Tab" || !worldbuildingDeleteDialog.value) return;
  const focusable = Array.from(
    worldbuildingDeleteDialog.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  );
  if (!focusable.length) {
    event.preventDefault();
    worldbuildingDeleteDialog.value.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function confirmWorldbuildingItemDelete(): void {
  const target = pendingWorldbuildingDeleteItem.value;
  if (!target) return;
  const items = currentWorldbuildingItems.value;
  const targetIndex = items.findIndex(({ id }) => id === target.id);
  const nextItems = items.filter(({ id }) => id !== target.id);
  if (!replaceCurrentWorldbuildingItems(nextItems)) return;
  activeWorldbuildingItemId.value =
    nextItems[Math.min(targetIndex, nextItems.length - 1)]?.id ?? null;
  closeWorldbuildingItemDelete();
}

function initializeLoadingState(
  key: string,
  bookId: string,
  file: LongWorkspaceFileReference
): void {
  const existing = documentStates.value[key];
  replaceDocumentState(key, {
    bookId,
    file,
    content: existing?.content ?? "",
    savedContent: existing?.savedContent ?? "",
    workspaceRevision: existing?.workspaceRevision ?? 0,
    projectRevision: existing?.projectRevision ?? 0,
    loading: true,
    saving: false,
    // Never expose a previous clean snapshot as editable after its revision
    // changed. If the fresh read fails, keeping `loaded` false prevents stale
    // text from being saved against the newer CAS revision.
    loaded: false,
    loadError: null
  });
}

function assertSameReadSnapshot(
  first: LongReadDocumentResult,
  next: LongReadDocumentResult
): void {
  if (
    first.file.id !== next.file.id ||
    first.file.revision !== next.file.revision ||
    first.workspaceRevision !== next.workspaceRevision ||
    first.projectRevision !== next.projectRevision ||
    first.totalCharacters !== next.totalCharacters
  ) {
    throw new Error("长篇文件在分页读取期间发生变化，请重新打开。");
  }
}

async function loadWorkspaceDocument(
  selectedFile: LongWorkspaceSelectionFile,
  force = false
): Promise<void> {
  const bookId = props.bookId;
  const api = resolveLongWorkspaceApi();
  if (!api) {
    uiMessage.warning("当前环境未连接长篇工作区，请使用桌面客户端。");
    return;
  }

  const key = stateKey(selectedFile.file.id, bookId);
  const existing = documentStates.value[key];
  if (
    !force &&
    existing?.loaded &&
    (existing.file.revision === selectedFile.file.revision ||
      existing.content !== existing.savedContent)
  ) {
    return;
  }
  const ownRequest = ++requestClock;
  requestClockByFile.set(key, ownRequest);
  initializeLoadingState(key, bookId, selectedFile.file);

  try {
    let offset = 0;
    const contentChunks: string[] = [];
    let firstPage: LongReadDocumentResult | undefined;
    while (true) {
      const page = await api.readDocument({
        bookId,
        fileId: selectedFile.file.id,
        offset,
        maxCharacters: DOCUMENT_PAGE_CHARACTERS
      });
      if (requestClockByFile.get(key) !== ownRequest) return;
      if (page.file.id !== selectedFile.file.id) {
        throw new Error("长篇文档读取结果与所选文件不一致。");
      }
      if (firstPage) {
        assertSameReadSnapshot(firstPage, page);
      } else {
        firstPage = page;
      }
      contentChunks.push(page.content);
      if (page.nextOffset === null) break;
      if (page.nextOffset <= offset) {
        throw new Error("长篇文档分页游标无效。");
      }
      offset = page.nextOffset;
    }

    if (!firstPage || requestClockByFile.get(key) !== ownRequest) return;
    const content = contentChunks.join("");
    // `locked` is a transient write barrier (proposal approval / send
    // preflight), not a property of the document. Recovery still needs to be
    // discovered while that barrier is active so it is not silently skipped
    // until a later remount.
    const editable =
      !selectedFile.readOnly && isEditableLongFile(firstPage.file);
    const recovery = editable
      ? readRecoveryRecord(bookId, firstPage.file.id)
      : null;
    const recoveryMatchesDisk =
      recovery?.baseRevision === firstPage.file.revision;
    const recoveredContent =
      recoveryMatchesDisk && recovery.content !== content
        ? recovery.content
        : content;
    const latestState = documentStates.value[key];
    replaceDocumentState(key, {
      bookId,
      file: firstPage.file,
      content: recoveredContent,
      savedContent: content,
      // Another document save can advance the shared CAS baseline while this
      // file is being paged in. Never regress to the older read baseline.
      workspaceRevision: Math.max(
        firstPage.workspaceRevision,
        latestState?.workspaceRevision ?? 0
      ),
      projectRevision: Math.max(
        firstPage.projectRevision,
        latestState?.projectRevision ?? 0
      ),
      loading: false,
      saving: false,
      loaded: true,
      loadError: null
    });
    if (recovery?.content === content) {
      clearRecoveryRecordForKey(key, bookId, firstPage.file.id);
    } else if (recoveryMatchesDisk) {
      removeStaleRecoveryState(key);
      uiMessage.info(
        `已恢复“${props.selection?.title ?? firstPage.file.path}”的本机未保存内容。`
      );
    } else if (recovery) {
      staleRecoveryByKey.value = {
        ...staleRecoveryByKey.value,
        [key]: recovery
      };
      uiMessage.warning(
        "检测到基于旧版本的长篇恢复副本：磁盘内容未被覆盖，副本已保留供你核对。"
      );
    } else {
      removeStaleRecoveryState(key);
    }
    if (
      props.bookId === bookId &&
      currentSelectionFile.value?.file.id === firstPage.file.id
    ) {
      emit("contextChange", {
        bookId,
        fileId: firstPage.file.id,
        fileRevision: firstPage.file.revision
      });
    }
  } catch (error: unknown) {
    const latest = documentStates.value[key];
    if (requestClockByFile.get(key) === ownRequest && latest) {
      const message =
        error instanceof Error ? error.message : "读取长篇文件失败。";
      replaceDocumentState(key, {
        ...latest,
        loading: false,
        loaded: false,
        loadError: message
      });
      uiMessage.error(message);
    }
  }
}

async function loadSelectedDocument(force = false): Promise<void> {
  const selectedFile = currentSelectionFile.value;
  if (!selectedFile) return;
  await loadWorkspaceDocument(selectedFile, force);
}

function restoreStaleRecovery(): void {
  const selectedFile = currentSelectionFile.value;
  const state = currentState.value;
  const recovery = currentStaleRecovery.value;
  if (
    !selectedFile ||
    !state ||
    !recovery ||
    currentReadOnly.value ||
    state.loading ||
    recovery.bookId !== state.bookId ||
    recovery.fileId !== state.file.id
  ) {
    return;
  }
  const key = stateKey(state.file.id, state.bookId);
  replaceDocumentState(key, {
    ...state,
    content: recovery.content
  });
  removeStaleRecoveryState(key);
  if (recovery.content === state.savedContent) {
    clearRecoveryRecordForKey(key, state.bookId, state.file.id);
  } else {
    // This explicit action rebases only the local recovery record. The next
    // disk save still uses the freshly-read disk CAS revisions in `state`.
    persistRecoveryForKey(key);
  }
  uiMessage.info("已载入恢复副本供你核对；磁盘文件尚未被修改。");
}

async function copyStaleRecovery(): Promise<void> {
  const recovery = currentStaleRecovery.value;
  if (!recovery) return;
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("当前环境不支持剪贴板");
    }
    await navigator.clipboard.writeText(recovery.content);
    uiMessage.success("恢复副本已复制到剪贴板。");
  } catch {
    uiMessage.warning("无法写入剪贴板；你仍可载入恢复副本后手工复制。");
  }
}

function selectRole(role: LongWorkspaceFileRole): void {
  activeRole.value = role;
}

async function saveDocumentState(
  key: string,
  announceSuccess: boolean
): Promise<boolean> {
  const api = resolveLongWorkspaceApi();
  const state = documentStates.value[key];
  if (
    !api ||
    !state ||
    state.loading ||
    state.saving ||
    state.content === state.savedContent
  ) {
    if (!api) {
      uiMessage.warning("当前环境未连接长篇工作区，请使用桌面客户端。");
    }
    return Boolean(api && state && !state.loading && !state.saving);
  }

  const bookId = state.bookId;
  const submittedContent = state.content;
  replaceDocumentState(key, { ...state, saving: true });
  try {
    const result = await api.writeDocument({
      bookId,
      fileId: state.file.id,
      content: submittedContent,
      baseRevision: state.file.revision,
      baseWorkspaceRevision: state.workspaceRevision,
      baseProjectRevision: state.projectRevision
    });
    const latest = documentStates.value[key];
    if (!latest) return false;
    const bookKeyPrefix = `${bookId}\u0000`;
    documentStates.value = Object.fromEntries(
      Object.entries(documentStates.value).map(([stateKeyValue, value]) => [
        stateKeyValue,
        stateKeyValue.startsWith(bookKeyPrefix)
          ? {
              ...value,
              ...(stateKeyValue === key
                ? {
                    file: result.file,
                    savedContent: submittedContent,
                    saving: false,
                    loaded: true,
                    loadError: null
                  }
                : {}),
              workspaceRevision: result.workspaceRevision,
              projectRevision: result.projectRevision
            }
          : value
      ])
    );
    emit("saved", result);
    if (
      props.bookId === bookId &&
      currentSelectionFile.value?.file.id === result.file.id
    ) {
      emit("contextChange", {
        bookId,
        fileId: result.file.id,
        fileRevision: result.file.revision
      });
    }
    const savedState = documentStates.value[key];
    if (savedState?.content === savedState?.savedContent) {
      clearRecoveryRecordForKey(key, bookId, result.file.id);
    } else if (savedState) {
      persistRecoveryForKey(key);
    }
    if (announceSuccess) {
      if (savedState?.content === savedState?.savedContent) {
        uiMessage.success(
          `已保存“${props.selection?.title ?? state.file.path}”`
        );
      } else {
        uiMessage.info("已保存提交时版本；保存期间的新修改仍待保存。");
      }
    }
    return true;
  } catch (error: unknown) {
    const latest = documentStates.value[key];
    if (latest) {
      replaceDocumentState(key, { ...latest, saving: false });
    }
    const message =
      error instanceof Error ? error.message : "保存长篇文件失败。";
    if (/revision|冲突|conflict/iu.test(message)) {
      uiMessage.warning(
        "文件已在其他位置更新，本次修改未覆盖磁盘内容；请保留当前文本并重新打开后合并。"
      );
    } else {
      uiMessage.error(message);
    }
    return false;
  }
}

function runExclusiveSave(task: () => Promise<boolean>): Promise<boolean> {
  if (activeSavePromise) return activeSavePromise;
  workspaceSavePending.value = true;
  const pending = task().finally(() => {
    workspaceSavePending.value = false;
    if (activeSavePromise === pending) {
      activeSavePromise = null;
    }
  });
  activeSavePromise = pending;
  return pending;
}

async function saveCurrentDocument(): Promise<void> {
  if (currentIsStructuredText.value) {
    if (!currentReadOnly.value && currentDirty.value) {
      await saveAllChanges();
    }
    return;
  }
  const selectedFile = currentSelectionFile.value;
  if (
    !selectedFile ||
    currentReadOnly.value ||
    !currentDirty.value
  ) {
    return;
  }
  await runExclusiveSave(() =>
    saveDocumentState(stateKey(selectedFile.file.id), true)
  );
}

/**
 * App.vue calls this before changing books or unmounting the long editor.
 * Writes are sequential because each CAS write advances the shared workspace
 * and project revisions consumed by the next dirty document.
 */
async function saveAllChanges(): Promise<boolean> {
  if (activeSavePromise && !(await activeSavePromise)) {
    return false;
  }
  const bookPrefix = `${props.bookId}\u0000`;
  const dirtyKeys = Object.entries(documentStates.value)
    .filter(
      ([key, state]) =>
        key.startsWith(bookPrefix) &&
        state.loaded &&
        state.content !== state.savedContent
    )
    .map(([key]) => key);
  const dirtyVolumeIds = Object.entries(volumeOutlineDrafts.value)
    .filter(
      ([, draft]) =>
        !draft.saving && draft.content !== draft.savedContent
    )
    .map(([volumeId]) => volumeId);
  const dirtyPlotPointSummaryIds = Object.entries(
    plotPointSummaryDrafts.value
  )
    .filter(
      ([, draft]) =>
        !draft.saving && draft.content !== draft.savedContent
    )
    .map(([plotPointId]) => plotPointId as LongArcId);
  const dirtyPlotPointStorylineIds = Object.entries(
    plotPointStorylineDrafts.value
  )
    .filter(
      ([, draft]) =>
        !draft.saving && draft.content !== draft.savedContent
    )
    .map(([plotPointId]) => plotPointId as LongArcId);
  const dirtyChapterOutlineIds = Object.entries(
    chapterCardOutlineDrafts.value
  )
    .filter(
      ([, draft]) =>
        !draft.saving && draft.content !== draft.savedContent
    )
    .map(([chapterCardId]) => chapterCardId as LongChapterCardId);
  const dirtyChapterWorldConstraintIds = Object.entries(
    chapterCardWorldConstraintDrafts.value
  )
    .filter(
      ([, draft]) =>
        !draft.saving && draft.content !== draft.savedContent
    )
    .map(([chapterCardId]) => chapterCardId as LongChapterCardId);
  if (
    !dirtyKeys.length &&
    !dirtyVolumeIds.length &&
    !dirtyPlotPointSummaryIds.length &&
    !dirtyPlotPointStorylineIds.length &&
    !dirtyChapterOutlineIds.length &&
    !dirtyChapterWorldConstraintIds.length
  ) {
    return true;
  }

  const saved = await runExclusiveSave(async () => {
    for (const key of dirtyKeys) {
      if (!(await saveDocumentState(key, false))) {
        return false;
      }
    }
    for (const volumeId of dirtyVolumeIds) {
      if (!(await saveVolumeOutline(volumeId))) {
        return false;
      }
    }
    for (const plotPointId of dirtyPlotPointSummaryIds) {
      if (!(await savePlotPointContent(plotPointId, "summary"))) {
        return false;
      }
    }
    for (const plotPointId of dirtyPlotPointStorylineIds) {
      if (!(await savePlotPointContent(plotPointId, "storyline"))) {
        return false;
      }
    }
    for (const chapterCardId of dirtyChapterOutlineIds) {
      if (!(await saveChapterCardContent(chapterCardId, "outline"))) {
        return false;
      }
    }
    for (const chapterCardId of dirtyChapterWorldConstraintIds) {
      if (
        !(await saveChapterCardContent(
          chapterCardId,
          "worldConstraints"
        ))
      ) {
        return false;
      }
    }
    // Editing remains available during an asynchronous save. A keystroke
    // after a file's submitted snapshot must keep navigation blocked instead
    // of being mistaken for part of the successful write.
    return !Object.entries(documentStates.value).some(
      ([key, state]) =>
        key.startsWith(bookPrefix) &&
        state.loaded &&
        state.content !== state.savedContent
    ) &&
      !Object.values(volumeOutlineDrafts.value).some(
        (draft) => draft.content !== draft.savedContent
      ) &&
      !Object.values(plotPointSummaryDrafts.value).some(
        (draft) => draft.content !== draft.savedContent
      ) &&
      !Object.values(plotPointStorylineDrafts.value).some(
        (draft) => draft.content !== draft.savedContent
      ) &&
      !Object.values(chapterCardOutlineDrafts.value).some(
        (draft) => draft.content !== draft.savedContent
      ) &&
      !Object.values(chapterCardWorldConstraintDrafts.value).some(
        (draft) => draft.content !== draft.savedContent
      );
  });
  if (saved) {
    const savedCount =
      dirtyKeys.length +
      dirtyVolumeIds.length +
      dirtyPlotPointSummaryIds.length +
      dirtyPlotPointStorylineIds.length +
      dirtyChapterOutlineIds.length +
      dirtyChapterWorldConstraintIds.length;
    uiMessage.success(
      `离开前已自动保存 ${savedCount} 项长篇修改`
    );
  } else {
    uiMessage.warning("长篇修改尚未保存，已取消切换以保留当前内容。");
  }
  return saved;
}

function synchronizeProjectRevisions(
  workspaceRevision: number,
  projectRevision: number
): void {
  if (
    !synchronizeProjectRevisionsIfClean(
      props.bookId,
      workspaceRevision,
      projectRevision,
      false
    )
  ) {
    throw new Error("存在未保存的长篇文档，不能刷新项目版本基线。");
  }
}

function synchronizeProjectRevisionsIfClean(
  bookId: string,
  workspaceRevision: number,
  projectRevision: number,
  includeVolumeDrafts = true
): boolean {
  // A ref can briefly outlive a book switch until Vue applies the new props.
  // Treat an inactive book as a no-op; `false` is reserved for a dirty current
  // book so App.vue only shows a conflict warning for real unsaved content.
  if (bookId !== props.bookId) return true;
  const prefix = `${bookId}\u0000`;
  const currentBookStates = Object.entries(documentStates.value).filter(
    ([key]) => key.startsWith(prefix)
  );
  if (
    includeVolumeDrafts &&
    (Object.values(volumeOutlineDrafts.value).some(
      (draft) =>
        !draft.saving && draft.content !== draft.savedContent
    ) ||
      Object.values(plotPointSummaryDrafts.value).some(
        (draft) =>
          !draft.saving && draft.content !== draft.savedContent
      ) ||
      Object.values(plotPointStorylineDrafts.value).some(
        (draft) =>
          !draft.saving && draft.content !== draft.savedContent
      ) ||
      Object.values(chapterCardOutlineDrafts.value).some(
        (draft) =>
          !draft.saving && draft.content !== draft.savedContent
      ) ||
      Object.values(chapterCardWorldConstraintDrafts.value).some(
        (draft) =>
          !draft.saving && draft.content !== draft.savedContent
      ))
  ) {
    return false;
  }
  if (
    currentBookStates.every(
      ([, state]) =>
        state.workspaceRevision === workspaceRevision &&
        state.projectRevision === projectRevision
    )
  ) {
    return true;
  }
  if (
    currentBookStates.some(
      ([, state]) => state.loaded && state.content !== state.savedContent
    )
  ) {
    return false;
  }
  documentStates.value = Object.fromEntries(
    Object.entries(documentStates.value).map(([key, state]) => [
      key,
      key.startsWith(prefix)
        ? {
            ...state,
            workspaceRevision,
            projectRevision
          }
        : state
    ])
  );
  return true;
}

defineExpose({
  saveAllChanges,
  selectBookLineVolume,
  synchronizeProjectRevisions,
  synchronizeProjectRevisionsIfClean
});

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  flushAllRecoveryRecords();
  if (!hasUnsavedChanges.value) return;
  event.preventDefault();
  event.returnValue = "";
}

watch(
  () =>
    [
      props.bookId,
      props.workspaceIndex?.revision
    ] as const,
  () => {
    if (volumeDraftBookId !== props.bookId) {
      volumeDraftBookId = props.bookId;
      volumeOutlineDrafts.value = {};
      plotPointSummaryDrafts.value = {};
      plotPointStorylineDrafts.value = {};
      chapterCardOutlineDrafts.value = {};
      chapterCardWorldConstraintDrafts.value = {};
      activeBookLineVolumeId.value = null;
      activeBookLineContentTab.value = "outline";
      activePlotPointTab.value = "summary";
      activeChapterCardTab.value = "outline";
    }
    const volumes = props.workspaceIndex?.plot.volumes ?? [];
    const next: Record<string, LongVolumeOutlineDraft> = {};
    for (const volume of volumes) {
      const existing = volumeOutlineDrafts.value[volume.id];
      next[volume.id] =
        existing &&
        (existing.saving ||
          existing.content !== existing.savedContent)
          ? existing
          : {
              content: volume.summary,
              savedContent: volume.summary,
              saving: false
            };
    }
    volumeOutlineDrafts.value = next;
    const nextSummaries: Record<string, LongVolumeOutlineDraft> = {};
    const nextStorylines: Record<string, LongVolumeOutlineDraft> = {};
    for (const plotPoint of props.workspaceIndex?.plot.arcs ?? []) {
      const existingSummary = plotPointSummaryDrafts.value[plotPoint.id];
      nextSummaries[plotPoint.id] =
        existingSummary &&
        (existingSummary.saving ||
          existingSummary.content !== existingSummary.savedContent)
          ? existingSummary
          : {
              content: plotPoint.summary ?? "",
              savedContent: plotPoint.summary ?? "",
              saving: false
            };
      const existingStoryline =
        plotPointStorylineDrafts.value[plotPoint.id];
      nextStorylines[plotPoint.id] =
        existingStoryline &&
        (existingStoryline.saving ||
          existingStoryline.content !== existingStoryline.savedContent)
          ? existingStoryline
          : {
              content: plotPoint.outline,
              savedContent: plotPoint.outline,
              saving: false
            };
    }
    plotPointSummaryDrafts.value = nextSummaries;
    plotPointStorylineDrafts.value = nextStorylines;
    const nextChapterOutlines: Record<string, LongVolumeOutlineDraft> = {};
    const nextChapterWorldConstraints: Record<
      string,
      LongVolumeOutlineDraft
    > = {};
    for (const chapterCard of props.workspaceIndex?.plot.chapterCards ?? []) {
      const existingOutline =
        chapterCardOutlineDrafts.value[chapterCard.id];
      nextChapterOutlines[chapterCard.id] =
        existingOutline &&
        (existingOutline.saving ||
          existingOutline.content !== existingOutline.savedContent)
          ? existingOutline
          : {
              content: chapterCard.outline,
              savedContent: chapterCard.outline,
              saving: false
            };
      const existingWorldConstraints =
        chapterCardWorldConstraintDrafts.value[chapterCard.id];
      nextChapterWorldConstraints[chapterCard.id] =
        existingWorldConstraints &&
        (existingWorldConstraints.saving ||
          existingWorldConstraints.content !==
            existingWorldConstraints.savedContent)
          ? existingWorldConstraints
          : {
              content: chapterCard.worldConstraints,
              savedContent: chapterCard.worldConstraints,
              saving: false
            };
    }
    chapterCardOutlineDrafts.value = nextChapterOutlines;
    chapterCardWorldConstraintDrafts.value =
      nextChapterWorldConstraints;
    if (
      activeBookLineVolumeId.value &&
      !volumes.some(({ id }) => id === activeBookLineVolumeId.value)
    ) {
      activeBookLineVolumeId.value = null;
    }
  },
  // The workspace index is replaced atomically for every refresh. Tracking its
  // monotonic revision avoids recursively subscribing to every plot entity and
  // lets Vue batch the draft reconciliation outside the input event.
  { immediate: true, flush: "post" }
);

watch(
  () =>
    [
      props.bookId,
      props.selection?.key,
      props.selection?.preferredRole
    ] as const,
  () => {
    activeRole.value = props.selection?.preferredRole ?? "content";
  },
  { immediate: true, flush: "sync" }
);

watch(
  () =>
    [
      props.bookId,
      currentStructureTitleTarget.value?.kind,
      currentStructureTitleTarget.value?.id,
      currentStructureTitleTarget.value?.title
    ] as const,
  resetStructureTitleDraft,
  { immediate: true, flush: "sync" }
);

watch(
  () =>
    [
      props.bookId,
      props.selection?.characterId,
      props.selection?.title
    ] as const,
  resetCharacterNameDraft,
  { immediate: true, flush: "sync" }
);

watch(
  () =>
    [
      props.bookId,
      currentSelectionFile.value?.file.id,
      activeWorldbuildingItemId.value,
      activeBookLineVolumeId.value,
      activeBookLineContentTab.value,
      props.selection?.plotPointId,
      activePlotPointTab.value,
      props.selection?.chapterCardId,
      activeChapterCardTab.value
    ] as const,
  () => {
    viewMode.value = "edit";
    closeFindPanel();
    searchQuery.value = "";
    replacementText.value = "";
    undoHistory.value = [];
    redoHistory.value = [];
  },
  { flush: "sync" }
);

watch(
  () =>
    [
      props.bookId,
      props.selection?.key,
      currentWorldbuildingItems.value.map(({ id }) => id).join("\u0000")
    ] as const,
  () => {
    const items = currentWorldbuildingItems.value;
    if (
      !items.some(({ id }) => id === activeWorldbuildingItemId.value)
    ) {
      activeWorldbuildingItemId.value = items[0]?.id ?? null;
    }
    if (
      !items.some(({ id }) => id === pendingWorldbuildingDeleteId.value)
    ) {
      pendingWorldbuildingDeleteId.value = null;
    }
  },
  { immediate: true, flush: "sync" }
);

watch(
  () =>
    [
      props.bookId,
      currentSelectionFile.value?.file.id,
      currentSelectionFile.value?.file.revision
    ] as const,
  () => {
    const selectedFile = currentSelectionFile.value;
    emit(
      "contextChange",
      selectedFile
        ? {
            bookId: props.bookId,
            fileId: selectedFile.file.id,
            fileRevision: selectedFile.file.revision
          }
        : null
    );
    void loadSelectedDocument();
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("pointerdown", handleWindowPointerDown, true);
});
onBeforeUnmount(() => {
  flushAllRecoveryRecords();
  for (const key of [...recoveryWriteTimers.keys()]) {
    cancelRecoveryWrite(key);
  }
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.removeEventListener("pointerdown", handleWindowPointerDown, true);
  requestClockByFile.clear();
});
</script>

<template>
  <section
    class="long-workspace-editor"
    :class="{
      'is-foreshadowing-overview': currentIsForeshadowingWorkspace,
      'has-navigation-tabs':
        currentIsCharacterGroup ||
        currentIsBookLineWorkspace ||
        currentIsPlotPointWorkspace ||
        currentIsChapterCardWorkspace ||
        (currentIsWorldbuildingList &&
          currentState?.loaded &&
          !currentWorldbuildingListState.error)
    }"
    aria-label="长篇文件编辑器"
  >
    <template v-if="selection">
      <header class="long-editor-header">
        <div
          class="long-editor-breadcrumbs"
          :title="selection.breadcrumbs.join(' / ')"
        >
          <span
            v-for="(part, index) in selection.breadcrumbs"
            :key="`${part}-${index}`"
          >
            {{ part }}
            <i v-if="index < selection.breadcrumbs.length - 1">/</i>
          </span>
        </div>
        <div class="long-editor-header-actions">
          <span
            class="long-editor-save-state"
            :class="{ 'is-dirty': currentDirty }"
          >
            <AppIcon
              :name="currentDirty ? 'save' : 'check'"
              :size="13"
            />
            <span>
              {{
                currentIsForeshadowingView
                  ? locked
                    ? lockedReason ?? "编辑暂时锁定"
                    : currentDirty
                      ? "关联文本有未保存修改"
                      : "伏笔数据已同步"
                  : !currentSelectionFile && !currentIsStructuredText
                  ? "已选择工作区上下文"
                  : locked
                    ? lockedReason ?? "编辑暂时锁定"
                    : currentSelectionFile?.readOnly
                      ? "只读记录"
                      : currentState?.loading
                        ? "正在读取"
                        : currentSaving
                          ? "正在保存到本机"
                          : currentDirty
                            ? "有未保存修改"
                            : currentState?.loaded || currentIsStructuredText
                              ? "已保存到本机"
                              : "等待读取"
              }}
            </span>
          </span>
          <button
            class="long-editor-collapse-button"
            type="button"
            aria-label="收起长篇编辑栏"
            @click="emit('collapse')"
          >
            <AppIcon name="panel-right" :size="18" />
          </button>
        </div>
      </header>

      <nav
        v-if="currentIsCharacterGroup"
        class="section-tabs-bar long-worldbuilding-tabs long-character-tabs"
        :aria-label="`${selection.characterGroup ?? '人物'}人物`"
      >
        <div class="section-tabs-scroll" role="tablist">
          <button
            v-for="character in selection.characterTabs"
            :key="character.id"
            class="section-tab"
            :class="{
              'is-active': selection.characterId === character.id
            }"
            type="button"
            role="tab"
            :aria-selected="selection.characterId === character.id"
            :title="character.label"
            :disabled="locked"
            @click="emit('selectCharacter', character.id)"
          >
            {{ character.label }}
          </button>
        </div>
        <button
          class="long-worldbuilding-add"
          type="button"
          aria-label="新增人物"
          title="新增人物"
          :disabled="locked"
          @click="emit('createCharacter')"
        >
          <AppIcon name="plus" :size="15" />
        </button>
      </nav>

      <nav
        v-if="currentIsBookLineWorkspace"
        class="section-tabs-bar long-worldbuilding-tabs long-book-line-tabs"
        aria-label="全书故事线"
      >
        <div class="section-tabs-scroll" role="tablist">
          <button
            class="section-tab"
            :class="{ 'is-active': activeBookLineVolumeId === null }"
            type="button"
            role="tab"
            :aria-selected="activeBookLineVolumeId === null"
            title="全书总纲"
            @click="selectBookLineOverview"
          >
            全书总纲
          </button>
          <button
            v-for="volume in orderedBookLineVolumes"
            :key="volume.id"
            class="section-tab"
            :class="{ 'is-active': activeBookLineVolumeId === volume.id }"
            type="button"
            role="tab"
            :aria-selected="activeBookLineVolumeId === volume.id"
            :title="volume.title"
            @click="selectBookLineVolume(volume.id)"
          >
            {{ volume.title }}
          </button>
        </div>
        <button
          v-if="!currentReadOnly"
          class="long-worldbuilding-add"
          type="button"
          aria-label="新建分卷"
          title="新建分卷"
          @click="requestCreateVolume"
        >
          <AppIcon name="plus" :size="15" />
        </button>
      </nav>

      <nav
        v-if="currentIsPlotPointWorkspace"
        class="section-tabs-bar long-worldbuilding-tabs long-plot-point-tabs"
        :aria-label="`${selection.breadcrumbs.at(-1) ?? '当前分卷'}剧情点`"
      >
        <div class="section-tabs-scroll" role="tablist">
          <button
            v-for="plotPoint in selection.plotPointTabs"
            :key="plotPoint.id"
            class="section-tab"
            :class="{ 'is-active': selection.plotPointId === plotPoint.id }"
            type="button"
            role="tab"
            :aria-selected="selection.plotPointId === plotPoint.id"
            :title="plotPoint.label"
            @click="emit('selectPlotPoint', plotPoint.id)"
          >
            {{ plotPoint.label }}
          </button>
        </div>
        <button
          v-if="!currentReadOnly"
          class="long-worldbuilding-add"
          type="button"
          aria-label="新增剧情点"
          title="新增剧情点"
          :disabled="locked"
          @click="emit('createPlotPoint')"
        >
          <AppIcon name="plus" :size="15" />
        </button>
      </nav>

      <nav
        v-if="currentIsChapterCardWorkspace"
        class="section-tabs-bar long-worldbuilding-tabs long-chapter-card-tabs"
        :aria-label="`${selection.breadcrumbs[3] ?? '当前分卷'}章卡`"
      >
        <div class="section-tabs-scroll" role="tablist">
          <button
            v-for="chapterCard in selection.chapterCardTabs"
            :key="chapterCard.id"
            class="section-tab"
            :class="{
              'is-active': selection.chapterCardId === chapterCard.id
            }"
            type="button"
            role="tab"
            :aria-selected="selection.chapterCardId === chapterCard.id"
            :title="chapterCard.label"
            :disabled="locked"
            @click="emit('selectChapterCard', chapterCard.id)"
          >
            {{ chapterCard.label }}
          </button>
        </div>
        <button
          class="long-worldbuilding-add"
          type="button"
          aria-label="新增章卡"
          title="新增章卡"
          :disabled="locked"
          @click="emit('createChapterCard')"
        >
          <AppIcon name="plus" :size="15" />
        </button>
      </nav>

      <nav
        v-if="
          currentIsWorldbuildingList &&
          currentState?.loaded &&
          !currentWorldbuildingListState.error
        "
        class="section-tabs-bar long-worldbuilding-tabs"
        aria-label="世界观条目"
      >
        <div class="section-tabs-scroll" role="tablist">
          <button
            v-for="item in currentWorldbuildingItems"
            :key="item.id"
            class="section-tab"
            :class="{
              'is-active': currentWorldbuildingItem?.id === item.id
            }"
            type="button"
            role="tab"
            :aria-selected="currentWorldbuildingItem?.id === item.id"
            :title="item.title"
            @click="selectWorldbuildingItem(item.id)"
          >
            {{ item.title }}
          </button>
        </div>
        <button
          v-if="!currentReadOnly"
          class="long-worldbuilding-add"
          type="button"
          aria-label="新建世界观条目"
          title="新建条目"
          @click="addWorldbuildingItem"
        >
          <AppIcon name="plus" :size="15" />
        </button>
      </nav>

      <div
        v-if="!currentIsForeshadowingWorkspace"
        class="long-editor-toolbar"
      >
        <div
          v-if="currentIsBookLineWorkspace && currentBookLineVolume"
          class="long-editor-file-tabs"
          role="tablist"
          :aria-label="`${currentBookLineVolume.title}内容`"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeBookLineContentTab === 'outline'"
            :class="{
              'is-active': activeBookLineContentTab === 'outline'
            }"
            :disabled="locked"
            @click="selectBookLineContentTab('outline')"
          >
            卷纲
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="
              activeBookLineContentTab === 'foreshadowing'
            "
            :class="{
              'is-active':
                activeBookLineContentTab === 'foreshadowing'
            }"
            :disabled="locked"
            @click="selectBookLineContentTab('foreshadowing')"
          >
            本卷伏笔
          </button>
        </div>
        <div
          v-if="currentIsPlotPointWorkspace && currentPlotPoint"
          class="long-editor-file-tabs"
          role="tablist"
          :aria-label="`${currentPlotPoint?.title ?? '当前剧情点'}内容`"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activePlotPointTab === 'summary'"
            :class="{ 'is-active': activePlotPointTab === 'summary' }"
            :disabled="locked"
            @click="selectPlotPointTab('summary')"
          >
            概要
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activePlotPointTab === 'storyline'"
            :class="{ 'is-active': activePlotPointTab === 'storyline' }"
            :disabled="locked"
            @click="selectPlotPointTab('storyline')"
          >
            故事情节
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activePlotPointTab === 'foreshadowing'"
            :class="{
              'is-active': activePlotPointTab === 'foreshadowing'
            }"
            :disabled="locked"
            @click="selectPlotPointTab('foreshadowing')"
          >
            伏笔触点
          </button>
        </div>
        <div
          v-if="currentIsChapterCardWorkspace && currentChapterCard"
          class="long-editor-file-tabs"
          role="tablist"
          :aria-label="`${currentChapterCard.title}内容`"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeChapterCardTab === 'outline'"
            :class="{ 'is-active': activeChapterCardTab === 'outline' }"
            :disabled="locked"
            @click="selectChapterCardContentTab('outline')"
          >
            章节大纲
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeChapterCardTab === 'worldConstraints'"
            :class="{
              'is-active': activeChapterCardTab === 'worldConstraints'
            }"
            :disabled="locked"
            @click="selectChapterCardContentTab('worldConstraints')"
          >
            世界约束
          </button>
        </div>
        <div
          v-if="selection.files.length > 1"
          class="long-editor-file-tabs"
          role="tablist"
          :aria-label="`${selection.title}文件`"
        >
          <button
            v-for="file in selection.files"
            :key="file.role"
            type="button"
            role="tab"
            :aria-selected="currentSelectionFile?.role === file.role"
            :class="{ 'is-active': currentSelectionFile?.role === file.role }"
            :disabled="locked"
            @click="selectRole(file.role)"
          >
            {{ file.label }}
          </button>
        </div>
        <span
          v-if="
            !currentIsForeshadowingView &&
            ((currentIsBookLineWorkspace && currentBookLineVolume) ||
              (currentIsPlotPointWorkspace && currentPlotPoint) ||
              (currentIsChapterCardWorkspace && currentChapterCard) ||
              selection.files.length > 1)
          "
          class="long-toolbar-separator"
        />
        <div
          v-if="!currentIsForeshadowingView"
          class="long-editor-view-tabs"
          role="tablist"
          aria-label="文本视图"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'edit'"
            :class="{ 'is-active': viewMode === 'edit' }"
            :disabled="!canUseTextTools"
            @click="viewMode = 'edit'"
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="viewMode === 'preview'"
            :class="{ 'is-active': viewMode === 'preview' }"
            :disabled="!canUseTextTools"
            @click="viewMode = 'preview'"
          >
            预览
          </button>
        </div>
        <span
          v-if="!currentIsForeshadowingView"
          class="long-toolbar-separator"
        />
        <div
          v-if="!currentIsForeshadowingView"
          ref="editorToolsElement"
          class="long-editor-text-tools"
          role="group"
          aria-label="文本操作"
        >
          <button
            class="long-format-button"
            type="button"
            aria-label="撤销"
            title="撤销（⌘/Ctrl+Z）"
            :disabled="!canUndo"
            @mousedown.prevent
            @click="undo"
          >
            <AppIcon name="undo" :size="16" />
          </button>
          <button
            class="long-format-button"
            type="button"
            aria-label="还原"
            title="还原（⌘/Ctrl+Shift+Z）"
            :disabled="!canRedo"
            @mousedown.prevent
            @click="redo"
          >
            <AppIcon name="redo" :size="16" />
          </button>
          <button
            class="long-format-button"
            :class="{
              'is-active': findPanelOpen && findPanelMode === 'find'
            }"
            type="button"
            aria-label="查找"
            title="查找（⌘/Ctrl+F）"
            :disabled="!canUseTextTools"
            :aria-pressed="findPanelOpen && findPanelMode === 'find'"
            @mousedown.prevent
            @click="toggleFindPanel('find')"
          >
            <AppIcon name="search" :size="16" />
          </button>
          <button
            class="long-format-button"
            :class="{
              'is-active': findPanelOpen && findPanelMode === 'replace'
            }"
            type="button"
            aria-label="替换"
            title="替换（⌘⌥F / Ctrl+H）"
            :disabled="!canUseTextTools"
            :aria-pressed="findPanelOpen && findPanelMode === 'replace'"
            @mousedown.prevent
            @click="toggleFindPanel('replace')"
          >
            <AppIcon name="replace" :size="16" />
          </button>

          <div
            v-if="findPanelOpen"
            ref="findPanelElement"
            class="long-editor-find-panel"
            role="dialog"
            :aria-label="
              findPanelMode === 'replace' ? '查找和替换' : '查找文字'
            "
            @keydown.esc.stop="closeFindPanel"
          >
            <div class="long-editor-find-row">
              <label class="long-editor-find-field">
                <AppIcon name="search" :size="14" />
                <input
                  ref="findInput"
                  v-model="searchQuery"
                  type="text"
                  aria-label="查找文字"
                  placeholder="查找"
                  @input="handleFindInput"
                  @keydown.enter.prevent="
                    findMatch($event.shiftKey ? -1 : 1)
                  "
                />
                <span class="long-editor-find-count" aria-live="polite">
                  {{ searchResultLabel }}
                </span>
              </label>
              <button
                class="long-editor-find-icon-button is-previous"
                type="button"
                aria-label="查找上一个"
                title="查找上一个"
                @click="findMatch(-1)"
              >
                <AppIcon name="chevron" :size="14" />
              </button>
              <button
                class="long-editor-find-icon-button"
                type="button"
                aria-label="查找下一个"
                title="查找下一个"
                @click="findMatch(1)"
              >
                <AppIcon name="chevron" :size="14" />
              </button>
              <button
                class="long-editor-find-icon-button"
                type="button"
                aria-label="关闭查找"
                title="关闭"
                @click="closeFindPanel"
              >
                <AppIcon name="close" :size="14" />
              </button>
            </div>
            <div
              v-if="findPanelMode === 'replace'"
              class="long-editor-replace-row"
            >
              <label class="long-editor-find-field">
                <AppIcon name="replace" :size="14" />
                <input
                  v-model="replacementText"
                  type="text"
                  aria-label="替换为"
                  placeholder="替换为"
                  :disabled="currentReadOnly"
                  @keydown.enter.prevent="replaceCurrentMatch"
                />
              </label>
              <button
                class="long-editor-find-action"
                type="button"
                :disabled="currentReadOnly"
                @click="replaceCurrentMatch"
              >
                替换
              </button>
              <button
                class="long-editor-find-action"
                type="button"
                :disabled="currentReadOnly"
                @click="replaceAllMatches"
              >
                全部
              </button>
            </div>
          </div>
        </div>
        <span class="long-toolbar-spacer" />
        <div class="long-editor-toolbar-actions">
          <button
            v-if="
              latestCommit?.reversible &&
              (selection.root === 'draft' ||
                selection.root === 'continuity_ledger')
            "
            class="long-editor-rollback-button"
            type="button"
            :title="`回滚提交 #${latestCommit.sequence}`"
            :disabled="locked"
            @click="emit('rollback')"
          >
            <AppIcon name="history" :size="14" />
            <span>回滚最后提交</span>
          </button>
        </div>
      </div>

      <div class="long-editor-document">
        <aside
          v-if="currentStaleRecovery"
          class="long-editor-recovery"
          role="status"
          aria-live="polite"
        >
          <details open>
            <summary>发现旧版本恢复副本</summary>
            <div class="long-editor-recovery-content">
              <p>
                磁盘文件已变化，因此没有自动覆盖。副本仍保存在本机，
                你可以先复制，或明确载入后自行核对合并。
              </p>
              <small>
                副本基线 {{ currentStaleRecovery.baseRevision }} ·
                {{ new Date(currentStaleRecovery.timestamp).toLocaleString() }}
              </small>
              <pre>{{ currentStaleRecoveryPreview }}</pre>
              <div class="long-editor-recovery-actions">
                <button type="button" @click="copyStaleRecovery">
                  复制副本
                </button>
                <button
                  class="is-primary"
                  type="button"
                  :disabled="currentReadOnly"
                  @click="restoreStaleRecovery"
                >
                  载入副本核对
                </button>
              </div>
            </div>
          </details>
        </aside>
        <LongForeshadowingWorkspace
          v-if="currentIsForeshadowingView && workspaceIndex"
          :snapshot="workspaceIndex"
          :mode="currentForeshadowingMode"
          :volume-id="currentForeshadowingVolumeId"
          :plot-point-id="currentPlotPoint?.id"
          :disabled="locked"
          @mutation="forwardForeshadowingMutation"
        />
        <div
          v-else-if="currentState?.loading"
          class="long-editor-loading"
        >
          <span class="long-loading-dot" />
          <span>正在读取文件内容…</span>
        </div>
        <div
          v-else-if="currentState?.loadError"
          class="long-editor-unavailable"
          role="status"
        >
          <AppIcon name="file" :size="22" />
          <strong>文件读取失败</strong>
          <span>{{ currentState.loadError }}</span>
          <button
            type="button"
            :disabled="workspaceSavePending"
            @click="loadSelectedDocument(true)"
          >
            重新读取
          </button>
        </div>
        <article
          v-else-if="
            currentReadOnly &&
            currentState?.loaded &&
            currentLedgerRecord
          "
          class="long-ledger-record"
        >
          <header>
            <small>
              提交 #{{ currentLedgerRecord.sequence }} ·
              {{ currentLedgerRecord.committedAt }}
            </small>
            <h3>
              {{
                currentLedgerRecord.commitMessage ||
                "旧版账本记录（未保存提交说明）"
              }}
            </h3>
          </header>
          <section>
            <h4>本章连续性摘要</h4>
            <dl>
              <template
                v-for="([label, value], index) in currentLedgerSummaryRows"
                :key="`${label}-${index}`"
              >
                <dt>{{ label }}</dt>
                <dd>{{ value || "旧版记录未保存此项摘要" }}</dd>
              </template>
            </dl>
          </section>
          <section>
            <h4>执行证据</h4>
            <p
              v-for="change in currentLedgerRecord.placementChanges"
              :key="change.placementId"
            >
              <code>{{ change.placementId }}</code>
              <span>{{ change.after.status }} · {{ change.note || "旧版记录无证据说明" }}</span>
            </p>
            <p
              v-for="change in currentLedgerRecord.foreshadowingBeatChanges"
              :key="change.beatId"
            >
              <code>{{ change.beatId }}</code>
              <span>{{ change.after.status }} · {{ change.note || "旧版记录无证据说明" }}</span>
            </p>
          </section>
          <section
            v-if="currentLedgerRecord.foreshadowingThreadChanges.length"
          >
            <h4>伏笔线状态推导</h4>
            <p
              v-for="change in currentLedgerRecord
                .foreshadowingThreadChanges"
              :key="change.foreshadowingId"
            >
              <code>{{ change.foreshadowingId }}</code>
              <span>{{ change.before }} → {{ change.after }}</span>
            </p>
          </section>
          <details>
            <summary>查看原始审计记录</summary>
            <pre class="long-editor-readonly">{{ currentState.content }}</pre>
          </details>
        </article>
        <div
          v-else-if="
            currentState?.loaded ||
            (currentIsChapterCardWorkspace && currentChapterCard)
          "
          class="long-editor-writing-surface"
          :class="{ 'is-readonly': currentReadOnly }"
        >
          <div
            v-if="
              currentIsWorldbuildingList &&
              !currentWorldbuildingListState.error &&
              !currentWorldbuildingItem
            "
            class="long-worldbuilding-empty"
          >
            <AppIcon name="file" :size="22" />
            <strong>还没有世界观条目</strong>
            <span>新建条目后，可通过上方 Tab 切换并编辑内容。</span>
            <button
              v-if="!currentReadOnly"
              type="button"
              @click="addWorldbuildingItem"
            >
              新建第一个条目
            </button>
          </div>
          <template v-else>
            <div class="long-document-meta-row">
              <span>{{ documentEyebrow }}</span>
              <span v-if="currentDocumentFormat" class="long-document-format">
                {{ currentDocumentFormat }}
              </span>
              <span v-if="currentReadOnly" class="long-readonly-badge">
                只读内容
              </span>
              <button
                v-if="
                  currentIsWorldbuildingList &&
                  currentWorldbuildingItem &&
                  !currentReadOnly
                "
                class="long-worldbuilding-delete-button"
                type="button"
                :disabled="locked"
                @click="
                  openWorldbuildingItemDelete(
                    currentWorldbuildingItem.id
                  )
                "
              >
                删除条目
              </button>
            </div>
            <input
              v-if="
                currentIsWorldbuildingList &&
                !currentWorldbuildingListState.error &&
                currentWorldbuildingItem
              "
              :value="currentWorldbuildingItem.title"
              class="long-document-title-input"
              :readonly="currentReadOnly || locked"
              maxlength="256"
              autocomplete="off"
              aria-label="世界观条目名称"
              @change="
                updateWorldbuildingItemTitle(
                  currentWorldbuildingItem.id,
                  $event
                )
              "
            />
            <input
              v-else-if="currentIsCharacterDocument"
              v-model="characterNameDraft"
              class="long-document-title-input"
              :readonly="locked || characterNameSaving"
              maxlength="256"
              autocomplete="off"
              aria-label="人物姓名"
              @change="saveCharacterName"
              @keydown="handleCharacterNameKeydown"
            />
            <input
              v-else-if="currentStructureTitleTarget"
              v-model="structureTitleDraft"
              class="long-document-title-input"
              :readonly="currentStructureTitleReadOnly"
              maxlength="256"
              autocomplete="off"
              :aria-label="currentStructureTitleTarget.inputLabel"
              @change="saveStructureTitle"
              @keydown="handleStructureTitleKeydown"
            />
            <h1 v-else class="long-document-title">
              {{ currentDocumentTitle }}
            </h1>
            <textarea
              v-if="viewMode === 'edit'"
              ref="editorInput"
              :value="currentVisibleContent"
              class="long-document-editor"
              :readonly="currentReadOnly"
              :aria-label="`${currentDocumentTitle}${currentDocumentFormat || '内容'}`"
              :maxlength="
                currentIsStructuredText
                  ? 200000
                  : currentIsWorldbuildingList &&
                      !currentWorldbuildingListState.error
                    ? 1000000
                    : undefined
              "
              spellcheck="false"
              @beforeinput="handleEditorBeforeInput"
              @input="
                updateVisibleContent(
                  ($event.target as HTMLTextAreaElement).value
                )
              "
              @keydown="handleEditorKeydown"
            />
            <article v-else class="long-document-preview">
              <p
                v-for="(paragraph, index) in previewParagraphs"
                :key="index"
              >
                {{ paragraph }}
              </p>
              <p v-if="!previewParagraphs.length" class="is-empty">
                {{
                  currentIsPlotPointStoryline
                    ? "暂无故事情节"
                    : currentIsPlotPointSummary
                      ? "暂无概要"
                      : currentIsChapterCardWorldConstraints
                        ? "暂无世界约束"
                        : currentIsChapterCardOutline
                          ? "暂无章节大纲"
                      : currentIsVolumeOutline
                        ? "暂无卷纲"
                        : "暂无正文"
                }}
              </p>
            </article>
          </template>
        </div>
        <div
          v-else-if="currentEmptyCollection"
          class="long-editor-writing-surface"
        >
          <div class="long-worldbuilding-empty">
            <AppIcon :name="currentEmptyCollection.icon" :size="22" />
            <strong>{{ currentEmptyCollection.title }}</strong>
            <span>{{ currentEmptyCollection.description }}</span>
            <button
              type="button"
              :disabled="locked"
              @click="createFirstCollectionItem"
            >
              {{ currentEmptyCollection.buttonLabel }}
            </button>
          </div>
        </div>
        <div v-else class="long-editor-unavailable">
          <AppIcon
            :name="
              selection.key.startsWith('character-group:')
                ? 'user'
                : 'file'
            "
            :size="22"
          />
          <strong>{{ selection.title }}</strong>
          <span>
            {{
              selection.description ??
              "选择该目录中的文件后将在这里加载内容。"
            }}
          </span>
        </div>
      </div>

      <footer class="long-editor-footer">
        <span>
          {{
            currentIsForeshadowingView
              ? `${workspaceIndex?.plot.foreshadowing.length ?? 0} 条伏笔线`
              : `${characterCount.toLocaleString("zh-CN")} 字`
          }}
        </span>
        <span>
          {{
            currentIsForeshadowingView
              ? locked
                ? lockedReason ?? "编辑暂时锁定"
                : "结构修改会直接保存到本机"
              : locked
              ? lockedReason ?? "编辑暂时锁定 · 防止版本冲突"
              : currentSaving
                ? "正在原子保存本机文稿"
                : currentReadOnly
                  ? "本机文稿 · 只读"
                  : currentDirty
                    ? "本机文稿 · 有未保存修改"
                    : currentState?.loaded || currentIsStructuredText
                      ? "本机文稿 · 已保存"
                      : "本机文稿 · 等待读取"
          }}
        </span>
        <span class="long-footer-spacer" />
        <button
          v-if="!currentIsForeshadowingView"
          class="long-editor-save-button"
          type="button"
          :disabled="
            currentReadOnly ||
            !currentDirty ||
            currentState?.loading ||
            currentSaving ||
            workspaceSavePending
          "
          @click="saveCurrentDocument"
        >
          <AppIcon name="save" :size="14" />
          {{ currentSaving ? "保存中…" : "立即保存" }}
        </button>
      </footer>
    </template>

    <div v-else class="long-editor-empty">
      <span class="long-editor-empty-icon">
        <AppIcon name="book" :size="28" />
      </span>
      <h2>选择一个长篇文件</h2>
      <p>从左侧五个工作区根目录中选择设定、人物、故事线、章节或账本记录。</p>
    </div>

    <Teleport to="body">
      <div
        v-if="pendingWorldbuildingDeleteItem"
        class="dialog-backdrop long-worldbuilding-delete-overlay"
        @mousedown.self="closeWorldbuildingItemDelete"
        @keydown="handleWorldbuildingDeleteKeydown"
      >
        <section
          ref="worldbuildingDeleteDialog"
          class="long-worldbuilding-delete-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="long-worldbuilding-delete-title"
          aria-describedby="long-worldbuilding-delete-description"
          tabindex="-1"
        >
          <span>删除世界观条目</span>
          <h3 id="long-worldbuilding-delete-title">
            确认删除“{{ pendingWorldbuildingDeleteItem.title }}”？
          </h3>
          <p id="long-worldbuilding-delete-description">
            保存后该条目及其内容将从本机文件中删除。
          </p>
          <footer>
            <button
              ref="worldbuildingDeleteCancelButton"
              type="button"
              @click="closeWorldbuildingItemDelete"
            >
              取消
            </button>
            <button
              class="is-danger"
              type="button"
              @click="confirmWorldbuildingItemDelete"
            >
              确认删除
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.long-workspace-editor {
  container-type: inline-size;
  display: grid;
  grid-template-rows:
    minmax(50px, auto) minmax(40px, auto) minmax(0, 1fr)
    minmax(36px, auto);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--theme-line);
  background: var(--surface-main);
  color: var(--text-primary);
}

.long-workspace-editor.has-navigation-tabs {
  grid-template-rows:
    minmax(50px, auto) minmax(42px, auto) minmax(40px, auto)
    minmax(0, 1fr) minmax(36px, auto);
}

.long-workspace-editor.is-foreshadowing-overview {
  grid-template-rows:
    minmax(50px, auto) minmax(0, 1fr) minmax(36px, auto);
}

:global(html[data-platform="darwin"] .long-workspace-editor) {
  grid-template-rows:
    minmax(52px, auto) minmax(40px, auto) minmax(0, 1fr)
    minmax(36px, auto);
}

:global(
  html[data-platform="darwin"]
    .long-workspace-editor.is-foreshadowing-overview
) {
  grid-template-rows:
    minmax(52px, auto) minmax(0, 1fr) minmax(36px, auto);
}

:global(html[data-platform="darwin"] .long-workspace-editor.has-navigation-tabs) {
  grid-template-rows:
    minmax(52px, auto) minmax(42px, auto) minmax(40px, auto)
    minmax(0, 1fr) minmax(36px, auto);
}

.long-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 10px;
  padding: 7px 9px 7px 15px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
  -webkit-app-region: drag;
}

.long-editor-breadcrumbs {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-editor-breadcrumbs span {
  flex: 0 0 auto;
}

.long-editor-breadcrumbs span:last-child {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-weight: 560;
  text-overflow: ellipsis;
}

.long-editor-breadcrumbs i {
  margin: 0 6px;
  color: var(--text-tertiary);
  font-style: normal;
}

.long-editor-header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
}

.long-editor-save-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-editor-save-state > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-editor-save-state.is-dirty {
  color: var(--warning);
}

.long-editor-collapse-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.long-editor-collapse-button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

:global(html[data-platform="darwin"] .long-editor-header) {
  min-height: 52px;
  padding-top: 10px;
  padding-bottom: 8px;
}

.long-worldbuilding-tabs.section-tabs-bar {
  min-height: 42px;
  padding-right: 10px;
  border-color: var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-worldbuilding-tabs .section-tab {
  color: var(--text-tertiary);
}

.long-worldbuilding-tabs .section-tab:hover,
.long-worldbuilding-tabs .section-tab.is-active {
  color: var(--text-primary);
}

.long-worldbuilding-add {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  align-self: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-worldbuilding-add:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-worldbuilding-add:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.long-editor-toolbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  padding: 5px 13px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-editor-file-tabs,
.long-editor-view-tabs {
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 7px;
  background: var(--surface-hover);
}

.long-editor-file-tabs {
  max-width: 48%;
  overflow-x: auto;
  scrollbar-width: none;
}

.long-editor-file-tabs::-webkit-scrollbar {
  display: none;
}

.long-editor-file-tabs button,
.long-editor-view-tabs button {
  flex: 0 0 auto;
  height: max(25px, 1.85em);
  padding: 0 9px;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  cursor: pointer;
}

.long-editor-file-tabs button.is-active,
.long-editor-view-tabs button.is-active {
  background: var(--surface-main);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgb(24 26 28 / 8%);
}

.long-editor-file-tabs button:disabled,
.long-editor-view-tabs button:disabled {
  cursor: default;
  opacity: 0.45;
}

.long-toolbar-separator {
  flex: 0 0 auto;
  width: 1px;
  height: 19px;
  margin: 0 4px;
  background: var(--theme-line);
}

.long-toolbar-spacer,
.long-footer-spacer {
  flex: 1 1 auto;
}

.long-editor-text-tools {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
}

.long-format-button {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-format-button:hover {
  background: var(--surface-hover);
  color: var(--neutral-solid);
}

.long-format-button.is-active {
  background: var(--surface-selected);
  color: var(--accent);
}

.long-format-button:disabled {
  color: var(--text-tertiary);
  cursor: default;
  opacity: 0.42;
}

.long-format-button:disabled:hover {
  background: transparent;
  color: var(--text-tertiary);
}

.long-editor-find-panel {
  position: absolute;
  z-index: 25;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  width: min(350px, calc(100vw - 36px));
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-raised);
  box-shadow:
    0 12px 30px rgb(24 27 30 / 16%),
    0 2px 7px rgb(24 27 30 / 8%);
}

.long-editor-find-row,
.long-editor-replace-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 5px;
}

.long-editor-find-field {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  height: 30px;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-tertiary);
}

.long-editor-find-field:focus-within {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--theme-line));
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.long-editor-find-field input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.75rem;
}

.long-editor-find-field input::placeholder {
  color: var(--text-tertiary);
}

.long-editor-find-count {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  white-space: nowrap;
}

.long-editor-find-icon-button,
.long-editor-find-action {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-editor-find-icon-button {
  width: 26px;
}

.long-editor-find-icon-button:hover,
.long-editor-find-action:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-editor-find-icon-button.is-previous svg {
  transform: rotate(180deg);
}

.long-editor-find-action {
  padding: 0 9px;
  border: 1px solid var(--theme-line);
  background: var(--surface-main);
  font-size: 0.714286rem;
  font-weight: 560;
}

.long-editor-find-action:disabled,
.long-editor-find-field input:disabled {
  cursor: default;
  opacity: 0.45;
}

.long-editor-toolbar-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.long-editor-rollback-button,
.long-editor-save-button {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 7px;
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  font-size: 0.714286rem;
  cursor: pointer;
}

.long-editor-rollback-button {
  min-height: 27px;
  padding-block: 3px;
  border: 1px solid var(--theme-line);
  background: var(--surface-main);
  color: var(--text-secondary);
}

.long-editor-rollback-button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-editor-save-button:disabled {
  background: var(--surface-selected);
  color: var(--text-tertiary);
}

.long-editor-document {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-main);
}

.long-editor-writing-surface {
  --long-document-inline-padding: clamp(18px, 2vw, 24px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  padding: 28px 0 18px;
  overflow: hidden;
  background: var(--surface-main);
}

.long-editor-writing-surface.is-readonly {
  background: var(--surface-raised);
}

.long-document-meta-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
  padding-inline: var(--long-document-inline-padding);
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.long-document-format,
.long-readonly-badge {
  padding: 2px 6px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  font-size: 0.607143rem;
}

.long-readonly-badge {
  border-color: color-mix(in srgb, var(--warning) 28%, var(--theme-line));
  background: color-mix(
    in srgb,
    var(--warning) 10%,
    var(--surface-raised)
  );
  color: var(--warning);
}

.long-worldbuilding-delete-button {
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  cursor: pointer;
}

.long-worldbuilding-delete-button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--danger);
}

.long-worldbuilding-delete-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.long-document-title-input,
.long-document-title {
  width: 100%;
  margin: 8px 0 13px;
  padding: 0 var(--long-document-inline-padding);
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: Georgia, "Songti SC", "SimSun", serif;
  font-size: clamp(1.71429rem, 2.2vw, 2.42857rem);
  font-weight: 600;
  line-height: 1.28;
  letter-spacing: -0.025em;
}

.long-document-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-document-title-input[readonly] {
  color: var(--text-primary);
}

.long-document-editor,
.long-document-preview {
  width: 100%;
  min-height: 0;
  padding: 0 var(--long-document-inline-padding) 80px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: Georgia, "Songti SC", "SimSun", serif;
  font-size: 1.07143rem;
  line-height: 1.95;
  letter-spacing: 0.025em;
  white-space: pre-wrap;
}

.long-document-editor {
  resize: none;
}

.long-document-title-input:focus-visible,
.long-document-editor:focus-visible {
  outline: 1px solid
    color-mix(in srgb, var(--theme-foreground) 22%, transparent);
}

:global(html[data-theme="dark"] .long-document-title-input:focus-visible),
:global(html[data-theme="dark"] .long-document-editor:focus-visible) {
  outline-color: rgb(255 255 255 / 22%);
}

.long-document-editor[readonly] {
  color: var(--text-secondary);
}

.long-document-preview p + p {
  margin-top: 1.15em;
}

.long-document-preview .is-empty {
  color: var(--text-tertiary);
}

.long-worldbuilding-empty {
  display: grid;
  grid-row: 1 / -1;
  place-content: center;
  justify-items: center;
  gap: 8px;
  min-height: 0;
  padding: 28px;
  color: var(--text-tertiary);
  text-align: center;
}

.long-worldbuilding-empty strong {
  color: var(--text-primary);
}

.long-worldbuilding-empty span {
  font-size: 0.75rem;
}

.long-worldbuilding-empty button {
  margin-top: 4px;
  min-height: 31px;
  padding: 6px 11px;
  border-radius: 7px;
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  font-size: 0.75rem;
  cursor: pointer;
}

.long-editor-recovery {
  position: absolute;
  z-index: 3;
  top: 12px;
  right: 12px;
  width: min(360px, calc(100% - 24px));
  border: 1px solid
    color-mix(in srgb, var(--accent) 32%, var(--theme-line));
  border-radius: 11px;
  background: color-mix(
    in srgb,
    var(--surface-raised) 96%,
    var(--accent-soft)
  );
  box-shadow: 0 12px 32px color-mix(in srgb, var(--text-primary) 14%, transparent);
  color: var(--text-primary);
}

.long-editor-recovery summary {
  padding: 10px 12px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 640;
  cursor: pointer;
}

.long-editor-recovery-content {
  display: grid;
  gap: 9px;
  padding: 0 12px 12px;
  border-top: 1px solid var(--theme-line-soft);
}

.long-editor-recovery-content p {
  margin: 9px 0 0;
  color: var(--text-secondary);
  font-size: 0.714286rem;
  line-height: 1.55;
}

.long-editor-recovery-content small {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-editor-recovery-content pre {
  max-height: 112px;
  margin: 0;
  padding: 8px 9px;
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.long-editor-recovery-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.long-editor-recovery-actions button {
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 0.678571rem;
  cursor: pointer;
}

.long-editor-recovery-actions button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-editor-recovery-actions button.is-primary {
  border-color: var(--neutral-solid);
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
}

.long-editor-recovery-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.long-editor-readonly {
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: clamp(20px, 3vw, 38px) clamp(24px, 5vw, 70px);
  overflow: auto;
  border: 0;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.75;
  white-space: pre-wrap;
}

.long-ledger-record {
  height: 100%;
  padding: clamp(20px, 3vw, 38px) clamp(24px, 5vw, 70px);
  overflow: auto;
  color: var(--text-primary);
}

.long-ledger-record > header,
.long-ledger-record > section,
.long-ledger-record > details {
  max-width: 860px;
  margin: 0 auto 18px;
  padding: 16px 18px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}

.long-ledger-record small,
.long-ledger-record dt {
  color: var(--text-tertiary);
}

.long-ledger-record h3 {
  margin-top: 5px;
  font-size: 1.071429rem;
}

.long-ledger-record h4 {
  margin-bottom: 10px;
  font-size: 0.785714rem;
}

.long-ledger-record dl {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  gap: 8px 14px;
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.65;
}

.long-ledger-record dd {
  min-width: 0;
  margin: 0;
  white-space: pre-wrap;
}

.long-ledger-record section > p {
  display: grid;
  grid-template-columns: minmax(140px, 0.4fr) minmax(0, 1fr);
  gap: 10px;
  margin-top: 8px;
  font-size: 0.714286rem;
  line-height: 1.55;
}

.long-ledger-record code {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.long-ledger-record details {
  padding: 0;
}

.long-ledger-record summary {
  padding: 13px 16px;
  color: var(--text-secondary);
  font-size: 0.714286rem;
  cursor: pointer;
}

.long-ledger-record details .long-editor-readonly {
  height: auto;
  max-height: 420px;
  border-top: 1px solid var(--theme-line-soft);
}

.long-editor-loading,
.long-editor-unavailable,
.long-editor-empty {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 100%;
  gap: 9px;
  padding: 28px;
  color: var(--text-tertiary);
  text-align: center;
}

.long-editor-loading {
  grid-auto-flow: column;
  align-items: center;
}

.long-editor-unavailable strong {
  color: var(--text-primary);
}

.long-editor-unavailable button {
  min-height: 31px;
  padding: 6px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.long-editor-unavailable button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-editor-unavailable button:disabled {
  cursor: default;
  opacity: 0.5;
}

.long-loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: long-editor-pulse 1.1s ease-in-out infinite;
}

.long-editor-footer {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
  padding: 0 13px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-editor-footer > span:first-child {
  flex: 0 0 auto;
}

.long-editor-footer > span:nth-child(2) {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-editor-footer .long-editor-save-button {
  flex: 0 0 auto;
  height: max(26px, 1.9em);
  min-height: 26px;
  padding: 0 9px;
  border-radius: 6px;
}

.long-editor-empty {
  grid-row: 1 / -1;
}

.long-editor-empty-icon {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  background: var(--accent-soft);
  color: var(--accent);
}

.long-editor-empty h2 {
  color: var(--text-primary);
  font-size: 1.142857rem;
}

.long-editor-empty p {
  max-width: 420px;
  line-height: 1.65;
}

.long-worldbuilding-delete-overlay {
  z-index: 2400;
  padding: 20px;
}

.long-worldbuilding-delete-dialog {
  width: min(420px, calc(100vw - 32px));
  padding: 20px;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
  box-shadow: 0 20px 60px
    color-mix(in srgb, var(--text-primary) 22%, transparent);
  color: var(--text-primary);
}

.long-worldbuilding-delete-dialog > span {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.long-worldbuilding-delete-dialog h3 {
  margin: 6px 0 0;
  font-size: 1.071429rem;
}

.long-worldbuilding-delete-dialog p {
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.6;
}

.long-worldbuilding-delete-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.long-worldbuilding-delete-dialog button {
  min-height: 32px;
  padding: 6px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
}

.long-worldbuilding-delete-dialog button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-worldbuilding-delete-dialog button.is-danger {
  border-color: transparent;
  background: var(--danger);
  color: #ffffff;
}

@container (max-width: 38rem) {
  .long-editor-header {
    padding-inline: 10px 7px;
  }

  .long-editor-save-state {
    max-width: min(42cqw, 11rem);
  }

  .long-editor-toolbar {
    flex-wrap: wrap;
    padding-inline: 8px;
  }

  .long-editor-file-tabs {
    flex: 1 1 100%;
    max-width: 100%;
  }

  .long-toolbar-spacer {
    display: none;
  }

  .long-editor-toolbar-actions {
    margin-left: auto;
  }

  .long-editor-writing-surface {
    --long-document-inline-padding: clamp(14px, 4cqw, 20px);
    padding-top: 18px;
  }

  .long-document-title-input,
  .long-document-title {
    font-size: clamp(1.45rem, 7cqw, 2rem);
  }
}

@container (max-width: 27rem) {
  .long-editor-breadcrumbs span:not(:last-child),
  .long-editor-breadcrumbs i {
    display: none;
  }

  .long-editor-save-state {
    max-width: 34cqw;
  }

  .long-editor-rollback-button span,
  .long-editor-footer > span:nth-child(2) {
    display: none;
  }

  .long-editor-find-panel {
    right: -3.25rem;
    width: min(350px, calc(100cqw - 16px));
  }
}

@keyframes long-editor-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .long-loading-dot {
    animation: none;
  }
}
</style>
