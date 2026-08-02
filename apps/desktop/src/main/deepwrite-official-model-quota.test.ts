import { describe, expect, it, vi } from "vitest";
import type {
  AgentProviderRuntimeConfig,
  ModelUsageDashboard
} from "@deepwrite/contracts";
import {
  DEEPWRITE_OFFICIAL_QUOTA_EXHAUSTED_MESSAGE,
  assertDeepWriteOfficialQuotaAvailable
} from "./deepwrite-official-model-quota";

function runtimeConfig(
  managedBy?: AgentProviderRuntimeConfig["managedBy"]
): AgentProviderRuntimeConfig {
  return {
    id: managedBy === "deepwrite-official" ? "deepwrite-official-test" : "custom-test",
    label: "测试模型",
    provider: managedBy === "deepwrite-official" ? "deepseek-official" : "custom",
    modelId: "test-model",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low", "high", "max"],
    temperatureOptions: [0.7, 1, 1.5],
    ...(managedBy ? { managedBy } : {}),
    apiKey: "test-only"
  };
}

function dashboard(totalTokens: number): ModelUsageDashboard {
  return {
    generatedAt: "2026-08-02T00:00:00.000Z",
    totals: {
      inputTokens: totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens,
      requestCount: totalTokens > 0 ? 1 : 0
    },
    trendGranularity: "day",
    trend: [],
    models: [],
    modules: [],
    recentCalls: []
  };
}

describe("DeepWrite official model quota", () => {
  it("does not read official usage for non-official model calls", async () => {
    const query = vi.fn(async () => dashboard(10_000_000));

    await expect(
      assertDeepWriteOfficialQuotaAvailable({ query }, [runtimeConfig()])
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("allows an official call while at least one token remains", async () => {
    const query = vi.fn(async () => dashboard(9_999_999));

    await expect(
      assertDeepWriteOfficialQuotaAvailable(
        { query },
        [runtimeConfig("deepwrite-official")]
      )
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith({ managedBy: "deepwrite-official" });
  });

  it("stops an official call before dispatch when the quota is empty", async () => {
    const query = vi.fn(async () => dashboard(10_000_000));

    await expect(
      assertDeepWriteOfficialQuotaAvailable(
        { query },
        [runtimeConfig("deepwrite-official")]
      )
    ).rejects.toThrow(DEEPWRITE_OFFICIAL_QUOTA_EXHAUSTED_MESSAGE);
  });
});
