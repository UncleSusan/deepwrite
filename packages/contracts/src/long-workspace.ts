import { z } from "zod";
import {
  LinkedMaterialIdsByKindSchema,
  LinkedSkillIdsByKindSchema,
  MaterialKindSchema,
  SkillKindSchema
} from "./catalog";

export const LONG_WORKSPACE_SCHEMA_VERSION = 1 as const;
export const LONG_PROJECT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LONG_WORKSPACE_INDEX_PATH = "long/index.json" as const;

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

const LongTimestampSchema = z.string().datetime();
const LongRevisionSchema = z.number().int().nonnegative();
const LongTitleSchema = z.string().trim().min(1).max(256);
const LongTextSchema = z.string().max(200_000);
const LongShortTextSchema = z.string().max(4_000);

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
export const LongWorldbuildingCategoryIdSchema =
  stableIdWithPrefix("world");
export type LongWorldbuildingCategoryId = z.infer<
  typeof LongWorldbuildingCategoryIdSchema
>;
export const LongWorldbuildingItemIdSchema =
  stableIdWithPrefix("worlditem");
export type LongWorldbuildingItemId = z.infer<
  typeof LongWorldbuildingItemIdSchema
>;
export const LongCharacterIdSchema = stableIdWithPrefix("character");
export type LongCharacterId = z.infer<typeof LongCharacterIdSchema>;
export const LongVolumeIdSchema = stableIdWithPrefix("volume");
export type LongVolumeId = z.infer<typeof LongVolumeIdSchema>;
export const LongArcIdSchema = stableIdWithPrefix("arc");
export type LongArcId = z.infer<typeof LongArcIdSchema>;
export const LongChapterCardIdSchema = stableIdWithPrefix("chapter");
export type LongChapterCardId = z.infer<typeof LongChapterCardIdSchema>;
export const LongStoryEventIdSchema = stableIdWithPrefix("event");
export type LongStoryEventId = z.infer<typeof LongStoryEventIdSchema>;
export const LongEventConnectionIdSchema =
  stableIdWithPrefix("connection");
export type LongEventConnectionId = z.infer<
  typeof LongEventConnectionIdSchema
>;
export const LongNarrativePlacementIdSchema =
  stableIdWithPrefix("placement");
export type LongNarrativePlacementId = z.infer<
  typeof LongNarrativePlacementIdSchema
>;
export const LongForeshadowingIdSchema = stableIdWithPrefix("foreshadow");
export type LongForeshadowingId = z.infer<
  typeof LongForeshadowingIdSchema
>;
export const LongForeshadowingBeatIdSchema = stableIdWithPrefix("beat");
export type LongForeshadowingBeatId = z.infer<
  typeof LongForeshadowingBeatIdSchema
>;
export const LongLedgerCommitIdSchema = stableIdWithPrefix("commit");
export type LongLedgerCommitId = z.infer<typeof LongLedgerCommitIdSchema>;
export const LongContinuityFactIdSchema = stableIdWithPrefix("fact");
export type LongContinuityFactId = z.infer<
  typeof LongContinuityFactIdSchema
>;
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
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== ".."
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
  LongWorkspaceFileReferenceSchema.refine(
    (file) => file.path.endsWith(".md"),
    {
      path: ["path"],
      message: "This long-form file must use a .md path."
    }
  );
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
export type LongJsonFileReference = z.infer<
  typeof LongJsonFileReferenceSchema
>;

export function longWorldbuildingFileId(categoryId: string): string {
  return `file_${categoryId}:content`;
}

export function longWorldbuildingOverviewFileId(categoryId: string): string {
  return `file_${categoryId}:overview`;
}

export function longWorldbuildingItemFileId(itemId: string): string {
  return `file_${itemId}:content`;
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

export function longChapterBodyFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:body`;
}

export function longChapterCharacterStateFileId(
  chapterCardId: string
): string {
  return `file_${chapterCardId}:character-state`;
}

export function longChapterHandoffFileId(chapterCardId: string): string {
  return `file_${chapterCardId}:handoff`;
}

export function longLedgerCommitFileId(commitId: string): string {
  return `file_${commitId}:ledger`;
}

export const EMPTY_LONG_MARKDOWN_REVISION =
  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as LongFileRevision;

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
    | "core-profile.md"
    | "relationships.md"
    | "current-state.md"
    | "history.md"
): string {
  return `long/characters/${characterId}/${filename}`;
}

export function longChapterFilePath(
  chapterCardId: string,
  filename: "body.md" | "character-state.md" | "handoff.md"
): string {
  return `long/chapters/${chapterCardId}/${filename}`;
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

export const LongWorldbuildingFormatSchema = z.enum(["list", "text"]);
export type LongWorldbuildingFormat = z.infer<
  typeof LongWorldbuildingFormatSchema
>;

export const LongWorldbuildingItemSchema = z
  .object({
    id: LongWorldbuildingItemIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    file: LongMarkdownFileReferenceSchema
  })
  .strict()
  .superRefine((item, context) => {
    if (item.file.id !== longWorldbuildingItemFileId(item.id)) {
      context.addIssue({
        code: "custom",
        path: ["file", "id"],
        message:
          "Worldbuilding item file id must match its stable item id."
      });
    }
  });
export type LongWorldbuildingItem = z.infer<
  typeof LongWorldbuildingItemSchema
>;

const LongWorldbuildingCategorySharedShape = {
  id: LongWorldbuildingCategoryIdSchema,
  title: LongTitleSchema,
  order: z.number().int().positive()
};

export const LongWorldbuildingListCategorySchema = z
  .object({
    ...LongWorldbuildingCategorySharedShape,
    format: z.literal("list"),
    contentAuthority: z.literal("files"),
    /**
     * Optional only for loading pre-overview v1 projects. All newly-created
     * list categories include this file, and the project store migrates older
     * categories before exposing them.
     */
    overview: LongMarkdownFileReferenceSchema.optional(),
    items: z.array(LongWorldbuildingItemSchema).max(10_000)
  })
  .strict()
  .superRefine((category, context) => {
    if (
      category.overview &&
      category.overview.id !== longWorldbuildingOverviewFileId(category.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["overview", "id"],
        message:
          "Worldbuilding overview file id must match its stable category id."
      });
    }
    const ids = new Set<string>();
    const fileIds = new Set<string>();
    const paths = new Set<string>();
    category.items.forEach((item, index) => {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "id"],
          message: `Duplicate worldbuilding item id: ${item.id}`
        });
      }
      if (fileIds.has(item.file.id)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "file", "id"],
          message: `Duplicate worldbuilding item file id: ${item.file.id}`
        });
      }
      if (paths.has(item.file.path)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "file", "path"],
          message: `Duplicate worldbuilding item file path: ${item.file.path}`
        });
      }
      ids.add(item.id);
      fileIds.add(item.file.id);
      paths.add(item.file.path);
    });
  });
export type LongWorldbuildingListCategory = z.infer<
  typeof LongWorldbuildingListCategorySchema
>;

export const LongWorldbuildingTextCategorySchema = z
  .object({
    ...LongWorldbuildingCategorySharedShape,
    format: z.literal("text"),
    contentAuthority: z.literal("markdown"),
    file: LongMarkdownFileReferenceSchema
  })
  .strict()
  .superRefine((category, context) => {
    if (category.file.id !== longWorldbuildingFileId(category.id)) {
      context.addIssue({
        code: "custom",
        path: ["file", "id"],
        message:
          "Worldbuilding text file id must match its stable category id."
      });
    }
  });
export type LongWorldbuildingTextCategory = z.infer<
  typeof LongWorldbuildingTextCategorySchema
>;

export const LongWorldbuildingCategorySchema = z.discriminatedUnion("format", [
  LongWorldbuildingListCategorySchema,
  LongWorldbuildingTextCategorySchema
]);
export type LongWorldbuildingCategory = z.infer<
  typeof LongWorldbuildingCategorySchema
>;

export const LONG_CHARACTER_GROUPS = [
  "protagonist",
  "major_supporting",
  "minor_supporting",
  "passerby"
] as const;
export const LongCharacterGroupSchema = z.enum(LONG_CHARACTER_GROUPS);
export type LongCharacterGroup = z.infer<typeof LongCharacterGroupSchema>;

const UniqueAliasListSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(64)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate character alias: ${value}`
        });
      }
      seen.add(value);
    });
  });

export const LongCharacterSchema = z
  .object({
    id: LongCharacterIdSchema,
    name: LongTitleSchema,
    group: LongCharacterGroupSchema,
    order: z.number().int().positive(),
    aliases: UniqueAliasListSchema
  })
  .strict();
export type LongCharacter = z.infer<typeof LongCharacterSchema>;

export const LongCharacterFileIndexEntrySchema = z
  .object({
    characterId: LongCharacterIdSchema,
    coreProfile: LongMarkdownFileReferenceSchema,
    relationships: LongMarkdownFileReferenceSchema,
    currentState: LongMarkdownFileReferenceSchema,
    history: LongMarkdownFileReferenceSchema
  })
  .strict()
  .superRefine((entry, context) => {
    const expectedIds = [
      longCharacterCoreProfileFileId(entry.characterId),
      longCharacterRelationshipsFileId(entry.characterId),
      longCharacterCurrentStateFileId(entry.characterId),
      longCharacterHistoryFileId(entry.characterId)
    ];
    const files = [
      entry.coreProfile,
      entry.relationships,
      entry.currentState,
      entry.history
    ];
    const fields = [
      "coreProfile",
      "relationships",
      "currentState",
      "history"
    ] as const;
    files.forEach((file, index) => {
      if (file.id !== expectedIds[index]) {
        context.addIssue({
          code: "custom",
          path: [fields[index]!, "id"],
          message:
            "Character file id must match its stable character id and role."
        });
      }
    });
  });
export type LongCharacterFileIndexEntry = z.infer<
  typeof LongCharacterFileIndexEntrySchema
>;

export const LongVolumeSchema = z
  .object({
    id: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    summary: LongTextSchema
  })
  .strict();
export type LongVolume = z.infer<typeof LongVolumeSchema>;

export const LongArcSchema = z
  .object({
    id: LongArcIdSchema,
    volumeId: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    summary: LongTextSchema.optional(),
    outline: LongTextSchema
  })
  .strict();
export type LongArc = z.infer<typeof LongArcSchema>;

const UniqueCharacterReferenceListSchema = z
  .array(LongCharacterIdSchema)
  .max(1_024)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate character reference: ${value}`
        });
      }
      seen.add(value);
    });
  });

const UniqueArcReferenceListSchema = z
  .array(LongArcIdSchema)
  .max(1_024)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate arc reference: ${value}`
        });
      }
      seen.add(value);
    });
  });

export const LongChapterCardSchema = z
  .object({
    id: LongChapterCardIdSchema,
    volumeId: LongVolumeIdSchema,
    primaryArcId: LongArcIdSchema,
    title: LongTitleSchema,
    narrativeOrder: z.number().int().positive(),
    outline: LongTextSchema,
    worldConstraints: LongTextSchema,
    characterIds: UniqueCharacterReferenceListSchema
  })
  .strict();
export type LongChapterCard = z.infer<typeof LongChapterCardSchema>;

export const LongStoryTimeModeSchema = z.enum([
  "exact",
  "relative",
  "sequence",
  "unknown"
]);
export type LongStoryTimeMode = z.infer<typeof LongStoryTimeModeSchema>;

