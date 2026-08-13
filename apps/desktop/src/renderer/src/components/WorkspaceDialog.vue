<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type BuiltInReasoningLevel,
  type ModelApi,
  type ModelConfig,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type ReasoningLevel,
  type RemoteModelListItem,
  type TemperatureOptions,
  type ThinkingLevelOptions,
  type ThinkingLevel
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { uiMessage } from "../ui-feedback";
import { mergeCustomModelSettings } from "../utils/customModelSettings";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

interface DraftModel extends ModelConfig {
  apiKey?: string;
  clearApiKey?: boolean;
  customThinkingLevel?: string;
  originalId?: string;
}

type ModelConfigRow =
  | { key: string; type: "model"; model: DraftModel }
  | { key: string; type: "editor" };

const props = withDefaults(defineProps<{
  mode: "directory" | "models";
  active?: boolean;
  modelScope?: "all" | "custom";
  embedded?: boolean;
  modelSettings: ModelSettings | null;
  modelLoading: boolean;
  modelSaving: boolean;
  freeModelsRefreshing: boolean;
  modelError: string | null;
  modelTestMessage: string | null;
  testingModelId: string | null;
  modelAlertMessages: readonly string[];
  workspaceDirectoryPath: string | null;
  workspaceDirectoryLoading: boolean;
}>(), {
  active: false,
  modelScope: "all",
  embedded: false
});
const emit = defineEmits<{
  saveModels: [settings: ModelSettingsInput];
  refreshFreeModels: [];
  testModel: [model: ModelConfigInput];
  chooseWorkspaceDirectory: [];
  openOfficialModels: [];
}>();

const MANUAL_MODEL_ID_VALUE = "__deepwrite-manual-model-id__";

const draftModels = ref<DraftModel[]>([]);
const draftDefaultModelId = ref("");
const modelEditor = ref<DraftModel | null>(null);
const modelConfigScrollArea = ref<HTMLElement | null>(null);
const fetchedRemoteModels = ref<RemoteModelListItem[]>([]);
const listingRemoteModels = ref(false);
const fetchHintDialog = ref<string | null>(null);
const fetchHintConfirmButton = ref<HTMLButtonElement | null>(null);
const modelConfigRows = computed<ModelConfigRow[]>(() => {
  const rows: ModelConfigRow[] = [];
  const editedModelId = modelEditor.value?.originalId;

  for (const model of draftModels.value) {
    rows.push({ key: `model:${model.id}`, type: "model", model });
    if (editedModelId === model.id) {
      rows.push({ key: `editor:${model.id}`, type: "editor" });
    }
  }

  if (modelEditor.value && !editedModelId) {
    rows.push({ key: `editor:${modelEditor.value.id}`, type: "editor" });
  }

  return rows;
});

const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};
const reasoningOptions = BUILT_IN_REASONING_LEVELS.map((value) => ({
  value,
  label: builtInThinkingLabels[value]
}));
const allProviderOptions = [
  { value: "deepwrite-free", label: "DeepWrite 免费模型" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "kimi-coding", label: "Kimi Coding" },
  { value: "dashscope", label: "阿里云百炼" },
  { value: "zhipu", label: "智谱 GLM" },
  { value: "moonshot", label: "Kimi 开放平台" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "ollama", label: "Ollama" },
  { value: "custom", label: "其他兼容服务" }
] as const;
const providerOptions = computed(() =>
  props.modelScope === "custom"
    ? allProviderOptions.filter((option) => option.value !== "deepwrite-free")
    : allProviderOptions
);
const deepwriteFreeModels = computed(() => props.modelSettings?.deepwriteFreeModels ?? []);
const deepwriteFreeModelOptions = computed(() =>
  deepwriteFreeModels.value.map((model) => ({
    value: model.id,
    label: model.label,
    description: model.modelId,
    title: model.modelId
  }))
);
const isDeepWriteFreeEditor = computed(
  () => modelEditor.value?.managedBy === "deepwrite-free"
);
const canSelectRemoteModel = computed(() => fetchedRemoteModels.value.length > 0);
const remoteModelOptions = computed(() => {
  const current = modelEditor.value?.modelId.trim() ?? "";
  const options = fetchedRemoteModels.value.map((model) => ({
    value: model.id,
    label: model.label && model.label !== model.id ? model.label : model.id,
    ...(model.label && model.label !== model.id
      ? { description: model.id, title: model.id }
      : { title: model.id })
  }));
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({
      value: current,
      label: current,
      title: current
    });
  }
  options.push({
    value: MANUAL_MODEL_ID_VALUE,
    label: "手动输入其他模型 ID",
    title: "返回手动填写"
  });
  return options;
});
const apiOptions: ReadonlyArray<{ value: ModelApi; label: string }> = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" }
];
const modelModeOptions = [
  { value: "reasoning", label: "思考模式" },
  { value: "temperature", label: "不思考模式" }
] as const;
const defaultThinkingOptions = computed(() =>
  (modelEditor.value?.thinkingLevelOptions ?? []).map((level) => ({
    value: level,
    label: thinkingLabel(level),
    title: level
  }))
);
const customThinkingLevelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isBuiltInThinkingLevel(level: string): level is BuiltInReasoningLevel {
  return BUILT_IN_REASONING_LEVELS.some((candidate) => candidate === level);
}

