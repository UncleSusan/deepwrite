<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
  LongContinuityFact,
  LongContinuityKnowledge,
  LongContinuityOpenLoop,
  LongLedgerCommitRecord,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import LongContinuityProjectionPanel from "./LongContinuityProjectionPanel.vue";

export type LongContinuityWorkspaceView =
  | "inbox"
  | "snapshot"
  | "execution"
  | "knowledge"
  | "history";

const props = withDefaults(
  defineProps<{
    bookId: string;
    snapshot: LongWorkspaceIndexSnapshot;
    view?: LongContinuityWorkspaceView;
    activeChapterId?: string;
    evidenceContent?: string | null;
    currentRecord?: LongLedgerCommitRecord | null;
  }>(),
  {
    view: "inbox",
    evidenceContent: null,
    currentRecord: null
  }
);

const emit = defineEmits<{
  "update:view": [view: LongContinuityWorkspaceView];
  selectCommit: [commitId: string];
}>();

const viewMeta = [
  {
    id: "inbox",
    label: "待核验入账",
    compactLabel: "待核验",
    icon: "check"
  },
  {
    id: "snapshot",
    label: "当前事实快照",
    compactLabel: "快照",
    icon: "file"
  },
  {
    id: "execution",
    label: "剧情与伏笔",
    compactLabel: "执行",
    icon: "pin"
  },
  {
    id: "knowledge",
    label: "揭露与知识",
    compactLabel: "知识",
    icon: "globe"
  },
  {
    id: "history",
    label: "章节流水与接续",
    compactLabel: "流水",
    icon: "undo"
  }
] as const satisfies ReadonlyArray<{
  id: LongContinuityWorkspaceView;
  label: string;
  compactLabel: string;
  icon: "check" | "file" | "pin" | "globe" | "undo";
}>;

const activeView = ref<LongContinuityWorkspaceView>(props.view);
const contentEl = ref<HTMLElement | null>(null);

watch(
  () => props.view,
  (view) => {
    activeView.value = view;
    void resetContentScroll();
  }
);

const projection = computed(() => props.snapshot.ledger.projection);

const facts = computed(() => projection.value.facts);
const knowledge = computed(() => projection.value.knowledge);
const openLoops = computed(() => projection.value.openLoops);
const factById = computed(
  () => new Map(facts.value.map((fact) => [fact.factId, fact] as const))
);
const activeOpenLoops = computed(() =>
  openLoops.value.filter(
    ({ status }) => status === "open" || status === "progressing"
  )
);
const orderedCommits = computed(() =>
  [...props.snapshot.ledger.commits].sort(
    (left, right) =>
      right.sequence - left.sequence ||
      right.committedAt.localeCompare(left.committedAt)
  )
);

const volumeOrder = computed(
  () =>
    new Map(
      props.snapshot.plot.volumes.map(({ id, order }) => [id, order] as const)
    )
);

