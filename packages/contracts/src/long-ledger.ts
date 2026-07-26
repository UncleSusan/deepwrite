import { z } from "zod";
import {
  LongBookIdSchema,
  LongChapterCardIdSchema,
  LongExecutionStatusSchema,
  LongFileIdSchema,
  LongFileRevisionSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingIdSchema,
  LongForeshadowingStatusSchema,
  LongLedgerCommitIdSchema,
  LongNarrativePlacementIdSchema,
  LongProjectRelativePathSchema
} from "./long-workspace";

const LedgerTimestampSchema = z.string().datetime();
const LedgerRevisionSchema = z.number().int().nonnegative();
const LedgerContentSchema = z.string().max(16 * 1024 * 1024);
const LedgerCommitMessageSchema = z.string().trim().max(4_000);
const LedgerSummaryTextSchema = z.string().trim().max(200_000);
const LedgerEvidenceNoteSchema = z.string().trim().max(4_000);
const RequiredLedgerCommitMessageSchema =
  LedgerCommitMessageSchema.min(1);
const RequiredLedgerSummaryTextSchema = LedgerSummaryTextSchema.min(1);
const RequiredLedgerEvidenceNoteSchema = LedgerEvidenceNoteSchema.min(1);

export const LongChapterSummarySchema = z
  .object({
    timeline: LedgerSummaryTextSchema,
    characterStates: LedgerSummaryTextSchema,
    factionStates: LedgerSummaryTextSchema,
    realmStates: LedgerSummaryTextSchema,
    foreshadowingStates: LedgerSummaryTextSchema,
    continuityNotes: LedgerSummaryTextSchema
  })
  .strict();
export type LongChapterSummary = z.infer<
  typeof LongChapterSummarySchema
>;

const EMPTY_LONG_CHAPTER_SUMMARY: LongChapterSummary = {
  timeline: "",
  characterStates: "",
  factionStates: "",
  realmStates: "",
  foreshadowingStates: "",
  continuityNotes: ""
};

export const LongRequiredChapterSummarySchema = z
  .object({
    timeline: RequiredLedgerSummaryTextSchema,
    characterStates: RequiredLedgerSummaryTextSchema,
    factionStates: RequiredLedgerSummaryTextSchema,
    realmStates: RequiredLedgerSummaryTextSchema,
    foreshadowingStates: RequiredLedgerSummaryTextSchema,
    continuityNotes: RequiredLedgerSummaryTextSchema
  })
  .strict();

