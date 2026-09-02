import { computed, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
  LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS,
  LongBookAnalysisTaskSnapshotSchema,
  type DeepWriteApi,
  type LongBookAnalysisPipelineCheckpoint,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisScopeMode,
  type LongBookAnalysisSource,
  type LongBookAnalysisTaskSnapshot,
  type ModelConfig,
  type SystemEventEnvelope,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import { LongBookAnalysisPipeline } from "./analysis-pipeline";
import type { LongBookAnalysisRunStatus } from "./analysis-pipeline-types";
import { completeAnalysisChapterOrders } from "./analysis-scope";
import {
  persistCompleteAnalysisResults,
  type CompleteAnalysisPersistResult
} from "./complete-analysis-catalog";
import type { LongBookAnalysisProcessEntry } from "./analysis-process";

export interface CompleteAnalysisStartInput {
  scopeMode: LongBookAnalysisScopeMode;
  styleFullText: boolean;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface CompleteBookAnalysisController {
  task: Ref<LongBookAnalysisTaskSnapshot | null>;
  loading: Readonly<Ref<boolean>>;
  isBusy: Readonly<Ref<boolean>>;
  overallProgressText: Readonly<Ref<string>>;
  processEntries: Readonly<Ref<LongBookAnalysisProcessEntry[]>>;
  currentActivity: Readonly<Ref<string>>;
  liveOutput: Readonly<Ref<string>>;
  pipelineError: Readonly<Ref<string | null>>;
  loadLatest(): Promise<void>;
  start(input: CompleteAnalysisStartInput): Promise<boolean>;
  resume(): Promise<boolean>;
  retryItem(presetId: string): Promise<boolean>;
  stop(): Promise<boolean>;
  updateResult(presetId: string, result: LongBookAnalysisResult): Promise<void>;
  persistAll(): Promise<CompleteAnalysisPersistResult>;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}

export function useCompleteBookAnalysis(options: {
  api: () => DeepWriteApi;
  source: ShallowRef<LongBookAnalysisSource | null>;
  presets: Ref<LongBookAnalysisPreset[]>;
  models: ShallowRef<readonly ModelConfig[]>;
  beforeSourceReplace(): void;
}): CompleteBookAnalysisController {
  const task = shallowRef<LongBookAnalysisTaskSnapshot | null>(null);
  const loading = ref(false);
  const orchestrationRunning = ref(false);
  const stopRequested = ref(false);
  const status = ref<LongBookAnalysisRunStatus>("idle");
  const phase = ref<"batch" | "reduce" | "final" | null>(null);
  const completedUnits = ref(0);
  const estimatedUnits = ref(0);
  const pipelineError = ref<string | null>(null);
  const result = ref<LongBookAnalysisResult | null>(null);
  const processEntries = ref<LongBookAnalysisProcessEntry[]>([]);
  const currentActivity = ref("");
  const liveOutput = ref("");
  let activePresetId = "";
  let disposed = false;

  async function saveTask(next: LongBookAnalysisTaskSnapshot): Promise<void> {
    const saved = await options.api().longBookAnalysis.tasks.save({
      ...next,
      updatedAt: new Date().toISOString()
    });
    if (!disposed) task.value = saved;
  }

  async function updateTask(
    mutate: (draft: LongBookAnalysisTaskSnapshot) => void
  ): Promise<void> {
    if (!task.value) return;
    const draft = structuredClone(task.value);
    mutate(draft);
    await saveTask(LongBookAnalysisTaskSnapshotSchema.parse(draft));
  }

  async function checkpoint(
    saved: LongBookAnalysisPipelineCheckpoint
  ): Promise<void> {
    await updateTask((draft) => {
      const item = draft.items.find(
        ({ presetId }) => presetId === saved.presetId
      );
      if (!item) return;
      item.checkpoint = saved;
      item.completedUnits = saved.completedUnits;
      item.estimatedUnits = saved.estimatedUnits;
      if (saved.result) item.result = saved.result;
    });
  }

  const pipeline = new LongBookAnalysisPipeline(
    options.api,
    options.models,
    {
      status,
      phase,
      completedUnits,
      estimatedUnits,
      error: pipelineError,
      result,
      processEntries,
      currentActivity,
      liveOutput
    },
    { onCheckpoint: checkpoint }
  );

  const isBusy = computed(() => orchestrationRunning.value);
  const overallProgressText = computed(() => {
    const current = task.value;
    if (!current) return "尚未开始完整拆书";
    let done = 0;
    let total = 0;
    for (const item of current.items) {
      const itemTotal = Math.max(1, item.estimatedUnits);
      total += itemTotal;
      done +=
        item.presetId === activePresetId
          ? Math.min(
              completedUnits.value,
              Math.max(itemTotal, estimatedUnits.value)
            )
          : Math.min(item.completedUnits, itemTotal);
    }
    const completedItems = current.items.filter(
      ({ status: itemStatus }) => itemStatus === "completed"
    ).length;
    return `已完成 ${completedItems}/5 项 · 处理步骤 ${done}/${Math.max(1, total)}`;
  });

  async function ensureTaskSource(): Promise<LongBookAnalysisSource> {
    const current = task.value;
    if (!current) throw new Error("没有可继续的完整拆书任务。");
    if (options.source.value?.id !== current.sourceId) {
      options.beforeSourceReplace();
      options.source.value = await options
        .api()
        .longBookAnalysis.sources.load(current.sourceId);
    }
    return options.source.value!;
  }

  async function runItem(presetId: string): Promise<void> {
    const current = task.value;
    const source = await ensureTaskSource();
    const item = current?.items.find(
      (candidate) => candidate.presetId === presetId
    );
    const preset = options.presets.value.find(({ id }) => id === presetId);
    if (!current || !item || !preset) throw new Error("完整拆书预设已不可用。");
    pipeline.reset();
    activePresetId = presetId;
    await updateTask((draft) => {
      draft.status = "running";
      draft.activePresetId = presetId;
      const target = draft.items.find(
        (candidate) => candidate.presetId === presetId
      )!;
      target.status = "running";
      delete target.error;
    });
    const runStatus = item.checkpoint
      ? await pipeline.restore(source, preset, item.checkpoint)
      : await pipeline.start(source, preset, {
          presetId,
          startOrder: item.chapterOrders[0]!,
          endOrder: item.chapterOrders.at(-1)!,
          chapterOrders: item.chapterOrders,
          modelId: current.modelId,
          thinkingLevel: current.thinkingLevel,
          libraryId: item.targetLibraryId
        });
    await updateTask((draft) => {
      const target = draft.items.find(
        (candidate) => candidate.presetId === presetId
      )!;
      target.completedUnits = completedUnits.value;
      target.estimatedUnits = estimatedUnits.value;
      if (result.value) target.result = result.value;
      if (runStatus === "completed") target.status = "completed";
      else if (runStatus === "error") {
        target.status = "error";
        target.error = pipelineError.value ?? "该拆书项目执行失败。";
      } else target.status = "stopped";
    });
  }

  async function runQueue(presetIds: readonly string[]): Promise<boolean> {
    if (orchestrationRunning.value || !task.value) return false;
    orchestrationRunning.value = true;
    stopRequested.value = false;
    try {
      for (const presetId of presetIds) {
        if (stopRequested.value) break;
        try {
          await runItem(presetId);
        } catch (error: unknown) {
          await updateTask((draft) => {
            const item = draft.items.find(
              (candidate) => candidate.presetId === presetId
            );
            if (!item) return;
            item.status = "error";
            item.error =
              error instanceof Error ? error.message : "该拆书项目执行失败。";
          });
        }
      }
      await updateTask((draft) => {
        delete draft.activePresetId;
        draft.status = stopRequested.value
          ? "stopped"
          : draft.items.every((item) => item.status === "completed")
            ? "completed"
            : draft.items.some((item) => item.status === "error")
              ? "partial"
              : "stopped";
      });
      activePresetId = "";
      return true;
    } finally {
      orchestrationRunning.value = false;
    }
  }

  async function start(input: CompleteAnalysisStartInput): Promise<boolean> {
    if (isBusy.value || !options.source.value) return false;
    const now = new Date().toISOString();
    const presets = LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS.map((presetId) => {
      const preset = options.presets.value.find(({ id }) => id === presetId);
      if (!preset) throw new Error(`缺少完整拆书预设：${presetId}`);
      const chapterOrders = completeAnalysisChapterOrders({
        chapters: options.source.value!.chapters,
        scopeMode: input.scopeMode,
        presetId,
        styleFullText: input.styleFullText
      });
      return {
        presetId,
        presetName: preset.name,
        scopeMode:
          input.scopeMode === "full" &&
          presetId === "style" &&
          !input.styleFullText
            ? ("sampled" as const)
            : input.scopeMode,
        chapterOrders,
        status: "pending" as const,
        completedUnits: 0,
        estimatedUnits: Math.ceil(chapterOrders.length / 50) + 1,
        targetLibraryId: preset.output.libraryId ?? ""
      };
    });
    task.value = LongBookAnalysisTaskSnapshotSchema.parse({
      version: 1,
      id: createId("long_book_analysis_task"),
      sourceId: options.source.value.id,
      sourceTitle: options.source.value.name,
      scopeMode: input.scopeMode,
      styleFullText: input.styleFullText,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
      status: "pending",
      items: presets,
      createdAt: now,
      updatedAt: now
    });
    await saveTask(task.value);
    return runQueue(LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS);
  }

  return {
    task,
    loading,
    isBusy,
    overallProgressText,
    processEntries,
    currentActivity,
    liveOutput,
    pipelineError,
    async loadLatest() {
      loading.value = true;
      try {
        task.value =
          (await options.api().longBookAnalysis.tasks.list()).tasks[0] ?? null;
      } finally {
        loading.value = false;
      }
    },
    start,
    resume: async () =>
      runQueue(
        task.value?.items
          .filter(({ status: itemStatus }) =>
            ["pending", "stopped"].includes(itemStatus)
          )
          .map(({ presetId }) => presetId) ?? []
      ),
    retryItem: async (presetId) => runQueue([presetId]),
    async stop() {
      if (!isBusy.value) return false;
      stopRequested.value = true;
      await updateTask((draft) => {
        draft.status = "stopping";
      });
      return pipeline.stop();
    },
    async updateResult(presetId, nextResult) {
      await updateTask((draft) => {
        const item = draft.items.find(
          (candidate) => candidate.presetId === presetId
        );
        if (item) item.result = nextResult;
      });
    },
    persistAll: async () => {
      if (!task.value) throw new Error("当前没有可批量写入的完整拆书结果。");
      return persistCompleteAnalysisResults({
        api: options.api(),
        task: task.value,
        presets: options.presets.value
      });
    },
    handleEvent: (event) => pipeline.handleEvent(event),
    dispose() {
      disposed = true;
      pipeline.dispose();
    }
  };
}
