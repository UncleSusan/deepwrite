import { computed, ref, watch, type Ref } from "vue";
import type { RemoteModelListItem } from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import type { DraftModel } from "../components/modelSettingsDraft";

const MANUAL_MODEL_ID_VALUE = "__deepwrite-manual-model-id__";

function missingCredentials(editor: DraftModel): string | null {
  const missingUrl = !editor.baseUrl.trim();
  const missingKey =
    !editor.apiKey?.trim() && !editor.hasApiKey && editor.provider !== "ollama";
  if (missingUrl && missingKey) {
    return "请先填写 API 地址和 API Key，再拉取可用模型。";
  }
  if (missingUrl) return "请先填写 API 地址，再拉取可用模型。";
  if (missingKey) return "请先填写 API Key，再拉取可用模型。";
  return null;
}

function commandErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  const separator = error.message.indexOf(": ");
  return separator >= 0 ? error.message.slice(separator + 2) : error.message;
}

export function useRemoteModelListing(editor: Ref<DraftModel>) {
  const fetchedRemoteModels = ref<RemoteModelListItem[]>([]);
  const listingRemoteModels = ref(false);
  const fetchHintDialog = ref<string | null>(null);

  const canSelectRemoteModel = computed(
    () => fetchedRemoteModels.value.length > 0
  );
  const remoteModelOptions = computed(() => {
    const current = editor.value.modelId.trim();
    const options = fetchedRemoteModels.value.map((model) => ({
      value: model.id,
      label: model.label && model.label !== model.id ? model.label : model.id,
      ...(model.label && model.label !== model.id
        ? { description: model.id, title: model.id }
        : { title: model.id })
    }));
    if (current && !options.some((option) => option.value === current)) {
      options.unshift({ value: current, label: current, title: current });
    }
    options.push({
      value: MANUAL_MODEL_ID_VALUE,
      label: "手动输入其他模型 ID",
      title: "返回手动填写"
    });
    return options;
  });

  watch(
    () => [
      editor.value.id,
      editor.value.provider,
      editor.value.api,
      editor.value.baseUrl.trim()
    ],
    () => {
      fetchedRemoteModels.value = [];
    }
  );

  function setFetchedModelId(value: string | number): void {
    if (String(value) === MANUAL_MODEL_ID_VALUE) {
      fetchedRemoteModels.value = [];
      return;
    }
    editor.value.modelId = String(value);
  }

  async function fetchRemoteModels(): Promise<void> {
    if (listingRemoteModels.value) return;
    const missing = missingCredentials(editor.value);
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
        id: editor.value.originalId ?? editor.value.id,
        provider: editor.value.provider.trim(),
        api: editor.value.api,
        baseUrl: editor.value.baseUrl.trim(),
        ...(editor.value.apiKey?.trim()
          ? { apiKey: editor.value.apiKey.trim() }
          : {}),
        ...(editor.value.clearApiKey ? { clearApiKey: true } : {})
      });
      fetchedRemoteModels.value = result.models;
      if (result.models.length === 0) {
        uiMessage.warning("当前接口没有返回可用模型。");
        return;
      }
      if (!editor.value.modelId.trim()) {
        editor.value.modelId = result.models[0]!.id;
      }
      uiMessage.success(
        `已拉取 ${result.models.length} 个可用模型，请选择模型 ID。`
      );
    } catch (error: unknown) {
      uiMessage.error(commandErrorMessage(error, "拉取模型列表失败。"));
    } finally {
      listingRemoteModels.value = false;
    }
  }

  return {
    canSelectRemoteModel,
    remoteModelOptions,
    listingRemoteModels,
    fetchHintDialog,
    setFetchedModelId,
    fetchRemoteModels
  };
}
