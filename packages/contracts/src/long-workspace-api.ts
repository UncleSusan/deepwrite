import { z } from "zod";
import {
  LinkedMaterialIdsByKindInputSchema,
  LinkedSkillIdsByKindInputSchema
} from "./catalog";
import { EnvelopeBaseSchema } from "./envelope";
import {
  LongCommitChapterInputSchema,
  LongRollbackLastCommitInputSchema,
  LongWriteChapterInputSchema
} from "./long-ledger";
import {
  LongWorkspaceImpactPreviewSchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationResultSchema
} from "./long-workspace-operations";
import {
  LongBookIdSchema,
  LongBookSchema,
  LongBookSummarySchema,
  LongAgentIdSchema,
  LongCharacterGroupSchema,
  LongChapterCardIdSchema,
  LongFileIdSchema,
  LongFileRevisionSchema,
  LongProjectRelativePathSchema,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceNavigationSnapshotSchema,
  LongWorkspaceRootSchema,
  LONG_WORKSPACE_ROOT_TO_AGENT_ID
} from "./long-workspace";

export const LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS = 20_000;
export const LONG_WORLDBUILDING_OVERVIEW_FOCUS_MAX_CHARACTERS = 8_000;

const LongWorldbuildingFocusTextSnapshotSchema = z
  .object({
    content: z
      .string()
      .max(LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS * 2),
    truncated: z.literal(true).optional(),
    originalLength: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const contentLength = Array.from(value.content).length;
    if (contentLength > LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message:
          "Long worldbuilding focus text exceeds the maximum character count."
      });
    }
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= contentLength)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "A truncated long worldbuilding focus text must report its original length."
      });
    }
    if (
      value.truncated !== true &&
      value.originalLength !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "An untruncated long worldbuilding focus text must omit its original length."
      });
    }
  });

export const LongWorldbuildingFocusSnapshotSchema = z
  .object({
    categoryTitle: z.string().trim().min(1).max(256),
    format: z.enum(["list", "text"]),
    currentStage: z
      .object({
        kind: z.enum(["item", "overview", "text"]),
        title: z.string().trim().min(1).max(256),
        text: LongWorldbuildingFocusTextSnapshotSchema
      })
      .strict(),
    overview: LongWorldbuildingFocusTextSnapshotSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.format === "text" && value.currentStage.kind !== "text") ||
      (value.format === "list" && value.currentStage.kind === "text")
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentStage", "kind"],
        message:
          "Long worldbuilding focus stage kind must match its category format."
      });
    }
    if (
      value.currentStage.kind === "item" &&
      value.overview === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["overview"],
        message:
          "A focused worldbuilding item must include its category overview."
      });
    }
    if (
      value.format === "text" &&
      value.overview !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["overview"],
        message:
          "A text worldbuilding category must not include an overview snapshot."
      });
    }
    const totalCharacters =
      Array.from(value.currentStage.text.content).length +
      Array.from(value.overview?.content ?? "").length;
    if (totalCharacters > LONG_WORLDBUILDING_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["currentStage", "text", "content"],
        message:
          "Combined long worldbuilding focus text exceeds the maximum character count."
      });
    }
  });
export type LongWorldbuildingFocusSnapshot = z.infer<
  typeof LongWorldbuildingFocusSnapshotSchema
>;

export const LONG_CHARACTER_FOCUS_MAX_CHARACTERS = 20_000;
export const LONG_CHARACTER_CORE_FOCUS_MAX_CHARACTERS = 8_000;
export const LONG_CHARACTER_OVERVIEW_FOCUS_MAX_CHARACTERS = 8_000;

const LongCharacterFocusTextSnapshotSchema = z
  .object({
    content: z.string().max(LONG_CHARACTER_FOCUS_MAX_CHARACTERS * 2),
    truncated: z.literal(true).optional(),
    originalLength: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const contentLength = Array.from(value.content).length;
    if (contentLength > LONG_CHARACTER_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Long character focus text exceeds the maximum character count."
      });
    }
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= contentLength)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "A truncated long character focus text must report its original length."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "An untruncated long character focus text must omit its original length."
      });
    }
  });