export const LongLedgerExecutionDecisionSchema = z
  .object({
    status: LongExecutionStatusSchema,
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict();
export type LongLedgerExecutionDecision = z.infer<
  typeof LongLedgerExecutionDecisionSchema
>;

export const LongLedgerPlacementChangeSchema = z
  .object({
    placementId: LongNarrativePlacementIdSchema,
    before: LongLedgerExecutionDecisionSchema,
    after: LongLedgerExecutionDecisionSchema,
    note: LedgerEvidenceNoteSchema.default("")
  })
  .strict();
export type LongLedgerPlacementChange = z.infer<
  typeof LongLedgerPlacementChangeSchema
>;

export const LongLedgerForeshadowingBeatChangeSchema = z
  .object({
    beatId: LongForeshadowingBeatIdSchema,
    before: LongLedgerExecutionDecisionSchema,
    after: LongLedgerExecutionDecisionSchema,
    note: LedgerEvidenceNoteSchema.default("")
  })
  .strict();
export type LongLedgerForeshadowingBeatChange = z.infer<
  typeof LongLedgerForeshadowingBeatChangeSchema
>;

export const LongLedgerForeshadowingThreadChangeSchema = z
  .object({
    foreshadowingId: LongForeshadowingIdSchema,
    before: LongForeshadowingStatusSchema,
    after: LongForeshadowingStatusSchema
  })
  .strict();
export type LongLedgerForeshadowingThreadChange = z.infer<
  typeof LongLedgerForeshadowingThreadChangeSchema
>;

export const LongLedgerFileStateSchema = z
  .object({
    revision: LongFileRevisionSchema,
    content: LedgerContentSchema
  })
  .strict();
export type LongLedgerFileState = z.infer<
  typeof LongLedgerFileStateSchema
>;

export const LongLedgerFileChangeSchema = z
  .object({
    fileId: LongFileIdSchema,
    path: LongProjectRelativePathSchema,
    mode: z.enum(["replace", "append"]).default("replace"),
    before: LongLedgerFileStateSchema,
    after: LongLedgerFileStateSchema
  })
  .strict();
export type LongLedgerFileChange = z.infer<
  typeof LongLedgerFileChangeSchema
>;

/**
 * The record contains the exact before/after values needed for deterministic
 * last-commit rollback. It is an audit record, not an alternate workspace
 * index, so unrelated structure is never duplicated.
 */
export const LongLedgerCommitRecordSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    id: LongLedgerCommitIdSchema,
    bookId: LongBookIdSchema,
    sequence: z.number().int().positive(),
    chapterCardId: LongChapterCardIdSchema,
    committedAt: LedgerTimestampSchema,
    /**
     * Defaults preserve compatibility with schemaVersion 1 records written
     * before continuity summaries became part of the permanent audit trail.
     */
    commitMessage: LedgerCommitMessageSchema.default(""),
    chapterSummary: LongChapterSummarySchema.default(
      EMPTY_LONG_CHAPTER_SUMMARY
    ),
    reversible: z.boolean(),
    sourceWorkspaceRevision: LedgerRevisionSchema,
    committedWorkspaceRevision: LedgerRevisionSchema,
    sourceProjectRevision: LedgerRevisionSchema,
    committedProjectRevision: LedgerRevisionSchema,
    previousCommittedThroughChapterId:
      LongChapterCardIdSchema.nullable(),
    committedThroughChapterId: LongChapterCardIdSchema,
    previousChapterCommitId: LongLedgerCommitIdSchema.nullable(),
    placementChanges: z
      .array(LongLedgerPlacementChangeSchema)
      .max(100_000),
    foreshadowingBeatChanges: z
      .array(LongLedgerForeshadowingBeatChangeSchema)
      .max(100_000),
    foreshadowingThreadChanges: z
      .array(LongLedgerForeshadowingThreadChangeSchema)
      .max(100_000)
      .default([]),
    fileChanges: z.array(LongLedgerFileChangeSchema).max(1_024)
  })
  .strict()
  .superRefine((record, context) => {
    if (record.schemaVersion === 2) {
      if (record.commitMessage.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["commitMessage"],
          message: "A current ledger record requires a non-empty commit message."
        });
      }
      for (const key of Object.keys(
        record.chapterSummary
      ) as Array<keyof LongChapterSummary>) {
        if (record.chapterSummary[key].length === 0) {
          context.addIssue({
            code: "custom",
            path: ["chapterSummary", key],
            message:
              "A current ledger record requires all six continuity summaries."
          });
        }
      }
      for (const [index, change] of record.placementChanges.entries()) {
        if (change.note.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["placementChanges", index, "note"],
            message:
              "A current ledger placement decision requires an evidence note."
          });
        }
      }
      for (const [
        index,
        change
      ] of record.foreshadowingBeatChanges.entries()) {
        if (change.note.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["foreshadowingBeatChanges", index, "note"],
            message:
              "A current ledger beat decision requires an evidence note."
          });
        }
      }
    }
    if (
      record.committedWorkspaceRevision !==
      record.sourceWorkspaceRevision + 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["committedWorkspaceRevision"],
        message: "A ledger commit must advance the workspace revision once."
      });
    }
    if (
      record.committedProjectRevision !==
      record.sourceProjectRevision + 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["committedProjectRevision"],
        message: "A ledger commit must advance the project revision once."
      });
    }
    for (const [index, change] of record.placementChanges.entries()) {
      if (
        change.after.commitId !== record.id ||
        (change.after.status !== "committed" &&
          change.after.status !== "missed")
      ) {
        context.addIssue({
          code: "custom",
          path: ["placementChanges", index, "after"],
          message:
            "Committed placement decisions must reference this ledger commit."
        });
      }
    }
    const placementIds = record.placementChanges.map(
      ({ placementId }) => placementId
    );
    if (new Set(placementIds).size !== placementIds.length) {
      context.addIssue({
        code: "custom",
        path: ["placementChanges"],
        message: "A ledger record cannot decide the same placement twice."
      });
    }
    for (const [index, change] of record.foreshadowingBeatChanges.entries()) {
      if (
        change.after.commitId !== record.id ||
        (change.after.status !== "committed" &&
          change.after.status !== "missed")
      ) {
        context.addIssue({
          code: "custom",
          path: ["foreshadowingBeatChanges", index, "after"],
          message:
            "Committed foreshadowing decisions must reference this ledger commit."
        });
      }
    }
    const beatIds = record.foreshadowingBeatChanges.map(
      ({ beatId }) => beatId
    );
    if (new Set(beatIds).size !== beatIds.length) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingBeatChanges"],
        message:
          "A ledger record cannot decide the same foreshadowing beat twice."
      });
    }
    const changedThreadIds = record.foreshadowingThreadChanges.map(
      ({ foreshadowingId }) => foreshadowingId
    );
    if (new Set(changedThreadIds).size !== changedThreadIds.length) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingThreadChanges"],
        message:
          "A ledger record cannot change the same foreshadowing thread twice."
      });
    }
    const fileIds = record.fileChanges.map(({ fileId }) => fileId);
    if (new Set(fileIds).size !== fileIds.length) {
      context.addIssue({
        code: "custom",
        path: ["fileChanges"],
        message: "A ledger record cannot change the same file twice."
      });
    }
    const contentCharacters = record.fileChanges.reduce(
      (total, change) =>
        total + change.before.content.length + change.after.content.length,
      0
    );
    if (contentCharacters > 64 * 1024 * 1024) {
      context.addIssue({
        code: "custom",
        path: ["fileChanges"],
        message: "Ledger rollback content exceeds the 64 MiB safety budget."
      });
    }
  });
