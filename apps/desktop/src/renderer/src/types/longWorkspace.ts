import type {
  DeepWriteApi,
  LongBookSummary,
  LongChapterCardId,
  LongFileId,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceFileReference,
  LongWorkspaceRoot
} from "@deepwrite/contracts";

export type LongWorkspaceFileRole =
  | "content"
  | "book-line"
  | "core-profile"
  | "relationships"
  | "current-state"
  | "history"
  | "body"
  | "character-state"
  | "handoff"
  | "ledger-record";

export interface LongWorkspaceSelectionFile {
  role: LongWorkspaceFileRole;
  label: string;
  file: LongWorkspaceFileReference;
  readOnly?: boolean;
}

/**
 * Renderer-only navigation state. Long-form files never enter the short/script
 * WorkspaceDocument or editor-draft stores.
 */
export interface LongWorkspaceSelection {
  key: string;
  root: LongWorkspaceRoot;
  chapterCardId?: LongChapterCardId;
  title: string;
  breadcrumbs: string[];
  files: LongWorkspaceSelectionFile[];
  preferredRole: LongWorkspaceFileRole;
  description?: string;
}

export type LongWorkspaceRendererApi = DeepWriteApi["long"];

export function resolveLongWorkspaceApi(): LongWorkspaceRendererApi | undefined {
  return window.deepwrite?.long;
}

export function longBookResourceId(bookId: string): string {
  return `long-book:${bookId}`;
}

export function longBookIdFromResourceId(
  resourceId: string
): string | undefined {
  const prefix = "long-book:";
  return resourceId.startsWith(prefix)
    ? resourceId.slice(prefix.length) || undefined
    : undefined;
}

export function isEditableLongFile(
  file: Pick<LongWorkspaceFileReference, "id" | "path">
): file is Pick<LongWorkspaceFileReference, "id" | "path"> & {
  id: LongFileId;
} {
  return file.path.toLowerCase().endsWith(".md");
}

export function isLongMigrationEvidenceCategoryId(
  categoryId: string
): boolean {
  return categoryId.startsWith("world_migration-evidence-");
}

export function replaceLongBookSummary(
  books: readonly LongBookSummary[],
  summary: LongBookSummary
): LongBookSummary[] {
  const next = books.filter((book) => book.id !== summary.id);
  next.push(summary);
  return next.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id)
  );
}

export function nextWritableLongChapterId(
  workspaceIndex: LongWorkspaceIndexSnapshot
): LongChapterCardId | null {
  const volumeOrder = new Map(
    workspaceIndex.plot.volumes.map(({ id, order }) => [id, order])
  );
  const ordered = [...workspaceIndex.plot.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  );
  const candidate = ordered[workspaceIndex.ledger.commits.length];
  if (!candidate) return null;
  const entry = workspaceIndex.chapters.find(
    ({ chapterCardId }) => chapterCardId === candidate.id
  );
  return entry?.commitId === null ? candidate.id : null;
}

export function createLongChapterSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId
): LongWorkspaceSelection | undefined {
  const chapter = summary.navigation.chapterCards.find(
    ({ id }) => id === chapterCardId
  );
  const volume = summary.navigation.volumes.find(
    ({ id }) => id === chapter?.volumeId
  );
  const entry = workspaceIndex.chapters.find(
    (candidate) => candidate.chapterCardId === chapterCardId
  );
  if (!chapter || !volume || !entry) return undefined;
  const committed = entry.commitId !== null;
  const nextWritable = nextWritableLongChapterId(workspaceIndex);
  return {
    key: `chapter:${chapter.id}`,
    root: "draft",
    chapterCardId: chapter.id,
    title: chapter.title,
    breadcrumbs: [
      summary.title,
      "正文",
      volume.title,
      chapter.title
    ],
    files: [
      {
        role: "body",
        label: "正文",
        file: entry.body,
        ...(committed ? { readOnly: true } : {})
      },
      {
        role: "character-state",
        label: "人物状态",
        file: entry.characterState,
        ...(committed ? { readOnly: true } : {})
      },
      {
        role: "handoff",
        label: "Handoff",
        file: entry.handoff,
        ...(committed ? { readOnly: true } : {})
      },
    ],
    preferredRole: "body",
    description: committed
      ? "本章已提交并锁定；如需修改，请先回滚最后一次连续性提交。"
      : nextWritable === chapter.id
        ? "这是连续下一章，可由单章写作智能体写入三份文档。"
        : "本章尚未提交，但不是连续下一章；可手工编辑，自动写作需先完成前文章节。"
  };
}

