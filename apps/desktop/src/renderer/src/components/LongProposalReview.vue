<script setup lang="ts">
import { computed } from "vue";
import type {
  LongWorkspaceEntityChange,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  items: LongWorkspaceProposalItem[];
  workspaceIndex?: LongWorkspaceIndexSnapshot | null;
}>();

const emit = defineEmits<{
  approve: [eventId: string];
  reject: [eventId: string];
  retryPreview: [eventId: string];
}>();

const pendingCount = computed(() => props.items.length);

function proposalTitle(item: LongWorkspaceProposalItem): string {
  switch (item.event.type) {
    case "long.mutation_proposal":
      return "结构变更";
    case "long.chapter_dispatch_proposal":
      return "串行写作调度";
    case "long.chapter_write_proposal":
      return "章节写入";
    case "long.ledger_commit_proposal":
      return "连续性提交";
  }
}

function proposalAction(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return "处理中…";
  if (
    item.status === "error" &&
    item.event.type !== "long.mutation_proposal"
  ) {
    return "重试";
  }
  switch (item.event.type) {
    case "long.mutation_proposal":
      return "确认应用";
    case "long.chapter_dispatch_proposal":
      return "确认启动串行写作";
    case "long.chapter_write_proposal":
      return "确认写入";
    case "long.ledger_commit_proposal":
      return "确认提交";
  }
}

function structureImpactTotal(item: LongWorkspaceProposalItem): number {
  const impact = item.preview?.impact;
  if (!impact) return 0;
  return (
    impact.createdEntityIds.length +
    impact.updatedEntityIds.length +
    impact.deletedEntityIds.length
  );
}

const workspaceFilePaths = computed(() => {
  const index = props.workspaceIndex;
  const entries: Array<readonly [string, string]> = [];
  if (!index) return new Map(entries);
  entries.push([index.bookLine.id, index.bookLine.path]);
  for (const category of index.worldbuilding) {
    entries.push([category.file.id, category.file.path]);
  }
  for (const character of index.characterFiles) {
    entries.push(
      [character.coreProfile.id, character.coreProfile.path],
      [character.relationships.id, character.relationships.path],
      [character.currentState.id, character.currentState.path],
      [character.history.id, character.history.path]
    );
  }
  for (const chapter of index.chapters) {
    entries.push(
      [chapter.body.id, chapter.body.path],
      [chapter.characterState.id, chapter.characterState.path],
      [chapter.handoff.id, chapter.handoff.path]
    );
  }
  for (const commit of index.ledger.commits) {
    entries.push([commit.recordFile.id, commit.recordFile.path]);
  }
  return new Map(entries);
});

function proposalFilePath(
  item: LongWorkspaceProposalItem,
  fileId: string
): string {
  if (item.event.type === "long.mutation_proposal") {
    const created = item.preview?.fileIntents.find(
      ({ file }) => file.id === fileId
    );
    if (created) return created.file.path;
  }
  return workspaceFilePaths.value.get(fileId) ?? fileId;
}

const entityKindLabels: Record<LongWorkspaceEntityChange["kind"], string> = {
  "worldbuilding-category": "世界观分类",
  character: "人物",
  volume: "卷",
  arc: "剧情弧",
  "chapter-card": "章卡",
  "story-event": "故事事件",
  "event-connection": "事件连接",
  "narrative-placement": "叙事落点",
  "foreshadowing-thread": "伏笔线",
  "foreshadowing-beat": "伏笔节拍"
};

function entityActionLabel(
  action: LongWorkspaceEntityChange["action"]
): string {
  switch (action) {
    case "create":
      return "新建实体";
    case "update":
      return "更新实体";
    case "delete":
      return "删除实体";
  }
}

function entitySnapshotText(
  value: LongWorkspaceEntityChange["before"] | LongWorkspaceEntityChange["after"]
): string {
  return value === null ? "（不存在）" : JSON.stringify(value, null, 2);
}
</script>

