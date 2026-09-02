import {
  LongBookAnalysisPipelineCheckpointSchema,
  type LongBookAnalysisPipelineCheckpoint,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisSource
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import { buildAnalysisSegments, groupAnalysisSegments } from "./batching";
import { createAnalysisReductionState } from "./analysis-reducer";
import type {
  LongBookAnalysisJob,
  LongBookAnalysisPhase,
  LongBookAnalysisPipelineState
} from "./analysis-pipeline-types";

export interface RestoredAnalysisPipeline {
  job: LongBookAnalysisJob;
  phase: LongBookAnalysisPhase;
  completedUnits: number;
  estimatedUnits: number;
  result: LongBookAnalysisResult | null;
}

export function createNewAnalysisJob(input: {
  source: LongBookAnalysisSource;
  preset: LongBookAnalysisPreset;
  modelId: string;
  thinkingLevel: LongBookAnalysisJob["thinkingLevel"];
  temperature?: number;
  libraryId: string;
  startOrder: number;
  endOrder: number;
  chapterOrders?: readonly number[];
  inputBudget: number;
}): LongBookAnalysisJob {
  if (input.endOrder < input.startOrder) {
    throw new Error("结束章节不能早于起始章节。");
  }
  const selectedOrders = input.chapterOrders?.length
    ? [...new Set(input.chapterOrders)].sort((left, right) => left - right)
    : input.source.chapters
        .filter(
          ({ order }) => order >= input.startOrder && order <= input.endOrder
        )
        .map(({ order }) => order);
  const selectedOrderSet = new Set(selectedOrders);
  const chapters = input.source.chapters.filter(({ order }) =>
    selectedOrderSet.has(order)
  );
  if (!chapters.length || chapters.length !== selectedOrders.length) {
    throw new Error("选择范围与当前章节列表不一致，请重新选择。");
  }
  const batches = groupAnalysisSegments(
    buildAnalysisSegments(chapters, input.inputBudget),
    input.inputBudget
  );
  return {
    id: createId("long_book_analysis_job"),
    sourceId: input.source.id,
    sourceTitle: input.source.name,
    preset: input.preset,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
    ...(input.temperature !== undefined
      ? { temperature: input.temperature }
      : {}),
    libraryId: input.libraryId,
    selectionStart: selectedOrders[0]!,
    selectionEnd: selectedOrders.at(-1)!,
    selectedChapterOrders: selectedOrders,
    inputBudget: input.inputBudget,
    batches,
    batchIndex: 0,
    notes: [],
    reductionRounds: 0
  };
}

export function restoreAnalysisPipeline(input: {
  source: LongBookAnalysisSource;
  preset: LongBookAnalysisPreset;
  checkpoint: LongBookAnalysisPipelineCheckpoint;
}): RestoredAnalysisPipeline {
  const saved = LongBookAnalysisPipelineCheckpointSchema.parse(
    input.checkpoint
  );
  if (
    saved.sourceId !== input.source.id ||
    saved.presetId !== input.preset.id
  ) {
    throw new Error("保存的拆书进度与当前来源或预设不一致。");
  }
  const selectedOrderSet = new Set(saved.selectedChapterOrders);
  const chapters = input.source.chapters.filter(({ order }) =>
    selectedOrderSet.has(order)
  );
  if (chapters.length !== saved.selectedChapterOrders.length) {
    throw new Error("保存任务引用的章节已经变化，无法安全续跑。");
  }
  const batches = groupAnalysisSegments(
    buildAnalysisSegments(chapters, saved.inputBudget),
    saved.inputBudget
  );
  const reduction = saved.reduction
    ? {
        ...createAnalysisReductionState(saved.notes, saved.inputBudget),
        groupIndex: saved.reduction.groupIndex,
        output: structuredClone(saved.reduction.output)
      }
    : undefined;
  return {
    job: {
      id: saved.jobId,
      sourceId: saved.sourceId,
      sourceTitle: saved.sourceTitle,
      preset: input.preset,
      modelId: saved.modelId,
      thinkingLevel: saved.thinkingLevel,
      ...(saved.temperature !== undefined
        ? { temperature: saved.temperature }
        : {}),
      libraryId: saved.libraryId,
      selectionStart: saved.selectedChapterOrders[0]!,
      selectionEnd: saved.selectedChapterOrders.at(-1)!,
      selectedChapterOrders: [...saved.selectedChapterOrders],
      inputBudget: saved.inputBudget,
      batches,
      batchIndex: saved.batchIndex,
      notes: structuredClone(saved.notes),
      reductionRounds: saved.reductionRounds,
      ...(reduction ? { reduction } : {})
    },
    phase: saved.phase,
    completedUnits: saved.completedUnits,
    estimatedUnits: saved.estimatedUnits,
    result: saved.result ?? null
  };
}

export function createAnalysisPipelineCheckpoint(
  job: LongBookAnalysisJob,
  state: LongBookAnalysisPipelineState
): LongBookAnalysisPipelineCheckpoint {
  return LongBookAnalysisPipelineCheckpointSchema.parse({
    jobId: job.id,
    sourceId: job.sourceId,
    sourceTitle: job.sourceTitle,
    presetId: job.preset.id,
    modelId: job.modelId,
    thinkingLevel: job.thinkingLevel,
    ...(job.temperature !== undefined ? { temperature: job.temperature } : {}),
    libraryId: job.libraryId,
    selectedChapterOrders: job.selectedChapterOrders,
    inputBudget: job.inputBudget,
    batchIndex: job.batchIndex,
    notes: job.notes,
    reductionRounds: job.reductionRounds,
    ...(job.reduction
      ? {
          reduction: {
            groupIndex: job.reduction.groupIndex,
            output: job.reduction.output
          }
        }
      : {}),
    phase: state.phase.value ?? "batch",
    completedUnits: state.completedUnits.value,
    estimatedUnits: state.estimatedUnits.value,
    ...(state.result.value ? { result: state.result.value } : {}),
    updatedAt: new Date().toISOString()
  });
}
