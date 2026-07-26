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

  it("renders the editor above the configured model list", () => {
    expect(source.indexOf('<section v-if="modelEditor" class="model-editor">')).toBeLessThan(
      source.indexOf('v-for="model in draftModels"')
    );
  });

  it("scrolls the model editor into view after opening it", () => {
    expect(source).toContain('ref="modelConfigScrollArea"');
    expect(source).toContain('modelConfigScrollArea.value?.scrollTo({ top: 0, behavior: "auto" })');
    expect(source.match(/scrollModelEditorToTop\(\);/g)).toHaveLength(2);
  });
});

describe("WorkspaceDialog provider presets", () => {
  it("offers Kimi Coding with its OpenAI-compatible API endpoint", () => {
    expect(source).toContain('{ value: "kimi-coding", label: "Kimi Coding" }');
    expect(source).toContain('provider === "kimi-coding"');
    expect(source).toContain('editor.api = "openai-completions"');
    expect(source).toContain('editor.baseUrl = "https://api.kimi.com/coding/v1"');
  });
});
