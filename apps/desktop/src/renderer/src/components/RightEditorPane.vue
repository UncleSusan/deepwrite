<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { randomHex8 } from "@deepwrite/shared";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../types/conversation";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  createEditorTextReference,
  resolveEditorTextReferenceRange
} from "../utils/editorTextReferences";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  document: WorkspaceDocument;
  resourceId: string;
  draftState: EditorDraftState | undefined;
  locateReference?: EditorTextReferenceNavigation | undefined;
  locked: boolean;
  lockedLabel?: string | undefined;
  saving?: boolean;
  autoSaveEnabled?: boolean;
  boundToCurrentBook?: boolean;
  sectionTabs?: readonly { id: string; title: string }[];
  activeSectionId?: string | undefined;
  canCreateSection?: boolean;
}>();

const emit = defineEmits<{
  collapse: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
  insertSelection: [reference: EditorTextReference];
  selectSection: [sectionId: string];
  createSection: [];
  selectDraftFile: [fileKind: "body" | "character-state"];
}>();

const editorInput = ref<HTMLTextAreaElement>();
const selectionMenuElement = ref<HTMLElement>();
const editorToolsElement = ref<HTMLElement>();
const findPanelElement = ref<HTMLElement>();
const findInput = ref<HTMLInputElement>();
const selectionAction = ref<{
  reference: EditorTextReference;
  left: number;
  top: number;
} | null>(null);
const title = ref(props.draftState?.title ?? props.document.title);
const content = ref(props.draftState?.content ?? props.document.content);
const dirty = ref(props.draftState?.dirty ?? false);
const viewMode = ref<"edit" | "preview">("edit");
const findPanelOpen = ref(false);
const findPanelMode = ref<"find" | "replace">("find");
const searchQuery = ref("");
const replacementText = ref("");
const currentMatchIndex = ref(-1);
const searchAnchor = ref(0);

interface EditorHistorySnapshot {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

interface EditorSearchMatch {
  start: number;
  end: number;
}

const undoHistory = ref<EditorHistorySnapshot[]>([]);
const redoHistory = ref<EditorHistorySnapshot[]>([]);
const HISTORY_LIMIT = 120;

watch(
  () => props.document.id,
  () => {
    title.value = props.draftState?.title ?? props.document.title;
    content.value = props.draftState?.content ?? props.document.content;
    dirty.value = props.draftState?.dirty ?? false;
    viewMode.value = "edit";
    selectionAction.value = null;
    findPanelOpen.value = false;
    searchQuery.value = "";
    replacementText.value = "";
    currentMatchIndex.value = -1;
    undoHistory.value = [];
    redoHistory.value = [];
  }
);

watch(
  () => [
    props.draftState?.title,
    props.draftState?.content,
    props.draftState?.dirty,
    props.document.title,
    props.document.content
  ] as const,
  ([nextTitle, nextContent, nextDirty, documentTitle, documentContent]) => {
    const resolvedTitle = nextTitle ?? documentTitle;
    const resolvedContent = nextContent ?? documentContent;
    if (title.value !== resolvedTitle) title.value = resolvedTitle;
    if (content.value !== resolvedContent) content.value = resolvedContent;
    dirty.value = nextDirty ?? false;
  }
);

const characterCount = computed(() => content.value.replace(/\s/g, "").length);
const paragraphs = computed(() => content.value.split(/\n{2,}/).filter(Boolean));
const showSectionTabs = computed(() => Boolean(props.sectionTabs?.length));
const showDraftFileTabs = computed(() => Boolean(props.document.draftFileKind));
const editorReadOnly = computed(() => props.document.readOnly || props.locked);
const canUndo = computed(() => !editorReadOnly.value && undoHistory.value.length > 0);
const canRedo = computed(() => !editorReadOnly.value && redoHistory.value.length > 0);
const searchMatches = computed<EditorSearchMatch[]>(() => {
  const query = searchQuery.value;
  if (!query) return [];

  const matches: EditorSearchMatch[] = [];
  let start = 0;
  while (start <= content.value.length - query.length) {
    const index = content.value.indexOf(query, start);
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
const draftUnitLabel = computed(() =>
  props.document.workspaceType === "script" ? "剧集" : "小节"
);
const persistedDocument = computed(() =>
  Boolean(
    props.document.catalogDocumentId ||
      props.document.catalogEntryId ||
      props.document.catalogProjectRevision !== undefined
  )
);

function markDirty(): void {
  if (props.document.readOnly || props.locked) return;
  dirty.value = true;
  emit("liveChange", {
    id: props.document.id,
    title: title.value,
    content: content.value
  });
}

function getEditorSnapshot(): EditorHistorySnapshot {
  const input = editorInput.value;
  const fallback = content.value.length;
  return {
    content: content.value,
    selectionStart: input?.selectionStart ?? fallback,
    selectionEnd: input?.selectionEnd ?? fallback
  };
}

function pushHistorySnapshot(
  history: EditorHistorySnapshot[],
  snapshot: EditorHistorySnapshot
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
  if (editorReadOnly.value) return;
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
    content: content.value,
    selectionStart: input.selectionStart ?? content.value.length,
    selectionEnd: input.selectionEnd ?? content.value.length
  });
}

function updateContent(nextContent: string): void {
  content.value = nextContent;
  currentMatchIndex.value = -1;
  markDirty();
}

async function restoreEditorSnapshot(snapshot: EditorHistorySnapshot): Promise<void> {
  viewMode.value = "edit";
  updateContent(snapshot.content);
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, "forward");
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
    toggleFindPanel("find");
    return;
  }
  if (
    (event.ctrlKey && !event.metaKey && key === "h") ||
    (event.metaKey && event.altKey && key === "f")
  ) {
    event.preventDefault();
    toggleFindPanel("replace");
  }
}

