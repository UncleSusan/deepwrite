<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import LongStructureManager from "./LongStructureManager.vue";

const props = defineProps<{
  open: boolean;
  bookTitle: string;
  snapshot: LongWorkspaceIndexSnapshot | null;
  pending?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  proposal: [batch: LongWorkspaceOperationBatch];
}>();

function close(): void {
  if (!props.pending) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") close();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() =>
  document.removeEventListener("keydown", handleKeydown)
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="long-structure-dialog-overlay"
      @mousedown.self="close"
    >
      <section
        class="long-structure-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="长篇结构管理"
      >
        <header class="long-structure-dialog-header">
          <div>
            <span>长篇结构管理</span>
            <strong>{{ bookTitle }}</strong>
          </div>
          <button
            type="button"
            aria-label="关闭长篇结构管理"
            :disabled="pending"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <LongStructureManager
          v-if="snapshot"
          :snapshot="snapshot"
          :disabled="pending"
          @proposal="emit('proposal', $event)"
        />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.long-structure-dialog-overlay {
  position: fixed;
  z-index: 2200;
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(12px, 3vw, 32px);
  background: color-mix(in srgb, var(--surface-main) 58%, transparent);
  backdrop-filter: blur(8px);
}

.long-structure-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1040px, 96vw);
  max-height: min(880px, 92vh);
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 16px;
  background: var(--surface-raised);
  box-shadow: 0 22px 70px
    color-mix(in srgb, var(--text-primary) 18%, transparent);
  color: var(--text-primary);
}

.long-structure-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.long-structure-dialog-header > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.long-structure-dialog-header span {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.long-structure-dialog-header strong {
  overflow: hidden;
  font-size: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-structure-dialog-header button {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-structure-dialog-header button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-structure-dialog :deep(.long-structure-manager) {
  min-height: 0;
  overflow: auto;
}

@media (max-height: 680px), (max-width: 760px) {
  .long-structure-dialog-overlay {
    padding: 8px;
  }

  .long-structure-dialog {
    width: 100%;
    max-height: calc(100vh - 16px);
    border-radius: 12px;
  }
}
</style>
