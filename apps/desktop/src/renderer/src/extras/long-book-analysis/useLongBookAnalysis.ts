import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import {
  LongBookAnalysisSettingsInputSchema,
  LongBookAnalysisSourceSchema,
  type CatalogLibrary,
  type DeepWriteApi,
  type LongBookAnalysisChapter,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisSource,
  type LongBookAnalysisSourceKind,
  type ModelConfig,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import {
  LongBookAnalysisPipeline,
  type LongBookAnalysisPhase
} from "./analysis-pipeline";

export type LongBookAnalysisRunStatus =
  "idle" | "running" | "stopping" | "stopped" | "error" | "completed";

export interface LongBookAnalysisStartInput {
  presetId: string;
  startOrder: number;
  endOrder: number;
  modelId?: string;
}

export interface LongBookAnalysisPersistInput {
  libraryId?: string;
  newLibraryName?: string;
  baseProjectRevision?: number;
}

export interface LongBookAnalysisController {
  source: Ref<LongBookAnalysisSource | null>;
  presets: Ref<LongBookAnalysisPreset[]>;
  presetsLoading: Readonly<Ref<boolean>>;
  selectedModelId: Ref<string>;
  status: Readonly<Ref<LongBookAnalysisRunStatus>>;
  phase: Readonly<Ref<LongBookAnalysisPhase | null>>;
  progressText: ComputedRef<string>;
  error: Readonly<Ref<string | null>>;
  result: Ref<LongBookAnalysisResult | null>;
  isBusy: ComputedRef<boolean>;
  canRetry: ComputedRef<boolean>;
  setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void;
  loadPresets(): Promise<void>;
  savePresets(presets: readonly LongBookAnalysisPreset[]): Promise<void>;
  resetPresets(presetId?: string): Promise<void>;
  chooseSource(kind: LongBookAnalysisSourceKind): Promise<boolean>;
  replaceChapters(chapters: readonly LongBookAnalysisChapter[]): boolean;
  start(input: LongBookAnalysisStartInput): Promise<boolean>;
  retry(): Promise<boolean>;
  stop(): Promise<boolean>;
  persistResult(
    input: LongBookAnalysisPersistInput
  ): Promise<CatalogLibrary | null>;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}

export function useLongBookAnalysis(options: {
  api: () => DeepWriteApi | undefined;
}): LongBookAnalysisController {
  const source = shallowRef<LongBookAnalysisSource | null>(null);
  const presets = ref<LongBookAnalysisPreset[]>([]);
  const presetsLoading = ref(false);
  const selectedModelId = ref("");
  const configuredModels = shallowRef<readonly ModelConfig[]>([]);
  const status = ref<LongBookAnalysisRunStatus>("idle");
  const phase = ref<LongBookAnalysisPhase | null>(null);
  const completedUnits = ref(0);
  const estimatedUnits = ref(0);
  const error = ref<string | null>(null);
  const result = ref<LongBookAnalysisResult | null>(null);
  const isBusy = computed(
    () => status.value === "running" || status.value === "stopping"
  );
  const canRetry = computed(
    () =>
      pipeline.hasJob &&
      (status.value === "error" || status.value === "stopped")
  );
  const progressText = computed(() => {
    if (!phase.value) return "尚未开始";
    const labels: Record<LongBookAnalysisPhase, string> = {
      batch: "分批提炼",
      reduce: "递归归并",
      final: "生成结果"
    };
    return `${labels[phase.value]} · ${completedUnits.value}/${Math.max(completedUnits.value + 1, estimatedUnits.value)}`;
  });
  let disposed = false;

  function api(): DeepWriteApi {
    const current = options.api();
    if (!current) throw new Error("当前环境不支持长篇拆书分析。");
    return current;
  }

  const pipeline = new LongBookAnalysisPipeline(api, configuredModels, {
    status,
    phase,
    completedUnits,
    estimatedUnits,
    error,
    result
  });

  function setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void {
    configuredModels.value = models;
    if (models.some((model) => model.id === selectedModelId.value)) return;
    selectedModelId.value =
      (defaultModelId && models.some((model) => model.id === defaultModelId)
        ? defaultModelId
        : models[0]?.id) ?? "";
  }

  async function loadPresets(): Promise<void> {
    if (presetsLoading.value) return;
    presetsLoading.value = true;
    try {
      const settings = await api().longBookAnalysis.presets.list();
      if (!disposed) presets.value = settings.presets;
    } finally {
      if (!disposed) presetsLoading.value = false;
    }
  }

  async function savePresets(
    nextPresets: readonly LongBookAnalysisPreset[]
  ): Promise<void> {
    const input = LongBookAnalysisSettingsInputSchema.parse({
      presets: nextPresets.map(({ builtin: _builtin, ...preset }) => preset)
    });
    pipeline.reset();
    presets.value = (await api().longBookAnalysis.presets.save(input)).presets;
  }

  async function resetPresets(presetId?: string): Promise<void> {
    pipeline.reset();
    presets.value = (
      await api().longBookAnalysis.presets.reset(presetId)
    ).presets;
  }

  async function chooseSource(
    kind: LongBookAnalysisSourceKind
  ): Promise<boolean> {
    if (isBusy.value) {
      throw new Error("分析运行中，不能更换导入来源。");
    }
    const selected = await api().longBookAnalysis.chooseSource(kind);
    if (!selected) return false;
    pipeline.reset();
    source.value = selected;
    return true;
  }

  function replaceChapters(
    chapters: readonly LongBookAnalysisChapter[]
  ): boolean {
    if (!source.value) return false;
    pipeline.reset();
    source.value = LongBookAnalysisSourceSchema.parse({
      ...source.value,
      chapters: chapters.map((chapter, index) => ({
        ...chapter,
        order: index + 1
      }))
    });
    return true;
  }

  async function start(input: LongBookAnalysisStartInput): Promise<boolean> {
    if (isBusy.value) return false;
    if (!source.value) throw new Error("请先导入 TXT 或章节文件夹。");
    const preset = presets.value.find((item) => item.id === input.presetId);
    if (!preset) throw new Error("请选择一个拆书预设。");
    pipeline.start(source.value, preset, {
      ...input,
      modelId: input.modelId || selectedModelId.value
    });
    return true;
  }

  async function persistResult(
    input: LongBookAnalysisPersistInput
  ): Promise<CatalogLibrary | null> {
    const preset = pipeline.preset;
    if (!preset || !result.value) {
      throw new Error("当前没有可落库的拆书结果。");
    }
    const output = preset.output;
    let library: CatalogLibrary | null = null;
    let libraryId = input.libraryId;
    if (!libraryId) {
      const name = input.newLibraryName?.trim();
      if (!name) throw new Error("请输入新资料库名称。");
      library = await (output.domain === "material"
        ? api().catalog.createLibrary({
            domain: "material",
            name,
            materialKind: output.kind
          })
        : api().catalog.createLibrary({
            domain: "skill",
            name,
            skillKind: output.kind
          }));
      if (!library) return null;
      libraryId = library.id;
    }
    if (output.domain === "material") {
      await api().catalog.createLibraryEntry({
        domain: "material",
        libraryId,
        title: result.value.title,
        content: result.value.body,
        stageId: output.stageId,
        ...(input.baseProjectRevision === undefined
          ? {}
          : { baseProjectRevision: input.baseProjectRevision })
      });
    } else {
      await api().catalog.createLibraryEntry({
        domain: "skill",
        libraryId,
        title: result.value.title,
        content: result.value.body,
        stageId: output.stageId,
        ...(input.baseProjectRevision === undefined
          ? {}
          : { baseProjectRevision: input.baseProjectRevision })
      });
    }
    return library;
  }

  return {
    source,
    presets,
    presetsLoading,
    selectedModelId,
    status,
    phase,
    progressText,
    error,
    result,
    isBusy,
    canRetry,
    setConfiguredModels,
    loadPresets,
    savePresets,
    resetPresets,
    chooseSource,
    replaceChapters,
    start,
    retry: async () => pipeline.retry(),
    stop: () => pipeline.stop(),
    persistResult,
    handleEvent: (event) => pipeline.handleEvent(event),
    dispose() {
      disposed = true;
      pipeline.dispose();
    }
  };
}
