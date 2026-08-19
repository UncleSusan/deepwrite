import { createId } from "@deepwrite/shared";
import type { ConversationHistoryItem } from "../../types/conversation";
import type { AgentConversationPersistenceRecord } from "./types";

export const MAX_STORED_CONVERSATIONS = 20;
export const STREAM_PRESENTATION_FALLBACK_MS = 120;

export function id(prefix: string): string {
  return createId(prefix);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function compactConversationText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

export function historyItemFor(
  conversation: AgentConversationPersistenceRecord,
  currentSessionId: string
): ConversationHistoryItem {
  const firstUserMessage = conversation.messages.find((message) => message.role === "user");
  const lastVisibleMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.content.trim());
  return {
    sessionId: conversation.sessionId,
    title: compactConversationText(firstUserMessage?.content ?? "未命名对话", 42),
    preview: compactConversationText(lastVisibleMessage?.content ?? conversation.draft, 76),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    turnCount: conversation.messages.filter((message) => message.role === "user").length,
    current: conversation.sessionId === currentSessionId
  };
}

export function rememberBounded(set: Set<string>, value: string, limit = 2_000): void {
  set.add(value);
  while (set.size > limit) {
    const oldest = set.values().next().value as string | undefined;
    if (!oldest) {
      return;
    }
    set.delete(oldest);
  }
}