function findCustomThinkingLevel(options: ThinkingLevelOptions): string {
  return options.find((level) => !isBuiltInThinkingLevel(level)) ?? "";
}

function isValidCustomThinkingLevel(level: string): boolean {
  return (
    level.length <= 64 &&
    level !== "off" &&
    !isBuiltInThinkingLevel(level) &&
    customThinkingLevelPattern.test(level)
  );
}

function cloneTemperatureOptions(options: TemperatureOptions): TemperatureOptions {
  return [options[0], options[1], options[2]];
}

function cloneThinkingLevelOptions(options: ThinkingLevelOptions): ThinkingLevelOptions {
  return [...options];
}

function thinkingLabel(level: ThinkingLevel): string {
  if (level === "off") {
    return "关闭";
  }
  return isBuiltInThinkingLevel(level)
    ? builtInThinkingLabels[level]
    : `自定义（${level}）`;
}

function resetModelDraft(settings: ModelSettings | null): void {
  draftModels.value = (settings?.models ?? [])
    .filter((model) => props.modelScope === "all" || !model.managedBy)
    .map((model) => ({
      ...model,
      thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
      temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
      customThinkingLevel: findCustomThinkingLevel(model.thinkingLevelOptions)
    }));
  draftDefaultModelId.value = settings?.defaultModelId ?? "";
  modelEditor.value = null;
}

watch(
  () => [props.mode, props.active] as const,
  ([mode, active]) => {
    if (active && mode === "models") {
      resetModelDraft(props.modelSettings);
    }
  },
  { immediate: true }
);

watch(
  () => [props.modelSettings, props.modelSaving] as const,
  ([settings, saving]) => {
    if (props.active && props.mode === "models" && !saving) {
      const editor = modelEditor.value;
      if (editor?.managedBy === "deepwrite-free" && settings) {
        draftModels.value = draftModels.value.map((model) => {
          if (model.managedBy !== "deepwrite-free") {
            return model;
          }
          const refreshed = settings.models.find((candidate) => candidate.id === model.id);
          return refreshed
            ? {
                ...refreshed,
                thinkingLevelOptions: cloneThinkingLevelOptions(
                  refreshed.thinkingLevelOptions
                ),
                temperatureOptions: cloneTemperatureOptions(refreshed.temperatureOptions),
                customThinkingLevel: findCustomThinkingLevel(
                  refreshed.thinkingLevelOptions
                )
              }
            : model;
        });
        const refreshedEditor =
          settings.deepwriteFreeModels?.find((candidate) => candidate.id === editor.id) ??
          settings.deepwriteFreeModels?.find(
            (candidate) => candidate.id === settings.deepwriteFreeDefaultModelId
          ) ??
          settings.deepwriteFreeModels?.[0];
        if (refreshedEditor) {
          modelEditor.value = {
            ...refreshedEditor,
            apiKey: "",
            clearApiKey: false,
            customThinkingLevel: findCustomThinkingLevel(
              refreshedEditor.thinkingLevelOptions
            ),
            ...(editor.originalId ? { originalId: editor.originalId } : {})
          };
        }
        return;
      }
      resetModelDraft(settings);
    }
  }
);

watch(
  () => props.modelError,
  (error) => {
    if (error) {
      uiMessage.error(error);
    }
  }
);

watch(
  () => props.modelTestMessage,
  (successMessage) => {
    if (successMessage) {
      uiMessage.success(successMessage);
    }
  }
);

watch(
  () =>
    modelEditor.value
      ? [
          modelEditor.value.id,
          modelEditor.value.provider,
          modelEditor.value.api,
          modelEditor.value.baseUrl.trim()
        ]
      : null,
  () => {
    fetchedRemoteModels.value = [];
  }
);

watch(fetchHintDialog, (message) => {
  if (message) {
    void nextTick(() => fetchHintConfirmButton.value?.focus());
  }
});

function createModel(): void {
  modelEditor.value = {
    id: createId("model"),
    label: "",
    provider: "deepseek",
    modelId: "",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: [...BUILT_IN_REASONING_LEVELS],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: false,
    apiKey: "",
    customThinkingLevel: ""
  };
  scrollModelEditorIntoView();
}

