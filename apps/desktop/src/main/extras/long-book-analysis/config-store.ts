import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LongBookAnalysisAgentProfileSchema,
  LongBookAnalysisSettingsInputSchema,
  LongBookAnalysisSettingsSchema,
  type LongBookAnalysisAgentProfile,
  type LongBookAnalysisPreset,
  type LongBookAnalysisSettings,
  type LongBookAnalysisSettingsInput
} from "@deepwrite/contracts";
import characterPrompt from "./prompts/character.txt?raw";
import plotStructurePrompt from "./prompts/plot-structure.txt?raw";
import stylePrompt from "./prompts/style.txt?raw";

interface DiskSettings {
  version: 1;
  presets: Array<Omit<LongBookAnalysisPreset, "builtin">>;
  updatedAt?: string;
}

export const DEFAULT_LONG_BOOK_ANALYSIS_PRESETS = Object.freeze([
  {
    id: "plot-structure",
    name: "剧情结构",
    description: "拆解大剧情发展、章节级小剧情节拍与可复用结构模板。",
    systemPrompt: plotStructurePrompt,
    output: { domain: "material", kind: "plot", stageId: "pacing" }
  },
  {
    id: "character",
    name: "人物",
    description: "拆解人物目标、关系、功能、选择和阶段性弧光。",
    systemPrompt: characterPrompt,
    output: { domain: "material", kind: "character", stageId: "character" }
  },
  {
    id: "style",
    name: "文风",
    description: "提炼可直接交给分节写手执行的行文规则与检查清单。",
    systemPrompt: stylePrompt,
    output: {
      domain: "skill",
      kind: "style",
      stageId: "expert_section_writer"
    }
  }
] as const satisfies readonly Omit<LongBookAnalysisPreset, "builtin">[]);

const defaultIds = new Set<string>(
  DEFAULT_LONG_BOOK_ANALYSIS_PRESETS.map(({ id }) => id)
);

function cloneDefaults(): Array<Omit<LongBookAnalysisPreset, "builtin">> {
  return DEFAULT_LONG_BOOK_ANALYSIS_PRESETS.map((preset) =>
    structuredClone(preset)
  );
}

function defaultDiskSettings(): DiskSettings {
  return { version: 1, presets: cloneDefaults() };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function normalizeDiskSettings(raw: unknown): DiskSettings {
  if (!raw || typeof raw !== "object") return defaultDiskSettings();
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.presets)) {
    return defaultDiskSettings();
  }
  const parsed = LongBookAnalysisSettingsInputSchema.safeParse({
    presets: candidate.presets
  });
  if (!parsed.success) return defaultDiskSettings();
  const timestampValue =
    typeof candidate.updatedAt === "string"
      ? Date.parse(candidate.updatedAt)
      : Number.NaN;
  const timestamp = Number.isFinite(timestampValue)
    ? new Date(timestampValue).toISOString()
    : undefined;
  return {
    version: 1,
    presets: parsed.data.presets.map((preset) => structuredClone(preset)),
    ...(timestamp ? { updatedAt: timestamp } : {})
  };
}

function publicSettings(disk: DiskSettings): LongBookAnalysisSettings {
  return LongBookAnalysisSettingsSchema.parse({
    presets: disk.presets.map((preset) => ({
      ...structuredClone(preset),
      ...(defaultIds.has(preset.id) ? { builtin: true } : {})
    })),
    ...(disk.updatedAt ? { updatedAt: disk.updatedAt } : {})
  });
}

async function atomicWrite(path: string, value: DiskSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

export class LongBookAnalysisConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(
      userDataPath,
      "config",
      "long-book-analysis-presets.json"
    );
  }

  async list(): Promise<LongBookAnalysisSettings> {
    await this.writeChain;
    return publicSettings(await this.readDisk());
  }

  async save(
    rawInput: LongBookAnalysisSettingsInput
  ): Promise<LongBookAnalysisSettings> {
    const input = LongBookAnalysisSettingsInputSchema.parse(rawInput);
    return this.enqueue(async () => ({
      version: 1,
      presets: input.presets.map((preset) => structuredClone(preset)),
      updatedAt: new Date().toISOString()
    }));
  }

  async reset(presetId?: string): Promise<LongBookAnalysisSettings> {
    return this.enqueue(async () => {
      if (!presetId) {
        return {
          ...defaultDiskSettings(),
          updatedAt: new Date().toISOString()
        };
      }
      const replacement = DEFAULT_LONG_BOOK_ANALYSIS_PRESETS.find(
        (preset) => preset.id === presetId
      );
      if (!replacement) throw new Error("该自定义预设没有可恢复的默认版本。");
      const current = await this.readDisk();
      const index = current.presets.findIndex(
        (preset) => preset.id === presetId
      );
      const presets = current.presets.map((preset) => structuredClone(preset));
      if (index >= 0) presets.splice(index, 1, structuredClone(replacement));
      else presets.push(structuredClone(replacement));
      return { version: 1, presets, updatedAt: new Date().toISOString() };
    });
  }

  async resolve(presetId: string): Promise<LongBookAnalysisAgentProfile> {
    const preset = (await this.list()).presets.find(
      (candidate) => candidate.id === presetId
    );
    if (!preset) throw new Error("选择的长篇拆书预设已不存在，请刷新后重试。");
    return LongBookAnalysisAgentProfileSchema.parse(preset);
  }

  private async enqueue(
    operation: () => Promise<DiskSettings>
  ): Promise<LongBookAnalysisSettings> {
    let saved: LongBookAnalysisSettings | undefined;
    const pending = this.writeChain.then(async () => {
      const disk = await operation();
      await atomicWrite(this.settingsPath, disk);
      saved = publicSettings(disk);
    });
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    await pending;
    return saved!;
  }

  private async readDisk(): Promise<DiskSettings> {
    return normalizeDiskSettings(await readJson(this.settingsPath));
  }
}