const orderedChapters = computed(() =>
  [...props.snapshot.plot.chapterCards].sort(
    (left, right) =>
      (volumeOrder.value.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.value.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  )
);

const activeChapter = computed(() => {
  const explicit = props.activeChapterId
    ? props.snapshot.plot.chapterCards.find(
        ({ id }) => id === props.activeChapterId
      )
    : undefined;
  if (explicit) return explicit;
  const committedIds = new Set(
    props.snapshot.chapters
      .filter(({ commitId }) => commitId !== null)
      .map(({ chapterCardId }) => chapterCardId)
  );
  return orderedChapters.value.find(({ id }) => !committedIds.has(id)) ?? null;
});

const activeChapterEntry = computed(() =>
  props.snapshot.chapters.find(
    ({ chapterCardId }) => chapterCardId === activeChapter.value?.id
  )
);

const evidenceRows = computed(() => {
  const body = props.evidenceContent ?? "";
  return [
    {
      id: "body",
      label: "章节正文",
      content: body,
      present: body.trim().length > 0
    }
  ];
});

const evidenceReady = computed(
  () =>
    evidenceRows.value.length > 0 &&
    evidenceRows.value.every(({ present }) => present)
);

const chapterOpenLoops = computed(() => {
  const chapterId = activeChapter.value?.id;
  if (!chapterId) return activeOpenLoops.value;
  const scoped = activeOpenLoops.value.filter(
    (loop) => loop.sourceChapterCardId === chapterId
  );
  return scoped.length ? scoped : activeOpenLoops.value;
});

const executionStats = computed(() => {
  const placements = props.snapshot.plot.narrativePlacements;
  const beats = props.snapshot.plot.foreshadowing.flatMap(
    (thread) => thread.beats
  );
  return [
    {
      id: "placement-open",
      label: "待执行剧情落点",
      value: placements.filter(
        ({ status }) => status === "planned" || status === "written"
      ).length
    },
    {
      id: "placement-committed",
      label: "已入账剧情落点",
      value: placements.filter(({ status }) => status === "committed").length
    },
    {
      id: "beat-open",
      label: "待处理伏笔触点",
      value: beats.filter(
        ({ status }) => status === "planned" || status === "written"
      ).length
    },
    {
      id: "thread-open",
      label: "未闭合伏笔线",
      value: props.snapshot.plot.foreshadowing.filter(
        ({ status }) => status === "open" || status === "progressing"
      ).length
    }
  ];
});

const throughCommit = computed(() => {
  const id = projection.value.throughCommitId;
  return id
    ? props.snapshot.ledger.commits.find((commit) => commit.id === id) ?? null
    : orderedCommits.value[0] ?? null;
});

const latestHandoff = computed(() => {
  return projection.value.latestHandoff;
});

const historyStats = computed(() => [
  {
    id: "commits",
    label: "已提交次数",
    value: orderedCommits.value.length
  },
  {
    id: "handoff",
    label: "最近接续",
    value: latestHandoff.value ? 1 : 0
  },
  {
    id: "record",
    label: "可审计记录",
    value: props.currentRecord ? 1 : 0
  }
]);

const currentSummaryRows = computed(() => {
  const summary = props.currentRecord?.chapterSummary;
  if (!summary) return [];
  return [
    ["时间线", summary.timeline],
    ["人物状态", summary.characterStates],
    ["势力状态", summary.factionStates],
    ["境界状态", summary.realmStates],
    ["伏笔状态", summary.foreshadowingStates],
    ["连续性备注", summary.continuityNotes]
  ] as const;
});

function switchView(view: LongContinuityWorkspaceView): void {
  activeView.value = view;
  emit("update:view", view);
  void resetContentScroll();
}

async function resetContentScroll(): Promise<void> {
  await nextTick();
  if (contentEl.value) contentEl.value.scrollTop = 0;
}

function chapterLabel(chapterCardId: string | null | undefined): string {
  if (!chapterCardId) return "未关联章节";
  return (
    props.snapshot.plot.chapterCards.find(({ id }) => id === chapterCardId)
      ?.title ?? chapterCardId
  );
}

function commitLabel(commitId: string | null | undefined): string {
  if (!commitId) return "尚未入账";
  const commit = props.snapshot.ledger.commits.find(({ id }) => id === commitId);
  return commit ? `提交 #${commit.sequence}` : commitId;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function factSubjectLabel(
  fact: Pick<LongContinuityFact, "domain" | "subjectId">
): string {
  const id = fact.subjectId;
  if (fact.domain === "character" || fact.domain === "relationship") {
    const character = props.snapshot.characters.find(
      (candidate) => candidate.id === id
    );
    if (character) {
      return fact.domain === "relationship"
        ? `${character.name} · 人物关系`
        : character.name;
    }
  }
  if (fact.domain === "world") {
    const category = props.snapshot.worldbuilding.find(
      (candidate) => candidate.id === id
    );
    if (category) return category.title;
  }
  if (fact.domain === "plot") {
    const chapter = props.snapshot.plot.chapterCards.find(
      (candidate) => candidate.id === id
    );
    if (chapter) return chapter.title;
    const event = props.snapshot.plot.storyEvents.find(
      (candidate) => candidate.id === id
    );
    if (event) return event.title;
    const arc = props.snapshot.plot.arcs.find(
      (candidate) => candidate.id === id
    );
    if (arc) return arc.title;
    const volume = props.snapshot.plot.volumes.find(
      (candidate) => candidate.id === id
    );
    if (volume) return volume.title;
    const placement = props.snapshot.plot.narrativePlacements.find(
      (candidate) => candidate.id === id
    );
    if (placement) {
      return (
        props.snapshot.plot.storyEvents.find(
          (candidate) => candidate.id === placement.eventId
        )?.title ?? id
      );
    }
  }
  if (fact.domain === "foreshadowing") {
    const thread = props.snapshot.plot.foreshadowing.find(
      (candidate) => candidate.id === id
    );
    if (thread) return thread.title;
    for (const candidate of props.snapshot.plot.foreshadowing) {
      const beat = candidate.beats.find((item) => item.id === id);
      if (beat) return `${candidate.title} · 触点 ${beat.order}`;
    }
  }
  return id;
}

function knowledgeFact(item: LongContinuityKnowledge): LongContinuityFact | null {
  return factById.value.get(item.factId) ?? null;
}

function knowledgeTitle(item: LongContinuityKnowledge): string {
  const fact = knowledgeFact(item);
  return fact ? `${factSubjectLabel(fact)} · ${fact.field}` : item.factId;
}

function knowledgeDetail(item: LongContinuityKnowledge): string {
  return knowledgeFact(item)?.value ?? item.evidence;
}

function audienceLabel(item: LongContinuityKnowledge): string {
  if (item.audienceType === "reader") return "读者";
  if (item.audienceType === "character" && item.audienceId) {
    return (
      props.snapshot.characters.find(({ id }) => id === item.audienceId)?.name ??
      item.audienceId
    );
  }
  return item.audienceId ?? "未命名势力";
}

function knowledgeLevelLabel(
  level: LongContinuityKnowledge["level"]
): string {
  return {
    unknown: "未知",
    suspects: "有所怀疑",
    believes: "相信",
    knows: "已知晓",
    misled: "被误导"
  }[level];
}

function loopTitle(loop: LongContinuityOpenLoop): string {
  const fact = loop.factId ? factById.value.get(loop.factId) : undefined;
  if (fact) return `${factSubjectLabel(fact)} · ${fact.field}`;
  if (loop.subjectId) {
    const domain =
      loop.kind === "knowledge" || loop.kind === "continuity"
        ? "plot"
        : loop.kind;
    return factSubjectLabel({ domain, subjectId: loop.subjectId });
  }
  return {
    character: "人物待续事项",
    relationship: "关系待续事项",
    world: "世界设定待续事项",
    plot: "剧情待续事项",
    foreshadowing: "伏笔待续事项",
    knowledge: "知识状态待续事项",
    continuity: "连续性待核验事项"
  }[loop.kind];
}

function forwardCommit(commitId: string): void {
  emit("selectCommit", commitId);
}
</script>

<template>
  <section
    class="continuity-workspace"
    :data-book-id="bookId"
    aria-label="连续性账本工作台"
  >
    <header class="continuity-header">
      <div class="continuity-heading">
        <span class="continuity-heading-icon">
          <AppIcon name="ledger" :size="20" />
        </span>
        <div>
          <span class="continuity-kicker">CONTINUITY LEDGER</span>
          <h2>连续性账本</h2>
          <p>章节证据在这里核验入账；人物、世界与剧情页面读取这里的当前投影。</p>
        </div>
      </div>
      <dl class="continuity-headline-stats">
        <div>
          <dt>已提交章节</dt>
          <dd>{{ snapshot.ledger.commits.length }}</dd>
        </div>
        <div>
          <dt>当前事实</dt>
          <dd>{{ facts.length }}</dd>
        </div>
        <div>
          <dt>待续事项</dt>
          <dd>{{ activeOpenLoops.length }}</dd>
        </div>
      </dl>
    </header>

    <nav class="continuity-view-tabs" aria-label="连续性账本视图">
      <button
        v-for="item in viewMeta"
        :key="item.id"
        type="button"
        :class="{ 'is-active': activeView === item.id }"
        :aria-current="activeView === item.id ? 'page' : undefined"
        @click="switchView(item.id)"
      >
        <AppIcon :name="item.icon" :size="15" />
        <span class="view-label-full">{{ item.label }}</span>
        <span class="view-label-compact">{{ item.compactLabel }}</span>
      </button>
    </nav>

    <div ref="contentEl" class="continuity-content">
      <section
        v-if="activeView === 'inbox'"
        class="continuity-view continuity-inbox"
        aria-label="待核验入账"
      >
        <header class="view-heading">
          <div>
            <span class="view-kicker">INBOX</span>
            <h3>待核验入账</h3>
            <p>正文是唯一事实证据；人物状态、知识变化和接续均由入账生成。</p>
          </div>
          <span
            class="status-badge"
            :class="{ 'is-ready': evidenceReady }"
          >
            {{ evidenceReady ? "证据已齐" : "等待证据" }}
          </span>
        </header>

        <div v-if="activeChapter" class="inbox-grid">
          <article class="inbox-chapter-card">
            <header>
              <span class="card-icon"><AppIcon name="book" :size="17" /></span>
              <div>
                <small>连续下一章</small>
                <h4>{{ activeChapter.title }}</h4>
              </div>
            </header>
            <dl>
              <div>
                <dt>章节状态</dt>
                <dd>
                  {{
                    activeChapterEntry?.commitId
                      ? commitLabel(activeChapterEntry.commitId)
                      : "尚未提交"
                  }}
                </dd>
              </div>
              <div>
                <dt>待核验事项</dt>
                <dd>{{ chapterOpenLoops.length }} 项</dd>
              </div>
            </dl>
          </article>

          <article class="inbox-evidence-card">
            <header>
              <div>
                <small>唯一事实证据</small>
                <h4>章节正文</h4>
              </div>
              <span>{{ evidenceRows.filter(({ present }) => present).length }}/{{ evidenceRows.length }}</span>
            </header>
            <ul>
              <li v-for="row in evidenceRows" :key="row.id">
                <span :class="{ 'is-ready': row.present }">
                  <AppIcon :name="row.present ? 'check' : 'file'" :size="13" />
                </span>
                <strong>{{ row.label }}</strong>
                <small>
                  {{
                    row.present
                      ? `${row.content.trim().length.toLocaleString("zh-CN")} 字符`
                      : "尚未载入"
                  }}
                </small>
              </li>
            </ul>
            <div class="inbox-output-preview">
              <small>入账输出</small>
              <span>人物当前状态与历史</span>
              <span>剧情 / 伏笔执行结果</span>
              <span>知识揭露与下一章接续</span>
            </div>
          </article>
        </div>

        <div v-else class="continuity-empty">
          <span class="continuity-empty-icon">
            <AppIcon name="check" :size="20" />
          </span>
          <strong>没有等待核验的章节</strong>
          <p>所有现有章节都已入账，新增章卡后会出现在这里。</p>
        </div>

        <section v-if="chapterOpenLoops.length" class="continuity-card">
          <header class="section-heading">
            <div>
              <span>入账前检查</span>
              <strong>需要接续的开放事项</strong>
            </div>
            <span>{{ chapterOpenLoops.length }}</span>
          </header>
          <ul class="loop-list">
            <li
              v-for="loop in chapterOpenLoops"
              :key="loop.loopId"
            >
              <span class="loop-kind">{{ loop.kind }}</span>
              <div>
                <strong>{{ loopTitle(loop) }}</strong>
                <p>{{ loop.detail }}</p>
              </div>
              <small>{{ loop.status }}</small>
            </li>
          </ul>
        </section>
      </section>

      <section
        v-else-if="activeView === 'snapshot'"
        class="continuity-view"
        aria-label="当前事实快照"
      >
        <header class="view-heading">
          <div>
            <span class="view-kicker">SNAPSHOT</span>
            <h3>当前事实快照</h3>
            <p>这里只呈现最近一次已批准提交后的有效状态，并保留来源追踪。</p>
          </div>
          <span class="status-badge">
            {{
              throughCommit
                ? `截至提交 #${throughCommit.sequence}`
                : "尚无提交"
            }}
          </span>
        </header>
        <LongContinuityProjectionPanel
          :snapshot="snapshot"
          @select-commit="forwardCommit"
        />
      </section>

      <section
        v-else-if="activeView === 'execution'"
        class="continuity-view"
        aria-label="剧情与伏笔执行"
      >
        <header class="view-heading">
          <div>
            <span class="view-kicker">EXECUTION</span>
            <h3>剧情与伏笔</h3>
            <p>计划仍在剧情设计中；这里记录正文实际执行并已入账的结果。</p>
          </div>
        </header>

        <dl class="execution-stats">
          <div v-for="stat in executionStats" :key="stat.id">
            <dt>{{ stat.label }}</dt>
            <dd>{{ stat.value }}</dd>
          </div>
        </dl>

        <section class="continuity-card">
          <header class="section-heading">
            <div>
              <span>待续事项</span>
              <strong>仍需推进或回收</strong>
            </div>
            <span>{{ activeOpenLoops.length }}</span>
          </header>
          <ul v-if="activeOpenLoops.length" class="loop-list">
            <li
              v-for="loop in activeOpenLoops"
              :key="loop.loopId"
            >
              <span class="loop-kind">{{ loop.kind }}</span>
              <div>
                <strong>{{ loopTitle(loop) }}</strong>
                <p>{{ loop.detail }}</p>
              </div>
              <small>{{ loop.status }}</small>
            </li>
          </ul>
          <div v-else class="card-empty">当前没有未闭合的剧情或伏笔事项。</div>
        </section>

        <LongContinuityProjectionPanel
          :snapshot="snapshot"
          domain="plot"
          @select-commit="forwardCommit"
        />
      </section>

      <section
        v-else-if="activeView === 'knowledge'"
        class="continuity-view"
        aria-label="信息揭露与知识"
      >
        <header class="view-heading">
          <div>
            <span class="view-kicker">KNOWLEDGE</span>
            <h3>信息揭露与知识</h3>
            <p>区分世界真相、正文已揭露内容与角色当前知道的内容。</p>
          </div>
          <span class="status-badge">{{ knowledge.length }} 项知识状态</span>
        </header>

        <section class="continuity-card">
          <header class="section-heading">
            <div>
              <span>知识状态</span>
              <strong>信息揭露记录</strong>
            </div>
            <span>{{ knowledge.length }}</span>
          </header>

          <div v-if="knowledge.length" class="knowledge-grid">
            <article
              v-for="item in knowledge"
              :key="`${item.factId}:${item.audienceType}:${item.audienceId ?? 'reader'}`"
              class="knowledge-card"
            >
              <header>
                <span><AppIcon name="globe" :size="15" /></span>
                <div>
                  <small>{{ audienceLabel(item) }}</small>
                  <strong>{{ knowledgeTitle(item) }}</strong>
                </div>
                <em>{{ knowledgeLevelLabel(item.level) }}</em>
              </header>
              <p>{{ knowledgeDetail(item) }}</p>
              <footer>
                <span>
                  {{ chapterLabel(item.sourceChapterCardId) }}
                  · {{ commitLabel(item.sourceCommitId) }}
                </span>
                <button
                  type="button"
                  @click="forwardCommit(item.sourceCommitId)"
                >
                  查看来源
                </button>
              </footer>
            </article>
          </div>
          <div v-else class="card-empty">
            还没有可追踪的知识状态。章节入账时记录揭露对象、知情范围和来源证据后会显示在这里。
          </div>
        </section>

        <LongContinuityProjectionPanel
          :snapshot="snapshot"
          domain="world"
          @select-commit="forwardCommit"
        />
      </section>

      <section
        v-else
        class="continuity-view continuity-history"
        aria-label="章节流水与接续"
      >
        <header class="view-heading">
          <div>
            <span class="view-kicker">HISTORY</span>
            <h3>章节流水与接续</h3>
            <p>按章节查看发生了什么、改变了什么，以及下一章要接住什么。</p>
          </div>
          <span class="status-badge">{{ orderedCommits.length }} 次提交</span>
        </header>

        <dl class="history-stats">
          <div v-for="stat in historyStats" :key="stat.id">
            <dt>{{ stat.label }}</dt>
            <dd>{{ stat.value }}</dd>
          </div>
        </dl>

        <section v-if="latestHandoff" class="handoff-card">
          <header>
            <span><AppIcon name="message" :size="16" /></span>
            <div>
              <small>最近接续</small>
              <strong>{{ chapterLabel(latestHandoff.chapterCardId) }}</strong>
            </div>
            <button
              type="button"
              @click="forwardCommit(latestHandoff.commitId)"
            >
              {{ commitLabel(latestHandoff.commitId) }}
            </button>
          </header>
          <p>{{ latestHandoff.summary }}</p>
          <div class="handoff-lists">
            <section>
              <strong>必须延续</strong>
              <ul>
                <li
                  v-for="item in latestHandoff.mustCarry"
                  :key="`carry:${item}`"
                >
                  {{ item }}
                </li>
                <li v-if="!latestHandoff.mustCarry.length">暂无</li>
              </ul>
            </section>
            <section>
              <strong>下一章约束</strong>
              <ul>
                <li
                  v-for="item in latestHandoff.nextChapterConstraints"
                  :key="`constraint:${item}`"
                >
                  {{ item }}
                </li>
                <li v-if="!latestHandoff.nextChapterConstraints.length">
                  暂无
                </li>
              </ul>
            </section>
          </div>
        </section>

        <section class="continuity-card">
          <header class="section-heading">
            <div>
              <span>入账时间线</span>
              <strong>章节提交流水</strong>
            </div>
            <span>{{ orderedCommits.length }}</span>
          </header>

          <div v-if="orderedCommits.length" class="history-layout">
            <ol class="history-timeline">
              <li v-for="commit in orderedCommits" :key="commit.id">
                <span class="history-marker" />
                <button type="button" @click="forwardCommit(commit.id)">
                  <span>
                    提交 #{{ commit.sequence }} ·
                    {{ formatTimestamp(commit.committedAt) }}
                  </span>
                  <strong>{{ chapterLabel(commit.chapterCardId) }}</strong>
                  <small>
                    {{ commit.placementIds.length }} 个剧情落点 ·
                    {{ commit.foreshadowingBeatIds.length }} 个伏笔触点
                  </small>
                </button>
              </li>
            </ol>

            <article v-if="currentRecord" class="record-inspector">
              <header>
                <small>当前审计记录</small>
                <h4>
                  {{
                    currentRecord.commitMessage ||
                    `提交 #${currentRecord.sequence}`
                  }}
                </h4>
              </header>
              <dl>
                <template
                  v-for="([label, value], index) in currentSummaryRows"
                  :key="`${label}:${index}`"
                >
                  <dt>{{ label }}</dt>
                  <dd>{{ value }}</dd>
                </template>
              </dl>
              <section v-if="currentRecord.fileChanges.length">
                <strong>资料投影变更</strong>
                <ul>
                  <li
                    v-for="change in currentRecord.fileChanges"
                    :key="change.fileId"
                  >
                    <span>{{ change.path }}</span>
                    <small>
                      {{
                        change.mode === "append" ? "追加历史" : "更新当前快照"
                      }}
                    </small>
                  </li>
                </ul>
              </section>
            </article>
          </div>
          <div v-else class="card-empty">
            还没有章节流水。批准第一章连续性提交后，会在这里形成可追溯的章节历史。
          </div>
        </section>
      </section>
    </div>
  </section>
</template>

<style scoped>
.continuity-workspace {
  container: continuity-workspace / inline-size;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--surface-main);
}

.continuity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 20px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.continuity-heading {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
}

.continuity-heading-icon,
.card-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
}