function save(): void {
  if (props.document.readOnly || props.locked || props.saving) {
    return;
  }
  emit("save", { id: props.document.id, title: title.value, content: content.value });
}

function closeSelectionAction(): void {
  selectionAction.value = null;
}

function closeFindPanel(): void {
  findPanelOpen.value = false;
  currentMatchIndex.value = -1;
}

async function toggleFindPanel(mode: "find" | "replace"): Promise<void> {
  if (findPanelOpen.value && findPanelMode.value === mode) {
    closeFindPanel();
    return;
  }

  viewMode.value = "edit";
  closeSelectionAction();
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
    const index = matches.findIndex((match) => match.start >= searchAnchor.value);
    return index >= 0 ? index : 0;
  }
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index]!.end <= searchAnchor.value) return index;
  }
  return matches.length - 1;
}

function scrollEditorToRange(input: HTMLTextAreaElement, start: number): void {
  const line = content.value.slice(0, start).split("\n").length;
  const computedStyle = globalThis.getComputedStyle(input);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight);
  const resolvedLineHeight = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.parseFloat(computedStyle.fontSize) * 1.95;
  input.scrollTop = Math.max(0, (line - 1) * resolvedLineHeight - input.clientHeight / 3);
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
  if (editorReadOnly.value) return;
  const index =
    currentMatchIndex.value >= 0
      ? currentMatchIndex.value
      : resolveInitialMatchIndex(1);
  const match = searchMatches.value[index];
  if (!match) {
    uiMessage.info(searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字");
    return;
  }

  const nextContent =
    content.value.slice(0, match.start) +
    replacementText.value +
    content.value.slice(match.end);
  if (nextContent === content.value) {
    findMatch(1);
    return;
  }

  recordUndoSnapshot();
  updateContent(nextContent);
  searchAnchor.value = match.start + replacementText.value.length;
  void nextTick(() => findMatch(1, true));
}

