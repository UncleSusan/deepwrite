import { describe, expect, it } from "vitest";
import {
  LongBookAnalysisRuntimeContextSchema,
  LongBookAnalysisSettingsInputSchema,
  WorkspaceRuntimeContextSchema
} from "./index";
import { AgentPromptCommandPayloadSchema } from "./session/commands";

const segment = {
  id: "segment-1",
  chapterId: "chapter-1",
  chapterOrder: 1,
  chapterTitle: "第一章",
  segmentIndex: 1,
  segmentCount: 1,
  text: "门在雨夜里打开。"
};

function runtime(selectionEnd = 1) {
  return {
    phase: "batch" as const,
    jobId: "job-1",
    unitId: "unit-1",
    presetId: "plot-structure",
    sourceTitle: "测试长篇.txt",
    selectionStart: 1,
    selectionEnd,
    segments: [segment]
  };
}

const profile = {
  id: "plot-structure",
  name: "剧情结构",
  description: "拆解剧情结构。",
  systemPrompt: "依据章节证据提炼剧情结构。",
  output: {
    domain: "material" as const,
    kind: "plot" as const,
    stageId: "pacing" as const
  }
};

describe("long-book analysis contracts", () => {
  it("accepts dynamic output mappings and rejects duplicate preset names", () => {
    expect(
      LongBookAnalysisSettingsInputSchema.parse({ presets: [profile] })
        .presets[0]?.output
    ).toEqual(profile.output);
    expect(() =>
      LongBookAnalysisSettingsInputSchema.parse({
        presets: [profile, { ...profile, id: "another", name: "剧情结构 " }]
      })
    ).toThrow(/unique/iu);
  });

  it("allows exactly 50 continuous chapters and rejects 51", () => {
    expect(
      LongBookAnalysisRuntimeContextSchema.parse(runtime(50)).selectionEnd
    ).toBe(50);
    expect(() =>
      LongBookAnalysisRuntimeContextSchema.parse(runtime(51))
    ).toThrow(/50/iu);
  });

  it("keeps analysis context exclusive from other managed workspaces", () => {
    expect(
      WorkspaceRuntimeContextSchema.safeParse({ longBookAnalysis: runtime() })
        .success
    ).toBe(true);
    expect(
      WorkspaceRuntimeContextSchema.safeParse({
        longBookAnalysis: runtime(),
        learningImitation: {
          stageId: "style_learning",
          documents: [],
          result: {
            material_split: {
              gimmick: "",
              character: "",
              pacing: "",
              intro: "",
              plotRefine: "",
              draftExcerpt: ""
            },
            plot_learning: { plotDesignSkill: "", plotRefineSkill: "" },
            style_learning: { title: "", body: "" }
          }
        }
      }).success
    ).toBe(false);
  });

  it("requires the Main-resolved profile to match the runtime preset", () => {
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        sessionId: "session-1",
        message: "开始拆书",
        workspaceContext: { longBookAnalysis: runtime() },
        longBookAnalysisProfile: profile
      }).success
    ).toBe(true);
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        sessionId: "session-1",
        message: "开始拆书",
        workspaceContext: { longBookAnalysis: runtime() }
      }).success
    ).toBe(false);
  });
});