export type LongLedgerCommitRecord = z.infer<
  typeof LongLedgerCommitRecordSchema
>;

export const LongChapterFileWriteSchema = z
  .object({
    content: LedgerContentSchema,
    baseRevision: LongFileRevisionSchema
  })
  .strict();
export type LongChapterFileWrite = z.infer<
  typeof LongChapterFileWriteSchema
>;

export const LongWriteChapterInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    body: LongChapterFileWriteSchema,
    characterState: LongChapterFileWriteSchema,
    handoff: LongChapterFileWriteSchema,
    baseWorkspaceRevision: LedgerRevisionSchema,
    baseProjectRevision: LedgerRevisionSchema
  })
  .strict();
export type LongWriteChapterInput = z.infer<
  typeof LongWriteChapterInputSchema
>;

export const LongWriteChapterResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    bodyRevision: LongFileRevisionSchema,
    characterStateRevision: LongFileRevisionSchema,
    handoffRevision: LongFileRevisionSchema,
    workspaceRevision: LedgerRevisionSchema,
    projectRevision: LedgerRevisionSchema
  })
  .strict();
export type LongWriteChapterResult = z.infer<
  typeof LongWriteChapterResultSchema
>;

export const LongCommitExecutionDecisionInputSchema = z
  .object({
    status: z.enum(["committed", "missed"]),
    note: RequiredLedgerEvidenceNoteSchema
  })
  .strict();

export const LongChapterFileRevisionSnapshotSchema = z
  .object({
    body: LongFileRevisionSchema,
    characterState: LongFileRevisionSchema,
    handoff: LongFileRevisionSchema
  })
  .strict();
export type LongChapterFileRevisionSnapshot = z.infer<
  typeof LongChapterFileRevisionSnapshotSchema
>;

export const LongCommitChapterInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    chapterFileRevisions: LongChapterFileRevisionSnapshotSchema,
    commitMessage: RequiredLedgerCommitMessageSchema,
    chapterSummary: LongRequiredChapterSummarySchema,
    placementDecisions: z
      .record(
        LongNarrativePlacementIdSchema,
        LongCommitExecutionDecisionInputSchema
      )
      .default({}),
    foreshadowingBeatDecisions: z
      .record(
        LongForeshadowingBeatIdSchema,
        LongCommitExecutionDecisionInputSchema
      )
      .default({}),
    fileUpdates: z
      .array(
        z
          .object({
            fileId: LongFileIdSchema,
            content: LedgerContentSchema,
            baseRevision: LongFileRevisionSchema,
            mode: z.enum(["replace", "append"]).default("replace")
          })
          .strict()
      )
      .max(1_024)
      .default([]),
    baseWorkspaceRevision: LedgerRevisionSchema,
    baseProjectRevision: LedgerRevisionSchema
  })
  .strict();
export type LongCommitChapterInput = z.infer<
  typeof LongCommitChapterInputSchema
>;

export const LongCommitChapterResultSchema = z
  .object({
    record: LongLedgerCommitRecordSchema,
    workspaceRevision: LedgerRevisionSchema,
    projectRevision: LedgerRevisionSchema
  })
  .strict();
export type LongCommitChapterResult = z.infer<
  typeof LongCommitChapterResultSchema
>;

export const LongRollbackLastCommitInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    expectedCommitId: LongLedgerCommitIdSchema,
    baseWorkspaceRevision: LedgerRevisionSchema,
    baseProjectRevision: LedgerRevisionSchema
  })
  .strict();
export type LongRollbackLastCommitInput = z.infer<
  typeof LongRollbackLastCommitInputSchema
>;

export const LongRollbackLastCommitResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    rolledBackCommitId: LongLedgerCommitIdSchema,
    committedThroughChapterId: LongChapterCardIdSchema.nullable(),
    workspaceRevision: LedgerRevisionSchema,
    projectRevision: LedgerRevisionSchema
  })
  .strict();
export type LongRollbackLastCommitResult = z.infer<
  typeof LongRollbackLastCommitResultSchema
>;
