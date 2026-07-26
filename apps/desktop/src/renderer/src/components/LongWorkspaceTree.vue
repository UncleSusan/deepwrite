<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  LongBookSummary,
  LongCharacterGroup,
  LongSearchHit,
  LongSearchScope,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRoot
} from "@deepwrite/contracts";
import type {
  LongWorkspaceSelection,
  LongWorkspaceSelectionFile
} from "../types/longWorkspace";
import {
  createLongChapterSelection,
  createLongContinuitySelection,
  isLongMigrationEvidenceCategoryId
} from "../types/longWorkspace";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";

const props = defineProps<{
  summary: LongBookSummary;
  workspaceIndex: LongWorkspaceIndexSnapshot;
  selectedKey?: string;
}>();

const emit = defineEmits<{
  select: [selection: LongWorkspaceSelection];
}>();

const ROOTS: ReadonlyArray<{
  id: LongWorkspaceRoot;
  label: string;
  icon: "globe" | "user" | "history" | "edit" | "ledger";
}> = [
  { id: "worldbuilding", label: "世界观", icon: "globe" },
  { id: "character_design", label: "人物设计", icon: "user" },
  { id: "plot_design", label: "情节设计", icon: "history" },
  { id: "draft", label: "正文", icon: "edit" },
  { id: "continuity_ledger", label: "连续性账本", icon: "ledger" }
];
const ROOT_DESCRIPTIONS: Record<LongWorkspaceRoot, string> = {
  worldbuilding: "维护世界规则、势力、地理、历史、术语、境界与物品。",
  character_design: "维护人物核心档案、关系、当前状态与历史轨迹。",
  plot_design: "维护分卷、剧情弧、章卡、时间线、叙事落点与伏笔。",
  draft: "按连续章卡顺序规划正文，并调度单章写作。",
  continuity_ledger: "核对已写章节并维护连续性提交前缀。"
};

const CHARACTER_GROUPS: ReadonlyArray<{
  id: LongCharacterGroup;
  label: string;
}> = [
  { id: "protagonist", label: "主角" },
  { id: "major_supporting", label: "主要配角" },
  { id: "minor_supporting", label: "次要配角" },
  { id: "passerby", label: "路人" }
];

const expandedRoots = ref<Set<LongWorkspaceRoot>>(
  new Set<LongWorkspaceRoot>(["worldbuilding"])
);
const searchQuery = ref("");
const searchScope = ref<LongSearchScope>("all");
const searchHits = ref<LongSearchHit[]>([]);
const searchCursor = ref<string | null>(null);
const searchLoading = ref(false);
let searchClock = 0;
const searchScopeOptions: readonly PopupSelectOption[] = [
  { value: "all", label: "全部" },
  ...ROOTS.map(({ id, label }) => ({ value: id, label }))
];