export const LongStoryEventSchema = z
  .object({
    id: LongStoryEventIdSchema,
    title: LongTitleSchema,
    summary: LongTextSchema,
    timeMode: LongStoryTimeModeSchema,
    timeLabel: z.string().max(1_000),
    /** Machine-sortable or source-specific time value kept separate from its display label. */
    timeValue: z.string().max(1_000).optional(),
    storyOrder: z.number().int().positive(),
    location: z.string().max(1_000),
    arcIds: UniqueArcReferenceListSchema,
    characterIds: UniqueCharacterReferenceListSchema
  })
  .strict();
export type LongStoryEvent = z.infer<typeof LongStoryEventSchema>;

export const LONG_EVENT_CONNECTION_TYPES = [
  "before",
  "same_time",
  "overlaps",
  "causes",
  "enables",
  "conceals"
] as const;
export const LongEventConnectionTypeSchema = z.enum(
  LONG_EVENT_CONNECTION_TYPES
);
export type LongEventConnectionType = z.infer<
  typeof LongEventConnectionTypeSchema
>;

export const LongEventConnectionSchema = z
  .object({
    id: LongEventConnectionIdSchema,
    sourceEventId: LongStoryEventIdSchema,
    targetEventId: LongStoryEventIdSchema,
    type: LongEventConnectionTypeSchema,
    note: LongShortTextSchema
  })
  .strict()
  .superRefine((connection, context) => {
    if (connection.sourceEventId === connection.targetEventId) {
      context.addIssue({
        code: "custom",
        path: ["targetEventId"],
        message: "Event connections cannot reference the same event twice."
      });
    }
  });
export type LongEventConnection = z.infer<
  typeof LongEventConnectionSchema
>;

export const LONG_NARRATIVE_MODES = [
  "scene",
  "flashback",
  "retelling",
  "clue",
  "misdirection",
  "reveal",
  "dream",
  "prophecy"
] as const;
export const LongNarrativeModeSchema = z.enum(LONG_NARRATIVE_MODES);
export type LongNarrativeMode = z.infer<typeof LongNarrativeModeSchema>;

export const LongDisclosureLevelSchema = z.enum([
  "hint",
  "partial",
  "full",
  "false"
]);
export type LongDisclosureLevel = z.infer<
  typeof LongDisclosureLevelSchema
>;

export const LongExecutionStatusSchema = z.enum([
  "planned",
  "written",
  "committed",
  "missed"
]);
export type LongExecutionStatus = z.infer<
  typeof LongExecutionStatusSchema
>;

function validateExecutionCommit(
  value: { status: LongExecutionStatus; commitId: string | null },
  context: z.core.$RefinementCtx<unknown>
): void {
  const finalized =
    value.status === "committed" || value.status === "missed";
  if (finalized !== (value.commitId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["commitId"],
      message:
        "Only committed or missed execution records may reference a ledger commit."
    });
  }
}

export const LongNarrativePlacementSchema = z
  .object({
    id: LongNarrativePlacementIdSchema,
    eventId: LongStoryEventIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    orderInChapter: z.number().int().positive(),
    mode: LongNarrativeModeSchema,
    disclosure: LongDisclosureLevelSchema,
    writingPrompt: LongShortTextSchema,
    status: LongExecutionStatusSchema,
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict()
  .superRefine(validateExecutionCommit);
export type LongNarrativePlacement = z.infer<
  typeof LongNarrativePlacementSchema
>;

export const LONG_FORESHADOWING_BEAT_TYPES = [
  "source",
  "plant",
  "reinforce",
  "misdirect",
  "partial_reveal",
  "reveal",
  "payoff",
  "aftermath"
] as const;
export const LongForeshadowingBeatTypeSchema = z.enum(
  LONG_FORESHADOWING_BEAT_TYPES
);
export type LongForeshadowingBeatType = z.infer<
  typeof LongForeshadowingBeatTypeSchema
>;

export const LONG_FORESHADOWING_SPANS = [
  "local",
  "within_volume",
  "cross_volume"
] as const;
export const LongForeshadowingSpanSchema = z.enum(
  LONG_FORESHADOWING_SPANS
);
export type LongForeshadowingSpan = z.infer<
  typeof LongForeshadowingSpanSchema
>;

export const LongForeshadowingBeatSchema = z
  .object({
    id: LongForeshadowingBeatIdSchema,
    type: LongForeshadowingBeatTypeSchema,
    order: z.number().int().positive(),
    /**
     * Planning anchors are intentionally independent from chapter execution
     * anchors. A beat may first be assigned only to a volume, then refined to
     * a plot point before its concrete event/chapter placement is known.
     */
    volumeId: LongVolumeIdSchema.nullable().optional(),
    arcId: LongArcIdSchema.nullable().optional(),
    eventId: LongStoryEventIdSchema.nullable(),
    placementId: LongNarrativePlacementIdSchema.nullable(),
    chapterCardId: LongChapterCardIdSchema.nullable(),
    plannedScope: z.string().max(1_000),
    note: LongShortTextSchema,
    status: LongExecutionStatusSchema,
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict()
  .superRefine((beat, context) => {
    validateExecutionCommit(beat, context);
    if (
      beat.commitId !== null &&
      beat.chapterCardId === null &&
      beat.placementId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["chapterCardId"],
        message:
          "A finalized foreshadowing beat must resolve to a concrete chapter."
      });
    }
    if (
      beat.eventId === null &&
      beat.placementId === null &&
      beat.chapterCardId === null &&
      (beat.volumeId ?? null) === null &&
      (beat.arcId ?? null) === null &&
      beat.plannedScope.trim().length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["plannedScope"],
        message:
          "A foreshadowing beat must reference a planning/execution anchor or a planned scope."
      });
    }
  });
export type LongForeshadowingBeat = z.infer<
  typeof LongForeshadowingBeatSchema
>;

export const LongForeshadowingStatusSchema = z.enum([
  "planned",
  "open",
  "progressing",
  "resolved",
  "abandoned"
]);
export type LongForeshadowingStatus = z.infer<
  typeof LongForeshadowingStatusSchema
>;

export function deriveLongForeshadowingStatusFromCommittedBeats(
  beats: ReadonlyArray<
    Pick<LongForeshadowingBeat, "status" | "type">
  >
): Exclude<LongForeshadowingStatus, "abandoned"> {
  const committedTypes = new Set(
    beats
      .filter(({ status }) => status === "committed")
      .map(({ type }) => type)
  );
  if (committedTypes.has("reveal") || committedTypes.has("payoff")) {
    return "resolved";
  }
  if (
    committedTypes.has("reinforce") ||
    committedTypes.has("misdirect") ||
    committedTypes.has("partial_reveal")
  ) {
    return "progressing";
  }
  if (committedTypes.has("plant")) return "open";
  return "planned";
}

export const LongForeshadowingSchema = z
  .object({
    id: LongForeshadowingIdSchema,
    title: LongTitleSchema,
    coreQuestion: LongTextSchema,
    hiddenTruth: LongTextSchema.optional(),
    plannedSpan: LongForeshadowingSpanSchema.optional(),
    truthEventId: LongStoryEventIdSchema.nullable(),
    expectedReaderEffect: LongTextSchema,
    status: LongForeshadowingStatusSchema,
    beats: z.array(LongForeshadowingBeatSchema).max(10_000)
  })
  .strict();
export type LongForeshadowing = z.infer<
  typeof LongForeshadowingSchema
>;

export const LongPlotIndexSchema = z
  .object({
    volumes: z.array(LongVolumeSchema).min(1).max(10_000),
    arcs: z.array(LongArcSchema).max(100_000),
    chapterCards: z.array(LongChapterCardSchema).max(100_000),
    storyEvents: z.array(LongStoryEventSchema).max(200_000),
    eventConnections: z
      .array(LongEventConnectionSchema)
      .max(400_000),
    narrativePlacements: z
      .array(LongNarrativePlacementSchema)
      .max(400_000),
    foreshadowing: z.array(LongForeshadowingSchema).max(100_000)
  })
  .strict();
export type LongPlotIndex = z.infer<typeof LongPlotIndexSchema>;

export const LongChapterFileIndexEntrySchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    body: LongMarkdownFileReferenceSchema,
    characterState: LongMarkdownFileReferenceSchema,
    handoff: LongMarkdownFileReferenceSchema,
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict()
  .superRefine((entry, context) => {
    const files = [entry.body, entry.characterState, entry.handoff];
    const expectedIds = [
      longChapterBodyFileId(entry.chapterCardId),
      longChapterCharacterStateFileId(entry.chapterCardId),
      longChapterHandoffFileId(entry.chapterCardId)
    ];
    const fields = ["body", "characterState", "handoff"] as const;
    files.forEach((file, index) => {
      if (file.id !== expectedIds[index]) {
        context.addIssue({
          code: "custom",
          path: [fields[index]!, "id"],
          message:
            "Chapter file id must match its stable chapter-card id and role."
        });
      }
    });
  });
export type LongChapterFileIndexEntry = z.infer<
  typeof LongChapterFileIndexEntrySchema
>;

const UniquePlacementIdListSchema = z
  .array(LongNarrativePlacementIdSchema)
  .max(100_000)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate placement decision: ${value}`
        });
      }
      seen.add(value);
    });
  });

const UniqueForeshadowingBeatIdListSchema = z
  .array(LongForeshadowingBeatIdSchema)
  .max(100_000)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate foreshadowing-beat decision: ${value}`
        });
      }
      seen.add(value);
    });
  });

export const LONG_CONTINUITY_DOMAINS = [
  "character",
  "relationship",
  "world",
  "plot",
  "foreshadowing"
] as const;
export const LongContinuityDomainSchema = z.enum(
  LONG_CONTINUITY_DOMAINS
);
export type LongContinuityDomain = z.infer<
  typeof LongContinuityDomainSchema
>;

export const LongContinuityFactFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\r\n\0]/u.test(value), {
    message: "Continuity fact fields must use one safe line."
  });
export type LongContinuityFactField = z.infer<
  typeof LongContinuityFactFieldSchema
>;

const LongContinuityEvidenceSchema = z.string().trim().min(1).max(4_000);
const LongContinuityFactValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(200_000);

export const LongContinuityFactSchema = z
  .object({
    factId: LongContinuityFactIdSchema,
    domain: LongContinuityDomainSchema,
    subjectId: LongStableIdSchema,
    field: LongContinuityFactFieldSchema,
    value: LongContinuityFactValueSchema,
    sourceCommitId: LongLedgerCommitIdSchema,
    sourceChapterCardId: LongChapterCardIdSchema,
    evidence: LongContinuityEvidenceSchema
  })
  .strict();
export type LongContinuityFact = z.infer<
  typeof LongContinuityFactSchema
>;

function continuityFactKey(
  value: Pick<LongContinuityFact, "domain" | "subjectId" | "field">
): string {
  return `${value.domain}\0${value.subjectId}\0${value.field.normalize("NFC")}`;
}

export const LongContinuityFactListSchema = z
  .array(LongContinuityFactSchema)
  .max(200_000)
  .superRefine((facts, context) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    facts.forEach((fact, index) => {
      if (ids.has(fact.factId)) {
        context.addIssue({
          code: "custom",
          path: [index, "factId"],
          message: `Duplicate continuity fact id: ${fact.factId}`
        });
      }
      ids.add(fact.factId);
      const key = continuityFactKey(fact);
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index, "field"],
          message:
            "Continuity facts must be unique by domain, subject id and field."
        });
      }
      keys.add(key);
    });
  });