<template>
  <section
    v-if="items.length"
    class="long-proposal-review"
    aria-label="长篇待审批提案"
  >
    <header>
      <div>
        <span>写入审批</span>
        <strong>{{ pendingCount }} 项待确认</strong>
      </div>
      <small>所有变更均按当前书籍隔离</small>
    </header>

    <div class="long-proposal-list">
      <article
        v-for="item in items"
        :key="item.event.id"
        class="long-proposal-card"
        :data-proposal-type="item.event.type"
      >
        <div class="long-proposal-heading">
          <span class="long-proposal-icon">
            <AppIcon
              :name="
                item.event.type === 'long.ledger_commit_proposal'
                  ? 'ledger'
                  : item.event.type === 'long.chapter_write_proposal' ||
                      item.event.type === 'long.chapter_dispatch_proposal'
                    ? 'edit'
                    : 'wand'
              "
              :size="15"
            />
          </span>
          <div>
            <strong>{{ proposalTitle(item) }}</strong>
            <small>{{ item.event.payload.agentId }}</small>
          </div>
          <span
            class="long-proposal-status"
            :class="`is-${item.status}`"
          >
            {{
              item.status === "previewing"
                ? "正在预览"
                : item.status === "submitting"
                  ? "正在处理"
                  : item.status === "error"
                    ? "需要重试"
                    : "等待确认"
            }}
          </span>
        </div>

        <p>{{ item.event.payload.summary }}</p>

        <div
          v-if="
            item.event.type === 'long.mutation_proposal' &&
            item.preview
          "
          class="long-proposal-impact"
        >
          <span>
            <strong>{{ item.event.payload.batch.operations.length }}</strong>
            结构操作
          </span>
          <span>
            <strong>{{ structureImpactTotal(item) }}</strong>
            实体受影响
          </span>
          <span>
            <strong>{{ item.preview.fileIntents.length }}</strong>
            文件增删
          </span>
          <span>
            <strong>{{ item.preview.documentWrites.length }}</strong>
            文档写入
          </span>
        </div>
        <details
          v-if="
            item.event.type === 'long.mutation_proposal' &&
            item.preview
          "
          class="long-proposal-details"
          :open="
            item.preview.impact.deletedEntityIds.length > 0 ||
            item.preview.impact.deletedFileIds.length > 0
          "
        >
          <summary>查看具体影响</summary>
          <div
            v-if="item.preview.entityChanges.length"
            class="long-proposal-detail-group long-proposal-entity-list"
          >
            <strong>
              实体完整前后快照（{{ item.preview.entityChanges.length }}）
            </strong>
            <details
              v-for="change in item.preview.entityChanges"
              :key="`${change.action}:${change.kind}:${change.id}`"
              class="long-proposal-entity-change"
              :class="{ 'is-danger': change.action === 'delete' }"
            >
              <summary>
                {{ entityActionLabel(change.action) }} ·
                {{ entityKindLabels[change.kind] }} · {{ change.id }}
              </summary>
              <div class="long-proposal-entity-diff">
                <section>
                  <strong>变更前</strong>
                  <pre>{{ entitySnapshotText(change.before) }}</pre>
                </section>
                <section>
                  <strong>变更后</strong>
                  <pre>{{ entitySnapshotText(change.after) }}</pre>
                </section>
              </div>
            </details>
          </div>
          <div
            v-if="item.preview.impact.deletedFileIds.length"
            class="long-proposal-detail-group is-danger"
          >
            <strong>
              删除文件引用（{{ item.preview.impact.deletedFileIds.length }}）
            </strong>
            <code
              v-for="id in item.preview.impact.deletedFileIds"
              :key="id"
            >{{ id }}</code>
          </div>
          <div
            v-if="item.preview.fileIntents.length"
            class="long-proposal-detail-group"
          >
            <strong>文件操作</strong>
            <span
              v-for="intent in item.preview.fileIntents"
              :key="`${intent.action}:${intent.file.id}`"
              :class="{ 'is-danger': intent.action === 'delete' }"
            >
              {{ intent.action === "delete" ? "删除引用" : "新建" }} ·
              {{ intent.file.path }} · {{ intent.reason }}
            </span>
          </div>
          <div
            v-if="item.preview.documentWrites.length"
            class="long-proposal-detail-group long-proposal-write-list"
          >
            <strong>文档写入内容</strong>
            <details
              v-for="write in item.preview.documentWrites"
              :key="write.proposalId"
              class="long-proposal-content"
            >
              <summary>
                {{ proposalFilePath(item, write.fileId) }} ·
                {{ write.mode }} ·
                {{ write.expectedRevision ?? "新文件" }} →
                {{ write.nextRevision }}
              </summary>
              <span>{{ write.reason }}</span>
              <textarea
                readonly
                spellcheck="false"
                :aria-label="`${proposalFilePath(item, write.fileId)}拟写内容`"
                :value="write.content"
              />
            </details>
          </div>
        </details>

        <div
          v-else-if="
            item.event.type === 'long.chapter_dispatch_proposal'
          "
          class="long-proposal-impact"
        >
          <span>
            <strong>{{ item.event.payload.chapters.length }}</strong>
            {{
              item.event.payload.scope === "chapter"
                ? "单章"
                : item.event.payload.scope === "arc"
                  ? "主弧连续章节"
                  : "当前卷章节"
            }}
          </span>
          <span>
            <strong>
              {{
                item.event.payload.chapters.filter(
                  ({ status }) => status === "ready_to_commit"
                ).length
              }}
            </strong>
            已可提交
          </span>
          <span>
            <strong>
              {{
                item.event.payload.chapters.filter(
                  ({ status }) => status !== "ready_to_commit"
                ).length
              }}
            </strong>
            需要补写
          </span>
        </div>
        <details
          v-if="item.event.type === 'long.chapter_dispatch_proposal'"
          class="long-proposal-details"
        >
          <summary>查看串行章序与三件套缺失项</summary>
          <div class="long-proposal-detail-group">
            <span
              v-for="(chapter, chapterIndex) in item.event.payload.chapters"
              :key="chapter.chapterCardId"
            >
              {{ chapterIndex + 1 }}. {{ chapter.title }} ·
              {{
                chapter.status === "ready_to_commit"
                  ? "三件套完整，直接核对提交"
                  : chapter.status === "empty"
                    ? "三件套均为空"
                    : `缺失 ${chapter.missingFiles.join("、")}`
              }}
            </span>
          </div>
        </details>

        <div
          v-else-if="item.event.type === 'long.chapter_write_proposal'"
          class="long-proposal-impact"
        >
          <span>
            <strong>{{ item.event.payload.input.body.content.length }}</strong>
            正文字符
          </span>
          <span>
            <strong>
              {{ item.event.payload.input.characterState.content.length }}
            </strong>
            状态字符
          </span>
          <span>
            <strong>{{ item.event.payload.input.handoff.content.length }}</strong>
            Handoff
          </span>
        </div>
        <details
          v-if="item.event.type === 'long.chapter_write_proposal'"
          class="long-proposal-details"
        >
          <summary>审阅章节三份拟写内容</summary>
          <div class="long-proposal-detail-group long-proposal-write-list">
            <details class="long-proposal-content">
              <summary>
                正文 · {{ item.event.payload.input.body.baseRevision }} →
                提交后计算
              </summary>
              <textarea
                readonly
                spellcheck="false"
                aria-label="章节正文拟写内容"
                :value="item.event.payload.input.body.content"
              />
            </details>
            <details class="long-proposal-content">
              <summary>
                人物状态 ·
                {{ item.event.payload.input.characterState.baseRevision }} →
                提交后计算
              </summary>
              <textarea
                readonly
                spellcheck="false"
                aria-label="章末人物状态拟写内容"
                :value="item.event.payload.input.characterState.content"
              />
            </details>
            <details class="long-proposal-content">
              <summary>
                Handoff · {{ item.event.payload.input.handoff.baseRevision }} →
                提交后计算
              </summary>
              <textarea
                readonly
                spellcheck="false"
                aria-label="下一章交接拟写内容"
                :value="item.event.payload.input.handoff.content"
              />
            </details>
          </div>
        </details>

        <div
          v-else-if="item.event.type === 'long.ledger_commit_proposal'"
          class="long-proposal-impact"
        >
          <span>
            <strong>
              {{
                Object.keys(
                  item.event.payload.input.placementDecisions
                ).length
              }}
            </strong>
            叙事落点
          </span>
          <span>
            <strong>
              {{
                Object.keys(
                  item.event.payload.input.foreshadowingBeatDecisions
                ).length
              }}
            </strong>
            伏笔决策
          </span>
          <span>
            <strong>{{ item.event.payload.input.fileUpdates.length }}</strong>
            文件更新
          </span>
        </div>
        <details
          v-if="item.event.type === 'long.ledger_commit_proposal'"
          class="long-proposal-details"
        >
          <summary>查看连续性决策</summary>
          <div class="long-proposal-detail-group">
            <strong>提交说明</strong>
            <span>
              {{
                item.event.payload.input.commitMessage ||
                item.event.payload.summary
              }}
            </span>
          </div>
          <div class="long-proposal-detail-group">
            <strong>核验的章节文件版本</strong>
            <code>
              正文 ·
              {{ item.event.payload.input.chapterFileRevisions.body }}
            </code>
            <code>
              人物状态 ·
              {{
                item.event.payload.input.chapterFileRevisions.characterState
              }}
            </code>
            <code>
              Handoff ·
              {{ item.event.payload.input.chapterFileRevisions.handoff }}
            </code>
          </div>
          <div class="long-proposal-detail-group">
            <strong>本章六类连续性摘要</strong>
            <span>
              时间线：{{ item.event.payload.input.chapterSummary.timeline }}
            </span>
            <span>
              人物状态：{{
                item.event.payload.input.chapterSummary.characterStates
              }}
            </span>
            <span>
              势力状态：{{
                item.event.payload.input.chapterSummary.factionStates
              }}
            </span>
            <span>
              境界状态：{{
                item.event.payload.input.chapterSummary.realmStates
              }}
            </span>
            <span>
              伏笔状态：{{
                item.event.payload.input.chapterSummary.foreshadowingStates
              }}
            </span>
            <span>
              连续性备注：{{
                item.event.payload.input.chapterSummary.continuityNotes
              }}
            </span>
          </div>
          <div class="long-proposal-detail-group">
            <strong>叙事落点</strong>
            <code
              v-for="(decision, id) in item.event.payload.input
                .placementDecisions"
              :key="id"
            >{{ id }} → {{ decision.status }} · {{ decision.note }}</code>
          </div>
          <div class="long-proposal-detail-group">
            <strong>伏笔节拍</strong>
            <code
              v-for="(decision, id) in item.event.payload.input
                .foreshadowingBeatDecisions"
              :key="id"
            >{{ id }} → {{ decision.status }} · {{ decision.note }}</code>
          </div>
          <div
            v-if="item.event.payload.input.fileUpdates.length"
            class="long-proposal-detail-group long-proposal-write-list"
          >
            <strong>连续性资料更新</strong>
            <details
              v-for="update in item.event.payload.input.fileUpdates"
              :key="update.fileId"
              class="long-proposal-content"
            >
              <summary>
                {{ proposalFilePath(item, update.fileId) }} ·
                {{
                  update.mode === "append"
                    ? "审计追加"
                    : "完整替换"
                }}
                ·
                {{ update.baseRevision }} → 提交后计算 ·
                {{ update.content.length }} 字符
              </summary>
              <textarea
                readonly
                spellcheck="false"
                :aria-label="`${proposalFilePath(item, update.fileId)}连续性拟写内容`"
                :value="update.content"
              />
            </details>
          </div>
        </details>

        <p v-if="item.error" class="long-proposal-error">
          {{ item.error }}
        </p>

        <footer>
          <button
            class="long-proposal-secondary"
            type="button"
            :disabled="item.status === 'submitting'"
            @click="emit('reject', item.event.id)"
          >
            拒绝
          </button>
          <button
            v-if="
              item.event.type === 'long.mutation_proposal' &&
              item.status === 'error'
            "
            class="long-proposal-secondary"
            type="button"
            @click="emit('retryPreview', item.event.id)"
          >
            重新预览
          </button>
          <button
            class="long-proposal-primary"
            type="button"
            :disabled="
              item.status === 'previewing' ||
              item.status === 'submitting' ||
              (item.event.type === 'long.mutation_proposal' &&
                (item.status !== 'ready' || !item.preview))
            "
            @click="emit('approve', item.event.id)"
          >
            {{ proposalAction(item) }}
          </button>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.long-proposal-review {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: min(43%, 360px);
  min-height: 0;
  border-top: 1px solid var(--theme-line);
  background: var(--surface-muted);
  color: var(--text-primary);
}

