import { z } from "zod";
import {
  LongAgentIdSchema,
  LongBookIdSchema,
  LongChapterCardIdSchema,
  LongCharacterIdSchema,
  LongFileIdSchema,
  LongFileRevisionSchema,
  LongProjectRelativePathSchema
} from "../long-workspace";
import { LongWorkspaceOperationBatchSchema } from "../long-workspace-operations";
import { LongCommitChapterInputSchema } from "../long-ledger";
import { AgentRuntimeRefSchema } from "./runtime";

const LongProposalBasePayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  bookId: LongBookIdSchema,
  agentId: LongAgentIdSchema,
  summary: z.string().trim().min(1).max(1_000),
  runtime: AgentRuntimeRefSchema
});

export const LongMutationProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    baseProjectRevision: z.number().int().nonnegative()
  });
export type LongMutationProposalPayload = z.infer<
  typeof LongMutationProposalPayloadSchema
>;

export const LongWorldbuildingFileChangeSchema = z
  .object({
    categoryId: z.string().trim().min(3).max(160),
    itemId: z.string().trim().min(3).max(160).optional(),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000),
    beforeRevision: LongFileRevisionSchema.nullable(),
    nextRevision: LongFileRevisionSchema
  })
  .strict();
export type LongWorldbuildingFileChange = z.infer<
  typeof LongWorldbuildingFileChangeSchema
>;

export const LongWorldbuildingFileProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    baseProjectRevision: z.number().int().nonnegative(),
    files: z.array(LongWorldbuildingFileChangeSchema).min(1).max(100)
  }).superRefine((value, context) => {
    const fileIds = new Set(value.files.map(({ fileId }) => fileId));
    if (fileIds.size !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Worldbuilding file proposals must target unique files."
      });
    }
    const proposedFileIds = new Set(
      value.batch.documentWrites.map(({ fileId }) => fileId)
    );
    for (const [index, file] of value.files.entries()) {
      if (file.operation !== "create" && !proposedFileIds.has(file.fileId)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "fileId"],
          message:
            "Worldbuilding write and edit changes must have a document write proposal."
        });
      }
      if (file.operation === "create" && file.beforeRevision !== null) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "beforeRevision"],
          message: "Created worldbuilding files cannot have a prior revision."
        });
      }
    }
  });
export type LongWorldbuildingFileProposalPayload = z.infer<
  typeof LongWorldbuildingFileProposalPayloadSchema
>;

export const LONG_CHARACTER_DOCUMENTS = [
  "core_profile",
  "relationships",
  "current_state",
  "history"
] as const;
export const LongCharacterDocumentSchema = z.enum(LONG_CHARACTER_DOCUMENTS);
export type LongCharacterDocument = z.infer<typeof LongCharacterDocumentSchema>;

/** Stage-level overview is proposed alongside character file changes. */
export const LONG_CHARACTER_OVERVIEW_CHANGE_ID = "characters_overview" as const;
export const LONG_CHARACTER_FILE_CHANGE_DOCUMENTS = [
  ...LONG_CHARACTER_DOCUMENTS,
  "overview"
] as const;
export const LongCharacterFileChangeDocumentSchema = z.enum(
  LONG_CHARACTER_FILE_CHANGE_DOCUMENTS
);
export type LongCharacterFileChangeDocument = z.infer<
  typeof LongCharacterFileChangeDocumentSchema
>;

export const LongCharacterFileChangeSchema = z
  .object({
    characterId: z.string().trim().min(3).max(160),
    characterName: z.string().trim().min(1).max(256),
    document: LongCharacterFileChangeDocumentSchema,
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000),
    beforeRevision: LongFileRevisionSchema.nullable(),
    nextRevision: LongFileRevisionSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.document === "overview") {
      if (value.characterId !== LONG_CHARACTER_OVERVIEW_CHANGE_ID) {
        context.addIssue({
          code: "custom",
          path: ["characterId"],
          message:
            "Character overview changes must use the stage-level overview id."
        });
      }
      return;
    }
    if (value.characterId === LONG_CHARACTER_OVERVIEW_CHANGE_ID) {
      context.addIssue({
        code: "custom",
        path: ["characterId"],
        message:
          "Stage-level overview id is reserved for character overview changes."
      });
    }
  });
