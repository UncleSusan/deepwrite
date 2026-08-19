import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";
import type { DeepWriteOfficialModelCatalog } from "./deepwrite-official-model-config";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");
const temporaryRoots: string[] = [];

function managedModel(
  modelId: string,
  overrides: Partial<ModelConfigInput> = {}
): ModelConfigInput {
  return {
    id: "deepwrite-free-writing",
    label: "DeepWrite 免费模型",
    provider: "custom",
    modelId,
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    managedBy: "deepwrite-free",
    ...overrides
  };
}

function emptyCatalog(): DeepWriteFreeModelCatalog {
  return {
    revision: "",
    enabled: false,
    message: "",
    manifestAvailable: false,
    defaultModelId: "",
    models: [],
    apiKeys: {}
  };
}

function customModel(): ModelConfigInput {
  return {
    id: "custom-writer",
    label: "自定义写作模型",
    provider: "custom",
    modelId: "writer-v1",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1]
  };
}

function officialModel(
  overrides: Partial<ModelConfigInput> = {}
): ModelConfigInput {
  return {
    id: "deepwrite-deepseek-v4-flash",
    label: "官方模型-DeepSeekFlash正式版本",
    provider: "deepseek-official",
    modelId: "deepseek-v4-flash-202605",
    api: "openai-completions",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    reasoning: true,
    supportsDeveloperRole: false,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "high", "max"],
    temperatureOptions: [0.7, 1, 1.5],
    managedBy: "deepwrite-official",
    ...overrides
  };
}

