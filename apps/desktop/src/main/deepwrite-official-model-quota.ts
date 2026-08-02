import type { AgentProviderRuntimeConfig, ModelUsageDashboard } from "@deepwrite/contracts";
import { DEEPWRITE_OFFICIAL_DEFAULT_QUOTA_TOKENS } from "./deepwrite-official-model-config";

export const DEEPWRITE_OFFICIAL_QUOTA_EXHAUSTED_MESSAGE =
  "DeepWrite 官方模型的 1000 万 Token 额度已用完，本次调用已停止，请切换其他模型。";

interface OfficialUsageReader {
  query(input: {
    managedBy: "deepwrite-official";
  }): Promise<ModelUsageDashboard>;
}

export async function assertDeepWriteOfficialQuotaAvailable(
  usageReader: OfficialUsageReader,
  runtimeConfigs: readonly (AgentProviderRuntimeConfig | undefined)[],
  quotaTokens = DEEPWRITE_OFFICIAL_DEFAULT_QUOTA_TOKENS
): Promise<void> {
  if (
    !runtimeConfigs.some(
      (runtimeConfig) => runtimeConfig?.managedBy === "deepwrite-official"
    )
  ) {
    return;
  }

  const dashboard = await usageReader.query({ managedBy: "deepwrite-official" });
  if (dashboard.totals.totalTokens >= quotaTokens) {
    throw new Error(DEEPWRITE_OFFICIAL_QUOTA_EXHAUSTED_MESSAGE);
  }
}
