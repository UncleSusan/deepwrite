import { describe, expect, it } from "vitest";
import type { AgentToolTrace, ChatMessage } from "../../types/conversation";
import { chatAssistantProcessingTraceItems } from "./chatAssistantProcessingTrace";

function tool(id: string): AgentToolTrace {
  return {
    id,
    name: `tool_${id}`,
    args: {},
    status: "completed",
    requestedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("chat assistant processing trace", () => {
  it("keeps thinking and tools interleaved in processing-step order", () => {
    const firstTool = tool("first");
    const secondTool = tool("second");
    const message: ChatMessage = {
      id: "message_ordered",
      role: "assistant",
      content: "完成",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCalls: [secondTool, firstTool],
      processingSteps: [
        {
          id: "step_1",
          type: "thinking",
          content: "先分析",
          createdAt: "2026-01-01T00:00:01.000Z"
        },
        {
          id: "step_2",
          type: "tool",
          toolCallId: "first",
          createdAt: "2026-01-01T00:00:02.000Z"
        },
        {
          id: "step_3",
          type: "thinking",
          content: "再分析",
          createdAt: "2026-01-01T00:00:03.000Z"
        },
        {
          id: "step_4",
          type: "tool",
          toolCallId: "second",
          createdAt: "2026-01-01T00:00:04.000Z"
        }
      ]
    };

    expect(
      chatAssistantProcessingTraceItems(message).map((item) =>
        item.type === "thinking"
          ? `thinking:${item.content}`
          : `tool:${item.tool.id}`
      )
    ).toEqual([
      "thinking:先分析",
      "tool:first",
      "thinking:再分析",
      "tool:second"
    ]);
  });

  it("falls back to legacy thinking and tool fields without processing steps", () => {
    const message: ChatMessage = {
      id: "message_legacy",
      role: "assistant",
      content: "完成",
      createdAt: "2026-01-01T00:00:00.000Z",
      thinking: "旧思考记录",
      toolCalls: [tool("legacy")]
    };

    expect(
      chatAssistantProcessingTraceItems(message).map((item) => item.type)
    ).toEqual(["thinking", "tool"]);
  });
});
