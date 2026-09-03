import { describe, expect, it } from "vitest";
import type {
  LongBookAnalysisSource,
  LongBookAnalysisTaskItem
} from "@deepwrite/contracts";
import { parseOptions } from "./options";
import { initializeTaskItemEstimates } from "./runner";

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
});
