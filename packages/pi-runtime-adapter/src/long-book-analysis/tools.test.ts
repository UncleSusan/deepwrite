import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { LongBookAnalysisRuntimeContext } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  buildLongBookAnalysisTools,
  isLongBookAnalysisToolDetails
} from "./tools";
import { PiAgentRuntimeAdapter } from "../adapter";
import type { AgentRuntimeEvent } from "../runtime-types";

function context(
  phase: "batch" | "reduce" | "final"
): LongBookAnalysisRuntimeContext {
  const base = {
    jobId: "job-1",
    unitId: `unit-${phase}`,
    presetId: "plot-structure",
    sourceTitle: "测试长篇",
    selectionStart: 1,
    selectionEnd: 2
  };
  if (phase === "batch") {
    return {
      ...base,
      phase,
      segments: [
        {
          id: "segment-1",
          chapterId: "chapter-1",
          chapterOrder: 1,
          chapterTitle: "第一章",
          segmentIndex: 1,
          segmentCount: 1,
          text: "雨夜收到一封信。"
        }
      ]
    };
  }
  return {
    ...base,
    phase,
    notes: [
      {
        id: "note-1",
        label: "第一章笔记",
        chapterStart: 1,
        chapterEnd: 1,
        text: "开篇以延迟信息制造悬念。"
      },
      {
        id: "note-2",
        label: "第二章笔记",
        chapterStart: 2,
        chapterEnd: 2,
        text: "人物选择推动下一轮压力。"
      }
    ]
  };
}

function tool(tools: AgentTool[], name: string): AgentTool {
  const found = tools.find((item) => item.name === name);
  if (!found) throw new Error(`Missing tool: ${name}`);
  return found;
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter(
      (
        item
      ): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text"
    )
    .map((item) => item.text)
    .join("\n");
}

describe("long-book analysis tools", () => {
  it("exposes only the phase-appropriate writer and no subagent tool", () => {
    expect(
      buildLongBookAnalysisTools(context("batch")).map((item) => item.name)
    ).toEqual([
      "list_analysis_inputs",
      "read_analysis_input",
      "search_analysis_inputs",
      "write_analysis_note"
    ]);
    expect(
      buildLongBookAnalysisTools(context("final")).map((item) => item.name)
    ).toEqual([
      "list_analysis_inputs",
      "read_analysis_input",
      "search_analysis_inputs",
      "write_analysis_result"
    ]);
  });

  it("keeps input tools but omits long JSON writers in text output mode", () => {
    expect(
      buildLongBookAnalysisTools(context("reduce"), "text").map(
        (item) => item.name
      )
    ).toEqual([
      "list_analysis_inputs",
      "read_analysis_input",
      "search_analysis_inputs"
    ]);
  });

  it("lists and reads chapter inputs without embedding them in the prompt", async () => {
    const tools = buildLongBookAnalysisTools(context("batch"));
    expect(
      resultText(await tool(tools, "list_analysis_inputs").execute("list", {}))
    ).toContain("id=segment-1");
    expect(
      resultText(
        await tool(tools, "read_analysis_input").execute("read", {
          input_id: "segment-1"
        })
      )
    ).toContain("雨夜收到一封信");
  });

  it("emits typed note and result details", async () => {
    const note = await tool(
      buildLongBookAnalysisTools(context("reduce")),
      "write_analysis_note"
    ).execute("write-note", { text: "归并后的结构化笔记。" });
    expect(isLongBookAnalysisToolDetails(note.details)).toBe(true);
    const result = await tool(
      buildLongBookAnalysisTools(context("final")),
      "write_analysis_result"
    ).execute("write-result", { title: "剧情结构", body: "# 结果" });
    expect(isLongBookAnalysisToolDetails(result.details)).toBe(true);
  });

  it("completes a Faux Runtime batch through the scoped note writer", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.start({
      runId: "run-analysis-faux",
      sessionId: "session-analysis-faux",
      prompt: "分析当前批次",
      workspaceContext: { longBookAnalysis: context("batch") },
      longBookAnalysisProfile: {
        id: "plot-structure",
        name: "剧情结构",
        description: "拆解剧情结构。",
        systemPrompt: "依据章节证据提炼剧情结构。",
        output: { domain: "material", kind: "plot", stageId: "pacing" }
      }
    })) {
      events.push(event);
    }
    expect(
      events.some((event) => event.type === "long_book_analysis.note_updated")
    ).toBe(true);
    expect(events.some((event) => event.type === "agent.completed")).toBe(true);
    expect(events.some((event) => event.type === "subagent.activity")).toBe(
      false
    );
  });
});
