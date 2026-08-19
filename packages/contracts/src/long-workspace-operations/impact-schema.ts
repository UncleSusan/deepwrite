import { z } from "zod";
import {
  LongFileIdSchema,
  LongFileRevisionSchema,
  LongProjectRelativePathSchema,
  LongStableIdSchema,
  LongWorkspaceIndexSnapshotSchema
} from "../long-workspace";
import {
  LongProvisionalIdSchema,
  LongWorkspaceOperationSchema
} from "./operation-schema";
import {
  OperationTimestampSchema,
  sortedUniqueIdArray
} from "./schema-helpers";

const DocumentWriteProposalBaseShape = {
  proposalId: z
    .string()
    .trim()
    .min(3)
    .max(160)
    .regex(/^proposal_[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  fileId: LongFileIdSchema,
  content: z.string().max(10_000_000),
  nextRevision: LongFileRevisionSchema,
  updatedAt: OperationTimestampSchema,
  reason: z.string().trim().min(1).max(1_000)
} as const;

export const LongDocumentWriteProposalSchema = z.discriminatedUnion("mode", [
  z
    .object({
      ...DocumentWriteProposalBaseShape,
      mode: z.literal("create"),
      expectedRevision: z.null()
    })
    .strict(),
  z
    .object({
      ...DocumentWriteProposalBaseShape,
      mode: z.enum(["replace", "append"]),
      expectedRevision: LongFileRevisionSchema
    })
    .strict()
]);
export type LongDocumentWriteProposal = z.infer<
  typeof LongDocumentWriteProposalSchema
>;

export const LongWorkspaceImpactSummarySchema = z
  .object({
    createdEntityIds: sortedUniqueIdArray(LongStableIdSchema),
    updatedEntityIds: sortedUniqueIdArray(LongStableIdSchema),
    deletedEntityIds: sortedUniqueIdArray(LongStableIdSchema),
    createdFileIds: sortedUniqueIdArray(LongFileIdSchema),
    deletedFileIds: sortedUniqueIdArray(LongFileIdSchema),
    documentWriteProposalIds: sortedUniqueIdArray(
      z
        .string()
        .trim()
        .min(3)
        .max(160)
        .regex(/^proposal_[A-Za-z0-9][A-Za-z0-9._:-]*$/)
    )
  })
  .strict();
export type LongWorkspaceImpactSummary = z.infer<
  typeof LongWorkspaceImpactSummarySchema
>;

export const LongWorkspaceFileIntentSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      file: z.object({
        id: LongFileIdSchema,
        path: LongProjectRelativePathSchema,
        revision: LongFileRevisionSchema,
        updatedAt: OperationTimestampSchema
      }),
      reason: z.string().trim().min(1).max(1_000)
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      file: z.object({
        id: LongFileIdSchema,
        path: LongProjectRelativePathSchema,
        revision: LongFileRevisionSchema,
        updatedAt: OperationTimestampSchema
      }),
      reason: z.string().trim().min(1).max(1_000)
    })
    .strict()
]);
export type LongWorkspaceFileIntent = z.infer<
  typeof LongWorkspaceFileIntentSchema
>;

export const LONG_WORKSPACE_ENTITY_KINDS = [
  "worldbuilding-category",
  "worldbuilding-item",
  "character",
  "volume",
  "arc",
  "chapter-card",
  "story-event",
  "story-plot",
  "event-connection",
  "narrative-placement",
  "foreshadowing-thread",
  "foreshadowing-beat"
] as const;
export const LongWorkspaceEntityKindSchema = z.enum(
  LONG_WORKSPACE_ENTITY_KINDS
);
export type LongWorkspaceEntityKind = z.infer<
  typeof LongWorkspaceEntityKindSchema
>;

const LongWorkspaceEntitySnapshotSchema = z.record(z.string(), z.json());
export type LongWorkspaceEntitySnapshot = z.infer<
  typeof LongWorkspaceEntitySnapshotSchema
>;
const LongWorkspaceEntityChangeBaseShape = {
  kind: LongWorkspaceEntityKindSchema,
  id: LongStableIdSchema
} as const;

export const LongWorkspaceEntityChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...LongWorkspaceEntityChangeBaseShape,
      action: z.literal("create"),
      before: z.null(),
      after: LongWorkspaceEntitySnapshotSchema
    })
    .strict(),
  z
    .object({
      ...LongWorkspaceEntityChangeBaseShape,
      action: z.literal("update"),
      before: LongWorkspaceEntitySnapshotSchema,
      after: LongWorkspaceEntitySnapshotSchema
    })
    .strict(),
  z
    .object({
      ...LongWorkspaceEntityChangeBaseShape,
      action: z.literal("delete"),
      before: LongWorkspaceEntitySnapshotSchema,
      after: z.null()
    })
    .strict()
]);
export type LongWorkspaceEntityChange = z.infer<
  typeof LongWorkspaceEntityChangeSchema
>;

export const LongWorkspaceOperationBatchSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    updatedAt: OperationTimestampSchema,
    operations: z.array(LongWorkspaceOperationSchema).max(10_000),
    documentWrites: z
      .array(LongDocumentWriteProposalSchema)
      .max(10_000)
      .default([]),
    expectedImpact: LongWorkspaceImpactSummarySchema.optional()
  })
  .strict()
  .superRefine((batch, context) => {
    if (batch.operations.length === 0 && batch.documentWrites.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message:
          "A long workspace batch must contain an operation or document write."
      });
    }
  });
export type LongWorkspaceOperationBatch = z.infer<
  typeof LongWorkspaceOperationBatchSchema
>;
export type LongWorkspaceOperationBatchInput = z.input<
  typeof LongWorkspaceOperationBatchSchema
>;

export const LongWorkspaceImpactPreviewSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    resultRevision: z.number().int().positive(),
    impact: LongWorkspaceImpactSummarySchema,
    entityChanges: z.array(LongWorkspaceEntityChangeSchema).max(2_000_000),
    fileIntents: z.array(LongWorkspaceFileIntentSchema),
    documentWrites: z.array(LongDocumentWriteProposalSchema),
    provisionalIdMap: z.record(LongProvisionalIdSchema, LongStableIdSchema)
  })
  .strict();
export type LongWorkspaceImpactPreview = z.infer<
  typeof LongWorkspaceImpactPreviewSchema
>;

export const LongWorkspaceOperationResultSchema =
  LongWorkspaceImpactPreviewSchema.extend({
    snapshot: LongWorkspaceIndexSnapshotSchema
  }).strict();
export type LongWorkspaceOperationResult = z.infer<
  typeof LongWorkspaceOperationResultSchema
>;

export const LONG_WORKSPACE_OPERATION_ERROR_CODES = [
  "revision_conflict",
  "not_found",
  "already_exists",
  "invalid_reference",
  "cascade_required",
  "cascade_impact_mismatch",
  "committed_prefix_protected",
  "invalid_order",
  "invalid_document_write",
  "invalid_result"
] as const;
export const LongWorkspaceOperationErrorCodeSchema = z.enum(
  LONG_WORKSPACE_OPERATION_ERROR_CODES
);
export type LongWorkspaceOperationErrorCode = z.infer<
  typeof LongWorkspaceOperationErrorCodeSchema
>;

export class LongWorkspaceOperationError extends Error {
  readonly code: LongWorkspaceOperationErrorCode;

  constructor(code: LongWorkspaceOperationErrorCode, message: string) {
    super(message);
    this.name = "LongWorkspaceOperationError";
    this.code = code;
  }
}
