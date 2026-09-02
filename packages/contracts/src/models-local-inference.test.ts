import { describe, expect, it } from "vitest";
import { ModelConfigInputSchema } from "./models";

const base = {
  id: "autodl-qwen",
  label: "AutoDL Qwen",
  provider: "ollama",
  modelId: "user-confirmed-model-id",
  api: "openai-completions" as const,
  baseUrl: "http://127.0.0.1:11434/v1",
  reasoning: false,
  defaultThinkingLevel: "off" as const,
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.25, 0.4, 0.8] as [number, number, number]
};

describe("local inference model settings", () => {
  it("accepts an AutoDL Ollama marker and a 1-2 concurrency limit", () => {
    expect(
      ModelConfigInputSchema.safeParse({
        ...base,
        deploymentTarget: "autodl-ollama",
        concurrencyLimit: 1
      }).success
    ).toBe(true);
    expect(
      ModelConfigInputSchema.safeParse({ ...base, concurrencyLimit: 2 }).success
    ).toBe(true);
  });

  it("rejects AutoDL and local concurrency metadata on another provider", () => {
    const result = ModelConfigInputSchema.safeParse({
      ...base,
      provider: "custom",
      deploymentTarget: "autodl-ollama",
      concurrencyLimit: 1
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ path }) => path[0])).toEqual(
        expect.arrayContaining(["deploymentTarget", "concurrencyLimit"])
      );
    }
  });
});