.continuity-heading > div,
.view-heading > div {
  min-width: 0;
}

.continuity-kicker,
.view-kicker,
.section-heading > div > span,
.continuity-card small,
.inbox-chapter-card small,
.inbox-evidence-card small,
.handoff-card small,
.knowledge-card small,
.record-inspector small {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  letter-spacing: 0.04em;
}

.continuity-heading h2,
.view-heading h3,
.inbox-grid h4,
.record-inspector h4 {
  margin: 0;
}

.continuity-heading h2 {
  font-size: 1.071429rem;
}

.continuity-heading p,
.view-heading p {
  margin: 3px 0 0;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  line-height: 1.5;
}

.continuity-headline-stats,
.execution-stats,
.history-stats {
  display: grid;
  grid-auto-flow: column;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-muted);
}

.continuity-headline-stats > div,
.execution-stats > div,
.history-stats > div {
  display: grid;
  min-width: 88px;
  gap: 2px;
  padding: 8px 12px;
}

.continuity-headline-stats > div + div,
.execution-stats > div + div,
.history-stats > div + div {
  border-left: 1px solid var(--theme-line-soft);
}

.continuity-headline-stats dt,
.execution-stats dt,
.history-stats dt {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.continuity-headline-stats dd,
.execution-stats dd,
.history-stats dd {
  margin: 0;
  font-size: 0.928571rem;
  font-weight: 700;
}

.continuity-view-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  min-width: 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--theme-line);
  background: var(--surface-raised);
}

