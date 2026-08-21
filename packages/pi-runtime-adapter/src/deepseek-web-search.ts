import {
  isDeepSeekWebSearchCompatible,
  type AgentProviderRuntimeConfig,
  type ModelApi
} from "@deepwrite/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWebSearchTool(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.type === "web_search" ||
    value.type === "web_search_2025_08_26" ||
    value.type === "web_search_20250305"
  );
}

export function assertDeepSeekWebSearchCompatible(
  config: AgentProviderRuntimeConfig
): void {
  if (isDeepSeekWebSearchCompatible(config)) return;
  throw new Error(
    "智能搜索仅支持 Provider 为 DeepSeek，且 API 类型为 OpenAI Responses 或 Anthropic Messages 的模型。"
  );
}

export function appendDeepSeekWebSearchTool(
  payload: unknown,
  api: ModelApi
): unknown {
  if (!isRecord(payload)) {
    throw new Error("DeepSeek 智能搜索无法扩展当前 Provider 请求。");
  }
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  if (tools.some(isWebSearchTool)) return payload;
  const webSearchTool =
    api === "anthropic-messages"
      ? { type: "web_search_20250305", name: "web_search" }
      : { type: "web_search" };
  return { ...payload, tools: [...tools, webSearchTool] };
}
