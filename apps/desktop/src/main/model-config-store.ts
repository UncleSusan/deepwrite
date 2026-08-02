import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import {
  AgentProviderRuntimeConfigSchema,
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  type AgentProviderRuntimeConfig,
  type ModelConfig,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput
} from "@deepwrite/contracts";
import {
  DeepWriteFreeModelCatalogStore,
  type DeepWriteFreeModelCatalog
} from "./deepwrite-free-model-config";
import {
  DEEPWRITE_OFFICIAL_DEFAULT_QUOTA_TOKENS,
  DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID,
  DeepWriteOfficialModelCatalogStore,
  type DeepWriteOfficialModelCatalog
} from "./deepwrite-official-model-config";

interface DiskModelConfig {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  requestModelId?: string | undefined;
  supportsDeveloperRole?: boolean | undefined;
  api: ModelConfig["api"];
  baseUrl: string;
  reasoning: boolean;
  defaultThinkingLevel: ModelConfig["defaultThinkingLevel"];
  thinkingLevelOptions: ModelConfig["thinkingLevelOptions"];
  temperatureOptions: ModelConfig["temperatureOptions"];
  managedBy?: ModelConfig["managedBy"];
}

interface DiskModelSettings {
  version: 1;
  defaultModelId: string;
  models: DiskModelConfig[];
}

interface DiskModelSecrets {
  version: 1;
  encryptedApiKeys: Record<string, string>;
}

const EMPTY_SETTINGS: DiskModelSettings = {
  version: 1,
  defaultModelId: "",
  models: []
};

const EMPTY_SECRETS: DiskModelSecrets = {
  version: 1,
  encryptedApiKeys: {}
};

interface FreeModelCatalogReader {
  initialize(): Promise<void>;
  getCatalog(): Promise<DeepWriteFreeModelCatalog>;
  refreshCatalog?(): Promise<DeepWriteFreeModelCatalog>;
}

interface OfficialModelCatalogReader {
  initialize(): Promise<void>;
  getCatalog(): Promise<DeepWriteOfficialModelCatalog>;
  refreshCatalog?(): Promise<DeepWriteOfficialModelCatalog>;
}

