<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../../types/conversation";
import AppIcon from "../../components/AppIcon.vue";
import { chatAssistantProcessingTraceItems } from "./chatAssistantProcessingTrace";

const props = defineProps<{ message: ChatMessage }>();

const traceItems = computed(() =>
  chatAssistantProcessingTraceItems(props.message)
);
</script>

<template>
  <div
    v-if="traceItems.length"
    class="assistant-processing"
    aria-label="思考和工具调用时间线"
  >
    <template v-for="item in traceItems" :key="item.id">
      <details
        v-if="item.type === 'thinking'"
        class="assistant-thinking"
        :open="message.status === 'streaming'"
      >
        <summary>
          <AppIcon name="sparkles" :size="14" />
          <span>{{
            message.status === "streaming" ? "正在思考" : "思考过程"
          }}</span>
        </summary>
        <p>{{ item.content }}</p>
      </details>
      <div v-else class="assistant-tool" :data-status="item.tool.status">
        <span class="assistant-tool-icon"
          ><AppIcon name="terminal" :size="14"
        /></span>
        <span>
          <strong>{{ item.tool.name }}</strong>
          <small>{{
            item.tool.status === "error"
              ? "执行失败"
              : item.tool.status === "completed"
                ? "执行完成"
                : "执行中"
          }}</small>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.assistant-processing {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
}
.assistant-thinking {
  color: var(--text-secondary);
  font-size: 0.9em;
}
.assistant-thinking summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
}
.assistant-thinking summary::-webkit-details-marker {
  display: none;
}
.assistant-thinking p {
  margin: 8px 0 0;
  padding-left: 20px;
  white-space: pre-wrap;
  line-height: 1.65;
  color: var(--text-tertiary);
}
.assistant-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
}
.assistant-tool-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--surface-raised);
}
.assistant-tool span:last-child {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.assistant-tool strong {
  color: var(--text-primary);
  font-size: 0.86em;
  font-weight: 600;
}
.assistant-tool small {
  color: var(--text-tertiary);
  font-size: 0.78em;
}
.assistant-tool[data-status="error"] {
  border-color: color-mix(in srgb, #d14b4b 35%, var(--theme-line-soft));
}
</style>
