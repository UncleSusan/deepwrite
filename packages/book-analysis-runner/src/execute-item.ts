import {
  type AgentProviderRuntimeConfig,
  type LongBookAnalysisNote,
  type LongBookAnalysisPipelineCheckpoint,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisSegment,
  type LongBookAnalysisSource,
  type LongBookAnalysisTaskItem
} from "@deepwrite/contracts";
import { PiAgentRuntimeAdapter } from "@deepwrite/pi-runtime-adapter";
import {
  createAnalysisReductionState,
  MAX_ANALYSIS_REDUCTION_ROUNDS
} from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-reducer";
import { estimateAnalysisTokens } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/batching";
import { createAnalysisNote } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-pipeline-helpers";
import { restoreAnalysisPipeline } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-pipeline-checkpoint";
import type { LongBookAnalysisJob } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-pipeline-types";
import type { RunnerOptions } from "./options";

// The note itself targets roughly 1,200 tokens. The response needs additional
// room for the required function-call envelope and JSON escaping.
export const REDUCTION_RESPONSE_MAX_TOKENS = 2_400;
export const FORCED_COMPACTION_RESPONSE_MAX_TOKENS = 900;
export const HEADLESS_ANALYSIS_IDLE_TIMEOUT_MS = 120_000;

function needsHeadlessReduction(
  notes: readonly LongBookAnalysisNote[],
  inputBudget: number
): boolean {
  return (
    notes.length > 0 &&
    notes.reduce(
      (total, note) => total + estimateAnalysisTokens(note.text),
      0
    ) >
      inputBudget * 0.9
  );
}

function assertHeadlessReductionProgress(
  previous: readonly LongBookAnalysisNote[],
  next: readonly LongBookAnalysisNote[]
): void {
  const previousTokens = previous.reduce(
    (total, note) => total + estimateAnalysisTokens(note.text),
    0
  );
  const nextTokens = next.reduce(
    (total, note) => total + estimateAnalysisTokens(note.text),
    0
  );
  if (nextTokens < previousTokens) return;
  throw new Error("Headless reduction did not reduce estimated input tokens.");
}

function compactedNoteLabel(note: LongBookAnalysisNote): string {
  return `Chapters ${note.chapterStart}-${note.chapterEnd} compacted note`;
}

export function runtimeForAnalysisPhase(
  runtime: AgentProviderRuntimeConfig,
  phase: "batch" | "reduce" | "final",
  responseMaxTokens?: number
): AgentProviderRuntimeConfig {
  if (phase !== "reduce") return runtime;
  return {
    ...runtime,
    maxTokens: Math.min(
      runtime.maxTokens ?? REDUCTION_RESPONSE_MAX_TOKENS,
      responseMaxTokens ?? REDUCTION_RESPONSE_MAX_TOKENS
    )
  };
}

type RunUnit = (
  input: {
    adapter: PiAgentRuntimeAdapter;
    runtime: AgentProviderRuntimeConfig;
    job: LongBookAnalysisJob;
    responseMaxTokens?: number;
  } & (
    | { phase: "batch"; segments: LongBookAnalysisSegment[] }
    | { phase: "reduce" | "final"; notes: LongBookAnalysisNote[] }
  )
) => Promise<string | LongBookAnalysisResult>;

