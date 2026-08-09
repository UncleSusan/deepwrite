import { describe, expect, it } from "vitest";
import source from "./CreateLongChapterCardDialog.vue?raw";

describe("CreateLongChapterCardDialog", () => {
  it("uses a focused create form instead of the full structure manager", () => {
    expect(source).toContain("新建章卡");
    expect(source).toContain("章卡标题");
    expect(source).toContain("关联剧情点（可选）");
    expect(source).toContain("不关联剧情点");
    expect(source).toContain('uiMessage.warning("请输入章卡标题。")');
    expect(source).toContain("<PopupSelect");
    expect(source).not.toContain("<select");
    expect(source).toContain("<Teleport to=\"body\">");
    expect(source).not.toContain("LongStructureManager");
  });

  it("submits the title with an optional plot point", () => {
    expect(source).toContain(
      "submit: [input: { title: string; primaryArcId: string | null }]"
    );
    expect(source).toContain("title: normalizedTitle");
    expect(source).toContain("primaryArcId: primaryArcId.value || null");
    expect(source).toContain('primaryArcId.value = ""');
    expect(source).not.toContain("请选择主剧情点");
  });
});
