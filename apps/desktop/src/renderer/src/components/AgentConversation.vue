<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type BuiltInReasoningLevel,
  type LibraryAgentDomain,
  type LibraryAgentSkill,
  type LongAgentId,
  type LongWorkspaceIndexSnapshot,
  type ModelConfig,
  type WorkspaceAgentId,
  type ThinkingLevel,
  type UserPromptAttachment
} from "@deepwrite/contracts";
import { resolveAgentWelcome } from "../data/agentWelcome";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { useConversationScrollFollow } from "../composables/useConversationScrollFollow";
import type {
  AgentApprovalMode,
  ChatMessage,
  ComposerReferenceOption,
  ConversationHistoryItem,
  EditorTextReference
} from "../types/conversation";
import type { IconName } from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import ConversationComposer from "./ConversationComposer.vue";
import ConversationMessageList from "./ConversationMessageList.vue";

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    conversationHistory: ConversationHistoryItem[];
    currentSessionId: string;
    draft: string;
    responding: boolean;
    canSend: boolean;
    canSendAttachments: boolean;
    canStop: boolean;
    runtimeAvailable: boolean;
    models: ModelConfig[];
    selectedModelId: string;
    thinkingLevel: ThinkingLevel;
    temperature: number;
    approvalMode: AgentApprovalMode;
    contextTitle: string;
    bookTitle: string;
    stageLabel: string;
    agentLabel: string;
    agentId: WorkspaceAgentId | LongAgentId | undefined;
    agentWorkspaceType?: "short" | "script" | "long";
    allowLiveEditReview?: boolean;
    libraryDomain: LibraryAgentDomain | undefined;
    librarySkills: readonly Pick<LibraryAgentSkill, "name">[] | undefined;
    welcomeShortcuts: readonly [string, string, string] | undefined;
    availableSkills: ComposerReferenceOption[];
    availableMaterials: ComposerReferenceOption[];
    editorReferences: EditorTextReference[];
    longProposalItems?: LongWorkspaceProposalItem[];
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    rightPane?: boolean;
  }>(),
  {
    allowLiveEditReview: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null,
    rightPane: false
  }
);

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
  locateEditProposal: [payload: { runId: string; proposalId: string }];
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [eventId: string];
}>();

const messageList = ref<HTMLElement>();
const conversationNavigatorList = ref<HTMLElement>();
const clock = ref(Date.now());
const hasLiveProcessing = computed(
  () =>
    props.responding ||
    props.messages.some(
      (message) =>
        message.status === "streaming" ||
        message.subagentRuns?.some((run) => run.status === "running")
    )
);
const historyOpen = ref(false);
let clockTimer: number | undefined;
let conversationNavigatorFrame: number | undefined;
let conversationNavigatorResizeObserver: ResizeObserver | undefined;

const {
  scroller,
  followsConversationTail,
  tailFollowLockedForResponse,
  setLastConversationScrollTop,
  lockConversationTailForCurrentResponse,
  handleConversationWheel,
  handleConversationScroll,
  scheduleConversationTailFollow,
  resetScrollForSession
} = useConversationScrollFollow({
  messages: () => props.messages,
  responding: () => props.responding,
  onScroll: () => scheduleActiveConversationTurnUpdate()
});

function setScroller(el: unknown): void {
  scroller.value = el instanceof HTMLElement ? el : undefined;
}
function setMessageList(el: unknown): void {
  messageList.value = el instanceof HTMLElement ? el : undefined;
}

