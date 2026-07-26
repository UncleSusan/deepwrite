import { describe, expect, it } from "vitest";
import source from "./WorkspaceDialog.vue?raw";

describe("WorkspaceDialog DeepWrite free models", () => {
  it("offers the managed provider and a remote model selector without a key field", () => {
    expect(source).toContain('{ value: "deepwrite-free", label: "DeepWrite 免费模型" }');
    expect(source).toContain('accessible-label="选择 DeepWrite 免费模型"');
    expect(source).toContain('v-if="!isDeepWriteFreeEditor" class="is-wide"');
    expect(source).toContain("运行环境提供密钥，无需在此填写");
  });

  it("keeps the managed source marker when saving a selected preset", () => {
    expect(source).toContain("managedBy: model.managedBy");
    expect(source).toContain("applyDeepWriteFreeModel");
  });

  it("renders the editor immediately after the model being edited", () => {
    expect(source).toContain('rows.push({ key: `model:${model.id}`, type: "model", model })');
    expect(source).toContain('rows.push({ key: `editor:${model.id}`, type: "editor" })');
    expect(source).toContain(
      '<template v-for="row in modelConfigRows" :key="row.key">'
    );
  });

  it("scrolls the model editor into view after opening it", () => {
    expect(source).toContain('ref="modelConfigScrollArea"');
    expect(source).toContain('?.scrollIntoView({ block: "nearest", behavior: "auto" })');
    expect(source.match(/scrollModelEditorIntoView\(\);/g)).toHaveLength(2);
  });
});
