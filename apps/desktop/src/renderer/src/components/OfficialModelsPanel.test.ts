import { describe, expect, it } from "vitest";
import source from "./OfficialModelsPanel.vue?raw";

describe("OfficialModelsPanel", () => {
  it("adds one protected token and presents the default official quota", () => {
    expect(source).toContain("添加你的官方令牌");
    expect(source).toContain('type="password"');
    expect(source).toContain('autocomplete="new-password"');
    expect(source).toContain('emit("saveToken", apiKey)');
    expect(source).toContain("10_000_000");
    expect(source).toContain("默认额度");
    expect(source).toContain("令牌明文不会回传到页面");
    expect(source).toContain("emit('load')");
  });

  it("shows total, input, output, and cache use for every official model", () => {
    expect(source).toContain("支撑的模型列表");
    expect(source).toContain("总消耗");
    expect(source).toContain("输入");
    expect(source).toContain("输出");
    expect(source).toContain("缓存");
    expect(source).toContain("cacheReadTokens");
    expect(source).toContain("cacheWriteTokens");
    expect(source).toContain("用量来自本地账本");
    expect(source).toContain("quotaExhausted");
    expect(source).toContain("额度耗尽");
  });
});
