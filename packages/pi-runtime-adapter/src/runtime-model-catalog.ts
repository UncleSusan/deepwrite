import type { Api, Model } from "@earendil-works/pi-ai";

/**
 * Runtime model metadata that DeepWrite needs before the pinned pi-ai catalog
 * has caught up with a newly released model.
 *
 * Keep endpoint credentials and user-facing enablement out of this catalog.
 * A configured model still supplies its own provider, base URL, label, and key.
 */
const DEEPWRITE_RUNTIME_MODELS = [
  {
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash 0731",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek"
    },
    reasoning: true,
    // The 0731 release is the production DeepSeek V4 Flash checkpoint and
    // keeps the same reasoning controls as the Pi catalog's unversioned model.
    thinkingLevelMap: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max"
    },
    input: ["text"],
    // Managed-model billing comes from DeepWrite's remote catalog.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000
  } satisfies Model<"openai-completions">,
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    // The Codex model catalog exposes low through ultra for Sol. Pi carries
    // custom max/ultra values through xhigh at request time.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000
  } satisfies Model<"openai-responses">,
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    // Terra supports the same low-through-ultra reasoning range as Sol.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000
  } satisfies Model<"openai-responses">,
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    // Luna tops out at max; max is carried through Pi's xhigh slot.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      xhigh: "max"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000
  } satisfies Model<"openai-responses">,
  {
    id: "kimi-k3",
    name: "Kimi K3",
    api: "openai-completions",
    provider: "moonshotai",
    baseUrl: "https://api.moonshot.ai/v1",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "openai",
      supportsStrictMode: true
    },
    reasoning: true,
    // K3 always thinks. Pi represents an unsupported off switch with null;
    // max is carried through Pi's xhigh slot and serialized as "max".
    thinkingLevelMap: {
      off: null,
      low: "low",
      high: "high",
      xhigh: "max"
    },
    input: ["text", "image"],
    // Billing for managed models is calculated from DeepWrite's remote
    // catalog, not from pi-ai's USD-denominated model metadata.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    // Kimi documents 131072 as the default completion limit. The API permits
    // callers to raise it further, but DeepWrite does not expose that control.
    maxTokens: 131_072
  } satisfies Model<"openai-completions">,
  {
    id: "qwen3.8-max",
    name: "Qwen3.8 Max",
    api: "openai-completions",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "openai",
      supportsStrictMode: true
    },
    reasoning: true,
    // Qwen3.8 uses low / medium / xhigh. The public catalog exposes
    // low / high / max, so high is promoted to xhigh; max is accepted by the
    // API as an OpenAI-compatible alias for xhigh. `none` disables thinking.
    thinkingLevelMap: {
      off: "none",
      low: "low",
      high: "xhigh",
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 983_616,
    maxTokens: 131_072
  } satisfies Model<"openai-completions">,
  {
    id: "qwen3.8-max-preview",
    name: "Qwen3.8 Max Preview",
    api: "openai-completions",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_completion_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "openai",
      supportsStrictMode: true
    },
    reasoning: true,
    // Preview is thinking-only. A null off mapping tells Pi not to serialize
    // a false disable control that this model cannot honor.
    thinkingLevelMap: {
      off: null,
      low: "low",
      high: "xhigh",
      xhigh: "xhigh"
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 983_616,
    maxTokens: 131_072
  } satisfies Model<"openai-completions">
] as const;

export function findDeepWriteRuntimeModel(modelId: string): Model<Api> | undefined {
  return DEEPWRITE_RUNTIME_MODELS.find(
    (model) => model.id.toLowerCase() === modelId.toLowerCase()
  ) as Model<Api> | undefined;
}