function replaceAllMatches(): void {
  if (editorReadOnly.value) return;
  const matches = searchMatches.value;
  if (!searchQuery.value || !matches.length) {
    uiMessage.info(searchQuery.value ? "未找到可替换的文字" : "请输入要替换的文字");
    return;
  }

  let cursor = 0;
  let nextContent = "";
  for (const match of matches) {
    nextContent += content.value.slice(cursor, match.start) + replacementText.value;
    cursor = match.end;
  }
  nextContent += content.value.slice(cursor);

  if (nextContent === content.value) {
    uiMessage.info("查找文字与替换文字相同");
    return;
  }
  recordUndoSnapshot();
  updateContent(nextContent);
  searchAnchor.value = 0;
  uiMessage.success(`已替换 ${matches.length} 处文字`);
}

function captureEditorSelection(
  input: HTMLTextAreaElement,
  event?: MouseEvent
): boolean {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  const reference = createEditorTextReference({
    id: randomHex8(),
    resourceId: props.resourceId,
    document: {
      ...props.document,
      title: title.value,
      content: content.value
    },
    start,
    end
  });
  if (!reference) {
    closeSelectionAction();
    return false;
  }

  const editorRect = input.getBoundingClientRect();
  const menuWidth = 142;
  const menuHeight = 42;
  const anchorLeft = event?.clientX ?? editorRect.left + 24;
  const anchorTop = event?.clientY ?? editorRect.top + 24;
  selectionAction.value = {
    reference,
    left: Math.max(8, Math.min(globalThis.innerWidth - menuWidth - 8, anchorLeft + 8)),
    top: Math.max(8, Math.min(globalThis.innerHeight - menuHeight - 8, anchorTop + 8))
  };
  return true;
}

function handleEditorContextMenu(event: MouseEvent): void {
  if (captureEditorSelection(event.currentTarget as HTMLTextAreaElement, event)) {
    event.preventDefault();
  }
}

function insertSelectedText(): void {
  const reference = selectionAction.value?.reference;
  if (!reference) return;
  emit("insertSelection", reference);
  closeSelectionAction();
}

function handleWindowPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!selectionMenuElement.value?.contains(target)) closeSelectionAction();
  if (
    !editorToolsElement.value?.contains(target) &&
    !findPanelElement.value?.contains(target)
  ) {
    closeFindPanel();
  }
}

async function locateEditorReference(
  navigation: EditorTextReferenceNavigation | undefined
): Promise<void> {
  if (!navigation || navigation.reference.documentId !== props.document.id) return;
  viewMode.value = "edit";
  closeSelectionAction();
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  const range = resolveEditorTextReferenceRange(content.value, navigation.reference);
  input.focus();
  input.setSelectionRange(range.start, range.end, "forward");
  scrollEditorToRange(input, range.start);
}

watch(
  () => [props.locateReference?.requestId, props.document.id] as const,
  () => {
    void locateEditorReference(props.locateReference);
  },
  { flush: "post" }
);

onMounted(() => {
  globalThis.addEventListener("pointerdown", handleWindowPointerDown, true);
});

onBeforeUnmount(() => {
  globalThis.removeEventListener("pointerdown", handleWindowPointerDown, true);
});
</script>

