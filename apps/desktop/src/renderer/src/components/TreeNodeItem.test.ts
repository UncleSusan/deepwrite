import { describe, expect, it } from "vitest";
import source from "./TreeNodeItem.vue?raw";

describe("TreeNodeItem actions", () => {
  it("uses the shared neutral badge style for every workspace type", () => {
    expect(source).toContain('class="tree-badge"');
    expect(source).not.toContain("'is-script': node.workspaceType === 'script'");
  });

  it("selects a selectable branch immediately whether it opens or collapses", () => {
    expect(source).toContain("open.value = !open.value;");
    expect(source).toContain("if (props.node.selectableBranch)");
    expect(source).not.toContain("opening && props.node.selectableBranch");
  });

  it("places add on the draft parent and ordering plus delete in each section menu", () => {
    expect(source).toContain('props.node.shortAgentId === "expert_draft_coordinator"');
    expect(source).toContain("!props.node.expertSectionId");
    expect(source).toContain("Boolean(props.node.expertSectionId)");
    expect(source).toContain("emit(\"createExpertSection\", props.node)");
    expect(source).toContain("emit(\"removeExpertSection\", props.node)");
    expect(source).toContain("expertSectionAction('move-up')");
    expect(source).toContain("expertSectionAction('move-down')");
    expect(source).toContain(":disabled=\"expertSectionMoveUpDisabled\"");
    expect(source).toContain(":disabled=\"expertSectionMoveDownDisabled\"");
    expect(source).toContain('props.node.workspaceType === "script" ? "剧集" : "小节"');
    expect(source).toContain("isCharacterDirectory ? '新建人物条目' : `新建${draftUnitLabel}`");
    expect(source).toContain("<span>删除{{ draftUnitLabel }}</span>");
  });

  it("provides character item creation and ordered item actions", () => {
    expect(source).toContain("createCharacterItem");
    expect(source).toContain("characterItemAction('rename')");
    expect(source).toContain("characterItemAction('move-up')");
    expect(source).toContain("characterItemAction('move-down')");
    expect(source).toContain("characterItemAction('delete')");
  });

  it("keeps long character creation out of the resource tree", () => {
    expect(source).not.toContain("isLongCharacterGroup");
    expect(source).not.toContain('title="新增人物"');
    expect(source).not.toContain("createLongCharacter");
  });

  it("raises the whole action area while its menu is open", () => {
    expect(source).toContain(":class=\"{ 'is-menu-open': actionMenuOpen }\"");
    expect(source).toMatch(
      /\.tree-node-action-area\.is-menu-open\s*\{\s*z-index:\s*30;\s*\}/
    );
  });

  it("opens the action menu upward when the sidebar has more room above", () => {
    expect(source).toContain('area.closest<HTMLElement>(".sidebar-scroll")');
    expect(source).toContain(
      "menuHeight > availableBelow && availableAbove > availableBelow"
    );
    expect(source).toContain(":class=\"{ 'opens-upward': actionMenuOpensUpward }\"");
    expect(source).toMatch(
      /\.tree-node-action-menu\.opens-upward\s*\{\s*top:\s*auto;\s*bottom:\s*calc\(100% \+ 3px\);\s*\}/
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

  it("offers library and entry rename plus same-domain drag and drop", () => {
    expect(source).toContain("rename-library");
    expect(source).toContain("rename-entry");
    expect(source).toContain("application/x-deepwrite-library-entry-");
    expect(source).toContain("moveLibraryEntry");
    expect(source).toContain("beforeEntryId");
  });

  it("uses an independent action event for long-book nodes", () => {
    expect(source).toContain(
      'props.node.catalogNodeType === "long-book"'
    );
    expect(source).toContain(
      'node: node as LongBookResourceNodeActionPayload["node"]'
    );
    for (const action of [
      "sync-legacy",
      "manage-structure",
      "rename",
      "duplicate",
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

  it("offers direct project duplication for books, libraries and groups", () => {
    expect(source).toContain("openBookAction('duplicate')");
    expect(source).toContain("activateLongBookAction('duplicate')");
    expect(source).toContain("activateResourceNodeAction('duplicate-library')");
    expect(source).toContain("activateResourceNodeAction('duplicate-group')");
    expect(source).toContain('v-if="!node.unavailable"');
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
    expect(longMenu).toContain("<span>结构管理</span>");
    expect(longMenu).toContain("<span>同步旧版本</span>");
    expect(longMenu.indexOf("<span>同步旧版本</span>")).toBeGreaterThan(
      longMenu.indexOf("<span>导出</span>")
    );
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

  it("keeps long-form content operations out of the resource tree menu", () => {
    expect(source).not.toContain("isLongStructureItem");
    expect(source).not.toContain("activateLongStructureAction");
    expect(source).not.toContain("longStructureAction");
  });
});
