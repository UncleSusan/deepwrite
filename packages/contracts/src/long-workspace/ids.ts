import { z } from "zod";

import { LongTimestampSchema } from "./primitives";

export const LONG_WORKSPACE_SCHEMA_VERSION = 1 as const;
export const LONG_PROJECT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LONG_WORKSPACE_INDEX_PATH = "long/index.json" as const;
export const LONG_AGENTS_MD_PATH = "AGENTS.md" as const;
export const LONG_AGENTS_MD_MAX_CHARACTERS = 10_000;

export const DEFAULT_LONG_AGENTS_MD = `# 长篇上下文

本文说明本书五个工作阶段各自负责什么。请按阶段边界协作，不要越权改写其他阶段的权威内容。

## 世界观阶段

维护世界规则、势力、地理、历史、术语、境界、物品等设定。
- 文本型分类以分类本身为正文；列表型分类再拆成概览和条目。
- 可查看全书结构与人物作对照，但不要把未读取的剧情或正文当成事实，也不要修改剧情结构和章节正文。
- 按章连续性记录只作参考，不接管或锁定世界观正文。

## 人物阶段

维护人物核心档案、人物关系、当前状态、历史轨迹，以及一份手动维护的人物概览。
- 每名人物有四份独立文档；概览用于统计人物身份、分组、别名和一句话定位。
- 可结合世界观与剧情框架检查冲突，但人物内容仍以人物文档为准。
- 按章连续性记录只作参考，不接管或锁定人物文档。

## 剧情点阶段

维护全书故事线、分卷、剧情点、故事情节、章卡、故事事件、叙事落点与伏笔。
- 剧情点是大剧情发展脉络；故事事件是具体发生的事，挂到所属剧情点。
- 世界观与人物只读，用于设计剧情或检查结构冲突。
- 可以调度正文写作，但连续性记录只供参考，不锁定剧情结构。

## 正文阶段

规划正文进度、调度连续章节，并在选中章卡时直接撰写或修改该章小说正文。
- 每张章卡对应一份独立 Markdown 正文；未锁定章卡时只规划或调度，不改其他章。
- 写作产物只限当前锁定章的小说正文，不创建章节结构，也不编写连续性文件。
- 已有连续性记录仍可参考，但不限制正文修订。

## 持续性账本阶段

按章留存人物轨迹、世界观揭露、既有伏笔触点变化、章末状态和下一章接续包。
- 以本章正文为事实证据；章末状态与接续包每章必须写入。
- 伏笔总览是设计源，账本只能核验既有伏笔线和触点，不能自行新增伏笔。
- 记录只供后续参考，不锁定正文、人物资料或剧情结构。
`;

export function longAgentsMdCharacterCount(content: string): number {
  return Array.from(content).length;
}

export const LongWorkspaceSchemaVersionSchema = z.literal(
  LONG_WORKSPACE_SCHEMA_VERSION
);
export type LongWorkspaceSchemaVersion = z.infer<
  typeof LongWorkspaceSchemaVersionSchema
>;

export const LongProjectManifestSchemaVersionSchema = z.literal(
  LONG_PROJECT_MANIFEST_SCHEMA_VERSION
);
export type LongProjectManifestSchemaVersion = z.infer<
  typeof LongProjectManifestSchemaVersionSchema
>;

/**
 * Long-form ids are opaque and stable. Display names and mutable ordering must
 * never be encoded as the identity of an entity.
 */