.long-proposal-review > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.long-proposal-review > header > div {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.long-proposal-review > header span,
.long-proposal-review > header small {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
}

.long-proposal-review > header strong {
  font-size: 0.75rem;
}

.long-proposal-list {
  display: grid;
  gap: 7px;
  min-height: 0;
  padding: 8px;
  overflow: auto;
}

.long-proposal-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
}

.long-proposal-heading {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.long-proposal-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
}

.long-proposal-heading > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.long-proposal-heading strong {
  font-size: 0.75rem;
}

.long-proposal-heading small {
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

.long-proposal-status {
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--surface-selected);
  color: var(--text-secondary);
  font-size: 0.607143rem;
}

.long-proposal-status.is-error,
.long-proposal-error {
  color: var(--danger);
}

.long-proposal-card > p {
  color: var(--text-secondary);
  font-size: 0.678571rem;
  line-height: 1.55;
}

.long-proposal-impact {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.long-proposal-impact span {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 4px 6px;
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}

.long-proposal-impact strong {
  color: var(--text-primary);
  font-size: 0.678571rem;
}

.long-proposal-details {
  padding: 6px 8px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-main);
  font-size: 0.642857rem;
}

.long-proposal-details summary {
  color: var(--text-secondary);
  cursor: pointer;
}