const orderedWorldbuilding = computed(() =>
  [...props.workspaceIndex.worldbuilding].sort(
    (left, right) => left.order - right.order
  )
);
const orderedVolumes = computed(() =>
  [...props.summary.navigation.volumes].sort(
    (left, right) => left.order - right.order
  )
);
const characterFilesById = computed(
  () =>
    new Map(
      props.workspaceIndex.characterFiles.map((entry) => [
        entry.characterId,
        entry
      ])
    )
);
const chapterById = computed(
  () =>
    new Map(
      props.summary.navigation.chapterCards.map((chapter) => [
        chapter.id,
        chapter
      ])
    )
);
const committedChapterIds = computed(
  () =>
    new Set(
      props.workspaceIndex.chapters.flatMap((entry) =>
        entry.commitId ? [entry.chapterCardId] : []
      )
    )
);
const nextContinuityChapter = computed(() => {
  const volumeOrder = new Map(
    props.summary.navigation.volumes.map((volume) => [
      volume.id,
      volume.order
    ])
  );
  return [...props.summary.navigation.chapterCards]
    .sort(
      (left, right) =>
        (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
          (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    )
    .find((chapter) => !committedChapterIds.value.has(chapter.id));
});
const charactersByGroup = computed(() => {
  const grouped = new Map<
    LongCharacterGroup,
    LongBookSummary["navigation"]["characters"]
  >();
  for (const group of CHARACTER_GROUPS) {
    grouped.set(group.id, []);
  }
  for (const character of props.summary.navigation.characters) {
    grouped.get(character.group)?.push(character);
  }
  for (const characters of grouped.values()) {
    characters.sort((left, right) => left.order - right.order);
  }
  return grouped;
});
const arcsByVolume = computed(() => {
  const grouped = new Map<
    string,
    LongBookSummary["navigation"]["arcs"]
  >();
  for (const arc of props.summary.navigation.arcs) {
    const entries = grouped.get(arc.volumeId) ?? [];
    entries.push(arc);
    grouped.set(arc.volumeId, entries);
  }
  for (const arcs of grouped.values()) {
    arcs.sort((left, right) => left.order - right.order);
  }
  return grouped;
});
const chaptersByVolume = computed(() => {
  const grouped = new Map<
    string,
    LongBookSummary["navigation"]["chapterCards"]
  >();
  for (const chapter of props.summary.navigation.chapterCards) {
    const entries = grouped.get(chapter.volumeId) ?? [];
    entries.push(chapter);
    grouped.set(chapter.volumeId, entries);
  }
  for (const chapters of grouped.values()) {
    chapters.sort(
      (left, right) => left.narrativeOrder - right.narrativeOrder
    );
  }
  return grouped;
});

function rootCount(root: LongWorkspaceRoot): number {
  const counts = props.summary.navigation.counts;
  switch (root) {
    case "worldbuilding":
      return counts.worldbuildingCategories;
    case "character_design":
      return counts.characters;
    case "plot_design":
      return counts.arcs + counts.storyEvents + counts.foreshadowingThreads;
    case "draft":
      return counts.chapterCards;
    case "continuity_ledger":
      return counts.committedChapters;
  }
}

function toggleRoot(root: LongWorkspaceRoot): void {
  const next = new Set(expandedRoots.value);
  if (next.has(root)) {
    next.delete(root);
  } else {
    next.add(root);
  }
  expandedRoots.value = next;
  const rootDefinition = ROOTS.find(({ id }) => id === root);
  if (rootDefinition) {
    emit("select", {
      key: `root:${root}`,
      root,
      title: rootDefinition.label,
      breadcrumbs: [props.summary.title, rootDefinition.label],
      files: [],
      preferredRole: "content",
      description: ROOT_DESCRIPTIONS[root]
    });
  }
}

function selectWorldbuilding(categoryId: string): void {
  const category = props.workspaceIndex.worldbuilding.find(
    ({ id }) => id === categoryId
  );
  if (!category) return;
  emit("select", {
    key: `worldbuilding:${category.id}`,
    root: "worldbuilding",
    title: category.title,
    breadcrumbs: [props.summary.title, "世界观", category.title],
    files: [
      {
        role: "content",
        label: category.format === "list" ? "设定条目" : "设定正文",
        file: category.file,
        ...(isLongMigrationEvidenceCategoryId(category.id)
          ? { readOnly: true }
          : {})
      }
    ],
    preferredRole: "content",
    description: isLongMigrationEvidenceCategoryId(category.id)
      ? "这是迁移生成的只读证据，可搜索并供 Agent 按需读取。"
      : category.format === "list"
        ? "列表型设定由 Markdown 中的稳定条目 ID 管理。"
        : "文本型世界设定。"
  });
}

function selectCharacter(
  characterId: string,
  preferredRole: LongWorkspaceSelectionFile["role"] = "core-profile"
): void {
  const character = props.summary.navigation.characters.find(
    ({ id }) => id === characterId
  );
  const entry = characterFilesById.value.get(characterId);
  if (!character || !entry) return;
  const continuityLocked =
    props.workspaceIndex.ledger.commits.length > 0;
  const files: LongWorkspaceSelectionFile[] = [
    { role: "core-profile", label: "核心档案", file: entry.coreProfile },
    {
      role: "relationships",
      label: "人物关系",
      file: entry.relationships,
      readOnly: continuityLocked
    },
    {
      role: "current-state",
      label: "当前状态",
      file: entry.currentState,
      readOnly: continuityLocked
    },
    {
      role: "history",
      label: "历史轨迹",
      file: entry.history,
      readOnly: continuityLocked
    }
  ];
  emit("select", {
    key: `character:${character.id}`,
    root: "character_design",
    title: character.name,
    breadcrumbs: [props.summary.title, "人物设计", character.name],
    files,
    preferredRole,
    description: continuityLocked
      ? "人物关系、当前状态与历史轨迹已由连续性账本接管；核心档案仍可编辑。"
      : "首章连续性提交前，人物四份档案均可直接编辑。"
  });
}

function selectBookLine(): void {
  emit("select", {
    key: "plot-design:book-line",
    root: "plot_design",
    title: "全书故事线",
    breadcrumbs: [props.summary.title, "情节设计", "全书故事线"],
    files: [
      {
        role: "book-line",
        label: "故事线",
        file: props.workspaceIndex.bookLine
      }
    ],
    preferredRole: "book-line",
    description: "全书级情节主线；卷、弧线和章节卡保存在结构索引中。"
  });
}

function selectChapter(chapterId: string): void {
  const selection = createLongChapterSelection(
    props.summary,
    props.workspaceIndex,
    chapterId
  );
  if (selection) emit("select", selection);
}

function selectLedgerRecord(commitId: string): void {
  const commit = props.workspaceIndex.ledger.commits.find(
    ({ id }) => id === commitId
  );
  const chapter = commit
    ? chapterById.value.get(commit.chapterCardId)
    : undefined;
  if (!commit) return;
  emit("select", {
    key: `ledger:${commit.id}`,
    root: "continuity_ledger",
    title: `提交 #${commit.sequence}`,
    breadcrumbs: [
      props.summary.title,
      "连续性账本",
      chapter?.title ?? `提交 #${commit.sequence}`
    ],
    files: [
      {
        role: "ledger-record",
        label: "提交记录",
        file: commit.recordFile,
        readOnly: true
      }
    ],
    preferredRole: "ledger-record",
    description: `${commit.committedAt} · ${commit.reversible ? "可回滚" : "不可回滚"}`
  });
}

function selectContinuityChapter(): void {
  const chapter = nextContinuityChapter.value;
  if (!chapter) return;
  const selection = createLongContinuitySelection(
    props.summary,
    props.workspaceIndex,
    chapter.id
  );
  if (selection) emit("select", selection);
}

function setSearchScope(value: PopupSelectValue): void {
  if (
    value === "all" ||
    ROOTS.some(({ id }) => id === value)
  ) {
    searchClock += 1;
    searchScope.value = value as LongSearchScope;
    searchHits.value = [];
    searchCursor.value = null;
    searchLoading.value = false;
  }
}

async function runSearch(append = false): Promise<void> {
  const query = searchQuery.value.trim();
  if (!query) {
    searchClock += 1;
    searchHits.value = [];
    searchCursor.value = null;
    searchLoading.value = false;
    return;
  }
  const api = window.deepwrite?.long;
  if (!api) {
    uiMessage.warning("当前环境未连接长篇全文搜索。");
    return;
  }
  const ownClock = ++searchClock;
  searchLoading.value = true;
  try {
    const result = await api.search({
      bookId: props.summary.id,
      query,
      scope: searchScope.value,
      ...(append && searchCursor.value
        ? { cursor: searchCursor.value }
        : {}),
      limit: 30,
      maxSnippetCharacters: 240
    });
    if (ownClock !== searchClock || result.bookId !== props.summary.id) {
      return;
    }
    searchHits.value = append
      ? [...searchHits.value, ...result.hits]
      : result.hits;
    searchCursor.value = result.nextCursor;
  } catch (error: unknown) {
    if (ownClock !== searchClock) return;
    uiMessage.error(
      error instanceof Error ? error.message : "搜索长篇内容失败。"
    );
  } finally {
    if (ownClock === searchClock) {
      searchLoading.value = false;
    }
  }
}

function selectSearchHit(hit: LongSearchHit): void {
  if (hit.fileId === props.workspaceIndex.bookLine.id) {
    selectBookLine();
    return;
  }
  const category = props.workspaceIndex.worldbuilding.find(
    ({ file }) => file.id === hit.fileId
  );
  if (category) {
    selectWorldbuilding(category.id);
    return;
  }
  const character = props.workspaceIndex.characterFiles.find((entry) =>
    [
      entry.coreProfile.id,
      entry.relationships.id,
      entry.currentState.id,
      entry.history.id
    ].includes(hit.fileId)
  );
  if (character) {
    const role =
      character.relationships.id === hit.fileId
        ? "relationships"
        : character.currentState.id === hit.fileId
          ? "current-state"
          : character.history.id === hit.fileId
            ? "history"
            : "core-profile";
    selectCharacter(character.characterId, role);
    return;
  }
  const chapter = props.workspaceIndex.chapters.find((entry) =>
    [entry.body.id, entry.characterState.id, entry.handoff.id].includes(
      hit.fileId
    )
  );
  if (chapter) {
    const selection = createLongChapterSelection(
      props.summary,
      props.workspaceIndex,
      chapter.chapterCardId
    );
    if (!selection) return;
    selection.preferredRole =
      chapter.characterState.id === hit.fileId
        ? "character-state"
        : chapter.handoff.id === hit.fileId
          ? "handoff"
          : "body";
    emit("select", selection);
    return;
  }
  const commit = props.workspaceIndex.ledger.commits.find(
    ({ recordFile }) => recordFile.id === hit.fileId
  );
  if (commit) {
    selectLedgerRecord(commit.id);
  }
}

function charactersInGroup(group: LongCharacterGroup) {
  return charactersByGroup.value.get(group) ?? [];
}

function arcsInVolume(volumeId: string) {
  return arcsByVolume.value.get(volumeId) ?? [];
}

function chaptersInVolume(volumeId: string) {
  return chaptersByVolume.value.get(volumeId) ?? [];
}

watch(
  searchQuery,
  () => {
    searchClock += 1;
    searchHits.value = [];
    searchCursor.value = null;
    searchLoading.value = false;
  },
  { flush: "sync" }
);

watch(
  () =>
    [
      props.workspaceIndex.revision,
      props.summary.projectRevision
    ] as const,
  ([workspaceRevision, projectRevision], previous) => {
    if (
      previous &&
      workspaceRevision === previous[0] &&
      projectRevision === previous[1]
    ) {
      return;
    }
    searchClock += 1;
    searchHits.value = [];
    searchCursor.value = null;
    searchLoading.value = false;
  },
  { flush: "sync" }
);

watch(
  () => props.selectedKey,
  (key) => {
    if (
      !key?.startsWith("chapter:") &&
      !key?.startsWith("continuity:")
    ) {
      return;
    }
    expandedRoots.value = new Set([
      ...expandedRoots.value,
      key.startsWith("continuity:") ? "continuity_ledger" : "draft"
    ]);
  }
);

watch(
  () => props.summary.id,
  () => {
    searchClock += 1;
    searchQuery.value = "";
    searchScope.value = "all";
    searchHits.value = [];
    searchCursor.value = null;
    searchLoading.value = false;
  }
);
</script>

<template>
  <aside class="long-workspace-tree" aria-label="长篇工作区导航">
    <header class="long-tree-header">
      <div>
        <span>长篇创作空间</span>
        <h2>{{ summary.title }}</h2>
      </div>
      <span class="long-tree-genre">{{ summary.genre }}</span>
    </header>

    <div class="long-tree-summary" aria-label="长篇导航摘要">
      <span>
        <strong>{{ summary.navigation.counts.volumes }}</strong>
        卷
      </span>
      <span>
        <strong>{{ summary.navigation.counts.chapterCards }}</strong>
        章
      </span>
      <span>
        <strong>{{ summary.navigation.counts.characters }}</strong>
        人物
      </span>
      <span>
        <strong>{{ summary.navigation.counts.committedChapters }}</strong>
        已提交
      </span>
    </div>

    <section class="long-tree-search" aria-label="搜索长篇工作区">
      <form @submit.prevent="runSearch(false)">
        <input
          v-model="searchQuery"
          type="search"
          maxlength="256"
          placeholder="搜索设定、人物、剧情与正文…"
          aria-label="长篇搜索关键词"
        />
        <PopupSelect
          :model-value="searchScope"
          :options="searchScopeOptions"
          accessible-label="长篇搜索范围"
          size="small"
          variant="compact"
          :menu-z-index="230"
          @update:model-value="setSearchScope"
        />
        <button type="submit" :disabled="searchLoading || !searchQuery.trim()">
          <AppIcon name="search" :size="14" />
          <span class="sr-only">搜索</span>
        </button>
      </form>
      <div
        v-if="searchHits.length || (searchQuery.trim() && !searchLoading)"
        class="long-search-results"
      >
        <button
          v-for="hit in searchHits"
          :key="`${hit.fileId}:${hit.start}:${hit.end}`"
          type="button"
          @click="selectSearchHit(hit)"
        >
          <strong>{{ hit.title }}</strong>
          <small>{{ hit.path }}</small>
          <span>{{ hit.snippet }}</span>
        </button>
        <p v-if="!searchHits.length">没有找到匹配内容</p>
        <button
          v-if="searchCursor"
          class="long-search-more"
          type="button"
          :disabled="searchLoading"
          @click="runSearch(true)"
        >
          {{ searchLoading ? "正在继续搜索…" : "继续搜索" }}
        </button>
      </div>
    </section>

    <div class="long-root-list">
      <section
        v-for="root in ROOTS"
        :key="root.id"
        class="long-root-section"
        :data-long-root="root.id"
      >
        <button
          class="long-root-heading"
          :class="{ 'is-selected': selectedKey === `root:${root.id}` }"
          type="button"
          :aria-expanded="expandedRoots.has(root.id)"
          @click="toggleRoot(root.id)"
        >
          <AppIcon :name="root.icon" :size="16" />
          <strong>{{ root.label }}</strong>
          <span>{{ rootCount(root.id) }}</span>
          <AppIcon
            class="long-root-chevron"
            :class="{ 'is-open': expandedRoots.has(root.id) }"
            name="chevron"
            :size="13"
          />
        </button>

        <div v-if="expandedRoots.has(root.id)" class="long-root-content">
          <template v-if="root.id === 'worldbuilding'">
            <button
              v-for="category in orderedWorldbuilding"
              :key="category.id"
              class="long-file-row"
              :class="{
                'is-selected': selectedKey === `worldbuilding:${category.id}`
              }"
              type="button"
              @click="selectWorldbuilding(category.id)"
            >
              <AppIcon name="file" :size="14" />
              <span>{{ category.title }}</span>
              <small>{{ category.format === "list" ? "列表" : "文本" }}</small>
            </button>
          </template>

          <template v-else-if="root.id === 'character_design'">
            <div
              v-for="group in CHARACTER_GROUPS"
              :key="group.id"
              class="long-tree-group"
            >
              <div class="long-tree-group-label">
                <span>{{ group.label }}</span>
                <small>{{ charactersInGroup(group.id).length }}</small>
              </div>
              <button
                v-for="character in charactersInGroup(group.id)"
                :key="character.id"
                class="long-file-row"
                :class="{
                  'is-selected': selectedKey === `character:${character.id}`
                }"
                type="button"
                @click="selectCharacter(character.id)"
              >
                <AppIcon name="user" :size="14" />
                <span>{{ character.name }}</span>
              </button>
            </div>
          </template>

          <template v-else-if="root.id === 'plot_design'">
            <button
              class="long-file-row"
              :class="{ 'is-selected': selectedKey === 'plot-design:book-line' }"
              type="button"
              @click="selectBookLine"
            >
              <AppIcon name="file" :size="14" />
              <span>全书故事线</span>
              <small>Markdown</small>
            </button>
            <div
              v-for="volume in orderedVolumes"
              :key="volume.id"
              class="long-structure-group"
            >
              <div class="long-structure-heading">
                <AppIcon name="folder" :size="14" />
                <strong>{{ volume.title }}</strong>
                <small>{{ arcsInVolume(volume.id).length }} 条弧线</small>
              </div>
              <div
                v-for="arc in arcsInVolume(volume.id)"
                :key="arc.id"
                class="long-structure-row"
              >
                <span>{{ arc.title }}</span>
              </div>
            </div>
            <div class="long-plot-metrics">
              <span>事件 {{ summary.navigation.counts.storyEvents }}</span>
              <span>伏笔 {{ summary.navigation.counts.foreshadowingThreads }}</span>
            </div>
          </template>

          <template v-else-if="root.id === 'draft'">
            <div
              v-for="volume in orderedVolumes"
              :key="volume.id"
              class="long-tree-group"
            >
              <div class="long-tree-group-label">
                <span>{{ volume.title }}</span>
                <small>{{ chaptersInVolume(volume.id).length }} 章</small>
              </div>
              <button
                v-for="chapter in chaptersInVolume(volume.id)"
                :key="chapter.id"
                class="long-file-row long-chapter-row"
                :class="{
                  'is-selected': selectedKey === `chapter:${chapter.id}`
                }"
                type="button"
                @click="selectChapter(chapter.id)"
              >
                <AppIcon name="edit" :size="14" />
                <span>{{ chapter.title }}</span>
                <small
                  v-if="committedChapterIds.has(chapter.id)"
                >
                  已提交
                </small>
              </button>
            </div>
          </template>

          <template v-else>
            <div class="long-ledger-progress">
              <strong>
                {{ summary.navigation.counts.committedChapters }} /
                {{ summary.navigation.counts.chapterCards }}
              </strong>
              <span>章节已形成连续提交前缀</span>
            </div>
            <button
              v-if="nextContinuityChapter"
              class="long-continuity-entry"
              :class="{
                'is-selected':
                  selectedKey === `continuity:${nextContinuityChapter.id}`
              }"
              type="button"
              @click="selectContinuityChapter"
            >
              <AppIcon name="check" :size="15" />
              <span>
                <strong>核对下一章并提交</strong>
                <small>{{ nextContinuityChapter.title }}</small>
              </span>
              <AppIcon name="chevron" :size="13" />
            </button>
            <div v-else class="long-continuity-complete">
              <AppIcon name="check" :size="14" />
              所有章节均已提交
            </div>
            <button
              v-for="commit in workspaceIndex.ledger.commits"
              :key="commit.id"
              class="long-file-row"
              :class="{ 'is-selected': selectedKey === `ledger:${commit.id}` }"
              type="button"
              @click="selectLedgerRecord(commit.id)"
            >
              <AppIcon name="ledger" :size="14" />
              <span>
                {{
                  chapterById.get(commit.chapterCardId)?.title ??
                  `提交 #${commit.sequence}`
                }}
              </span>
              <small>#{{ commit.sequence }}</small>
            </button>
            <p v-if="!workspaceIndex.ledger.commits.length" class="long-tree-empty">
              尚无连续性提交
            </p>
          </template>
        </div>
      </section>
    </div>

    <footer class="long-tree-footer">
      <span>索引修订 {{ summary.navigation.revision }}</span>
      <span>{{ summary.status === "completed" ? "已完成" : "编辑中" }}</span>
    </footer>
  </aside>