export const LONG_CONTINUITY_AUDIENCE_TYPES = [
  "reader",
  "character",
  "faction"
] as const;
export const LongContinuityAudienceTypeSchema = z.enum(
  LONG_CONTINUITY_AUDIENCE_TYPES
);
export type LongContinuityAudienceType = z.infer<
  typeof LongContinuityAudienceTypeSchema
>;

export const LONG_CONTINUITY_KNOWLEDGE_LEVELS = [
  "unknown",
  "suspects",
  "believes",
  "knows",
  "misled"
] as const;
export const LongContinuityKnowledgeLevelSchema = z.enum(
  LONG_CONTINUITY_KNOWLEDGE_LEVELS
);
export type LongContinuityKnowledgeLevel = z.infer<
  typeof LongContinuityKnowledgeLevelSchema
>;

export const LongContinuityKnowledgeSchema = z
  .object({
    factId: LongContinuityFactIdSchema,
    audienceType: LongContinuityAudienceTypeSchema,
    audienceId: LongStableIdSchema.nullable(),
    level: LongContinuityKnowledgeLevelSchema,
    sourceCommitId: LongLedgerCommitIdSchema,
    sourceChapterCardId: LongChapterCardIdSchema,
    evidence: LongContinuityEvidenceSchema
  })
  .strict()
  .superRefine((knowledge, context) => {
    if (
      (knowledge.audienceType === "reader") !==
      (knowledge.audienceId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["audienceId"],
        message:
          "Reader knowledge must use a null audience id; character and faction knowledge require one."
      });
    }
    if (
      knowledge.audienceType === "character" &&
      !knowledge.audienceId?.startsWith("character_")
    ) {
      context.addIssue({
        code: "custom",
        path: ["audienceId"],
        message: "Character knowledge requires a stable character id."
      });
    }
  });
export type LongContinuityKnowledge = z.infer<
  typeof LongContinuityKnowledgeSchema
>;

function continuityKnowledgeKey(
  value: Pick<
    LongContinuityKnowledge,
    "factId" | "audienceType" | "audienceId"
  >
): string {
  return `${value.factId}\0${value.audienceType}\0${value.audienceId ?? ""}`;
}

export const LongContinuityKnowledgeListSchema = z
  .array(LongContinuityKnowledgeSchema)
  .max(400_000)
  .superRefine((entries, context) => {
    const keys = new Set<string>();
    entries.forEach((entry, index) => {
      const key = continuityKnowledgeKey(entry);
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message:
            "Continuity knowledge must be unique by fact and audience."
        });
      }
      keys.add(key);
    });
  });

export const LONG_CONTINUITY_OPEN_LOOP_KINDS = [
  "character",
  "relationship",
  "world",
  "plot",
  "foreshadowing",
  "knowledge",
  "continuity"
] as const;
export const LongContinuityOpenLoopKindSchema = z.enum(
  LONG_CONTINUITY_OPEN_LOOP_KINDS
);
export type LongContinuityOpenLoopKind = z.infer<
  typeof LongContinuityOpenLoopKindSchema
>;

export const LONG_CONTINUITY_OPEN_LOOP_STATUSES = [
  "open",
  "progressing",
  "resolved",
  "abandoned"
] as const;
export const LongContinuityOpenLoopStatusSchema = z.enum(
  LONG_CONTINUITY_OPEN_LOOP_STATUSES
);
export type LongContinuityOpenLoopStatus = z.infer<
  typeof LongContinuityOpenLoopStatusSchema
>;

export const LongContinuityOpenLoopSchema = z
  .object({
    loopId: LongContinuityOpenLoopIdSchema,
    kind: LongContinuityOpenLoopKindSchema,
    status: LongContinuityOpenLoopStatusSchema,
    detail: z.string().trim().min(1).max(200_000),
    subjectId: LongStableIdSchema.nullable(),
    factId: LongContinuityFactIdSchema.nullable(),
    sourceCommitId: LongLedgerCommitIdSchema,
    sourceChapterCardId: LongChapterCardIdSchema,
    evidence: LongContinuityEvidenceSchema
  })
  .strict();
export type LongContinuityOpenLoop = z.infer<
  typeof LongContinuityOpenLoopSchema
>;

export const LongContinuityOpenLoopListSchema = z
  .array(LongContinuityOpenLoopSchema)
  .max(200_000)
  .superRefine((loops, context) => {
    const ids = new Set<string>();
    loops.forEach((loop, index) => {
      if (ids.has(loop.loopId)) {
        context.addIssue({
          code: "custom",
          path: [index, "loopId"],
          message: `Duplicate continuity open-loop id: ${loop.loopId}`
        });
      }
      ids.add(loop.loopId);
    });
  });

const UniqueContinuityTextListSchema = z
  .array(z.string().trim().min(1).max(4_000))
  .max(1_024)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const key = value.normalize("NFC");
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Continuity handoff lists cannot contain duplicates."
        });
      }
      seen.add(key);
    });
  });

