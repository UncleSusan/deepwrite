import { reactive } from "vue";
import type { LongBookAnalysisPreset } from "@deepwrite/contracts/renderer";
import { describe, expect, it } from "vitest";
import { cloneLongBookAnalysisPreset } from "./preset-draft";

describe("long-book analysis preset drafts", () => {
  it("clones Vue reactive presets without retaining nested output state", () => {
    const preset = reactive<LongBookAnalysisPreset>({
      id: "plot-structure",
      name: "剧情结构",
      description: "拆解剧情结构。",
      systemPrompt: "按章节证据拆解。",
      output: {
        domain: "material",
        kind: "plot",
        stageId: "pacing",
        libraryId: "plot-library"
      }
    });

    const draft = cloneLongBookAnalysisPreset(preset);
    expect(draft).toEqual(preset);
    expect(draft).not.toBe(preset);
    expect(draft.output).not.toBe(preset.output);

    draft.output.libraryId = "other-library";
    expect(preset.output.libraryId).toBe("plot-library");
  });
});
