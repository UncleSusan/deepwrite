import {
  EMPTY_LONG_MARKDOWN_REVISION,
  type DeepWriteApi,
  type LongArcId,
  type LongBookSummary,
  type LongChapterCardId,
  type LongCharacterGroup,
  type LongCharacterId,
  type LongFileId,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceFileReference,
  type LongWorkspaceRoot,
  type LongVolumeId,
  type LongWorldbuildingFormat
} from "@deepwrite/contracts";

export type LongWorkspaceFileRole =
  | "content"
  | "overview"
  | "book-line"
  | "core-profile"
  | "relationships"
  | "current-state"
  | "history"
  | "body"
  | "card"
  | "foreshadowing-changes"
  | "world-reveals"
  | "character-state"
  | "handoff"
  | "ledger-record";

export type LongContinuityView =
  | "inbox"
  | "snapshot"
  | "execution"
  | "knowledge"
  | "history";

export const LONG_CHARACTER_GROUP_OPTIONS: ReadonlyArray<{
  value: LongCharacterGroup;
  label: string;
}> = [
  { value: "protagonist", label: "主角" },
  { value: "major_supporting", label: "主要配角" },
  { value: "minor_supporting", label: "次要配角" },
  { value: "passerby", label: "路人" }
];

export function longCharacterGroupLabel(group: LongCharacterGroup): string {
  return (
    LONG_CHARACTER_GROUP_OPTIONS.find(({ value }) => value === group)?.label ??
    group
  );
}

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
  continuityView?: LongContinuityView;
  worldbuildingFormat?: LongWorldbuildingFormat;
  worldbuildingItems?: Array<{
    id: string;
    title: string;
    order: number;
    file: LongWorkspaceFileReference;
  }>;
  chapterCardId?: LongChapterCardId;
  characterGroup?: LongCharacterGroup;
  characterId?: LongCharacterId;
  characterTabs?: Array<{
    id: LongCharacterId;
    label: string;
  }>;
  plotPointVolumeId?: LongVolumeId;
  plotPointId?: LongArcId;
  plotPointTabs?: Array<{
    id: LongArcId;
    label: string;
  }>;
  storyPlots?: Array<{
    id: string;
    title: string;
    order: number;
    file: LongWorkspaceFileReference;
  }>;
  chapterCardVolumeId?: LongVolumeId;
  chapterCardTabs?: Array<{
    id: LongChapterCardId;
    label: string;
  }>;
  title: string;
  breadcrumbs: string[];
  files: LongWorkspaceSelectionFile[];
  preferredRole: LongWorkspaceFileRole;
  description?: string;
}

/**
 * Completion handshake for a manual structure mutation.
 *
 * `succeed` is only valid after the operation was durably applied and the
 * renderer refreshed. `fail` means nothing was applied and the editor should
 * preserve the user's draft for a retry. `appliedButRefreshFailed` closes the
 * submitted surface without offering a blind retry because the durable write
 * already happened even though the refreshed snapshot is unavailable.
 */
