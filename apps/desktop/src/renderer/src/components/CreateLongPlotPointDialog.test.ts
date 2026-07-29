import { describe, expect, it } from "vitest";
import source from "./CreateLongPlotPointDialog.vue?raw";

describe("CreateLongPlotPointDialog", () => {
  it("opens a focused plot-point form in a themed overlay", () => {
    expect(source).toContain("新建剧情点");
    expect(source).toContain("剧情点名称");
    expect(source).toContain("概要");
    expect(source).toContain("故事情节");
    expect(source).toContain(
      'uiMessage.warning("请输入剧情点名称。")'
    );
    expect(source).toContain("<Teleport to=\"body\">");
    expect(source).not.toContain("LongStructureManager");
  });

  it("submits all editable plot-point fields", () => {
    expect(source).toContain(
      "submit: [input: { title: string; summary: string; outline: string }]"
    );
    expect(source).toContain("title: normalizedTitle");
    expect(source).toContain("summary: summary.value");
    expect(source).toContain("outline: outline.value");
  });
});