function editModel(model: DraftModel): void {
  if (model.managedBy === "deepwrite-official") {
    return;
  }
  modelEditor.value = {
    ...model,
    thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
    apiKey: "",
    clearApiKey: false,
    customThinkingLevel: findCustomThinkingLevel(model.thinkingLevelOptions),
    originalId: model.id
  };
  scrollModelEditorIntoView();
}

function scrollModelEditorIntoView(): void {
  void nextTick(() => {
    modelConfigScrollArea.value
      ?.querySelector<HTMLElement>(".model-editor")
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  });
}

function applyDeepWriteFreeModel(modelId: string): void {
  const editor = modelEditor.value;
  const preset = deepwriteFreeModels.value.find((model) => model.id === modelId);
  if (!editor || !preset) {
    uiMessage.warning(
      props.modelSettings?.deepwriteFreeMessage ||
        "DeepWrite 免费模型配置暂时不可用，请稍后重试。"
    );
    return;
  }
  modelEditor.value = {
    ...preset,
    apiKey: "",
    clearApiKey: false,
    customThinkingLevel: findCustomThinkingLevel(preset.thinkingLevelOptions),
    ...(editor.originalId ? { originalId: editor.originalId } : {})
  };
}

function applyProviderPreset(provider: string): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  if (provider === "deepwrite-free") {
    const defaultModelId =
      props.modelSettings?.deepwriteFreeDefaultModelId ??
      deepwriteFreeModels.value[0]?.id;
    if (defaultModelId) {
      applyDeepWriteFreeModel(defaultModelId);
    } else {
      uiMessage.warning(
        props.modelSettings?.deepwriteFreeMessage ||
          "DeepWrite 免费模型配置暂时不可用，请稍后重试。"
      );
    }
    return;
  }
  const wasManaged = editor.managedBy === "deepwrite-free";
  delete editor.managedBy;
  if (wasManaged && !editor.originalId) {
    editor.id = createId("model");
  }
  if (wasManaged) {
    editor.label = "";
    editor.modelId = "";
    editor.hasApiKey = false;
    editor.apiKey = "";
    editor.clearApiKey = false;
  }
  editor.provider = provider;
  if (provider === "openai") {
    editor.api = "openai-responses";
    editor.baseUrl = "https://api.openai.com/v1";
  } else if (provider === "anthropic") {
    editor.api = "anthropic-messages";
    editor.baseUrl = "https://api.anthropic.com";
  } else if (provider === "deepseek") {
    editor.api = "openai-completions";
    editor.baseUrl = "https://api.deepseek.com/v1";
  } else if (provider === "kimi-coding") {
    editor.api = "anthropic-messages";
    editor.baseUrl = "https://api.kimi.com/coding";
  } else if (provider === "dashscope") {
    editor.api = "openai-completions";
    editor.baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  } else if (provider === "zhipu") {
    editor.api = "openai-completions";
    editor.baseUrl = "https://open.bigmodel.cn/api/paas/v4";
  } else if (provider === "moonshot") {
    editor.api = "openai-completions";
    editor.baseUrl = "https://api.moonshot.cn/v1";
  } else if (provider === "ollama") {
    editor.api = "openai-completions";
    editor.baseUrl = "http://127.0.0.1:11434/v1";
  } else if (provider === "google") {
    editor.api = "google-generative-ai";
    editor.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }
}

function setModelApi(value: string | number): void {
  if (modelEditor.value) {
    modelEditor.value.api = String(value) as ModelApi;
  }
}

function setDefaultThinkingLevel(value: string | number): void {
  if (modelEditor.value) {
    modelEditor.value.defaultThinkingLevel = String(value);
  }
}

function setModelMode(mode: "reasoning" | "temperature"): void {
  if (!modelEditor.value) {
    return;
  }
  const reasoning = mode === "reasoning";
  modelEditor.value.reasoning = reasoning;
  modelEditor.value.defaultThinkingLevel = reasoning
    ? modelEditor.value.thinkingLevelOptions.includes("medium")
      ? "medium"
      : modelEditor.value.thinkingLevelOptions[0] ?? "medium"
    : "off";
}

function toggleThinkingLevelOption(level: BuiltInReasoningLevel, event: Event): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  const input = event.target as HTMLInputElement;
  const checked = input.checked;
  if (!checked && editor.thinkingLevelOptions.length === 1) {
    input.checked = true;
    uiMessage.warning("思考模式至少需要保留一个思考等级。");
    return;
  }
  const selected = new Set(editor.thinkingLevelOptions);
  if (checked) {
    selected.add(level);
  } else {
    selected.delete(level);
  }
  const customLevel = findCustomThinkingLevel(editor.thinkingLevelOptions);
  editor.thinkingLevelOptions = reasoningOptions
    .map((option) => option.value)
    .filter((option) => selected.has(option)) as ThinkingLevelOptions;
  if (customLevel) {
    editor.thinkingLevelOptions.push(customLevel);
  }
  if (
    editor.reasoning &&
    !editor.thinkingLevelOptions.includes(editor.defaultThinkingLevel as ReasoningLevel)
  ) {
    editor.defaultThinkingLevel = editor.thinkingLevelOptions[0] ?? "medium";
  }
}

