<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ModelSettings,
  ModelUsageDashboard,
  ModelUsageTotals
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  settings: ModelSettings | null;
  dashboard: ModelUsageDashboard | null;
  loading: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  load: [];
  saveToken: [apiKey: string];
  clearToken: [];
}>();

const tokenEditorOpen = ref(false);
const tokenDraft = ref("");
const tokenConfigured = computed(
  () => props.settings?.deepwriteOfficialTokenConfigured === true
);
const officialModels = computed(
  () => props.settings?.deepwriteOfficialModels ?? []
);
const quotaTokens = computed(
  () => props.settings?.deepwriteOfficialQuotaTokens ?? 10_000_000
);
const totalUsed = computed(() => props.dashboard?.totals.totalTokens ?? 0);
const remainingTokens = computed(() =>
  Math.max(0, quotaTokens.value - totalUsed.value)
);
const quotaExhausted = computed(() => remainingTokens.value === 0);
const usagePercentage = computed(() =>
  Math.min(100, (totalUsed.value / Math.max(1, quotaTokens.value)) * 100)
);

const EMPTY_TOTALS: ModelUsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  requestCount: 0
};

const modelRows = computed(() =>
  officialModels.value.map((model) => ({
    model,
    totals:
      props.dashboard?.models.find(
        (summary) => summary.model.configId === model.id
      )?.totals ?? EMPTY_TOTALS
  }))
);

watch(tokenConfigured, (configured) => {
  if (!configured) return;
  tokenDraft.value = "";
  tokenEditorOpen.value = false;
});

function openTokenEditor(): void {
  tokenDraft.value = "";
  tokenEditorOpen.value = true;
}

function submitToken(): void {
  const apiKey = tokenDraft.value.trim();
  if (!apiKey) {
    uiMessage.warning("请输入官方令牌。");
    return;
  }
  emit("saveToken", apiKey);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    Math.max(0, Number.isFinite(value) ? value : 0)
  );
}

function formatCompactTokens(value: number): string {
  if (value >= 10_000) {
    return `${new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: value >= 1_000_000 ? 1 : 0
    }).format(value / 10_000)} 万`;
  }
  return formatTokens(value);
}

function cacheTokens(totals: ModelUsageTotals): number {
  return totals.cacheReadTokens + totals.cacheWriteTokens;
}

</script>

