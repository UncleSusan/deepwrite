import { describe, expect, it } from "vitest";
import { LongBookAnalysisResultBundleSchema } from "./long-book-analysis-bundle";

const completedTask = {
  version: 1,
  id: "complete_analysis_1",
  sourceId: "source_1",
  sourceTitle: "Reference book",
  scopeMode: "full",
  styleFullText: false,
  modelId: "qwen3",
  thinkingLevel: "off",
  temperature: 0.3,
  status: "completed",
  items: [
    "plot-structure",
    "character",
    "story-bible",
    "method-distillation",
    "style"
  ].map((presetId) => ({
    presetId,
    presetName: presetId,
    scopeMode: "full",
    chapterOrders: [1],
    status: "completed",
    completedUnits: 2,
    estimatedUnits: 2,
    targetLibraryId: "",
    result: { title: presetId, body: "analysis" }
  })),
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z"
};

describe("long-book analysis result bundle", () => {
  it("accepts a completed five-pipeline result package", () => {
    expect(
      LongBookAnalysisResultBundleSchema.parse({
        format: "deepwrite-long-book-analysis",
        version: 1,
        exportedAt: "2026-09-02T00:00:00.000Z",
        runner: {
          version: "0.1.0",
          modelId: "qwen3",
          baseUrl: "http://127.0.0.1:11434/v1"
        },
        task: completedTask,
        presets: [
          "plot-structure",
          "character",
          "story-bible",
          "method-distillation",
          "style"
        ].map((id) => ({
          id,
          name: id,
          output: {
            domain:
              id === "method-distillation" || id === "style"
                ? "skill"
                : "material",
            kind:
              id === "style"
                ? "style"
                : id === "method-distillation"
                  ? "general"
                  : id === "character"
                    ? "character"
                    : id === "plot-structure"
                      ? "plot"
                      : "other",
            stageId:
              id === "style"
                ? "expert_section_writer"
                : id === "method-distillation"
                  ? "draft"
                  : id === "character"
                    ? "character"
                    : id === "plot-structure"
                      ? "pacing"
                      : "other"
          }
        }))
      }).task.status
    ).toBe("completed");
  });

  it("rejects a partial task so an unfinished remote run cannot be imported", () => {
    expect(() =>
      LongBookAnalysisResultBundleSchema.parse({
        format: "deepwrite-long-book-analysis",
        version: 1,
        exportedAt: "2026-09-02T00:00:00.000Z",
        runner: {
          version: "0.1.0",
          modelId: "qwen3",
          baseUrl: "http://127.0.0.1:11434/v1"
        },
        task: { ...completedTask, status: "partial" },
        presets: []
      })
    ).toThrow();
  });
});