export const LongCharacterFocusSnapshotSchema = z
  .object({
    characterName: z.string().trim().min(1).max(256).optional(),
    group: LongCharacterGroupSchema.optional(),
    currentDocument: z
      .object({
        kind: z.enum([
          "overview",
          "core_profile",
          "relationships",
          "current_state",
          "history"
        ]),
        title: z.string().trim().min(1).max(256),
        text: LongCharacterFocusTextSnapshotSchema
      })
      .strict(),
    overview: LongCharacterFocusTextSnapshotSchema.optional(),
    coreProfile: LongCharacterFocusTextSnapshotSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.currentDocument.kind === "overview") {
      if (value.characterName !== undefined || value.group !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["characterName"],
          message:
            "A focused character overview must not include a character name or group."
        });
      }
      if (value.overview !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["overview"],
          message:
            "A focused character overview must not duplicate the overview snapshot."
        });
      }
      if (value.coreProfile !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused character overview must not include a core profile snapshot."
        });
      }
    } else {
      if (!value.characterName || !value.group) {
        context.addIssue({
          code: "custom",
          path: ["characterName"],
          message:
            "A focused character document must include the character name and group."
        });
      }
      if (value.overview === undefined) {
        context.addIssue({
          code: "custom",
          path: ["overview"],
          message:
            "A focused character document must include the stage overview."
        });
      }
      if (
        value.currentDocument.kind !== "core_profile" &&
        value.coreProfile === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused secondary character document must include the core profile."
        });
      }
      if (
        value.currentDocument.kind === "core_profile" &&
        value.coreProfile !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused core profile must not duplicate the core profile snapshot."
        });
      }
    }
    const totalCharacters =
      Array.from(value.currentDocument.text.content).length +
      Array.from(value.overview?.content ?? "").length +
      Array.from(value.coreProfile?.content ?? "").length;
    if (totalCharacters > LONG_CHARACTER_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["currentDocument", "text", "content"],
        message:
          "Combined long character focus text exceeds the maximum character count."
      });
    }
  });
export type LongCharacterFocusSnapshot = z.infer<
  typeof LongCharacterFocusSnapshotSchema
>;

export const LongWorkspaceRuntimeContextSchema = z
  .object({
    bookId: LongBookIdSchema,
    title: z.string().trim().min(1).max(256),
    activeRoot: LongWorkspaceRootSchema,
    activeAgentId: LongAgentIdSchema,
    activeFileId: LongFileIdSchema.optional(),
    activeFileRevision: LongFileRevisionSchema.optional(),
    activeChapterCardId: LongChapterCardIdSchema.optional(),
    workspaceRevision: z.number().int().nonnegative(),
    projectRevision: z.number().int().nonnegative(),
    navigation: LongWorkspaceNavigationSnapshotSchema,
    worldbuildingFocus: LongWorldbuildingFocusSnapshotSchema.optional(),
    characterFocus: LongCharacterFocusSnapshotSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.navigation.bookId !== value.bookId) {
      context.addIssue({
        code: "custom",
        path: ["navigation", "bookId"],
        message: "Long runtime navigation must belong to the active book."
      });
    }
    if (value.navigation.revision !== value.workspaceRevision) {
      context.addIssue({
        code: "custom",
        path: ["navigation", "revision"],
        message:
          "Long runtime navigation revision must match the active workspace revision."
      });
    }
    const expectedRootAgent =
      LONG_WORKSPACE_ROOT_TO_AGENT_ID[value.activeRoot];
    const agentMatchesRoot =
      value.activeAgentId === expectedRootAgent ||
      (value.activeRoot === "draft" &&
        value.activeAgentId === "expert_section_writer");
    if (!agentMatchesRoot) {
      context.addIssue({
        code: "custom",
        path: ["activeAgentId"],
        message:
          "Long runtime agent must match the active workspace root."
      });
    }
    if (
      value.activeAgentId === "expert_section_writer" &&
      value.activeChapterCardId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeChapterCardId"],
        message:
          "Chapter-writer runs require an active chapter."
      });
    }
    if (
      value.activeChapterCardId !== undefined &&
      !value.navigation.chapterCards.some(
        ({ id }) => id === value.activeChapterCardId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeChapterCardId"],
        message:
          "Long runtime active chapter must exist in the navigation snapshot."
      });
    }
    if (
      Boolean(value.activeFileId) !== Boolean(value.activeFileRevision)
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeFileRevision"],
        message:
          "Long runtime active file id and revision must be provided together."
      });
    }
    if (
      value.worldbuildingFocus !== undefined &&
      (value.activeRoot !== "worldbuilding" ||
        value.activeAgentId !== "worldbuilding")
    ) {
      context.addIssue({
        code: "custom",
        path: ["worldbuildingFocus"],
        message:
          "Long worldbuilding focus may only be provided to the worldbuilding agent."
      });
    }
    if (
      value.worldbuildingFocus !== undefined &&
      value.activeFileId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeFileId"],
        message:
          "Long worldbuilding focus requires the active worldbuilding file."
      });
    }
    if (
      value.characterFocus !== undefined &&
      (value.activeRoot !== "character_design" ||
        value.activeAgentId !== "character_design")
    ) {
      context.addIssue({
        code: "custom",
        path: ["characterFocus"],
        message:
          "Long character focus may only be provided to the character-design agent."
      });
    }
    if (
      value.characterFocus !== undefined &&
      value.activeFileId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeFileId"],
        message:
          "Long character focus requires the active character file."
      });
    }
  });
