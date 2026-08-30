import { z } from "zod";
import {
  MaterialKindSchema,
  MaterialStageIdSchema,
  SkillKindSchema,
  SkillStageIdSchema
} from "./catalog";
import { EnvelopeBaseSchema } from "./envelope";

export const LONG_BOOK_ANALYSIS_MAX_PRESETS = 50;
export const LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS = 50;
export const LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS = 10_000;
export const LONG_BOOK_ANALYSIS_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const LONG_BOOK_ANALYSIS_MAX_DIRECTORY_BYTES = 100 * 1024 * 1024;
export const LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS = 50_000_000;
export const LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS = 10_000_000;
export const LONG_BOOK_ANALYSIS_MAX_PROMPT_CHARACTERS = 200_000;
export const LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS = 12_000;
export const LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS = 200_000;
export const LONG_BOOK_ANALYSIS_DEFAULT_CONTEXT_WINDOW = 272_000;

const LongBookAnalysisIdSchema = z.string().trim().min(1).max(120);
const LongBookAnalysisTitleSchema = z.string().trim().min(1).max(256);

export const LongBookAnalysisOutputSchema = z.discriminatedUnion("domain", [
  z.object({
    domain: z.literal("material"),
    kind: MaterialKindSchema,
    stageId: MaterialStageIdSchema
  }),
  z.object({
    domain: z.literal("skill"),
    kind: SkillKindSchema,
    stageId: SkillStageIdSchema
  })
]);
export type LongBookAnalysisOutput = z.infer<
  typeof LongBookAnalysisOutputSchema
>;

export const LongBookAnalysisPresetSchema = z.object({
  id: LongBookAnalysisIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  systemPrompt: z
    .string()
    .trim()
    .min(1)
    .max(LONG_BOOK_ANALYSIS_MAX_PROMPT_CHARACTERS),
  output: LongBookAnalysisOutputSchema,
  builtin: z.boolean().optional()
});
export type LongBookAnalysisPreset = z.infer<
  typeof LongBookAnalysisPresetSchema
>;

function validatePresetList(
  presets: readonly LongBookAnalysisPreset[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  presets.forEach((preset, index) => {
    if (ids.has(preset.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: "Long-book analysis preset ids must be unique."
      });
    }
    ids.add(preset.id);
    const comparableName = preset.name.trim().toLocaleLowerCase("zh-CN");
    if (names.has(comparableName)) {
      context.addIssue({
        code: "custom",
        path: [index, "name"],
        message: "Long-book analysis preset names must be unique."
      });
    }
    names.add(comparableName);
  });
}

export const LongBookAnalysisSettingsInputSchema = z
  .object({
    presets: z
      .array(LongBookAnalysisPresetSchema.omit({ builtin: true }))
      .max(LONG_BOOK_ANALYSIS_MAX_PRESETS)
  })
  .superRefine((value, context) => validatePresetList(value.presets, context));
export type LongBookAnalysisSettingsInput = z.infer<
  typeof LongBookAnalysisSettingsInputSchema
>;

export const LongBookAnalysisSettingsSchema = z
  .object({
    presets: z
      .array(LongBookAnalysisPresetSchema)
      .max(LONG_BOOK_ANALYSIS_MAX_PRESETS),
    updatedAt: z.string().datetime().optional()
  })
  .superRefine((value, context) => validatePresetList(value.presets, context));
export type LongBookAnalysisSettings = z.infer<
  typeof LongBookAnalysisSettingsSchema
>;

export const LongBookAnalysisAgentProfileSchema =
  LongBookAnalysisPresetSchema.pick({
    id: true,
    name: true,
    description: true,
    systemPrompt: true,
    output: true
  });
export type LongBookAnalysisAgentProfile = z.infer<
  typeof LongBookAnalysisAgentProfileSchema
>;

export const LongBookAnalysisChapterSchema = z.object({
  id: LongBookAnalysisIdSchema,
  order: z.number().int().min(1).max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  title: LongBookAnalysisTitleSchema,
  volume: z.string().trim().min(1).max(256).optional(),
  sourceName: z.string().trim().min(1).max(1_024),
  text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS),
  charCount: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS)
});
export type LongBookAnalysisChapter = z.infer<
  typeof LongBookAnalysisChapterSchema
>;

export const LongBookAnalysisDiagnosticSchema = z.object({
  code: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1_000),
  sourceName: z.string().trim().min(1).max(1_024).optional()
});
export type LongBookAnalysisDiagnostic = z.infer<
  typeof LongBookAnalysisDiagnosticSchema
>;

