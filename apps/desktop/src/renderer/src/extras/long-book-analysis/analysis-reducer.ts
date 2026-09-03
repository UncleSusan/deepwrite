import type {
  LongBookAnalysisNote,
  LongBookAnalysisResult
} from "@deepwrite/contracts/renderer";
import {
  estimateAnalysisTokens,
  groupAnalysisNotes,
  splitAnalysisNotesForBudget
} from "./batching";
import { createAnalysisNote } from "./analysis-pipeline-helpers";
import type { LongBookAnalysisJob } from "./analysis-pipeline-types";

interface AnalysisReducerDependencies {
  run(notes: LongBookAnalysisNote[]): Promise<string | LongBookAnalysisResult>;
  begin(detail: string): void;
  addEstimatedUnits(count: number): void;
  completeUnit(): Promise<void> | void;
}

export const MAX_ANALYSIS_REDUCTION_ROUNDS = 20;

export function needsAnalysisReduction(
  notes: readonly LongBookAnalysisNote[],
  inputBudget: number
): boolean {
  return (
    notes.length > 1 ||
    notes.some((note) => estimateAnalysisTokens(note.text) > inputBudget * 0.9)
  );
}

function totalNoteTokens(notes: readonly LongBookAnalysisNote[]): number {
  return notes.reduce(
    (total, note) => total + estimateAnalysisTokens(note.text),
    0
  );
}

export function assertAnalysisReductionProgress(
  previous: readonly LongBookAnalysisNote[],
  next: readonly LongBookAnalysisNote[]
): void {
  if (
    next.length < previous.length ||
    totalNoteTokens(next) < totalNoteTokens(previous)
  ) {
    return;
  }
  throw new Error(
    "中间笔记归并未缩减内容；请降低归并输出长度或增大模型上下文后续跑。"
  );
}

export function createAnalysisReductionState(
  notes: readonly LongBookAnalysisNote[],
  inputBudget: number
): NonNullable<LongBookAnalysisJob["reduction"]> {
  const inputs = splitAnalysisNotesForBudget(notes, inputBudget);
  const groups = groupAnalysisNotes(inputs, inputBudget);
  if (groups.every((group) => group.length === 1)) {
    throw new Error(
      "当前模型输入预算不足以归并单条中间笔记，请更换更大上下文模型。"
    );
  }
  return { groups, groupIndex: 0, output: [] };
}

export async function reduceAnalysisJob(
  job: LongBookAnalysisJob,
  dependencies: AnalysisReducerDependencies
): Promise<void> {
  while (needsAnalysisReduction(job.notes, job.inputBudget)) {
    if (!job.reduction) {
      if (job.reductionRounds >= MAX_ANALYSIS_REDUCTION_ROUNDS) {
        throw new Error(
          "中间笔记在 20 轮归并后仍未收敛；请降低归并输出长度或增大模型上下文后续跑。"
        );
      }
      job.reductionRounds += 1;
      job.reduction = createAnalysisReductionState(job.notes, job.inputBudget);
      dependencies.addEstimatedUnits(
        job.reduction.groups.filter((group) => group.length > 1).length
      );
    }
    const reduction = job.reduction;
    while (reduction.groupIndex < reduction.groups.length) {
      const group = reduction.groups[reduction.groupIndex]!;
      if (group.length === 1) reduction.output.push(group[0]!);
      else {
        const start = Math.min(...group.map((note) => note.chapterStart));
        const end = Math.max(...group.map((note) => note.chapterEnd));
        dependencies.begin(
          `归并第 ${start}-${end} 章的 ${group.length} 份分析笔记`
        );
        const merged = await dependencies.run(group);
        if (typeof merged !== "string") {
          throw new Error("归并阶段未返回中间笔记。");
        }
        reduction.output.push(
          createAnalysisNote(
            merged,
            `第 ${start}-${end} 章归并笔记`,
            start,
            end
          )
        );
        await dependencies.completeUnit();
      }
      reduction.groupIndex += 1;
    }
    const previousNotes = job.notes;
    try {
      assertAnalysisReductionProgress(previousNotes, reduction.output);
    } catch (error: unknown) {
      delete job.reduction;
      throw error;
    }
    job.notes = reduction.output;
    delete job.reduction;
  }
}
