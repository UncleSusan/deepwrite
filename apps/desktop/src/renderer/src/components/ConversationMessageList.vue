<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { AgentWelcomeContent } from "../data/agentWelcome";
import type {
  ChatMessage,
  ConversationMessageRewriteRequest
} from "../types/conversation";
import AppIcon from "./AppIcon.vue";
import ConversationMessageItem from "./ConversationMessageItem.vue";

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    responding: boolean;
    runtimeAvailable: boolean;
    clock: number;
    conversationSessionId?: string;
    allowLiveEditReview?: boolean;
    canRewriteHistory?: boolean;
    submitEditedMessage?:
      | ((request: ConversationMessageRewriteRequest) => Promise<boolean>)
      | undefined;
    longProposalItems?: readonly LongWorkspaceProposalItem[];
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
    welcomeContent?: AgentWelcomeContent;
    handleConversationWheel?: (event: WheelEvent) => void;
    handleConversationScroll?: () => void;
    setScroller?: (el: unknown) => void;
    setMessageList?: (el: unknown) => void;
  }>(),
  {
    allowLiveEditReview: false,
    canRewriteHistory: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null,
    handleConversationWheel: () => undefined,
    handleConversationScroll: () => undefined,
    setScroller: () => undefined,
    setMessageList: () => undefined
  }
);

const emit = defineEmits<{
  suggestion: [value: string];
  reviewEdit: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locateEditProposal: [payload: { runId: string; proposalId: string }];
  discardEditProposal: [payload: { runId: string; proposalId: string }];
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [eventId: string];
}>();

const hasStreamingAssistant = computed(() =>
  props.messages.some(
    (message) => message.role === "assistant" && message.status === "streaming"
  )
);
const editingMessageId = ref<string | null>(null);
const editingMessageFingerprint = ref<string | null>(null);

function messageFingerprint(message: ChatMessage): string {
  return [
    message.id,
    message.createdAt,
    message.content,
    message.attachments?.map((attachment) => attachment.id).join(",") ?? ""
  ].join("\u0000");
}

function clearEditingMessage(): void {
  editingMessageId.value = null;
  editingMessageFingerprint.value = null;
}

function messageIsEditable(message: ChatMessage): boolean {
  return Boolean(
    props.canRewriteHistory &&
    props.submitEditedMessage &&
    message.role === "user" &&
    message.status !== "streaming" &&
    !message.attachments?.length
  );
}

function requestEdit(messageId: string): void {
  const message = props.messages.find(
    (candidate) => candidate.id === messageId
  );
  if (!message || !messageIsEditable(message)) return;
  editingMessageId.value = messageId;
  editingMessageFingerprint.value = messageFingerprint(message);
}

function cancelEdit(messageId: string): void {
  if (editingMessageId.value === messageId) clearEditingMessage();
}

watch(
  () => [
    props.conversationSessionId,
    props.responding,
    props.messages.map(messageFingerprint).join("\u0001")
  ],
  () => {
    const message = props.messages.find(
      (candidate) => candidate.id === editingMessageId.value
    );
    if (
      !message ||
      props.responding ||
      messageFingerprint(message) !== editingMessageFingerprint.value ||
      message.role !== "user" ||
      message.status === "streaming" ||
      message.attachments?.length
    ) {
      clearEditingMessage();
    }
  },
  { flush: "sync" }
);
</script>

<template>
  <section
    :ref="setScroller"
    class="conversation-scroll transient-scrollbar"
    aria-live="polite"
    @wheel.passive="handleConversationWheel"
    @scroll.passive="handleConversationScroll"
  >
    <slot v-if="messages.length === 0" name="empty">
      <div v-if="welcomeContent" class="conversation-empty">
        <span class="empty-agent-mark"><AppIcon name="logo" :size="40" /></span>
        <h1>{{ welcomeContent.title }}</h1>
        <p>{{ welcomeContent.description }}</p>
        <div class="empty-suggestions">
          <button
            v-for="item in welcomeContent.questions"
            :key="item"
            type="button"
            :disabled="!runtimeAvailable"
            @click="emit('suggestion', item)"
          >
            {{ item }}
          </button>
        </div>
      </div>
    </slot>

    <div v-else :ref="setMessageList" class="message-list">
      <ConversationMessageItem
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :clock="clock"
        :editable="messageIsEditable(message)"
        :editing="editingMessageId === message.id"
        :submit-edited-message="submitEditedMessage"
        :allow-live-edit-review="allowLiveEditReview"
        :long-proposal-items="longProposalItems"
        :long-workspace-index="longWorkspaceIndex"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @discard-edit-proposal="emit('discardEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
        @request-edit="requestEdit"
        @cancel-edit="cancelEdit"
      />

      <article
        v-if="responding && !hasStreamingAssistant"
        class="message is-assistant is-thinking"
      >
        <div class="thinking-row"><span>正在思考</span></div>
      </article>
    </div>
  </section>
</template>