export interface LongStructureMutationCompletion {
  succeed(): void;
  fail(message?: string): void;
  appliedButRefreshFailed(message?: string): void;
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
  if (!resourceId.startsWith(prefix)) return undefined;
  const suffix = resourceId.slice(prefix.length);
  const separator = suffix.indexOf(":");
  const bookId = separator >= 0 ? suffix.slice(0, separator) : suffix;
  return bookId || undefined;
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

type LongChapterFileEntry = LongWorkspaceIndexSnapshot["chapters"][number];

function orderedLongLedgerCommits(
  workspaceIndex: LongWorkspaceIndexSnapshot
) {
  return [...workspaceIndex.ledger.commits].sort(
    (left, right) =>
      right.sequence - left.sequence || right.id.localeCompare(left.id)
  );
}

/**
 * Resolves the newest committed chapter whose continuity outputs are
 * available as Markdown. Current text-file commits qualify directly; a
 * legacy structured commit qualifies only after the store has projected its
 * audit record into a non-empty per-chapter foreshadowing file.
 */
export function latestCommittedContinuityChapter(
  workspaceIndex: LongWorkspaceIndexSnapshot,
  predicate: (chapter: LongChapterFileEntry) => boolean = () => true
): LongChapterFileEntry | undefined {
  for (const commit of orderedLongLedgerCommits(workspaceIndex)) {
    const chapter = workspaceIndex.chapters.find(
      (entry) =>
        entry.commitId === commit.id ||
        (entry.chapterCardId === commit.chapterCardId &&
          entry.commitId !== null)
    );
    const hasMarkdownProjection =
      commit.mode === "text_files" ||
      chapter?.foreshadowingChanges.revision !==
        EMPTY_LONG_MARKDOWN_REVISION;
    if (chapter && hasMarkdownProjection && predicate(chapter)) {
      return chapter;
    }
  }
  return undefined;
}

function hasLegacyStructuredCommit(
  workspaceIndex: LongWorkspaceIndexSnapshot
): boolean {
  return workspaceIndex.ledger.commits.some(
    ({ mode }) => mode !== "text_files"
  );
}

function characterDesignSelectionFiles(
  workspaceIndex: LongWorkspaceIndexSnapshot,
  entry: LongWorkspaceIndexSnapshot["characterFiles"][number]
): LongWorkspaceSelectionFile[] {
  const mappedChapter = latestCommittedContinuityChapter(
    workspaceIndex,
    (chapter) =>
      (chapter.characterContinuity ?? []).some(
        ({ characterId }) => characterId === entry.characterId
      )
  );
  const mappedContinuity = mappedChapter?.characterContinuity.find(
    ({ characterId }) => characterId === entry.characterId
  );
  const legacyLocked = hasLegacyStructuredCommit(workspaceIndex);
  return [
    {
      role: "core-profile",
      label: "核心档案",
      file: entry.coreProfile
    },
    {
      role: "relationships",
      label: "人物关系",
      file: entry.relationships,
      ...(legacyLocked ? { readOnly: true } : {})
    },
    {
      role: "current-state",
      label: "当前状态",
      file: mappedContinuity?.currentState ?? entry.currentState,
      ...(mappedContinuity || legacyLocked ? { readOnly: true } : {})
    },
    {
      role: "history",
      label: "历史轨迹",
      file: mappedContinuity?.history ?? entry.history,
      ...(mappedContinuity || legacyLocked ? { readOnly: true } : {})
    }
  ];
}

export function createLongCharacterOverviewSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot
): LongWorkspaceSelection | undefined {
  if (!workspaceIndex.characterOverview) return undefined;
  return {
    key: "character-overview",
    root: "character_design",
    title: "概览",
    breadcrumbs: [summary.title, "人物设计", "概览"],
    files: [
      {
        role: "overview",
        label: "概览",
        file: workspaceIndex.characterOverview
      }
    ],
    preferredRole: "overview",
    description:
      "人物设计阶段概览；统计全部人物的简单信息，供智能体先读后定位。"
  };
}

export function createLongCharacterGroupSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  group: LongCharacterGroup,
  preferredCharacterId?: LongCharacterId
): LongWorkspaceSelection {
  const groupLabel = longCharacterGroupLabel(group);
  const characters = summary.navigation.characters
    .filter((character) => character.group === group)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
  const characterTabs = characters.map((character) => ({
    id: character.id,
    label: character.name
  }));
  const character =
    characters.find(({ id }) => id === preferredCharacterId) ??
    characters[0];
  const baseSelection = {
    key: `character-group:${group}`,
    root: "character_design" as const,
    characterGroup: group,
    characterTabs,
    preferredRole: "core-profile" as const
  };
  if (!character) {
    return {
      ...baseSelection,
      title: groupLabel,
      breadcrumbs: [summary.title, "人物设计", groupLabel],
      files: [],
      description: `还没有${groupLabel}，请使用右侧人物标签栏的加号新建人物。`
    };
  }
  const entry = workspaceIndex.characterFiles.find(
    (candidate) => candidate.characterId === character.id
  );
  if (!entry) {
    return {
      ...baseSelection,
      title: groupLabel,
      breadcrumbs: [summary.title, "人物设计", groupLabel],
      files: [],
      description: `${character.name}的人物档案索引尚未就绪。`
    };
  }
  const latestMappedChapter = latestCommittedContinuityChapter(
    workspaceIndex,
    (chapter) =>
      (chapter.characterContinuity ?? []).some(
        ({ characterId }) => characterId === character.id
      )
  );
  const legacyLocked = hasLegacyStructuredCommit(workspaceIndex);
  return {
    ...baseSelection,
    characterId: character.id,
    title: character.name,
    breadcrumbs: [
      summary.title,
      "人物设计",
      groupLabel,
      character.name
    ],
    files: characterDesignSelectionFiles(workspaceIndex, entry),
    description: latestMappedChapter
      ? "当前状态与历史轨迹映射最近一次包含该人物的章节记录；核心档案与人物关系仍是设计文件。"
      : legacyLocked
        ? "旧版结构化连续性提交仍锁定人物关系、当前状态与历史轨迹；核心档案可编辑。"
        : "尚无该人物的按章连续性记录；当前显示人物设计文件。"
  };
}

export function createLongPlotPointVolumeSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  volumeId: LongVolumeId,
  preferredPlotPointId?: LongArcId
): LongWorkspaceSelection | undefined {
  const volume = summary.navigation.volumes.find(({ id }) => id === volumeId);
  if (!volume) return undefined;
  const plotPoints = summary.navigation.arcs
    .filter((arc) => arc.volumeId === volumeId)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
  const plotPointTabs = plotPoints.map((plotPoint) => ({
    id: plotPoint.id,
    label: plotPoint.title
  }));
  const plotPoint =
    plotPoints.find(({ id }) => id === preferredPlotPointId) ??
    plotPoints[0];
  const baseSelection = {
    key: `plot-design:plot-points:${volume.id}`,
    root: "plot_design" as const,
    plotPointVolumeId: volume.id,
    plotPointTabs,
    preferredRole: "book-line" as const
  };
  if (!plotPoint) {
    return {
      ...baseSelection,
      title: volume.title,
      breadcrumbs: [summary.title, "剧情设计", "剧情点", volume.title],
      files: [],
      description: `${volume.title}还没有剧情点，请使用左侧分卷旁的加号新建。`
    };
  }
  const entry = workspaceIndex.plot.arcs.find(
    ({ id }) => id === plotPoint.id
  );
  if (!entry) return undefined;
  const storyPlots = [...(workspaceIndex.plot.storyPlots ?? [])]
    .filter((storyPlot) => storyPlot.arcId === plotPoint.id)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    )
    .map((storyPlot) => ({
      id: storyPlot.id,
      title: storyPlot.title,
      order: storyPlot.order,
      file: storyPlot.file
    }));
  return {
    ...baseSelection,
    plotPointId: plotPoint.id,
    title: plotPoint.title,
    breadcrumbs: [
      summary.title,
      "剧情设计",
      "剧情点",
      volume.title,
      plotPoint.title
    ],
    storyPlots,
    files: [
      {
        role: "book-line",
        label: "剧情点",
        file: workspaceIndex.bookLine
      },
      ...storyPlots.map((storyPlot) => ({
        role: "content" as const,
        label: storyPlot.title,
        file: storyPlot.file
      }))
    ],
    description: `${volume.title} · ${plotPoint.title}`
  };
}

export function createLongChapterCardVolumeSelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  volumeId: LongVolumeId,
  preferredChapterCardId?: LongChapterCardId
): LongWorkspaceSelection | undefined {
  const volume = summary.navigation.volumes.find(({ id }) => id === volumeId);
  if (!volume) return undefined;
  const indexedChapterIds = new Set(
    workspaceIndex.plot.chapterCards.map(({ id }) => id)
  );
  const chapterCards = summary.navigation.chapterCards
    .filter(
      (chapter) =>
        chapter.volumeId === volumeId && indexedChapterIds.has(chapter.id)
    )
    .sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    );
  const chapterCardTabs = chapterCards.map((chapter) => ({
    id: chapter.id,
    label: chapter.title
  }));
  const chapterCard =
    chapterCards.find(({ id }) => id === preferredChapterCardId) ??
    chapterCards[0];
  const baseSelection = {
    key: `plot-design:chapter-cards:${volume.id}`,
    root: "plot_design" as const,
    chapterCardVolumeId: volume.id,
    chapterCardTabs,
    preferredRole: "book-line" as const
  };
  if (!chapterCard) {
    return {
      ...baseSelection,
      title: volume.title,
      breadcrumbs: [summary.title, "剧情设计", "章卡", volume.title],
      files: [],
      description: `${volume.title}还没有章卡，请使用右侧章卡标签栏的加号新建。`
    };
  }
  const entry = workspaceIndex.chapters.find(
    (candidate) => candidate.chapterCardId === chapterCard.id
  );
  if (!entry) {
    return {
      ...baseSelection,
      chapterCardId: chapterCard.id,
      title: chapterCard.title,
      breadcrumbs: [
        summary.title,
        "剧情设计",
        "章卡",
        volume.title,
        chapterCard.title
      ],
      files: [],
      description: `${chapterCard.title}的章卡文件索引尚未就绪。`
    };
  }
  const committed = entry.commitId !== null;
  return {
    ...baseSelection,
    chapterCardId: chapterCard.id,
    title: chapterCard.title,
    breadcrumbs: [
      summary.title,
      "剧情设计",
      "章卡",
      volume.title,
      chapterCard.title
    ],
    files: [
      {
        role: "card",
        label: "章卡内容",
        file: entry.card,
        ...(committed ? { readOnly: true } : {})
      }
    ],
    preferredRole: "card",
    description: committed
      ? `${volume.title} · ${chapterCard.title}；章卡已提交并锁定。`
      : `${volume.title} · ${chapterCard.title}`
  };
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
        label: "章末状态",
        file: entry.characterState,
        readOnly: true
      },
      {
        role: "handoff",
        label: "下一章接续包",
        file: entry.handoff,
        readOnly: true
      }
    ],
    preferredRole: "body",
    description: committed
      ? "本章已提交并锁定；如需修改，请先回滚最后一次连续性提交。"
      : nextWritable === chapter.id
        ? "这是连续下一章；单章写手只写正文，章末状态和接续包将在连续性入账时生成。"
        : "本章尚未提交，但不是连续下一章；可手工编辑，自动写作需先完成前文章节。"
  };
}

