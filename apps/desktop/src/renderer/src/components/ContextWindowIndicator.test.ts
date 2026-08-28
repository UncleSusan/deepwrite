import { describe, expect, it } from "vitest";
// @ts-expect-error Loaded as source text by the Vitest-only virtual module.
import rendererStyles from "virtual:deepwrite-renderer-styles";
import conversationSource from "./AgentConversation.vue?raw";
import composerSource from "./ConversationComposer.vue?raw";
import indicatorSource from "./ContextWindowIndicator.vue?raw";
import chatAssistantComposerSource from "../features/chat-assistant/ChatAssistantComposer.vue?raw";

describe("ContextWindowIndicator", () => {
  it("places the indicator after thinking and before temperature", () => {
    const thinking = composerSource.indexOf('accessible-label="选择思考等级"');
    const indicator = composerSource.indexOf("<ContextWindowIndicator");
    const temperature = composerSource.indexOf('accessible-label="选择温度"');

    expect(thinking).toBeGreaterThan(-1);
    expect(indicator).toBeGreaterThan(thinking);
    expect(temperature).toBeGreaterThan(indicator);
  });

  it("is limited to the shared creative composer", () => {
    expect(conversationSource).toContain("<ConversationComposer");
    expect(composerSource).toContain("<ContextWindowIndicator");
    expect(chatAssistantComposerSource).not.toContain("ContextWindowIndicator");
  });

  it("teleports a keyboard-accessible tooltip outside the clipped composer", () => {
    expect(indicatorSource).toContain('<Teleport to="body">');
    expect(indicatorSource).toContain('role="tooltip"');
    expect(indicatorSource).toContain('@focus="focused = true"');
    expect(indicatorSource).toContain('@keydown.esc.prevent="closeTooltip"');
    expect(indicatorSource).toContain("getBoundingClientRect()");
    expect(indicatorSource).toContain("window.innerWidth");
    expect(rendererStyles).toContain("position: fixed;");
  });

  it("uses theme variables and preserves the compact toolbar footprint", () => {
    expect(rendererStyles).toContain("var(--surface-raised");
    expect(rendererStyles).toContain("var(--theme-line");
    expect(rendererStyles).toContain("var(--text-primary");
    expect(rendererStyles).toContain("var(--accent");
    expect(rendererStyles).toContain("flex: 0 0 auto;");
    expect(rendererStyles).toContain("prefers-reduced-motion: reduce");
  });

  it("shows actual percentages, exact tokens, and explicit unmeasured states", () => {
    expect(indicatorSource).toContain("已使用 ${usedPercentageLabel.value}");
    expect(indicatorSource).toContain("等待实际用量");
    expect(indicatorSource).toContain("上下文上限不可用");
    expect(indicatorSource).toContain("tokens`");
    expect(indicatorSource).toContain(':stroke-dashoffset="dashOffset"');
  });
});
