<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { AgentWelcomeContent } from "../data/agentWelcome";
import type { ChatMessage } from "../types/conversation";
import { writeToolText } from "../utils/agentWriteToolPreview";
import {
  approvalItemsForMessage as listApprovalItemsForMessage,
  formatToolPayload,
  hasProcessing,
  hasProcessingDisclosure,
  isWriteTool,
  processingDisplayItems as listProcessingDisplayItems,
  processingLabel as describeProcessingLabel,
  toolDetail,
  toolGroupIsRunning,
  toolGroupLabel,
  toolIcon,
  toolLabel,
  visibleResponse,
  visibleToolArguments,
  writeToolContentLabel,
  writeToolTarget
} from "./conversationToolPresentation";
import AppIcon from "./AppIcon.vue";
import AgentEditProposalCard from "./AgentEditProposalCard.vue";
import LongProposalReview from "./LongProposalReview.vue";
import StreamedContent from "./StreamedContent.vue";
import SubagentRunList from "./SubagentRunList.vue";
import { uiMessage } from "../ui-feedback";
import { formatFileSize } from "../composables/useConversationAttachments";

const props = defineProps<{
  messages: ChatMessage[];
  responding: boolean;
  runtimeAvailable: boolean;
  clock: number;
  allowLiveEditReview: boolean;
  longProposalItems: LongWorkspaceProposalItem[];
  longWorkspaceIndex: LongWorkspaceIndexSnapshot | null;
  welcomeContent: AgentWelcomeContent;
  handleConversationWheel: (event: WheelEvent) => void;
  handleConversationScroll: () => void;
  setScroller: (el: unknown) => void;
  setMessageList: (el: unknown) => void;
}>();

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
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [eventId: string];
}>();

function processingDisplayItems(
  message: ChatMessage,
  includeApprovalCards = false
) {
  return listProcessingDisplayItems(
    message,
    includeApprovalCards,
    props.longProposalItems
  );
}

function approvalItemsForMessage(message: ChatMessage) {
  return listApprovalItemsForMessage(message, props.longProposalItems);
}

function processingLabel(message: ChatMessage) {
  return describeProcessingLabel(message, props.clock);
}

const hasStreamingAssistant = computed(() =>
  props.messages.some(
    (message) => message.role === "assistant" && message.status === "streaming"
  )
);
const copiedMessageId = ref<string | null>(null);
let copiedTimer: number | undefined;

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}
async function copyMessage(message: ChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.content);
    copiedMessageId.value = message.id;
    if (copiedTimer !== undefined) globalThis.clearTimeout(copiedTimer);
    copiedTimer = globalThis.setTimeout(() => {
      copiedMessageId.value = null;
    }, 1_500);
    uiMessage.success(
      message.role === "assistant" ? "已复制回复" : "已复制消息"
    );
  } catch {
    uiMessage.error("复制失败，请稍后重试。");
  }
}
function copyMessageLabel(message: ChatMessage): string {
  if (copiedMessageId.value === message.id) return "已复制";
  return message.role === "assistant" ? "复制回复" : "复制消息";
}
onBeforeUnmount(() => {
  if (copiedTimer !== undefined) globalThis.clearTimeout(copiedTimer);
});
</script>

