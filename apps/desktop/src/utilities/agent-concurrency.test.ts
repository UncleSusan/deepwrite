import { describe, expect, it } from "vitest";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import {
  MAX_ACTIVE_AGENT_RUNS,
  resolveAgentRunAdmission,
  resolveConcurrencyModel
} from "./agent-concurrency";

function config(
  overrides: Partial<AgentProviderRuntimeConfig> = {}
): AgentProviderRuntimeConfig {
  return {
    id: "autodl-qwen",
    label: "AutoDL Qwen",
    provider: "ollama",
    modelId: "user-confirmed-model-id",
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:11434/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.25, 0.4, 0.8],
    apiKey: "",
    ...overrides
  };
}

describe("resolveAgentRunAdmission", () => {
  it("serializes Ollama by default", () => {
    const result = resolveAgentRunAdmission(["autodl-qwen"], config());
    expect(result).toMatchObject({ allowed: false, limit: 1 });
    expect(result.message).toContain("Ollama 模型并发已达到 1");
  });

  it("allows two Ollama runs only when explicitly configured", () => {
    const custom = config({ concurrencyLimit: 2 });
    expect(resolveAgentRunAdmission(["autodl-qwen"], custom).allowed).toBe(
      true
    );
    expect(
      resolveAgentRunAdmission(["autodl-qwen", "autodl-qwen"], custom)
    ).toMatchObject({ allowed: false, limit: 2 });
  });

  it("retains the global utility limit for all providers", () => {
    expect(
      resolveAgentRunAdmission(
        Array.from({ length: MAX_ACTIVE_AGENT_RUNS }, (_, index) =>
          String(index)
        ),
        config({ id: "next" })
      )
    ).toMatchObject({ allowed: false, limit: MAX_ACTIVE_AGENT_RUNS });
  });

  it("uses a custom Ollama child as the team concurrency owner", () => {
    const cloud = config({
      id: "cloud-parent",
      provider: "custom",
      baseUrl: "https://example.test/v1"
    });
    expect(
      resolveConcurrencyModel(cloud, { "autodl-qwen": config() })
    ).toMatchObject({ id: "autodl-qwen", provider: "ollama" });
  });
});
