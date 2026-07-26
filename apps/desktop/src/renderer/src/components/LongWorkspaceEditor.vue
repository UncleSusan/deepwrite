<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  LongFileRevisionSchema,
  LongLedgerCommitRecordSchema,
  type LongLedgerCommitRecord,
  type LongLedgerCommitIndexEntry,
  type LongFileId,
  type LongFileRevision,
  type LongReadDocumentResult,
  type LongWorkspaceFileReference,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  isEditableLongFile,
  resolveLongWorkspaceApi,
  type LongWorkspaceFileRole,
  type LongWorkspaceSelection,
  type LongWorkspaceSelectionFile
} from "../types/longWorkspace";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  bookId: string;
  selection: LongWorkspaceSelection | null;
  latestCommit?: LongLedgerCommitIndexEntry | undefined;
  locked?: boolean;
  lockedReason?: string | undefined;
}>();

const emit = defineEmits<{
  saved: [result: LongWriteDocumentResult];
  contextChange: [
    context: {
      bookId: string;
      fileId: LongFileId;
      fileRevision: LongFileRevision;
    } | null
  ];
  rollback: [];
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
const workspaceSavePending = ref(false);
const requestClockByFile = new Map<string, number>();
const recoveryWriteTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
const recoveryWriteWarningKeys = new Set<string>();
let requestClock = 0;
let activeSavePromise: Promise<boolean> | null = null;

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
const currentReadOnly = computed(() => {
  const selectedFile = currentSelectionFile.value;
  return Boolean(
    props.locked ||
      selectedFile?.readOnly ||
      (selectedFile && !isEditableLongFile(selectedFile.file))
  );
});
const currentDirty = computed(
  () =>
    Boolean(currentState.value?.loaded) &&
    currentState.value?.content !== currentState.value?.savedContent
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
const characterCount = computed(
  () => currentState.value?.content.replace(/\s/gu, "").length ?? 0
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
    loaded: existing?.loaded ?? false
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

async function loadSelectedDocument(force = false): Promise<void> {
  const selectedFile = currentSelectionFile.value;
  if (!selectedFile) return;
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
    const editable =
      !props.locked &&
      !selectedFile.readOnly &&
      isEditableLongFile(firstPage.file);
    const recovery = editable
      ? readRecoveryRecord(bookId, firstPage.file.id)
      : null;
    const recoveryMatchesDisk =
      recovery?.baseRevision === firstPage.file.revision;
    const recoveredContent =
      recoveryMatchesDisk && recovery.content !== content
        ? recovery.content
        : content;
    replaceDocumentState(key, {
      bookId,
      file: firstPage.file,
      content: recoveredContent,
      savedContent: content,
      workspaceRevision: firstPage.workspaceRevision,
      projectRevision: firstPage.projectRevision,
      loading: false,
      saving: false,
      loaded: true
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
    if (currentSelectionFile.value?.file.id === firstPage.file.id) {
      emit("contextChange", {
        bookId,
        fileId: firstPage.file.id,
        fileRevision: firstPage.file.revision
      });
    }
  } catch (error: unknown) {
    const latest = documentStates.value[key];
    if (requestClockByFile.get(key) === ownRequest && latest) {
      replaceDocumentState(key, {
        ...latest,
        loading: false
      });
      uiMessage.error(
        error instanceof Error ? error.message : "读取长篇文件失败。"
      );
    }
  }
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

  const bookId = props.bookId;
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
                    loaded: true
                  }
                : {}),
              workspaceRevision: result.workspaceRevision,
              projectRevision: result.projectRevision
            }
          : value
      ])
    );
    emit("saved", result);
    if (currentSelectionFile.value?.file.id === result.file.id) {
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
      uiMessage.success(
        `已保存“${props.selection?.title ?? state.file.path}”`
      );
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
  if (!dirtyKeys.length) return true;

  const saved = await runExclusiveSave(async () => {
    for (const key of dirtyKeys) {
      if (!(await saveDocumentState(key, false))) {
        return false;
      }
    }
    return true;
  });
  if (saved) {
    uiMessage.success(
      `离开前已自动保存 ${dirtyKeys.length} 个长篇文件`
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
      projectRevision
    )
  ) {
    throw new Error("存在未保存的长篇文档，不能刷新项目版本基线。");
  }
}