</template>

<style scoped>
.long-workspace-tree {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--theme-line);
  background: var(--surface-muted);
  color: var(--text-primary);
}

.long-tree-search {
  display: grid;
  gap: 5px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-tree-search form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 76px 30px;
  gap: 5px;
}

.long-tree-search input {
  min-width: 0;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.714286rem;
}

.long-tree-search input:focus {
  border-color: var(--accent);
  outline: none;
}

.long-tree-search form > button {
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--neutral-solid);
  color: var(--accent-contrast, #fff);
}

.long-tree-search form > button:disabled {
  opacity: 0.5;
}

.long-search-results {
  display: grid;
  max-height: 210px;
  gap: 3px;
  overflow: auto;
  padding: 3px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-main);
}

.long-search-results > button {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 6px 7px;
  border-radius: 6px;
  color: var(--text-secondary);
  text-align: left;
}

.long-search-results > button:hover {
  background: var(--surface-hover);
}

.long-search-results strong,
.long-search-results small,
.long-search-results span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.long-search-results strong {
  font-size: 0.678571rem;
  white-space: nowrap;
}

.long-search-results small {
  color: var(--text-tertiary);
  font-size: 0.571429rem;
  white-space: nowrap;
}

.long-search-results span,
.long-search-results p {
  color: var(--text-tertiary);
  font-size: 0.607143rem;
  line-height: 1.4;
}