export type LongCharacterFileChange = z.infer<
  typeof LongCharacterFileChangeSchema
>;

export const LongCharacterFileProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    baseProjectRevision: z.number().int().nonnegative(),
    files: z.array(LongCharacterFileChangeSchema).min(1).max(100)
  }).superRefine((value, context) => {
    const fileIds = new Set(value.files.map(({ fileId }) => fileId));
    if (fileIds.size !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Character file proposals must target unique files."
      });
    }
    const proposedFileIds = new Set(
      value.batch.documentWrites.map(({ fileId }) => fileId)
    );
    for (const [index, file] of value.files.entries()) {
      if (file.operation !== "create" && !proposedFileIds.has(file.fileId)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "fileId"],
          message:
            "Character write and edit changes must have a document write proposal."
        });
      }
      if (file.operation === "create" && file.beforeRevision !== null) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "beforeRevision"],
          message: "Created character files cannot have a prior revision."
        });
      }
    }
  });
export type LongCharacterFileProposalPayload = z.infer<
  typeof LongCharacterFileProposalPayloadSchema
>;

export const LONG_CONTINUITY_FILE_ROLES = [
  "foreshadowing_changes",
  "world_reveals",
  "character_current_state",
  "character_history",
  "chapter_end_state",
  "handoff"
] as const;
export const LongContinuityFileRoleSchema = z.enum(LONG_CONTINUITY_FILE_ROLES);
export type LongContinuityFileRole = z.infer<
  typeof LongContinuityFileRoleSchema
>;

export const LongContinuityFileChangeSchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    role: LongContinuityFileRoleSchema,
    characterId: LongCharacterIdSchema.nullable().default(null),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000),
    beforeRevision: LongFileRevisionSchema.nullable(),
    nextRevision: LongFileRevisionSchema
  })
  .strict()
  .superRefine((file, context) => {
    const isCharacterRole =
      file.role === "character_current_state" ||
      file.role === "character_history";
    if (isCharacterRole !== (file.characterId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["characterId"],
        message: "Only character continuity roles may carry a character id."
      });
    }
    if ((file.operation === "create") !== (file.beforeRevision === null)) {
      context.addIssue({
        code: "custom",
        path: ["beforeRevision"],
        message:
          "Created continuity files require a null prior revision; writes and edits require one."
      });
    }
  });
export type LongContinuityFileChange = z.infer<
  typeof LongContinuityFileChangeSchema
>;

