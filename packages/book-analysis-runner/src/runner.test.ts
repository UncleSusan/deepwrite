import { describe, expect, it } from "vitest";
import type {
  AgentProviderRuntimeConfig,
  LongBookAnalysisSource,
  LongBookAnalysisTaskItem
} from "@deepwrite/contracts";
import type { LongBookAnalysisJob } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-pipeline-types";
import { parseOptions } from "./options";
import { checkpoint, initializeTaskItemEstimates, runUnit } from "./runner";
import {
  FORCED_COMPACTION_RESPONSE_MAX_TOKENS,
  runAnalysisItem
} from "./execute-item";

const source: LongBookAnalysisSource = {
  id: "source-1",
  kind: "txt",
  name: "测试小说.txt",
  diagnostics: [],
  chapters: Array.from({ length: 121 }, (_, index) => ({
    id: `chapter-${index + 1}`,
    order: index + 1,
    title: `第 ${index + 1} 章`,
    sourceName: "测试小说.txt",
    text: "正文",
    charCount: 2
  }))
};

function item(
  presetId: string,
  chapterOrders: number[]
): LongBookAnalysisTaskItem {
  return {
    presetId,
    presetName: presetId,
    scopeMode: "full",
    chapterOrders,
    status: "pending",
    completedUnits: 0,
    estimatedUnits: 1,
    targetLibraryId: ""
  };
}

