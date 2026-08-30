import { describe, expect, it } from "vitest";
import pageSource from "./LongBookAnalysisPage.vue?raw";
import processPanelSource from "./AnalysisProcessPanel.vue?raw";
import processTrackerSource from "./analysis-process.ts?raw";
import resultPanelSource from "./AnalysisResultPanel.vue?raw";
import sourceControlsSource from "./AnalysisSourceControls.vue?raw";
import presetManagerSource from "./PresetManager.vue?raw";
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
    expect(pageSource).toContain("controller.selectedThinkingLevel.value");
    expect(pageSource).toContain("selectedTargetLibraryId");
    expect(pageSource).toContain("<AnalysisSourceControls");
    expect(sourceControlsSource).toContain("选择已导入长篇");
    expect(sourceControlsSource).toContain("controller.loadSavedSources");
    expect(sourceControlsSource).toContain("controller.loadSavedSource");
    expect(sourceControlsSource).toContain("备份到工作目录");
    expect(pageSource).toContain(
      ':target-library-id="controller.targetLibraryId.value"'
    );
    expect(pageSource).toContain("查看执行过程");
    expect(pageSource).toContain("<AnalysisProcessPanel");
    expect(pageSource).toContain("查看生成结果");
    expect(pageSource).toContain("执行“{{ selectedPreset?.name");
    expect(pageSource).not.toContain("!selectedTargetLibraryId");
    expect(processTrackerSource).toContain("仅运行当前预设");
    expect(processPanelSource).toContain("内部思考文本不会展示");
    expect(resultPanelSource).toContain('v-model="targetId"');
    expect(resultPanelSource).toContain("生成后可随时更换目标库");
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
    expect(moduleSource).toContain('class="long-book-analysis-main-view"');
  });

  it("keeps the page toolbar and task form responsive", () => {
    expect(sourceControlsSource).toContain('class="analysis-page-actions"');
    expect(pageSource).toContain('class="chapter-range-inputs"');
    expect(pageSource).toContain('class="analysis-status"');
    expect(pageSource).toContain('import "./long-book-analysis.css"');
    expect(pageSource).toContain('class="analysis-empty-meta"');
    expect(pageSource).toContain('class="setup-field setup-range-field"');
    expect(pageSource).toContain('class="preset-target-field"');
  });

  it("configures a preset's concrete target library", () => {
    expect(presetManagerSource).toContain("默认目标资料库");
    expect(presetManagerSource).toContain("setTargetLibrary");
    expect(presetManagerSource).not.toContain("导入条目类型");
    expect(presetManagerSource).toContain("cloneLongBookAnalysisPreset");
    expect(presetManagerSource).not.toContain("structuredClone(preset)");
    expect(presetManagerSource).toContain("默认预设可直接编辑");
    expect(presetManagerSource).toContain('v-if="!preset.builtin"');
  });
});