const UniqueContinuityOpenLoopIdListSchema = z
  .array(LongContinuityOpenLoopIdSchema)
  .max(100_000)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate continuity open-loop reference: ${value}`
        });
      }
      seen.add(value);
    });
  });

export const LongContinuityHandoffSchema = z
  .object({
    summary: z.string().trim().min(1).max(200_000),
    mustCarry: UniqueContinuityTextListSchema,
    nextChapterConstraints: UniqueContinuityTextListSchema,
    openLoops: UniqueContinuityOpenLoopIdListSchema
  })
  .strict();
export type LongContinuityHandoff = z.infer<
  typeof LongContinuityHandoffSchema
>;

export const LongContinuityLatestHandoffSchema =
  LongContinuityHandoffSchema.extend({
    chapterCardId: LongChapterCardIdSchema,
    commitId: LongLedgerCommitIdSchema
  });
export type LongContinuityLatestHandoff = z.infer<
  typeof LongContinuityLatestHandoffSchema
>;

export const LongContinuityProjectionSchema = z
  .object({
    throughCommitId: LongLedgerCommitIdSchema.nullable(),
    facts: LongContinuityFactListSchema,
    knowledge: LongContinuityKnowledgeListSchema,
    openLoops: LongContinuityOpenLoopListSchema,
    latestHandoff: LongContinuityLatestHandoffSchema.nullable()
  })
  .strict()
  .superRefine((projection, context) => {
    const factIds = new Set(projection.facts.map(({ factId }) => factId));
    projection.knowledge.forEach((knowledge, index) => {
      if (!factIds.has(knowledge.factId)) {
        context.addIssue({
          code: "custom",
          path: ["knowledge", index, "factId"],
          message: "Continuity knowledge must reference a projected fact."
        });
      }
    });
    const loopIds = new Set(projection.openLoops.map(({ loopId }) => loopId));
    projection.latestHandoff?.openLoops.forEach((loopId, index) => {
      if (!loopIds.has(loopId)) {
        context.addIssue({
          code: "custom",
          path: ["latestHandoff", "openLoops", index],
          message:
            "The latest continuity handoff must reference a projected open loop."
        });
      }
    });
    if (
      projection.latestHandoff &&
      projection.latestHandoff.commitId !== projection.throughCommitId
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestHandoff", "commitId"],
        message:
          "The latest handoff commit must match the projection watermark."
      });
    }
  });
export type LongContinuityProjection = z.infer<
  typeof LongContinuityProjectionSchema
>;

export const EMPTY_LONG_CONTINUITY_PROJECTION: LongContinuityProjection = {
  throughCommitId: null,
  facts: [],
  knowledge: [],
  openLoops: [],
  latestHandoff: null
};

export const LongLedgerCommitIndexEntrySchema = z
  .object({
    id: LongLedgerCommitIdSchema,
    sequence: z.number().int().positive(),
    chapterCardId: LongChapterCardIdSchema,
    committedAt: LongTimestampSchema,
    reversible: z.boolean(),
    sourceRevision: LongRevisionSchema,
    placementIds: UniquePlacementIdListSchema,
    foreshadowingBeatIds: UniqueForeshadowingBeatIdListSchema,
    recordFile: LongJsonFileReferenceSchema
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.recordFile.id !== longLedgerCommitFileId(entry.id)) {
      context.addIssue({
        code: "custom",
        path: ["recordFile", "id"],
        message: "Ledger record file id must match its stable commit id."
      });
    }
  });
export type LongLedgerCommitIndexEntry = z.infer<
  typeof LongLedgerCommitIndexEntrySchema
>;

export const LongLedgerCommitIndexSchema = z
  .object({
    committedThroughChapterId: LongChapterCardIdSchema.nullable(),
    commits: z.array(LongLedgerCommitIndexEntrySchema).max(100_000),
    projection: LongContinuityProjectionSchema.default(
      EMPTY_LONG_CONTINUITY_PROJECTION
    )
  })
  .strict();
export type LongLedgerCommitIndex = z.infer<
  typeof LongLedgerCommitIndexSchema
>;

const LongWorkspaceIndexSnapshotObjectSchema = z
  .object({
    schemaVersion: LongWorkspaceSchemaVersionSchema,
    revision: LongRevisionSchema,
    bookId: LongBookIdSchema,
    updatedAt: LongTimestampSchema,
    bookLine: LongMarkdownFileReferenceSchema,
    worldbuilding: z
      .array(LongWorldbuildingCategorySchema)
      .max(10_000),
    characters: z.array(LongCharacterSchema).max(100_000),
    characterFiles: z
      .array(LongCharacterFileIndexEntrySchema)
      .max(100_000),
    plot: LongPlotIndexSchema,
    chapters: z
      .array(LongChapterFileIndexEntrySchema)
      .max(100_000),
    ledger: LongLedgerCommitIndexSchema
  })
  .strict();

type LongWorkspaceIndexSnapshotInput = z.infer<
  typeof LongWorkspaceIndexSnapshotObjectSchema
>;

type ValidationPath = Array<string | number>;

function addIssue(
  context: z.core.$RefinementCtx<unknown>,
  path: ValidationPath,
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function validateUniqueValues(
  values: readonly string[],
  pathForIndex: (index: number) => ValidationPath,
  label: string,
  context: z.core.$RefinementCtx<unknown>
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      addIssue(
        context,
        pathForIndex(index),
        `Duplicate ${label}: ${value}`
      );
    }
    seen.add(value);
  });
}

function validateContiguousOrder(
  entries: ReadonlyArray<{ index: number; order: number }>,
  pathForIndex: (index: number) => ValidationPath,
  label: string,
  context: z.core.$RefinementCtx<unknown>
): void {
  const sorted = [...entries].sort((left, right) => left.order - right.order);
  sorted.forEach((entry, index) => {
    if (entry.order !== index + 1) {
      addIssue(
        context,
        pathForIndex(entry.index),
        `${label} order must be unique and contiguous from 1.`
      );
    }
  });
}

function groupOrderedEntries<T>(
  values: readonly T[],
  groupFor: (value: T) => string,
  orderFor: (value: T) => number
): Map<string, Array<{ index: number; order: number }>> {
  const groups = new Map<
    string,
    Array<{ index: number; order: number }>
  >();
  values.forEach((value, index) => {
    const group = groupFor(value);
    const entries = groups.get(group) ?? [];
    entries.push({ index, order: orderFor(value) });
    groups.set(group, entries);
  });
  return groups;
}

function hasBeforeCycle(
  eventIds: readonly string[],
  connections: LongEventConnection[]
): boolean {
  const adjacency = new Map<string, string[]>(
    eventIds.map((eventId) => [eventId, []])
  );
  const indegree = new Map<string, number>(
    eventIds.map((eventId) => [eventId, 0])
  );
  for (const connection of connections) {
    if (connection.type !== "before") continue;
    if (
      !adjacency.has(connection.sourceEventId) ||
      !indegree.has(connection.targetEventId)
    ) {
      continue;
    }
    adjacency.get(connection.sourceEventId)!.push(connection.targetEventId);
    indegree.set(
      connection.targetEventId,
      indegree.get(connection.targetEventId)! + 1
    );
  }
  const ready = eventIds.filter((eventId) => indegree.get(eventId) === 0);
  let head = 0;
  let visited = 0;
  while (head < ready.length) {
    const eventId = ready[head++]!;
    visited += 1;
    for (const target of adjacency.get(eventId) ?? []) {
      const next = indegree.get(target)! - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  return visited !== eventIds.length;
}

function validateLongWorkspaceIndexSnapshot(
  snapshot: LongWorkspaceIndexSnapshotInput,
  context: z.core.$RefinementCtx<unknown>
): void {
  if (snapshot.bookLine.id !== LONG_BOOK_LINE_FILE_ID) {
    addIssue(
      context,
      ["bookLine", "id"],
      `Book-line file id must be ${LONG_BOOK_LINE_FILE_ID}.`
    );
  }

  validateUniqueValues(
    snapshot.worldbuilding.map(({ id }) => id),
    (index) => ["worldbuilding", index, "id"],
    "worldbuilding category id",
    context
  );
  validateContiguousOrder(
    snapshot.worldbuilding.map(({ order }, index) => ({ index, order })),
    (index) => ["worldbuilding", index, "order"],
    "Worldbuilding category",
    context
  );
  const worldbuildingIds = new Set(
    snapshot.worldbuilding.map(({ id }) => id)
  );
  validateUniqueValues(
    snapshot.worldbuilding.flatMap((category) =>
      category.format === "list"
        ? category.items.map(({ id }) => id)
        : []
    ),
    (index) => ["worldbuilding", index, "items"],
    "worldbuilding item id",
    context
  );
  snapshot.worldbuilding.forEach((category, categoryIndex) => {
    if (category.format !== "list") return;
    validateContiguousOrder(
      category.items.map(({ order }, index) => ({ index, order })),
      (index) => ["worldbuilding", categoryIndex, "items", index, "order"],
      "Worldbuilding item",
      context
    );
  });

  validateUniqueValues(
    snapshot.characters.map(({ id }) => id),
    (index) => ["characters", index, "id"],
    "character id",
    context
  );
  for (const [group, entries] of groupOrderedEntries(
    snapshot.characters,
    ({ group }) => group,
    ({ order }) => order
  )) {
    validateContiguousOrder(
      entries,
      (index) => ["characters", index, "order"],
      `Character group ${group}`,
      context
    );
  }

  const characterIds = new Set(
    snapshot.characters.map(({ id }) => id)
  );
  validateUniqueValues(
    snapshot.characterFiles.map(({ characterId }) => characterId),
    (index) => ["characterFiles", index, "characterId"],
    "character file index",
    context
  );
  snapshot.characterFiles.forEach((entry, index) => {
    if (!characterIds.has(entry.characterId)) {
      addIssue(
        context,
        ["characterFiles", index, "characterId"],
        "Character file index must reference an existing character."
      );
    }
  });
  const characterFileIds = new Set(
    snapshot.characterFiles.map(({ characterId }) => characterId)
  );
  for (const characterId of characterIds) {
    if (!characterFileIds.has(characterId)) {
      addIssue(
        context,
        ["characterFiles"],
        `Missing file index for character ${characterId}.`
      );
    }
  }

  const {
    volumes,
    arcs,
    chapterCards,
    storyEvents,
    eventConnections,
    narrativePlacements,
    foreshadowing
  } = snapshot.plot;

  validateUniqueValues(
    volumes.map(({ id }) => id),
    (index) => ["plot", "volumes", index, "id"],
    "volume id",
    context
  );
  validateContiguousOrder(
    volumes.map(({ order }, index) => ({ index, order })),
    (index) => ["plot", "volumes", index, "order"],
    "Volume",
    context
  );
  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));

  validateUniqueValues(
    arcs.map(({ id }) => id),
    (index) => ["plot", "arcs", index, "id"],
    "arc id",
    context
  );
  arcs.forEach((arc, index) => {
    if (!volumeById.has(arc.volumeId)) {
      addIssue(
        context,
        ["plot", "arcs", index, "volumeId"],
        "Arc must reference an existing volume."
      );
    }
  });
  for (const [volumeId, entries] of groupOrderedEntries(
    arcs,
    ({ volumeId }) => volumeId,
    ({ order }) => order
  )) {
    validateContiguousOrder(
      entries,
      (index) => ["plot", "arcs", index, "order"],
      `Arc group ${volumeId}`,
      context
    );
  }
  const arcById = new Map(arcs.map((arc) => [arc.id, arc]));

  validateUniqueValues(
    chapterCards.map(({ id }) => id),
    (index) => ["plot", "chapterCards", index, "id"],
    "chapter-card id",
    context
  );
  chapterCards.forEach((card, index) => {
    const volume = volumeById.get(card.volumeId);
    const arc = arcById.get(card.primaryArcId);
    if (!volume) {
      addIssue(
        context,
        ["plot", "chapterCards", index, "volumeId"],
        "Chapter card must reference an existing volume."
      );
    }
    if (!arc) {
      addIssue(
        context,
        ["plot", "chapterCards", index, "primaryArcId"],
        "Chapter card must reference an existing primary arc."
      );
    } else if (arc.volumeId !== card.volumeId) {
      addIssue(
        context,
        ["plot", "chapterCards", index, "primaryArcId"],
        "Chapter card and primary arc must belong to the same volume."
      );
    }
    card.characterIds.forEach((characterId, characterIndex) => {
      if (!characterIds.has(characterId)) {
        addIssue(
          context,
          [
            "plot",
            "chapterCards",
            index,
            "characterIds",
            characterIndex
          ],
          "Chapter card must reference an existing character."
        );
      }
    });
  });
  for (const [volumeId, entries] of groupOrderedEntries(
    chapterCards,
    ({ volumeId }) => volumeId,
    ({ narrativeOrder }) => narrativeOrder
  )) {
    validateContiguousOrder(
      entries,
      (index) => [
        "plot",
        "chapterCards",
        index,
        "narrativeOrder"
      ],
      `Chapter narrative order in ${volumeId}`,
      context
    );
  }
  const chapterById = new Map(
    chapterCards.map((chapter) => [chapter.id, chapter])
  );

  validateUniqueValues(
    storyEvents.map(({ id }) => id),
    (index) => ["plot", "storyEvents", index, "id"],
    "story-event id",
    context
  );
  validateContiguousOrder(
    storyEvents.map(({ storyOrder }, index) => ({
      index,
      order: storyOrder
    })),
    (index) => ["plot", "storyEvents", index, "storyOrder"],
    "Story event",
    context
  );
  const eventById = new Map(storyEvents.map((event) => [event.id, event]));
  storyEvents.forEach((event, index) => {
    event.arcIds.forEach((arcId, arcIndex) => {
      if (!arcById.has(arcId)) {
        addIssue(
          context,
          ["plot", "storyEvents", index, "arcIds", arcIndex],
          "Story event must reference an existing arc."
        );
      }
    });
    event.characterIds.forEach((characterId, characterIndex) => {
      if (!characterIds.has(characterId)) {
        addIssue(
          context,
          [
            "plot",
            "storyEvents",
            index,
            "characterIds",
            characterIndex
          ],
          "Story event must reference an existing character."
        );
      }
    });
  });

  validateUniqueValues(
    eventConnections.map(({ id }) => id),
    (index) => ["plot", "eventConnections", index, "id"],
    "event-connection id",
    context
  );
  validateUniqueValues(
    eventConnections.map(
      ({ sourceEventId, targetEventId, type }) =>
        `${sourceEventId}\0${targetEventId}\0${type}`
    ),
    (index) => ["plot", "eventConnections", index],
    "event connection",
    context
  );
  eventConnections.forEach((connection, index) => {
    if (!eventById.has(connection.sourceEventId)) {
      addIssue(
        context,
        ["plot", "eventConnections", index, "sourceEventId"],
        "Event connection source must reference an existing event."
      );
    }
    if (!eventById.has(connection.targetEventId)) {
      addIssue(
        context,
        ["plot", "eventConnections", index, "targetEventId"],
        "Event connection target must reference an existing event."
      );
    }
  });
  if (
    hasBeforeCycle(
      storyEvents.map(({ id }) => id),
      eventConnections
    )
  ) {
    addIssue(
      context,
      ["plot", "eventConnections"],
      "Before-event connections cannot form a cycle."
    );
  }

  validateUniqueValues(
    narrativePlacements.map(({ id }) => id),
    (index) => ["plot", "narrativePlacements", index, "id"],
    "narrative-placement id",
    context
  );
  narrativePlacements.forEach((placement, index) => {
    if (!eventById.has(placement.eventId)) {
      addIssue(
        context,
        ["plot", "narrativePlacements", index, "eventId"],
        "Narrative placement must reference an existing event."
      );
    }
    if (!chapterById.has(placement.chapterCardId)) {
      addIssue(
        context,
        ["plot", "narrativePlacements", index, "chapterCardId"],
        "Narrative placement must reference an existing chapter card."
      );
    }
  });
  for (const [chapterCardId, entries] of groupOrderedEntries(
    narrativePlacements,
    ({ chapterCardId }) => chapterCardId,
    ({ orderInChapter }) => orderInChapter
  )) {
    validateContiguousOrder(
      entries,
      (index) => [
        "plot",
        "narrativePlacements",
        index,
        "orderInChapter"
      ],
      `Narrative placement order in ${chapterCardId}`,
      context
    );
  }
  const placementById = new Map(
    narrativePlacements.map((placement) => [placement.id, placement])
  );

  validateUniqueValues(
    foreshadowing.map(({ id }) => id),
    (index) => ["plot", "foreshadowing", index, "id"],
    "foreshadowing id",
    context
  );
  const beatById = new Map<
    string,
    { beat: LongForeshadowingBeat; threadIndex: number; beatIndex: number }
  >();
  foreshadowing.forEach((thread, threadIndex) => {
    if (thread.status !== "abandoned") {
      const derivedStatus =
        deriveLongForeshadowingStatusFromCommittedBeats(thread.beats);
      if (thread.status !== derivedStatus) {
        addIssue(
          context,
          ["plot", "foreshadowing", threadIndex, "status"],
          `Foreshadowing status must be ${derivedStatus}, derived from its committed beats, unless it is explicitly abandoned.`
        );
      }
    }
    if (
      thread.truthEventId !== null &&
      !eventById.has(thread.truthEventId)
    ) {
      addIssue(
        context,
        ["plot", "foreshadowing", threadIndex, "truthEventId"],
        "Foreshadowing truth must reference an existing event."
      );
    }
    validateContiguousOrder(
      thread.beats.map(({ order }, beatIndex) => ({
        index: beatIndex,
        order
      })),
      (beatIndex) => [
        "plot",
        "foreshadowing",
        threadIndex,
        "beats",
        beatIndex,
        "order"
      ],
      `Foreshadowing beats in ${thread.id}`,
      context
    );
    thread.beats.forEach((beat, beatIndex) => {
      if (beatById.has(beat.id)) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "id"
          ],
          `Duplicate foreshadowing-beat id: ${beat.id}`
        );
      } else {
        beatById.set(beat.id, { beat, threadIndex, beatIndex });
      }
      const plannedVolumeId = beat.volumeId ?? null;
      const plannedArcId = beat.arcId ?? null;
      const plannedVolume =
        plannedVolumeId === null
          ? undefined
          : volumeById.get(plannedVolumeId);
      const plannedArc =
        plannedArcId === null ? undefined : arcById.get(plannedArcId);
      if (plannedVolumeId !== null && !plannedVolume) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "volumeId"
          ],
          "Foreshadowing beat must reference an existing planning volume."
        );
      }
      if (plannedArcId !== null && !plannedArc) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "arcId"
          ],
          "Foreshadowing beat must reference an existing planning arc."
        );
      }
      if (
        plannedVolume &&
        plannedArc &&
        plannedArc.volumeId !== plannedVolume.id
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "arcId"
          ],
          "Foreshadowing beat planning arc must belong to its planning volume."
        );
      }
      if (beat.eventId !== null && !eventById.has(beat.eventId)) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "eventId"
          ],
          "Foreshadowing beat must reference an existing event."
        );
      }
      const placement =
        beat.placementId === null
          ? undefined
          : placementById.get(beat.placementId);
      if (beat.placementId !== null && !placement) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "placementId"
          ],
          "Foreshadowing beat must reference an existing placement."
        );
      }
      if (
        beat.chapterCardId !== null &&
        !chapterById.has(beat.chapterCardId)
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "chapterCardId"
          ],
          "Foreshadowing beat must reference an existing chapter card."
        );
      }
      const anchoredChapter =
        beat.chapterCardId !== null
          ? chapterById.get(beat.chapterCardId)
          : placement
            ? chapterById.get(placement.chapterCardId)
            : undefined;
      if (
        plannedVolume &&
        anchoredChapter &&
        anchoredChapter.volumeId !== plannedVolume.id
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "volumeId"
          ],
          "Foreshadowing beat planning volume must match its concrete chapter."
        );
      }
      if (
        plannedArc &&
        anchoredChapter &&
        anchoredChapter.primaryArcId !== plannedArc.id
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "arcId"
          ],
          "Foreshadowing beat planning arc must match its concrete chapter."
        );
      }
      const anchoredEvent =
        beat.eventId === null ? undefined : eventById.get(beat.eventId);
      if (
        plannedVolume &&
        anchoredEvent &&
        !anchoredEvent.arcIds.some(
          (arcId) => arcById.get(arcId)?.volumeId === plannedVolume.id
        )
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "volumeId"
          ],
          "Foreshadowing beat planning volume must match its concrete event."
        );
      }
      if (
        plannedArc &&
        anchoredEvent &&
        !anchoredEvent.arcIds.includes(plannedArc.id)
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "arcId"
          ],
          "Foreshadowing beat planning arc must match its concrete event."
        );
      }
      if (
        placement &&
        beat.eventId !== null &&
        placement.eventId !== beat.eventId
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "eventId"
          ],
          "Foreshadowing beat event must match its placement event."
        );
      }
      if (placement && beat.status === "committed") {
        if (placement.status !== "committed") {
          addIssue(
            context,
            [
              "plot",
              "foreshadowing",
              threadIndex,
              "beats",
              beatIndex,
              "placementId"
            ],
            "A committed foreshadowing beat requires its bound placement to be committed."
          );
        }
        if (beat.eventId !== placement.eventId) {
          addIssue(
            context,
            [
              "plot",
              "foreshadowing",
              threadIndex,
              "beats",
              beatIndex,
              "eventId"
            ],
            "A committed foreshadowing beat must carry the same event as its bound placement."
          );
        }
        if (beat.commitId !== placement.commitId) {
          addIssue(
            context,
            [
              "plot",
              "foreshadowing",
              threadIndex,
              "beats",
              beatIndex,
              "commitId"
            ],
            "A committed foreshadowing beat and its bound placement must share one ledger commit."
          );
        }
      }
      if (
        placement &&
        beat.chapterCardId !== null &&
        placement.chapterCardId !== beat.chapterCardId
      ) {
        addIssue(
          context,
          [
            "plot",
            "foreshadowing",
            threadIndex,
            "beats",
            beatIndex,
            "chapterCardId"
          ],
          "Foreshadowing beat chapter must match its placement chapter."
        );
      }
    });
  });

  validateUniqueValues(
    snapshot.chapters.map(({ chapterCardId }) => chapterCardId),
    (index) => ["chapters", index, "chapterCardId"],
    "chapter file index",
    context
  );
  const chapterFilesById = new Map(
    snapshot.chapters.map((chapter) => [
      chapter.chapterCardId,
      chapter
    ])
  );
  snapshot.chapters.forEach((chapter, index) => {
    if (!chapterById.has(chapter.chapterCardId)) {
      addIssue(
        context,
        ["chapters", index, "chapterCardId"],
        "Chapter file index must reference an existing chapter card."
      );
    }
  });
  for (const chapterCard of chapterCards) {
    if (!chapterFilesById.has(chapterCard.id)) {
      addIssue(
        context,
        ["chapters"],
        `Missing three-file index for chapter ${chapterCard.id}.`
      );
    }
  }

  const allFiles: Array<{
    file: LongWorkspaceFileReference;
    path: ValidationPath;
  }> = [
    { file: snapshot.bookLine, path: ["bookLine"] },
    ...snapshot.worldbuilding.flatMap((category, index) =>
      category.format === "text"
        ? [{
            file: category.file,
            path: ["worldbuilding", index, "file"] as ValidationPath
          }]
        : [
            ...(category.overview
              ? [{
                  file: category.overview,
                  path: [
                    "worldbuilding",
                    index,
                    "overview"
                  ] as ValidationPath
                }]
              : []),
            ...category.items.map((item, itemIndex) => ({
              file: item.file,
              path: [
                "worldbuilding",
                index,
                "items",
                itemIndex,
                "file"
              ] as ValidationPath
            }))
          ]
    ),
    ...snapshot.characterFiles.flatMap((entry, index) =>
      [
        ["coreProfile", entry.coreProfile],
        ["relationships", entry.relationships],
        ["currentState", entry.currentState],
        ["history", entry.history]
      ].map(([field, file]) => ({
        file: file as LongWorkspaceFileReference,
        path: ["characterFiles", index, field as string] as ValidationPath
      }))
    ),
    ...snapshot.chapters.flatMap((entry, index) =>
      [
        ["body", entry.body],
        ["characterState", entry.characterState],
        ["handoff", entry.handoff]
      ].map(([field, file]) => ({
        file: file as LongWorkspaceFileReference,
        path: ["chapters", index, field as string] as ValidationPath
      }))
    ),
    ...snapshot.ledger.commits.map((entry, index) => ({
      file: entry.recordFile,
      path: ["ledger", "commits", index, "recordFile"] as ValidationPath
    }))
  ];
  validateUniqueValues(
    allFiles.map(({ file }) => file.id),
    (index) => [...allFiles[index]!.path, "id"],
    "long-form file id",
    context
  );
  validateUniqueValues(
    allFiles.map(({ file }) =>
      file.path.normalize("NFC").toLocaleLowerCase("en-US")
    ),
    (index) => [...allFiles[index]!.path, "path"],
    "portable long-form file path",
    context
  );

  const commits = snapshot.ledger.commits;
  validateUniqueValues(
    commits.map(({ id }) => id),
    (index) => ["ledger", "commits", index, "id"],
    "ledger commit id",
    context
  );
  validateUniqueValues(
    commits.map(({ chapterCardId }) => chapterCardId),
    (index) => ["ledger", "commits", index, "chapterCardId"],
    "committed chapter",
    context
  );
  commits.forEach((commit, index) => {
    if (commit.sequence !== index + 1) {
      addIssue(
        context,
        ["ledger", "commits", index, "sequence"],
        "Ledger commit sequence must be contiguous and stored in order."
      );
    }
    if (!chapterById.has(commit.chapterCardId)) {
      addIssue(
        context,
        ["ledger", "commits", index, "chapterCardId"],
        "Ledger commit must reference an existing chapter card."
      );
    }
  });
  const commitById = new Map(commits.map((commit) => [commit.id, commit]));
  const placementIdsByCommitId = new Map(
    commits.map((commit) => [commit.id, new Set(commit.placementIds)])
  );
  const beatIdsByCommitId = new Map(
    commits.map((commit) => [
      commit.id,
      new Set(commit.foreshadowingBeatIds)
    ])
  );
  const commitByChapterId = new Map(
    commits.map((commit) => [commit.chapterCardId, commit])
  );

  const orderedChapters = [...chapterCards].sort((left, right) => {
    const leftVolumeOrder =
      volumeById.get(left.volumeId)?.order ?? Number.MAX_SAFE_INTEGER;
    const rightVolumeOrder =
      volumeById.get(right.volumeId)?.order ?? Number.MAX_SAFE_INTEGER;
    return (
      leftVolumeOrder - rightVolumeOrder ||
      left.narrativeOrder - right.narrativeOrder
    );
  });
  commits.forEach((commit, index) => {
    if (orderedChapters[index]?.id !== commit.chapterCardId) {
      addIssue(
        context,
        ["ledger", "commits", index, "chapterCardId"],
        "Ledger commits must cover one contiguous narrative prefix."
      );
    }
  });

  orderedChapters.forEach((chapter, index) => {
    const expectedCommitId = commits[index]?.id ?? null;
    const fileIndex = chapterFilesById.get(chapter.id);
    if (fileIndex && fileIndex.commitId !== expectedCommitId) {
      const fileIndexPosition = snapshot.chapters.findIndex(
        ({ chapterCardId }) => chapterCardId === chapter.id
      );
      addIssue(
        context,
        ["chapters", fileIndexPosition, "commitId"],
        "Chapter commit id must match its position in the committed prefix."
      );
    }
  });

  const expectedCommittedThrough =
    commits.length === 0 ? null : commits[commits.length - 1]!.chapterCardId;
  if (
    snapshot.ledger.committedThroughChapterId !==
    expectedCommittedThrough
  ) {
    addIssue(
      context,
      ["ledger", "committedThroughChapterId"],
      "Committed-through chapter must match the last committed prefix entry."
    );
  }

  commits.forEach((commit, commitIndex) => {
    commit.placementIds.forEach((placementId, placementIndex) => {
      const placement = placementById.get(placementId);
      if (!placement) {
        addIssue(
          context,
          [
            "ledger",
            "commits",
            commitIndex,
            "placementIds",
            placementIndex
          ],
          "Ledger placement decision must reference an existing placement."
        );
      } else {
        if (placement.chapterCardId !== commit.chapterCardId) {
          addIssue(
            context,
            [
              "ledger",
              "commits",
              commitIndex,
              "placementIds",
              placementIndex
            ],
            "Ledger placement decision must belong to the committed chapter."
          );
        }
        if (placement.commitId !== commit.id) {
          addIssue(
            context,
            [
              "ledger",
              "commits",
              commitIndex,
              "placementIds",
              placementIndex
            ],
            "Ledger placement decision must carry the same commit id."
          );
        }
      }
    });
    commit.foreshadowingBeatIds.forEach((beatId, beatIndex) => {
      const beatRecord = beatById.get(beatId);
      if (!beatRecord) {
        addIssue(
          context,
          [
            "ledger",
            "commits",
            commitIndex,
            "foreshadowingBeatIds",
            beatIndex
          ],
          "Ledger beat decision must reference an existing beat."
        );
      } else {
        const { beat } = beatRecord;
        const beatPlacement =
          beat.placementId === null
            ? undefined
            : placementById.get(beat.placementId);
        const resolvedChapterId =
          beat.chapterCardId ?? beatPlacement?.chapterCardId;
        if (resolvedChapterId !== commit.chapterCardId) {
          addIssue(
            context,
            [
              "ledger",
              "commits",
              commitIndex,
              "foreshadowingBeatIds",
              beatIndex
            ],
            "Ledger beat decision must resolve to and belong to the committed chapter."
          );
        }
        if (beat.commitId !== commit.id) {
          addIssue(
            context,
            [
              "ledger",
              "commits",
              commitIndex,
              "foreshadowingBeatIds",
              beatIndex
            ],
            "Ledger beat decision must carry the same commit id."
          );
        }
      }
    });
  });

  narrativePlacements.forEach((placement, index) => {
    const chapterCommit = commitByChapterId.get(placement.chapterCardId);
    if (chapterCommit && placement.commitId !== chapterCommit.id) {
      addIssue(
        context,
        ["plot", "narrativePlacements", index, "commitId"],
        "Every placement in a committed chapter must be decided by that chapter commit."
      );
    }
    if (!chapterCommit && placement.commitId !== null) {
      addIssue(
        context,
        ["plot", "narrativePlacements", index, "commitId"],
        "A placement in an uncommitted chapter cannot reference a ledger commit."
      );
    }
    if (placement.commitId === null) return;
    const commit = commitById.get(placement.commitId);
    if (!commit) {
      addIssue(
        context,
        ["plot", "narrativePlacements", index, "commitId"],
        "Placement commit id must reference an indexed ledger commit."
      );
    } else if (!placementIdsByCommitId.get(commit.id)!.has(placement.id)) {
      addIssue(
        context,
        ["plot", "narrativePlacements", index, "commitId"],
        "Committed placement must be indexed by its ledger commit."
      );
    }
  });
  for (const { beat, threadIndex, beatIndex } of beatById.values()) {
    const beatPlacement =
      beat.placementId === null
        ? undefined
        : placementById.get(beat.placementId);
    const resolvedChapterId =
      beat.chapterCardId ?? beatPlacement?.chapterCardId;
    const chapterCommit =
      resolvedChapterId === undefined || resolvedChapterId === null
        ? undefined
        : commitByChapterId.get(resolvedChapterId);
    if (chapterCommit && beat.commitId !== chapterCommit.id) {
      addIssue(
        context,
        [
          "plot",
          "foreshadowing",
          threadIndex,
          "beats",
          beatIndex,
          "commitId"
        ],
        "Every foreshadowing beat in a committed chapter must be decided by that chapter commit."
      );
    }
    if (!chapterCommit && beat.commitId !== null) {
      addIssue(
        context,
        [
          "plot",
          "foreshadowing",
          threadIndex,
          "beats",
          beatIndex,
          "commitId"
        ],
        "A foreshadowing beat without a committed chapter cannot reference a ledger commit."
      );
    }
    if (beat.commitId === null) continue;
    const commit = commitById.get(beat.commitId);
    if (!commit) {
      addIssue(
        context,
        [
          "plot",
          "foreshadowing",
          threadIndex,
          "beats",
          beatIndex,
          "commitId"
        ],
        "Foreshadowing beat commit id must reference an indexed ledger commit."
      );
    } else if (!beatIdsByCommitId.get(commit.id)!.has(beat.id)) {
      addIssue(
        context,
        [
          "plot",
          "foreshadowing",
          threadIndex,
          "beats",
          beatIndex,
          "commitId"
        ],
        "Committed foreshadowing beat must be indexed by its ledger commit."
      );
    }
  }

  const projection = snapshot.ledger.projection;
  const throughCommit =
    projection.throughCommitId === null
      ? undefined
      : commitById.get(projection.throughCommitId);
  if (projection.throughCommitId !== null && !throughCommit) {
    addIssue(
      context,
      ["ledger", "projection", "throughCommitId"],
      "Continuity projection watermark must reference an indexed ledger commit."
    );
  }
  if (
    projection.latestHandoff &&
    commitById.get(projection.latestHandoff.commitId)?.chapterCardId !==
      projection.latestHandoff.chapterCardId
  ) {
    addIssue(
      context,
      ["ledger", "projection", "latestHandoff", "chapterCardId"],
      "The latest continuity handoff chapter must match its source commit."
    );
  }

  const plotSubjectIds = new Set<string>([
    snapshot.bookId,
    ...volumes.map(({ id }) => id),
    ...arcs.map(({ id }) => id),
    ...chapterCards.map(({ id }) => id),
    ...storyEvents.map(({ id }) => id),
    ...eventConnections.map(({ id }) => id),
    ...narrativePlacements.map(({ id }) => id)
  ]);
  const foreshadowingSubjectIds = new Set<string>([
    ...foreshadowing.map(({ id }) => id),
    ...beatById.keys()
  ]);
  const projectionSubjectExists = (
    domain: LongContinuityDomain,
    subjectId: string
  ): boolean => {
    if (domain === "character" || domain === "relationship") {
      return characterIds.has(subjectId);
    }
    if (domain === "world") return worldbuildingIds.has(subjectId);
    if (domain === "plot") return plotSubjectIds.has(subjectId);
    return foreshadowingSubjectIds.has(subjectId);
  };
  const validateProjectionProvenance = (
    value: {
      sourceCommitId: string;
      sourceChapterCardId: string;
    },
    path: ValidationPath
  ): void => {
    const sourceCommit = commitById.get(value.sourceCommitId);
    if (!sourceCommit) {
      addIssue(
        context,
        [...path, "sourceCommitId"],
        "Continuity projection entries must reference an indexed source commit."
      );
      return;
    }
    if (sourceCommit.chapterCardId !== value.sourceChapterCardId) {
      addIssue(
        context,
        [...path, "sourceChapterCardId"],
        "Continuity projection entry chapter must match its source commit."
      );
    }
    if (throughCommit && sourceCommit.sequence > throughCommit.sequence) {
      addIssue(
        context,
        [...path, "sourceCommitId"],
        "Continuity projection entries cannot come from after the projection watermark."
      );
    }
  };
  projection.facts.forEach((fact, index) => {
    const path = ["ledger", "projection", "facts", index] as ValidationPath;
    validateProjectionProvenance(fact, path);
    if (!projectionSubjectExists(fact.domain, fact.subjectId)) {
      addIssue(
        context,
        [...path, "subjectId"],
        "Continuity facts must reference an existing object in their domain."
      );
    }
  });
  projection.knowledge.forEach((knowledge, index) => {
    const path = [
      "ledger",
      "projection",
      "knowledge",
      index
    ] as ValidationPath;
    validateProjectionProvenance(knowledge, path);
    if (
      knowledge.audienceType === "character" &&
      knowledge.audienceId !== null &&
      !characterIds.has(knowledge.audienceId)
    ) {
      addIssue(
        context,
        [...path, "audienceId"],
        "Character knowledge must reference an existing character."
      );
    }
  });
  projection.openLoops.forEach((loop, index) => {
    const path = [
      "ledger",
      "projection",
      "openLoops",
      index
    ] as ValidationPath;
    validateProjectionProvenance(loop, path);
    if (
      loop.subjectId !== null &&
      loop.kind !== "knowledge" &&
      loop.kind !== "continuity" &&
      !projectionSubjectExists(loop.kind, loop.subjectId)
    ) {
      addIssue(
        context,
        [...path, "subjectId"],
        "Continuity open-loop subjects must reference an existing object in their domain."
      );
    }
  });
}

export const LongWorkspaceIndexSnapshotSchema =
  LongWorkspaceIndexSnapshotObjectSchema.superRefine(
    validateLongWorkspaceIndexSnapshot
  );
export type LongWorkspaceIndexSnapshot = z.infer<
  typeof LongWorkspaceIndexSnapshotSchema
>;

export const LongWorkspaceNavigationCountsSchema = z
  .object({
    worldbuildingCategories: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    volumes: z.number().int().nonnegative(),
    arcs: z.number().int().nonnegative(),
    chapterCards: z.number().int().nonnegative(),
    storyEvents: z.number().int().nonnegative(),
    foreshadowingThreads: z.number().int().nonnegative(),
    committedChapters: z.number().int().nonnegative()
  })
  .strict();
export type LongWorkspaceNavigationCounts = z.infer<
  typeof LongWorkspaceNavigationCountsSchema
>;

const LongWorldbuildingNavigationEntrySchema = z
  .object({
    id: LongWorldbuildingCategoryIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    format: LongWorldbuildingFormatSchema
  })
  .strict();
const LongCharacterNavigationEntrySchema = z
  .object({
    id: LongCharacterIdSchema,
    name: LongTitleSchema,
    group: LongCharacterGroupSchema,
    order: z.number().int().positive()
  })
  .strict();
const LongVolumeNavigationEntrySchema = z
  .object({
    id: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
const LongArcNavigationEntrySchema = z
  .object({
    id: LongArcIdSchema,
    volumeId: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive()
  })
  .strict();
const LongChapterCardNavigationEntrySchema = z
  .object({
    id: LongChapterCardIdSchema,
    volumeId: LongVolumeIdSchema,
    primaryArcId: LongArcIdSchema,
    title: LongTitleSchema,
    narrativeOrder: z.number().int().positive()
  })
  .strict();

/**
 * Lightweight catalog/navigation projection. It intentionally excludes file
 * references, chapter bodies, long outlines, event details and ledger records.
 */
export const LongWorkspaceNavigationSnapshotSchema = z
  .object({
    schemaVersion: LongWorkspaceSchemaVersionSchema,
    revision: LongRevisionSchema,
    bookId: LongBookIdSchema,
    updatedAt: LongTimestampSchema,
    counts: LongWorkspaceNavigationCountsSchema,
    worldbuilding: z
      .array(LongWorldbuildingNavigationEntrySchema)
      .max(10_000),
    characters: z.array(LongCharacterNavigationEntrySchema).max(100_000),
    volumes: z.array(LongVolumeNavigationEntrySchema).min(1).max(10_000),
    arcs: z.array(LongArcNavigationEntrySchema).max(100_000),
    chapterCards: z
      .array(LongChapterCardNavigationEntrySchema)
      .max(100_000),
    committedThroughChapterId: LongChapterCardIdSchema.nullable()
  })
  .strict()
  .superRefine((snapshot, context) => {
    const expectedCounts = {
      worldbuildingCategories: snapshot.worldbuilding.length,
      characters: snapshot.characters.length,
      volumes: snapshot.volumes.length,
      arcs: snapshot.arcs.length,
      chapterCards: snapshot.chapterCards.length
    };
    for (const [key, expected] of Object.entries(expectedCounts)) {
      if (
        snapshot.counts[
          key as keyof typeof expectedCounts
        ] !== expected
      ) {
        context.addIssue({
          code: "custom",
          path: ["counts", key],
          message: `Navigation count ${key} must match its index entries.`
        });
      }
    }
    if (
      snapshot.counts.committedChapters > snapshot.counts.chapterCards
    ) {
      context.addIssue({
        code: "custom",
        path: ["counts", "committedChapters"],
        message: "Committed chapter count cannot exceed chapter count."
      });
    }
    if (
      (snapshot.counts.committedChapters === 0) !==
      (snapshot.committedThroughChapterId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["committedThroughChapterId"],
        message:
          "Committed-through navigation state must match the committed count."
      });
    }

    validateUniqueValues(
      snapshot.worldbuilding.map(({ id }) => id),
      (index) => ["worldbuilding", index, "id"],
      "navigation worldbuilding id",
      context
    );
    validateContiguousOrder(
      snapshot.worldbuilding.map(({ order }, index) => ({ index, order })),
      (index) => ["worldbuilding", index, "order"],
      "Navigation worldbuilding",
      context
    );

    validateUniqueValues(
      snapshot.characters.map(({ id }) => id),
      (index) => ["characters", index, "id"],
      "navigation character id",
      context
    );
    for (const [group, entries] of groupOrderedEntries(
      snapshot.characters,
      ({ group }) => group,
      ({ order }) => order
    )) {
      validateContiguousOrder(
        entries,
        (index) => ["characters", index, "order"],
        `Navigation character group ${group}`,
        context
      );
    }

    validateUniqueValues(
      snapshot.volumes.map(({ id }) => id),
      (index) => ["volumes", index, "id"],
      "navigation volume id",
      context
    );
    validateContiguousOrder(
      snapshot.volumes.map(({ order }, index) => ({ index, order })),
      (index) => ["volumes", index, "order"],
      "Navigation volume",
      context
    );
    const volumeById = new Map(
      snapshot.volumes.map((volume) => [volume.id, volume])
    );

    validateUniqueValues(
      snapshot.arcs.map(({ id }) => id),
      (index) => ["arcs", index, "id"],
      "navigation arc id",
      context
    );
    snapshot.arcs.forEach((arc, index) => {
      if (!volumeById.has(arc.volumeId)) {
        addIssue(
          context,
          ["arcs", index, "volumeId"],
          "Navigation arc must reference an existing volume."
        );
      }
    });
    for (const [volumeId, entries] of groupOrderedEntries(
      snapshot.arcs,
      ({ volumeId }) => volumeId,
      ({ order }) => order
    )) {
      validateContiguousOrder(
        entries,
        (index) => ["arcs", index, "order"],
        `Navigation arcs in ${volumeId}`,
        context
      );
    }
    const arcById = new Map(snapshot.arcs.map((arc) => [arc.id, arc]));

    validateUniqueValues(
      snapshot.chapterCards.map(({ id }) => id),
      (index) => ["chapterCards", index, "id"],
      "navigation chapter-card id",
      context
    );
    snapshot.chapterCards.forEach((chapter, index) => {
      const arc = arcById.get(chapter.primaryArcId);
      if (!volumeById.has(chapter.volumeId)) {
        addIssue(
          context,
          ["chapterCards", index, "volumeId"],
          "Navigation chapter must reference an existing volume."
        );
      }
      if (!arc) {
        addIssue(
          context,
          ["chapterCards", index, "primaryArcId"],
          "Navigation chapter must reference an existing primary arc."
        );
      } else if (arc.volumeId !== chapter.volumeId) {
        addIssue(
          context,
          ["chapterCards", index, "primaryArcId"],
          "Navigation chapter and primary arc must share a volume."
        );
      }
    });
    for (const [volumeId, entries] of groupOrderedEntries(
      snapshot.chapterCards,
      ({ volumeId }) => volumeId,
      ({ narrativeOrder }) => narrativeOrder
    )) {
      validateContiguousOrder(
        entries,
        (index) => ["chapterCards", index, "narrativeOrder"],
        `Navigation chapter order in ${volumeId}`,
        context
      );
    }

    const orderedChapters = [...snapshot.chapterCards].sort(
      (left, right) => {
        const leftVolumeOrder =
          volumeById.get(left.volumeId)?.order ?? Number.MAX_SAFE_INTEGER;
        const rightVolumeOrder =
          volumeById.get(right.volumeId)?.order ?? Number.MAX_SAFE_INTEGER;
        return (
          leftVolumeOrder - rightVolumeOrder ||
          left.narrativeOrder - right.narrativeOrder
        );
      }
    );
    const expectedCommittedThrough =
      snapshot.counts.committedChapters === 0
        ? null
        : orderedChapters[snapshot.counts.committedChapters - 1]?.id ??
          null;
    if (
      snapshot.committedThroughChapterId !== expectedCommittedThrough
    ) {
      context.addIssue({
        code: "custom",
        path: ["committedThroughChapterId"],
        message:
          "Navigation committed-through id must end the committed narrative prefix."
      });
    }
  });
export type LongWorkspaceNavigationSnapshot = z.infer<
  typeof LongWorkspaceNavigationSnapshotSchema
>;

export function createLongWorkspaceNavigationSnapshot(
  workspace: LongWorkspaceIndexSnapshot
): LongWorkspaceNavigationSnapshot {
  return LongWorkspaceNavigationSnapshotSchema.parse({
    schemaVersion: workspace.schemaVersion,
    revision: workspace.revision,
    bookId: workspace.bookId,
    updatedAt: workspace.updatedAt,
    counts: {
      worldbuildingCategories: workspace.worldbuilding.length,
      characters: workspace.characters.length,
      volumes: workspace.plot.volumes.length,
      arcs: workspace.plot.arcs.length,
      chapterCards: workspace.plot.chapterCards.length,
      storyEvents: workspace.plot.storyEvents.length,
      foreshadowingThreads: workspace.plot.foreshadowing.length,
      committedChapters: workspace.ledger.commits.length
    },
    worldbuilding: workspace.worldbuilding.map(
      ({ id, title, order, format }) => ({ id, title, order, format })
    ),
    characters: workspace.characters.map(
      ({ id, name, group, order }) => ({ id, name, group, order })
    ),
    volumes: workspace.plot.volumes.map(({ id, title, order }) => ({
      id,
      title,
      order
    })),
    arcs: workspace.plot.arcs.map(
      ({ id, volumeId, title, order }) => ({
        id,
        volumeId,
        title,
        order
      })
    ),
    chapterCards: workspace.plot.chapterCards.map(
      ({ id, volumeId, primaryArcId, title, narrativeOrder }) => ({
        id,
        volumeId,
        primaryArcId,
        title,
        narrativeOrder
      })
    ),
    committedThroughChapterId:
      workspace.ledger.committedThroughChapterId
  });
}

const LongBookSharedShape = {
  id: LongBookIdSchema,
  title: LongTitleSchema,
  bookType: z.literal("long"),
  genre: z.string().trim().min(1).max(120),
  status: z.enum(["editing", "completed"]),
  linkedMaterialIdsByKind: LinkedMaterialIdsByKindSchema,
  linkedSkillIdsByKind: LinkedSkillIdsByKindSchema,
  createdAt: LongTimestampSchema,
  updatedAt: LongTimestampSchema
} as const;

export const LongBookSchema = z
  .object({
    schemaVersion: LongWorkspaceSchemaVersionSchema,
    ...LongBookSharedShape,
    projectRevision: LongRevisionSchema.optional(),
    workspaceIndex: LongWorkspaceIndexSnapshotSchema
  })
  .strict()
  .superRefine((book, context) => {
    if (book.workspaceIndex.bookId !== book.id) {
      context.addIssue({
        code: "custom",
        path: ["workspaceIndex", "bookId"],
        message: "Long book and workspace index ids must match."
      });
    }
    if (
      book.projectRevision !== undefined &&
      book.projectRevision !== book.workspaceIndex.revision
    ) {
      context.addIssue({
        code: "custom",
        path: ["projectRevision"],
        message:
          "Long book project revision must match its workspace index revision."
      });
    }
    if (book.updatedAt !== book.workspaceIndex.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message:
          "Long book and workspace index update timestamps must match."
      });
    }
  });
export type LongBook = z.infer<typeof LongBookSchema>;

export const LongBookSummarySchema = z
  .object({
    schemaVersion: LongWorkspaceSchemaVersionSchema,
    kind: z.literal("deepwrite.long-book"),
    ...LongBookSharedShape,
    projectRevision: LongRevisionSchema,
    navigation: LongWorkspaceNavigationSnapshotSchema
  })
  .strict()
  .superRefine((book, context) => {
    if (book.navigation.bookId !== book.id) {
      context.addIssue({
        code: "custom",
        path: ["navigation", "bookId"],
        message: "Long book summary and navigation ids must match."
      });
    }
    if (book.projectRevision !== book.navigation.revision) {
      context.addIssue({
        code: "custom",
        path: ["projectRevision"],
        message:
          "Long book summary project revision must match its navigation revision."
      });
    }
    if (book.updatedAt !== book.navigation.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message:
          "Long book summary and navigation update timestamps must match."
      });
    }
  });
export type LongBookSummary = z.infer<typeof LongBookSummarySchema>;

export function createLongBookSummary(book: LongBook): LongBookSummary {
  return LongBookSummarySchema.parse({
    schemaVersion: book.schemaVersion,
    kind: "deepwrite.long-book",
    id: book.id,
    title: book.title,
    bookType: book.bookType,
    genre: book.genre,
    status: book.status,
    linkedMaterialIdsByKind: book.linkedMaterialIdsByKind,
    linkedSkillIdsByKind: book.linkedSkillIdsByKind,
    projectRevision: book.projectRevision ?? book.workspaceIndex.revision,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    navigation: createLongWorkspaceNavigationSnapshot(book.workspaceIndex)
  });
}

export const LongWorkspaceIndexFileReferenceSchema =
  LongJsonFileReferenceSchema.superRefine((file, context) => {
    if (file.id !== LONG_WORKSPACE_INDEX_FILE_ID) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message:
          `Long workspace index id must be ${LONG_WORKSPACE_INDEX_FILE_ID}.`
      });
    }
    if (file.path !== LONG_WORKSPACE_INDEX_PATH) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message:
          `Long workspace index path must be ${LONG_WORKSPACE_INDEX_PATH}.`
      });
    }
  });
export type LongWorkspaceIndexFileReference = z.infer<
  typeof LongWorkspaceIndexFileReferenceSchema
>;

/**
 * The physical long-book manifest stays intentionally small. Structure and
 * file indexes live in `long/index.json`; chapter body content stays in the
 * indexed Markdown files.
 */
export const LongProjectManifestSchema = z
  .object({
    schemaVersion: LongProjectManifestSchemaVersionSchema,
    revision: LongRevisionSchema,
    kind: z.literal("deepwrite.long-book"),
    ...LongBookSharedShape,
    workspaceIndexFile: LongWorkspaceIndexFileReferenceSchema
  })
  .strict();
export type LongProjectManifest = z.infer<
  typeof LongProjectManifestSchema
>;

export const LONG_AGENT_IDS = [
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "expert_section_writer",
  "continuity_ledger"
] as const;
export const LongAgentIdSchema = z.enum(LONG_AGENT_IDS);
export type LongAgentId = z.infer<typeof LongAgentIdSchema>;

export const LONG_WORKSPACE_ROOTS = [
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "continuity_ledger"
] as const;
export const LongWorkspaceRootSchema = z.enum(LONG_WORKSPACE_ROOTS);
export type LongWorkspaceRoot = z.infer<typeof LongWorkspaceRootSchema>;

export const LONG_AGENT_CAPABILITIES = [
  "query_structure",
  "mutate_structure",
  "dispatch_chapter_writer",
  "write_chapter_files",
  "commit_ledger"
] as const;
export const LongAgentCapabilitySchema = z.enum(
  LONG_AGENT_CAPABILITIES
);
export type LongAgentCapability = z.infer<
  typeof LongAgentCapabilitySchema
>;

function uniqueEnumValuesSchema<T extends string>(
  schema: z.ZodType<T>,
  maxLength: number,
  label: string
) {
  return z
    .array(schema)
    .max(maxLength)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${value}`
          });
        }
        seen.add(value);
      });
    });
}

