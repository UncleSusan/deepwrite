import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  LongBookAnalysisSavedSourceCatalogSchema,
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
    stageId: "pacing" as const,
    libraryId: "material-library-1"
  }
};

describe("long-book analysis contracts", () => {
  it("validates saved source catalogs and source commands", () => {
    expect(
      LongBookAnalysisSavedSourceCatalogSchema.parse({
        sources: [
          {
            id: "long_book_analysis_source_1234abcd",
            kind: "txt",
            name: "测试长篇.txt",
            chapterCount: 12,
            characterCount: 24_000,
            importedAt: "2026-08-30T01:02:03.000Z"
          }
        ]
      }).sources
    ).toHaveLength(1);
    expect(
      CommandEnvelopeSchema.safeParse({
        ...createEnvelope(
          "longBookAnalysis.listSources",
          {},
          {
            id: "cmd-list-sources"
          }
        )
      }).success
    ).toBe(true);
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "longBookAnalysis.tasks.list",
          {},
          { id: "cmd-list-tasks" }
        )
      ).success
    ).toBe(true);
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "longBookAnalysis.loadSource",
          { sourceId: "../../unsafe" },
          { id: "cmd-load-source" }
        )
      ).success
    ).toBe(false);
  });

  it("accepts dynamic output mappings and rejects duplicate preset names", () => {
    expect(
      LongBookAnalysisSettingsInputSchema.parse({ presets: [profile] })
        .presets[0]?.output
    ).toEqual(profile.output);
    expect(() =>
      LongBookAnalysisSettingsInputSchema.parse({
        presets: [
          {
            ...profile,
            output: { ...profile.output, libraryId: " " }
          }
        ]
      })
    ).toThrow();
    expect(() =>
      LongBookAnalysisSettingsInputSchema.parse({
        presets: [profile, { ...profile, id: "another", name: "剧情结构 " }]
      })
    ).toThrow(/unique/iu);
  });

  it("allows tasks beyond 50 chapters but caps one raw processing window", () => {
    expect(
      LongBookAnalysisRuntimeContextSchema.parse(runtime(500)).selectionEnd
    ).toBe(500);
    const segments = Array.from({ length: 51 }, (_, index) => ({
      ...segment,
      id: `segment-${index + 1}`,
      chapterId: `chapter-${index + 1}`,
      chapterOrder: index + 1
    }));
    expect(() =>
      LongBookAnalysisRuntimeContextSchema.parse({
        ...runtime(51),
        segments
      })
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