export const LongBookAnalysisSourceSchema = z
  .object({
    id: LongBookAnalysisIdSchema,
    kind: z.enum(["txt", "directory"]),
    name: z.string().trim().min(1).max(1_024),
    chapters: z
      .array(LongBookAnalysisChapterSchema)
      .min(1)
      .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
    diagnostics: z.array(LongBookAnalysisDiagnosticSchema).max(1_000)
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    let totalCharacters = 0;
    value.chapters.forEach((chapter, index) => {
      if (ids.has(chapter.id)) {
        context.addIssue({
          code: "custom",
          path: ["chapters", index, "id"],
          message: "Long-book analysis chapter ids must be unique."
        });
      }
      ids.add(chapter.id);
      if (chapter.order !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["chapters", index, "order"],
          message: "Long-book analysis chapter order must be contiguous."
        });
      }
      totalCharacters += chapter.text.length;
    });
    if (totalCharacters > LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["chapters"],
        message: "Long-book analysis source exceeds the total character limit."
      });
    }
  });
export type LongBookAnalysisSource = z.infer<
  typeof LongBookAnalysisSourceSchema
>;

export const LongBookAnalysisSourceKindSchema = z.enum(["txt", "directory"]);
export type LongBookAnalysisSourceKind = z.infer<
  typeof LongBookAnalysisSourceKindSchema
>;

export const LongBookAnalysisSegmentSchema = z.object({
  id: LongBookAnalysisIdSchema,
  chapterId: LongBookAnalysisIdSchema,
  chapterOrder: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  chapterTitle: LongBookAnalysisTitleSchema,
  volume: z.string().trim().min(1).max(256).optional(),
  segmentIndex: z.number().int().positive(),
  segmentCount: z.number().int().positive(),
  text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS)
});
export type LongBookAnalysisSegment = z.infer<
  typeof LongBookAnalysisSegmentSchema
>;

export const LongBookAnalysisNoteSchema = z
  .object({
    id: LongBookAnalysisIdSchema,
    label: z.string().trim().min(1).max(256),
    chapterStart: z
      .number()
      .int()
      .positive()
      .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
    chapterEnd: z
      .number()
      .int()
      .positive()
      .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
    text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS)
  })
  .superRefine((value, context) => {
    if (value.chapterEnd < value.chapterStart) {
      context.addIssue({
        code: "custom",
        path: ["chapterEnd"],
        message: "Analysis note chapterEnd must not precede chapterStart."
      });
    }
  });
export type LongBookAnalysisNote = z.infer<typeof LongBookAnalysisNoteSchema>;

const RuntimeBaseSchema = z.object({
  jobId: LongBookAnalysisIdSchema,
  unitId: LongBookAnalysisIdSchema,
  presetId: LongBookAnalysisIdSchema,
  sourceTitle: z.string().trim().min(1).max(1_024),
  selectionStart: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS),
  selectionEnd: z
    .number()
    .int()
    .positive()
    .max(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS)
});

export const LongBookAnalysisRuntimeContextSchema = z
  .discriminatedUnion("phase", [
    RuntimeBaseSchema.extend({
      phase: z.literal("batch"),
      segments: z.array(LongBookAnalysisSegmentSchema).min(1).max(100)
    }),
    RuntimeBaseSchema.extend({
      phase: z.literal("reduce"),
      notes: z.array(LongBookAnalysisNoteSchema).min(2).max(100)
    }),
    RuntimeBaseSchema.extend({
      phase: z.literal("final"),
      notes: z.array(LongBookAnalysisNoteSchema).min(1).max(100)
    })
  ])
  .superRefine((value, context) => {
    if (value.selectionEnd < value.selectionStart) {
      context.addIssue({
        code: "custom",
        path: ["selectionEnd"],
        message: "Analysis selectionEnd must not precede selectionStart."
      });
    }
    if (
      value.selectionEnd - value.selectionStart + 1 >
      LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectionEnd"],
        message: "Long-book analysis may include at most 50 chapters."
      });
    }
  });
export type LongBookAnalysisRuntimeContext = z.infer<
  typeof LongBookAnalysisRuntimeContextSchema
>;

export const LongBookAnalysisResultSchema = z.object({
  title: LongBookAnalysisTitleSchema,
  body: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS)
});
export type LongBookAnalysisResult = z.infer<
  typeof LongBookAnalysisResultSchema
>;

export const LongBookAnalysisNoteWriteSchema = z.object({
  text: z.string().trim().min(1).max(LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS)
});
export type LongBookAnalysisNoteWrite = z.infer<
  typeof LongBookAnalysisNoteWriteSchema
>;

export const LongBookAnalysisChooseSourceCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysis.chooseSource"),
    payload: z.object({ kind: LongBookAnalysisSourceKindSchema })
  });

export const LongBookAnalysisSettingsListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisSettings.list"),
    payload: z.object({})
  });

export const LongBookAnalysisSettingsSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisSettings.save"),
    payload: LongBookAnalysisSettingsInputSchema
  });

export const LongBookAnalysisSettingsResetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("longBookAnalysisSettings.reset"),
    payload: z.object({ presetId: LongBookAnalysisIdSchema.optional() })
  });
