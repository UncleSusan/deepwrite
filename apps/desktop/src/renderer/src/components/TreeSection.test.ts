import { describe, expect, it } from "vitest";
import sidebarSource from "./LeftSidebar.vue?raw";
import source from "./TreeSection.vue?raw";

describe("TreeSection resource actions", () => {
  it("offers legacy library import from the skill and material add menus", () => {
    expect(source).toContain('id: "import-legacy-library"');
    expect(source).toContain('label: `导入旧版${resourceName}`');
    expect(source).toContain('icon: "archive"');
  });

  it("keeps short-book actions and adds explicit long open and migration actions", () => {
    expect(source).toContain('{ id: "create", label: `新建${resourceName}`');
    expect(source).toContain(
      '{ id: "import", label: `打开已存在${resourceName}`'
    );
    expect(source).toContain('id: "import-legacy-book"');
    expect(source).toContain('id: "open-long-book"');
    expect(source).toContain('label: "打开已存在长篇"');
    expect(source).toContain('id: "import-portable-long-book"');
    expect(source).toContain('label: "导入 DeepWrite 长篇工程"');
    expect(source).toContain('id: "migrate-write-claw-long-book"');
    expect(source).toContain('label: "迁移 Write Claw 长篇"');
  });

  it("forwards the independent long-book node action through the sidebar", () => {
    expect(source).toContain(
      "@long-book-action=\"emit('longBookAction', $event)\""
    );
    expect(sidebarSource.match(/@long-book-action=/gu)).toHaveLength(2);
    expect(sidebarSource).toContain(
      "longBookAction: [payload: LongBookResourceNodeActionPayload]"
    );
  });
});
