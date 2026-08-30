<script setup lang="ts">
import type { ThinkingLevel } from "@deepwrite/contracts/renderer";
import AppIcon from "./AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";

const props = defineProps<{
  thinkingLevel: ThinkingLevel;
  options: PopupSelectOption[];
  webSearchEnabled: boolean;
  webSearchAvailable: boolean;
  webSearchDisabledReason: string;
  responding: boolean;
}>();

const emit = defineEmits<{
  selectThinking: [level: ThinkingLevel];
  toggleWebSearch: [enabled: boolean];
}>();

function handleThinking(value: PopupSelectValue): void {
  emit("selectThinking", String(value) as ThinkingLevel);
}

function webSearchTitle(): string {
  if (props.responding) return "当前回复完成或停止后，才能切换联网";
  if (!props.webSearchAvailable) return props.webSearchDisabledReason;
  return props.webSearchEnabled ? "关闭联网" : "开启联网";
}
</script>

<template>
  <PopupSelect
    :model-value="thinkingLevel"
    :options="options"
    accessible-label="选择思考等级"
    variant="compact"
    :menu-min-width="220"
    @update:model-value="handleThinking"
  >
    <template #prefix>
      <AppIcon name="brain" :size="14" />
      <AppIcon
        v-if="webSearchEnabled"
        class="composer-thinking-web-search-indicator"
        name="globe"
        :size="12"
      />
    </template>
    <template #footer>
      <button
        class="composer-web-search"
        :class="{ 'is-active': webSearchEnabled }"
        type="button"
        :disabled="responding || !webSearchAvailable"
        :title="webSearchTitle()"
        aria-label="联网"
        :aria-pressed="webSearchEnabled"
        @click.stop="emit('toggleWebSearch', !webSearchEnabled)"
      >
        <AppIcon name="globe" :size="14" />
        <span>联网</span>
      </button>
    </template>
  </PopupSelect>
</template>