.long-search-results p {
  padding: 7px;
}

.long-search-results .long-search-more {
  justify-items: center;
  border: 1px solid var(--theme-line-soft);
  color: var(--accent);
  text-align: center;
}

.long-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 18px 17px 13px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-tree-header > div {
  min-width: 0;
}

.long-tree-header span {
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-tree-header h2 {
  overflow: hidden;
  margin-top: 3px;
  font-size: 1.071429rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-tree-genre {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent) !important;
}

.long-tree-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--theme-line-soft);
}

.long-tree-summary > span {
  display: grid;
  place-items: center;
  gap: 1px;
  min-width: 0;
  padding: 8px 3px;
  background: var(--surface-raised);
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

.long-tree-summary strong {
  color: var(--text-primary);
  font-size: 0.785714rem;
}

.long-root-list {
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.long-root-section + .long-root-section {
  margin-top: 5px;
}

.long-root-heading {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto 16px;
  align-items: center;
  width: 100%;
  min-height: 36px;
  gap: 5px;
  padding: 6px 7px;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.long-root-heading:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-root-heading.is-selected {
  background: var(--surface-selected);
  color: var(--text-primary);
}

.long-root-heading strong {
  overflow: hidden;
  font-size: 0.785714rem;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-root-heading > span {
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--surface-selected);
  color: var(--text-tertiary);
  font-size: 0.607143rem;
  text-align: center;
}

.long-root-chevron {
  transition: transform 140ms ease;
}

.long-root-chevron.is-open {
  transform: rotate(90deg);
}

.long-root-content {
  display: grid;
  gap: 2px;
  padding: 2px 0 6px 13px;
}

.long-file-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  min-height: 32px;
  gap: 5px;
  padding: 5px 7px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.long-file-row:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-file-row.is-selected {
  background: var(--surface-selected);
  color: var(--text-primary);
}

.long-file-row > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-file-row small,
.long-tree-group-label small,
.long-structure-heading small {
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

.long-tree-group + .long-tree-group,
.long-structure-group {
  margin-top: 5px;
}

.long-tree-group-label,
.long-structure-heading {
  display: flex;
  align-items: center;
  min-height: 27px;
  gap: 6px;
  padding: 4px 7px;
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-tree-group-label > span,
.long-structure-heading strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-structure-heading strong {
  color: var(--text-secondary);
  font-size: 0.714286rem;
  font-weight: 590;
}

.long-structure-row {
  padding: 4px 8px 4px 28px;
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.long-plot-metrics {
  display: flex;
  gap: 6px;
  padding: 7px;
}

.long-plot-metrics span {
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-ledger-progress {
  display: grid;
  gap: 3px;
  margin: 3px 6px 6px;
  padding: 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-raised);
}

.long-ledger-progress strong {
  color: var(--text-primary);
  font-size: 0.857143rem;
}

.long-ledger-progress span,
.long-tree-empty {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-continuity-entry {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 14px;
  align-items: center;
  width: calc(100% - 12px);
  min-height: 48px;
  gap: 7px;
  margin: 0 6px 7px;
  padding: 7px 9px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.long-continuity-entry:hover,
.long-continuity-entry.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-primary);
}

.long-continuity-entry > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.long-continuity-entry strong,
.long-continuity-entry small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-continuity-entry strong {
  font-size: 0.714286rem;
}

.long-continuity-entry small {
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

.long-continuity-complete {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 6px 7px;
  padding: 7px 9px;
  border-radius: 7px;
  background: var(--surface-selected);
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-tree-empty {
  padding: 7px;
}

.long-tree-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 13px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

@media (max-width: 1180px) {
  .long-tree-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