.continuity-view-tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  gap: 7px;
  padding: 12px 8px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: 0.714286rem;
  font-weight: 600;
  cursor: pointer;
}

.continuity-view-tabs button:hover {
  background: var(--surface-hover);
  color: var(--text-secondary);
}

.continuity-view-tabs button.is-active {
  border-bottom-color: var(--accent);
  background: transparent;
  color: var(--text-primary);
}

.continuity-view-tabs button:focus-visible {
  background: var(--surface-selected);
  outline: none;
}

.view-label-compact {
  display: none;
}

.continuity-content {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.continuity-view {
  display: grid;
  align-content: start;
  min-width: 0;
  gap: 14px;
  padding: clamp(14px, 2.4vw, 24px);
}

.view-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-width: 0;
  min-height: 4.2rem;
  gap: 14px;
}

.view-heading > div > p {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.view-heading h3 {
  margin-top: 1px;
  font-size: 1rem;
}

.status-badge {
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.678571rem;
}

.status-badge.is-ready {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--theme-line));
  background: var(--accent-soft);
  color: var(--accent);
}

.inbox-grid {
  display: grid;
  grid-template-columns: minmax(220px, 0.72fr) minmax(300px, 1.28fr);
  gap: 12px;
}

.inbox-chapter-card,
.inbox-evidence-card,
.continuity-card,
.knowledge-card,
.handoff-card,
.record-inspector {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}