<template>
  <aside
    class="editor-pane"
    :class="{
      'has-section-tabs': showSectionTabs,
      'is-script-workspace': document.workspaceType === 'script'
    }"
    :data-workspace-type="document.workspaceType"
    aria-label="文本内容"
  >
    <header class="editor-header">
      <div class="editor-breadcrumbs" :title="document.path.join(' / ')">
        <span v-for="(part, index) in document.path" :key="`${part}-${index}`">
          {{ part }}<i v-if="index < document.path.length - 1">/</i>
        </span>
      </div>
      <div class="editor-header-actions">
        <span class="save-state" :class="{ 'is-dirty': dirty }">
          <AppIcon :name="dirty ? 'save' : 'check'" :size="13" />
          {{ document.readOnly ? "只读" : locked ? (lockedLabel ?? "智能体运行中 · 暂停编辑") : saving ? "正在保存到本机" : dirty ? (autoSaveEnabled ? "等待自动保存" : "有未应用修改") : persistedDocument ? "已保存到本机" : "本次运行已应用" }}
        </span>
        <button
          class="icon-button"
          type="button"
          aria-label="收起文本内容栏"
          @click="emit('collapse')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <nav
      v-if="showSectionTabs"
      class="section-tabs-bar"
      :aria-label="`正文${draftUnitLabel}`"
    >
      <div class="section-tabs-scroll" role="tablist">
        <button
          v-for="section in sectionTabs ?? []"
          :key="section.id"
          class="section-tab"
          :class="{ 'is-active': section.id === activeSectionId }"
          type="button"
          role="tab"
          :aria-selected="section.id === activeSectionId"
          :title="section.title"
          @click="emit('selectSection', section.id)"
        >
          {{ section.title }}
        </button>
      </div>
      <button
        v-if="canCreateSection"
        class="section-tabs-add"
        type="button"
        aria-label="在正文末尾新建小节"
        title="新建小节"
        @click="emit('createSection')"
      >
        <AppIcon name="plus" :size="16" />
      </button>
    </nav>

    <div class="editor-toolbar">
      <div
        v-if="showDraftFileTabs"
        class="draft-file-tabs"
        role="tablist"
        :aria-label="`${draftUnitLabel}文件`"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="document.draftFileKind === 'body'"
          :class="{ 'is-active': document.draftFileKind === 'body' }"
          @click="emit('selectDraftFile', 'body')"
        >
          正文
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="document.draftFileKind === 'character-state'"
          :class="{ 'is-active': document.draftFileKind === 'character-state' }"
          @click="emit('selectDraftFile', 'character-state')"
        >
          人物状态
        </button>
      </div>
      <span v-if="showDraftFileTabs" class="toolbar-separator" />
      <div class="view-tabs" role="tablist" aria-label="文本视图">
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'edit'"
          :class="{ 'is-active': viewMode === 'edit' }"
          @click="viewMode = 'edit'"
        >
          编辑
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'preview'"
          :class="{ 'is-active': viewMode === 'preview' }"
          @click="viewMode = 'preview'"
        >
          预览
        </button>
      </div>
      <span class="toolbar-separator" />
      <div
        ref="editorToolsElement"
        class="editor-text-tools"
        role="group"
        aria-label="文本操作"
      >
        <button
          class="format-button"
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
          class="format-button"
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
          class="format-button"
          :class="{ 'is-active': findPanelOpen && findPanelMode === 'find' }"
          type="button"
          aria-label="查找"
          title="查找（⌘/Ctrl+F）"
          :aria-pressed="findPanelOpen && findPanelMode === 'find'"
          @mousedown.prevent
          @click="toggleFindPanel('find')"
        >
          <AppIcon name="search" :size="16" />
        </button>
        <button
          class="format-button"
          :class="{ 'is-active': findPanelOpen && findPanelMode === 'replace' }"
          type="button"
          aria-label="替换"
          title="替换（⌘⌥F / Ctrl+H）"
          :aria-pressed="findPanelOpen && findPanelMode === 'replace'"
          @mousedown.prevent
          @click="toggleFindPanel('replace')"
        >
          <AppIcon name="replace" :size="16" />
        </button>
      </div>

      <div
        v-if="findPanelOpen"
        ref="findPanelElement"
        class="editor-find-panel"
        role="dialog"
        :aria-label="findPanelMode === 'replace' ? '查找和替换' : '查找文字'"
        @keydown.esc.stop="closeFindPanel"
      >
        <div class="editor-find-row">
          <label class="editor-find-field">
            <AppIcon name="search" :size="14" />
            <input
              ref="findInput"
              v-model="searchQuery"
              type="text"
              aria-label="查找文字"
              placeholder="查找"
              @input="handleFindInput"
              @keydown.enter.prevent="findMatch($event.shiftKey ? -1 : 1)"
            />
            <span class="editor-find-count" aria-live="polite">{{ searchResultLabel }}</span>
          </label>
          <button
            class="editor-find-icon-button is-previous"
            type="button"
            aria-label="查找上一个"
            title="查找上一个"
            @click="findMatch(-1)"
          >
            <AppIcon name="chevron" :size="14" />
          </button>
          <button
            class="editor-find-icon-button"
            type="button"
            aria-label="查找下一个"
            title="查找下一个"
            @click="findMatch(1)"
          >
            <AppIcon name="chevron" :size="14" />
          </button>
          <button
            class="editor-find-icon-button"
            type="button"
            aria-label="关闭查找"
            title="关闭"
            @click="closeFindPanel"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </div>
        <div v-if="findPanelMode === 'replace'" class="editor-replace-row">
          <label class="editor-find-field">
            <AppIcon name="replace" :size="14" />
            <input
              v-model="replacementText"
              type="text"
              aria-label="替换为"
              placeholder="替换为"
              :disabled="editorReadOnly"
              @keydown.enter.prevent="replaceCurrentMatch"
            />
          </label>
          <button
            class="editor-find-action"
            type="button"
            :disabled="editorReadOnly"
            @click="replaceCurrentMatch"
          >
            替换
          </button>
          <button
            class="editor-find-action"
            type="button"
            :disabled="editorReadOnly"
            @click="replaceAllMatches"
          >
            全部
          </button>
        </div>
      </div>
    </div>

    <div class="editor-document" :class="{ 'is-readonly': document.readOnly || locked }">
      <div class="document-meta-row">
        <span>{{ document.eyebrow }}</span>
        <span v-if="document.format" class="document-format">{{ document.format }}</span>
        <span v-if="document.readOnly" class="readonly-badge">只读内容</span>
        <span v-if="document.domain !== 'creation'" class="readonly-badge">
          {{ boundToCurrentBook ? "已绑定到当前书籍" : "仅浏览 · 未绑定" }}
        </span>
      </div>

      <input
        v-model="title"
        class="document-title-input"
        :readonly="document.readOnly || locked || document.draftFileKind === 'character-state'"
        aria-label="文档标题"
        @input="markDirty"
      />

      <textarea
        v-if="viewMode === 'edit'"
        ref="editorInput"
        v-model="content"
        class="document-editor"
        :readonly="document.readOnly || locked"
        aria-label="文本内容编辑器"
        spellcheck="false"
        @beforeinput="handleEditorBeforeInput"
        @input="markDirty"
        @keydown="handleEditorKeydown"
        @contextmenu="handleEditorContextMenu"
        @scroll="closeSelectionAction"
      />
      <article v-else class="document-preview">
        <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
      </article>
    </div>

    <footer class="editor-footer">
      <span>{{ characterCount.toLocaleString("zh-CN") }} 字</span>
      <span>{{ locked ? (lockedLabel ?? "智能体运行中 · 防止版本冲突") : saving ? "正在原子保存本机文稿" : persistedDocument ? (autoSaveEnabled ? "本机文稿 · 更改后自动保存" : "本机文稿 · 应用后持久保存") : "内存草稿 · 重启后不保留" }}</span>
      <span class="footer-spacer" />
      <button
        class="save-button"
        type="button"
        :disabled="document.readOnly || locked || saving || !dirty"
        @click="save"
      >
        <AppIcon name="save" :size="14" />
        {{ saving ? "保存中…" : autoSaveEnabled ? "立即保存" : "应用" }}
      </button>
    </footer>
  </aside>

  <Teleport to="body">
    <div
      v-if="selectionAction"
      ref="selectionMenuElement"
      class="editor-selection-menu"
      role="menu"
      aria-label="正文选区操作"
      :style="{ left: `${selectionAction.left}px`, top: `${selectionAction.top}px` }"
    >
      <button
        type="button"
        role="menuitem"
        @mousedown.prevent
        @click="insertSelectedText"
      >
        <AppIcon name="message" :size="15" />
        插入输入框
      </button>
    </div>
  </Teleport>
</template>
