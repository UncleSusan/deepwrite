import { describe, expect, it } from "vitest";
import pageSource from "./LongBookAnalysisPage.vue?raw";
import processPanelSource from "./AnalysisProcessPanel.vue?raw";
import processTrackerSource from "./analysis-process.ts?raw";
import resultPanelSource from "./AnalysisResultPanel.vue?raw";
import sourceControlsSource from "./AnalysisSourceControls.vue?raw";
import presetManagerSource from "./PresetManager.vue?raw";
import singleTaskSource from "./SingleAnalysisTaskPanel.vue?raw";
import completePanelSource from "./CompleteAnalysisPanel.vue?raw";
import completeResultsSource from "./CompleteAnalysisResults.vue?raw";
import sidebarSource from "../../components/LeftSidebar.vue?raw";
import moduleSource from "../../components/WorkspaceFeatureModules.vue?raw";
import lazySource from "../../components/lazyAppComponents.ts?raw";

describe("long-book analysis feature wiring", () => {
  it("is a preset-driven page without a conversation composer", () => {
    expect(pageSource).toContain("长篇拆书分析");
    expect(pageSource).toContain("完整拆书");
    expect(singleTaskSource).toContain("自动拆成最多 50 章的窗口");
    expect(singleTaskSource).toContain("<PopupSelect");
    expect(singleTaskSource).toContain("controller.retry");
    expect(singleTaskSource).toContain("controller.stop");
    expect(singleTaskSource).toContain(
      "controller.selectedThinkingLevel.value"
    );
    expect(singleTaskSource).toContain("selectedTargetLibraryId");
    expect(pageSource).toContain("<AnalysisSourceControls");
    expect(sourceControlsSource).toContain("选择已导入长篇");
    expect(sourceControlsSource).toContain("controller.loadSavedSources");
    expect(sourceControlsSource).toContain("controller.loadSavedSource");
    expect(sourceControlsSource).toContain("备份到工作目录");
    expect(pageSource).toContain(
      ':target-library-id="controller.targetLibraryId.value"'
    );
    expect(singleTaskSource).toContain("查看执行过程");
    expect(singleTaskSource).toContain("<AnalysisProcessPanel");
    expect(singleTaskSource).toContain("查看生成结果");
    expect(singleTaskSource).toContain("执行“{{ selectedPreset?.name");
    expect(singleTaskSource).not.toContain("!selectedTargetLibraryId");
    expect(completePanelSource).toContain("一键执行完整拆书");
    expect(completePanelSource).toContain("从中断处继续");
    expect(completePanelSource).toContain("retryItem");
    expect(completeResultsSource).toContain("一键归档到资料组");
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
    expect(singleTaskSource).toContain('class="chapter-range-inputs"');
    expect(singleTaskSource).toContain('class="analysis-status"');
    expect(pageSource).toContain('import "./long-book-analysis.css"');
    expect(pageSource).toContain('class="analysis-empty-meta"');
    expect(singleTaskSource).toContain('class="setup-field setup-range-field"');
    expect(singleTaskSource).toContain('class="preset-target-field"');
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