/**
 * Keeps chapter authoring and continuity review as two distinct entry points.
 * The same chapter triplet is visible for evidence, but locked while the
 * continuity agent reviews it and proposes an atomic ledger commit.
 */
export function createLongContinuitySelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId
): LongWorkspaceSelection | undefined {
  const chapter = summary.navigation.chapterCards.find(
    ({ id }) => id === chapterCardId
  );
  const volume = summary.navigation.volumes.find(
    ({ id }) => id === chapter?.volumeId
  );
  const entry = workspaceIndex.chapters.find(
    (candidate) => candidate.chapterCardId === chapterCardId
  );
  if (!chapter || !volume || !entry || entry.commitId !== null) {
    return undefined;
  }
  return {
    key: `continuity:${chapter.id}`,
    root: "continuity_ledger",
    chapterCardId: chapter.id,
    title: `${chapter.title} · 连续性核对`,
    breadcrumbs: [
      summary.title,
      "连续性账本",
      volume.title,
      chapter.title
    ],
    files: [
      {
        role: "body",
        label: "正文",
        file: entry.body,
        readOnly: true
      },
      {
        role: "character-state",
        label: "人物状态",
        file: entry.characterState,
        readOnly: true
      },
      {
        role: "handoff",
        label: "Handoff",
        file: entry.handoff,
        readOnly: true
      }
    ],
    preferredRole: "body",
    description:
      "连续性账本 Agent 将核对本章三件套；提交提案仍需你在影响预览中确认。"
  };
}

export function reconcileLongWorkspaceSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  selection: LongWorkspaceSelection
): LongWorkspaceSelection | undefined {
  if (selection.key.startsWith("root:")) {
    return {
      ...selection,
      breadcrumbs: [summary.title, selection.title],
      files: []
    };
  }
  if (selection.key.startsWith("chapter:")) {
    return createLongChapterSelection(
      summary,
      workspaceIndex,
      selection.key.slice("chapter:".length)
    );
  }
  if (selection.key.startsWith("continuity:")) {
    return createLongContinuitySelection(
      summary,
      workspaceIndex,
      selection.key.slice("continuity:".length)
    );
  }
  if (selection.key === "plot-design:book-line") {
    return {
      ...selection,
      breadcrumbs: [summary.title, "情节设计", "全书故事线"],
      files: [
        {
          role: "book-line",
          label: "故事线",
          file: workspaceIndex.bookLine
        }
      ]
    };
  }
  if (selection.key.startsWith("worldbuilding:")) {
    const category = workspaceIndex.worldbuilding.find(
      ({ id }) =>
        id === selection.key.slice("worldbuilding:".length)
    );
    if (!category) return undefined;
    return {
      ...selection,
      title: category.title,
      breadcrumbs: [summary.title, "世界观", category.title],
      files: [
        {
          role: "content",
          label:
            category.format === "list" ? "设定条目" : "设定正文",
          file: category.file,
          ...(isLongMigrationEvidenceCategoryId(category.id)
            ? { readOnly: true }
            : {})
        }
      ],
      ...(isLongMigrationEvidenceCategoryId(category.id)
        ? {
            description:
              "这是迁移生成的只读证据，可搜索并供 Agent 按需读取。"
          }
        : {})
    };
  }
  if (selection.key.startsWith("character:")) {
    const characterId = selection.key.slice("character:".length);
    const character = summary.navigation.characters.find(
      ({ id }) => id === characterId
    );
    const entry = workspaceIndex.characterFiles.find(
      (candidate) => candidate.characterId === characterId
    );
    if (!character || !entry) return undefined;
    const continuityLocked = workspaceIndex.ledger.commits.length > 0;
    return {
      ...selection,
      title: character.name,
      breadcrumbs: [summary.title, "人物设计", character.name],
      files: [
        {
          role: "core-profile",
          label: "核心档案",
          file: entry.coreProfile
        },
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
      ],
      description: continuityLocked
        ? "人物关系、当前状态与历史轨迹已由连续性账本接管；核心档案仍可编辑。"
        : "首章连续性提交前，人物四份档案均可直接编辑。"
    };
  }
  if (selection.key.startsWith("ledger:")) {
    const commit = workspaceIndex.ledger.commits.find(
      ({ id }) => id === selection.key.slice("ledger:".length)
    );
    if (!commit) return undefined;
    const chapter = summary.navigation.chapterCards.find(
      ({ id }) => id === commit.chapterCardId
    );
    return {
      ...selection,
      title: `提交 #${commit.sequence}`,
      breadcrumbs: [
        summary.title,
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
      description: `${commit.committedAt} · ${
        commit.reversible ? "可回滚" : "不可回滚"
      }`
    };
  }
  return selection;
}