export const LongAgentReadAccessSchema = z
  .object({
    workspaceRoots: uniqueEnumValuesSchema(
      LongWorkspaceRootSchema,
      LONG_WORKSPACE_ROOTS.length,
      "long workspace root"
    ),
    materialKinds: uniqueEnumValuesSchema(
      MaterialKindSchema,
      5,
      "material kind"
    ),
    skillKinds: uniqueEnumValuesSchema(
      SkillKindSchema,
      4,
      "skill kind"
    )
  })
  .strict();
export type LongAgentReadAccess = z.infer<
  typeof LongAgentReadAccessSchema
>;

export const LongAgentWriteAccessSchema = z
  .object({
    workspaceRoots: uniqueEnumValuesSchema(
      LongWorkspaceRootSchema,
      LONG_WORKSPACE_ROOTS.length,
      "long workspace write root"
    ),
    capabilities: uniqueEnumValuesSchema(
      LongAgentCapabilitySchema,
      LONG_AGENT_CAPABILITIES.length,
      "long agent capability"
    )
  })
  .strict();
export type LongAgentWriteAccess = z.infer<
  typeof LongAgentWriteAccessSchema
>;

export const LongAgentProfileSchema = z
  .object({
    workspaceType: z.literal("long"),
    id: LongAgentIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    systemPrompt: z
      .string()
      .min(1)
      .max(200_000)
      .refine((value) => value.trim().length > 0, {
        message: "Long agent system prompt must contain non-whitespace text."
      }),
    welcomeShortcuts: z.tuple([
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200)
    ]),
    readAccess: LongAgentReadAccessSchema,
    writeAccess: LongAgentWriteAccessSchema
  })
  .strict()
  .superRefine((profile, context) => {
    profile.writeAccess.workspaceRoots.forEach((root, index) => {
      if (!profile.readAccess.workspaceRoots.includes(root)) {
        context.addIssue({
          code: "custom",
          path: ["writeAccess", "workspaceRoots", index],
          message:
            "A long-form agent cannot write a workspace root it cannot read."
        });
      }
    });
  });
