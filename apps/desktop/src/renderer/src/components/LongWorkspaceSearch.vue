<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  LongBookSummary,
  LongSearchHit,
  LongSearchScope,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRoot
} from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { uiMessage } from "../ui-feedback";
import { resolveLongSearchHitSelection } from "../utils/longSearchSelection";
import AppIcon from "./AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";

const props = defineProps<{
  summary: LongBookSummary;
  workspaceIndex: LongWorkspaceIndexSnapshot;
}>();

const emit = defineEmits<{
  select: [selection: LongWorkspaceSelection];
}>();

const ROOTS: ReadonlyArray<{
  id: LongWorkspaceRoot;
  label: string;
}> = [
  { id: "worldbuilding", label: "世界观" },
  { id: "character_design", label: "人物设计" },
  { id: "plot_design", label: "情节设计" },
  { id: "draft", label: "正文" },
  { id: "continuity_ledger", label: "连续性账本" }
];

const searchQuery = ref("");
const searchScope = ref<LongSearchScope>("all");
const searchHits = ref<LongSearchHit[]>([]);
const searchCursor = ref<string | null>(null);
const searchLoading = ref(false);
const searchAttempted = ref(false);
let searchClock = 0;

const searchScopeOptions: readonly PopupSelectOption[] = [
  { value: "all", label: "全部" },
  ...ROOTS.map(({ id, label }) => ({ value: id, label }))
];

function clearResults(): void {
  searchClock += 1;
  searchHits.value = [];
  searchCursor.value = null;
  searchLoading.value = false;
  searchAttempted.value = false;
}

function setSearchScope(value: PopupSelectValue): void {
  if (value === "all" || ROOTS.some(({ id }) => id === value)) {
    searchScope.value = value as LongSearchScope;
  }
}

async function runSearch(append = false): Promise<void> {
  const query = searchQuery.value.trim();
  if (!query) {
    clearResults();
    return;
  }
  const api = window.deepwrite?.long;
  if (!api) {
    uiMessage.warning("当前环境未连接长篇全文搜索。");
    return;
  }
  const ownClock = ++searchClock;
  const bookId = props.summary.id;
  const scope = searchScope.value;
  const workspaceRevision = props.workspaceIndex.revision;
  const projectRevision = props.summary.projectRevision;
  const cursor = append ? searchCursor.value : null;
  searchLoading.value = true;
  try {
    const result = await api.search({
      bookId,
      query,
      scope,
      ...(cursor ? { cursor } : {}),
      limit: 30,
      maxSnippetCharacters: 240
    });
    if (
      ownClock !== searchClock ||
      props.summary.id !== bookId ||
      props.workspaceIndex.revision !== workspaceRevision ||
      props.summary.projectRevision !== projectRevision ||
      result.bookId !== bookId ||
      result.query !== query ||
      result.scope !== scope ||
      result.workspaceRevision !== workspaceRevision ||
      result.projectRevision !== projectRevision
    ) {
      return;
    }
    searchHits.value = append
      ? [...searchHits.value, ...result.hits]
      : result.hits;
    searchCursor.value = result.nextCursor;
    searchAttempted.value = true;
  } catch (error: unknown) {
    if (ownClock !== searchClock) return;
    searchAttempted.value = true;
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
  const selection = resolveLongSearchHitSelection(
    props.summary,
    props.workspaceIndex,
    hit
  );
  if (!selection) {
    uiMessage.info("该搜索结果已不在当前导航索引中，请重新搜索。");
    return;
  }
  emit("select", selection);
}

watch(searchQuery, clearResults, { flush: "sync" });
watch(searchScope, clearResults, { flush: "sync" });
watch(
  () =>
    [
      props.summary.id,
      props.workspaceIndex.revision,
      props.summary.projectRevision
    ] as const,
  clearResults,
  { flush: "sync" }
);
</script>

<template>
  <section class="long-workspace-search" aria-label="搜索当前长篇">
    <div class="long-search-heading">
      <AppIcon name="search" :size="14" />
      <span>当前长篇检索</span>
    </div>
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
      <button
        type="submit"
        :disabled="searchLoading || !searchQuery.trim()"
        aria-label="搜索当前长篇"
      >
        <AppIcon name="search" :size="14" />
      </button>
    </form>

    <div
      v-if="searchAttempted || searchHits.length"
      class="long-search-results"
      aria-live="polite"
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
      <p v-if="searchAttempted && !searchHits.length && !searchLoading">
        没有找到匹配内容
      </p>
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
</template>

<style scoped>
.long-workspace-search {
  display: grid;
  gap: 0.4rem;
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-search-heading {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-tertiary);
  font-size: 0.68rem;
  font-weight: 650;
}

form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.8rem 2rem;
  gap: 0.3rem;
}

input {
  min-width: 0;
  min-height: 2rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--theme-line);
  border-radius: 0.45rem;
  outline: none;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.72rem;
}

input:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 0.18rem var(--accent-soft);
}

form > button {
  display: grid;
  place-items: center;
  min-height: 2rem;
  border-radius: 0.45rem;
  background: var(--neutral-solid);
  color: var(--accent-contrast);
}

form > button:disabled,
.long-search-results button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.long-search-results {
  display: grid;
  max-height: 13rem;
  gap: 0.2rem;
  overflow: auto;
  padding: 0.2rem;
  border: 1px solid var(--theme-line-soft);
  border-radius: 0.45rem;
  background: var(--surface-main);
}

.long-search-results > button {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
  padding: 0.4rem 0.45rem;
  border-radius: 0.35rem;
  color: var(--text-secondary);
  text-align: left;
}

.long-search-results > button:hover:not(:disabled) {
  background: var(--surface-hover);
}

.long-search-results strong,
.long-search-results small,
.long-search-results span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.long-search-results strong {
  font-size: 0.68rem;
  white-space: nowrap;
}

.long-search-results small {
  color: var(--text-tertiary);
  font-size: 0.58rem;
  white-space: nowrap;
}

.long-search-results span,
.long-search-results p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.62rem;
  line-height: 1.4;
}

.long-search-results p {
  padding: 0.45rem;
}

.long-search-results .long-search-more {
  justify-items: center;
  border: 1px solid var(--theme-line-soft);
  color: var(--accent);
  text-align: center;
}
</style>
