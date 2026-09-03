import { describe, expect, it } from "vitest";
import type {
  AgentProviderRuntimeConfig,
  LongBookAnalysisSource,
  LongBookAnalysisTaskItem
} from "@deepwrite/contracts";
import type { LongBookAnalysisJob } from "../../../apps/desktop/src/renderer/src/extras/long-book-analysis/analysis-pipeline-types";
import { parseOptions } from "./options";
import { initializeTaskItemEstimates, runUnit } from "./runner";

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
});