export const LongStableIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(
    /^[a-z][a-z0-9-]*_[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/,
    "Long-form ids must be opaque, prefixed stable ids."
  );
export type LongStableId = z.infer<typeof LongStableIdSchema>;

function stableIdWithPrefix(prefix: string) {
  return LongStableIdSchema.refine((value) => value.startsWith(`${prefix}_`), {
    message: `Expected a stable ${prefix}_ id.`
  });
}

export const LongBookIdSchema = stableIdWithPrefix("longbook");
export type LongBookId = z.infer<typeof LongBookIdSchema>;
export const LongWorldbuildingCategoryIdSchema = stableIdWithPrefix("world");
export type LongWorldbuildingCategoryId = z.infer<
  typeof LongWorldbuildingCategoryIdSchema
>;
export const LongWorldbuildingItemIdSchema = stableIdWithPrefix("worlditem");
export type LongWorldbuildingItemId = z.infer<
  typeof LongWorldbuildingItemIdSchema
>;
export const LongCharacterIdSchema = stableIdWithPrefix("character");
export type LongCharacterId = z.infer<typeof LongCharacterIdSchema>;
export const LongCustomCharacterTypeIdSchema = stableIdWithPrefix("chartype");
export type LongCustomCharacterTypeId = z.infer<
  typeof LongCustomCharacterTypeIdSchema
>;
export const LongVolumeIdSchema = stableIdWithPrefix("volume");
export type LongVolumeId = z.infer<typeof LongVolumeIdSchema>;
export const LongArcIdSchema = stableIdWithPrefix("arc");
export type LongArcId = z.infer<typeof LongArcIdSchema>;
export const LongChapterCardIdSchema = stableIdWithPrefix("chapter");
export type LongChapterCardId = z.infer<typeof LongChapterCardIdSchema>;
export const LongStoryEventIdSchema = stableIdWithPrefix("event");
export type LongStoryEventId = z.infer<typeof LongStoryEventIdSchema>;
/** Plot-point-bound story plot entries shown in the「故事情节」tab. */
export const LongStoryPlotIdSchema = stableIdWithPrefix("storyplot");
export type LongStoryPlotId = z.infer<typeof LongStoryPlotIdSchema>;
export const LongEventConnectionIdSchema = stableIdWithPrefix("connection");
export type LongEventConnectionId = z.infer<typeof LongEventConnectionIdSchema>;
export const LongNarrativePlacementIdSchema = stableIdWithPrefix("placement");
export type LongNarrativePlacementId = z.infer<
  typeof LongNarrativePlacementIdSchema
>;
export const LongForeshadowingIdSchema = stableIdWithPrefix("foreshadow");
export type LongForeshadowingId = z.infer<typeof LongForeshadowingIdSchema>;
export const LongForeshadowingBeatIdSchema = stableIdWithPrefix("beat");
export type LongForeshadowingBeatId = z.infer<
  typeof LongForeshadowingBeatIdSchema
>;
export const LongLedgerCommitIdSchema = stableIdWithPrefix("commit");
export type LongLedgerCommitId = z.infer<typeof LongLedgerCommitIdSchema>;
export const LongContinuityFactIdSchema = stableIdWithPrefix("fact");
export type LongContinuityFactId = z.infer<typeof LongContinuityFactIdSchema>;
export const LongContinuityOpenLoopIdSchema = stableIdWithPrefix("loop");
export type LongContinuityOpenLoopId = z.infer<
  typeof LongContinuityOpenLoopIdSchema
>;
export const LongFileIdSchema = stableIdWithPrefix("file");
export type LongFileId = z.infer<typeof LongFileIdSchema>;

function isSafeLongProjectPath(value: string): boolean {
  if (
    value.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(value) ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.length > 1 &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    ) &&
    (value.endsWith(".md") || value.endsWith(".json"))
  );
}

export const LongProjectRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(isSafeLongProjectPath, {
    message:
      "Long-form project paths must be safe relative Markdown or JSON paths."
  });
export type LongProjectRelativePath = z.infer<
  typeof LongProjectRelativePathSchema
>;

export const LongFileRevisionSchema = z
  .string()
  // Current revisions contain at most a safe-integer byte count and a
  // 64-character SHA-256. Bound the wire value before applying the regexp so
  // an untrusted command cannot turn this small token into an unbounded
  // allocation/scanning surface.
  .max(96)
  .regex(/^(?:v1:\d+:[0-9a-f]{8}|v2:\d+:[0-9a-f]{64})$/);
export type LongFileRevision = z.infer<typeof LongFileRevisionSchema>;

export const LongWorkspaceFileReferenceSchema = z
  .object({
    id: LongFileIdSchema,
    path: LongProjectRelativePathSchema,
    revision: LongFileRevisionSchema,
    updatedAt: LongTimestampSchema
  })
  .strict();
export type LongWorkspaceFileReference = z.infer<
  typeof LongWorkspaceFileReferenceSchema
>;

export const LongMarkdownFileReferenceSchema =
  LongWorkspaceFileReferenceSchema.refine((file) => file.path.endsWith(".md"), {
    path: ["path"],
    message: "This long-form file must use a .md path."
  });
export type LongMarkdownFileReference = z.infer<
  typeof LongMarkdownFileReferenceSchema
>;

export const LongJsonFileReferenceSchema =
  LongWorkspaceFileReferenceSchema.refine(
    (file) => file.path.endsWith(".json"),
    {
      path: ["path"],
      message: "This long-form file must use a .json path."
    }
  );
export type LongJsonFileReference = z.infer<typeof LongJsonFileReferenceSchema>;

export function longWorldbuildingFileId(categoryId: string): string {
  return `file_${categoryId}:content`;
}

