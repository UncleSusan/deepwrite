import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import {
  AgentProviderRuntimeConfigSchema,
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  type AgentProviderRuntimeConfig,
  type ModelConfigInput,
  type OfficialModelBalance,
  type ModelSettings,
  type ModelSettingsInput
} from "@deepwrite/contracts";
import {
  DeepWriteFreeModelCatalogStore,
  type DeepWriteFreeModelCatalog
} from "./deepwrite-free-model-config";
import {
  forgetEnabledFreeModel,
  normalizeDiskModelSettings,
  rememberEnabledFreeModel,
  synchronizeFreeModelState,
  toDiskModel,
  type DiskModelSettings
} from "./free-model-settings-state";
import {
  effectiveFreeModels,
  managedFreeSecretIds,
  projectPublicFreeModelSettings,
  removeDeprecatedFreeSecrets,
  requireEnableableFreeModel,
  reservedFreeModelIds,
  resolveCurrentFreeModel
} from "./free-model-settings-projection";
import {
  DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID,
  DeepWriteOfficialModelCatalogStore,
  isOfficialModelAvailable,
  type DeepWriteOfficialModelCatalog
} from "./deepwrite-official-model-config";

interface DiskModelSecrets {
  version: 1;
  encryptedApiKeys: Record<string, string>;
}

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
  queryBalance?(currentKeySuffix?: string): Promise<OfficialModelBalance>;
}