function synchronizeProjectRevisionsIfClean(
  bookId: string,
  workspaceRevision: number,
  projectRevision: number
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

onMounted(() => window.addEventListener("beforeunload", handleBeforeUnload));
onBeforeUnmount(() => {
  flushAllRecoveryRecords();
  for (const key of [...recoveryWriteTimers.keys()]) {
    cancelRecoveryWrite(key);
  }
  window.removeEventListener("beforeunload", handleBeforeUnload);
  requestClockByFile.clear();
});
</script>

<template>
  <section class="long-workspace-editor" aria-label="长篇文件编辑器">
    <template v-if="selection">
      <header class="long-editor-header">
        <div class="long-editor-heading">
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
          <h2>{{ selection.title }}</h2>
        </div>
        <div class="long-editor-save-state">
          <AppIcon
            :name="currentDirty ? 'save' : 'check'"
            :size="13"
          />
          <span>
            {{
              !currentSelectionFile
                ? "已选择工作区上下文"
                : locked
                  ? lockedReason ?? "编辑暂时锁定"
                : currentSelectionFile.readOnly
                ? "只读记录"
                : currentState?.loading
                  ? "正在按需读取"
                  : currentState?.saving
                    ? "正在保存"
                    : currentDirty
                      ? "有未保存修改"
                      : currentState?.loaded
                        ? "已与本机同步"
                        : "等待读取"
            }}
          </span>
        </div>
      </header>

      <nav
        v-if="selection.files.length > 1"
        class="long-editor-tabs"
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
      </nav>

      <div class="long-editor-toolbar">
        <span>
          <AppIcon
            :name="
              !currentSelectionFile
                ? 'wand'
                : currentReadOnly
                  ? 'ledger'
                  : 'edit'
            "
            :size="14"
          />
          {{
            !currentSelectionFile
              ? "工作区 Agent 上下文"
              : locked
                ? lockedReason ?? "编辑暂时锁定"
              : currentReadOnly &&
                  selection.root === "draft" &&
                  selection.chapterCardId
                ? "已提交章节只读 · 如需修改，请先回滚最后一次提交"
              : currentReadOnly
                ? "结构化记录 · 只读"
                : "Markdown · CAS 保存"
          }}
        </span>
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
            回滚最后提交
          </button>
          <button
            class="long-editor-save-button"
            type="button"
            :disabled="
              currentReadOnly ||
              !currentDirty ||
              currentState?.loading ||
              currentState?.saving ||
              workspaceSavePending
            "
            @click="saveCurrentDocument"
          >
            <AppIcon name="save" :size="14" />
            保存
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
        <div v-if="currentState?.loading" class="long-editor-loading">
          <span class="long-loading-dot" />
          <span>正在读取文件内容…</span>
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
        <pre
          v-else-if="currentReadOnly && currentState?.loaded"
          class="long-editor-readonly"
        >{{ currentState.content }}</pre>
        <textarea
          v-else-if="currentState?.loaded"
          :value="currentState.content"
          :readonly="locked"
          :aria-label="`${selection.title} Markdown 内容`"
          spellcheck="false"
          @input="
            updateCurrentContent(($event.target as HTMLTextAreaElement).value)
          "
        />
        <div v-else class="long-editor-unavailable">
          <AppIcon name="file" :size="22" />
          <span>选择文件后将在这里加载内容</span>
        </div>
      </div>

      <footer class="long-editor-footer">
        <span>{{ selection.description ?? "长篇文件按需加载，不预读其他章节正文。" }}</span>
        <span v-if="currentState?.loaded">
          {{ characterCount.toLocaleString() }} 字 ·
          {{ currentState.file.revision }}
        </span>
      </footer>
    </template>

    <div v-else class="long-editor-empty">
      <span class="long-editor-empty-icon">
        <AppIcon name="book" :size="28" />
      </span>
      <h2>选择一个长篇文件</h2>
      <p>从左侧五个工作区根目录中选择设定、人物、故事线、章节或账本记录。</p>
    </div>
  </section>
</template>

<style scoped>
.long-workspace-editor {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.long-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 16px;
  padding: 13px 18px 11px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-editor-heading {
  min-width: 0;
}

.long-editor-breadcrumbs {
  display: flex;
  min-width: 0;
  gap: 5px;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-editor-breadcrumbs i {
  margin-left: 5px;
  font-style: normal;
}

.long-editor-heading h2 {
  overflow: hidden;
  margin-top: 4px;
  font-size: 1.071429rem;
  font-weight: 640;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-editor-save-state {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-editor-tabs {
  display: flex;
  min-width: 0;
  gap: 4px;
  padding: 7px 14px;
  overflow-x: auto;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-editor-tabs button {
  flex: 0 0 auto;
  min-height: 29px;
  padding: 5px 10px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.714286rem;
  cursor: pointer;
}

.long-editor-tabs button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-editor-tabs button.is-active {
  background: var(--surface-selected);
  color: var(--text-primary);
  font-weight: 620;
}

.long-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 7px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-editor-toolbar > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 0.678571rem;
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
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
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

.long-editor-document textarea,
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
  font-family: var(--ui-font);
  font-size: 1rem;
  line-height: 1.95;
  resize: none;
  white-space: pre-wrap;
}

.long-editor-readonly {
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.75;
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
  justify-content: space-between;
  min-width: 0;
  gap: 14px;
  padding: 9px 14px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-editor-footer span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-editor-footer span:last-child {
  flex: 0 0 auto;
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
