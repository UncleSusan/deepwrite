import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";
import {
  LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS,
  LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS,
  LongBookAnalysisNoteWriteSchema,
  LongBookAnalysisResultSchema,
  type LongBookAnalysisRuntimeContext
} from "@deepwrite/contracts";
import { piStrictToolSampling } from "../pi-tool-schema";

const READ_CHUNK_SIZE = 12_000;

export type LongBookAnalysisToolDetails =
  | {
      kind: "long-book-analysis-note";
      jobId: string;
      unitId: string;
      note: { text: string };
    }
  | {
      kind: "long-book-analysis-result";
      jobId: string;
      unitId: string;
      result: { title: string; body: string };
    };

type ToolDetails = { kind: "none" } | LongBookAnalysisToolDetails;

function textResult(
  text: string,
  details: ToolDetails = { kind: "none" }
): AgentToolResult<ToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function defineTool<T extends ReturnType<typeof Type.Object>>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>
  ) => Promise<AgentToolResult<ToolDetails>>;
}): AgentTool<T, ToolDetails> {
  return {
    ...definition,
    ...piStrictToolSampling(definition.parameters)
  };
}

interface ReadableItem {
  id: string;
  label: string;
  text: string;
  range: string;
}

function readableItems(
  context: LongBookAnalysisRuntimeContext
): ReadableItem[] {
  if (context.phase === "batch") {
    return context.segments.map((segment) => ({
      id: segment.id,
      label: `${segment.chapterOrder}. ${segment.chapterTitle}${segment.segmentCount > 1 ? `（片段 ${segment.segmentIndex}/${segment.segmentCount}）` : ""}`,
      text: segment.text,
      range: `第 ${segment.chapterOrder} 章`
    }));
  }
  return context.notes.map((note) => ({
    id: note.id,
    label: note.label,
    text: note.text,
    range: `第 ${note.chapterStart}-${note.chapterEnd} 章`
  }));
}

function chunks(text: string): string[] {
  const output: string[] = [];
  for (let index = 0; index < text.length; index += READ_CHUNK_SIZE) {
    output.push(text.slice(index, index + READ_CHUNK_SIZE));
  }
  return output;
}

function buildListTool(context: LongBookAnalysisRuntimeContext): AgentTool {
  return defineTool({
    name: "list_analysis_inputs",
    label: "列出拆书输入",
    description: "列出当前批次的章节片段或上轮分析笔记。",
    parameters: Type.Object({}),
    execute: async () =>
      textResult(
        readableItems(context)
          .map((item, index) => {
            const itemChunks = chunks(item.text);
            return `${index + 1}. id=${item.id}\n标题：${item.label}\n范围：${item.range}\n字符：${item.text.length}\n分块：${itemChunks.length}`;
          })
          .join("\n\n")
      )
  });
}

function buildReadTool(context: LongBookAnalysisRuntimeContext): AgentTool {
  return defineTool({
    name: "read_analysis_input",
    label: "读取拆书输入",
    description:
      "读取指定章节片段或分析笔记；内容较长时使用从 1 开始的 chunk_index 分块读取。",
    parameters: Type.Object({
      input_id: Type.String({ minLength: 1, maxLength: 120 }),
      chunk_index: Type.Optional(Type.Integer({ minimum: 1 }))
    }),
    execute: async (_toolCallId, params) => {
      const item = readableItems(context).find(
        (candidate) => candidate.id === params.input_id
      );
      if (!item) return textResult(`未找到拆书输入：${params.input_id}`);
      const itemChunks = chunks(item.text);
      const chunkIndex = Number(params.chunk_index ?? 1);
      const content = itemChunks[chunkIndex - 1];
      if (content === undefined) {
        return textResult(`${item.label} 没有第 ${chunkIndex} 个分块。`);
      }
      return textResult(
        `【${item.label}｜${item.range}｜第 ${chunkIndex}/${itemChunks.length} 块】\n\n${content}`
      );
    }
  });
}

