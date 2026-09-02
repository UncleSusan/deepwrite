import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AgentProviderRuntimeConfigSchema,
  LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS,
  LongBookAnalysisPipelineCheckpointSchema,
  LongBookAnalysisResultBundleSchema,
  LongBookAnalysisSourceSchema,
  LongBookAnalysisTaskSnapshotSchema,
  type AgentProviderRuntimeConfig,
  type LongBookAnalysisPipelineCheckpoint,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisRuntimeContext,
  type LongBookAnalysisNote,
  type LongBookAnalysisSegment,
  type LongBookAnalysisSource,
  type LongBookAnalysisTaskItem,
  type LongBookAnalysisTaskSnapshot
} from "@deepwrite/contracts";
import { PiAgentRuntimeAdapter } from "@deepwrite/pi-runtime-adapter";
import { createId } from "@deepwrite/shared";
import { DEFAULT_LONG_BOOK_ANALYSIS_PRESETS } from "../../../apps/desktop/src/main/extras/long-book-analysis/config-store";
import { readLongBookAnalysisSource } from "../../../apps/desktop/src/main/extras/long-book-analysis/source-reader";
import { completeAnalysisChapterOrders } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-scope";
import {
  buildAnalysisSegments,
  groupAnalysisSegments
} from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/batching";
import type { LongBookAnalysisJob } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-pipeline-types";
import { runAnalysisItem } from "./execute-item";
import type { RunnerOptions } from "./options";