function officialCatalog(
  models: ModelConfigInput[] = [officialModel()]
): DeepWriteOfficialModelCatalog {
  return {
    revision: "remote-v1",
    enabled: true,
    message: "",
    manifestAvailable: true,
    defaultModelId: models[0]?.id ?? "",
    models
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("ModelConfigStore official models", () => {
  it("encrypts one official token, injects immutable models first, and removes them with the token", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-official-model-store-")
    );
    temporaryRoots.push(root);
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => emptyCatalog()
    };
    const remoteOfficialCatalog = officialCatalog();
    const officialModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(remoteOfficialCatalog),
      refreshCatalog: async () => structuredClone(remoteOfficialCatalog)
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog,
      officialModelCatalog
    });
    await store.save({
      models: [customModel()],
      defaultModelId: "custom-writer"
    });

    const saved = await store.saveOfficialToken("sk-official-test-only");
    expect(saved.deepwriteOfficialTokenConfigured).toBe(true);
    expect(saved.models.map((model) => model.id)).toEqual([
      "deepwrite-deepseek-v4-flash",
      "custom-writer"
    ]);
    expect(saved.defaultModelId).toBe("custom-writer");
    expect(saved.models[0]).toMatchObject({
      label: "官方模型-DeepSeekFlash正式版本",
      modelId: "deepseek-v4-flash-202605",
      baseUrl: "https://tokenhub.tencentmaas.com/v1",
      supportsDeveloperRole: false,
      hasApiKey: true,
      managedBy: "deepwrite-official"
    });

    const resolved = await store.resolve("deepwrite-deepseek-v4-flash");
    expect(resolved).toMatchObject({
      modelId: "deepseek-v4-flash-202605",
      supportsDeveloperRole: false,
      apiKey: "sk-official-test-only"
    });
    const resaved = await store.save({
      models: [
        customModel(),
        {
          ...saved.models[0]!,
          label: "不应保存的名称",
          baseUrl: "https://invalid.example.test/v1"
        }
      ],
      defaultModelId: "deepwrite-deepseek-v4-flash"
    });
    expect(resaved.models[0]).toMatchObject({
      label: "官方模型-DeepSeekFlash正式版本",
      baseUrl: "https://tokenhub.tencentmaas.com/v1"
    });
    expect(resaved.defaultModelId).toBe("deepwrite-deepseek-v4-flash");
    const secrets = await readFile(
      join(root, "config", "model-secrets.json"),
      "utf8"
    );
    expect(secrets).not.toContain("sk-official-test-only");

    const cleared = await store.clearOfficialToken();
    expect(cleared.deepwriteOfficialTokenConfigured).toBe(false);
    expect(cleared.models.map((model) => model.id)).toEqual(["custom-writer"]);
    expect(cleared.defaultModelId).toBe("custom-writer");
    expect(cleared.deepwriteOfficialModels?.[0]).toMatchObject({
      modelId: "deepseek-v4-flash-202605",
      hasApiKey: false
    });
  });

  it("replaces the read-only official entries when the refreshed remote catalog changes", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-official-refresh-store-")
    );
    temporaryRoots.push(root);
    const remoteOfficialCatalog = officialCatalog();
    let refreshCount = 0;
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      },
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(remoteOfficialCatalog),
        refreshCatalog: async () => {
          refreshCount += 1;
          return structuredClone(remoteOfficialCatalog);
        }
      }
    });
    await store.saveOfficialToken("sk-official-refresh-test");
    await store.save({
      models: [officialModel(), customModel()],
      defaultModelId: "deepwrite-deepseek-v4-flash"
    });

    remoteOfficialCatalog.revision = "remote-v2";
    remoteOfficialCatalog.models = [
      officialModel({
        id: "deepwrite-deepseek-v4-flash-next",
        label: "远程更新后的官方模型",
        modelId: "deepseek-v4-flash-next"
      })
    ];
    remoteOfficialCatalog.defaultModelId = "deepwrite-deepseek-v4-flash-next";

    const refreshed = await store.refreshOfficialModels();
    expect(refreshCount).toBe(1);
    expect(refreshed.models.map((model) => model.id)).toEqual([
      "deepwrite-deepseek-v4-flash-next",
      "custom-writer"
    ]);
    expect(refreshed.models[0]?.label).toBe("远程更新后的官方模型");
    expect(refreshed.defaultModelId).toBe("deepwrite-deepseek-v4-flash-next");
  });

  it("persists per-model enablement and exposes only enabled official models in model settings", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-official-enabled-store-")
    );
    temporaryRoots.push(root);
    const first = officialModel();
    const second = officialModel({
      id: "deepwrite-second-official",
      label: "第二个官方模型",
      modelId: "second-official"
    });
    const unavailable = officialModel({
      id: "deepwrite-unavailable-official",
      label: "暂不可用官方模型",
      modelId: "unavailable-official",
      status: 1
    });
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      },
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => officialCatalog([first, second, unavailable])
      }
    });

    const initial = await store.saveOfficialToken("sk-official-enabled-test");
    expect(initial.deepwriteOfficialModels?.map((model) => model.id)).toEqual([
      first.id,
      second.id,
      unavailable.id
    ]);
    expect(initial.deepwriteOfficialEnabledModelIds).toEqual([
      first.id,
      second.id
    ]);
    expect(initial.models.map((model) => model.id)).toEqual([
      first.id,
      second.id
    ]);
    await expect(
      store.setOfficialModelEnabled(unavailable.id, true)
    ).rejects.toThrow(/当前不可用/u);
    const disabled = await store.setOfficialModelEnabled(first.id, false);
    expect(disabled.deepwriteOfficialEnabledModelIds).toEqual([second.id]);
    expect(disabled.models.map((model) => model.id)).toEqual([second.id]);

    await store.save({
      models: disabled.models,
      defaultModelId: second.id
    });

    const reloaded = await store.list();
    expect(reloaded.models.map((model) => model.id)).toEqual([second.id]);
    expect(reloaded.defaultModelId).toBe(second.id);

    const restartedStore = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => emptyCatalog()
      },
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => officialCatalog([first, second, unavailable])
      }
    });
    const afterRestart = await restartedStore.list();
    expect(afterRestart.defaultModelId).toBe(second.id);
    expect(afterRestart.models.map((model) => model.id)).toEqual([second.id]);

    const enabled = await store.setOfficialModelEnabled(first.id, true);
    expect(enabled.models.map((model) => model.id)).toEqual([
      first.id,
      second.id
    ]);
  });
});