<template>
  <section
    :ref="setScroller"
    class="conversation-scroll transient-scrollbar"
    aria-live="polite"
    @wheel.passive="handleConversationWheel"
    @scroll.passive="handleConversationScroll"
  >
    <div v-if="messages.length === 0" class="conversation-empty">
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

    <div v-else :ref="setMessageList" class="message-list">
      <article
        v-for="message in messages"
        :key="message.id"
        :data-conversation-message-id="message.id"
        class="message"
        :class="[
          `is-${message.role}`,
          {
            'is-empty-error':
              message.role === 'assistant' &&
              message.status === 'error' &&
              !message.content &&
              !hasProcessing(message) &&
              !message.subagentRuns?.length &&
              !message.editProposals?.length
          }
        ]"
      >
        <div class="message-body">
          <div
            v-if="
              message.role === 'assistant' &&
              (hasProcessing(message) ||
                message.retry ||
                message.processingStartedAt) &&
              message.status === 'streaming'
            "
            class="processing-live-list"
            aria-label="运行过程"
          >
            <div class="processing-live-status" aria-live="off">
              {{ processingLabel(message) }}
            </div>
            <template
              v-for="item in processingDisplayItems(message, true)"
              :key="item.id"
            >
              <details
                v-if="item.type === 'thinking'"
                class="processing-live-item processing-live-thinking"
              >
                <summary>
                  <span>思考中</span>
                  <AppIcon name="chevron" :size="13" />
                </summary>
                <div class="processing-live-body processing-thinking">
                  <StreamedContent :content="item.content" streaming />
                </div>
              </details>
              <div
                v-else-if="item.type === 'response'"
                class="processing-step processing-response"
              >
                <StreamedContent :content="item.content" streaming />
              </div>
              <details
                v-else-if="item.type === 'tool'"
                class="processing-live-item processing-live-tool"
              >
                <summary>
                  <div
                    class="tool-trace"
                    :class="[
                      `is-${item.tool.status}`,
                      { 'is-write': isWriteTool(item.tool) }
                    ]"
                  >
                    <AppIcon
                      v-if="!isWriteTool(item.tool)"
                      :name="toolIcon(item.tool)"
                      :size="17"
                    />
                    <div>
                      <div
                        v-if="isWriteTool(item.tool)"
                        class="write-tool-label"
                      >
                        <strong>{{ toolLabel(item.tool) }}</strong>
                        <AppIcon name="chevron" :size="13" />
                      </div>
                      <strong v-else>{{ toolLabel(item.tool) }}</strong>
                      <span v-if="toolDetail(item.tool)">{{
                        toolDetail(item.tool)
                      }}</span>
                    </div>
                  </div>
                  <AppIcon
                    v-if="!isWriteTool(item.tool)"
                    name="chevron"
                    :size="13"
                  />
                </summary>
                <div class="processing-live-body tool-detail">
                  <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
                    <div class="write-tool-output-heading">
                      <span>{{ writeToolContentLabel(item.tool) }}</span>
                      <small v-if="writeToolTarget(item.tool)">{{
                        writeToolTarget(item.tool)
                      }}</small>
                      <small
                        >{{
                          writeToolText(item.tool).length.toLocaleString(
                            "zh-CN"
                          )
                        }}
                        字符</small
                      >
                    </div>
                    <pre
                      class="write-tool-output"
                      :class="{
                        'is-streaming': item.tool.status === 'preparing'
                      }"
                      >{{
                        writeToolText(item.tool) || "正在等待写入内容……"
                      }}</pre>
                  </div>
                  <div
                    v-else-if="
                      formatToolPayload(visibleToolArguments(item.tool))
                    "
                  >
                    <span>调用参数</span>
                    <pre>{{
                      formatToolPayload(visibleToolArguments(item.tool))
                    }}</pre>
                  </div>
                  <div v-if="item.tool.resultSummary">
                    <span>执行结果</span>
                    <p>{{ item.tool.resultSummary }}</p>
                  </div>
                </div>
              </details>
              <AgentEditProposalCard
                v-else-if="item.type === 'edit-proposal'"
                class="approval-timeline-card"
                :proposal="item.proposal"
                :message-status="message.status"
                :allow-live-edit-review="allowLiveEditReview"
                @review="emit('reviewEdit', $event)"
                @locate="emit('locateEditProposal', $event)"
              />
              <LongProposalReview
                v-else-if="item.type === 'long-proposal'"
                class="approval-timeline-card"
                embedded
                conversation-card
                :items="[item.item]"
                :workspace-index="longWorkspaceIndex"
                @approve="emit('approveLongProposal', $event)"
                @reject="emit('rejectLongProposal', $event)"
                @retry-preview="emit('retryLongProposalPreview', $event)"
                @locate="emit('locateLongProposal', $event)"
              />
              <details
                v-else-if="item.type === 'tool-group'"
                class="processing-live-item processing-live-thinking processing-tool-group"
                :aria-busy="toolGroupIsRunning(item.tools)"
              >
                <summary>
                  <span>{{ toolGroupLabel(item.tools) }}</span>
                  <AppIcon name="chevron" :size="13" />
                </summary>
                <div
                  class="processing-live-body tool-call-list"
                  aria-label="工具调用列表"
                >
                  <details
                    v-for="tool in item.tools"
                    :key="tool.id"
                    class="processing-live-item processing-live-tool tool-call-list-item"
                  >
                    <summary>
                      <div class="tool-trace" :class="`is-${tool.status}`">
                        <AppIcon :name="toolIcon(tool)" :size="17" />
                        <div>
                          <strong>{{ toolLabel(tool) }}</strong>
                          <span v-if="toolDetail(tool)">{{
                            toolDetail(tool)
                          }}</span>
                        </div>
                      </div>
                      <AppIcon name="chevron" :size="13" />
                    </summary>
                    <div class="processing-live-body tool-detail">
                      <div v-if="formatToolPayload(visibleToolArguments(tool))">
                        <span>调用参数</span>
                        <pre>{{
                          formatToolPayload(visibleToolArguments(tool))
                        }}</pre>
                      </div>
                      <div v-if="tool.resultSummary">
                        <span>执行结果</span>
                        <p>{{ tool.resultSummary }}</p>
                      </div>
                    </div>
                  </details>
                </div>
              </details>
            </template>
          </div>
          <details
            v-else-if="
              message.role === 'assistant' && hasProcessingDisclosure(message)
            "
            class="processing-block"
          >
            <summary>
              <span>{{ processingLabel(message) }}</span>
              <AppIcon name="chevron" :size="13" />
            </summary>
            <div class="processing-content">
              <template
                v-for="item in processingDisplayItems(message)"
                :key="item.id"
              >
                <details
                  v-if="item.type === 'thinking'"
                  class="processing-live-item processing-live-thinking"
                >
                  <summary>
                    <span>思考过程</span>
                    <AppIcon name="chevron" :size="13" />
                  </summary>
                  <div class="processing-live-body processing-thinking">
                    <StreamedContent :content="item.content" />
                  </div>
                </details>
                <div
                  v-else-if="item.type === 'response'"
                  class="processing-step processing-response"
                >
                  <StreamedContent :content="item.content" />
                </div>
                <details
                  v-else-if="item.type === 'tool'"
                  class="processing-live-item processing-live-tool"
                >
                  <summary>
                    <div
                      class="tool-trace"
                      :class="[
                        `is-${item.tool.status}`,
                        { 'is-write': isWriteTool(item.tool) }
                      ]"
                    >
                      <AppIcon
                        v-if="!isWriteTool(item.tool)"
                        :name="toolIcon(item.tool)"
                        :size="17"
                      />
                      <div>
                        <div
                          v-if="isWriteTool(item.tool)"
                          class="write-tool-label"
                        >
                          <strong>{{ toolLabel(item.tool) }}</strong>
                          <AppIcon name="chevron" :size="13" />
                        </div>
                        <strong v-else>{{ toolLabel(item.tool) }}</strong>
                        <span v-if="toolDetail(item.tool)">{{
                          toolDetail(item.tool)
                        }}</span>
                      </div>
                    </div>
                    <AppIcon
                      v-if="!isWriteTool(item.tool)"
                      name="chevron"
                      :size="13"
                    />
                  </summary>
                  <div class="processing-live-body tool-detail">
                    <div
                      v-if="isWriteTool(item.tool)"
                      class="write-tool-detail"
                    >
                      <div class="write-tool-output-heading">
                        <span>{{ writeToolContentLabel(item.tool) }}</span>
                        <small v-if="writeToolTarget(item.tool)">{{
                          writeToolTarget(item.tool)
                        }}</small>
                        <small
                          >{{
                            writeToolText(item.tool).length.toLocaleString(
                              "zh-CN"
                            )
                          }}
                          字符</small
                        >
                      </div>
                      <pre class="write-tool-output">{{
                        writeToolText(item.tool) || "没有写入内容"
                      }}</pre>
                    </div>
                    <div
                      v-else-if="
                        formatToolPayload(visibleToolArguments(item.tool))
                      "
                    >
                      <span>调用参数</span>
                      <pre>{{
                        formatToolPayload(visibleToolArguments(item.tool))
                      }}</pre>
                    </div>
                    <div v-if="item.tool.resultSummary">
                      <span>执行结果</span>
                      <p>{{ item.tool.resultSummary }}</p>
                    </div>
                  </div>
                </details>
                <details
                  v-else-if="item.type === 'tool-group'"
                  class="processing-live-item processing-live-thinking processing-tool-group"
                >
                  <summary>
                    <span>{{ toolGroupLabel(item.tools) }}</span>
                    <AppIcon name="chevron" :size="13" />
                  </summary>
                  <div
                    class="processing-live-body tool-call-list"
                    aria-label="工具调用列表"
                  >
                    <details
                      v-for="tool in item.tools"
                      :key="tool.id"
                      class="processing-live-item processing-live-tool tool-call-list-item"
                    >
                      <summary>
                        <div class="tool-trace" :class="`is-${tool.status}`">
                          <AppIcon :name="toolIcon(tool)" :size="17" />
                          <div>
                            <strong>{{ toolLabel(tool) }}</strong>
                            <span v-if="toolDetail(tool)">{{
                              toolDetail(tool)
                            }}</span>
                          </div>
                        </div>
                        <AppIcon name="chevron" :size="13" />
                      </summary>
                      <div class="processing-live-body tool-detail">
                        <div
                          v-if="formatToolPayload(visibleToolArguments(tool))"
                        >
                          <span>调用参数</span>
                          <pre>{{
                            formatToolPayload(visibleToolArguments(tool))
                          }}</pre>
                        </div>
                        <div v-if="tool.resultSummary">
                          <span>执行结果</span>
                          <p>{{ tool.resultSummary }}</p>
                        </div>
                      </div>
                    </details>
                  </div>
                </details>
              </template>
              <SubagentRunList
                v-if="
                  message.subagentRuns?.length && message.status !== 'streaming'
                "
                :message="message"
                :now="clock"
              />
            </div>
          </details>

          <SubagentRunList
            v-if="
              message.role === 'assistant' &&
              message.subagentRuns?.length &&
              message.status === 'streaming'
            "
            :message="message"
            :now="clock"
          />
          <div class="message-content">
            <div
              v-if="message.role === 'user'"
              class="message-copy user-message-copy"
            >
              <div
                v-if="message.attachments?.length"
                class="message-attachment-list"
                aria-label="本条消息的附件"
              >
                <span
                  v-for="attachment in message.attachments"
                  :key="attachment.id"
                  class="message-attachment-chip"
                  :title="`${attachment.name} · ${formatFileSize(attachment.size)}`"
                >
                  <AppIcon
                    :name="attachment.kind === 'image' ? 'image' : 'file'"
                    :size="14"
                  />
                  <span>{{ attachment.name }}</span>
                  <small v-if="attachment.truncated">已截断</small>
                </span>
              </div>
              {{ message.content }}
            </div>
            <div
              v-else-if="visibleResponse(message)"
              class="message-copy"
              :class="{ 'is-streaming': message.status === 'streaming' }"
            >
              <StreamedContent
                :content="visibleResponse(message)"
                :streaming="message.status === 'streaming'"
              />
            </div>
            <div
              v-if="message.status === 'stopped'"
              class="message-stopped-copy"
            >
              已停止生成
            </div>
            <section
              v-if="
                message.role === 'assistant' &&
                message.status !== 'streaming' &&
                approvalItemsForMessage(message).length
              "
              class="approval-card-stack"
              aria-label="本轮审批卡片"
            >
              <template
                v-for="approval in approvalItemsForMessage(message)"
                :key="approval.id"
              >
                <AgentEditProposalCard
                  v-if="approval.type === 'edit-proposal'"
                  :proposal="approval.proposal"
                  :message-status="message.status"
                  :allow-live-edit-review="allowLiveEditReview"
                  @review="emit('reviewEdit', $event)"
                  @locate="emit('locateEditProposal', $event)"
                />
                <LongProposalReview
                  v-else
                  embedded
                  conversation-card
                  :items="[approval.item]"
                  :workspace-index="longWorkspaceIndex"
                  @approve="emit('approveLongProposal', $event)"
                  @reject="emit('rejectLongProposal', $event)"
                  @retry-preview="emit('retryLongProposalPreview', $event)"
                  @locate="emit('locateLongProposal', $event)"
                />
              </template>
            </section>
          </div>
          <div
            v-if="message.content && message.status !== 'streaming'"
            class="message-actions"
          >
            <span v-if="message.role === 'user'">{{
              formatTime(message.createdAt)
            }}</span>
            <button
              type="button"
              :aria-label="copyMessageLabel(message)"
              @click="copyMessage(message)"
            >
              <AppIcon
                :name="copiedMessageId === message.id ? 'check' : 'copy'"
                :size="15"
              />
            </button>
            <span v-if="message.role === 'assistant'">{{
              formatTime(message.createdAt)
            }}</span>
          </div>
        </div>
      </article>

      <article
        v-if="responding && !hasStreamingAssistant"
        class="message is-assistant is-thinking"
      >
        <div class="thinking-row">
          <span>正在思考</span>
        </div>
      </article>
    </div>
  </section>
</template>
