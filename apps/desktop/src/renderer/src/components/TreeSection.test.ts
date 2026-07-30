import { describe, expect, it } from "vitest";
import sidebarSource from "./LeftSidebar.vue?raw";
import source from "./TreeSection.vue?raw";

describe("TreeSection resource actions", () => {
  it("offers legacy library import from the skill and material add menus", () => {
    expect(source).toContain('id: "import-legacy-library"');
    expect(source).toContain('label: `导入旧版${resourceName}`');
    expect(source).toContain('icon: "archive"');
  });

  it("uses unified creation, opening, and importing entries", () => {
    expect(source).toContain('props.section.id === "creation" ? "新建作品"');
    expect(source).not.toContain('id: "create-long-book"');
    expect(source).toContain('id: props.section.id === "creation" ? "choose-open-book" : "import"');
    expect(source).toContain('"打开已有作品"');
    expect(source).toContain('id: "choose-import-book"');
    expect(source).toContain('label: "导入作品"');
    expect(source).not.toContain('label: "打开已存在长篇"');
    expect(source).not.toContain('label: "导入 DeepWrite 长篇工程"');
    expect(source).not.toContain('label: "迁移 Write Claw 长篇"');
    expect(source).not.toContain('label: "导入旧版书籍"');
  });

  it("forwards the independent long-book node action through the sidebar", () => {
    expect(source).toContain(
      "@long-book-action=\"emit('longBookAction', $event)\""
    );
    expect(sidebarSource.match(/@long-book-action=/gu)).toHaveLength(2);
    expect(source).not.toContain("longStructureAction");
    expect(sidebarSource).not.toContain("longStructureAction");
    expect(sidebarSource).toContain(
      "longBookAction: [payload: LongBookResourceNodeActionPayload]"
    );
  });
});