describe("headless book-analysis task estimates", () => {
  it("precomputes pending pipeline batches for truthful overall progress", () => {
    const items = [
      item(
        "plot-structure",
        source.chapters.map(({ order }) => order)
      ),
      item("character", [1])
    ];
    const options = parseOptions([
      "run",
      "--source",
      "source.txt",
      "--workspace",
      "workspace",
      "--model",
      "qwen3-local"
    ]);

    initializeTaskItemEstimates(source, options, items);

    expect(items.map(({ estimatedUnits }) => estimatedUnits)).toEqual([4, 2]);
  });

  it("uses ordinary completed text for headless reduction output", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = {
      async *start(input: Record<string, unknown>) {
        calls.push(input);
        yield {
          type: "agent.completed",
          payload: { content: "归并后的结构化笔记。" }
        };
      }
    };
    const job = {
      id: "job-1",
      sourceId: source.id,
      sourceTitle: source.name,
      preset: {
        id: "plot-structure",
        name: "剧情结构",
        description: "测试",
        systemPrompt: "测试",
        output: { domain: "material", kind: "plot", stageId: "pacing" }
      },
      modelId: "qwen3-local",
      thinkingLevel: "off",
      libraryId: "",
      selectionStart: 1,
      selectionEnd: 2,
      selectedChapterOrders: [1, 2],
      inputBudget: 4_000,
      batches: [],
      batchIndex: 0,
      notes: [],
      reductionRounds: 0
    } as LongBookAnalysisJob;

    await expect(
      runUnit({
        adapter: adapter as never,
        runtime: {} as AgentProviderRuntimeConfig,
        job,
        phase: "reduce",
        notes: [
          {
            id: "note-1",
            label: "第 1 章",
            chapterStart: 1,
            chapterEnd: 1,
            text: "原始笔记"
          }
        ]
      })
    ).resolves.toBe("归并后的结构化笔记。");
    expect(calls[0]?.longBookAnalysisOutputMode).toBe("text");
    expect(calls[0]?.longBookAnalysisInputMode).toBe("inline");
    expect(String(calls[0]?.prompt)).toContain("原始笔记");
  });

  it("force-compacts notes instead of failing at the reduction round limit", async () => {
    const preset = {
      id: "plot-structure",
      name: "剧情结构",
      description: "测试",
      systemPrompt: "测试",
      output: { domain: "material", kind: "plot", stageId: "pacing" }
    } as const;
    const job = {
      id: "job-2",
      sourceId: source.id,
      sourceTitle: source.name,
      preset,
      modelId: "qwen3-local",
      thinkingLevel: "off",
      libraryId: "",
      selectionStart: 1,
      selectionEnd: 3,
      selectedChapterOrders: [1, 2, 3],
      inputBudget: 4_690,
      batches: [],
      batchIndex: 0,
      notes: [
        {
          id: "note-1",
          label: "第 1 章",
          chapterStart: 1,
          chapterEnd: 1,
          text: "一".repeat(2_800)
        },
        {
          id: "note-2",
          label: "第 2 章",
          chapterStart: 2,
          chapterEnd: 2,
          text: "二".repeat(2_300)
        },
        {
          id: "note-3",
          label: "第 3 章",
          chapterStart: 3,
          chapterEnd: 3,
          text: "三".repeat(2_700)
        }
      ],
      reductionRounds: 20
    } as LongBookAnalysisJob;
    const taskItem = item("plot-structure", [1, 2, 3]);
    const responseLimits: Array<number | undefined> = [];

    await runAnalysisItem({
      item: taskItem,
      preset,
      source,
      options: parseOptions([
        "run",
        "--source",
        "source.txt",
        "--workspace",
        "workspace",
        "--model",
        "qwen3-local"
      ]),
      runtime: {} as AgentProviderRuntimeConfig,
      createJob: () => job,
      checkpoint,
      runUnit: async (input) => {
        responseLimits.push(input.responseMaxTokens);
        if (input.phase === "final") {
          return { title: "剧情结构", body: "# 最终结果" };
        }
        return input.responseMaxTokens ? "压缩笔记" : "归并笔记";
      },
      save: async () => {},
      log: () => {}
    });

    expect(responseLimits.slice(0, 3)).toEqual([
      FORCED_COMPACTION_RESPONSE_MAX_TOKENS,
      FORCED_COMPACTION_RESPONSE_MAX_TOKENS,
      FORCED_COMPACTION_RESPONSE_MAX_TOKENS
    ]);
    expect(taskItem.status).toBe("completed");
    expect(taskItem.result).toEqual({ title: "剧情结构", body: "# 最终结果" });
  });

  it("force-compacts when a reduction response does not shrink its inputs", async () => {
    const preset = {
      id: "character",
      name: "人物",
      description: "测试",
      systemPrompt: "测试",
      output: { domain: "material", kind: "character", stageId: "character" }
    } as const;
    const job = {
      id: "job-3",
      sourceId: source.id,
      sourceTitle: source.name,
      preset,
      modelId: "qwen3-local",
      thinkingLevel: "off",
      libraryId: "",
      selectionStart: 1,
      selectionEnd: 3,
      selectedChapterOrders: [1, 2, 3],
      inputBudget: 4_690,
      batches: [],
      batchIndex: 0,
      notes: [
        {
          id: "note-1",
          label: "第 1 章",
          chapterStart: 1,
          chapterEnd: 1,
          text: "一".repeat(1_000)
        },
        {
          id: "note-2",
          label: "第 2 章",
          chapterStart: 2,
          chapterEnd: 2,
          text: "二".repeat(1_000)
        },
        {
          id: "note-3",
          label: "第 3 章",
          chapterStart: 3,
          chapterEnd: 3,
          text: "三".repeat(1_000)
        }
      ],
      reductionRounds: 0
    } as LongBookAnalysisJob;
    const taskItem = item("character", [1, 2, 3]);
    const calls: Array<number | undefined> = [];

    await runAnalysisItem({
      item: taskItem,
      preset,
      source,
      options: parseOptions([
        "run",
        "--source",
        "source.txt",
        "--workspace",
        "workspace",
        "--model",
        "qwen3-local"
      ]),
      runtime: {} as AgentProviderRuntimeConfig,
      createJob: () => job,
      checkpoint,
      runUnit: async (input) => {
        calls.push(input.responseMaxTokens);
        if (input.phase === "final") {
          return { title: "人物", body: "# 最终结果" };
        }
        return input.responseMaxTokens
          ? "压缩笔记"
          : "notes" in input
            ? input.notes.map((note) => note.text).join("")
            : "";
      },
      save: async () => {},
      log: () => {}
    });

    expect(calls).toEqual([
      undefined,
      FORCED_COMPACTION_RESPONSE_MAX_TOKENS,
      FORCED_COMPACTION_RESPONSE_MAX_TOKENS,
      FORCED_COMPACTION_RESPONSE_MAX_TOKENS,
      undefined
    ]);
    expect(taskItem.status).toBe("completed");
  });

  it("uses a stable label when force-compacting an already long note label", async () => {
    const preset = {
      id: "character",
      name: "人物",
      description: "测试",
      systemPrompt: "测试",
      output: { domain: "material", kind: "character", stageId: "character" }
    } as const;
    const job = {
      id: "job-4",
      sourceId: source.id,
      sourceTitle: source.name,
      preset,
      modelId: "qwen3-local",
      thinkingLevel: "off",
      libraryId: "",
      selectionStart: 1,
      selectionEnd: 2,
      selectedChapterOrders: [1, 2],
      inputBudget: 4_690,
      batches: [],
      batchIndex: 0,
      notes: [
        {
          id: "note-1",
          label: "已压缩笔记 ".repeat(40),
          chapterStart: 1,
          chapterEnd: 2,
          text: "一".repeat(4_000)
        }
      ],
      reductionRounds: 20
    } as LongBookAnalysisJob;
    const taskItem = item("character", [1, 2]);

    await runAnalysisItem({
      item: taskItem,
      preset,
      source,
      options: parseOptions([
        "run",
        "--source",
        "source.txt",
        "--workspace",
        "workspace",
        "--model",
        "qwen3-local"
      ]),
      runtime: {} as AgentProviderRuntimeConfig,
      createJob: () => job,
      checkpoint,
      runUnit: async (input) =>
        input.phase === "final"
          ? { title: "人物", body: "# 最终结果" }
          : "压缩笔记",
      save: async () => {},
      log: () => {}
    });

    expect(job.notes[0]?.label).toBe("Chapters 1-2 compacted note");
    expect(job.notes[0]?.label.length).toBeLessThanOrEqual(256);
  });
});