export type LongWorkspaceRuntimeContext = z.infer<
  typeof LongWorkspaceRuntimeContextSchema
>;

export const LONG_BOOK_GENRES = [
  "玄幻",
  "奇幻",
  "武侠",
  "仙侠",
  "都市",
  "现实",
  "历史",
  "军事",
  "科幻",
  "悬疑",
  "言情",
  "其他"
] as const;

/**
 * The enum is primarily a UI suggestion list. Imported projects may preserve
 * a custom genre, so the wire contract deliberately accepts any short label.
 */
export const LongBookGenreSchema = z.string().trim().min(1).max(120);
export type LongBookGenre = z.infer<typeof LongBookGenreSchema>;

const MAX_LONG_BINDING_IDS_PER_KIND = 1_000;

const LongLinkedMaterialIdsByKindInputSchema =
  LinkedMaterialIdsByKindInputSchema.superRefine((groups, context) => {
    for (const [kind, ids] of Object.entries(groups)) {
      if (ids && ids.length > MAX_LONG_BINDING_IDS_PER_KIND) {
        context.addIssue({
          code: "custom",
          path: [kind],
          message: `Long-form binding lists cannot exceed ${MAX_LONG_BINDING_IDS_PER_KIND} ids per kind.`
        });
      }
    }
  });

const LongLinkedSkillIdsByKindInputSchema =
  LinkedSkillIdsByKindInputSchema.superRefine((groups, context) => {
    for (const [kind, ids] of Object.entries(groups)) {
      if (ids && ids.length > MAX_LONG_BINDING_IDS_PER_KIND) {
        context.addIssue({
          code: "custom",
          path: [kind],
          message: `Long-form binding lists cannot exceed ${MAX_LONG_BINDING_IDS_PER_KIND} ids per kind.`
        });
      }
    }
  });

export const CreateLongBookInputSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    genre: LongBookGenreSchema,
    linkedMaterialIdsByKind:
      LongLinkedMaterialIdsByKindInputSchema.optional(),
    linkedSkillIdsByKind: LongLinkedSkillIdsByKindInputSchema.optional()
  })
  .strict();
export type CreateLongBookInput = z.infer<typeof CreateLongBookInputSchema>;

export const CreateLongBookAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    input: CreateLongBookInputSchema
  })
  .strict();
export type CreateLongBookAtPathInput = z.infer<
  typeof CreateLongBookAtPathInputSchema
>;

export const LongImportWriteClawAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1)
  })
  .strict();
export type LongImportWriteClawAtPathInput = z.infer<
  typeof LongImportWriteClawAtPathInputSchema
>;

export const LongImportWriteClawResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    sourceKind: z.enum([
      "write-claw-zip",
      "long-workspace-json",
      "book-json"
    ]),
    legacySchemaVersion: z.number().int().nonnegative(),
    committedChapterPolicy: z.enum([
      "written-uncommitted",
      "legacy-checkpoints"
    ]),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(10_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message: "Imported long book and summary must share the same id."
      });
    }
  });