export function longWorldbuildingOverviewFileId(categoryId: string): string {
  return `file_${categoryId}:overview`;
}

export function longWorldbuildingItemFileId(itemId: string): string {
  return `file_${itemId}:content`;
}

export const LONG_CHARACTER_OVERVIEW_FILE_ID =
  "file_characters:overview" as const;
export const LONG_CHARACTER_OVERVIEW_PATH =
  "long/characters/overview.md" as const;

export function longCharacterOverviewFileId(): string {
  return LONG_CHARACTER_OVERVIEW_FILE_ID;
}

export function longCharacterOverviewContentPath(): string {
  return LONG_CHARACTER_OVERVIEW_PATH;
}

export function longCharacterCoreProfileFileId(characterId: string): string {
  return `file_${characterId}:core-profile`;
}

export function longCharacterRelationshipsFileId(characterId: string): string {
  return `file_${characterId}:relationships`;
}

export function longCharacterCurrentStateFileId(characterId: string): string {
  return `file_${characterId}:current-state`;
}

export function longCharacterHistoryFileId(characterId: string): string {
  return `file_${characterId}:history`;
}

export function longStoryPlotBodyFileId(storyPlotId: string): string {
  return `file_${storyPlotId}:body`;
}

export function longChapterBodyFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:body`;
}

export function longChapterCardFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:card`;
}

export function longChapterCharacterStateFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:character-state`;
}

export function longChapterHandoffFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:handoff`;
}

export function longChapterForeshadowingChangesFileId(
  chapterCardId: string
): string {
  return `file_${chapterCardId}:continuity:foreshadowing-changes`;
}

export function longChapterWorldRevealsFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:continuity:world-reveals`;
}

export function longChapterCharacterCurrentStateFileId(
  chapterCardId: string,
  characterId: string
): string {
  return `file_${chapterCardId}:continuity:character:${characterId}:current-state`;
}

export function longChapterCharacterHistoryFileId(
  chapterCardId: string,
  characterId: string
): string {
  return `file_${chapterCardId}:continuity:character:${characterId}:history`;
}

export function longLedgerCommitFileId(commitId: string): string {
  return `file_${commitId}:ledger`;
}

export const EMPTY_LONG_MARKDOWN_REVISION =
  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as LongFileRevision;

export const LongChapterBodyStatusSchema = z.enum(["empty", "written"]);
export type LongChapterBodyStatus = z.infer<typeof LongChapterBodyStatusSchema>;

export function longWorldbuildingContentPath(categoryId: string): string {
  return `long/worldbuilding/${categoryId}/content.md`;
}

export function longWorldbuildingOverviewContentPath(
  categoryId: string
): string {
  return `long/worldbuilding/${categoryId}/overview.md`;
}

export function longWorldbuildingItemContentPath(
  categoryId: string,
  itemId: string
): string {
  return `long/worldbuilding/${categoryId}/items/${itemId}.md`;
}

export function longCharacterFilePath(
  characterId: string,
  filename:
    "core-profile.md" | "relationships.md" | "current-state.md" | "history.md"
): string {
  return `long/characters/${characterId}/${filename}`;
}

export function longChapterFilePath(
  chapterCardId: string,
  filename: "body.md" | "card.md" | "character-state.md" | "handoff.md"
): string {
  return `long/chapters/${chapterCardId}/${filename}`;
}

export function longChapterContinuityFilePath(
  chapterCardId: string,
  filename: "foreshadowing-changes.md" | "world-reveals.md"
): string {
  return `long/continuity/chapters/${chapterCardId}/${filename}`;
}

export function longChapterCharacterContinuityFilePath(
  chapterCardId: string,
  characterId: string,
  filename: "current-state.md" | "history.md"
): string {
  return `long/continuity/chapters/${chapterCardId}/characters/${characterId}/${filename}`;
}

export function longStoryPlotFilePath(
  storyPlotId: string,
  filename: "body.md" = "body.md"
): string {
  return `long/story-plots/${storyPlotId}/${filename}`;
}

export function createEmptyLongMarkdownFileReference(
  id: string,
  path: string,
  updatedAt: string
): LongMarkdownFileReference {
  return LongMarkdownFileReferenceSchema.parse({
    id,
    path,
    revision: EMPTY_LONG_MARKDOWN_REVISION,
    updatedAt
  });
}

export const LONG_BOOK_LINE_FILE_ID = "file_long-book-line" as const;
export const LONG_WORKSPACE_INDEX_FILE_ID =
  "file_long-workspace-index" as const;
