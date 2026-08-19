import { z } from "zod";

import {
  LinkedMaterialIdsByKindSchema,
  LinkedSkillIdsByKindSchema
} from "../catalog";
import {
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongBookIdSchema,
  LongJsonFileReferenceSchema,
  LongProjectManifestSchemaVersionSchema,
  LongWorkspaceSchemaVersionSchema
} from "./ids";
import { LongWorkspaceIndexSnapshotSchema } from "./index-validation";
import {
  createLongWorkspaceNavigationSnapshot,
  LongWorkspaceNavigationSnapshotSchema
} from "./navigation";
import {
  LongRevisionSchema,
  LongTimestampSchema,
  LongTitleSchema
} from "./primitives";

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
        message: "Long book and workspace index update timestamps must match."
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
        message: `Long workspace index id must be ${LONG_WORKSPACE_INDEX_FILE_ID}.`
      });
    }
    if (file.path !== LONG_WORKSPACE_INDEX_PATH) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: `Long workspace index path must be ${LONG_WORKSPACE_INDEX_PATH}.`
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
export type LongProjectManifest = z.infer<typeof LongProjectManifestSchema>;
