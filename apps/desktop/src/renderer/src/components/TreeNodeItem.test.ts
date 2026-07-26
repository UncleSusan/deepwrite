import { describe, expect, it } from "vitest";
import source from "./TreeNodeItem.vue?raw";

describe("TreeNodeItem actions", () => {
  it("places add on the draft parent and delete in each section menu", () => {
    expect(source).toContain('props.node.shortAgentId === "expert_draft_coordinator"');
    expect(source).toContain('props.node.shortAgentId === "expert_section_writer"');
    expect(source).toContain("emit(\"createExpertSection\", props.node)");
    expect(source).toContain("emit(\"removeExpertSection\", props.node)");
    expect(source).toContain('props.node.workspaceType === "script" ? "剧集" : "小节"');
    expect(source).toContain(":title=\"`新建${draftUnitLabel}`\"");
    expect(source).toContain("<span>删除{{ draftUnitLabel }}</span>");
  });

  it("raises the whole action area while its menu is open", () => {
    expect(source).toContain(":class=\"{ 'is-menu-open': actionMenuOpen }\"");
    expect(source).toMatch(
      /\.tree-node-action-area\.is-menu-open\s*\{\s*z-index:\s*30;\s*\}/
    );
  });

  it("opens the manuscript export dialog below material binding without an inline format list", () => {
    expect(source).toContain("<span>导出正文</span>");
    expect(source).not.toContain("['docx', 'txt', 'epub'] as const");
    expect(source).toContain('emit("exportBook", props.node)');
    expect(source.indexOf("<span>导出正文</span>")).toBeGreaterThan(
      source.indexOf("<span>素材库绑定</span>")
    );
  });

  it("offers copy on library entries and paste on writable libraries", () => {
    expect(source).toContain('activateResourceNodeAction(\'copy-entry\')');
    expect(source).toContain("<span>复制</span>");
    expect(source).toContain('activateResourceNodeAction(\'paste-entry\')');
    expect(source).toContain("<span>粘贴</span>");
    expect(source).toContain("canPasteLibraryEntry");
    expect(source).toContain("libraryEntryClipboardDomain");
    expect(source).toContain("<span>删除条目文件</span>");
  });

  it("uses an independent action event for long-book nodes", () => {
    expect(source).toContain(
      'props.node.catalogNodeType === "long-book"'
    );
    expect(source).toContain(
      'node: node as LongBookResourceNodeActionPayload["node"]'
    );
    for (const action of [
      "manage-structure",
      "bind-skill",
      "bind-material",
      "unregister",
      "delete"
    ]) {
      expect(source).toContain(
        `activateLongBookAction('${action}')`
      );
    }
    const longActionFunction = source.slice(
      source.indexOf("function activateLongBookAction"),
      source.indexOf("function activateResourceNodeAction")
    );
    expect(longActionFunction).not.toContain('emit("bookAction"');
  });

  it("keeps reversible catalog actions neutral and marks disk deletion dangerous", () => {
    const longMenu = source.slice(
      source.indexOf(
        '<template v-else-if="hasLongBookAction">'
      ),
      source.indexOf(
        '<template v-else-if="hasBookAction">'
      )
    );
    expect(longMenu).toContain("<span>管理长篇结构</span>");
    expect(longMenu).toContain("<span>技能库绑定</span>");
    expect(longMenu).toContain("<span>素材库绑定</span>");
    expect(longMenu).not.toContain("导出可迁移项目");
    expect(longMenu).toContain(
      'activateLongBookAction(\'unregister\')'
    );
    expect(longMenu).toContain(
      'activateLongBookAction(\'delete\')'
    );
    expect(longMenu.match(/is-danger/gu)).toHaveLength(1);
  });
});