export type LongAgentProfile = z.infer<typeof LongAgentProfileSchema>;

export const LONG_WORKSPACE_ROOT_TO_AGENT_ID = {
  worldbuilding: "worldbuilding",
  character_design: "character_design",
  plot_design: "plot_design",
  draft: "draft",
  continuity_ledger: "continuity_ledger"
} as const satisfies Record<LongWorkspaceRoot, LongAgentId>;

export function resolveLongAgentIdForRoot(
  root: LongWorkspaceRoot,
  chapterWriter = false
): LongAgentId {
  return root === "draft" && chapterWriter
    ? "expert_section_writer"
    : LONG_WORKSPACE_ROOT_TO_AGENT_ID[root];
}

const LONG_DEFAULT_SHORTCUTS = {
  worldbuilding: ["完善当前设定", "检查设定冲突", "补充相关世界规则"],
  character_design: ["完善当前人物", "检查人物关系", "推演人物状态"],
  plot_design: ["完善剧情结构", "检查时间线", "梳理伏笔落点"],
  draft: ["规划下一章", "检查章卡顺序", "准备单章写作"],
  expert_section_writer: ["写当前章", "续写当前章", "检查本章连续性"],
  continuity_ledger: ["提交当前章", "检查连续性", "查看未闭合伏笔"]
} as const satisfies Record<
  LongAgentId,
  readonly [string, string, string]
