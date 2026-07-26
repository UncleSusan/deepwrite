import { describe, expect, it } from "vitest";
import appSource from "../App.vue?raw";
import dialogSource from "./BookResourceDialog.vue?raw";

describe("BookResourceDialog binding editor", () => {
  it("matches the create-book binding layout and supports category or group selection", () => {
    expect(dialogSource).toContain("create-short-binding-panel");
    expect(dialogSource).toContain("create-short-binding-modes");
    expect(dialogSource).toContain("create-short-kind-grid");
    expect(dialogSource).toContain("create-short-group-picker");
    expect(dialogSource).toContain("按分类选择");
    expect(dialogSource).toContain("选择分组");
  });

  it("submits categorized bindings without flattening away their purpose", () => {
    expect(dialogSource).toContain('domain: "material"');
    expect(dialogSource).toContain('domain: "skill"');
    expect(dialogSource).toContain("linksByKind");
    expect(appSource).toContain("linkedSkillIdsByKind: payload.linksByKind");
    expect(appSource).toContain("linkedMaterialIdsByKind: payload.linksByKind");
  });

  it("only offers libraries matching the active short or script book", () => {
    expect(appSource).toContain('activeBook.value?.workspaceType ?? "short"');
    expect(appSource).toContain("library.skillType === workspaceType");
    expect(appSource).toContain("library.materialType === workspaceType");
    expect(dialogSource).toContain('props.book?.workspaceType === "script"');
  });
});
