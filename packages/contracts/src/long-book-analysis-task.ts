import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS,
  LongBookAnalysisNoteSchema,
  LongBookAnalysisResultSchema,
  LongBookAnalysisSavedSourceIdSchema
} from "./long-book-analysis";
import { TemperatureSchema, ThinkingLevelSchema } from "./models";

export const LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS = [
  "plot-structure",
  "character",
  "story-bible",
  "method-distillation",
  "style"
] as const;

export const LongBookAnalysisScopeModeSchema = z.enum([
  "opening",
  "sampled",
  "full"
]);
export type LongBookAnalysisScopeMode = z.infer<
  typeof LongBookAnalysisScopeModeSchema
>;

export const LongBookAnalysisTaskStatusSchema = z.enum([
  "pending",
  "running",
  "stopping",
  "stopped",
  "completed",
  "partial"
]);
export type LongBookAnalysisTaskStatus = z.infer<
  typeof LongBookAnalysisTaskStatusSchema
>;

export const LongBookAnalysisTaskItemStatusSchema = z.enum([
  "pending",
  "running",
  "stopped",
  "completed",
  "error"
]);
export type LongBookAnalysisTaskItemStatus = z.infer<
  typeof LongBookAnalysisTaskItemStatusSchema
>;

export const LongBookAnalysisTaskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9_-]+$/iu);
const ChapterOrdersSchema = z
  .array(
    z.number().int().positive().max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS)
  )
  .min(1)
  .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS)
  .superRefine((orders, context) => {
    if (new Set(orders).size !== orders.length) {
      context.addIssue({
        code: "custom",
        message: "Analysis task chapter orders must be unique."
      });
    }
  });

export const LongBookAnalysisPipelineCheckpointSchema = z.object({
  jobId: LongBookAnalysisTaskIdSchema,
  sourceId: LongBookAnalysisSavedSourceIdSchema,
  sourceTitle: z.string().trim().min(1).max(1_024),
  presetId: z.string().trim().min(1).max(120),
  modelId: z.string().trim().min(1).max(512),
  thinkingLevel: ThinkingLevelSchema,
  temperature: TemperatureSchema.optional(),
  libraryId: z.string().trim().max(512),
  selectedChapterOrders: ChapterOrdersSchema,
  inputBudget: z.number().int().positive(),
  batchIndex: z.number().int().nonnegative(),
  notes: z
    .array(LongBookAnalysisNoteSchema)
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  reductionRounds: z.number().int().nonnegative().max(20),
  reduction: z
    .object({
      groupIndex: z.number().int().nonnegative(),
      output: z
        .array(LongBookAnalysisNoteSchema)
        .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS)
    })
    .optional(),
  phase: z.enum(["batch", "reduce", "final"]),
  completedUnits: z.number().int().nonnegative(),
  estimatedUnits: z.number().int().nonnegative(),
  result: LongBookAnalysisResultSchema.optional(),
  updatedAt: z.string().datetime()
});
export type LongBookAnalysisPipelineCheckpoint = z.infer<
  typeof LongBookAnalysisPipelineCheckpointSchema
>;

export const LongBookAnalysisTaskItemSchema = z.object({
  presetId: z.string().trim().min(1).max(120),
  presetName: z.string().trim().min(1).max(80),
  scopeMode: LongBookAnalysisScopeModeSchema,
  chapterOrders: ChapterOrdersSchema,
  status: LongBookAnalysisTaskItemStatusSchema,
  completedUnits: z.number().int().nonnegative(),
  estimatedUnits: z.number().int().nonnegative(),
  targetLibraryId: z.string().trim().max(512),
  error: z.string().trim().max(2_000).optional(),
  result: LongBookAnalysisResultSchema.optional(),
  checkpoint: LongBookAnalysisPipelineCheckpointSchema.optional()
});
export type LongBookAnalysisTaskItem = z.infer<
  typeof LongBookAnalysisTaskItemSchema
>;

export const LongBookAnalysisTaskSnapshotSchema = z.object({
  version: z.literal(1),
  id: LongBookAnalysisTaskIdSchema,
  sourceId: LongBookAnalysisSavedSourceIdSchema,
  sourceTitle: z.string().trim().min(1).max(1_024),
  scopeMode: LongBookAnalysisScopeModeSchema,
  styleFullText: z.boolean(),
  modelId: z.string().trim().min(1).max(512),
  thinkingLevel: ThinkingLevelSchema,
  temperature: TemperatureSchema.optional(),
  status: LongBookAnalysisTaskStatusSchema,
  activePresetId: z.string().trim().min(1).max(120).optional(),
  items: z.array(LongBookAnalysisTaskItemSchema).length(5),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type LongBookAnalysisTaskSnapshot = z.infer<
  typeof LongBookAnalysisTaskSnapshotSchema
>;

export const LongBookAnalysisTaskCatalogSchema = z.object({
  tasks: z.array(LongBookAnalysisTaskSnapshotSchema).max(20)
});
export type LongBookAnalysisTaskCatalog = z.infer<
  typeof LongBookAnalysisTaskCatalogSchema
>;

export const LongBookAnalysisTasksListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.tasks.list"),
    payload: z.object({})
  });

export const LongBookAnalysisTasksSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.tasks.save"),
    payload: LongBookAnalysisTaskSnapshotSchema
  });

export const LongBookAnalysisTasksDeleteCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.tasks.delete"),
    payload: z.object({ taskId: LongBookAnalysisTaskIdSchema })
  });
