import { describe, expect, it } from "vitest";
import conversationSource from "./ConversationMessageList.vue?raw";
import messageItemSource from "./ConversationMessageItem.vue?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import streamedContentSource from "./StreamedContent.vue?raw";
import streamingTextSource from "./StreamingText.vue?raw";
import subagentSource from "./SubagentRunList.vue?raw";

describe("streaming conversation content", () => {
  it("uses an incremental text node while the model is streaming", () => {
    expect(streamedContentSource).toContain(
      "props.streaming || props.content.length > MAX_SAFE_MARKDOWN_LENGTH"
    );
    expect(streamingTextSource).toContain("textNode.appendData");
    expect(streamingTextSource).toContain("globalThis.requestAnimationFrame");
    expect(streamingTextSource).toContain("BACKGROUND_RENDER_FALLBACK_MS");
    expect(streamingTextSource).not.toContain("renderMarkdown");
    expect(streamingTextSource).not.toContain("v-html");
  });

  it("keeps Markdown for completed normal-size content and protects huge traces", () => {
    expect(streamedContentSource).toContain(
      "MAX_SAFE_MARKDOWN_LENGTH = 100_000"
    );
    expect(streamedContentSource).toContain(
      '<MessageMarkdown v-else :content="content" />'
    );
    expect(
      processingItemSource.match(/:content="item\.content"/g)
    ).toHaveLength(2);
    expect(processingItemSource).toContain(':streaming="streaming"');
    expect(messageItemSource).toContain(':content="visibleResponse(message)"');
    expect(
      `${conversationSource}\n${messageItemSource}\n${processingItemSource}`
    ).not.toContain("<MessageMarkdown");
  });

  it("applies the same safe streaming renderer to subagent output", () => {
    expect(subagentSource).toContain(
      'import StreamedContent from "./StreamedContent.vue"'
    );
    expect(
      subagentSource.match(/:streaming="run\.status === 'running'"/g)
    ).toHaveLength(2);
    expect(subagentSource).not.toContain("<MessageMarkdown");
  });
});
