import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    canDeprecateMissingModels: false,
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
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: { "deepwrite-free-writing": "sk-test-only" }
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });

    const initial = await store.list();
    expect(initial.models).toEqual([]);
    expect(initial.deepwriteFreeEnabledModelIds).toEqual([]);

    const saved = await store.setFreeModelEnabled(
      "deepwrite-free-writing",
      true
    );
    expect(saved.models[0]).toMatchObject({
      modelId: "vendor/writer-v1",
      hasApiKey: true,
      managedBy: "deepwrite-free"
    });
    expect(saved.deepwriteFreeEnabledModelIds).toEqual([
      "deepwrite-free-writing"
    ]);
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
        canDeprecateMissingModels: true,
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

  it("migrates v1 managed models as enabled and persists the v2 layout", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-v1-")
    );
    temporaryRoots.push(root);
    const configDirectory = join(root, "config");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      join(configDirectory, "models.json"),
      `${JSON.stringify({
        version: 1,
        defaultModelId: "deepwrite-free-writing",
        models: [managedModel("vendor/writer-v1"), customModel()],
        disabledOfficialModelIds: []
      })}\n`,
      "utf8"
    );
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog)
      }
    });

    const settings = await store.list();
    expect(settings.deepwriteFreeEnabledModelIds).toEqual([
      "deepwrite-free-writing"
    ]);
    expect(settings.models.map((model) => model.id)).toEqual([
      "deepwrite-free-writing",
      "custom-writer"
    ]);
    expect(settings.defaultModelId).toBe("deepwrite-free-writing");

    const disk = JSON.parse(
      await readFile(join(configDirectory, "models.json"), "utf8")
    ) as Record<string, unknown>;
    expect(disk).toMatchObject({
      version: 2,
      enabledFreeModelIds: ["deepwrite-free-writing"]
    });
    expect(disk).toHaveProperty("knownFreeModels");
    expect(JSON.stringify(disk)).not.toContain("apiKey");
  });

  it("deprecates only after an authoritative removal and keeps a reappearing id disabled", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-deprecated-")
    );
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog),
      refreshCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });
    await store.save({
      models: [customModel()],
      defaultModelId: "custom-writer"
    });
    await store.setFreeModelEnabled("deepwrite-free-writing", true);

    catalog.revision = "v2";
    catalog.models = [];
    catalog.defaultModelId = "";
    const removed = await store.refreshFreeModels();
    expect(removed.deepwriteFreeEnabledModelIds).toEqual([]);
    expect(removed.deepwriteFreeDeprecatedModels).toEqual([
      expect.objectContaining({
        id: "deepwrite-free-writing",
        modelId: "vendor/writer-v1",
        hasApiKey: false
      })
    ]);
    expect(removed.models.map((model) => model.id)).toEqual(["custom-writer"]);
    expect(removed.defaultModelId).toBe("custom-writer");

    catalog.revision = "v3";
    catalog.models = [managedModel("vendor/writer-v3")];
    catalog.defaultModelId = "deepwrite-free-writing";
    const returned = await store.refreshFreeModels();
    expect(returned.deepwriteFreeDeprecatedModels).toEqual([]);
    expect(returned.deepwriteFreeEnabledModelIds).toEqual([]);
    expect(returned.deepwriteFreeModels?.[0]?.modelId).toBe("vendor/writer-v3");
    expect(returned.models.map((model) => model.id)).toEqual(["custom-writer"]);
  });

  it("keeps history for a catalog model that was never enabled", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-never-enabled-")
    );
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/never-enabled")],
      apiKeys: { "deepwrite-free-writing": "never-enabled-secret" }
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog),
        refreshCatalog: async () => structuredClone(catalog)
      }
    });

    const initial = await store.list();
    expect(initial.models).toEqual([]);
    expect(initial.deepwriteFreeEnabledModelIds).toEqual([]);
    catalog.revision = "v2";
    catalog.defaultModelId = "";
    catalog.models = [];
    catalog.apiKeys = {};

    const removed = await store.refreshFreeModels();
    expect(removed.deepwriteFreeDeprecatedModels).toEqual([
      expect.objectContaining({
        id: "deepwrite-free-writing",
        modelId: "vendor/never-enabled"
      })
    ]);
    const secrets = JSON.parse(
      await readFile(join(root, "config", "model-secrets.json"), "utf8")
    ) as { encryptedApiKeys: Record<string, string> };
    expect(secrets.encryptedApiKeys).not.toHaveProperty(
      "deepwrite-free-writing"
    );
  });

  it("retains enablement without deprecating during pause or a non-authoritative cache fallback", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-pause-")
    );
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog),
      refreshCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });
    await store.setFreeModelEnabled("deepwrite-free-writing", true);

    catalog.enabled = false;
    catalog.message = "暂停服务";
    catalog.canDeprecateMissingModels = false;
    catalog.models = [
      managedModel("vendor/paused-v2"),
      managedModel("vendor/paused-new", {
        id: "deepwrite-free-new",
        label: "新免费模型"
      })
    ];
    catalog.defaultModelId = "deepwrite-free-writing";
    const paused = await store.refreshFreeModels();
    expect(paused.deepwriteFreeEnabledModelIds).toEqual([
      "deepwrite-free-writing"
    ]);
    expect(paused.deepwriteFreeDeprecatedModels).toEqual([]);
    expect(paused.models).toEqual([]);
    expect(paused.deepwriteFreeModels).toEqual([
      expect.objectContaining({
        id: "deepwrite-free-writing",
        modelId: "vendor/paused-v2",
        status: 1
      }),
      expect.objectContaining({ id: "deepwrite-free-new", status: 1 })
    ]);

    catalog.enabled = true;
    catalog.message = "";
    catalog.models = [managedModel("vendor/cached")];
    const cached = await store.refreshFreeModels();
    expect(cached.deepwriteFreeEnabledModelIds).toEqual([
      "deepwrite-free-writing"
    ]);
    expect(cached.deepwriteFreeDeprecatedModels).toEqual([]);
    expect(cached.models[0]?.modelId).toBe("vendor/cached");
  });

  it("requires exact, available ids while allowing idempotent disable", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-exact-")
    );
    temporaryRoots.push(root);
    const unavailable = managedModel("vendor/unavailable", {
      id: "deepwrite-free-unavailable",
      status: 1
    });
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/default"), unavailable],
      apiKeys: {}
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog)
      }
    });

    await expect(
      store.setFreeModelEnabled("deepwrite-free-missing", true)
    ).rejects.toThrow(/废弃|不再受支持/u);
    await expect(
      store.setFreeModelEnabled(unavailable.id, true)
    ).rejects.toThrow(/当前不可用/u);
    await expect(
      store.resolveDraft(
        managedModel("vendor/ignored", { id: "deepwrite-free-missing" })
      )
    ).rejects.toThrow(/废弃|不再受支持/u);
    await expect(
      store.setFreeModelEnabled("deepwrite-free-missing", false)
    ).resolves.toMatchObject({ deepwriteFreeEnabledModelIds: [] });
  });

  it("serializes refresh and enable so an old catalog cannot revive a removed model", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-race-")
    );
    temporaryRoots.push(root);
    let current: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(current),
        refreshCatalog: async () => {
          markRefreshStarted();
          await refreshGate;
          current = {
            ...current,
            revision: "v2",
            defaultModelId: "",
            models: [],
            apiKeys: {}
          };
          return structuredClone(current);
        }
      }
    });
    await store.setFreeModelEnabled("deepwrite-free-writing", true);

    const refresh = store.refreshFreeModels();
    await refreshStarted;
    const staleEnable = store.setFreeModelEnabled(
      "deepwrite-free-writing",
      true
    );
    const staleEnableRejected =
      expect(staleEnable).rejects.toThrow(/废弃|不再受支持/u);
    const concurrentSave = store.save({
      models: [customModel()],
      defaultModelId: "custom-writer"
    });
    releaseRefresh();

    await expect(refresh).resolves.toMatchObject({
      deepwriteFreeEnabledModelIds: [],
      deepwriteFreeDeprecatedModels: [
        expect.objectContaining({ id: "deepwrite-free-writing" })
      ]
    });
    await staleEnableRejected;
    await expect(concurrentSave).resolves.toMatchObject({
      defaultModelId: "custom-writer",
      deepwriteFreeDeprecatedModels: [
        expect.objectContaining({ id: "deepwrite-free-writing" })
      ]
    });
    const finalSettings = await store.list();
    expect(finalSettings.models.map((model) => model.id)).toEqual([
      "custom-writer"
    ]);
    expect(finalSettings.deepwriteFreeDeprecatedModels).toHaveLength(1);
  });

  it("deletes deprecated encrypted keys and does not reuse them after a keyless reappearance", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-free-secret-retirement-")
    );
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: { "deepwrite-free-writing": "retired-test-secret" }
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog),
        refreshCatalog: async () => structuredClone(catalog)
      }
    });
    await store.setFreeModelEnabled("deepwrite-free-writing", true);

    catalog.revision = "v1-keyless";
    catalog.models = [managedModel("vendor/writer-keyless")];
    catalog.apiKeys = {};
    const keyless = await store.refreshFreeModels();
    expect(keyless.deepwriteFreeEnabledModelIds).toEqual([
      "deepwrite-free-writing"
    ]);
    expect(keyless.deepwriteFreeModels?.[0]?.hasApiKey).toBe(false);
    await expect(
      store.resolve("deepwrite-free-writing")
    ).resolves.toMatchObject({ modelId: "vendor/writer-keyless", apiKey: "" });

    catalog.revision = "v1-new-key";
    catalog.apiKeys = { "deepwrite-free-writing": "replacement-test-secret" };
    await store.refreshFreeModels();
    await expect(
      store.resolve("deepwrite-free-writing")
    ).resolves.toMatchObject({ apiKey: "replacement-test-secret" });

    catalog.revision = "v2";
    catalog.defaultModelId = "";
    catalog.models = [];
    catalog.apiKeys = {};
    const deprecated = await store.refreshFreeModels();
    expect(deprecated.deepwriteFreeDeprecatedModels).toHaveLength(1);
    const secretsAfterRemoval = JSON.parse(
      await readFile(join(root, "config", "model-secrets.json"), "utf8")
    ) as { encryptedApiKeys: Record<string, string> };
    expect(secretsAfterRemoval.encryptedApiKeys).not.toHaveProperty(
      "deepwrite-free-writing"
    );

    await writeFile(
      join(root, "config", "model-secrets.json"),
      JSON.stringify({
        version: 1,
        encryptedApiKeys: {
          "deepwrite-free-writing": Buffer.from(
            "stale-retired-secret",
            "utf8"
          ).toString("base64")
        }
      }),
      "utf8"
    );
    await store.save({ models: [], defaultModelId: "" });
    const secretsAfterSave = JSON.parse(
      await readFile(join(root, "config", "model-secrets.json"), "utf8")
    ) as { encryptedApiKeys: Record<string, string> };
    expect(secretsAfterSave.encryptedApiKeys).not.toHaveProperty(
      "deepwrite-free-writing"
    );

    catalog.revision = "v2-return-with-key";
    catalog.defaultModelId = "deepwrite-free-writing";
    catalog.models = [managedModel("vendor/writer-return-with-key")];
    catalog.apiKeys = { "deepwrite-free-writing": "new-returned-secret" };
    const returnedThroughSave = await store.save({
      models: [],
      defaultModelId: ""
    });
    expect(returnedThroughSave.deepwriteFreeDeprecatedModels).toEqual([]);
    expect(returnedThroughSave.deepwriteFreeModels?.[0]?.hasApiKey).toBe(true);

    catalog.revision = "v2-removed-again";
    catalog.defaultModelId = "";
    catalog.models = [];
    catalog.apiKeys = {};
    await store.refreshFreeModels();

    catalog.revision = "v3";
    catalog.defaultModelId = "deepwrite-free-writing";
    catalog.models = [managedModel("vendor/writer-v3")];
    catalog.apiKeys = {};
    const returned = await store.refreshFreeModels();
    expect(returned.deepwriteFreeDeprecatedModels).toEqual([]);
    expect(returned.deepwriteFreeEnabledModelIds).toEqual([]);
    expect(returned.deepwriteFreeModels?.[0]?.hasApiKey).toBe(false);

    await store.setFreeModelEnabled("deepwrite-free-writing", true);
    await expect(
      store.resolve("deepwrite-free-writing")
    ).resolves.toMatchObject({ modelId: "vendor/writer-v3", apiKey: "" });
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

  it("persists custom context window and max output tokens into runtime config", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "deepwrite-model-store-capacity-")
    );
    temporaryRoots.push(root);
    const store = new ModelConfigStore(root);
    const saved = await store.save({
      models: [
        {
          ...customModel(),
          contextWindow: 32_000,
          maxTokens: 4_096,
          apiKey: "sk-capacity-test-only"
        }
      ],
      defaultModelId: "custom-writer"
    });

    expect(saved.models[0]).toMatchObject({
      id: "custom-writer",
      contextWindow: 32_000,
      maxTokens: 4_096
    });
    await expect(store.resolve("custom-writer")).resolves.toMatchObject({
      contextWindow: 32_000,
      maxTokens: 4_096
    });
    await expect(
      store.resolveDraft({
        ...customModel(),
        contextWindow: 16_000,
        maxTokens: 2_048
      })
    ).resolves.toMatchObject({
      contextWindow: 16_000,
      maxTokens: 2_048
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