export type LongImportWriteClawResult = z.infer<
  typeof LongImportWriteClawResultSchema
>;

export const LongImportPortableAtPathInputSchema = z
  .object({
    parentDirectory: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1)
  })
  .strict();
export type LongImportPortableAtPathInput = z.infer<
  typeof LongImportPortableAtPathInputSchema
>;

export const LongImportPortableResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema,
    exportedAt: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.book.id !== value.summary.id) {
      context.addIssue({
        code: "custom",
        path: ["summary", "id"],
        message: "Imported portable long book and summary must share the same id."
      });
    }
  });
export type LongImportPortableResult = z.infer<
  typeof LongImportPortableResultSchema
>;

export const LongOpenBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongOpenBookInput = z.infer<typeof LongOpenBookInputSchema>;

export const LongUpdateBindingsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    expectedProjectRevision: z.number().int().nonnegative(),
    linkedMaterialIdsByKind: LongLinkedMaterialIdsByKindInputSchema,
    linkedSkillIdsByKind: LongLinkedSkillIdsByKindInputSchema
  })
  .strict();
export type LongUpdateBindingsInput = z.infer<
  typeof LongUpdateBindingsInputSchema
>;

export const LongListBooksResultSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
    books: z.array(LongBookSummarySchema).max(100_000),
    diagnostics: z
      .array(
        z
          .object({
            bookId: LongBookIdSchema,
            code: z.enum(["unavailable", "invalid"]),
            message: z.string().trim().min(1).max(4_000)
          })
          .strict()
      )
      .max(100_000)
      .optional()
  })
  .strict();
export type LongListBooksResult = z.infer<
  typeof LongListBooksResultSchema
>;

export const LongOpenBookAtPathInputSchema = z
  .object({
    projectDirectory: z.string().trim().min(1)
  })
  .strict();
export type LongOpenBookAtPathInput = z.infer<
  typeof LongOpenBookAtPathInputSchema
>;

export const LongRemoveBookInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongRemoveBookInput = z.infer<typeof LongRemoveBookInputSchema>;

export const LongRemoveBookResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    removed: z.boolean()
  })
  .strict();
export type LongRemoveBookResult = z.infer<
  typeof LongRemoveBookResultSchema
>;

export const LongOpenBookResultSchema = z
  .object({
    book: LongBookSchema,
    summary: LongBookSummarySchema
  })
  .strict();
export type LongOpenBookResult = z.infer<typeof LongOpenBookResultSchema>;

export const LONG_DOCUMENT_PAGE_DEFAULT_CHARACTERS = 32_768;
export const LONG_DOCUMENT_PAGE_MAX_CHARACTERS = 256 * 1024;

export const LongReadDocumentInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    fileId: LongFileIdSchema,
    offset: z.number().int().nonnegative().default(0),
    maxCharacters: z
      .number()
      .int()
      .min(1)
      .max(LONG_DOCUMENT_PAGE_MAX_CHARACTERS)
      .default(LONG_DOCUMENT_PAGE_DEFAULT_CHARACTERS)
  })
  .strict();
export type LongReadDocumentInput = z.infer<
  typeof LongReadDocumentInputSchema
>;

export const LongReadDocumentResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    file: LongWorkspaceFileReferenceSchema,
    // JavaScript string length counts UTF-16 code units. Reserve two units
    // per requested Unicode code point, then enforce the actual page limit
    // below with Array.from.
    content: z.string().max(LONG_DOCUMENT_PAGE_MAX_CHARACTERS * 2),
    offset: z.number().int().nonnegative(),
    totalCharacters: z.number().int().nonnegative(),
    nextOffset: z.number().int().positive().nullable(),
    workspaceRevision: z.number().int().nonnegative(),
    projectRevision: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    // Document paging is defined in Unicode code points so an emoji or other
    // surrogate pair is never split between pages.
    const pageCharacters = Array.from(value.content).length;
    if (pageCharacters > LONG_DOCUMENT_PAGE_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Long document page exceeds the maximum character count."
      });
    }
    const endOffset = value.offset + pageCharacters;
    if (endOffset > value.totalCharacters) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Long document page exceeds its declared total length."
      });
    }
    if (
      value.nextOffset !== null &&
      (value.nextOffset !== endOffset ||
        value.nextOffset >= value.totalCharacters)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextOffset"],
        message:
          "Long document next offset must follow the page and leave unread content."
      });
    }
    if (value.nextOffset === null && endOffset < value.totalCharacters) {
      context.addIssue({
        code: "custom",
        path: ["nextOffset"],
        message: "A truncated long document page must expose its next offset."
      });
    }
  });
