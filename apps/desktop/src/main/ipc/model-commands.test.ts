import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type ModelConfig,
  type ModelSettings
} from "@deepwrite/contracts";
import type { IpcCommandContext } from "./command-types";
import { handleModelCommands } from "./model-commands";

const freeModel: ModelConfig = {
  id: "deepwrite-free-writer",
  label: "Free Writer",
  provider: "deepwrite",
  modelId: "writer-v1",
  api: "openai-completions" as const,
  baseUrl: "https://models.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off" as const,
  thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
  temperatureOptions: [0.1, 0.7, 1],
  managedBy: "deepwrite-free",
  hasApiKey: true
};

function settings(): ModelSettings {
  return {
    models: [freeModel],
    defaultModelId: freeModel.id,
    deepwriteFreeModels: [freeModel],
    deepwriteFreeEnabledModelIds: [freeModel.id],
    deepwriteFreeDeprecatedModels: []
  };
}

describe("model commands", () => {
  it("synchronizes the usage registry after refreshing free models", async () => {
    const refreshFreeModels = vi.fn(async () => settings());
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ refreshFreeModels }),
      requireModelUsageStore: () => ({ syncConfiguredModels })
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope("models.refreshFree", {}, { id: "cmd_refresh_free" })
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: { deepwriteFreeEnabledModelIds: [freeModel.id] }
    });
    expect(syncConfiguredModels).toHaveBeenCalledWith([freeModel]);
    expect(refreshFreeModels.mock.invocationCallOrder[0]).toBeLessThan(
      syncConfiguredModels.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("updates free-model enablement and synchronizes configured models", async () => {
    const setFreeModelEnabled = vi.fn(async () => settings());
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ setFreeModelEnabled }),
      requireModelUsageStore: () => ({ syncConfiguredModels })
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.setFreeModelEnabled",
        { modelId: freeModel.id, enabled: true },
        { id: "cmd_enable_free" }
      )
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: { defaultModelId: freeModel.id }
    });
    expect(setFreeModelEnabled).toHaveBeenCalledWith(freeModel.id, true);
    expect(syncConfiguredModels).toHaveBeenCalledWith([freeModel]);
  });

  it("returns a focused error when free-model enablement is rejected", async () => {
    const setFreeModelEnabled = vi.fn(async () => {
      throw new Error("该免费模型当前不可用。");
    });
    const syncConfiguredModels = vi.fn(async () => undefined);
    const ctx = {
      requireModelConfigStore: () => ({ setFreeModelEnabled }),
      requireModelUsageStore: () => ({ syncConfiguredModels })
    } as unknown as IpcCommandContext;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.setFreeModelEnabled",
        { modelId: freeModel.id, enabled: true },
        { id: "cmd_enable_unavailable_free" }
      )
    );

    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "rejected",
      error: {
        code: "models.set_free_model_enabled_failed",
        message: "该免费模型当前不可用。"
      }
    });
    expect(syncConfiguredModels).not.toHaveBeenCalled();
  });
});