function buildSearchTool(context: LongBookAnalysisRuntimeContext): AgentTool {
  return defineTool({
    name: "search_analysis_inputs",
    label: "搜索拆书输入",
    description: "在当前批次的章节片段或分析笔记中搜索关键词。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 300 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 }))
    }),
    execute: async (_toolCallId, params) => {
      const query = params.query.trim();
      const needle = query.toLocaleLowerCase();
      const maximum = Number(params.max_results ?? 8);
      const matches: string[] = [];
      for (const item of readableItems(context)) {
        const haystack = item.text.toLocaleLowerCase();
        let cursor = 0;
        while (matches.length < maximum) {
          const found = haystack.indexOf(needle, cursor);
          if (found < 0) break;
          const start = Math.max(0, found - 120);
          const end = Math.min(item.text.length, found + query.length + 180);
          matches.push(
            `【${item.label}】\n${start > 0 ? "…" : ""}${item.text.slice(start, end)}${end < item.text.length ? "…" : ""}`
          );
          cursor = found + Math.max(1, query.length);
        }
        if (matches.length >= maximum) break;
      }
      return textResult(
        matches.length ? matches.join("\n\n---\n\n") : `未找到：${query}`
      );
    }
  });
}

function buildNoteTool(context: LongBookAnalysisRuntimeContext): AgentTool {
  return defineTool({
    name: "write_analysis_note",
    label: "写入拆书中间笔记",
    description:
      "写入当前批次或归并阶段的结构化中间笔记。必须压缩、去重并保留章节范围证据。",
    parameters: Type.Object({
      text: Type.String({ maxLength: LONG_BOOK_ANALYSIS_MAX_NOTE_CHARACTERS })
    }),
    execute: async (_toolCallId, params) => {
      const note = LongBookAnalysisNoteWriteSchema.parse(params);
      return textResult("已记录当前拆书阶段的中间笔记。", {
        kind: "long-book-analysis-note",
        jobId: context.jobId,
        unitId: context.unitId,
        note
      });
    }
  });
}

function buildResultTool(context: LongBookAnalysisRuntimeContext): AgentTool {
  return defineTool({
    name: "write_analysis_result",
    label: "写入长篇拆书结果",
    description:
      "把最终拆书结果写入可编辑预览区。只更新预览，不会直接写入素材库或技能库。",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 256 }),
      body: Type.String({
        minLength: 1,
        maxLength: LONG_BOOK_ANALYSIS_MAX_RESULT_CHARACTERS
      })
    }),
    execute: async (_toolCallId, params) => {
      const result = LongBookAnalysisResultSchema.parse(params);
      return textResult("已写入长篇拆书结果预览，等待用户确认落库。", {
        kind: "long-book-analysis-result",
        jobId: context.jobId,
        unitId: context.unitId,
        result
      });
    }
  });
}

export function buildLongBookAnalysisTools(
  context: LongBookAnalysisRuntimeContext,
  outputMode: "tool" | "text" = "tool"
): AgentTool[] {
  const readTools = [
    buildListTool(context),
    buildReadTool(context),
    buildSearchTool(context)
  ];
  if (outputMode === "text") return readTools;
  return [
    ...readTools,
    context.phase === "final"
      ? buildResultTool(context)
      : buildNoteTool(context)
  ];
}

export function isLongBookAnalysisToolDetails(
  value: unknown
): value is LongBookAnalysisToolDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Record<string, unknown>;
  if (typeof details.jobId !== "string" || typeof details.unitId !== "string") {
    return false;
  }
  if (details.kind === "long-book-analysis-note") {
    return LongBookAnalysisNoteWriteSchema.safeParse(details.note).success;
  }
  if (details.kind === "long-book-analysis-result") {
    return LongBookAnalysisResultSchema.safeParse(details.result).success;
  }
  return false;
}