function updateCustomThinkingLevel(event: Event): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  const previousCustomLevel = findCustomThinkingLevel(editor.thinkingLevelOptions);
  const customWasDefault = previousCustomLevel === editor.defaultThinkingLevel;
  const rawValue = (event.target as HTMLInputElement).value;
  const customLevel = rawValue.trim();
  editor.customThinkingLevel = rawValue;
  editor.thinkingLevelOptions = editor.thinkingLevelOptions.filter(isBuiltInThinkingLevel);
  if (isValidCustomThinkingLevel(customLevel)) {
    editor.thinkingLevelOptions.push(customLevel);
  }
  if (customWasDefault) {
    editor.defaultThinkingLevel = isValidCustomThinkingLevel(customLevel)
      ? customLevel
      : editor.thinkingLevelOptions[0] ?? "medium";
  }
}

function saveModelEditor(): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  if (!editor.label.trim() || !editor.provider.trim() || !editor.modelId.trim()) {
    uiMessage.warning("请填写名称、Provider 和模型 ID。");
    return;
  }
  const customThinkingLevel = editor.customThinkingLevel?.trim() ?? "";
  if (customThinkingLevel && !isValidCustomThinkingLevel(customThinkingLevel)) {
    uiMessage.warning(
      "自定义思考等级不能与内置等级重复，且只能包含英文字母、数字、点、下划线或连字符。"
    );
    return;
  }
  if (
    !editor.reasoning &&
    (editor.temperatureOptions.some(
      (temperature) => !Number.isFinite(temperature) || temperature < 0 || temperature > 2
    ) ||
      new Set(editor.temperatureOptions).size !== editor.temperatureOptions.length)
  ) {
    uiMessage.warning("请填写 3 个不同的温度值，范围为 0 到 2。");
    return;
  }
  if (
    editor.reasoning &&
    (!editor.thinkingLevelOptions.length ||
      !editor.thinkingLevelOptions.includes(editor.defaultThinkingLevel as ReasoningLevel))
  ) {
    uiMessage.warning("请配置至少一个思考等级，并选择有效的默认等级。");
    return;
  }
  const {
    apiKey,
    customThinkingLevel: _customThinkingLevel,
    originalId,
    ...editorWithoutApiKey
  } = editor;
  const normalized: DraftModel = {
    ...editorWithoutApiKey,
    label: editor.label.trim(),
    provider: editor.provider.trim().toLowerCase(),
    modelId: editor.modelId.trim(),
    baseUrl: editor.baseUrl.trim(),
    defaultThinkingLevel: editor.reasoning ? editor.defaultThinkingLevel : "off",
    thinkingLevelOptions: cloneThinkingLevelOptions(editor.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(editor.temperatureOptions),
    ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
  };
  const index = draftModels.value.findIndex(
    (model) => model.id === (originalId ?? normalized.id)
  );
  const duplicateIndex = draftModels.value.findIndex(
    (model, candidateIndex) => model.id === normalized.id && candidateIndex !== index
  );
  if (duplicateIndex >= 0) {
    uiMessage.warning("这个 DeepWrite 免费模型已经添加过了。");
    return;
  }
  if (index >= 0) {
    draftModels.value[index] = normalized;
  } else {
    draftModels.value.push(normalized);
  }
  if (!draftDefaultModelId.value) {
    draftDefaultModelId.value = normalized.id;
  }
  modelEditor.value = null;
}

function toModelInput(model: DraftModel): ModelConfigInput {
  return {
    id: model.id,
    label: model.label.trim(),
    provider: model.provider.trim().toLowerCase(),
    modelId: model.modelId.trim(),
    ...(model.requestModelId ? { requestModelId: model.requestModelId } : {}),
    ...(model.supportsDeveloperRole !== undefined
      ? { supportsDeveloperRole: model.supportsDeveloperRole }
      : {}),
    api: model.api,
    baseUrl: model.baseUrl.trim(),
    reasoning: model.reasoning,
    defaultThinkingLevel: model.reasoning ? model.defaultThinkingLevel : "off",
    thinkingLevelOptions: cloneThinkingLevelOptions(model.thinkingLevelOptions),
    temperatureOptions: cloneTemperatureOptions(model.temperatureOptions),
    ...(model.managedBy ? { managedBy: model.managedBy } : {}),
    ...(model.apiKey?.trim() ? { apiKey: model.apiKey.trim() } : {}),
    ...(model.clearApiKey ? { clearApiKey: true } : {})
  };
}