export interface ModelConfigStoreOptions {
  appVersion?: string;
  freeModelCatalog?: FreeModelCatalogReader;
  officialModelCatalog?: OfficialModelCatalogReader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDiskSettings(raw: unknown): DiskModelSettings {
  if (!isRecord(raw)) {
    return structuredClone(EMPTY_SETTINGS);
  }
  const parsed = ModelSettingsInputSchema.safeParse({
    models: raw.models,
    defaultModelId: raw.defaultModelId
  });
  if (!parsed.success) {
    return structuredClone(EMPTY_SETTINGS);
  }
  return {
    version: 1,
    defaultModelId: parsed.data.defaultModelId,
    models: parsed.data.models.map(({ apiKey: _apiKey, clearApiKey: _clear, ...model }) => model)
  };
}

function normalizeDiskSecrets(raw: unknown): DiskModelSecrets {
  if (!isRecord(raw) || !isRecord(raw.encryptedApiKeys)) {
    return structuredClone(EMPTY_SECRETS);
  }
  const encryptedApiKeys: Record<string, string> = {};
  for (const [id, value] of Object.entries(raw.encryptedApiKeys)) {
    if (typeof value === "string" && value.length > 0) {
      encryptedApiKeys[id] = value;
    }
  }
  return { version: 1, encryptedApiKeys };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

export class ModelConfigStore {
  private readonly settingsPath: string;
  private readonly secretsPath: string;
  private readonly freeModelCatalog: FreeModelCatalogReader;
  private readonly officialModelCatalog: OfficialModelCatalogReader;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, options: ModelConfigStoreOptions = {}) {
    const configDirectory = join(userDataPath, "config");
    this.settingsPath = join(configDirectory, "models.json");
    this.secretsPath = join(configDirectory, "model-secrets.json");
    this.freeModelCatalog =
      options.freeModelCatalog ??
      new DeepWriteFreeModelCatalogStore(
        userDataPath,
        options.appVersion ? { appVersion: options.appVersion } : {}
      );
    this.officialModelCatalog =
      options.officialModelCatalog ??
      new DeepWriteOfficialModelCatalogStore(userDataPath);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.freeModelCatalog.initialize(),
      this.officialModelCatalog.initialize()
    ]);
    await this.persistDeepWriteFreeApiKeys(await this.freeModelCatalog.getCatalog());
  }

  async list(): Promise<ModelSettings> {
    const { freeCatalog, officialCatalog } = await this.getCatalogs();
    await this.writeChain;
    const [settings, secrets] = await this.readState();
    return this.toPublicSettings(
      this.synchronizeSettings(settings, secrets, freeCatalog, officialCatalog),
      secrets,
      freeCatalog,
      officialCatalog
    );
  }

  async refreshFreeModels(): Promise<ModelSettings> {
    const freeCatalog = this.freeModelCatalog.refreshCatalog
      ? await this.freeModelCatalog.refreshCatalog()
      : await this.freeModelCatalog.getCatalog();
    const officialCatalog = await this.officialModelCatalog.getCatalog();
    await this.persistDeepWriteFreeApiKeys(freeCatalog);
    await this.writeChain;
    const [settings, secrets] = await this.readState();
    return this.toPublicSettings(
      this.synchronizeSettings(settings, secrets, freeCatalog, officialCatalog),
      secrets,
      freeCatalog,
      officialCatalog
    );
  }

  async refreshOfficialModels(): Promise<ModelSettings> {
    const [freeCatalog, officialCatalog] = await Promise.all([
      this.freeModelCatalog.getCatalog(),
      this.officialModelCatalog.refreshCatalog
        ? this.officialModelCatalog.refreshCatalog()
        : this.officialModelCatalog.getCatalog()
    ]);
    await this.persistDeepWriteFreeApiKeys(freeCatalog);
    await this.writeChain;
    const [settings, secrets] = await this.readState();
    return this.toPublicSettings(
      this.synchronizeSettings(settings, secrets, freeCatalog, officialCatalog),
      secrets,
      freeCatalog,
      officialCatalog
    );
  }

  async saveOfficialToken(rawApiKey: string): Promise<ModelSettings> {
    const apiKey = rawApiKey.trim();
    if (!apiKey) {
      throw new Error("请输入官方令牌。");
    }
    if (apiKey.length > 16_000) {
      throw new Error("官方令牌长度超过限制。");
    }
    const { freeCatalog, officialCatalog } = await this.getCatalogs();
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          "当前系统安全存储不可用，DeepWrite 不会把官方令牌以明文写入磁盘。"
        );
      }
      const [settings, existingSecrets] = await this.readState();
      const nextSecrets: DiskModelSecrets = {
        version: 1,
        encryptedApiKeys: {
          ...existingSecrets.encryptedApiKeys,
          [DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]: safeStorage
            .encryptString(apiKey)
            .toString("base64")
        }
      };
      const nextSettings = this.synchronizeSettings(
        settings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );
      await atomicWriteJson(this.secretsPath, nextSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(
        nextSettings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async clearOfficialToken(): Promise<ModelSettings> {
    const { freeCatalog, officialCatalog } = await this.getCatalogs();
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const [settings, existingSecrets] = await this.readState();
      const encryptedApiKeys = { ...existingSecrets.encryptedApiKeys };
      delete encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID];
      const nextSecrets: DiskModelSecrets = { version: 1, encryptedApiKeys };
      const nextSettings = this.synchronizeSettings(
        settings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );
      await atomicWriteJson(this.secretsPath, nextSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(
        nextSettings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async save(rawInput: ModelSettingsInput): Promise<ModelSettings> {
    const input = ModelSettingsInputSchema.parse(rawInput);
    const { freeCatalog, officialCatalog } = await this.getCatalogs();
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const [, existingSecrets] = await this.readState();
      const encryptedApiKeys: Record<string, string> = {};

      const officialToken =
        existingSecrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID];
      if (officialToken) {
        encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID] = officialToken;
      }

      // Managed free-model credentials are refreshed independently from the
      // editable model list and must survive a normal settings save.
      for (const model of freeCatalog.models) {
        const encrypted = existingSecrets.encryptedApiKeys[model.id];
        if (encrypted) {
          encryptedApiKeys[model.id] = encrypted;
        }
      }

      for (const model of input.models) {
        if (model.managedBy) {
          continue;
        }
        const apiKey = model.apiKey?.trim();
        if (apiKey) {
          if (!safeStorage.isEncryptionAvailable()) {
            throw new Error(
              "当前系统安全存储不可用，DeepWrite 不会把 API Key 以明文写入磁盘。"
            );
          }
          encryptedApiKeys[model.id] = safeStorage.encryptString(apiKey).toString("base64");
          continue;
        }
        if (model.clearApiKey) {
          continue;
        }
        const previous = existingSecrets.encryptedApiKeys[model.id];
        if (previous) {
          encryptedApiKeys[model.id] = previous;
        }
      }

      const nextSecrets: DiskModelSecrets = { version: 1, encryptedApiKeys };
      const editableModels = input.models
        .filter((model) => model.managedBy !== "deepwrite-official")
        .map((model) =>
          this.toDiskModel(
            this.synchronizeManagedModel(model, freeCatalog, officialCatalog)
          )
        );
      const requestedSettings: DiskModelSettings = {
        version: 1,
        defaultModelId: input.defaultModelId,
        models: editableModels
      };
      const nextSettings = this.synchronizeSettings(
        requestedSettings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );

      // Extra encrypted secrets are harmless after a crash; missing metadata is not.
      await atomicWriteJson(this.secretsPath, nextSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(
        nextSettings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async resolve(modelId?: string): Promise<AgentProviderRuntimeConfig | undefined> {
    const { freeCatalog, officialCatalog } = await this.getCatalogs();
    await this.writeChain;
    const [storedSettings, secrets] = await this.readState();
    const settings = this.synchronizeSettings(
      storedSettings,
      secrets,
      freeCatalog,
      officialCatalog
    );
    if (settings.models.length === 0) {
      if (modelId) {
        throw new Error("所选模型不存在，请刷新模型配置后重试。");
      }
      return undefined;
    }

    const effectiveId = modelId || settings.defaultModelId || settings.models[0]!.id;
    const storedModel = settings.models.find((candidate) => candidate.id === effectiveId);
    const model = storedModel
      ? this.synchronizeManagedModel(
          storedModel,
          freeCatalog,
          officialCatalog,
          true
        )
      : undefined;
    if (!model) {
      throw new Error("所选模型不存在，请刷新模型配置后重试。");
    }

    const secretId =
      model.managedBy === "deepwrite-official"
        ? DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
        : model.id;
    const encrypted = secrets.encryptedApiKeys[secretId];
    let apiKey = "";
    if (!apiKey && encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("系统安全存储当前不可用，无法解密这个模型的 API Key。");
      }
      try {
        apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        throw new Error("模型 API Key 解密失败，请在模型配置中重新填写并保存。");
      }
    }

    return AgentProviderRuntimeConfigSchema.parse({ ...model, apiKey });
  }

  async resolveDraft(rawModel: ModelConfigInput): Promise<AgentProviderRuntimeConfig> {
    const parsedModel = ModelConfigInputSchema.parse(rawModel);
    const { freeCatalog, officialCatalog } = await this.getCatalogs();
    await this.writeChain;
    const model = this.synchronizeManagedModel(
      parsedModel,
      freeCatalog,
      officialCatalog,
      true
    );

    let apiKey = model.managedBy ? "" : model.apiKey ?? "";
    if (!apiKey && !model.clearApiKey) {
      const [, secrets] = await this.readState();
      const secretId =
        model.managedBy === "deepwrite-official"
          ? DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
          : model.id;
      const encrypted = secrets.encryptedApiKeys[secretId];
      if (encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("系统安全存储当前不可用，无法解密这个模型的 API Key。");
        }
        try {
          apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
        } catch {
          throw new Error("模型 API Key 解密失败，请在模型配置中重新填写并保存。");
        }
      }
    }
    if (model.managedBy === "deepwrite-official" && !apiKey) {
      throw new Error("请先在“设置 → DeepWrite 官方模型”中添加官方令牌。");
    }

    const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
    return AgentProviderRuntimeConfigSchema.parse({ ...identity, apiKey });
  }

  private async getCatalogs(): Promise<{
    freeCatalog: DeepWriteFreeModelCatalog;
    officialCatalog: DeepWriteOfficialModelCatalog;
  }> {
    const [freeCatalog, officialCatalog] = await Promise.all([
      this.freeModelCatalog.getCatalog(),
      this.officialModelCatalog.getCatalog()
    ]);
    await this.persistDeepWriteFreeApiKeys(freeCatalog);
    return { freeCatalog, officialCatalog };
  }

  private async readState(): Promise<[DiskModelSettings, DiskModelSecrets]> {
    const [settings, secrets] = await Promise.all([
      readJson(this.settingsPath),
      readJson(this.secretsPath)
    ]);
    return [normalizeDiskSettings(settings), normalizeDiskSecrets(secrets)];
  }

  /**
   * Remote managed-model credentials are accepted only in Main and immediately
   * moved into the same encrypted store as user-provided credentials.
   */
  private async persistDeepWriteFreeApiKeys(
    catalog: DeepWriteFreeModelCatalog
  ): Promise<void> {
    const entries = Object.entries(catalog.apiKeys).filter(([, apiKey]) => Boolean(apiKey));
    if (entries.length === 0) {
      return;
    }
    const operation = this.writeChain.then(async () => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          "当前系统安全存储不可用，DeepWrite 不会把远程免费模型 API Key 以明文写入磁盘。"
        );
      }
      const [, existingSecrets] = await this.readState();
      const encryptedApiKeys = { ...existingSecrets.encryptedApiKeys };
      for (const [id, apiKey] of entries) {
        encryptedApiKeys[id] = safeStorage.encryptString(apiKey).toString("base64");
      }
      await atomicWriteJson(this.secretsPath, {
        version: 1,
        encryptedApiKeys
      } satisfies DiskModelSecrets);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
  }

  private toPublicSettings(
    settings: DiskModelSettings,
    secrets: DiskModelSecrets,
    freeCatalog: DeepWriteFreeModelCatalog,
    officialCatalog: DeepWriteOfficialModelCatalog
  ): ModelSettings {
    return ModelSettingsSchema.parse({
      defaultModelId: settings.defaultModelId,
      models: settings.models.map((model) => ({
        ...model,
        hasApiKey: Boolean(
          secrets.encryptedApiKeys[
            model.managedBy === "deepwrite-official"
              ? DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
              : model.id
          ]
        )
      })),
      deepwriteFreeModels: freeCatalog.models.map((model) => ({
        ...model,
        hasApiKey: Boolean(secrets.encryptedApiKeys[model.id])
      })),
      ...(freeCatalog.defaultModelId
        ? { deepwriteFreeDefaultModelId: freeCatalog.defaultModelId }
        : {}),
      ...(freeCatalog.message ? { deepwriteFreeMessage: freeCatalog.message } : {}),
      deepwriteOfficialModels: officialCatalog.models.map((model) => ({
        ...model,
        hasApiKey: Boolean(
          secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]
        )
      })),
      deepwriteOfficialTokenConfigured: Boolean(
        secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]
      ),
      deepwriteOfficialQuotaTokens: DEEPWRITE_OFFICIAL_DEFAULT_QUOTA_TOKENS
    });
  }

  private synchronizeSettings(
    settings: DiskModelSettings,
    secrets: DiskModelSecrets,
    freeCatalog: DeepWriteFreeModelCatalog,
    officialCatalog: DeepWriteOfficialModelCatalog
  ): DiskModelSettings {
    const officialModelIds = new Set(
      officialCatalog.models.map((model) => model.id)
    );
    const officialModels = secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]
      ? officialCatalog.models.map((model) => this.toDiskModel(model))
      : [];
    const otherModels = settings.models
      .filter(
        (model) =>
          model.managedBy !== "deepwrite-official" &&
          !officialModelIds.has(model.id)
      )
      .map((model) =>
        this.toDiskModel(
          this.synchronizeManagedModel(model, freeCatalog, officialCatalog)
        )
      );
    const models = [...officialModels, ...otherModels];
    const requestedDefaultModelId = settings.defaultModelId;
    const defaultModelId = models.some((model) => model.id === requestedDefaultModelId)
      ? requestedDefaultModelId
      : models[0]?.id ?? "";
    return {
      ...settings,
      defaultModelId,
      models
    };
  }

  private synchronizeManagedModel(
    model: ModelConfigInput,
    freeCatalog: DeepWriteFreeModelCatalog,
    officialCatalog: DeepWriteOfficialModelCatalog,
    enforceRemoteStatus = false
  ): ModelConfigInput {
    if (model.managedBy === "deepwrite-official") {
      if (
        enforceRemoteStatus &&
        officialCatalog.manifestAvailable &&
        !officialCatalog.enabled
      ) {
        throw new Error(
          officialCatalog.message || "DeepWrite 官方模型当前已暂停使用。"
        );
      }
      const officialModel = officialCatalog.models.find(
        (candidate) => candidate.id === model.id
      );
      if (!officialModel) {
        throw new Error("这个 DeepWrite 官方模型已不再受支持。");
      }
      return structuredClone(officialModel);
    }
    if (model.managedBy !== "deepwrite-free") {
      return model;
    }
    if (enforceRemoteStatus && freeCatalog.manifestAvailable && !freeCatalog.enabled) {
      throw new Error(freeCatalog.message || "DeepWrite 免费模型当前已暂停使用。");
    }
    const remoteModel =
      freeCatalog.models.find((candidate) => candidate.id === model.id) ??
      freeCatalog.models.find((candidate) => candidate.id === freeCatalog.defaultModelId);
    const synchronized = remoteModel
      ? { ...remoteModel, id: model.id }
      : {
          ...model,
          provider: "openrouter",
          api: "openai-completions" as const,
          baseUrl: "https://openrouter.ai/api/v1"
        };
    if (
      synchronized.modelId !== "openrouter/free" &&
      !synchronized.modelId.endsWith(":free")
    ) {
      throw new Error("DeepWrite 免费模型只能使用 OpenRouter 的免费模型 ID。");
    }
    return {
      ...synchronized,
      provider: "openrouter",
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
      managedBy: "deepwrite-free"
    };
  }

  private toDiskModel(model: ModelConfigInput): DiskModelConfig {
    const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
    return identity;
  }
}
