import { describe, expect, it } from "vitest";
import { findDeepWriteRuntimeModel } from "./runtime-model-catalog";

describe("DeepWrite runtime model catalog", () => {
  it("matches provider route suffixes by model id prefix", () => {
    expect(findDeepWriteRuntimeModel("deepseek-v4-flash-0731-high")?.id).toBe(
      "deepseek-v4-flash-0731"
    );
  });

  it("prefers the longest matching prefix", () => {
    expect(findDeepWriteRuntimeModel("deepseek-v4-flash-0731-preview")?.id).toBe(
      "deepseek-v4-flash-0731"
    );
  });

  it("keeps prefix matching case-insensitive", () => {
    expect(findDeepWriteRuntimeModel("DEEPSEEK-V4-FLASH-ROUTED")?.id).toBe(
      "deepseek-v4-flash"
    );
  });

  it("does not match an unrelated model id", () => {
    expect(findDeepWriteRuntimeModel("unrelated-model-route")).toBeUndefined();
  });
});
