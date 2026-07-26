import type {
  LongBookSummary,
  LongSearchHit,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  createLongChapterSelection,
  isLongMigrationEvidenceCategoryId,
  type LongWorkspaceSelection,
  type LongWorkspaceSelectionFile
} from "../types/longWorkspace";

/**
 * Resolves a search hit against the exact index snapshot that produced it.
 * Unknown files deliberately stay unselectable instead of opening a stale or
 * unrelated document.
 */
export function resolveLongSearchHitSelection(
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot,
  hit: LongSearchHit
): LongWorkspaceSelection | undefined {
  if (hit.fileId === index.bookLine.id) {
    return {
      key: "plot-design:book-line",
      root: "plot_design",
      title: "全书故事线",
      breadcrumbs: [summary.title, "情节设计", "全书故事线"],
      files: [
        {
          role: "book-line",
          label: "故事线",
          file: index.bookLine
        }
      ],
      preferredRole: "book-line",
      description: "全书级情节主线；卷、弧线和章节卡保存在结构索引中。"
    };
  }

  const category = index.worldbuilding.find(
    ({ file }) => file.id === hit.fileId
  );
  if (category) {
    return {
      key: `worldbuilding:${category.id}`,
      root: "worldbuilding",
      worldbuildingFormat: category.format,
      title: category.title,
      breadcrumbs: [summary.title, "世界观", category.title],
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
        ? "这是迁移生成的只读证据，可搜索并供智能体按需读取。"
        : category.format === "list"
          ? "列表型世界设定；通过条目标签切换并编辑内容。"
          : "文本型世界设定。"
    };
  }

  const character = index.characterFiles.find((entry) =>
    [
      entry.coreProfile.id,
      entry.relationships.id,
      entry.currentState.id,
      entry.history.id
    ].includes(hit.fileId)
  );
  if (character) {
    const navigation = summary.navigation.characters.find(
      ({ id }) => id === character.characterId
    );
    if (!navigation) return undefined;
    const continuityLocked = index.ledger.commits.length > 0;
    const files: LongWorkspaceSelectionFile[] = [
      {
        role: "core-profile",
        label: "核心档案",
        file: character.coreProfile
      },
      {
        role: "relationships",
        label: "人物关系",
        file: character.relationships,
        readOnly: continuityLocked
      },
      {
        role: "current-state",
        label: "当前状态",
        file: character.currentState,
        readOnly: continuityLocked
      },
      {
        role: "history",
        label: "历史轨迹",
        file: character.history,
        readOnly: continuityLocked
      }
    ];
    const preferredRole =
      character.relationships.id === hit.fileId
        ? "relationships"
        : character.currentState.id === hit.fileId
          ? "current-state"
          : character.history.id === hit.fileId
            ? "history"
            : "core-profile";
    return {
      key: `character:${navigation.id}`,
      root: "character_design",
      title: navigation.name,
      breadcrumbs: [summary.title, "人物设计", navigation.name],
      files,
      preferredRole,
      description: continuityLocked
        ? "人物关系、当前状态与历史轨迹已由连续性账本接管；核心档案仍可编辑。"
        : "首章连续性提交前，人物四份档案均可直接编辑。"
    };
  }

  const chapter = index.chapters.find((entry) =>
    [entry.body.id, entry.characterState.id, entry.handoff.id].includes(
      hit.fileId
    )
  );
  if (chapter) {
    const selection = createLongChapterSelection(
      summary,
      index,
      chapter.chapterCardId
    );
    if (!selection) return undefined;
    return {
      ...selection,
      preferredRole:
        chapter.characterState.id === hit.fileId
          ? "character-state"
          : chapter.handoff.id === hit.fileId
            ? "handoff"
            : "body"
    };
  }

  const commit = index.ledger.commits.find(
    ({ recordFile }) => recordFile.id === hit.fileId
  );
  if (!commit) return undefined;
  const chapterTitle = summary.navigation.chapterCards.find(
    ({ id }) => id === commit.chapterCardId
  )?.title;
  return {
    key: `ledger:${commit.id}`,
    root: "continuity_ledger",
    title: `提交 #${commit.sequence}`,
    breadcrumbs: [
      summary.title,
      "连续性账本",
      chapterTitle ?? `提交 #${commit.sequence}`
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
    description: `${commit.committedAt} · ${
      commit.reversible ? "可回滚" : "不可回滚"
    }`
  };
}
