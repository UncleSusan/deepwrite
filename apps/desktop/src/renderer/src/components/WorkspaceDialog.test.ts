import { describe, expect, it } from "vitest";
import source from "./WorkspaceDialog.vue?raw";

describe("WorkspaceDialog DeepWrite free models", () => {
  it("offers the managed provider and a remote model selector without a key field", () => {
    expect(source).toContain('{ value: "deepwrite-free", label: "DeepWrite 免费模型" }');
    expect(source).toContain('accessible-label="选择 DeepWrite 免费模型"');
    expect(source).toContain('emit(\'refreshFreeModels\')');
    expect(source).toContain('"刷新免费模型"');
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

describe("WorkspaceDialog provider presets", () => {
  it("offers Kimi Coding with its OpenAI-compatible API endpoint", () => {
    expect(source).toContain('{ value: "kimi-coding", label: "Kimi Coding" }');
    expect(source).toContain('provider === "kimi-coding"');
    expect(source).toContain('editor.api = "openai-completions"');
    expect(source).toContain('editor.baseUrl = "https://api.kimi.com/coding/v1"');
  });
});

describe("WorkspaceDialog official models", () => {
  it("keeps official models selectable but hides edit and delete actions", () => {
    expect(source).toContain("DeepWrite 官方模型");
    expect(source).toContain("row.model.managedBy !== 'deepwrite-official'");
    expect(source).toContain('requestModelId: model.requestModelId');
    expect(source).toContain('supportsDeveloperRole: model.supportsDeveloperRole');
  });

  it("shows the official model price notice in place of the configuration note", () => {
    expect(source).toContain('class="dialog-description model-price-notice"');
    expect(source).toContain('v-for="(message, index) in modelAlertMessages"');
    expect(source).toContain("{{ message }}");
    expect(source).not.toContain("官方模型已经上线！直连厂商！");
    expect(source).not.toContain("配置会同时用于连接测试与实际对话");
  });
});

describe("WorkspaceDialog model draft lifecycle", () => {
  it("hydrates saved models when the dialog mounts already active", () => {
    expect(source).toMatch(
      /watch\(\s*\(\) => \[props\.mode, props\.active\] as const,[\s\S]*?\{ immediate: true \}\s*\);/
    );
  });
});
