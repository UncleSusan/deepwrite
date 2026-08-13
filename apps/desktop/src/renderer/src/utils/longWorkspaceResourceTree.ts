import type {
  LongBookSummary,
  LongCharacterGroup,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRoot
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import {
  createLongChapterCardVolumeSelection,
  createLongChapterSelection,
  createLongContinuitySelection,
  longBookResourceId,
  reconcileLongWorkspaceSelection,
  type LongWorkspaceSelection
} from "../types/longWorkspace";

export const LONG_WORKSPACE_ROOT_LABELS = {
  worldbuilding: "世界观",
  character_design: "人物设计",
  plot_design: "剧情设计",
  draft: "正文",
  continuity_ledger: "连续性账本"
} as const;
export const LONG_WORKSPACE_ROOT_DESCRIPTIONS: Record<LongWorkspaceRoot, string> = {
  worldbuilding: "维护世界规则、势力、地理、历史、术语、境界与物品。",
  character_design: "维护人物核心档案与关系，查看最新状态和历史轨迹。",
  plot_design: "维护全书故事线、分卷、剧情点与章节卡。",
  draft: "按分卷和章卡顺序编辑正文。",
  continuity_ledger:
    "按章核验正文，并留存人物状态与历史、世界观揭露、既有伏笔触点变化、章末状态和接续包。"
};

export function longNavigationNodeId(bookId: string, key: string): string {
  return `${longBookResourceId(bookId)}:${key}`;
}

export function createLongRootSelection(
  book: LongBookSummary,
  root: LongWorkspaceRoot
): LongWorkspaceSelection {
  const label = LONG_WORKSPACE_ROOT_LABELS[root];
  return {
    key: `root:${root}`,
    root,
    title: label,
    breadcrumbs: [book.title, label],
    files: [],
    preferredRole: "content",
    description: LONG_WORKSPACE_ROOT_DESCRIPTIONS[root]
  };
}

export function projectLongWorkspaceNavigation(
  book: LongBookSummary,
  index?: LongWorkspaceIndexSnapshot | null
): ResourceTreeNode[] {
  const node = (
    selection: LongWorkspaceSelection,
    options: {
      icon: NonNullable<ResourceTreeNode["icon"]>;
      label?: string;
      badge?: string;
      children?: ResourceTreeNode[];
      longCharacterGroup?: LongCharacterGroup;
    }
  ): ResourceTreeNode => ({
    id: longNavigationNodeId(book.id, selection.key),
    label: options.label ?? selection.title,
    icon: options.icon,
    ...(options.badge ? { badge: options.badge } : {}),
    ...(options.children?.length ? { children: options.children } : {}),
    ...(options.longCharacterGroup
      ? { longCharacterGroup: options.longCharacterGroup }
      : {}),
    selectableBranch: Boolean(options.children?.length),
    workspaceType: "long",
    longBookId: book.id,
    catalogNodeType: "category",
    longWorkspaceSelection: selection
  });

  const reconcile = (
    selection: LongWorkspaceSelection
  ): LongWorkspaceSelection | undefined =>
    index
      ? reconcileLongWorkspaceSelection(book, index, selection)
      : selection;

  const characterCountByGroup = new Map<LongCharacterGroup, number>();
  for (const character of book.navigation.characters) {
    characterCountByGroup.set(
      character.group,
      (characterCountByGroup.get(character.group) ?? 0) + 1
    );
  }
  const arcCountByVolume = new Map<string, number>();
  for (const arc of book.navigation.arcs) {
    arcCountByVolume.set(
      arc.volumeId,
      (arcCountByVolume.get(arc.volumeId) ?? 0) + 1
    );
  }
  const chaptersByVolume = new Map<
    string,
    (typeof book.navigation.chapterCards)[number][]
  >();
  for (const chapter of book.navigation.chapterCards) {
    const chapters = chaptersByVolume.get(chapter.volumeId);
    if (chapters) {
      chapters.push(chapter);
    } else {
      chaptersByVolume.set(chapter.volumeId, [chapter]);
    }
  }
  for (const chapters of chaptersByVolume.values()) {
    chapters.sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    );
  }
  const sortedVolumes = [...book.navigation.volumes].sort(
    (left, right) =>
      left.order - right.order || left.id.localeCompare(right.id)
  );

  // Long book summaries already contain the lightweight navigation needed by
  // the resource tree. Render it before the book is opened, then reconcile
  // the selection against the complete index when a user selects an item.
  // This keeps the first render consistent with short/script books without
  // loading every long project's file references or document contents.
  const worldRevealSelection = reconcile({
    key: "worldbuilding:reveals",
    root: "worldbuilding",
    title: "世界观揭露",
    breadcrumbs: [book.title, "世界观", "世界观揭露"],
    files: [],
    preferredRole: "world-reveals",
    description: "映射最近一次已提交章节记录中的世界观揭露。"
  });
  const worldChildren = [
    ...[...book.navigation.worldbuilding]
      .sort((left, right) => left.order - right.order)
      .flatMap((category) => {
        const selection = reconcile({
          key: `worldbuilding:${category.id}`,
          root: "worldbuilding",
          title: category.title,
          breadcrumbs: [book.title, "世界观", category.title],
          files: [],
          preferredRole: "content",
          description:
            category.format === "list"
              ? "列表型世界设定。"
              : "文本型世界设定。"
        });
        return selection
          ? [
              node(selection, {
                icon: "file",
                badge: category.format === "list" ? "列表" : "文本"
              })
            ]
          : [];
      }),
    ...(worldRevealSelection
      ? [
          node(worldRevealSelection, {
            icon: "file",
            label: "世界观揭露"
          })
        ]
      : [])
  ];

  const characterOverviewSelection = reconcile({
    key: "character-overview",
    root: "character_design",
    title: "概览",
    breadcrumbs: [book.title, "人物设计", "概览"],
    files: [],
    preferredRole: "overview",
    description:
      "人物设计阶段概览；统计全部人物的简单信息，供智能体先读后定位。"
  });
  const characterGroupChildren = [...book.navigation.characterTypes]
    .sort((left, right) => left.order - right.order)
    .map((group) => {
    const characterCount = characterCountByGroup.get(group.id) ?? 0;
    const selection = reconcile({
      key: `character-group:${group.id}`,
      root: "character_design",
      characterGroup: group.id,
      title: group.title,
      breadcrumbs: [book.title, "人物设计", group.title],
      files: [],
      preferredRole: "core-profile",
      description: `管理${group.title}人物；使用右侧人物标签栏的加号新建人物。`
    });
    const groupSelection = selection ?? {
      key: `character-group:${group.id}`,
      root: "character_design" as const,
      title: group.title,
      breadcrumbs: [book.title, "人物设计", group.title],
      files: [],
      preferredRole: "core-profile" as const
    };
    return node(groupSelection, {
      icon: "folder",
      label: group.title,
      badge: String(characterCount),
      longCharacterGroup: group.id
    });
  });
  const characterChildren = [
    ...(characterOverviewSelection
      ? [
          node(characterOverviewSelection, {
            icon: "file",
            label: "概览"
          })
        ]
      : []),
    ...characterGroupChildren
  ];

  const bookLineSelection = reconcile({
    key: "plot-design:book-line",
    root: "plot_design",
    title: "全书故事线",
    breadcrumbs: [book.title, "剧情设计", "全书故事线"],
    files: [],
    preferredRole: "book-line",
    description: "全书级情节主线。"
  });
  const foreshadowingSelection = reconcile({
    key: "plot-design:foreshadowing",
    root: "plot_design",
    title: "伏笔总览",
    breadcrumbs: [book.title, "剧情设计", "伏笔总览"],
    files: [],
    preferredRole: "book-line",
    description:
      "集中管理伏笔线，并查看各卷、各剧情点中的伏笔触点。"
  });
  const plotPointVolumeChildren: ResourceTreeNode[] = sortedVolumes
    .map((volume) => {
      const plotPointCount = arcCountByVolume.get(volume.id) ?? 0;
      const selection = reconcile({
        key: `plot-design:plot-points:${volume.id}`,
        root: "plot_design",
        plotPointVolumeId: volume.id,
        title: volume.title,
        breadcrumbs: [
          book.title,
          "剧情设计",
          "剧情点",
          volume.title
        ],
        files: [],
        preferredRole: "book-line",
        description: `${volume.title}共有 ${plotPointCount} 个剧情点。`
      });
      const volumeSelection = selection ?? {
        key: `plot-design:plot-points:${volume.id}`,
        root: "plot_design" as const,
        plotPointVolumeId: volume.id,
        title: volume.title,
        breadcrumbs: [
          book.title,
          "剧情设计",
          "剧情点",
          volume.title
        ],
        files: [],
        preferredRole: "book-line" as const
      };
      return node(volumeSelection, {
        icon: "folder",
        label: volume.title,
        badge: `${plotPointCount} 点`
      });
    });

  const chapterCardManagementChildren: ResourceTreeNode[] =
    sortedVolumes
      .map((volume) => {
        const chapters = chaptersByVolume.get(volume.id) ?? [];
        const fallbackSelection: LongWorkspaceSelection = {
          key: `plot-design:chapter-cards:${volume.id}`,
          root: "plot_design",
          chapterCardVolumeId: volume.id,
          ...(chapters[0] ? { chapterCardId: chapters[0].id } : {}),
          chapterCardTabs: chapters.map((chapter) => ({
            id: chapter.id,
            label: chapter.title
          })),
          title: chapters[0]?.title ?? volume.title,
          breadcrumbs: [
            book.title,
            "剧情设计",
            "章卡",
            volume.title,
            ...(chapters[0] ? [chapters[0].title] : [])
          ],
          files: [],
          preferredRole: "book-line",
          description: chapters.length
            ? `${volume.title} · ${chapters[0]!.title}`
            : `${volume.title}还没有章卡，请使用右侧章卡标签栏的加号新建。`
        };
        const selection =
          (index
            ? createLongChapterCardVolumeSelection(book, index, volume.id)
            : undefined) ?? fallbackSelection;
        return node(selection, {
          icon: "folder",
          label: volume.title,
          badge: `${chapters.length} 章`
        });
      });

  const plotChildren: ResourceTreeNode[] = [
    ...(bookLineSelection
      ? [node(bookLineSelection, { icon: "file", badge: "故事线" })]
      : []),
    node(
      {
        key: "root:plot-points",
        root: "plot_design",
        title: "剧情点",
        breadcrumbs: [book.title, "剧情设计", "剧情点"],
        files: [],
        preferredRole: "book-line",
        description: "按分卷管理剧情点；一卷可以包含多个剧情点。"
      },
      {
        icon: "history",
        badge: String(book.navigation.counts.arcs),
        children: plotPointVolumeChildren
      }
    ),
    ...(foreshadowingSelection
      ? [
          node(foreshadowingSelection, {
            icon: "pin",
            badge: String(book.navigation.counts.foreshadowingThreads)
          })
        ]
      : []),
    node(
      {
        key: "root:plot-chapter-cards",
        root: "plot_design",
        title: "章卡",
        breadcrumbs: [book.title, "剧情设计", "章卡"],
        files: [],
        preferredRole: "book-line",
        description: "直接管理长篇章节卡；正文仍在“正文”中编辑。"
      },
      {
        icon: "file",
        badge: String(book.navigation.counts.chapterCards),
        children: chapterCardManagementChildren
      }
    )
  ];

  const draftChildren = sortedVolumes
    .map<ResourceTreeNode>((volume) => {
      const chapters = (chaptersByVolume.get(volume.id) ?? [])
        .flatMap<ResourceTreeNode>((chapter) => {
          const selection = index
            ? createLongChapterSelection(book, index, chapter.id)
            : {
                key: `chapter:${chapter.id}`,
                root: "draft" as const,
                chapterCardId: chapter.id,
                title: chapter.title,
                breadcrumbs: [book.title, "正文", volume.title, chapter.title],
                files: [],
                preferredRole: "body" as const
              };
          return selection ? [node(selection, { icon: "edit" })] : [];
        });
      return {
        id: longNavigationNodeId(book.id, `volume:${volume.id}`),
        label: volume.title,
        icon: "folder",
        badge: `${chapters.length} 章`,
        workspaceType: "long",
        longBookId: book.id,
        catalogNodeType: "category",
        longDraftVolumeId: volume.id,
        ...(chapters.length ? { children: chapters } : {})
      };
    });

  const continuityPendingChildren: ResourceTreeNode[] = [];
  const continuityRecordChildren: ResourceTreeNode[] = [];
  const pendingRecordChapterIds = index
    ? index.chapters
        .filter(
          ({ bodyStatus, commitId }) =>
            bodyStatus === "written" && commitId === null
        )
        .map(({ chapterCardId }) => chapterCardId)
    : [];
  if (index) {
    for (const chapterCardId of pendingRecordChapterIds) {
      const selection = createLongContinuitySelection(
        book,
        index,
        chapterCardId
      );
      if (!selection) continue;
      const chapter = book.navigation.chapterCards.find(
        ({ id }) => id === chapterCardId
      );
      continuityPendingChildren.push(
        node(selection, {
          icon: "check",
          label: chapter?.title ?? selection.title,
          badge: "待记录"
        })
      );
    }
  }
  if (index) {
    for (const commit of [...index.ledger.commits].sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id)
    )) {
      const selection = createLongContinuitySelection(
        book,
        index,
        commit.chapterCardId
      );
      if (selection) {
        const chapter = book.navigation.chapterCards.find(
          ({ id }) => id === commit.chapterCardId
        );
        continuityRecordChildren.push(
          node(selection, {
            icon: "file",
            label: chapter?.title ?? selection.title,
            badge:
              commit.mode === "import_checkpoint"
                ? "导入检查点"
                : `第 ${commit.sequence} 章`
          })
        );
      }
    }
  }
  const continuityChildren: ResourceTreeNode[] = [
    node(
      {
        key: "continuity-group:pending",
        root: "continuity_ledger",
        title: "待处理章节",
        breadcrumbs: [book.title, "连续性账本", "待处理章节"],
        files: [],
        preferredRole: "body",
        description: pendingRecordChapterIds.length
          ? "选择任意已有正文的章节，按需补充连续性记录。"
          : "当前没有等待补记连续性的章节。"
      },
      {
        icon: "check",
        badge: String(continuityPendingChildren.length),
        children: continuityPendingChildren
      }
    ),
    node(
      {
        key: "continuity-group:records",
        root: "continuity_ledger",
        title: "章节记录",
        breadcrumbs: [book.title, "连续性账本", "章节记录"],
        files: [],
        preferredRole: "body",
        description: "按章节查看已经留存的连续性 Markdown 文件。"
      },
      {
        icon: "file",
        badge: String(continuityRecordChildren.length),
        children: continuityRecordChildren
      }
    )
  ];

  const counts = book.navigation.counts;
  return [
    node(createLongRootSelection(book, "worldbuilding"), {
      icon: "globe",
      badge: String(counts.worldbuildingCategories),
      children: worldChildren
    }),
    node(createLongRootSelection(book, "character_design"), {
      icon: "user",
      badge: String(counts.characters),
      children: characterChildren
    }),
    node(createLongRootSelection(book, "plot_design"), {
      icon: "history",
      badge: String(counts.arcs + counts.volumes + counts.chapterCards),
      children: plotChildren
    }),
    node(createLongRootSelection(book, "draft"), {
      icon: "edit",
      label: "正文",
      badge: String(counts.chapterCards),
      children: draftChildren
    }),
    node(createLongRootSelection(book, "continuity_ledger"), {
      icon: "ledger",
      badge: String(counts.committedChapters),
      children: continuityChildren
    })
  ];
}
