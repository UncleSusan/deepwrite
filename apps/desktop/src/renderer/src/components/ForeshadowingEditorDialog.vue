<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { LongForeshadowingBeatType } from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "./PopupSelect.vue";
import {
  beatTypeLabels,
  beatTypeOptions,
  editableLifecycleOptions,
  spanLabels,
  spanOptions,
  type ForeshadowingThread,
  type PlannedSpan
} from "../composables/useForeshadowingFilters";
import type {
  BeatDraft,
  FormKind,
  FormMode,
  ThreadDraft
} from "../composables/useForeshadowingMutations";

const props = defineProps<{
  open: boolean;
  formKind: FormKind;
  formMode: FormMode;
  threadDraft: ThreadDraft;
  beatDraft: BeatDraft;
  threads: readonly ForeshadowingThread[];
  volumeOptions: readonly PopupSelectOption[];
  arcOptions: readonly PopupSelectOption[];
  editingThread: ForeshadowingThread | null;
  editingCommittedThread: boolean;
  mutationLocked: boolean;
  pending: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const formDialog = ref<HTMLElement | null>(null);
const firstFormInput = ref<HTMLInputElement | null>(null);

const formTitle = computed(() => {
  const action = props.formMode === "create" ? "新建" : "编辑";
  return `${action}${props.formKind === "thread" ? "伏笔线" : "伏笔触点"}`;
});

const threadOptions = computed<PopupSelectOption[]>(() =>
  props.threads.map((thread) => ({
    value: thread.id,
    label: thread.title
  }))
);

function setThreadSpan(value: PopupSelectValue): void {
  if (Object.prototype.hasOwnProperty.call(spanLabels, value)) {
    props.threadDraft.plannedSpan = value as PlannedSpan;
  }
}

function setThreadStatus(value: PopupSelectValue): void {
  if (value === "planned" || value === "abandoned") {
    props.threadDraft.status = value;
  }
}

function setBeatThread(value: PopupSelectValue): void {
  if (typeof value === "string") props.beatDraft.threadId = value;
}

function setBeatType(value: PopupSelectValue): void {
  if (Object.prototype.hasOwnProperty.call(beatTypeLabels, value)) {
    props.beatDraft.type = value as LongForeshadowingBeatType;
  }
}

function setBeatVolume(value: PopupSelectValue): void {
  if (typeof value !== "string") return;
  props.beatDraft.volumeId = value;
  if (value) props.beatDraft.arcId = "";
}

function setBeatArc(value: PopupSelectValue): void {
  if (typeof value !== "string") return;
  props.beatDraft.arcId = value;
  if (value) props.beatDraft.volumeId = "";
}

function focusOpenedForm(): void {
  void nextTick(() => {
    const firstEnabledControl = formDialog.value?.querySelector<HTMLElement>(
      "fieldset input:not(:disabled), fieldset textarea:not(:disabled), fieldset button:not(:disabled)"
    );
    (firstEnabledControl ?? formDialog.value)?.focus({
      preventScroll: true
    });
  });
}

defineExpose({ formDialog, firstFormInput, focusOpenedForm });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop foreshadow-dialog-overlay"
      @mousedown.self="emit('close')"
    >
      <section
        ref="formDialog"
        class="foreshadow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="foreshadow-form-title"
        tabindex="-1"
      >
        <form @submit.prevent="emit('submit')">
          <header class="dialog-header">
            <div>
              <span>{{ formMode === "create" ? "CREATE" : "EDIT" }}</span>
              <h3 id="foreshadow-form-title">{{ formTitle }}</h3>
            </div>
            <button
              type="button"
              aria-label="关闭伏笔编辑弹窗"
              :disabled="mutationLocked"
              @click="emit('close')"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>

          <fieldset class="dialog-body" :disabled="mutationLocked">
            <template v-if="formKind === 'thread'">
              <p v-if="editingCommittedThread" class="committed-backfill-note">
                已提交触点仍锁定原有核心信息；这里只能补填旧项目中此前不存在的隐藏真相或计划跨度。
              </p>
              <label class="form-field">
                <span>伏笔线名称</span>
                <input
                  ref="firstFormInput"
                  v-model="threadDraft.title"
                  :disabled="editingCommittedThread"
                  maxlength="256"
                  autocomplete="off"
                  placeholder="例如：师父与旧城火灾的关系"
                  required
                />
              </label>
              <div
                class="form-grid"
                :class="{ 'is-single': formMode === 'create' }"
              >
                <label class="form-field">
                  <span>计划跨度</span>
                  <PopupSelect
                    :model-value="threadDraft.plannedSpan"
                    :options="spanOptions"
                    :disabled="
                      editingCommittedThread &&
                      editingThread?.plannedSpan !== undefined
                    "
                    accessible-label="选择伏笔计划跨度"
                    :menu-z-index="2600"
                    @update:model-value="setThreadSpan"
                  />
                </label>
                <label v-if="formMode === 'edit'" class="form-field">
                  <span>生命周期</span>
                  <PopupSelect
                    :model-value="threadDraft.status"
                    :options="editableLifecycleOptions"
                    accessible-label="选择伏笔生命周期"
                    :menu-z-index="2600"
                    @update:model-value="setThreadStatus"
                  />
                </label>
              </div>
              <label class="form-field">
                <span>核心问题</span>
                <textarea
                  v-model="threadDraft.coreQuestion"
                  :disabled="editingCommittedThread"
                  rows="3"
                  maxlength="200000"
                  placeholder="读者会持续追问什么？"
                />
              </label>
              <label class="form-field">
                <span>隐藏真相</span>
                <textarea
                  v-model="threadDraft.hiddenTruth"
                  :disabled="
                    editingCommittedThread &&
                    editingThread?.hiddenTruth !== undefined
                  "
                  rows="4"
                  maxlength="200000"
                  placeholder="作者掌握、但暂时不直接告诉读者的答案"
                />
              </label>
              <label class="form-field">
                <span>预期读者效果</span>
                <textarea
                  v-model="threadDraft.expectedReaderEffect"
                  :disabled="editingCommittedThread"
                  rows="3"
                  maxlength="200000"
                  placeholder="希望读者产生怎样的怀疑、误判或恍然大悟"
                />
              </label>
            </template>

            <template v-else>
              <label class="form-field">
                <span>所属伏笔线</span>
                <PopupSelect
                  :model-value="beatDraft.threadId"
                  :options="threadOptions"
                  accessible-label="选择触点所属伏笔线"
                  :menu-z-index="2600"
                  @update:model-value="setBeatThread"
                />
              </label>
              <label class="form-field">
                <span>触点作用</span>
                <PopupSelect
                  :model-value="beatDraft.type"
                  :options="beatTypeOptions"
                  accessible-label="选择伏笔触点作用"
                  :menu-z-index="2600"
                  @update:model-value="setBeatType"
                />
              </label>
              <div class="form-grid">
                <label class="form-field">
                  <span>分卷待落点</span>
                  <PopupSelect
                    :model-value="beatDraft.volumeId"
                    :options="volumeOptions"
                    accessible-label="选择触点所属分卷"
                    :menu-z-index="2600"
                    @update:model-value="setBeatVolume"
                  />
                  <small>选择剧情点后，这里会自动清空。</small>
                </label>
                <label class="form-field">
                  <span>剧情点</span>
                  <PopupSelect
                    :model-value="beatDraft.arcId"
                    :options="arcOptions"
                    accessible-label="选择触点所属剧情点"
                    :menu-z-index="2600"
                    @update:model-value="setBeatArc"
                  />
                  <small>精确到剧情点时只保存剧情点锚点。</small>
                </label>
              </div>
              <label class="form-field">
                <span>计划范围</span>
                <input
                  v-model="beatDraft.plannedScope"
                  maxlength="1000"
                  autocomplete="off"
                  placeholder="尚未确定具体落点时，可填写阶段或范围"
                />
              </label>
              <label class="form-field">
                <span>呈现说明</span>
                <textarea
                  v-model="beatDraft.note"
                  rows="4"
                  maxlength="4000"
                  placeholder="读者实际看到什么，以及希望形成什么判断"
                />
              </label>
            </template>
          </fieldset>

          <footer class="dialog-actions">
            <button
              type="button"
              :disabled="mutationLocked"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              class="primary-button"
              type="submit"
              :disabled="mutationLocked"
            >
              {{
                pending
                  ? "保存中…"
                  : formMode === "create"
                    ? "创建"
                    : "保存修改"
              }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
button,
input,
textarea {
  font: inherit;
}
button {
  border: 0;
}
.foreshadow-dialog-overlay {
  z-index: 2400;
  overflow-y: auto;
  padding: 16px;
}
.foreshadow-dialog {
  width: min(620px, 94vw);
  max-height: min(820px, 92vh);
  overflow-y: auto;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
  box-shadow: 0 22px 70px
    color-mix(in srgb, var(--text-primary) 20%, transparent);
  color: var(--text-primary);
}
.foreshadow-dialog form {
  display: grid;
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
.dialog-header > div {
  display: grid;
  min-width: 0;
  gap: 2px;
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
.dialog-header > button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.dialog-body {
  display: grid;
  min-inline-size: 0;
  gap: 12px;
  margin: 0;
  padding: 15px;
  border: 0;
}
.committed-backfill-note {
  margin: 0;
  padding: 9px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.55;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.form-grid.is-single {
  grid-template-columns: minmax(0, 1fr);
}
.form-field {
  display: grid;
  min-width: 0;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}
.form-field input,
.form-field textarea {
  width: 100%;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font-weight: 400;
  line-height: 1.5;
}
.form-field textarea {
  resize: vertical;
}
.form-field input:focus,
.form-field textarea:focus {
  border-color: color-mix(in srgb, var(--accent) 58%, var(--theme-line));
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.form-field small {
  color: var(--text-tertiary);
  font-size: 0.642857rem;
  font-weight: 400;
}
.dialog-actions {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}
.dialog-actions button,
.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 31px;
  gap: 5px;
  padding: 6px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
}
.primary-button {
  border-color: var(--neutral-solid);
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  font-weight: 620;
}
button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.primary-button:hover:not(:disabled) {
  background: var(--neutral-solid);
  color: var(--accent-contrast, #ffffff);
  filter: brightness(1.08);
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
@media (max-width: 560px), (max-height: 680px) {
  .foreshadow-dialog-overlay {
    padding: 8px;
  }
  .foreshadow-dialog {
    max-height: calc(100vh - 16px);
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