function compactConversationTurn(message: ChatMessage): string {
  const compact = message.content
    .slice(0, 1_200)
    .replace(/```[\s\S]*?```/g, " 代码片段 ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " 图片 ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (compact) {
    return compact.length > 56 ? `${compact.slice(0, 56)}…` : compact;
  }
  const attachmentNames = message.attachments
    ?.map((attachment) => attachment.name)
    .filter(Boolean)
    .join("、");
  return attachmentNames ? `附件：${attachmentNames}` : "无文字消息";
}

const conversationTurns = computed(() => {
  let turnNumber = 0;
  return props.messages.flatMap((message) => {
    if (message.role !== "user") return [];
    turnNumber += 1;
    return [{ id: message.id, number: turnNumber, text: compactConversationTurn(message) }];
  });
});
const activeConversationTurnId = ref<string | null>(null);

function conversationMessageElement(messageId: string): HTMLElement | undefined {
  const list = messageList.value;
  if (!list) return undefined;
  return Array.from(
    list.querySelectorAll<HTMLElement>(":scope > .message[data-conversation-message-id]")
  ).find((element) => element.dataset.conversationMessageId === messageId);
}

function keepActiveConversationCardVisible(): void {
  const list = conversationNavigatorList.value;
  const activeId = activeConversationTurnId.value;
  if (!list || !activeId) return;
  const activeCard = Array.from(
    list.querySelectorAll<HTMLElement>("[data-conversation-turn-id]")
  ).find((element) => element.dataset.conversationTurnId === activeId);
  if (!activeCard) return;
  const listRect = list.getBoundingClientRect();
  const cardRect = activeCard.getBoundingClientRect();
  if (cardRect.top < listRect.top) {
    list.scrollTop -= listRect.top - cardRect.top + 6;
  } else if (cardRect.bottom > listRect.bottom) {
    list.scrollTop += cardRect.bottom - listRect.bottom + 6;
  }
}

function updateActiveConversationTurn(): void {
  const container = scroller.value;
  if (!container || !conversationTurns.value.length) {
    activeConversationTurnId.value = null;
    return;
  }
  const focusLine = container.getBoundingClientRect().top + container.clientHeight * 0.34;
  let activeId = conversationTurns.value[0]!.id;
  for (const turn of conversationTurns.value) {
    const messageElement = conversationMessageElement(turn.id);
    if (!messageElement || messageElement.getBoundingClientRect().top > focusLine) break;
    activeId = turn.id;
  }
  if (activeConversationTurnId.value !== activeId) {
    activeConversationTurnId.value = activeId;
    void nextTick(keepActiveConversationCardVisible);
  }
}

function scheduleActiveConversationTurnUpdate(): void {
  if (conversationNavigatorFrame !== undefined) return;
  conversationNavigatorFrame = globalThis.requestAnimationFrame(() => {
    conversationNavigatorFrame = undefined;
    updateActiveConversationTurn();
  });
}

function scrollToConversationTurn(messageId: string): void {
  const container = scroller.value;
  const messageElement = conversationMessageElement(messageId);
  if (!container || !messageElement) return;
  lockConversationTailForCurrentResponse();
  followsConversationTail.value = false;
  activeConversationTurnId.value = messageId;
  keepActiveConversationCardVisible();
  const targetTop =
    container.scrollTop +
    messageElement.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    22;
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  container.scrollTo({
    top: Math.max(0, targetTop),
    behavior: reduceMotion ? "auto" : "smooth"
  });
}

watch(
  () => {
    const message = props.messages.at(-1);
    return [
      props.messages.length,
      props.responding,
      message?.id,
      message?.content.length,
      message?.thinking?.length,
      message?.retry
        ? `${message.retry.state}:${message.retry.attempt}:${message.retry.retryAt ?? ""}`
        : "",
      message?.toolCalls
        ?.map((toolCall) => `${toolCall.status}:${toolCall.argumentsText?.length ?? 0}`)
        .join(","),
      message?.subagentRuns
        ?.map((run) =>
          [
            run.subagentRunId,
            run.status,
            run.thinking?.length ?? 0,
            run.output?.length ?? 0,
            run.toolCalls
              .map((toolCall) => `${toolCall.id}:${toolCall.status}`)
              .join(";")
          ].join(":")
        )
        .join(","),
      message?.editProposals
        ?.map((proposal) => `${proposal.id}:${proposal.status}:${proposal.updatedAt}`)
        .join(","),
      props.longProposalItems
        .map((item) =>
          `${item.event.id}:${item.status}:${item.previewProjectRevision ?? ""}:${item.error ?? ""}`
        )
        .join(",")
    ].join("|");
  },
  async () => {
    if (!followsConversationTail.value) {
      return;
    }
    await nextTick();
    scheduleConversationTailFollow();
  }
);

onMounted(async () => {
  await nextTick();
  setLastConversationScrollTop(scroller.value?.scrollTop ?? 0);
  scheduleConversationTailFollow();
  updateActiveConversationTurn();
  conversationNavigatorResizeObserver = new ResizeObserver(scheduleActiveConversationTurnUpdate);
  if (scroller.value) conversationNavigatorResizeObserver.observe(scroller.value);
  if (messageList.value) conversationNavigatorResizeObserver.observe(messageList.value);
});

watch(
  () => props.responding,
  (responding, wasResponding) => {
    if (!responding || wasResponding) return;
    tailFollowLockedForResponse.value = false;
    followsConversationTail.value = true;
    void nextTick(() => {
      scheduleConversationTailFollow();
    });
  }
);

watch(
  () => {
    const message = [...props.messages]
      .reverse()
      .find((candidate) => candidate.role === "assistant");
    return message ? `${message.id}:${message.status ?? "completed"}` : "";
  },
  async (next, previous) => {
    if (
      !tailFollowLockedForResponse.value ||
      !previous.endsWith(":streaming") ||
      next.endsWith(":streaming")
    ) {
      return;
    }
    const element = scroller.value;
    if (!element) return;
    const preservedScrollTop = element.scrollTop;
    await nextTick();
    if (!tailFollowLockedForResponse.value || !scroller.value) return;
    scroller.value.scrollTop = preservedScrollTop;
    setLastConversationScrollTop(preservedScrollTop);
  },
  { flush: "pre" }
);

watch(
  () => hasLiveProcessing.value,
  (live) => {
    if (clockTimer !== undefined) {
      globalThis.clearInterval(clockTimer);
      clockTimer = undefined;
    }
    clock.value = Date.now();
    if (live) {
      clockTimer = globalThis.setInterval(() => {
        clock.value = Date.now();
      }, 1_000);
    }
  },
  { immediate: true }
);

watch(
  () => props.currentSessionId,
  () => {
    historyOpen.value = false;
    resetScrollForSession();
    void nextTick(() => {
      updateActiveConversationTurn();
    });
  }
);

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    if (messageList.value) {
      conversationNavigatorResizeObserver?.observe(messageList.value);
    }
    updateActiveConversationTurn();
  }
);