<template>
  <section class="official-models-panel" aria-labelledby="official-models-title">
    <header class="official-models-header">
      <div>
        <span class="official-models-kicker">
          <AppIcon name="model" :size="15" /> DeepWrite 托管接入
        </span>
        <h2 id="official-models-title">官方模型与令牌</h2>
        <p>官方模型来源于国内模型厂商直连，随着软件整体调用量越多，价格会逐渐降低，目前和官方价格一致。</p>
      </div>
      <button class="official-refresh-button" type="button" :disabled="loading" @click="emit('load')">
        <AppIcon name="history" :size="15" />
        {{ loading ? "刷新中…" : "刷新" }}
      </button>
    </header>

    <section class="official-token-card" :class="{ 'is-configured': tokenConfigured }">
      <div class="official-token-status">
        <span class="official-token-icon"><AppIcon name="model" :size="20" /></span>
        <div>
          <strong>{{ tokenConfigured ? "官方令牌已添加" : "添加你的官方令牌" }}</strong>
          <small>
            {{ tokenConfigured
              ? `已启用 ${officialModels.length} 个官方模型，令牌明文不会回传到页面。`
              : "添加后，官方模型会自动出现在模型配置列表最上方。" }}
          </small>
        </div>
        <span class="official-token-badge">{{ tokenConfigured ? "已启用" : "未添加" }}</span>
      </div>

      <form v-if="tokenEditorOpen" class="official-token-form" @submit.prevent="submitToken">
        <label>
          <span>官方令牌</span>
          <input
            v-model="tokenDraft"
            type="password"
            autocomplete="new-password"
            placeholder="请输入官方令牌"
            :disabled="saving"
          />
        </label>
        <div class="official-token-form-actions">
          <button type="button" :disabled="saving" @click="tokenEditorOpen = false; tokenDraft = ''">取消</button>
          <button class="is-primary" type="submit" :disabled="saving">
            {{ saving ? "保存中…" : tokenConfigured ? "更新令牌" : "添加令牌" }}
          </button>
        </div>
      </form>

      <div v-else class="official-token-actions">
        <button class="is-primary" type="button" :disabled="saving" @click="openTokenEditor">
          <AppIcon name="plus" :size="15" />
          {{ tokenConfigured ? "更换令牌" : "添加令牌" }}
        </button>
        <button
          v-if="tokenConfigured"
          type="button"
          class="is-remove"
          :disabled="saving"
          @click="emit('clearToken')"
        >
          移除令牌
        </button>
      </div>
    </section>

    <section class="official-quota-card" aria-label="官方模型额度">
      <div class="official-quota-heading">
        <div>
          <span>默认额度</span>
          <strong>{{ formatCompactTokens(quotaTokens) }} Token</strong>
        </div>
        <div class="official-quota-remaining">
          <span>剩余</span>
          <strong>{{ formatTokens(remainingTokens) }}</strong>
        </div>
      </div>
      <div class="official-quota-track" role="progressbar" :aria-valuenow="usagePercentage" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${usagePercentage}%` }" />
      </div>
      <small>本机累计已消耗 {{ formatTokens(totalUsed) }} Token；用量来自本地账本。</small>
    </section>

    <section class="official-model-list-card" aria-labelledby="official-model-list-title">
      <header>
        <div>
          <span>当前支持</span>
          <h3 id="official-model-list-title">支撑的模型列表</h3>
        </div>
        <span>{{ officialModels.length }} 个模型</span>
      </header>

      <div v-if="loading && !settings" class="official-model-state">正在加载官方模型…</div>
      <div v-else class="official-model-table-wrap">
        <table class="official-model-table">
          <thead>
            <tr>
              <th scope="col">模型</th>
              <th scope="col">总消耗</th>
              <th scope="col">输入</th>
              <th scope="col">输出</th>
              <th scope="col">缓存</th>
              <th scope="col">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in modelRows" :key="row.model.id">
              <td>
                <strong>{{ row.model.label }}</strong>
                <small>{{ row.model.modelId }}</small>
              </td>
              <td>{{ formatTokens(row.totals.totalTokens) }}</td>
              <td>{{ formatTokens(row.totals.inputTokens) }}</td>
              <td>{{ formatTokens(row.totals.outputTokens) }}</td>
              <td>
                <strong>{{ formatTokens(cacheTokens(row.totals)) }}</strong>
                <small>读 {{ formatTokens(row.totals.cacheReadTokens) }} · 写 {{ formatTokens(row.totals.cacheWriteTokens) }}</small>
              </td>
              <td>
                <span
                  class="official-model-status"
                  :class="{ 'is-enabled': tokenConfigured && !quotaExhausted }"
                >
                  {{ !tokenConfigured ? "待添加令牌" : quotaExhausted ? "额度耗尽" : "可用" }}
                </span>
              </td>
            </tr>
            <tr v-if="!modelRows.length">
              <td colspan="6" class="official-model-state">暂无可用的官方模型。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.official-models-panel { display: grid; gap: 18px; width: 100%; padding-bottom: 36px; color: var(--text-primary); }
.official-models-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.official-models-header h2 { margin: 6px 0 8px; font-size: 1.5rem; }
.official-models-header p { max-width: 720px; margin: 0; color: var(--text-secondary); line-height: 1.65; }
.official-models-kicker { display: inline-flex; align-items: center; gap: 7px; color: var(--accent); font-size: .857143rem; font-weight: 650; }
.official-refresh-button, .official-token-actions button, .official-token-form-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 0 13px; border: 1px solid var(--theme-line); border-radius: 10px; background: var(--surface-raised); color: var(--text-secondary); font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { cursor: wait; opacity: .58; }
.official-token-card, .official-quota-card, .official-model-list-card { border: 1px solid var(--theme-line-soft); border-radius: 16px; background: var(--surface-raised); box-shadow: 0 1px 3px color-mix(in srgb, var(--theme-foreground) 4%, transparent); }
.official-token-card { padding: 18px; }
.official-token-card.is-configured { border-color: color-mix(in srgb, var(--accent) 30%, var(--theme-line-soft)); }
.official-token-status { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 13px; }
.official-token-status > div { display: grid; gap: 4px; }
.official-token-status small { color: var(--text-secondary); line-height: 1.5; }
.official-token-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); }
.official-token-badge, .official-model-status { padding: 4px 9px; border-radius: 999px; background: var(--surface-muted); color: var(--text-tertiary); font-size: .785714rem; font-weight: 650; white-space: nowrap; }
.official-token-card.is-configured .official-token-badge, .official-model-status.is-enabled { background: var(--accent-soft); color: var(--accent); }
.official-token-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; }
.official-token-actions .is-primary, .official-token-form-actions .is-primary { border-color: color-mix(in srgb, var(--text-primary) 88%, transparent); background: var(--text-primary); color: var(--surface-main); }
.official-token-actions .is-remove { color: var(--text-secondary); }
.official-token-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--theme-line-soft); }
.official-token-form label { display: grid; gap: 7px; color: var(--text-secondary); font-size: .857143rem; font-weight: 620; }
.official-token-form input { min-width: 0; padding: 10px 12px; border: 1px solid var(--theme-line); border-radius: 10px; outline: 0; background: var(--surface-main); color: var(--text-primary); font: inherit; }
.official-token-form input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.official-token-form-actions { display: flex; gap: 8px; }
.official-quota-card { padding: 18px 20px; }
.official-quota-heading { display: flex; justify-content: space-between; gap: 18px; }
.official-quota-heading > div { display: grid; gap: 5px; }
.official-quota-heading span, .official-model-list-card > header span { color: var(--text-tertiary); font-size: .821429rem; font-weight: 600; }
.official-quota-heading strong { font-size: 1.285714rem; }
.official-quota-remaining { text-align: right; }
.official-quota-track { height: 7px; margin: 15px 0 9px; overflow: hidden; border-radius: 999px; background: var(--surface-muted); }
.official-quota-track span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .2s ease; }
.official-quota-card > small { color: var(--text-secondary); }
.official-model-list-card { overflow: hidden; }
.official-model-list-card > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 17px 20px; border-bottom: 1px solid var(--theme-line-soft); }
.official-model-list-card h3 { margin: 3px 0 0; font-size: 1.071429rem; }
.official-model-table-wrap { overflow-x: auto; }
.official-model-table { width: 100%; min-width: 720px; border-collapse: collapse; }
.official-model-table th, .official-model-table td { padding: 13px 16px; border-bottom: 1px solid var(--theme-line-soft); text-align: left; vertical-align: middle; }
.official-model-table tr:last-child td { border-bottom: 0; }
.official-model-table th { background: var(--surface-muted); color: var(--text-tertiary); font-size: .785714rem; font-weight: 650; }
.official-model-table td { color: var(--text-secondary); font-size: .857143rem; font-variant-numeric: tabular-nums; }
.official-model-table td:first-child { min-width: 240px; }
.official-model-table td:first-child, .official-model-table td:nth-child(5) { display: table-cell; }
.official-model-table td strong, .official-model-table td small { display: block; }
.official-model-table td:first-child strong { color: var(--text-primary); font-size: .928571rem; }
.official-model-table td small { margin-top: 4px; color: var(--text-tertiary); font-size: .75rem; }
.official-model-state { padding: 28px; color: var(--text-tertiary); text-align: center; }

@media (max-width: 900px) {
  .official-models-header { flex-direction: column; }
  .official-token-form { grid-template-columns: 1fr; }
  .official-token-form-actions { justify-content: flex-end; }
}
</style>
