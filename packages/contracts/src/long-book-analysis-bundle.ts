import { z } from "zod";
import { LongBookAnalysisPresetSchema } from "./long-book-analysis";
import { EnvelopeBaseSchema } from "./envelope";
import {
  LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS,
  LongBookAnalysisTaskSnapshotSchema
} from "./long-book-analysis-task";

function hasCompletePresetSet(items: readonly { id: string }[]): boolean {
  return (
    items.length === LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS.length &&
    LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS.every((id) =>
      items.some((item) => item.id === id)
    )
  );
}

/**
 * Portable output produced by the Linux headless runner. It intentionally
 * contains results and routing metadata only, never the source snapshot or
 * provider credentials.
 */
export const LongBookAnalysisResultBundleSchema = z.object({
  format: z.literal("deepwrite-long-book-analysis"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  runner: z.object({
    version: z.string().trim().min(1).max(120),
    modelId: z.string().trim().min(1).max(512),
    baseUrl: z.string().trim().min(1).max(2_000)
  }),
  task: LongBookAnalysisTaskSnapshotSchema.refine(
    (task) =>
      task.status === "completed" &&
      hasCompletePresetSet(task.items.map((item) => ({ id: item.presetId }))) &&
      task.items.every((item) => item.status === "completed" && item.result),
    "A result package must contain all five completed complete-book analysis items."
  ),
  presets: z
    .array(
      LongBookAnalysisPresetSchema.pick({ id: true, name: true, output: true })
    )
    .length(5)
    .refine(
      (presets) => hasCompletePresetSet(presets),
      "A result package must contain all five complete-book analysis presets."
    )
});
export type LongBookAnalysisResultBundle = z.infer<
  typeof LongBookAnalysisResultBundleSchema
>;

export const LongBookAnalysisChooseResultBundleCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.chooseResultBundle"),
    payload: z.object({})
  });