export interface ModelConfigStoreOptions {
  appVersion?: string;
  freeModelCatalog?: FreeModelCatalogReader;
  officialModelCatalog?: OfficialModelCatalogReader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    await this.synchronizeAndPersist();
  }

  async list(): Promise<ModelSettings> {
    const { settings, secrets, freeCatalog, officialCatalog } =
      await this.synchronizeAndPersist();
    return this.toPublicSettings(
      settings,
      secrets,
      freeCatalog,
      officialCatalog
    );
  }

  async refreshFreeModels(): Promise<ModelSettings> {
    const { settings, secrets, freeCatalog, officialCatalog } =
      await this.synchronizeAndPersist({ refreshFree: true });
    return this.toPublicSettings(
      settings,
      secrets,
      freeCatalog,
      officialCatalog
    );
  }

  async refreshOfficialModels(): Promise<ModelSettings> {
    const { settings, secrets, freeCatalog, officialCatalog } =
      await this.synchronizeAndPersist({ refreshOfficial: true });
    return this.toPublicSettings(
      settings,
      secrets,
      freeCatalog,
      officialCatalog
    );
  }

  async queryOfficialBalance(): Promise<OfficialModelBalance> {
    if (!this.officialModelCatalog.queryBalance) {
      throw new Error("当前官方模型配置不支持余额查询。");
    }
    await this.writeChain;
    const [, secrets] = await this.readState();
    const encrypted =
      secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID];
    if (!encrypted) {
      return this.officialModelCatalog.queryBalance();
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储当前不可用，无法查询当前 Key 的剩余用量。");
    }
    let apiKey: string;
    try {
      apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      throw new Error("官方令牌解密失败，请重新填写并保存。");
    }
    return this.officialModelCatalog.queryBalance(apiKey.slice(-4));
  }

  async saveOfficialToken(rawApiKey: string): Promise<ModelSettings> {
    const apiKey = rawApiKey.trim();
    if (!apiKey) {
      throw new Error("请输入官方令牌。");
    }
    if (apiKey.length > 16_000) {
      throw new Error("官方令牌长度超过限制。");
    }
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const { freeCatalog, officialCatalog } = await this.readCatalogs();
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          "当前系统安全存储不可用，DeepWrite 不会把官方令牌以明文写入磁盘。"
        );
      }
      const [settings, storedSecrets] = await this.readState();
      const existingSecrets = this.withDeepWriteFreeApiKeys(
        freeCatalog,
        storedSecrets
      );
      const nextSecrets: DiskModelSecrets = {
        version: 1,
        encryptedApiKeys: {
          ...existingSecrets.encryptedApiKeys,
          [DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]: safeStorage
            .encryptString(apiKey)
            .toString("base64")
        }
      };
      const [nextSettings, synchronizedSecrets] = this.synchronizeState(
        settings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );
      await atomicWriteJson(this.secretsPath, synchronizedSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(
        nextSettings,
        synchronizedSecrets,
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
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const { freeCatalog, officialCatalog } = await this.readCatalogs();
      const [settings, storedSecrets] = await this.readState();
      const existingSecrets = this.withDeepWriteFreeApiKeys(
        freeCatalog,
        storedSecrets
      );
      const encryptedApiKeys = { ...existingSecrets.encryptedApiKeys };
      delete encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID];
      const nextSecrets: DiskModelSecrets = { version: 1, encryptedApiKeys };
      const [nextSettings, synchronizedSecrets] = this.synchronizeState(
        settings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );
      await atomicWriteJson(this.secretsPath, synchronizedSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(
        nextSettings,
        synchronizedSecrets,
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

  async setOfficialModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings> {
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const { freeCatalog, officialCatalog } = await this.readCatalogs();
      const officialModel = officialCatalog.models.find(
        (model) => model.id === modelId
      );
      if (!officialModel) {
        throw new Error("这个 DeepWrite 官方模型已不再受支持。");
      }
      if (enabled && !isOfficialModelAvailable(officialModel)) {
        throw new Error("这个 DeepWrite 官方模型当前不可用。");
      }
      const [settings, storedSecrets] = await this.readState();
      const secrets = this.withDeepWriteFreeApiKeys(freeCatalog, storedSecrets);
      const disabledIds = new Set(settings.disabledOfficialModelIds);
      if (enabled) disabledIds.delete(modelId);
      else disabledIds.add(modelId);
      const [nextSettings, nextSecrets] = this.synchronizeState(
        { ...settings, disabledOfficialModelIds: [...disabledIds] },
        secrets,
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

  async setFreeModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings> {
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const { freeCatalog, officialCatalog } = await this.readCatalogs();
      const freeModel = enabled
        ? requireEnableableFreeModel(freeCatalog, modelId)
        : undefined;
      const [storedSettings, storedSecrets] = await this.readState();
      const secretsWithRemoteKeys = this.withDeepWriteFreeApiKeys(
        freeCatalog,
        storedSecrets
      );
      const [synchronized, synchronizedSecrets] = this.synchronizeState(
        storedSettings,
        secretsWithRemoteKeys,
        freeCatalog,
        officialCatalog
      );
      const requested = enabled
        ? rememberEnabledFreeModel(synchronized, freeModel!)
        : forgetEnabledFreeModel(synchronized, modelId);
      const [nextSettings, nextSecrets] = this.synchronizeState(
        requested,
        synchronizedSecrets,
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
    let saved: ModelSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const { freeCatalog, officialCatalog } = await this.readCatalogs();
      const [existingSettings, storedSecrets] = await this.readState();
      const existingSecrets = this.withDeepWriteFreeApiKeys(
        freeCatalog,
        storedSecrets
      );
      const encryptedApiKeys: Record<string, string> = {};

      const officialToken =
        existingSecrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID];
      if (officialToken) {
        encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID] = officialToken;
      }

      // Managed free-model credentials are refreshed independently from the
      // editable model list and must survive a normal settings save.
      const freeSecretIds = managedFreeSecretIds(existingSettings, freeCatalog);
      for (const modelId of freeSecretIds) {
        const encrypted = existingSecrets.encryptedApiKeys[modelId];
        if (encrypted) {
          encryptedApiKeys[modelId] = encrypted;
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
          encryptedApiKeys[model.id] = safeStorage
            .encryptString(apiKey)
            .toString("base64");
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
        .filter((model) => !model.managedBy)
        .map(toDiskModel);
      const requestedSettings: DiskModelSettings = {
        version: 2,
        defaultModelId: input.defaultModelId,
        models: editableModels,
        disabledOfficialModelIds: existingSettings.disabledOfficialModelIds,
        enabledFreeModelIds: existingSettings.enabledFreeModelIds,
        knownFreeModels: existingSettings.knownFreeModels,
        deprecatedFreeModels: existingSettings.deprecatedFreeModels
      };
      const [nextSettings, synchronizedSecrets] = this.synchronizeState(
        requestedSettings,
        nextSecrets,
        freeCatalog,
        officialCatalog
      );

      // Extra encrypted secrets are harmless after a crash; missing metadata is not.
      await atomicWriteJson(this.secretsPath, synchronizedSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      saved = this.toPublicSettings(
        nextSettings,
        synchronizedSecrets,
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

  async resolve(
    modelId?: string
  ): Promise<AgentProviderRuntimeConfig | undefined> {
    const { settings, secrets, freeCatalog, officialCatalog } =
      await this.synchronizeAndPersist();
    if (settings.models.length === 0) {
      if (modelId) {
        throw new Error("所选模型不存在，请刷新模型配置后重试。");
      }
      return undefined;
    }

    const effectiveId =
      modelId || settings.defaultModelId || settings.models[0]!.id;
    const storedModel = settings.models.find(
      (candidate) => candidate.id === effectiveId
    );
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
        throw new Error(
          "模型 API Key 解密失败，请在模型配置中重新填写并保存。"
        );
      }
    }

    return AgentProviderRuntimeConfigSchema.parse({ ...model, apiKey });
  }

  async resolveDraft(
    rawModel: ModelConfigInput
  ): Promise<AgentProviderRuntimeConfig> {
    const parsedModel = ModelConfigInputSchema.parse(rawModel);
    const { secrets, freeCatalog, officialCatalog } =
      await this.synchronizeAndPersist();
    const model = this.synchronizeManagedModel(
      parsedModel,
      freeCatalog,
      officialCatalog,
      true
    );

    let apiKey = model.managedBy ? "" : (model.apiKey ?? "");
    if (!apiKey && !model.clearApiKey) {
      const secretId =
        model.managedBy === "deepwrite-official"
          ? DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
          : model.id;
      const encrypted = secrets.encryptedApiKeys[secretId];
      if (encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error(
            "系统安全存储当前不可用，无法解密这个模型的 API Key。"
          );
        }
        try {
          apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
        } catch {
          throw new Error(
            "模型 API Key 解密失败，请在模型配置中重新填写并保存。"
          );
        }
      }
    }
    if (model.managedBy === "deepwrite-official" && !apiKey) {
      throw new Error("请先在“设置 → DeepWrite 官方模型”中添加官方令牌。");
    }

    const { apiKey: _apiKey, clearApiKey: _clearApiKey, ...identity } = model;
    return AgentProviderRuntimeConfigSchema.parse({ ...identity, apiKey });
  }

  async resolveDraftApiKey(input: {
    id?: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }): Promise<string> {
    const provided = input.apiKey?.trim() ?? "";
    if (provided) {
      return provided;
    }
    if (input.clearApiKey) {
      return "";
    }
    const modelId = input.id?.trim() ?? "";
    if (!modelId) {
      return "";
    }
    await this.writeChain;
    const [, secrets] = await this.readState();
    const encrypted = secrets.encryptedApiKeys[modelId];
    if (!encrypted) {
      return "";
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储当前不可用，无法解密这个模型的 API Key。");
    }
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      throw new Error("模型 API Key 解密失败，请在模型配置中重新填写并保存。");
    }
  }

  private async readCatalogs(
    options: { refreshFree?: boolean; refreshOfficial?: boolean } = {}
  ): Promise<{
    freeCatalog: DeepWriteFreeModelCatalog;
    officialCatalog: DeepWriteOfficialModelCatalog;
  }> {
    const [freeCatalog, officialCatalog] = await Promise.all([
      options.refreshFree && this.freeModelCatalog.refreshCatalog
        ? this.freeModelCatalog.refreshCatalog()
        : this.freeModelCatalog.getCatalog(),
      options.refreshOfficial && this.officialModelCatalog.refreshCatalog
        ? this.officialModelCatalog.refreshCatalog()
        : this.officialModelCatalog.getCatalog()
    ]);
    return { freeCatalog, officialCatalog };
  }

  private async readState(): Promise<[DiskModelSettings, DiskModelSecrets]> {
    const [settings, secrets] = await Promise.all([
      readJson(this.settingsPath),
      readJson(this.secretsPath)
    ]);
    return [
      normalizeDiskModelSettings(settings),
      normalizeDiskSecrets(secrets)
    ];
  }

  private async synchronizeAndPersist(
    options: { refreshFree?: boolean; refreshOfficial?: boolean } = {}
  ): Promise<{
    settings: DiskModelSettings;
    secrets: DiskModelSecrets;
    freeCatalog: DeepWriteFreeModelCatalog;
    officialCatalog: DeepWriteOfficialModelCatalog;
  }> {
    let synchronized:
      | {
          settings: DiskModelSettings;
          secrets: DiskModelSecrets;
          freeCatalog: DeepWriteFreeModelCatalog;
          officialCatalog: DeepWriteOfficialModelCatalog;
        }
      | undefined;
    const operation = this.writeChain.then(async () => {
      const { freeCatalog, officialCatalog } = await this.readCatalogs(options);
      const [settings, storedSecrets] = await this.readState();
      const secretsWithRemoteKeys = this.withDeepWriteFreeApiKeys(
        freeCatalog,
        storedSecrets
      );
      const [nextSettings, nextSecrets] = this.synchronizeState(
        settings,
        secretsWithRemoteKeys,
        freeCatalog,
        officialCatalog
      );
      await atomicWriteJson(this.secretsPath, nextSecrets);
      await atomicWriteJson(this.settingsPath, nextSettings);
      synchronized = {
        settings: nextSettings,
        secrets: nextSecrets,
        freeCatalog,
        officialCatalog
      };
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return synchronized!;
  }

  /**
   * Remote managed-model credentials are accepted only in Main and immediately
   * moved into the same encrypted store as user-provided credentials.
   */
  private withDeepWriteFreeApiKeys(
    catalog: DeepWriteFreeModelCatalog,
    secrets: DiskModelSecrets
  ): DiskModelSecrets {
    const currentIds = new Set(catalog.models.map((model) => model.id));
    const entries = Object.entries(catalog.apiKeys).filter(
      ([id, apiKey]) => currentIds.has(id) && Boolean(apiKey)
    );
    if (entries.length > 0 && !safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "当前系统安全存储不可用，DeepWrite 不会把远程免费模型 API Key 以明文写入磁盘。"
      );
    }
    const encryptedApiKeys = { ...secrets.encryptedApiKeys };
    if (catalog.canDeprecateMissingModels) {
      for (const id of currentIds) delete encryptedApiKeys[id];
    }
    for (const [id, apiKey] of entries) {
      encryptedApiKeys[id] = safeStorage
        .encryptString(apiKey)
        .toString("base64");
    }
    return { version: 1, encryptedApiKeys };
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
      ...projectPublicFreeModelSettings(settings, freeCatalog, (modelId) =>
        Boolean(secrets.encryptedApiKeys[modelId])
      ),
      deepwriteOfficialModels: officialCatalog.models.map((model) => ({
        ...model,
        hasApiKey: Boolean(
          secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]
        )
      })),
      deepwriteOfficialEnabledModelIds: officialCatalog.models
        .filter(
          (model) =>
            isOfficialModelAvailable(model) &&
            !settings.disabledOfficialModelIds.includes(model.id)
        )
        .map((model) => model.id),
      deepwriteOfficialTokenConfigured: Boolean(
        secrets.encryptedApiKeys[DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID]
      )
    });
  }

  private synchronizeState(
    settings: DiskModelSettings,
    secrets: DiskModelSecrets,
    freeCatalog: DeepWriteFreeModelCatalog,
    officialCatalog: DeepWriteOfficialModelCatalog
  ): [DiskModelSettings, DiskModelSecrets] {
    const nextSettings = this.synchronizeSettings(
      settings,
      secrets,
      freeCatalog,
      officialCatalog
    );
    return [
      nextSettings,
      {
        version: 1,
        encryptedApiKeys: removeDeprecatedFreeSecrets(
          secrets.encryptedApiKeys,
          nextSettings
        )
      }
    ];
  }

  private synchronizeSettings(
    settings: DiskModelSettings,
    secrets: DiskModelSecrets,
    freeCatalog: DeepWriteFreeModelCatalog,
    officialCatalog: DeepWriteOfficialModelCatalog
  ): DiskModelSettings {
    const freeState = synchronizeFreeModelState(settings, freeCatalog);
    const officialModelIds = new Set(
      officialCatalog.models.map((model) => model.id)
    );
    const disabledOfficialModelIds = new Set(settings.disabledOfficialModelIds);
    const officialModels = secrets.encryptedApiKeys[
      DEEPWRITE_OFFICIAL_TOKEN_SECRET_ID
    ]
      ? officialCatalog.models
          .filter(
            (model) =>
              isOfficialModelAvailable(model) &&
              !disabledOfficialModelIds.has(model.id)
          )
          .map(toDiskModel)
      : [];
    const freeModels = effectiveFreeModels(freeState, freeCatalog);
    const freeReservedIds = reservedFreeModelIds(freeState, freeCatalog);
    const reservedModelIds = new Set([...officialModelIds, ...freeReservedIds]);
    const customModels = settings.models
      .filter((model) => !model.managedBy && !reservedModelIds.has(model.id))
      .map(toDiskModel);
    const models = [...officialModels, ...freeModels, ...customModels];
    const requestedDefaultModelId = settings.defaultModelId;
    const defaultModelId = models.some(
      (model) => model.id === requestedDefaultModelId
    )
      ? requestedDefaultModelId
      : (models[0]?.id ?? "");
    return {
      version: 2,
      defaultModelId,
      models,
      disabledOfficialModelIds: [...disabledOfficialModelIds].filter((id) =>
        officialModelIds.has(id)
      ),
      ...freeState
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
        (candidate) =>
          candidate.id === model.id && isOfficialModelAvailable(candidate)
      );
      if (!officialModel) {
        throw new Error("这个 DeepWrite 官方模型已不再受支持。");
      }
      return structuredClone(officialModel);
    }
    if (model.managedBy !== "deepwrite-free") {
      return model;
    }
    return resolveCurrentFreeModel(freeCatalog, model.id, enforceRemoteStatus);
  }
}
