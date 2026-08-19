<script setup lang="ts">
import { computed, ref } from "vue";
import { beatTypeLabels } from "../composables/useForeshadowingFilters";
import type { DeleteTarget } from "../composables/useForeshadowingMutations";

const props = defineProps<{
  target: DeleteTarget | null;
  mutationLocked: boolean;
  pending: boolean;
}>();

defineEmits<{
  close: [];
  confirm: [];
}>();

const deleteDialog = ref<HTMLElement | null>(null);
const deleteCancelButton = ref<HTMLButtonElement | null>(null);

const deleteTitle = computed(() => {
  const target = props.target;
  if (!target) return "确认删除";
  return target.kind === "thread"
    ? `删除伏笔线“${target.thread.title}”`
    : `删除“${target.thread.title}”的${beatTypeLabels[target.beat.type]}触点`;
});

defineExpose({ deleteDialog, deleteCancelButton });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="target"
      class="dialog-backdrop foreshadow-dialog-overlay"
      @mousedown.self="$emit('close')"
    >
      <section
        ref="deleteDialog"
        class="foreshadow-dialog delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="foreshadow-delete-title"
        aria-describedby="foreshadow-delete-description"
        tabindex="-1"
      >
        <header class="dialog-header">
          <div>
            <span>DELETE</span>
            <h3 id="foreshadow-delete-title">{{ deleteTitle }}</h3>
          </div>
        </header>
        <div class="dialog-body">
          <p id="foreshadow-delete-description" class="delete-copy">
            {{
              target.kind === "thread"
                ? "这会同时删除该伏笔线下全部尚未提交的触点，保存后无法从当前界面恢复。"
                : "这会删除该触点，其他卷和剧情点中的同一伏笔线不会被删除。"
            }}
          </p>
        </div>
        <footer class="dialog-actions">
          <button
            ref="deleteCancelButton"
            type="button"
            :disabled="mutationLocked"
            @click="$emit('close')"
          >
            取消
          </button>
          <button
            class="danger-button"
            type="button"
            :disabled="mutationLocked"
            @click="$emit('confirm')"
          >
            {{ pending ? "删除中…" : "确认删除" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
button {
  border: 0;
  font: inherit;
}
.foreshadow-dialog-overlay {
  z-index: 2400;
  overflow-y: auto;
  padding: 16px;
}
.foreshadow-dialog {
  width: min(620px, 94vw);
  overflow-y: auto;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
  box-shadow: 0 22px 70px
    color-mix(in srgb, var(--text-primary) 20%, transparent);
  color: var(--text-primary);
}
.delete-dialog {
  width: min(470px, 94vw);
}
.dialog-header,
.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
}
.dialog-header {
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}
.dialog-header span {
  color: var(--accent);
  font-size: 0.607143rem;
  font-weight: 720;
  letter-spacing: 0.1em;
}
.dialog-header h3 {
  margin: 0;
  font-size: 1rem;
}
.dialog-body {
  padding: 15px;
}
.delete-copy {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.65;
}
.dialog-actions {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}
.dialog-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 31px;
  padding: 6px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.danger-button {
  border-color: var(--danger) !important;
  background: var(--danger) !important;
  color: #ffffff !important;
  font-weight: 620;
}
</style>