export const LongContinuityFileProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    baseProjectRevision: z.number().int().nonnegative(),
    files: z.array(LongContinuityFileChangeSchema).min(1).max(1_024)
  }).superRefine((value, context) => {
    if (value.agentId !== "continuity_ledger") {
      context.addIssue({
        code: "custom",
        path: ["agentId"],
        message:
          "Continuity file proposals must be authored by the continuity ledger agent."
      });
    }
    const fileIds = new Set(value.files.map(({ fileId }) => fileId));
    if (fileIds.size !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Continuity file proposals must target unique files."
      });
    }
    const createdTargets = new Map<
      string,
      {
        chapterCardId: string;
        role: LongContinuityFileRole;
        characterId: string | null;
        filePath: string;
        revision: string;
      }
    >();
    const addCreatedTarget = (
      target: {
        chapterCardId: string;
        role: LongContinuityFileRole;
        characterId: string | null;
        fileId: string;
        filePath: string;
        revision: string;
      },
      operationIndex: number
    ): void => {
      if (createdTargets.has(target.fileId)) {
        context.addIssue({
          code: "custom",
          path: ["batch", "operations", operationIndex],
          message:
            "Continuity file proposals cannot create the same file twice."
        });
        return;
      }
      createdTargets.set(target.fileId, target);
    };
    value.batch.operations.forEach((operation, operationIndex) => {
      if (operation.type === "chapterContinuity.worldReveals.create") {
        addCreatedTarget(
          {
            chapterCardId: operation.chapterCardId,
            role: "world_reveals",
            characterId: null,
            fileId: operation.file.id,
            filePath: operation.file.path,
            revision: operation.file.revision
          },
          operationIndex
        );
        return;
      }
      if (operation.type === "chapterContinuity.character.create") {
        addCreatedTarget(
          {
            chapterCardId: operation.chapterCardId,
            role: "character_current_state",
            characterId: operation.characterId,
            fileId: operation.currentState.id,
            filePath: operation.currentState.path,
            revision: operation.currentState.revision
          },
          operationIndex
        );
        addCreatedTarget(
          {
            chapterCardId: operation.chapterCardId,
            role: "character_history",
            characterId: operation.characterId,
            fileId: operation.history.id,
            filePath: operation.history.path,
            revision: operation.history.revision
          },
          operationIndex
        );
        return;
      }
      context.addIssue({
        code: "custom",
        path: ["batch", "operations", operationIndex, "type"],
        message:
          "Continuity file proposals may only create chapter continuity files."
      });
    });
    if (value.batch.documentWrites.length !== value.files.length) {
      context.addIssue({
        code: "custom",
        path: ["batch", "documentWrites"],
        message:
          "Continuity file proposals require exactly one document write per file change."
      });
    }
    for (const [index, file] of value.files.entries()) {
      const write = value.batch.documentWrites.find(
        ({ fileId }) => fileId === file.fileId
      );
      const modeMatches =
        file.operation === "create"
          ? write?.mode === "create" && write.expectedRevision === null
          : write?.mode !== "create" &&
            write?.expectedRevision === file.beforeRevision;
      const createdTarget = createdTargets.get(file.fileId);
      if (
        !write ||
        !modeMatches ||
        write.content !== file.afterText ||
        write.nextRevision !== file.nextRevision
      ) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "fileId"],
          message:
            "Each continuity file change must match its document write and revisions."
        });
      }
      if (file.operation === "create") {
        if (
          !createdTarget ||
          createdTarget.chapterCardId !== file.chapterCardId ||
          createdTarget.role !== file.role ||
          createdTarget.characterId !== file.characterId ||
          createdTarget.filePath !== file.filePath ||
          createdTarget.revision !== file.nextRevision ||
          file.beforeText !== ""
        ) {
          context.addIssue({
            code: "custom",
            path: ["files", index],
            message:
              "Created continuity file metadata must match its chapter operation and start empty."
          });
        }
      } else if (createdTarget) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "operation"],
          message:
            "A newly created continuity file must be displayed as a create operation."
        });
      }
    }
    for (const fileId of createdTargets.keys()) {
      if (!fileIds.has(fileId)) {
        context.addIssue({
          code: "custom",
          path: ["batch", "operations"],
          message:
            "Every created continuity file must have a matching displayed file change."
        });
      }
    }
  });
export type LongContinuityFileProposalPayload = z.infer<
  typeof LongContinuityFileProposalPayloadSchema
>;

export const LongChapterBodyChangeSchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    chapterTitle: z.string().trim().min(1).max(256),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(10_000_000),
    afterText: z.string().max(10_000_000),
    beforeRevision: LongFileRevisionSchema,
    nextRevision: LongFileRevisionSchema
  })
  .strict();
export type LongChapterBodyChange = z.infer<typeof LongChapterBodyChangeSchema>;

