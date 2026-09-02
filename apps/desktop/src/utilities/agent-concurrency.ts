import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";

export const MAX_ACTIVE_AGENT_RUNS = 4;

export interface AgentRunAdmission {
  allowed: boolean;
  key: string;
  limit: number;
  message?: string;
}

export function resolveConcurrencyModel(
  parent: AgentProviderRuntimeConfig | undefined,
  subagents: Readonly<Record<string, AgentProviderRuntimeConfig>> | undefined
): AgentProviderRuntimeConfig | undefined {
  const candidates = [parent, ...Object.values(subagents ?? {})].filter(
    (config): config is AgentProviderRuntimeConfig => Boolean(config)
  );
  return (
    candidates.find(
      ({ provider }) => provider.trim().toLowerCase() === "ollama"
    ) ?? parent
  );
}

export function agentRunConcurrencyKey(
  config: AgentProviderRuntimeConfig | undefined
): string {
  return config?.id ?? "__deepwrite_faux__";
}

export function resolveAgentRunAdmission(
  activeKeys: readonly string[],
  config: AgentProviderRuntimeConfig | undefined
): AgentRunAdmission {
  const key = agentRunConcurrencyKey(config);
  if (activeKeys.length >= MAX_ACTIVE_AGENT_RUNS) {
    return {
      allowed: false,
      key,
      limit: MAX_ACTIVE_AGENT_RUNS,
      message: "本地智能体并发运行数量已达到上限。"
    };
  }

  const ollama = config?.provider.trim().toLowerCase() === "ollama";
  const limit = ollama ? (config.concurrencyLimit ?? 1) : MAX_ACTIVE_AGENT_RUNS;
  const activeForModel = activeKeys.filter((candidate) => candidate === key);
  if (activeForModel.length >= limit) {
    return {
      allowed: false,
      key,
      limit,
      message: ollama
        ? `当前 Ollama 模型并发已达到 ${limit}。请等待运行结束，或在模型高级配置中调整为 2。`
        : "本地智能体并发运行数量已达到上限。"
    };
  }
  return { allowed: true, key, limit };
}
