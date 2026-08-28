<script setup lang="ts">
import { type Book } from "@deepwrite/contracts/renderer";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";
import WritingContextPanel from "./WritingContextPanel.vue";
import {
  usePlotStructureDialog,
  type PlotStructureDialogEmit
} from "./usePlotStructureDialog";

const props = withDefaults(
  defineProps<{
    open: boolean;
    book: Book | null;
    pending?: boolean;
    writingContext?: string | null;
    writingContextLoading?: boolean;
    writingContextPending?: boolean;
  }>(),
  {
    pending: false,
    writingContext: null,
    writingContextLoading: false,
    writingContextPending: false
  }
);

const emit = defineEmits<PlotStructureDialogEmit>();

const {
  activeStructureTab,
  activeSubdialog,
  characterOverview,
  characterTextPreview,
  close,
  closeButton,
  confirmCharacterFormat,
  confirmDelete,
  deletingHasContent,
  deletingStage,
  dialogElement,
  form,
  formMode,
  isBuiltinCreativePlotStageId,
  locked,
  move,
  openCreate,
  openDelete,
  openEdit,
  orderedCharacterItems,
  requestedCharacterFormat,
  rows,
  saveWritingContext,
  selectCharacterFormat,
  setActiveStructureTab,
  submitForm,
  toggleEnabled,
  writingContextPanel
} = usePlotStructureDialog(props, emit);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && book && !activeSubdialog"
      class="dialog-backdrop plot-structure-dialog-overlay"
      @mousedown.self="close"
    >
      <section
        ref="dialogElement"
        class="plot-structure-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plot-structure-title"
        tabindex="-1"
      >
        <header class="plot-structure-dialog-header">
          <div>
            <span>{{ book.bookType === "script" ? "剧本" : "短篇" }}设置</span>
            <strong id="plot-structure-title"
              >{{ book.title }} · 结构管理</strong
            >
          </div>
          <button
            ref="closeButton"
            type="button"
            aria-label="关闭结构管理"
            :disabled="locked"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <section class="plot-structure-manager" aria-label="结构管理">
          <div
            class="structure-main-tabs"
            role="tablist"
            aria-label="结构管理类型"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="activeStructureTab === 'character'"
              @click="setActiveStructureTab('character')"
            >
              人物结构管理
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeStructureTab === 'plot'"
              @click="setActiveStructureTab('plot')"
            >
              剧情结构管理
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeStructureTab === 'context'"
              @click="setActiveStructureTab('context')"
            >
              {{ book.bookType === "script" ? "剧本上下文" : "短篇上下文" }}
            </button>
          </div>

          <template v-if="activeStructureTab === 'character'">
            <header class="manager-header">
              <div>
                <p class="manager-eyebrow">CHARACTER STRUCTURE</p>
                <h2>人物结构管理</h2>
                <p>选择人物使用单篇连续文本，或使用概览与独立人物条目。</p>
              </div>
            </header>
            <div class="structure-panel-content character-structure-panel">
              <label class="form-field">
                <span>人物样式</span>
                <PopupSelect
                  :model-value="book.characterStructure.format"
                  :options="[
                    { value: 'list', label: '条目样式' },
                    { value: 'text', label: '文本样式' }
                  ]"
                  accessible-label="人物结构样式"
                  :disabled="locked"
                  :menu-z-index="2300"
                  @update:model-value="selectCharacterFormat"
                />
                <small v-if="book.characterStructure.format === 'list'">
                  人物在资源树中显示为概览与独立条目，可分别编辑和交给智能体管理。
                </small>
                <small v-else>
                  人物继续使用当前单一 Markdown 文本编辑方式。
                </small>
              </label>
            </div>
          </template>

          <template v-else-if="activeStructureTab === 'plot'">
            <header class="manager-header">
              <div>
                <p class="manager-eyebrow">CREATIVE PLOT STRUCTURE</p>
                <h2>剧情结构管理</h2>
                <p>
                  名称与说明全局生效；启用开关和排序按本书绑定。关闭后不在资源树显示，也不对智能体开放。默认五项不可删除。
                </p>
              </div>
            </header>

            <div class="structure-panel-content">
              <header class="manager-toolbar">
                <div
                  class="section-tabs"
                  role="tablist"
                  aria-label="基础结构类型"
                >
                  <button type="button" role="tab" aria-selected="true">
                    剧情结构
                  </button>
                </div>
                <button
                  class="primary-button"
                  type="button"
                  :disabled="locked || rows.length >= 32"
                  @click="openCreate"
                >
                  新建剧情结构
                </button>
              </header>

              <ol class="manager-list">
                <li
                  v-for="(stage, index) in rows"
                  :key="stage.id"
                  class="manager-row"
                  :class="{ 'is-disabled': !stage.enabled }"
                >
                  <label class="row-toggle">
                    <input
                      type="checkbox"
                      role="switch"
                      :checked="stage.enabled"
                      :disabled="locked"
                      :aria-label="`${stage.enabled ? '关闭' : '启用'}${stage.title}`"
                      @change="
                        toggleEnabled(
                          stage.id,
                          ($event.target as HTMLInputElement).checked
                        )
                      "
                    />
                    <span>{{ stage.enabled ? "启用" : "关闭" }}</span>
                  </label>
                  <div class="row-copy">
                    <strong>{{ stage.title }}</strong>
                    <span>{{ stage.description }}</span>
                    <code>
                      {{ stage.id }}
                      <template v-if="isBuiltinCreativePlotStageId(stage.id)">
                        · 默认
                      </template>
                    </code>
                  </div>
                  <div class="row-actions">
                    <button
                      type="button"
                      :aria-label="`上移${stage.title}`"
                      title="上移"
                      :disabled="locked || index === 0"
                      @click="move(stage.id, 'up')"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      :aria-label="`下移${stage.title}`"
                      title="下移"
                      :disabled="locked || index === rows.length - 1"
                      @click="move(stage.id, 'down')"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      :aria-label="`编辑${stage.title}`"
                      :disabled="locked"
                      @click="openEdit(stage.id)"
                    >
                      编辑
                    </button>
                    <button
                      class="delete-button"
                      type="button"
                      :aria-label="`删除${stage.title}`"
                      :disabled="
                        locked ||
                        rows.length <= 1 ||
                        isBuiltinCreativePlotStageId(stage.id)
                      "
                      @click="openDelete(stage.id)"
                    >
                      删除
                    </button>
                  </div>
                </li>
              </ol>

              <p class="manager-footnote">
                新建阶段会对全部短篇与剧本生效；启用状态仅绑定当前作品。改名全局同步，不会改变稳定
                ID 与文件路径。
              </p>
            </div>
          </template>

          <WritingContextPanel
            v-else
            :key="book.id"
            ref="writingContextPanel"
            :content="writingContext"
            :loading="writingContextLoading"
            :pending="writingContextPending"
            :workspace-type="book.bookType"
            @save="saveWritingContext"
          />
        </section>
      </section>
    </div>

    <div
      v-if="open && book && activeSubdialog === 'character-format'"
      class="dialog-backdrop structure-modal-overlay"
      @mousedown.self="requestedCharacterFormat = null"
      @keydown.esc.stop="requestedCharacterFormat = null"
    >
      <section
        class="structure-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="character-format-title"
      >
        <header class="modal-header">
          <div>
            <span>CONVERT</span>
            <h3 id="character-format-title">转换人物结构样式</h3>
          </div>
        </header>
        <fieldset class="modal-body" :disabled="locked">
          <p class="delete-copy">
            <template v-if="requestedCharacterFormat === 'list'">
              当前人物文本会完整迁移到一个“人物设定”条目，概览初始化为空。
            </template>
            <template v-else>
              概览与全部人物条目会按当前顺序合并为一个 Markdown
              文本；条目文件将在合并成功后移除。
            </template>
          </p>
          <div class="character-conversion-preview">
            <strong>转换预览</strong>
            <template v-if="requestedCharacterFormat === 'list'">
              <span>{{
                characterOverview?.content.trim()
                  ? "人物设定 · 1 个条目"
                  : "概览 · 空条目列表"
              }}</span>
              <pre>{{ characterTextPreview }}</pre>
            </template>
            <template v-else>
              <span>
                概览{{
                  characterOverview?.content.trim() ? "（有内容）" : "（为空）"
                }}，其后合并 {{ orderedCharacterItems.length }} 个人物条目
              </span>
              <ol v-if="orderedCharacterItems.length">
                <li v-for="item in orderedCharacterItems" :key="item.id">
                  {{ item.title }}
                </li>
              </ol>
              <span v-else>当前没有人物条目。</span>
            </template>
          </div>
        </fieldset>
        <footer class="modal-actions">
          <button
            type="button"
            :disabled="locked"
            @click="requestedCharacterFormat = null"
          >
            取消
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="locked"
            @click="confirmCharacterFormat"
          >
            {{ locked ? "转换中…" : "确认转换" }}
          </button>
        </footer>
      </section>
    </div>

    <div
      v-else-if="open && book && activeSubdialog === 'form'"
      class="dialog-backdrop structure-modal-overlay"
      @mousedown.self="close"
      @keydown.esc.stop="close"
    >
      <section
        class="structure-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="formMode === 'create' ? '新建剧情结构' : '编辑剧情结构'"
      >
        <form @submit.prevent="submitForm">
          <header class="modal-header">
            <div>
              <span>{{ formMode === "create" ? "CREATE" : "EDIT" }}</span>
              <h3>
                {{ formMode === "create" ? "新建剧情结构" : "编辑剧情结构" }}
              </h3>
            </div>
            <button
              class="close-button"
              type="button"
              aria-label="关闭"
              :disabled="locked"
              @click="close"
            >
              ×
            </button>
          </header>

          <fieldset class="modal-body" :disabled="locked">
            <label class="form-field">
              <span>名称</span>
              <input
                v-model="form.title"
                maxlength="120"
                autocomplete="off"
                autofocus
                required
              />
            </label>
            <label class="form-field">
              <span>结构说明</span>
              <textarea
                v-model="form.description"
                maxlength="20000"
                rows="7"
                required
              />
              <small
                >该说明会作为剧情智能体在此阶段的任务边界与交付标准。</small
              >
            </label>
            <p class="stable-id-note">
              稳定 ID 创建后不会因改名或排序而变化，Markdown
              文件路径和已有内容也会保持不变。
            </p>
          </fieldset>

          <footer class="modal-actions">
            <button type="button" :disabled="locked" @click="close">
              取消
            </button>
            <button class="primary-button" type="submit" :disabled="locked">
              {{
                locked ? "保存中…" : formMode === "create" ? "创建" : "保存修改"
              }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div
      v-else-if="open && book && activeSubdialog === 'delete' && deletingStage"
      class="dialog-backdrop structure-modal-overlay"
      @mousedown.self="close"
      @keydown.esc.stop="close"
    >
      <section
        class="structure-modal delete-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="plot-structure-delete-title"
        aria-describedby="plot-structure-delete-description"
      >
        <header class="modal-header">
          <div>
            <span>DELETE</span>
            <h3 id="plot-structure-delete-title">
              删除“{{ deletingStage.title }}”
            </h3>
          </div>
        </header>
        <fieldset class="modal-body" :disabled="locked">
          <p id="plot-structure-delete-description" class="delete-copy">
            该自定义阶段会对全部短篇与剧本生效。确认后将从全局删除，并永久清除各作品中对应的
            Markdown 内容。
            {{ deletingHasContent ? "当前作品该阶段已有内容。" : "" }}
          </p>
        </fieldset>
        <footer class="modal-actions">
          <button type="button" :disabled="locked" autofocus @click="close">
            取消
          </button>
          <button
            class="danger-button"
            type="button"
            :disabled="locked"
            @click="confirmDelete"
          >
            {{ locked ? "删除中…" : "确认全局删除" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./plot-structure-dialog.css"></style>