const SOURCE_FILE = "source.json";
const TASK_FILE = "task.json";
const DEFAULT_PRESETS = DEFAULT_LONG_BOOK_ANALYSIS_PRESETS.map((preset) => ({
  ...preset,
  builtin: true
}));

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function readJson<T>(
  path: string,
  parse: (value: unknown) => T
): Promise<T> {
  return parse(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export function runtimeConfig(
  options: RunnerOptions
): AgentProviderRuntimeConfig {
  return AgentProviderRuntimeConfigSchema.parse({
    id: "headless-ollama",
    label: "Headless Ollama",
    provider: "ollama",
    modelId: options.modelId,
    api: "openai-completions",
    baseUrl: options.baseUrl,
    apiKey: "",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low"],
    temperatureOptions: [0, 0.5, 1],
    contextWindow: options.contextWindow,
    maxTokens: options.maxTokens,
    deploymentTarget: "autodl-ollama",
    concurrencyLimit: 1
  });
}

function inputBudget(
  options: RunnerOptions,
  preset: LongBookAnalysisPreset
): number {
  const estimate = [...preset.systemPrompt].reduce(
    (total, character) =>
      total + (character.codePointAt(0)! > 0x7f ? 1.5 : 0.25),
    0
  );
  const budget = Math.floor(
    (options.contextWindow - options.maxTokens - 4_000 - estimate) * 0.6
  );
  if (budget < 4_000)
    throw new Error(
      "The configured context window is too small for complete-book analysis."
    );
  return budget;
}

export function createJob(input: {
  source: LongBookAnalysisSource;
  preset: LongBookAnalysisPreset;
  item: LongBookAnalysisTaskItem;
  options: RunnerOptions;
}): LongBookAnalysisJob {
  const selected = new Set(input.item.chapterOrders);
  const chapters = input.source.chapters.filter(({ order }) =>
    selected.has(order)
  );
  const budget = inputBudget(input.options, input.preset);
  return {
    id: createId("headless_analysis_job"),
    sourceId: input.source.id,
    sourceTitle: input.source.name,
    preset: input.preset,
    modelId: input.options.modelId,
    thinkingLevel: "off",
    temperature: input.options.temperature,
    libraryId: "",
    selectionStart: input.item.chapterOrders[0]!,
    selectionEnd: input.item.chapterOrders.at(-1)!,
    selectedChapterOrders: [...input.item.chapterOrders],
    inputBudget: budget,
    batches: groupAnalysisSegments(
      buildAnalysisSegments(chapters, budget),
      budget
    ),
    batchIndex: 0,
    notes: [],
    reductionRounds: 0
  };
}

export function checkpoint(
  job: LongBookAnalysisJob,
  item: LongBookAnalysisTaskItem,
  phase: "batch" | "reduce" | "final",
  result?: LongBookAnalysisResult
): LongBookAnalysisPipelineCheckpoint {
  return LongBookAnalysisPipelineCheckpointSchema.parse({
    jobId: job.id,
    sourceId: job.sourceId,
    sourceTitle: job.sourceTitle,
    presetId: job.preset.id,
    modelId: job.modelId,
    thinkingLevel: job.thinkingLevel,
    temperature: job.temperature,
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
    phase,
    completedUnits: item.completedUnits,
    estimatedUnits: item.estimatedUnits,
    ...(result ? { result } : {}),
    updatedAt: new Date().toISOString()
  });
}

type RunUnitInput = {
  adapter: PiAgentRuntimeAdapter;
  runtime: AgentProviderRuntimeConfig;
  job: LongBookAnalysisJob;
} & (
  | { phase: "batch"; segments: LongBookAnalysisSegment[] }
  | { phase: "reduce" | "final"; notes: LongBookAnalysisNote[] }
);

export async function runUnit(
  input: RunUnitInput
): Promise<string | LongBookAnalysisResult> {
  const unitId = createId(`headless_${input.phase}`);
  const base = {
    jobId: input.job.id,
    unitId,
    presetId: input.job.preset.id,
    sourceTitle: input.job.sourceTitle,
    selectionStart: input.job.selectionStart,
    selectionEnd: input.job.selectionEnd
  };
  const context: LongBookAnalysisRuntimeContext =
    input.phase === "batch"
      ? { ...base, phase: "batch", segments: input.segments }
      : input.phase === "reduce"
        ? { ...base, phase: "reduce", notes: input.notes }
        : { ...base, phase: "final", notes: input.notes };
  const message =
    input.phase === "batch"
      ? "Analyze the current chapter batch and write a structured intermediate note."
      : input.phase === "reduce"
        ? "Merge the supplied intermediate notes and write one compressed structured note."
        : "Generate the final editable Markdown analysis result from the merged notes.";
  let output: string | LongBookAnalysisResult | undefined;
  for await (const event of input.adapter.start({
    runId: createId("headless_analysis_run"),
    sessionId: createId("headless_analysis_session"),
    prompt: message,
    runtimeConfig: input.runtime,
    thinkingLevel: "off",
    ...(input.job.temperature === undefined
      ? {}
      : { temperature: input.job.temperature }),
    writeApprovalMode: "request-approval",
    longBookAnalysisProfile: input.job.preset,
    workspaceContext: { longBookAnalysis: context }
  })) {
    if (
      event.type === "long_book_analysis.note_updated" &&
      event.payload.unitId === unitId
    ) {
      output = event.payload.note.text;
    }
    if (
      event.type === "long_book_analysis.result_updated" &&
      event.payload.unitId === unitId
    ) {
      output = event.payload.result;
    }
    if (event.type === "agent.error") throw new Error(event.payload.message);
  }
  if (!output)
    throw new Error(
      `Model completed ${input.phase} without writing its required analysis output.`
    );
  return output;
}

function createTask(
  source: LongBookAnalysisSource,
  options: RunnerOptions
): LongBookAnalysisTaskSnapshot {
  const now = new Date().toISOString();
  return LongBookAnalysisTaskSnapshotSchema.parse({
    version: 1,
    id: createId("headless_complete_book_analysis"),
    sourceId: source.id,
    sourceTitle: source.name,
    scopeMode: options.scopeMode,
    styleFullText: options.styleFullText,
    modelId: options.modelId,
    thinkingLevel: "off",
    temperature: options.temperature,
    status: "pending",
    items: DEFAULT_PRESETS.map((preset) => ({
      presetId: preset.id,
      presetName: preset.name,
      scopeMode:
        options.scopeMode === "full" &&
        preset.id === "style" &&
        !options.styleFullText
          ? "sampled"
          : options.scopeMode,
      chapterOrders: completeAnalysisChapterOrders({
        chapters: source.chapters,
        scopeMode: options.scopeMode,
        presetId: preset.id,
        styleFullText: options.styleFullText
      }),
      status: "pending",
      completedUnits: 0,
      estimatedUnits: 1,
      targetLibraryId: ""
    })),
    createdAt: now,
    updatedAt: now
  });
}

export async function runHeadlessBookAnalysis(
  options: RunnerOptions
): Promise<string> {
  const sourcePath = join(options.workspace, SOURCE_FILE);
  const taskPath = join(options.workspace, TASK_FILE);
  const source = options.resume
    ? await readJson(sourcePath, (value) =>
        LongBookAnalysisSourceSchema.parse(value)
      )
    : await readLongBookAnalysisSource(options.sourceKind, options.source!);
  if (!options.resume) await atomicJson(sourcePath, source);
  const task = options.resume
    ? await readJson(taskPath, (value) =>
        LongBookAnalysisTaskSnapshotSchema.parse(value)
      )
    : createTask(source, options);
  if (task.modelId !== options.modelId)
    throw new Error(
      "The resume model must match the model recorded by the task."
    );
  const save = async (): Promise<void> => {
    task.updatedAt = new Date().toISOString();
    await atomicJson(taskPath, task);
  };
  task.status = "running";
  await save();
  for (const presetId of LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS) {
    const item = task.items.find(
      (candidate) => candidate.presetId === presetId
    )!;
    if (item.status === "completed") continue;
    const preset = DEFAULT_PRESETS.find(
      (candidate) => candidate.id === presetId
    )!;
    try {
      await runAnalysisItem({
        item,
        preset,
        source,
        options,
        runtime: runtimeConfig(options),
        createJob: () => createJob({ source, preset, item, options }),
        checkpoint,
        runUnit,
        save,
        log
      });
    } catch (error: unknown) {
      item.status = "error";
      item.error =
        error instanceof Error
          ? error.message
          : "Headless analysis item failed.";
      task.status = "partial";
      await save();
      throw error;
    }
  }
  task.status = "completed";
  await save();
  const archive =
    options.archive ??
    join(options.workspace, "result.deepwrite-book-analysis.json");
  const bundle = LongBookAnalysisResultBundleSchema.parse({
    format: "deepwrite-long-book-analysis",
    version: 1,
    exportedAt: new Date().toISOString(),
    runner: {
      version: "0.1.0",
      modelId: options.modelId,
      baseUrl: options.baseUrl
    },
    task,
    presets: DEFAULT_PRESETS.map(({ id, name, output }) => ({
      id,
      name,
      output
    }))
  });
  await atomicJson(archive, bundle);
  log(`Completed. Import package: ${archive}`);
  return archive;
}