>;

function longDefaultProfile(
  input: Omit<
    LongAgentProfile,
    "workspaceType" | "welcomeShortcuts"
  >
): LongAgentProfile {
  return LongAgentProfileSchema.parse({
    workspaceType: "long",
    ...input,
    welcomeShortcuts: LONG_DEFAULT_SHORTCUTS[input.id]
  });
}

export const DEFAULT_LONG_AGENT_PROFILES: readonly LongAgentProfile[] = [
  longDefaultProfile({
    id: "worldbuilding",
    label: "世界观智能体",
    description: "维护世界规则、势力、地理、历史、术语、境界与物品。",
    systemPrompt: `你负责长篇世界观。模型只使用世界观业务标识：
- 文本型分类以 category_id 唯一定位；列表型分类以 category_id 和 item_id 唯一定位。
- 其余实现细节由工具内部处理；不要索取、推断或复述。

工作规则：
1. 先调用 list_worldbuilding 获取分类列表；需要列表型条目时，再用 category_id 获取该分类的条目列表。
2. 读取正文使用 read_worldbuilding；列表型必须指定 item_id，文本型必须省略 item_id。需要编辑前，必须以 mode=full 完整读取。
3. 搜索已有设定使用 search_worldbuilding；命中只用于定位，需要修改时仍须以 mode=full 完整读取相应正文。
4. 新增列表条目使用 create_worldbuilding_file；一次只创建一个空白条目，不得在创建参数中夹带初始化正文。创建后使用返回的 item_id 单独调用 write_worldbuilding_file。
5. 新建空条目的首次正文、空正文写入或用户明确要求整体重写时使用 write_worldbuilding_file；已有正文必须先以 mode=full 完整读取，并明确允许覆盖。
6. 局部修改必须先以 mode=full 完整读取，再使用 edit_worldbuilding_file 做唯一原文片段替换。
7. 分类创建，以及分类和已有条目的重命名、删除、排序使用 propose_long_mutation；条目创建不得使用该工具，必须使用 create_worldbuilding_file。不得通过拼接伪造列表结构。
8. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`,
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "continuity_ledger"
      ],
      materialKinds: ["character", "gimmick", "plot", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["worldbuilding"],
      capabilities: ["query_structure", "mutate_structure"]
    }
  }),
  longDefaultProfile({
    id: "character_design",
    label: "人物设计智能体",
    description: "维护人物核心设定、关系、当前状态和历史。",
    systemPrompt: `你负责长篇人物设计。模型只使用人物业务标识：
- 每名人物以 character_id 唯一定位；人物内容按 core_profile、relationships、current_state、history 四种 document 区分。
- 其余实现细节由工具内部处理；不要索取、推断或复述。

工作规则：
1. 先调用 list_characters 获取人物列表，可用 group 筛选；需要查找已有内容时使用 search_characters。人物设计涉及世界规则、地理、组织或其他背景约束时，使用 list_worldbuilding、search_worldbuilding 和 read_worldbuilding 查询世界观正文。
2. 读取人物正文使用 read_character；必须同时指定 character_id 和 document。需要编辑前，必须以 mode=full 完整读取。世界观内容只读，不得由人物设计智能体修改。
3. 新增人物使用 create_character；一次只创建一名人物及四份空白文档，不得在创建参数中夹带初始化正文。创建后使用返回的 character_id，分别调用 write_character_file 写入需要的文档。
4. 新人物空白文档的首次正文、空正文写入或用户明确要求整体重写时使用 write_character_file；已有正文必须先以 mode=full 完整读取，并明确允许覆盖。
5. 局部修改必须先以 mode=full 完整读取，再使用 edit_character_file 做唯一原文片段替换。
6. 人物重命名、别名、分组、删除和排序使用 propose_long_mutation；人物创建不得使用该工具，必须使用 create_character。不得把多名人物拼接到同一文件中。
7. 核心档案表达稳定身份与设计意图；首次连续性提交后，人物关系、当前状态和历史轨迹由连续性账本接管，人物设计智能体只能直接修改核心档案。
8. 搜索命中和当前页面快照只用于定位与理解；修改前仍须完整读取目标文档。
9. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`,
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["character_design"],
      capabilities: ["query_structure", "mutate_structure"]
    }
  }),
  longDefaultProfile({
    id: "plot_design",
    label: "剧情设计智能体",
    description: "维护分卷、剧情弧、章卡、故事时间线、叙事落点与伏笔。",
    systemPrompt: `你负责长篇剧情设计。模型只使用剧情业务标识：
- 全书故事线使用 book_line 目标；分卷、剧情点、章卡、故事事件、事件连接和叙事落点分别使用各自稳定业务 ID。
- 伏笔线与伏笔触点沿用独立的现有结构工具；其余实现细节由工具内部处理，不要索取、推断或复述。

工作规则：
1. 先调用 list_plot_design 获取结构类型或条目列表；需要查找已有内容时使用 search_plot_design。涉及世界规则或人物约束时，使用 list_worldbuilding / search_worldbuilding / read_worldbuilding 和 list_characters / search_characters / read_character 查询，世界观与人物内容只读。
2. 读取剧情内容使用 read_plot_design。需要整体写入或局部编辑前，必须以 mode=full 完整读取目标；搜索命中和当前页面快照只用于定位与理解。
3. 新增分卷、剧情点、章卡、故事事件、事件连接和叙事落点使用 create_plot_design；一次只创建一个条目，并在创建参数中提供完整初始内容。
4. 已有目标的整体重写使用 write_plot_design，必须先完整读取并明确允许覆盖；局部修改使用 edit_plot_design。
5. 非伏笔条目的重命名、关联、移动、删除和排序使用 propose_long_mutation；不得通过该工具创建非伏笔条目或写入其内容字段。
6. 伏笔线与伏笔触点继续完全使用 propose_long_mutation 的既有参数与流程，不改造成剧情内容工具。
7. 严格区分故事发生顺序、章节叙述顺序和读者信息进度；已成为连续性事实的结构不得绕过约束修改。
8. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`,
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "gimmick", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["plot_design"],
      capabilities: [
        "query_structure",
        "mutate_structure",
        "dispatch_chapter_writer"
      ]
    }
  }),
  longDefaultProfile({
    id: "draft",
    label: "正文统筹智能体",
    description: "按分卷、剧情弧和章卡顺序调度单章写作。",
    systemPrompt:
      "你负责长篇正文统筹。只能按未提交章卡的连续顺序，提议启动单章、当前主弧连续章节或当前卷写作；不得调度整本。获批后客户端必须逐章启动独立写手、逐章人工审批写入与连续性提交，不能并行或跳章。",
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["draft"],
      capabilities: [
        "query_structure",
        "dispatch_chapter_writer"
      ]
    }
  }),
  longDefaultProfile({
    id: "expert_section_writer",
    label: "单章写作智能体",
    description: "根据一张章卡完成可供连续性核验的正文证据。",
    systemPrompt:
      "你是长篇单章写手。每次只处理当前章卡，只负责写出可供核验的正文证据；必须依据查询到的设定与已提交连续性，不得自行确定章末状态、接续包或宣称提交账本。",
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["draft"],
      capabilities: ["query_structure", "write_chapter_files"]
    }
  }),
  longDefaultProfile({
    id: "continuity_ledger",
    label: "连续性账本智能体",
    description: "核验正文并生成章末状态、接续包和结构化全域投影。",
    systemPrompt:
      "你负责长篇连续性账本。只处理正文已经写完的下一章，以正文为证据核对人物、关系、世界、剧情、伏笔与知识边界，生成章末人物状态、下一章接续包和结构化全域投影后形成提交提案；不得跳章提交。",
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["character_design", "plot_design", "continuity_ledger"],
      capabilities: ["query_structure", "commit_ledger"]
    }
  })
];

export function getDefaultLongAgentProfile(
  agentId: LongAgentId
): LongAgentProfile {
  const profile = DEFAULT_LONG_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!profile) {
    throw new Error(`Missing default long agent profile: ${agentId}`);
  }
  return structuredClone(profile);
}