export const LongChapterWriteProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    batch: LongWorkspaceOperationBatchSchema,
    baseProjectRevision: z.number().int().nonnegative(),
    file: LongChapterBodyChangeSchema
  }).superRefine((value, context) => {
    const documentWrite = value.batch.documentWrites.find(
      ({ fileId }) => fileId === value.file.fileId
    );
    if (
      value.batch.operations.length !== 0 ||
      value.batch.documentWrites.length !== 1 ||
      !documentWrite ||
      documentWrite.mode !== "replace" ||
      documentWrite.expectedRevision !== value.file.beforeRevision ||
      documentWrite.nextRevision !== value.file.nextRevision ||
      documentWrite.content !== value.file.afterText
    ) {
      context.addIssue({
        code: "custom",
        path: ["batch", "documentWrites"],
        message:
          "Chapter proposals must contain exactly one matching body document write."
      });
    }
  });
export type LongChapterWriteProposalPayload = z.infer<
  typeof LongChapterWriteProposalPayloadSchema
>;

export const LongLedgerCommitProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    input: LongCommitChapterInputSchema
  }).superRefine((value, context) => {
    if (value.input.bookId !== value.bookId) {
      context.addIssue({
        code: "custom",
        path: ["input", "bookId"],
        message: "Ledger proposal input must belong to the proposal book."
      });
    }
  });
export type LongLedgerCommitProposalPayload = z.infer<
  typeof LongLedgerCommitProposalPayloadSchema
>;

export const LongWritingScopeSchema = z.enum(["chapter", "arc", "volume"]);
export type LongWritingScope = z.infer<typeof LongWritingScopeSchema>;

export const LongChapterTripletRoleSchema = z.enum([
  "body",
  "character_state",
  "handoff"
]);
export type LongChapterTripletRole = z.infer<
  typeof LongChapterTripletRoleSchema
>;

export const LongChapterReadinessStatusSchema = z.enum([
  "empty",
  "partial",
  "ready_to_commit"
]);
export type LongChapterReadinessStatus = z.infer<
  typeof LongChapterReadinessStatusSchema
>;

export const LongChapterReadinessSchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    title: z.string().trim().min(1).max(256),
    status: LongChapterReadinessStatusSchema,
    missingFiles: z.array(LongChapterTripletRoleSchema).max(3)
  })
  .strict()
  .superRefine((value, context) => {
    const uniqueMissing = new Set(value.missingFiles);
    if (uniqueMissing.size !== value.missingFiles.length) {
      context.addIssue({
        code: "custom",
        path: ["missingFiles"],
        message: "Chapter readiness cannot repeat a missing triplet file."
      });
    }
    const expectedStatus =
      value.missingFiles.length === 0
        ? "ready_to_commit"
        : value.missingFiles.includes("body")
          ? "empty"
          : "partial";
    if (value.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Chapter readiness status must match the missing body evidence or legacy output files."
      });
    }
  });
export type LongChapterReadiness = z.infer<typeof LongChapterReadinessSchema>;

export const LongChapterDispatchProposalPayloadSchema =
  LongProposalBasePayloadSchema.extend({
    scope: LongWritingScopeSchema,
    chapterCardId: LongChapterCardIdSchema,
    title: z.string().trim().min(1).max(256),
    chapters: z.array(LongChapterReadinessSchema).min(1).max(100_000),
    workspaceRevision: z.number().int().nonnegative(),
    projectRevision: z.number().int().nonnegative()
  }).superRefine((value, context) => {
    const chapterIds = value.chapters.map(({ chapterCardId }) => chapterCardId);
    if (new Set(chapterIds).size !== chapterIds.length) {
      context.addIssue({
        code: "custom",
        path: ["chapters"],
        message: "A chapter dispatch plan cannot repeat a chapter."
      });
    }
    if (
      value.chapters[0]?.chapterCardId !== value.chapterCardId ||
      value.chapters[0]?.title !== value.title
    ) {
      context.addIssue({
        code: "custom",
        path: ["chapters", 0],
        message:
          "Dispatch summary chapter must match the first scheduled chapter."
      });
    }
  });
export type LongChapterDispatchProposalPayload = z.infer<
  typeof LongChapterDispatchProposalPayloadSchema
>;