.inbox-chapter-card > header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
}

.inbox-chapter-card h4,
.inbox-evidence-card h4 {
  margin-top: 2px;
  font-size: 0.857143rem;
}

.inbox-chapter-card dl {
  display: grid;
  margin: 0;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.inbox-chapter-card dl > div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 13px;
}

.inbox-chapter-card dl > div + div {
  border-top: 1px solid var(--theme-line-soft);
}

.inbox-chapter-card dt,
.inbox-chapter-card dd {
  margin: 0;
  font-size: 0.714286rem;
}

.inbox-chapter-card dt {
  color: var(--text-tertiary);
}

.inbox-evidence-card > header,
.section-heading,
.handoff-card > header,
.record-inspector > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 10px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.inbox-evidence-card > header > span,
.section-heading > span {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.inbox-evidence-card ul,
.loop-list,
.record-inspector ul {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.inbox-output-preview {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.inbox-output-preview span {
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 0.642857rem;
  text-align: center;
}

.inbox-evidence-card li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
}

.inbox-evidence-card li + li,
.loop-list li + li,
.record-inspector li + li {
  border-top: 1px solid var(--theme-line-soft);
}

.inbox-evidence-card li > span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--surface-muted);
  color: var(--text-tertiary);
}

.inbox-evidence-card li > span.is-ready {
  background: var(--accent-soft);
  color: var(--accent);
}

