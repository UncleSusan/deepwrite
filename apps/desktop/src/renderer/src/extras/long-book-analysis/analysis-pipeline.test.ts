import { ref, shallowRef } from "vue";
import type {
  DeepWriteApi,
  LongBookAnalysisPipelineCheckpoint,
  LongBookAnalysisPreset,
  LongBookAnalysisSource,
  ModelConfig,
  SessionPromptCommandPayload,
  SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { describe, expect, it, vi } from "vitest";
import { LongBookAnalysisPipeline } from "./analysis-pipeline";
import type { LongBookAnalysisPipelineState } from "./analysis-pipeline-types";

function fixture(
  onCheckpoint?: (value: LongBookAnalysisPipelineCheckpoint) => void
) {
  const prompts: SessionPromptCommandPayload[] = [];
  const abort = vi.fn(async () => ({
    sessionId: "session",
    runId: "run",
    abortedAt: new Date().toISOString()
  }));
  const api = {
    session: {
      prompt: vi.fn(async (payload: SessionPromptCommandPayload) => {
        prompts.push(payload);
        return {
          sessionId: payload.sessionId,
          runId: `${payload.sessionId}-run`,
          acceptedAt: new Date().toISOString(),
          runtime: {
            provider: "test",
            model: "test",
            mode: "provider" as const
          }
        };
      }),
      abort
    }
  } as unknown as DeepWriteApi;
  const model = {
    id: "model-1",
    contextWindow: 100_000,
    maxTokens: 16_000,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"]
  } as ModelConfig;
  const state: LongBookAnalysisPipelineState = {
    status: ref("idle"),
    phase: ref(null),
    completedUnits: ref(0),
    estimatedUnits: ref(0),
    error: ref(null),
    result: ref(null),
    processEntries: ref([]),
    currentActivity: ref(""),
    liveOutput: ref("")
  };
  return {
    prompts,
    abort,
    state,
    pipeline: new LongBookAnalysisPipeline(
      () => api,
      shallowRef([model]),
      state,
      onCheckpoint ? { onCheckpoint } : {}
    )
  };
}

const source: LongBookAnalysisSource = {
  id: "source-1",
  kind: "txt",
  name: "测试长篇.txt",
  diagnostics: [],
  chapters: [
    {
      id: "chapter-1",
      order: 1,
      title: "第一章",
      sourceName: "测试长篇.txt",
      text: "雨夜来信。".repeat(200),
      charCount: 1_000
    }
  ]
};

const preset: LongBookAnalysisPreset = {
  id: "plot-structure",
  name: "剧情结构",
  description: "拆解剧情结构。",
  systemPrompt: "依据章节证据提炼剧情结构。",
  output: { domain: "material", kind: "plot", stageId: "pacing" }
};

function event(
  type: string,
  prompt: SessionPromptCommandPayload,
  payload: Record<string, unknown>
): SystemEventEnvelope {
  return {
    type,
    payload: {
      sessionId: prompt.sessionId,
      runId: `${prompt.sessionId}-run`,
      ...payload
    }
  } as SystemEventEnvelope;
}

async function waitForPrompt(
  prompts: SessionPromptCommandPayload[],
  count: number
) {
  await vi.waitFor(() => expect(prompts).toHaveLength(count));
  return prompts[count - 1]!;
}

describe("long-book analysis pipeline checkpoints", () => {
  it("keeps a failed batch checkpoint and retries through the final result", async () => {
    const { pipeline, prompts, state } = fixture();
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1",
      thinkingLevel: "high",
      libraryId: "material-library-1"
    });
    const failed = await waitForPrompt(prompts, 1);
    expect(failed.thinkingLevel).toBe("high");
    pipeline.handleEvent(
      event("agent.error", failed, { message: "temporary", code: "test" })
    );
    await vi.waitFor(() => expect(state.status.value).toBe("error"));

    expect(pipeline.retry()).toBe(true);
    const batch = await waitForPrompt(prompts, 2);
    const batchContext = batch.workspaceContext!.longBookAnalysis!;
    pipeline.handleEvent(
      event("long_book_analysis.note_updated", batch, {
        unitId: batchContext.unitId,
        jobId: batchContext.jobId,
        toolCallId: "tool-note",
        note: { text: "保留章节证据的中间笔记。" }
      })
    );
    pipeline.handleEvent(
      event("agent.message_completed", batch, {
        role: "assistant",
        content: "批次分析完成。"
      })
    );

    const final = await waitForPrompt(prompts, 3);
    const finalContext = final.workspaceContext!.longBookAnalysis!;
    pipeline.handleEvent(
      event("long_book_analysis.result_updated", final, {
        unitId: finalContext.unitId,
        jobId: finalContext.jobId,
        toolCallId: "tool-result",
        result: { title: "剧情结构", body: "# 可编辑结果" }
      })
    );
    expect(state.result.value?.body).toBe("# 可编辑结果");
    pipeline.handleEvent(
      event("agent.message_completed", final, {
        role: "assistant",
        content: "正式结果已生成。"
      })
    );

    await vi.waitFor(() => expect(state.status.value).toBe("completed"));
    expect(state.result.value?.body).toBe("# 可编辑结果");
    expect(state.processEntries.value.at(-1)?.title).toBe("当前预设执行完成");
  });

  it("aborts the active run and preserves it for resume", async () => {
    const { pipeline, prompts, state, abort } = fixture();
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1",
      libraryId: "material-library-1"
    });
    const active = await waitForPrompt(prompts, 1);
    await pipeline.stop();
    expect(abort).toHaveBeenCalled();
    pipeline.handleEvent(
      event("agent.error", active, { message: "aborted", code: "aborted" })
    );
    await vi.waitFor(() => expect(state.status.value).toBe("stopped"));
    expect(pipeline.hasJob).toBe(true);
  });

  it("runs only the selected preset without requiring a target library", async () => {
    const { pipeline, prompts, state } = fixture();
    pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1",
      thinkingLevel: "off",
      temperature: 0.3
    });

    const active = await waitForPrompt(prompts, 1);
    expect(active.workspaceContext?.longBookAnalysis?.presetId).toBe(preset.id);
    expect(active.temperature).toBe(0.3);
    expect(pipeline.targetLibraryId).toBe("");
    expect(state.processEntries.value[0]?.detail).toContain("仅运行当前预设");
  });

  it("restores the next unit from a persisted batch checkpoint", async () => {
    let checkpoint: LongBookAnalysisPipelineCheckpoint | undefined;
    const first = fixture((value) => {
      checkpoint = value;
    });
    first.pipeline.start(source, preset, {
      presetId: preset.id,
      startOrder: 1,
      endOrder: 1,
      modelId: "model-1"
    });
    const batch = await waitForPrompt(first.prompts, 1);
    const context = batch.workspaceContext!.longBookAnalysis!;
    first.pipeline.handleEvent(
      event("long_book_analysis.note_updated", batch, {
        unitId: context.unitId,
        jobId: context.jobId,
        toolCallId: "tool-note",
        note: { text: "已持久化的批次笔记。" }
      })
    );
    first.pipeline.handleEvent(
      event("agent.message_completed", batch, {
        role: "assistant",
        content: "批次完成。"
      })
    );
    await vi.waitFor(() => expect(checkpoint?.batchIndex).toBe(1));
    first.pipeline.dispose();

    const resumed = fixture();
    resumed.pipeline.restore(source, preset, checkpoint!);
    const final = await waitForPrompt(resumed.prompts, 1);
    expect(final.workspaceContext?.longBookAnalysis?.phase).toBe("final");
  });
});
