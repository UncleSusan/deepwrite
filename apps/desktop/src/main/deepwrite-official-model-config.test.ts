import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEEPWRITE_OFFICIAL_MODEL_CONFIG_URL,
  DeepWriteOfficialModelCatalogStore,
  parseDeepWriteOfficialModelManifest
} from "./deepwrite-official-model-config";

const temporaryRoots: string[] = [];

function manifest(label = "官方模型-DeepSeekFlash正式版本"): unknown {
  return {
    models: [
      {
        id: "deepwrite-deepseek-v4-flash",
        label,
        modelId: "deepseek-v4-flash-202605",
        api: "openai-completions",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        reasoning: true,
        defaultThinkingLevel: "high",
        supportsDeveloperRole: false,
        thinkingLevelOptions: ["low", "high", "max"],
        temperatureOptions: [0.7, 1, 1.5]
      }
    ]
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("DeepWrite official remote model manifest", () => {
  it("turns the published model fields into an immutable managed catalog", () => {
    const catalog = parseDeepWriteOfficialModelManifest(manifest());

    expect(DEEPWRITE_OFFICIAL_MODEL_CONFIG_URL).toContain(
      "MODELDEEPWRITE.json"
    );
    expect(catalog.manifestAvailable).toBe(true);
    expect(catalog.defaultModelId).toBe("deepwrite-deepseek-v4-flash");
    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: "deepwrite-deepseek-v4-flash",
        label: "官方模型-DeepSeekFlash正式版本",
        provider: "deepseek-official",
        modelId: "deepseek-v4-flash-202605",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        reasoning: true,
        defaultThinkingLevel: "high",
        supportsDeveloperRole: false,
        thinkingLevelOptions: ["low", "high", "max"],
        temperatureOptions: [0.7, 1, 1.5],
        managedBy: "deepwrite-official"
      })
    ]);
    expect(catalog.models[0]).not.toHaveProperty("requestModelId");
  });

  it("refuses manifests that could redirect the saved official token", () => {
    const unsafe = manifest() as { models: Array<Record<string, unknown>> };
    unsafe.models[0]!.baseUrl = "https://attacker.example/v1";
    expect(() => parseDeepWriteOfficialModelManifest(unsafe)).toThrow(
      /受信任范围/u
    );

    const secretBearing = manifest() as {
      models: Array<Record<string, unknown>>;
    };
    secretBearing.models[0]!.apiKey = "must-not-be-accepted";
    expect(() => parseDeepWriteOfficialModelManifest(secretBearing)).toThrow(
      /不得包含密钥/u
    );
  });

  it("refreshes on demand and retains the last successful cache when the network fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-official-catalog-"));
    temporaryRoots.push(root);
    let currentManifest = manifest();
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(currentManifest), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const store = new DeepWriteOfficialModelCatalogStore(root, { fetcher });
    await store.initialize();

    currentManifest = manifest("远程更新后的模型名称");
    const refreshed = await store.refreshCatalog();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refreshed.models[0]?.label).toBe("远程更新后的模型名称");

    const offlineStore = new DeepWriteOfficialModelCatalogStore(root, {
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    await offlineStore.initialize();
    expect((await offlineStore.getCatalog()).models[0]?.label).toBe(
      "远程更新后的模型名称"
    );
    await expect(offlineStore.refreshCatalog()).rejects.toThrow(/offline/u);
    expect((await offlineStore.getCatalog()).models[0]?.label).toBe(
      "远程更新后的模型名称"
    );
  });
});
