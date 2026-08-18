import type {
  AgentToolTrace,
  ChatMessage
} from "../../types/conversation";

export type ChatAssistantTraceItem =
  | {
      id: string;
      type: "thinking";
      content: string;
    }
  | {
      id: string;
      type: "tool";
      tool: AgentToolTrace;
    };

export function chatAssistantProcessingTraceItems(
  message: ChatMessage
): ChatAssistantTraceItem[] {
  const items: ChatAssistantTraceItem[] = [];
  for (const step of message.processingSteps ?? []) {
    if (step.type === "thinking") {
      if (step.content) {
        items.push({
          id: step.id,
          type: "thinking",
          content: step.content
        });
      }
      continue;
    }
    if (step.type === "tool") {
      const tool = message.toolCalls?.find(
        (candidate) => candidate.id === step.toolCallId
      );
      if (tool) {
        items.push({ id: step.id, type: "tool", tool });
      }
    }
  }
  if (items.length) return items;

  const legacyThinking = message.thinking?.trim();
  if (legacyThinking) {
    items.push({
      id: `${message.id}:thinking`,
      type: "thinking",
      content: legacyThinking
    });
  }
  for (const tool of message.toolCalls ?? []) {
    items.push({
      id: `${message.id}:tool:${tool.id}`,
      type: "tool",
      tool
    });
  }
  return items;
}