describe("ModelConfigStore managed free models", () => {
  it("stores a remotely configured key locally and resolves through the latest catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-"));
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: { "deepwrite-free-writing": "sk-test-only" }
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });

    const saved = await store.save({
      models: [managedModel("vendor/writer-v1")],
      defaultModelId: "deepwrite-free-writing"
    });
    expect(saved.models[0]).toMatchObject({
      modelId: "vendor/writer-v1",
      hasApiKey: true,
      managedBy: "deepwrite-free"
    });
    expect(saved.models[0]).not.toHaveProperty("apiKey");

    catalog.revision = "v2";
    catalog.models = [
      managedModel("vendor/writer-v2", {
        provider: "deepseek",
        api: "openai-responses",
        baseUrl: "https://example.invalid/v1"
      })
    ];
    const resolved = await store.resolve("deepwrite-free-writing");
    expect(resolved).toMatchObject({
      modelId: "vendor/writer-v2",
      provider: "deepseek",
      api: "openai-responses",
      baseUrl: "https://example.invalid/v1"
    });
    expect(resolved?.apiKey).toBe("sk-test-only");
    const secrets = await readFile(
      join(root, "config", "model-secrets.json"),
      "utf8"
    );
    expect(secrets).not.toContain("sk-test-only");

    const listed = await store.list();
    expect(listed.models[0]?.modelId).toBe("vendor/writer-v2");
    expect(listed.deepwriteFreeModels?.[0]?.hasApiKey).toBe(true);
    expect(listed.deepwriteFreeModels?.[0]).not.toHaveProperty("apiKey");
  });

  it("resolves a remotely configured model that is not an OpenRouter free id", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-paid-"));
    temporaryRoots.push(root);
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async (): Promise<DeepWriteFreeModelCatalog> => ({
        revision: "v1",
        enabled: true,
        message: "",
        manifestAvailable: true,
        defaultModelId: "deepwrite-free-writing",
        models: [
          managedModel("vendor/paid-model", {
            provider: "deepseek",
            baseUrl: "https://example.invalid/v1"
          })
        ],
        apiKeys: {}
      })
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });

    await expect(
      store.resolveDraft(managedModel("vendor/paid-model"))
    ).resolves.toMatchObject({
      modelId: "vendor/paid-model",
      provider: "deepseek",
      baseUrl: "https://example.invalid/v1",
      managedBy: "deepwrite-free"
    });
  });
});

describe("ModelConfigStore draft API keys", () => {
  it("persists and resolves an explicit portable tool schema profile", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-tool-schema-")
    );
    temporaryRoots.push(root);
    const store = new ModelConfigStore(root);
    const saved = await store.save({
      models: [
        {
          ...customModel(),
          toolSchemaProfile: "portable",
          apiKey: "sk-portable-test-only"
        }
      ],
      defaultModelId: "custom-writer"
    });

    expect(saved.models[0]).toMatchObject({
      id: "custom-writer",
      toolSchemaProfile: "portable"
    });
    await expect(store.resolve("custom-writer")).resolves.toMatchObject({
      toolSchemaProfile: "portable"
    });
  });

  it("reuses a saved key when the draft key field is blank", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-draft-key-")
    );
    temporaryRoots.push(root);
    const store = new ModelConfigStore(root);
    await store.save({
      models: [{ ...customModel(), apiKey: "sk-saved-test-only" }],
      defaultModelId: "custom-writer"
    });

    await expect(
      store.resolveDraftApiKey({ id: "custom-writer" })
    ).resolves.toBe("sk-saved-test-only");
    await expect(
      store.resolveDraftApiKey({
        id: "custom-writer",
        apiKey: "sk-typed-test-only"
      })
    ).resolves.toBe("sk-typed-test-only");
    await expect(
      store.resolveDraftApiKey({ id: "custom-writer", clearApiKey: true })
    ).resolves.toBe("");
  });
});