function missingRemoteModelCredentials(editor: DraftModel): string | null {
  const missingUrl = !editor.baseUrl.trim();
  const missingKey =
    !editor.apiKey?.trim() &&
    !editor.hasApiKey &&
    editor.provider !== "ollama";
  if (missingUrl && missingKey) {
    return "请先填写 API 地址和 API Key，再拉取可用模型。";
  }
  if (missingUrl) {
    return "请先填写 API 地址，再拉取可用模型。";
  }
  if (missingKey) {
    return "请先填写 API Key，再拉取可用模型。";
  }
  return null;
}

function commandErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return fallback;
  }
  const separator = error.message.indexOf(": ");
  return separator >= 0 ? error.message.slice(separator + 2) : error.message;
}

function setFetchedModelId(value: string | number): void {
  const editor = modelEditor.value;
  if (!editor) {
    return;
  }
  if (String(value) === MANUAL_MODEL_ID_VALUE) {
    fetchedRemoteModels.value = [];
    return;
  }
  editor.modelId = String(value);
}

async function fetchRemoteModels(): Promise<void> {
  const editor = modelEditor.value;
  if (!editor || listingRemoteModels.value) {
    return;
  }
  const missing = missingRemoteModelCredentials(editor);
  if (missing) {
    fetchHintDialog.value = missing;
    return;
  }
  if (!window.deepwrite) {
    uiMessage.error("当前环境无法拉取模型列表。");
    return;
  }
  listingRemoteModels.value = true;
  try {
    const result = await window.deepwrite.models.listRemote({
      id: editor.originalId ?? editor.id,
      provider: editor.provider.trim(),
      api: editor.api,
      baseUrl: editor.baseUrl.trim(),
      ...(editor.apiKey?.trim() ? { apiKey: editor.apiKey.trim() } : {}),
      ...(editor.clearApiKey ? { clearApiKey: true } : {})
    });
    fetchedRemoteModels.value = result.models;
    if (result.models.length === 0) {
      uiMessage.warning("当前接口没有返回可用模型。");
      return;
    }
    if (!editor.modelId.trim()) {
      editor.modelId = result.models[0]!.id;
    }
    uiMessage.success(`已拉取 ${result.models.length} 个可用模型，请选择模型 ID。`);
  } catch (error: unknown) {
    uiMessage.error(commandErrorMessage(error, "拉取模型列表失败。"));
  } finally {
    listingRemoteModels.value = false;
  }
}

function testDraftModel(model: DraftModel): void {
  if (!model.label.trim() || !model.provider.trim() || !model.modelId.trim()) {
    uiMessage.warning("请先填写名称、Provider 和模型 ID，再测试连接。");
    return;
  }
  emit("testModel", toModelInput(model));
}

function removeModel(modelId: string): void {
  if (
    draftModels.value.find((model) => model.id === modelId)?.managedBy ===
    "deepwrite-official"
  ) {
    return;
  }
  draftModels.value = draftModels.value.filter((model) => model.id !== modelId);
  if (draftDefaultModelId.value === modelId) {
    if (props.modelScope === "custom") {
      const remainingCustomIds = new Set(draftModels.value.map((model) => model.id));
      draftDefaultModelId.value =
        props.modelSettings?.models.find(
          (model) => model.id !== modelId && (Boolean(model.managedBy) || remainingCustomIds.has(model.id))
        )?.id ?? draftModels.value[0]?.id ?? "";
    } else {
      draftDefaultModelId.value = draftModels.value[0]?.id ?? "";
    }
  }
  if (modelEditor.value?.id === modelId) {
    modelEditor.value = null;
  }
}

function setDefaultModel(modelId: string): void {
  if (
    props.modelSaving ||
    modelEditor.value ||
    draftDefaultModelId.value === modelId
  ) {
    return;
  }
  draftDefaultModelId.value = modelId;
  submitModelSettings();
}

function submitModelSettings(): void {
  const draftInputs = draftModels.value.map(toModelInput);
  if (props.modelScope === "custom") {
    emit(
      "saveModels",
      mergeCustomModelSettings(
        (props.modelSettings?.models ?? []).map(toModelInput),
        draftInputs,
        draftDefaultModelId.value
      )
    );
    return;
  }
  emit("saveModels", {
    models: draftInputs,
    defaultModelId: draftDefaultModelId.value || draftInputs[0]?.id || ""
  });
}

function discardModelChanges(): void {
  resetModelDraft(props.modelSettings);
}
</script>

