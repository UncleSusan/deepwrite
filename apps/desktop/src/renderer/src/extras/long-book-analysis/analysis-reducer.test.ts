import { describe, expect, it, vi } from "vitest";
import type {
  LongBookAnalysisNote,
  LongBookAnalysisPreset
} from "@deepwrite/contracts/renderer";
import { reduceAnalysisJob } from "./analysis-reducer";
import type { LongBookAnalysisJob } from "./analysis-pipeline-types";

const preset: LongBookAnalysisPreset = {
  id: "plot-structure",
  name: "剧情结构",
  description: "测试预设",
  systemPrompt: "测试",
  output: { domain: "material", kind: "plot", stageId: "pacing" }
};

function note(id: string, text: string): LongBookAnalysisNote {
  return {
    id,
    label: id,
    chapterStart: 1,
    chapterEnd: 1,
    text
  };
}

function job(
  notes: LongBookAnalysisNote[],
  reductionRounds = 0
): LongBookAnalysisJob {
  return {
    id: "job-1",
    sourceId: "source-1",
    sourceTitle: "测试小说",
    preset,
    modelId: "model-1",
    thinkingLevel: "off",
    libraryId: "",
    selectionStart: 1,
    selectionEnd: 1,
    selectedChapterOrders: [1],
    inputBudget: 4_000,
    batches: [],
    batchIndex: 0,
    notes,
    reductionRounds
  };
}

describe("long-book analysis reduction", () => {
  it("continues a checkpoint that had already completed eight rounds", async () => {
    const active = job(
      [note("note-1", "中".repeat(1_500)), note("note-2", "中".repeat(1_500))],
      8
    );
    const run = vi.fn(async () => "中".repeat(600));

    await reduceAnalysisJob(active, {
      run,
      begin: vi.fn(),
      addEstimatedUnits: vi.fn(),
      completeUnit: vi.fn()
    });

    expect(run).toHaveBeenCalled();
    expect(active.notes).toHaveLength(1);
    expect(active.reductionRounds).toBeGreaterThan(8);
  });

  it("stops immediately when an oversized note does not shrink", async () => {
    const active = job([note("note-1", "中".repeat(3_000))]);

    await expect(
      reduceAnalysisJob(active, {
        run: async () => "中".repeat(3_000),
        begin: vi.fn(),
        addEstimatedUnits: vi.fn(),
        completeUnit: vi.fn()
      })
    ).rejects.toThrow("归并未缩减内容");
  });
});