/**
 * Keeps chapter authoring and continuity review as two distinct entry points.
 * A continuity chapter is a read-only group of Markdown evidence and outputs;
 * the internal commit JSON is never part of the visible selection.
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
  if (!chapter || !volume || !entry) {
    return undefined;
  }
  const committed = entry.commitId !== null;
  if (!committed && nextWritableLongChapterId(workspaceIndex) !== chapterCardId) {
    return undefined;
  }
  const characterNameById = new Map(
    summary.navigation.characters.map(({ id, name }) => [id, name] as const)
  );
  const characterContinuityFiles = [...(entry.characterContinuity ?? [])]
    .sort((left, right) =>
      (characterNameById.get(left.characterId) ?? left.characterId).localeCompare(
        characterNameById.get(right.characterId) ?? right.characterId,
        "zh-CN"
      )
    )
    .flatMap<LongWorkspaceSelectionFile>((character) => {
      const name =
        characterNameById.get(character.characterId) ?? character.characterId;
      return [
        {
          role: "current-state",
          label: `${name} · 当前状态`,
          file: character.currentState,
          readOnly: true
        },
        {
          role: "history",
          label: `${name} · 历史轨迹`,
          file: character.history,
          readOnly: true
        }
      ];
    });
  return {
    key: `continuity:${chapter.id}`,
    root: "continuity_ledger",
    continuityView: committed ? "history" : "inbox",
    chapterCardId: chapter.id,
    title: chapter.title,
    breadcrumbs: [
      summary.title,
      "连续性账本",
      volume.title,
      chapter.title
    ],
    files: [
      {
        role: "body",
        label: "正文证据",
        file: entry.body,
        readOnly: true
      },
      ...characterContinuityFiles,
      ...(entry.worldReveals
        ? [
            {
              role: "world-reveals" as const,
              label: "世界观揭露",
              file: entry.worldReveals,
              readOnly: true
            }
          ]
        : []),
      ...(entry.foreshadowingChanges
        ? [
            {
              role: "foreshadowing-changes" as const,
              label: "伏笔变化",
              file: entry.foreshadowingChanges,
              readOnly: true
            }
          ]
        : []),
      {
        role: "character-state",
        label: "章末状态",
        file: entry.characterState,
        readOnly: true
      },
      {
        role: "handoff",
        label: "接续包",
        file: entry.handoff,
        readOnly: true
      }
    ],
    preferredRole: "body",
    description: committed
      ? "按章保留正文证据、人物状态与历史、世界观揭露、伏笔变化、章末状态和接续包。"
      : "待处理章节；连续性阶段只生成并留存本章对应的 Markdown 状态文件。"
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
      breadcrumbs: [summary.title, "剧情设计", "全书故事线"],
      files: [
        {
          role: "book-line",
          label: "故事线",
          file: workspaceIndex.bookLine
        }
      ]
    };
  }
  if (selection.key === "plot-design:foreshadowing") {
    const mappedChapter = latestCommittedContinuityChapter(workspaceIndex);
    return {
      ...selection,
      title: "伏笔总览",
      breadcrumbs: [summary.title, "剧情设计", "伏笔总览"],
      files: mappedChapter
        ? [
            {
              role: "foreshadowing-changes",
              label: "最新伏笔变化",
              file: mappedChapter.foreshadowingChanges,
              readOnly: true
            }
          ]
        : [],
      preferredRole: "foreshadowing-changes",
      description: mappedChapter
        ? "只读映射最近一次已提交章节记录中的伏笔变化。"
        : "尚无已提交的按章伏笔变化记录。"
    };
  }
  if (selection.key.startsWith("plot-design:plot-points:")) {
    const volumeId = selection.key.slice(
      "plot-design:plot-points:".length
    ) as LongVolumeId;
    return createLongPlotPointVolumeSelection(
      summary,
      workspaceIndex,
      volumeId,
      selection.plotPointId
    );
  }
  if (selection.key.startsWith("plot-design:chapter-cards:")) {
    const volumeId = selection.key.slice(
      "plot-design:chapter-cards:".length
    ) as LongVolumeId;
    return createLongChapterCardVolumeSelection(
      summary,
      workspaceIndex,
      volumeId,
      selection.chapterCardId
    );
  }
  if (selection.key === "worldbuilding:reveals") {
    const mappedChapter = latestCommittedContinuityChapter(
      workspaceIndex,
      (chapter) => chapter.worldReveals !== null
    );
    return {
      ...selection,
      title: "世界观揭露",
      breadcrumbs: [summary.title, "世界观", "世界观揭露"],
      files: mappedChapter?.worldReveals
        ? [
            {
              role: "world-reveals",
              label: "世界观揭露",
              file: mappedChapter.worldReveals,
              readOnly: true
            }
          ]
        : [],
      preferredRole: "world-reveals",
      description: mappedChapter
        ? "只读映射最近一次包含世界观揭露的已提交章节记录。"
        : "尚无已提交的按章世界观揭露记录。"
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
      worldbuildingFormat: category.format,
      breadcrumbs: [summary.title, "世界观", category.title],
      ...(category.format === "list"
        ? {
            worldbuildingItems: category.items,
            files: [
              ...(category.overview
                ? [{
                    role: "overview" as const,
                    label: "概览",
                    file: category.overview,
                    ...(isLongMigrationEvidenceCategoryId(category.id)
                      ? { readOnly: true }
                      : {})
                  }]
                : []),
              ...category.items.map((item) => ({
                role: "content" as const,
                label: item.title,
                file: item.file,
                ...(isLongMigrationEvidenceCategoryId(category.id)
                  ? { readOnly: true }
                  : {})
              }))
            ]
          }
        : {
            files: [
              {
                role: "content" as const,
                label: "设定正文",
                file: category.file,
                ...(isLongMigrationEvidenceCategoryId(category.id)
                  ? { readOnly: true }
                  : {})
              }
            ]
          }),
      description: isLongMigrationEvidenceCategoryId(category.id)
        ? "这是迁移生成的只读证据，可搜索并供 Agent 按需读取。"
        : category.format === "list"
          ? "列表型世界设定；通过条目 Tab 切换并编辑内容。"
          : "文本型世界设定。"
    };
  }
  if (selection.key === "character-overview") {
    return createLongCharacterOverviewSelection(summary, workspaceIndex);
  }
  if (selection.key.startsWith("character-group:")) {
    const groupId = selection.key.slice("character-group:".length);
    const group = LONG_CHARACTER_GROUP_OPTIONS.find(
      ({ value }) => value === groupId
    );
    if (!group) return undefined;
    return createLongCharacterGroupSelection(
      summary,
      workspaceIndex,
      group.value,
      selection.characterId
    );
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
    const latestMappedChapter = latestCommittedContinuityChapter(
      workspaceIndex,
      (chapter) =>
        (chapter.characterContinuity ?? []).some(
          ({ characterId: mappedCharacterId }) =>
            mappedCharacterId === character.id
        )
    );
    const legacyLocked = hasLegacyStructuredCommit(workspaceIndex);
    const groupLabel = longCharacterGroupLabel(character.group);
    return {
      ...selection,
      title: character.name,
      breadcrumbs: [
        summary.title,
        "人物设计",
        groupLabel,
        character.name
      ],
      files: characterDesignSelectionFiles(workspaceIndex, entry),
      description: latestMappedChapter
        ? "当前状态与历史轨迹映射最近一次包含该人物的章节记录；核心档案与人物关系仍是设计文件。"
        : legacyLocked
          ? "旧版结构化连续性提交仍锁定人物关系、当前状态与历史轨迹；核心档案可编辑。"
          : "尚无该人物的按章连续性记录；当前显示人物设计文件。"
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
    const chapterSelection = createLongContinuitySelection(
      summary,
      workspaceIndex,
      commit.chapterCardId
    );
    if (!chapterSelection) return undefined;
    return {
      ...chapterSelection,
      key: selection.key,
      continuityView: "history",
      title: chapter?.title ?? `第 ${commit.sequence} 章`,
      breadcrumbs: [
        summary.title,
        "连续性账本",
        "章节记录",
        chapter?.title ?? `第 ${commit.sequence} 章`
      ],
      description: `${commit.committedAt} · 按章 Markdown 连续性记录`
    };
  }
  return selection;
}
