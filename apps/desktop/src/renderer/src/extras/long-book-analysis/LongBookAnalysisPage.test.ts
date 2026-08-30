import { describe, expect, it } from "vitest";
import pageSource from "./LongBookAnalysisPage.vue?raw";
import sidebarSource from "../../components/LeftSidebar.vue?raw";
import moduleSource from "../../components/WorkspaceFeatureModules.vue?raw";
import lazySource from "../../components/lazyAppComponents.ts?raw";

describe("long-book analysis feature wiring", () => {
  it("is a preset-driven page without a conversation composer", () => {
    expect(pageSource).toContain("长篇拆书分析");
    expect(pageSource).toContain("selectionCount > 50");
    expect(pageSource).toContain("<PopupSelect");
    expect(pageSource).toContain("controller.retry");
    expect(pageSource).toContain("controller.stop");
    expect(pageSource).not.toContain("AgentConversation");
    expect(pageSource).not.toContain("ConversationComposer");
  });

  it("uses a lazy more-features entry with background status", () => {
    expect(sidebarSource).toContain('id: "long-book-analysis"');
    expect(sidebarSource).toContain("props.longBookAnalysisRunning");
    expect(lazySource).toContain(
      'import("../extras/long-book-analysis/LongBookAnalysisPage.vue")'
    );
    expect(moduleSource).toContain("module.kind === 'long-book-analysis'");
  });
});
