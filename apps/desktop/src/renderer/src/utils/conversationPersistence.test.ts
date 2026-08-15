import { describe, expect, it, vi } from "vitest";
import {
  conversationHistoryPersistenceKey,
  createConversationPersistenceAdapter
} from "./conversationPersistence";

describe("conversation persistence adapter", () => {
  it("creates readable contract-safe keys for ordinary conversations", () => {
    expect(conversationHistoryPersistenceKey("long:book 1:setting")).toBe(
      "conversation-history:long%3Abook%201%3Asetting"
    );
  });

  it("bounds long keys while keeping distinct suffixes", () => {
    const left = conversationHistoryPersistenceKey(`book:${"a".repeat(400)}`);
    const right = conversationHistoryPersistenceKey(`book:${"a".repeat(399)}b`);

    expect(left).toHaveLength(240);
    expect(right).toHaveLength(240);
    expect(left).not.toBe(right);
    expect(left).toMatch(/^conversation-history:book%3A.*~[a-f0-9]{16}$/u);
  });

  it("rejects an empty logical key", () => {
    expect(() => conversationHistoryPersistenceKey("   ")).toThrow(
      "会话 key 不能为空"
    );
  });

  it("forwards structured values without serialization", async () => {
    const api = {
      load: vi.fn(async () => ({ version: 1 })),
      save: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    };
    const adapter = createConversationPersistenceAdapter(api)!;
    const value = { conversations: [{ messages: ["占位内容"] }] };

    await expect(adapter.load("conversation-history:test")).resolves.toEqual({
      version: 1
    });
    await adapter.save("conversation-history:test", value);
    await adapter.remove!("conversation-history:test");

    expect(api.save).toHaveBeenCalledWith(
      "conversation-history:test",
      value
    );
    expect(api.remove).toHaveBeenCalledWith("conversation-history:test");
  });

  it("returns null when the preload capability is unavailable", () => {
    expect(createConversationPersistenceAdapter(undefined)).toBeNull();
  });
});