export type LongReadDocumentResult = z.infer<
  typeof LongReadDocumentResultSchema
>;

export const LONG_SEARCH_SCOPES = [
  "all",
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "continuity_ledger"
] as const;
export const LongSearchScopeSchema = z.enum(LONG_SEARCH_SCOPES);
export type LongSearchScope = z.infer<typeof LongSearchScopeSchema>;

export const LongSearchInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    query: z.string().trim().min(1).max(256),
    scope: LongSearchScopeSchema.default("all"),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    maxSnippetCharacters: z.number().int().min(40).max(2_000).default(320)
  })
  .strict();
export type LongSearchInput = z.infer<typeof LongSearchInputSchema>;

export const LongSearchHitSchema = z
  .object({
    fileId: LongFileIdSchema,
    path: LongProjectRelativePathSchema,
    root: LongWorkspaceRootSchema,
    title: z.string().trim().min(1).max(512),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    snippet: z.string().max(2_000),
    revision: LongFileRevisionSchema
  })
  .strict()
  .refine((hit) => hit.end > hit.start, {
    path: ["end"],
    message: "Long search hit end must be after start."
  });
export type LongSearchHit = z.infer<typeof LongSearchHitSchema>;

export const LongSearchResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    query: z.string().min(1).max(256),
    scope: LongSearchScopeSchema,
    hits: z.array(LongSearchHitSchema).max(100),
    nextCursor: z.string().min(1).max(2_048).nullable(),
    workspaceRevision: z.number().int().nonnegative(),
    projectRevision: z.number().int().nonnegative()
  })
  .strict();
export type LongSearchResult = z.infer<typeof LongSearchResultSchema>;

export const LongWriteDocumentInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    fileId: LongFileIdSchema,
    content: z.string().max(16 * 1024 * 1024),
    baseRevision: LongFileRevisionSchema,
    baseWorkspaceRevision: z.number().int().nonnegative(),
    baseProjectRevision: z.number().int().nonnegative()
  })
  .strict();
export type LongWriteDocumentInput = z.infer<
  typeof LongWriteDocumentInputSchema
>;

export const LongWriteDocumentResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    file: LongWorkspaceFileReferenceSchema,
    workspaceRevision: z.number().int().nonnegative(),
    projectRevision: z.number().int().nonnegative(),
    summary: LongBookSummarySchema
  })
  .strict();
export type LongWriteDocumentResult = z.infer<
  typeof LongWriteDocumentResultSchema
>;

export const LongWorkspaceIndexResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    workspaceIndex: LongWorkspaceIndexSnapshotSchema,
    projectRevision: z.number().int().nonnegative()
  })
  .strict();
export type LongWorkspaceIndexResult = z.infer<
  typeof LongWorkspaceIndexResultSchema
>;

export const LongPreviewOperationsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    batch: LongWorkspaceOperationBatchSchema
  })
  .strict();
export type LongPreviewOperationsInput = z.infer<
  typeof LongPreviewOperationsInputSchema
>;

export const LongPreviewOperationsResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    preview: LongWorkspaceImpactPreviewSchema,
    projectRevision: z.number().int().nonnegative()
  })
  .strict();
export type LongPreviewOperationsResult = z.infer<
  typeof LongPreviewOperationsResultSchema
>;

export const LongApplyOperationsInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    batch: LongWorkspaceOperationBatchSchema,
    baseProjectRevision: z.number().int().nonnegative()
  })
  .strict();
export type LongApplyOperationsInput = z.infer<
  typeof LongApplyOperationsInputSchema
>;