<template>
      <section
        class="workspace-settings-panel"
        :class="{ 'is-model-config': mode === 'models', 'is-embedded': embedded }"
      >
        <header v-if="!embedded">
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2>
              {{
                mode === "directory"
                  ? "工作目录"
                  : mode === "models"
                    ? "模型配置"
                    : "模型配置"
              }}
            </h2>
          </div>
        </header>

        <div v-if="mode === 'directory'" class="dialog-content">
          <p class="dialog-description">这里决定以后新建和导入项目的默认位置。切换目录不会移动或影响已经打开的书籍、素材库和技能库。</p>
          <div class="directory-card">
            <AppIcon name="directory" :size="20" />
            <div>
              <strong>{{ workspaceDirectoryPath ? "当前工作目录" : "尚未选择工作目录" }}</strong>
              <code>{{ workspaceDirectoryPath ?? "首次创建或导入时也会提示选择" }}</code>
            </div>
            <span>{{ workspaceDirectoryPath ? "已启用" : "待设置" }}</span>
          </div>
          <div class="dialog-note">新书和旧版导入保存在 books，新素材库保存在 materials，新技能库保存在 skills。项目仍采用 deepwrite.json + Markdown 文件结构，可由 Git 或同步盘直接管理。</div>
          <div class="dialog-actions">
            <button
              class="dialog-primary-button"
              type="button"
              :disabled="workspaceDirectoryLoading"
              @click="emit('chooseWorkspaceDirectory')"
            >
              {{ workspaceDirectoryLoading ? "选择中…" : workspaceDirectoryPath ? "切换工作目录" : "选择工作目录" }}
            </button>
          </div>
        </div>

        <div v-else-if="mode === 'models'" class="dialog-content model-config-content">
          <div ref="modelConfigScrollArea" class="model-config-scroll-area">
            <div
              v-if="modelScope === 'all' && modelAlertMessages.length > 0"
              class="dialog-description model-price-notice"
              aria-label="模型公告"
            >
              <button
                v-for="(message, index) in modelAlertMessages"
                :key="`${index}:${message}`"
                class="model-price-notice-link"
                type="button"
                title="前往设置官方模型"
                @click="emit('openOfficialModels')"
              >
                {{ message }}
              </button>
            </div>

            <div v-if="modelLoading" class="dialog-note">正在读取模型配置…</div>
            <template v-else>
              <div v-if="draftModels.length === 0" class="model-empty-state">
                <strong>{{ modelScope === "custom" ? "尚未配置自定义模型" : "尚未配置真实模型" }}</strong>
                <span>{{ modelScope === "custom" ? "添加自定义模型后，可在这里测试连接、维护密钥并设为全局默认模型。" : "当前对话继续使用 DeepWrite Faux。添加模型并设为默认后，新的请求会走真实 Provider。" }}</span>
              </div>

              <template v-for="row in modelConfigRows" :key="row.key">
              <section v-if="row.type === 'editor' && modelEditor" class="model-editor">
                <div class="model-editor-heading">
                  <strong>{{ draftModels.some((model) => model.id === (modelEditor?.originalId ?? modelEditor?.id)) ? "编辑模型" : "添加模型" }}</strong>
                  <button type="button" @click="modelEditor = null">取消</button>
                </div>
                <div class="model-form-grid">
                  <label>
                    <span>名称</span>
                    <input
                      v-model="modelEditor.label"
                      type="text"
                      placeholder="例如：DeepSeek 写作"
                      :readonly="isDeepWriteFreeEditor"
                    />
                  </label>
                  <label>
                    <span>Provider</span>
                    <PopupSelect
                      :model-value="isDeepWriteFreeEditor ? 'deepwrite-free' : modelEditor.provider"
                      :options="providerOptions"
                      accessible-label="选择 Provider"
                      @update:model-value="applyProviderPreset(String($event))"
                    />
                  </label>
                  <label>
                    <span>模型 ID</span>
                    <PopupSelect
                      v-if="isDeepWriteFreeEditor"
                      :model-value="modelEditor.id"
                      :options="deepwriteFreeModelOptions"
                      accessible-label="选择 DeepWrite 免费模型"
                      :menu-min-width="300"
                      @update:model-value="applyDeepWriteFreeModel(String($event))"
                    />
                    <div v-else class="model-id-field">
                      <PopupSelect
                        v-if="canSelectRemoteModel"
                        :model-value="modelEditor.modelId"
                        :options="remoteModelOptions"
                        accessible-label="选择模型 ID"
                        placeholder="请选择模型 ID"
                        :menu-min-width="280"
                        :disabled="listingRemoteModels"
                        @update:model-value="setFetchedModelId"
                      />
                      <input
                        v-else
                        v-model="modelEditor.modelId"
                        type="text"
                        placeholder="服务商提供的模型 ID"
                      />
                      <button
                        class="model-id-fetch-button"
                        type="button"
                        :disabled="listingRemoteModels"
                        :title="listingRemoteModels ? '拉取中…' : '根据 API 地址和 Key 拉取可用模型'"
                        :aria-label="listingRemoteModels ? '拉取中' : '拉取可用模型'"
                        @click="fetchRemoteModels"
                      >
                        {{ listingRemoteModels ? "拉取中" : "拉取" }}
                      </button>
                    </div>
                  </label>
                  <label v-if="!isDeepWriteFreeEditor">
                    <span>API 类型</span>
                    <PopupSelect
                      :model-value="modelEditor.api"
                      :options="apiOptions"
                      accessible-label="选择 API 类型"
                      :menu-min-width="240"
                      @update:model-value="setModelApi"
                    />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor" class="is-wide">
                    <span>API 地址</span>
                    <input v-model="modelEditor.baseUrl" type="url" placeholder="内置模型可留空，自定义服务请填写" />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor" class="is-wide">
                    <span>API Key</span>
                    <input
                      v-model="modelEditor.apiKey"
                      type="password"
                      :placeholder="modelEditor.hasApiKey ? '已安全保存；留空表示保持不变' : '请输入 API Key（本地服务可留空）'"
                      autocomplete="new-password"
                      @input="modelEditor.clearApiKey = false"
                    />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor">
                    <span>模型模式</span>
                    <PopupSelect
                      :model-value="modelEditor.reasoning ? 'reasoning' : 'temperature'"
                      :options="modelModeOptions"
                      accessible-label="选择模型模式"
                      @update:model-value="setModelMode(String($event) as 'reasoning' | 'temperature')"
                    />
                  </label>
                  <label v-if="!isDeepWriteFreeEditor && modelEditor.reasoning">
                    <span>默认思考等级</span>
                    <PopupSelect
                      :model-value="modelEditor.defaultThinkingLevel"
                      :options="defaultThinkingOptions"
                      accessible-label="选择默认思考等级"
                      @update:model-value="setDefaultThinkingLevel"
                    />
                  </label>
                  <label v-else-if="!isDeepWriteFreeEditor">
                    <span class="model-field-label">
                      温度选项
                      <span
                        class="model-help-icon"
                        tabindex="0"
                        aria-label="温度说明：温度越低，输出越稳定和确定；温度越高，表达越多样和有创造性。可填写 0 到 2。"
                        data-tooltip="温度越低，输出越稳定、确定；温度越高，表达越多样、有创造性。可填写 0–2。"
                      >!</span>
                    </span>
                    <span class="model-temperature-options">
                      <input
                        v-for="(_, index) in modelEditor.temperatureOptions"
                        :key="index"
                        v-model.number="modelEditor.temperatureOptions[index]"
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        :aria-label="`温度选项 ${index + 1}`"
                      />
                    </span>
                  </label>
                  <label v-if="!isDeepWriteFreeEditor && modelEditor.reasoning" class="is-wide">
                    <span>思考等级选项</span>
                    <span class="model-thinking-options">
                      <label
                        v-for="option in reasoningOptions"
                        :key="option.value"
                        class="model-thinking-option"
                        tabindex="0"
                        :title="option.value"
                        :data-tooltip="option.value"
                      >
                        <input
                          type="checkbox"
                          :checked="modelEditor.thinkingLevelOptions.includes(option.value)"
                          @change="toggleThinkingLevelOption(option.value, $event)"
                        />
                        <span>{{ option.label }}</span>
                      </label>
                      <span
                        class="model-custom-thinking"
                        :title="modelEditor.customThinkingLevel?.trim() || 'custom'"
                        :data-tooltip="modelEditor.customThinkingLevel?.trim() || 'custom'"
                      >
                        <span>自定义</span>
                        <input
                          :value="modelEditor.customThinkingLevel"
                          type="text"
                          maxlength="64"
                          placeholder="例如 ultra"
                          aria-label="自定义思考等级英文值"
                          @input="updateCustomThinkingLevel"
                        />
                      </span>
                    </span>
                  </label>
                  <p v-if="isDeepWriteFreeEditor" class="model-managed-note is-wide">
                    模型名称和参数由 DeepWrite 远程配置自动维护；运行环境提供密钥，无需在此填写。
                  </p>
                </div>
                <div
                  v-if="modelEditor.hasApiKey && !isDeepWriteFreeEditor"
                  class="model-key-row"
                >
                  <span>已有密钥会保持不变。</span>
                  <button
                    type="button"
                    @click="modelEditor.hasApiKey = false; modelEditor.clearApiKey = true; modelEditor.apiKey = ''"
                  >
                    清除已保存密钥
                  </button>
                </div>
                <div class="dialog-actions">
                  <button
                    v-if="isDeepWriteFreeEditor"
                    class="dialog-secondary-button"
                    type="button"
                    :disabled="freeModelsRefreshing || testingModelId !== null"
                    @click="emit('refreshFreeModels')"
                  >
                    {{ freeModelsRefreshing ? "刷新中…" : "刷新免费模型" }}
                  </button>
                  <button
                    class="dialog-secondary-button"
                    type="button"
                    :disabled="testingModelId !== null"
                    @click="testDraftModel(modelEditor)"
                  >
                    {{ testingModelId === modelEditor.id ? "测试中…" : "测试当前填写" }}
                  </button>
                  <button class="dialog-primary-button" type="button" @click="saveModelEditor">
                    应用到配置
                  </button>
                </div>
              </section>

              <article
                v-else-if="row.type === 'model'"
                class="model-card model-config-card"
                :class="{ 'is-default': draftDefaultModelId === row.model.id }"
              >
              <span class="model-logo">{{ row.model.label.slice(0, 1).toUpperCase() }}</span>
              <div>
                <strong>{{ row.model.label }}</strong>
                <small>{{ row.model.managedBy === "deepwrite-official" ? "DeepWrite 官方模型" : row.model.managedBy === "deepwrite-free" ? "DeepWrite 免费模型" : row.model.provider }} · {{ row.model.modelId }} · {{ row.model.api }}</small>
                <small>
                  {{ row.model.reasoning ? `思考：${row.model.thinkingLevelOptions.map(thinkingLabel).join(" / ")}（默认 ${thinkingLabel(row.model.defaultThinkingLevel)}）` : `温度：${row.model.temperatureOptions.join(" / ")}` }} ·
                  {{ row.model.hasApiKey || row.model.apiKey ? "密钥已配置" : "未配置密钥" }}
                </small>
              </div>
              <div class="model-card-actions">
                <button
                  type="button"
                  :class="{ 'is-active': draftDefaultModelId === row.model.id }"
                  :disabled="modelSaving || Boolean(modelEditor)"
                  @click="setDefaultModel(row.model.id)"
                >
                  {{ modelSaving && draftDefaultModelId === row.model.id ? "保存中…" : draftDefaultModelId === row.model.id ? "默认" : "设为默认" }}
                </button>
                <button v-if="row.model.managedBy !== 'deepwrite-official'" type="button" @click="editModel(row.model)">编辑</button>
                <button
                  type="button"
                  :disabled="testingModelId !== null"
                  title="使用当前未保存的配置测试连接"
                  @click="testDraftModel(row.model)"
                >
                  {{ testingModelId === row.model.id ? "测试中…" : "测试连接" }}
                </button>
                <button v-if="row.model.managedBy !== 'deepwrite-official'" class="is-danger" type="button" @click="removeModel(row.model.id)">删除</button>
              </div>
              </article>
              </template>

              <button
                v-if="!modelEditor"
                class="dialog-secondary-button model-add-button"
                type="button"
                @click="createModel"
              >
                <AppIcon name="plus" :size="15" />添加模型
              </button>
            </template>
          </div>

          <div v-if="!modelLoading" class="dialog-actions model-save-actions">
            <button class="dialog-secondary-button" type="button" @click="discardModelChanges">还原未保存</button>
            <button
              class="dialog-primary-button"
              type="button"
              :disabled="modelSaving || Boolean(modelEditor)"
              @click="submitModelSettings"
            >
              {{ modelSaving ? "保存中…" : "保存模型配置" }}
            </button>
          </div>
        </div>

      </section>

      <Teleport to="body">
        <div
          v-if="fetchHintDialog"
          class="dialog-backdrop model-fetch-hint-overlay"
          @mousedown.self="fetchHintDialog = null"
          @keydown.esc.stop="fetchHintDialog = null"
        >
          <section
            class="model-fetch-hint-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="model-fetch-hint-title"
            aria-describedby="model-fetch-hint-message"
            tabindex="-1"
            @keydown.esc.stop="fetchHintDialog = null"
          >
            <header>
              <div>
                <span class="dialog-eyebrow">模型配置</span>
                <h2 id="model-fetch-hint-title">无法拉取模型</h2>
              </div>
            </header>
            <p id="model-fetch-hint-message">{{ fetchHintDialog }}</p>
            <footer class="dialog-actions">
              <button
                ref="fetchHintConfirmButton"
                class="dialog-primary-button"
                type="button"
                @click="fetchHintDialog = null"
              >
                知道了
              </button>
            </footer>
          </section>
        </div>
      </Teleport>
</template>