.long-proposal-details[open] summary {
  margin-bottom: 7px;
}

.long-proposal-detail-group {
  display: grid;
  gap: 4px;
  max-height: 150px;
  padding: 6px;
  overflow: auto;
  border-radius: 7px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.long-proposal-detail-group + .long-proposal-detail-group {
  margin-top: 5px;
}

.long-proposal-detail-group strong {
  color: var(--text-primary);
}

.long-proposal-detail-group code,
.long-proposal-detail-group span {
  overflow-wrap: anywhere;
  color: var(--text-tertiary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
}

.long-proposal-write-list {
  max-height: none;
}

.long-proposal-entity-list {
  max-height: 360px;
}

.long-proposal-entity-change {
  padding: 5px 6px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-main);
}

.long-proposal-entity-change > summary {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--code-font);
  font-size: var(--code-font-size);
}

.long-proposal-entity-change.is-danger > summary {
  color: var(--danger);
}

.long-proposal-entity-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.long-proposal-entity-diff section {
  min-width: 0;
}

.long-proposal-entity-diff pre {
  max-height: 240px;
  margin: 4px 0 0;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.long-proposal-content {
  padding: 5px 6px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-main);
}

.long-proposal-content summary {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--code-font);
  font-size: var(--code-font-size);
}

.long-proposal-content[open] summary {
  margin-bottom: 5px;
}

.long-proposal-content textarea {
  display: block;
  width: 100%;
  min-height: 132px;
  max-height: 320px;
  resize: vertical;
  padding: 7px;
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.55;
}

.long-proposal-detail-group.is-danger strong,
.long-proposal-detail-group .is-danger {
  color: var(--danger);
}

.long-proposal-card footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.long-proposal-card button {
  min-height: 27px;
  padding: 4px 9px;
  border-radius: 7px;
  font-size: 0.678571rem;
  cursor: pointer;
}

.long-proposal-card button:disabled {
  cursor: default;
  opacity: 0.55;
}

.long-proposal-secondary {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.long-proposal-secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-proposal-primary {
  background: var(--neutral-solid);
  color: var(--accent-contrast, #fff);
}

:global(html[data-theme="dark"] .long-proposal-primary) {
  background: var(--accent);
}

@media (max-width: 42rem) {
  .long-proposal-entity-diff {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