.inbox-evidence-card li strong {
  font-size: 0.714286rem;
}

.section-heading > div {
  display: grid;
  gap: 2px;
}

.section-heading strong {
  font-size: 0.785714rem;
}

.loop-list li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
}

.loop-kind {
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.642857rem;
}

.loop-list li > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.loop-list strong {
  font-size: 0.75rem;
}

.loop-list p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.714286rem;
  line-height: 1.55;
}

.execution-stats,
.history-stats {
  grid-auto-flow: initial;
}

.execution-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.history-stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.execution-stats > div,
.history-stats > div {
  min-width: 0;
  padding: 12px 14px;
}

.execution-stats dd,
.history-stats dd {
  font-size: 1.285714rem;
}

.card-empty {
  padding: 24px;
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  text-align: center;
}

.knowledge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr));
  gap: 10px;
  padding: 12px;
  background: var(--surface-main);
}

.knowledge-card {
  display: grid;
}

.knowledge-card > header {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.knowledge-card > header > span {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
}

.knowledge-card > header > div {
  display: grid;
  min-width: 0;
}

.knowledge-card em {
  color: var(--accent);
  font-size: 0.642857rem;
  font-style: normal;
}

.knowledge-card > p,
.handoff-card > p {
  margin: 0;
  padding: 12px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.65;
  white-space: pre-wrap;
}

.handoff-lists {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.handoff-lists > section {
  min-width: 0;
  padding: 10px 12px;
}

.handoff-lists > section + section {
  border-left: 1px solid var(--theme-line-soft);
}

.handoff-lists strong {
  font-size: 0.714286rem;
}

.handoff-lists ul {
  display: grid;
  gap: 5px;
  margin: 7px 0 0;
  padding-left: 17px;
  color: var(--text-secondary);
  font-size: 0.678571rem;
  line-height: 1.5;
}

.knowledge-card > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--theme-line-soft);
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.knowledge-card button,
.handoff-card button {
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.continuity-empty {
  display: grid;
  place-items: center;
  min-height: 170px;
  gap: 8px;
  padding: 24px;
  border: 1px dashed var(--theme-line);
  border-radius: 12px;
  background: var(--surface-muted);
  color: var(--text-tertiary);
  text-align: center;
}

.continuity-empty-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
}

.continuity-empty strong {
  color: var(--text-primary);
  font-size: 0.785714rem;
}

.continuity-empty p {
  max-width: 460px;
  margin: 0;
  font-size: 0.714286rem;
  line-height: 1.6;
}

.handoff-card > header {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
}

.handoff-card > header > span {
  display: grid;
  place-items: center;
  color: var(--accent);
}

.handoff-card > header > div {
  display: grid;
}

.history-layout {
  display: grid;
  grid-template-columns: minmax(250px, 0.72fr) minmax(320px, 1.28fr);
  align-items: start;
  gap: 14px;
  padding: 12px;
}

.history-layout .record-inspector {
  border-radius: 10px;
}

.history-timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-timeline li {
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  min-width: 0;
}

.history-timeline li:not(:last-child)::before {
  position: absolute;
  top: 20px;
  bottom: -12px;
  left: 7px;
  width: 1px;
  background: var(--theme-line);
  content: "";
}

.history-marker {
  position: relative;
  z-index: 1;
  width: 15px;
  height: 15px;
  margin-top: 13px;
  border: 3px solid var(--surface-main);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--theme-line);
}

