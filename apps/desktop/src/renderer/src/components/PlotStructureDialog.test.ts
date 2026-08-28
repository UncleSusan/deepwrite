import { describe, expect, it } from "vitest";
import source from "./PlotStructureDialog.vue?raw";
import controllerSource from "./usePlotStructureDialog.ts?raw";
import contextPanelSource from "./WritingContextPanel.vue?raw";
import treeSource from "./TreeNodeItem.vue?raw";

const implementationSource = `${source}\n${controllerSource}`;
const visualSource = `${source}\n${contextPanelSource}`;

describe("PlotStructureDialog", () => {
  it("supports dynamic structure CRUD, enable toggles and stable ordering", () => {
    expect(source).toContain("剧情结构管理");
    expect(implementationSource).toContain('type: "create"');
    expect(implementationSource).toContain('type: "update"');
    expect(implementationSource).toContain('type: "move"');
    expect(implementationSource).toContain('type: "setEnabled"');
    expect(implementationSource).toContain('type: "delete"');
    expect(implementationSource).toContain("isBuiltinCreativePlotStageId");
    expect(source).toContain("名称与说明全局生效");
    expect(source).toContain("稳定 ID 创建后不会因改名或排序而变化");
  });

  it("is available from the short and script book action menu", () => {
    expect(treeSource).toContain("结构管理");
    expect(treeSource).toContain("openBookAction('manage-structure')");
    expect(treeSource).toContain("hasBookAction");
  });

  it("switches between character and plot management with PopupSelect", () => {
    expect(source).toContain("人物结构管理");
    expect(source).toContain("剧情结构管理");
    expect(source).toContain("<PopupSelect");
    expect(source).toContain(':menu-z-index="2300"');
    expect(source).toContain("条目样式");
    expect(source).toContain("文本样式");
    expect(implementationSource).toContain('type: "setFormat"');
    expect(source).toContain("转换预览");
    expect(source).toContain("orderedCharacterItems");
  });

  it("locks builtin stages and hard-deletes custom stages globally", () => {
    expect(implementationSource).toContain("默认剧情结构不可删除");
    expect(source).toContain("确认全局删除");
    expect(implementationSource).toContain("deleteContent: true");
    expect(implementationSource).toContain("至少需要保留一个启用的剧情结构项");
    expect(source).toContain("rows.length >= 32");
    expect(implementationSource).toContain("uiMessage.warning");
    expect(source).toContain('role="switch"');
  });

  it("uses a teleported focus-trapped themed compact dialog", () => {
    expect(source).toContain('<Teleport to="body">');
    expect(implementationSource).toContain('event.key !== "Tab"');
    expect(implementationSource).toContain('event.key === "Escape"');
    for (const className of [
      "plot-structure-manager",
      "manager-toolbar",
      "section-tabs",
      "manager-list",
      "manager-row",
      "row-toggle",
      "structure-modal-overlay",
      "structure-modal",
      "modal-actions"
    ]) {
      expect(visualSource).toContain(className);
    }
    for (const token of [
      "--surface-main",
      "--surface-raised",
      "--surface-muted",
      "--theme-line",
      "--theme-line-soft",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--accent",
      "--accent-soft"
    ]) {
      expect(visualSource).toContain(`var(${token})`);
    }
    expect(source).toContain(
      '<style scoped src="./plot-structure-dialog.css"></style>'
    );
    expect(contextPanelSource).toContain("@media (max-width: 680px)");
  });

  it("unmounts the parent dialog while exactly one child dialog is active", () => {
    expect(controllerSource).toContain("const activeSubdialog = computed");
    expect(source).toContain('v-if="open && book && !activeSubdialog"');
    expect(source).toContain("activeSubdialog === 'character-format'");
    expect(source).toContain("activeSubdialog === 'form'");
    expect(source).toContain("activeSubdialog === 'delete'");
    expect(source.match(/v-else-if=/g)).toHaveLength(3);
  });

  it("adds a per-book short or screenplay context tab with auto-save", () => {
    expect(source).toContain("activeStructureTab === 'context'");
    expect(source).toContain("短篇上下文");
    expect(source).toContain("剧本上下文");
    expect(source).toContain("<WritingContextPanel");
    expect(controllerSource).toContain("flushWritingContext");
    expect(contextPanelSource).toContain("切换页签或关闭结构管理时会自动保存");
  });
});
