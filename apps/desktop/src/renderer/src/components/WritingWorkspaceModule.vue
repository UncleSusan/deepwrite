<script setup lang="ts">
import type {
  ThinkingLevel,
  UserPromptAttachment
} from "@deepwrite/contracts";
import type {
  AgentApprovalMode,
  EditorTextReference
} from "../types/conversation";
import AgentConversation from "./AgentConversation.vue";
import RightEditorPane from "./RightEditorPane.vue";

type AgentConversationPublicProps = InstanceType<
  typeof AgentConversation
>["$props"];
type RightEditorPanePublicProps = InstanceType<
  typeof RightEditorPane
>["$props"];

type WritingConversationViewModel = Readonly<
  Pick<
    AgentConversationPublicProps,
    | "messages"
    | "conversationHistory"
    | "currentSessionId"
    | "draft"
    | "responding"
    | "canSend"
    | "canSendAttachments"
    | "canStop"
    | "runtimeAvailable"
    | "models"
    | "selectedModelId"
    | "thinkingLevel"
    | "temperature"
    | "approvalMode"
    | "contextTitle"
    | "bookTitle"
    | "stageLabel"
    | "agentLabel"
    | "agentId"
    | "agentWorkspaceType"
    | "allowLiveEditReview"
    | "libraryDomain"
    | "librarySkills"
    | "welcomeShortcuts"
    | "availableSkills"
    | "availableMaterials"
    | "editorReferences"
    | "leftCollapsed"
    | "rightCollapsed"
  >
>;

type WritingEditorViewModel = Readonly<
  Pick<
    RightEditorPanePublicProps,
    | "document"
    | "resourceId"
    | "draftState"
    | "locateReference"
    | "locked"
    | "lockedLabel"
    | "saving"
    | "autoSaveEnabled"
    | "boundToCurrentBook"
    | "sectionTabs"
    | "activeSectionId"
    | "sectionTabsLabel"
    | "canCreateSection"
    | "createSectionLabel"
    | "showDeleteSection"
    | "canDeleteSection"
    | "deleteSectionLabel"
  >
>;

interface WritingWorkspaceModuleViewModel {
  conversation: WritingConversationViewModel;
  editor: WritingEditorViewModel;
  rightPane: Readonly<{
    collapsed: boolean;
    minWidth: number;
    maxWidth: number;
    width: number;
  }>;
}

defineProps<{
  viewModel: WritingWorkspaceModuleViewModel;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  clearEditorReferences: [];
  removeEditorReference: [referenceId: string];
  locateEditorReference: [reference: EditorTextReference];
  newConversation: [];
  selectConversation: [sessionId: string];
  send: [attachments: UserPromptAttachment[]];
  stop: [];
  suggestion: [value: string];
  toggleLeft: [];
  toggleRight: [];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  selectTemperature: [temperature: number];
  selectApproval: [mode: AgentApprovalMode];
  reviewEdit: [payload: {
    runId: string;
    proposalId: string;
    decision: "accept" | "reject";
  }];
  collapse: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
  insertSelection: [reference: EditorTextReference];
  selectSection: [sectionId: string];
  createSection: [];
  deleteSection: [];
  selectDraftFile: [fileKind: "body" | "character-state"];
  resizeStart: [event: PointerEvent];
  resizeKeydown: [event: KeyboardEvent];
}>();
</script>

<template>
  <AgentConversation
    v-bind="viewModel.conversation"
    @update:draft="emit('update:draft', $event)"
    @new-conversation="emit('newConversation')"
    @select-conversation="emit('selectConversation', $event)"
    @send="emit('send', $event)"
    @stop="emit('stop')"
    @suggestion="emit('suggestion', $event)"
    @toggle-left="emit('toggleLeft')"
    @toggle-right="emit('toggleRight')"
    @select-model="emit('selectModel', $event)"
    @select-thinking="emit('selectThinking', $event)"
    @select-temperature="emit('selectTemperature', $event)"
    @select-approval="emit('selectApproval', $event)"
    @review-edit="emit('reviewEdit', $event)"
    @clear-editor-references="emit('clearEditorReferences')"
    @remove-editor-reference="emit('removeEditorReference', $event)"
    @locate-editor-reference="emit('locateEditorReference', $event)"
  />

  <RightEditorPane
    v-if="!viewModel.rightPane.collapsed"
    v-bind="viewModel.editor"
    @collapse="emit('collapse')"
    @save="emit('save', $event)"
    @live-change="emit('liveChange', $event)"
    @insert-selection="emit('insertSelection', $event)"
    @select-section="emit('selectSection', $event)"
    @create-section="emit('createSection')"
    @delete-section="emit('deleteSection')"
    @select-draft-file="emit('selectDraftFile', $event)"
  />

  <div
    v-if="!viewModel.rightPane.collapsed"
    class="pane-resizer pane-resizer-right"
    role="separator"
    aria-label="调整右侧栏宽度"
    aria-orientation="vertical"
    :aria-valuemin="viewModel.rightPane.minWidth"
    :aria-valuemax="viewModel.rightPane.maxWidth"
    :aria-valuenow="viewModel.rightPane.width"
    tabindex="0"
    @pointerdown="emit('resizeStart', $event)"
    @keydown="emit('resizeKeydown', $event)"
  />
</template>