.history-timeline button {
  display: grid;
  min-width: 0;
  gap: 3px;
  margin-bottom: 9px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.history-timeline button:hover {
  border-color: var(--theme-line);
  background: var(--surface-hover);
}

.history-timeline button > span,
.history-timeline button > small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-timeline button > strong {
  overflow: hidden;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-inspector dl {
  display: grid;
  grid-template-columns: minmax(78px, auto) minmax(0, 1fr);
  gap: 8px 12px;
  margin: 0;
  padding: 13px;
}

.record-inspector dt {
  color: var(--text-tertiary);
  font-size: 0.678571rem;
}

.record-inspector dd {
  margin: 0;
  font-size: 0.714286rem;
  line-height: 1.6;
  white-space: pre-wrap;
}

.record-inspector > section {
  border-top: 1px solid var(--theme-line-soft);
}

.record-inspector > section > strong {
  display: block;
  padding: 10px 12px 6px;
  font-size: 0.714286rem;
}

.record-inspector li {
  display: flex;
  justify-content: space-between;
  min-width: 0;
  gap: 8px;
  padding: 8px 12px;
  font-size: 0.678571rem;
}

.record-inspector li span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@container continuity-workspace (max-width: 52rem) {
  .continuity-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .continuity-headline-stats {
    align-self: stretch;
    grid-auto-flow: initial;
    grid-template-columns: repeat(3, 1fr);
  }

  .inbox-grid,
  .history-layout {
    grid-template-columns: 1fr;
  }

  .view-label-full {
    display: none;
  }

  .view-label-compact {
    display: inline;
  }
}

@container continuity-workspace (max-width: 34rem) {
  .continuity-header {
    padding: 14px;
  }

  .continuity-heading {
    align-items: flex-start;
  }

  .continuity-heading p {
    display: none;
  }

  .continuity-headline-stats > div {
    min-width: 0;
    padding: 7px 8px;
  }

  .continuity-view-tabs {
    padding: 0 5px;
  }

  .continuity-view-tabs button {
    flex-direction: column;
    gap: 3px;
    padding-inline: 3px;
    font-size: 0.642857rem;
  }

  .continuity-view {
    padding: 12px;
  }

  .view-heading {
    flex-direction: column;
  }

  .execution-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .history-stats {
    grid-template-columns: 1fr;
  }

  .execution-stats > div:nth-child(3) {
    border-left: 0;
    border-top: 1px solid var(--theme-line-soft);
  }

  .execution-stats > div:nth-child(4) {
    border-top: 1px solid var(--theme-line-soft);
  }

  .history-stats > div + div {
    border-top: 1px solid var(--theme-line-soft);
    border-left: 0;
  }

  .loop-list li {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .inbox-output-preview {
    grid-template-columns: 1fr;
  }

  .inbox-output-preview small {
    text-align: center;
  }

  .loop-list li > small {
    display: none;
  }

  .knowledge-card > footer,
  .record-inspector li {
    align-items: flex-start;
    flex-direction: column;
  }

  .handoff-lists {
    grid-template-columns: 1fr;
  }

  .handoff-lists > section + section {
    border-top: 1px solid var(--theme-line-soft);
    border-left: 0;
  }
}
</style>