export async function runAnalysisItem(input: {
  item: LongBookAnalysisTaskItem;
  preset: LongBookAnalysisPreset;
  source: LongBookAnalysisSource;
  options: RunnerOptions;
  runtime: AgentProviderRuntimeConfig;
  createJob(): LongBookAnalysisJob;
  checkpoint(
    job: LongBookAnalysisJob,
    item: LongBookAnalysisTaskItem,
    phase: "batch" | "reduce" | "final",
    result?: LongBookAnalysisResult
  ): LongBookAnalysisPipelineCheckpoint;
  runUnit: RunUnit;
  save(): Promise<void>;
  log(message: string): void;
}): Promise<void> {
  const adapter = new PiAgentRuntimeAdapter({
    idleTimeoutMs: HEADLESS_ANALYSIS_IDLE_TIMEOUT_MS
  });
  const restored = input.item.checkpoint
    ? restoreAnalysisPipeline({
        source: input.source,
        preset: input.preset,
        checkpoint: input.item.checkpoint
      })
    : undefined;
  const job = restored?.job ?? input.createJob();
  input.item.status = "running";
  delete input.item.error;
  input.item.estimatedUnits = Math.max(
    input.item.estimatedUnits,
    restored?.estimatedUnits ?? job.batches.length + 1
  );

  const forceCompactNotes = async (): Promise<void> => {
    const notes = [...job.notes];
    input.log(
      `[${input.preset.name}] reduction did not converge; force-compacting ${notes.length} notes.`
    );
    job.notes = [];
    job.reductionRounds = 0;
    input.item.estimatedUnits += notes.length;
    for (const note of notes) {
      const text = await input.runUnit({
        adapter,
        runtime: input.runtime,
        job,
        phase: "reduce",
        notes: [note],
        responseMaxTokens: FORCED_COMPACTION_RESPONSE_MAX_TOKENS
      });
      if (typeof text !== "string") {
        throw new Error("Forced compaction must return an intermediate note.");
      }
      job.notes.push(
        createAnalysisNote(
          text,
          compactedNoteLabel(note),
          note.chapterStart,
          note.chapterEnd
        )
      );
      input.item.completedUnits += 1;
      input.item.checkpoint = input.checkpoint(job, input.item, "reduce");
      await input.save();
    }
  };
  while (job.batchIndex < job.batches.length) {
    const batch = job.batches[job.batchIndex]!;
    const start = Math.min(...batch.map(({ chapterOrder }) => chapterOrder));
    const end = Math.max(...batch.map(({ chapterOrder }) => chapterOrder));
    input.log(
      `[${input.preset.name}] batch ${job.batchIndex + 1}/${job.batches.length}: chapters ${start}-${end}`
    );
    const text = await input.runUnit({
      adapter,
      runtime: input.runtime,
      job,
      phase: "batch",
      segments: batch
    });
    if (typeof text !== "string") {
      throw new Error("A batch must return an intermediate note.");
    }
    job.notes.push(
      createAnalysisNote(
        text,
        `Chapters ${start}-${end} batch note`,
        start,
        end
      )
    );
    job.batchIndex += 1;
    input.item.completedUnits += 1;
    input.item.checkpoint = input.checkpoint(job, input.item, "batch");
    await input.save();
  }
  while (needsHeadlessReduction(job.notes, job.inputBudget)) {
    if (!job.reduction) {
      if (job.reductionRounds >= MAX_ANALYSIS_REDUCTION_ROUNDS) {
        await forceCompactNotes();
        continue;
      }
      job.reductionRounds += 1;
      job.reduction = createAnalysisReductionState(job.notes, job.inputBudget);
      input.item.estimatedUnits += job.reduction.groups.filter(
        (group) => group.length > 1
      ).length;
    }
    const reduction = job.reduction;
    while (reduction.groupIndex < reduction.groups.length) {
      const group = reduction.groups[reduction.groupIndex]!;
      if (group.length === 1) reduction.output.push(group[0]!);
      else {
        const text = await input.runUnit({
          adapter,
          runtime: input.runtime,
          job,
          phase: "reduce",
          notes: group
        });
        if (typeof text !== "string") {
          throw new Error("A reduction must return an intermediate note.");
        }
        const start = Math.min(
          ...group.map(({ chapterStart }) => chapterStart)
        );
        const end = Math.max(...group.map(({ chapterEnd }) => chapterEnd));
        reduction.output.push(
          createAnalysisNote(
            text,
            `Chapters ${start}-${end} merged note`,
            start,
            end
          )
        );
        input.item.completedUnits += 1;
      }
      reduction.groupIndex += 1;
      input.item.checkpoint = input.checkpoint(job, input.item, "reduce");
      await input.save();
    }
    const previousNotes = job.notes;
    try {
      assertHeadlessReductionProgress(previousNotes, reduction.output);
    } catch {
      delete job.reduction;
      await forceCompactNotes();
      continue;
    }
    job.notes = reduction.output;
    delete job.reduction;
  }
  const final = await input.runUnit({
    adapter,
    runtime: input.runtime,
    job,
    phase: "final",
    notes: job.notes
  });
  if (typeof final === "string") {
    throw new Error("The final stage must return an editable result.");
  }
  input.item.result = final;
  input.item.completedUnits += 1;
  input.item.status = "completed";
  input.item.checkpoint = input.checkpoint(job, input.item, "final", final);
  await input.save();
}