onBeforeUnmount(() => {
  if (clockTimer !== undefined) globalThis.clearInterval(clockTimer);
  if (conversationNavigatorFrame !== undefined) {
    globalThis.cancelAnimationFrame(conversationNavigatorFrame);
  }
  conversationNavigatorResizeObserver?.disconnect();
});

const welcomeContent = computed(() =>
  resolveAgentWelcome(
    props.agentId,
    props.libraryDomain,
    props.librarySkills,
    props.welcomeShortcuts,
    props.agentWorkspaceType
  )
);
const selectedModel = computed(() =>
  props.models.find((model) => model.id === props.selectedModelId)
);
const builtInThinkingLabels: Record<BuiltInReasoningLevel, string> = {
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};
const fallbackThinkingOptions: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "关闭" },
  ...BUILT_IN_REASONING_LEVELS.map((value) => ({
    value,
    label: builtInThinkingLabels[value]
  }))
];

function thinkingLabel(level: ThinkingLevel): string {
  if (level === "off") return "关闭";
  return BUILT_IN_REASONING_LEVELS.includes(level as BuiltInReasoningLevel)
    ? builtInThinkingLabels[level as BuiltInReasoningLevel]
    : `自定义（${level}）`;
}

const availableThinkingOptions = computed(() =>
  selectedModel.value
    ? [
        { value: "off" as const, label: thinkingLabel("off") },
        ...selectedModel.value.thinkingLevelOptions.map((value) => ({
          value,
          label: thinkingLabel(value)
        }))
      ]
    : fallbackThinkingOptions
);
const modelOptions = computed(() =>
  props.models.map((model) => ({ value: model.id, label: model.label }))
);
const showsTemperature = computed(
  () => Boolean(selectedModel.value) && props.thinkingLevel === "off"
);
const temperatureOptions = computed(() => selectedModel.value?.temperatureOptions ?? []);
const temperatureSelectOptions = computed(() =>
  temperatureOptions.value.map((value) => ({ value, label: `温度 ${value}` }))
);
const approvalOptions = [
  {
    value: "request-approval" as const,
    label: "请求批准",
    description: "修改或写入正文前均需你的批准"
  },
  {
    value: "auto-approve" as const,
    label: "替我审批",
    description: "自动批准修改并写入正文"
  }
];
const approvalModeIcon = computed<IconName>(() =>
  props.approvalMode === "request-approval" ? "user" : "check"
);

function formatHistoryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function selectHistoryConversation(item: ConversationHistoryItem): void {
  historyOpen.value = false;
  if (item.sessionId !== props.currentSessionId) {
    emit("selectConversation", item.sessionId);
  }
}

</script>

<template>
  <main class="conversation-pane" aria-label="智能体对话">
    <header class="conversation-header">
      <div class="conversation-heading-start">
        <button
          v-if="leftCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开左侧栏"
          @click="emit('toggleLeft')"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <div>
          <strong>{{ agentLabel }}</strong>
          <span class="context-caption">主上下文：{{ contextTitle }}</span>
        </div>
      </div>
      <div class="conversation-header-actions">
        <div class="conversation-history-control" @keydown.esc.stop="historyOpen = false">
          <button
            class="header-text-button"
            :class="{ 'is-active': historyOpen }"
            type="button"
            aria-haspopup="dialog"
            :aria-expanded="historyOpen"
            aria-controls="conversation-history-panel"
            @click="historyOpen = !historyOpen"
          >
            <AppIcon name="history" :size="16" />
            历史对话
          </button>
          <div
            v-if="historyOpen"
            class="conversation-history-dismiss"
            aria-hidden="true"
            @mousedown="historyOpen = false"
          />
          <section
            v-if="historyOpen"
            id="conversation-history-panel"
            class="conversation-history-panel"
            role="dialog"
            aria-label="历史对话"
          >
            <header>
              <div>
                <strong>历史对话</strong>
                <span>当前智能体的最近记录</span>
              </div>
              <button type="button" aria-label="关闭历史对话" @click="historyOpen = false">
                <AppIcon name="close" :size="15" />
              </button>
            </header>
            <div v-if="conversationHistory.length" class="conversation-history-list">
              <button
                v-for="item in conversationHistory"
                :key="item.sessionId"
                class="conversation-history-item"
                :class="{ 'is-current': item.current }"
                type="button"
                :disabled="responding && !item.current"
                @click="selectHistoryConversation(item)"
              >
                <span class="conversation-history-icon">
                  <AppIcon :name="item.current ? 'check' : 'message'" :size="15" />
                </span>
                <span class="conversation-history-copy">
                  <span class="conversation-history-title-row">
                    <strong>{{ item.title }}</strong>
                    <time :datetime="item.updatedAt">{{ formatHistoryTime(item.updatedAt) }}</time>
                  </span>
                  <small>{{ item.preview || '暂无回复内容' }}</small>
                  <span class="conversation-history-meta">
                    {{ item.current ? '当前对话' : `${item.turnCount} 轮 · ${item.messageCount} 条消息` }}
                  </span>
                </span>
              </button>
            </div>
            <div v-else class="conversation-history-empty">
              <AppIcon name="history" :size="22" />
              <strong>还没有历史对话</strong>
              <span>发送消息后，对话会自动保存在这里。</span>
            </div>
            <p class="conversation-history-running-note">
              {{ responding ? "当前回复完成或停止后，可切换到其他对话。" : "选择历史记录即可切换对话。" }}
            </p>
          </section>
        </div>
        <button class="header-text-button" type="button" @click="emit('newConversation')">
          <AppIcon name="plus" :size="16" />
          新建对话
        </button>
        <button
          v-if="rightCollapsed && !rightPane"
          class="icon-button"
          type="button"
          aria-label="展开文本内容栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
        <button
          v-if="rightPane"
          class="icon-button"
          type="button"
          aria-label="收起智能体栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <div class="conversation-scroll-shell">
      <ConversationMessageList
        :messages="messages"
        :responding="responding"
        :runtime-available="runtimeAvailable"
        :clock="clock"
        :allow-live-edit-review="allowLiveEditReview"
        :long-proposal-items="longProposalItems"
        :long-workspace-index="longWorkspaceIndex"
        :welcome-content="welcomeContent"
        :handle-conversation-wheel="handleConversationWheel"
        :handle-conversation-scroll="handleConversationScroll"
        :set-scroller="setScroller"
        :set-message-list="setMessageList"
        @suggestion="emit('suggestion', $event)"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
      />

      <nav
        v-if="conversationTurns.length"
        class="conversation-turn-navigator"
        aria-label="当前对话轮次"
      >
        <button
          class="conversation-turn-navigator-toggle"
          type="button"
          aria-label="展开对话定位"
          title="悬停查看对话定位"
        >
          <span class="conversation-turn-indicators" aria-hidden="true">
            <i
              v-for="turn in conversationTurns"
              :key="turn.id"
              :class="{ 'is-active': activeConversationTurnId === turn.id }"
            />
          </span>
        </button>
        <div class="conversation-turn-navigator-panel">
          <div
            ref="conversationNavigatorList"
            class="conversation-turn-navigator-list"
          >
            <button
              v-for="turn in conversationTurns"
              :key="turn.id"
              type="button"
              class="conversation-turn-card"
              :class="{ 'is-active': activeConversationTurnId === turn.id }"
              :data-conversation-turn-id="turn.id"
              :aria-current="
                activeConversationTurnId === turn.id ? 'location' : undefined
              "
              :title="`第 ${turn.number} 轮：${turn.text}`"
              @click="scrollToConversationTurn(turn.id)"
            >
              <span class="conversation-turn-card-number">
                {{ String(turn.number).padStart(2, '0') }}
              </span>
              <span class="conversation-turn-card-copy">{{ turn.text }}</span>
            </button>
          </div>
        </div>
      </nav>
    </div>

    <ConversationComposer
      :draft="draft"
      :responding="responding"
      :can-send="canSend"
      :can-send-attachments="canSendAttachments"
      :can-stop="canStop"
      :runtime-available="runtimeAvailable"
      :current-session-id="currentSessionId"
      :messages-empty="messages.length === 0"
      :book-title="bookTitle"
      :stage-label="stageLabel"
      :selected-model-id="selectedModelId"
      :thinking-level="thinkingLevel"
      :temperature="temperature"
      :approval-mode="approvalMode"
      :library-domain="libraryDomain"
      :available-skills="availableSkills"
      :available-materials="availableMaterials"
      :editor-references="editorReferences"
      :model-options="modelOptions"
      :available-thinking-options="availableThinkingOptions"
      :shows-temperature="showsTemperature"
      :temperature-select-options="temperatureSelectOptions"
      :approval-options="approvalOptions"
      :approval-mode-icon="approvalModeIcon"
      @update:draft="emit('update:draft', $event)"
      @send="emit('send', $event)"
      @stop="emit('stop')"
      @clear-editor-references="emit('clearEditorReferences')"
      @remove-editor-reference="emit('removeEditorReference', $event)"
      @locate-editor-reference="emit('locateEditorReference', $event)"
      @select-model="emit('selectModel', $event)"
      @select-thinking="emit('selectThinking', $event)"
      @select-temperature="emit('selectTemperature', $event)"
      @select-approval="emit('selectApproval', $event)"
    />
  </main>
</template>