export const LongApplyOperationsResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    operationResult: LongWorkspaceOperationResultSchema,
    projectRevision: z.number().int().nonnegative(),
    summary: LongBookSummarySchema
  })
  .strict();
export type LongApplyOperationsResult = z.infer<
  typeof LongApplyOperationsResultSchema
>;

export const LongCreateBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.createBook"),
    payload: CreateLongBookInputSchema
  });
export const LongCreateBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.createBookAtPath"),
    payload: CreateLongBookAtPathInputSchema
  });
export const LongImportWriteClawCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importWriteClaw"),
    payload: z.object({}).strict()
  });
export const LongImportWriteClawAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importWriteClawAtPath"),
    payload: LongImportWriteClawAtPathInputSchema
  });
export const LongImportPortableCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importPortable"),
    payload: z.object({}).strict()
  });
export const LongImportPortableAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.importPortableAtPath"),
    payload: LongImportPortableAtPathInputSchema
  });
export const LongListBooksCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.list"),
  payload: z.object({}).strict()
});
export const LongOpenBookCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.open"),
  payload: LongOpenBookInputSchema
});
export const LongUpdateBindingsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.updateBindings"),
    payload: LongUpdateBindingsInputSchema
  });
export const LongOpenBookAtPathCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.openAtPath"),
    payload: LongOpenBookAtPathInputSchema
  });
export const LongOpenExistingBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.openExisting"),
    payload: z.object({}).strict()
  });
export const LongUnregisterBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.unregister"),
    payload: LongRemoveBookInputSchema
  });
export const LongDeleteBookCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.delete"),
    payload: LongRemoveBookInputSchema
  });
export const LongGetWorkspaceIndexCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.getWorkspaceIndex"),
    payload: LongOpenBookInputSchema
  });
export const LongReadDocumentCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.readDocument"),
    payload: LongReadDocumentInputSchema
  });
export const LongSearchCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("long.search"),
  payload: LongSearchInputSchema
});
export const LongWriteDocumentCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.writeDocument"),
    payload: LongWriteDocumentInputSchema
  });
export const LongPreviewOperationsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.previewOperations"),
    payload: LongPreviewOperationsInputSchema
  });
export const LongApplyOperationsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.applyOperations"),
    payload: LongApplyOperationsInputSchema
  });
export const LongWriteChapterCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.writeChapter"),
    payload: LongWriteChapterInputSchema
  });
export const LongCommitChapterCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.commitChapter"),
    payload: LongCommitChapterInputSchema
  });
export const LongRollbackLastCommitCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.rollbackLastCommit"),
    payload: LongRollbackLastCommitInputSchema
  });

export const LongWorkspaceCommandEnvelopeSchema = z.discriminatedUnion(
  "type",
  [
    LongCreateBookCommandEnvelopeSchema,
    LongCreateBookAtPathCommandEnvelopeSchema,
    LongImportWriteClawCommandEnvelopeSchema,
    LongImportWriteClawAtPathCommandEnvelopeSchema,
    LongImportPortableCommandEnvelopeSchema,
    LongImportPortableAtPathCommandEnvelopeSchema,
    LongListBooksCommandEnvelopeSchema,
    LongOpenBookCommandEnvelopeSchema,
    LongUpdateBindingsCommandEnvelopeSchema,
    LongOpenExistingBookCommandEnvelopeSchema,
    LongOpenBookAtPathCommandEnvelopeSchema,
    LongUnregisterBookCommandEnvelopeSchema,
    LongDeleteBookCommandEnvelopeSchema,
    LongGetWorkspaceIndexCommandEnvelopeSchema,
    LongReadDocumentCommandEnvelopeSchema,
    LongSearchCommandEnvelopeSchema,
    LongWriteDocumentCommandEnvelopeSchema,
    LongPreviewOperationsCommandEnvelopeSchema,
    LongApplyOperationsCommandEnvelopeSchema,
    LongWriteChapterCommandEnvelopeSchema,
    LongCommitChapterCommandEnvelopeSchema,
    LongRollbackLastCommitCommandEnvelopeSchema
  ]
);
export type LongWorkspaceCommandEnvelope = z.infer<
  typeof LongWorkspaceCommandEnvelopeSchema
>;
