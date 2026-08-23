<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type AgentUserInputAnswer,
  type AgentUserInputRequestedPayload,
  PROMPT_ATTACHMENT_MAX_ITEMS,
  PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES,
  PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH,
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
import type {
  AgentApprovalMode,
  ChatMessage,
  ComposerReferenceOption,
  ConversationHistoryItem,
  EditorTextReference
} from "../types/conversation";
import type { IconName } from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import {
  PROMPT_ATTACHMENT_ACCEPT,
  promptAttachmentFilesFromClipboard,
  readPromptAttachment
} from "../utils/promptAttachments";
import {
  findComposerReferenceMatch,
  insertComposerReference,
  type ComposerReferenceMatch
} from "../utils/composerReferences";
import { createEditorReferenceAttachment } from "../utils/editorTextReferences";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { useConversationTurnNavigator } from "../composables/useConversationTurnNavigator";
import AppIcon from "./AppIcon.vue";
import AgentActivityFloatPanel from "./AgentActivityFloatPanel.vue";
import AgentUserInputCard from "./AgentUserInputCard.vue";
import ConversationMessageList from "./ConversationMessageList.vue";
import ConversationTurnNavigator from "./ConversationTurnNavigator.vue";
import PopupSelect from "./PopupSelect.vue";
import { AGENT_ACTIVITY_CONTEXT_KEY } from "../composables/agentActivityContext";

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
    userInputRequest?: AgentUserInputRequestedPayload | null;
    userInputSubmitting?: boolean;
  }>(),
  {
    allowLiveEditReview: false,
    longProposalItems: () => [],
    longWorkspaceIndex: null,
    rightPane: false,
    userInputRequest: null,
    userInputSubmitting: false
  }
);

const conversationScrollbar = createTransientScrollbarController();
const agentActivity = inject(AGENT_ACTIVITY_CONTEXT_KEY, null);
const agentActivityItems = computed(() => agentActivity?.items.value ?? []);
const agentActivityCollapsed = computed(
  () => agentActivity?.collapsed.value ?? false
);

function selectAgentActivity(conversationKey: string): void {
  void agentActivity?.selectActivity(conversationKey);
}

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
  submitUserInput: [answers: AgentUserInputAnswer[]];
}>();

const scroller = ref<HTMLElement>();
const messageList = ref<HTMLElement>();

function setConversationScroller(element: unknown): void {
  scroller.value = element instanceof HTMLElement ? element : undefined;
}

function setConversationMessageList(element: unknown): void {
  messageList.value = element instanceof HTMLElement ? element : undefined;
}
const composerInput = ref<HTMLTextAreaElement>();
const attachmentInput = ref<HTMLInputElement>();
const pendingAttachments = ref<UserPromptAttachment[]>([]);
const readingAttachments = ref(false);
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
const activeReference = ref<ComposerReferenceMatch | null>(null);
const activeReferenceIndex = ref(0);
let clockTimer: number | undefined;
let scrollFrame: number | undefined;
let attachmentReadEpoch = 0;
const followsConversationTail = ref(true);
const tailFollowLockedForResponse = ref(false);
let lastConversationScrollTop = 0;

const TAIL_FOLLOW_THRESHOLD = 72;

function isNearConversationTail(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    TAIL_FOLLOW_THRESHOLD
  );
}

function hasActiveConversationResponse(): boolean {
  return (
    props.responding ||
    props.messages.some(
      (message) =>
        message.role === "assistant" && message.status === "streaming"
    )
  );
}

function lockConversationTailForCurrentResponse(): void {
  if (!hasActiveConversationResponse()) return;
  tailFollowLockedForResponse.value = true;
  followsConversationTail.value = false;
  if (scrollFrame !== undefined) {
    globalThis.cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  }
}

const {
  activeTurnId: activeConversationTurnId,
  scheduleActiveTurnUpdate: scheduleActiveConversationTurnUpdate,
  scrollToTurn: scrollToConversationTurn,
  turns: conversationTurns
} = useConversationTurnNavigator({
  messages: () => props.messages,
  currentSessionId: () => props.currentSessionId,
  scroller,
  messageList,
  beforeNavigate: () => {
    lockConversationTailForCurrentResponse();
    followsConversationTail.value = false;
  }
});

function handleConversationWheel(event: WheelEvent): void {
  if (event.deltaY < 0) lockConversationTailForCurrentResponse();
}

function handleConversationScroll(): void {
  const element = scroller.value;
  if (!element) return;
  conversationScrollbar.reveal(element);
  const nextScrollTop = element.scrollTop;
  if (
    hasActiveConversationResponse() &&
    nextScrollTop < lastConversationScrollTop - 1
  ) {
    lockConversationTailForCurrentResponse();
  }
  if (hasActiveConversationResponse()) {
    followsConversationTail.value = !tailFollowLockedForResponse.value;
  } else {
    followsConversationTail.value = isNearConversationTail(element);
  }
  lastConversationScrollTop = nextScrollTop;
  scheduleActiveConversationTurnUpdate();
}

function scheduleConversationTailFollow(): void {
  if (!followsConversationTail.value || scrollFrame !== undefined) {
    return;
  }
  scrollFrame = globalThis.requestAnimationFrame(() => {
    scrollFrame = undefined;
    const element = scroller.value;
    if (element && followsConversationTail.value) {
      const tailScrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight
      );
      if (Math.abs(element.scrollTop - tailScrollTop) > 1) {
        element.scrollTop = tailScrollTop;
        lastConversationScrollTop = tailScrollTop;
      }
    }
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
        ?.map(
          (toolCall) =>
            `${toolCall.status}:${toolCall.argumentsText?.length ?? 0}`
        )
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
        ?.map(
          (proposal) =>
            `${proposal.id}:${proposal.status}:${proposal.updatedAt}`
        )
        .join(","),
      props.longProposalItems
        .map(
          (item) =>
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
  lastConversationScrollTop = scroller.value?.scrollTop ?? 0;
  scheduleConversationTailFollow();
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
    lastConversationScrollTop = preservedScrollTop;
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
    attachmentReadEpoch += 1;
    readingAttachments.value = false;
    pendingAttachments.value = [];
    tailFollowLockedForResponse.value = false;
    followsConversationTail.value = true;
    void nextTick(() => {
      lastConversationScrollTop = scroller.value?.scrollTop ?? 0;
      scheduleConversationTailFollow();
    });
  }
);

const canSubmit = computed(
  () =>
    !readingAttachments.value &&
    (props.canSend ||
      (props.canSendAttachments &&
        (pendingAttachments.value.length > 0 ||
          props.editorReferences.length > 0)))
);

watch(
  () => props.editorReferences.map((reference) => reference.id).join("\u0000"),
  (ids) => {
    if (!ids) return;
    void nextTick(() => composerInput.value?.focus());
  }
);

function openAttachmentPicker(): void {
  attachmentInput.value?.click();
}

function attachmentKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function pendingAttachmentKey(attachment: UserPromptAttachment): string {
  return `${attachment.name}\u0000${attachment.size}`;
}

function validateAttachmentCapacity(
  attachment: UserPromptAttachment
): string | undefined {
  if (pendingAttachments.value.length >= PROMPT_ATTACHMENT_MAX_ITEMS) {
    return `每条消息最多上传 ${PROMPT_ATTACHMENT_MAX_ITEMS} 个附件。`;
  }
  if (attachment.kind === "text") {
    const textLength = pendingAttachments.value.reduce(
      (total, item) => total + (item.kind === "text" ? item.content.length : 0),
      attachment.content.length
    );
    if (textLength > PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH) {
      return `文本附件合计最多携带 ${PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH.toLocaleString("zh-CN")} 个字符。`;
    }
  } else {
    const imageBytes = pendingAttachments.value.reduce(
      (total, item) => total + (item.kind === "image" ? item.size : 0),
      attachment.size
    );
    if (imageBytes > PROMPT_IMAGE_ATTACHMENTS_MAX_BYTES) {
      return "图片附件合计不能超过 25 MB。";
    }
  }
  return undefined;
}

async function addAttachmentFiles(files: File[]): Promise<void> {
  if (!files.length || readingAttachments.value) return;
  const readEpoch = ++attachmentReadEpoch;
  readingAttachments.value = true;
  const failures: string[] = [];
  let added = 0;
  try {
    const existing = new Set(
      pendingAttachments.value.map(pendingAttachmentKey)
    );
    const seenFiles = new Set<string>();
    for (const file of files) {
      const fileKey = attachmentKey(file);
      const duplicateKey = `${file.name}\u0000${file.size}`;
      if (seenFiles.has(fileKey) || existing.has(duplicateKey)) continue;
      seenFiles.add(fileKey);
      try {
        const result = await readPromptAttachment(file);
        if (readEpoch !== attachmentReadEpoch) return;
        const capacityError = validateAttachmentCapacity(result.attachment);
        if (capacityError) {
          failures.push(capacityError);
          continue;
        }
        pendingAttachments.value.push(result.attachment);
        existing.add(duplicateKey);
        added += 1;
        if (result.warning) uiMessage.warning(result.warning);
      } catch (error: unknown) {
        failures.push(
          error instanceof Error ? error.message : `读取“${file.name}”失败。`
        );
      }
    }
  } finally {
    if (readEpoch === attachmentReadEpoch) {
      readingAttachments.value = false;
    }
  }
  if (readEpoch !== attachmentReadEpoch) return;
  if (failures.length) {
    uiMessage.error(
      failures.length === 1
        ? failures[0]!
        : `${failures[0]}（另有 ${failures.length - 1} 个附件未添加）`
    );
  } else if (added > 0) {
    uiMessage.success(`已添加 ${added} 个附件`);
  }
}

function handleAttachmentChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  void addAttachmentFiles(files);
}

function handleComposerPaste(event: ClipboardEvent): void {
  const files = promptAttachmentFilesFromClipboard(event.clipboardData);
  if (!files.length) return;

  event.preventDefault();
  closeReferenceMenu();
  if (readingAttachments.value) {
    uiMessage.warning("正在读取附件，请稍后再粘贴。");
    return;
  }
  void addAttachmentFiles(files);
}

function removePendingAttachment(id: string): void {
  pendingAttachments.value = pendingAttachments.value.filter(
    (attachment) => attachment.id !== id
  );
}

function formatFileSize(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentPreview(
  attachment: UserPromptAttachment
): string | undefined {
  return attachment.kind === "image"
    ? `data:${attachment.mediaType};base64,${attachment.data}`
    : undefined;
}

function editorReferenceTooltip(reference: EditorTextReference): string {
  const preview =
    reference.text.length > 1_000
      ? `${reference.text.slice(0, 1_000)}…`
      : reference.text;
  return `${reference.documentPath.join(" / ")}\n第 ${reference.startLine}-${reference.endLine} 行\n\n${preview}`;
}

function submitMessage(): void {
  if (!canSubmit.value) return;
  const attachments = pendingAttachments.value.map((attachment) => ({
    ...attachment
  }));
  attachments.push(
    ...props.editorReferences.map(createEditorReferenceAttachment)
  );
  if (attachments.length > PROMPT_ATTACHMENT_MAX_ITEMS) {
    uiMessage.warning(
      `每条消息最多携带 ${PROMPT_ATTACHMENT_MAX_ITEMS} 项附件或正文引用。`
    );
    return;
  }
  const textLength = attachments.reduce(
    (total, attachment) =>
      total + (attachment.kind === "text" ? attachment.content.length : 0),
    0
  );
  if (textLength > PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH) {
    uiMessage.warning(
      `文本附件与正文引用合计最多携带 ${PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH.toLocaleString("zh-CN")} 个字符。`
    );
    return;
  }
  pendingAttachments.value = [];
  emit("send", attachments);
  if (props.editorReferences.length) emit("clearEditorReferences");
}

onBeforeUnmount(() => {
  attachmentReadEpoch += 1;
  if (clockTimer !== undefined) {
    globalThis.clearInterval(clockTimer);
  }
  if (scrollFrame !== undefined) {
    globalThis.cancelAnimationFrame(scrollFrame);
  }
  conversationScrollbar.dispose();
});

const referenceOptions = computed(() =>
  activeReference.value?.trigger === "/"
    ? props.availableSkills
    : activeReference.value?.trigger === "@"
      ? props.availableMaterials
      : []
);
const filteredReferenceOptions = computed(() => {
  const query =
    activeReference.value?.query.trim().toLocaleLowerCase("zh-CN") ?? "";
  const matches = query
    ? referenceOptions.value.filter((option) =>
        `${option.label} ${option.detail}`
          .toLocaleLowerCase("zh-CN")
          .includes(query)
      )
    : referenceOptions.value;
  return matches.slice(0, 12);
});
const referenceMenuTitle = computed(() => {
  if (activeReference.value?.trigger === "/") {
    return "调用技能";
  }
  if (props.libraryDomain === "skill") {
    return "引用技能";
  }
  return "引用素材";
});
const referenceMenuHint = computed(() => {
  if (activeReference.value?.trigger === "/") {
    return "输入名称搜索技能";
  }
  if (props.libraryDomain === "skill") {
    return "输入名称搜索技能条目";
  }
  return "输入名称搜索素材条目";
});
const composerPlaceholder = computed(() => {
  if (!props.runtimeAvailable) {
    return "浏览器预览不可发送，请启动桌面客户端";
  }
  if (props.libraryDomain === "skill") {
    return "描述资料库任务，输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的技能……";
  }
  if (props.libraryDomain === "material") {
    return "描述资料库任务，输入 / 加载方法技能，输入 @ 引用当前库或同分组其它库的素材……";
  }
  return "随心输入，输入 / 调用技能，输入 @ 引用素材……";
});

watch(
  () =>
    filteredReferenceOptions.value.map((option) => option.id).join("\u0000"),
  () => {
    activeReferenceIndex.value = Math.min(
      activeReferenceIndex.value,
      Math.max(0, filteredReferenceOptions.value.length - 1)
    );
  }
);

function updateActiveReference(input: HTMLTextAreaElement): void {
  const next = findComposerReferenceMatch(
    input.value,
    input.selectionStart ?? input.value.length
  );
  const changedTrigger =
    next?.start !== activeReference.value?.start ||
    next?.trigger !== activeReference.value?.trigger;
  activeReference.value = next;
  if (changedTrigger) {
    activeReferenceIndex.value = 0;
  }
}

function handleInput(event: Event): void {
  const input = event.target as HTMLTextAreaElement;
  emit("update:draft", input.value);
  updateActiveReference(input);
}

function closeReferenceMenu(): void {
  activeReference.value = null;
  activeReferenceIndex.value = 0;
}

function scrollActiveReferenceOptionIntoView(): void {
  void nextTick(() => {
    document
      .getElementById(`composer-reference-option-${activeReferenceIndex.value}`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function selectReference(option: ComposerReferenceOption): void {
  const match = activeReference.value;
  if (!match) {
    return;
  }
  const insertion = insertComposerReference(
    composerInput.value?.value ?? props.draft,
    match,
    option.label
  );
  emit("update:draft", insertion.value);
  closeReferenceMenu();
  void nextTick(() => {
    composerInput.value?.focus();
    composerInput.value?.setSelectionRange(insertion.caret, insertion.caret);
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (activeReference.value && !event.isComposing) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = filteredReferenceOptions.value.length;
      if (count) {
        const offset = event.key === "ArrowDown" ? 1 : -1;
        activeReferenceIndex.value =
          (activeReferenceIndex.value + offset + count) % count;
        scrollActiveReferenceOptionIntoView();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeReferenceMenu();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const option = filteredReferenceOptions.value[activeReferenceIndex.value];
      if (option) {
        selectReference(option);
      } else {
        closeReferenceMenu();
      }
      return;
    }
  }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  if (canSubmit.value) {
    submitMessage();
  }
}

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
const fallbackThinkingOptions: Array<{ value: ThinkingLevel; label: string }> =
  [
    { value: "off", label: "关闭" },
    ...BUILT_IN_REASONING_LEVELS.map((value) => ({
      value,
      label: builtInThinkingLabels[value]
    }))
  ];

function thinkingLabel(level: ThinkingLevel): string {
  if (level === "off") {
    return "关闭";
  }
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
const temperatureOptions = computed(
  () => selectedModel.value?.temperatureOptions ?? []
);
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

function handleModelChange(value: string | number): void {
  emit("selectModel", String(value));
}

function handleThinkingChange(value: string | number): void {
  emit("selectThinking", String(value) as ThinkingLevel);
}

function handleTemperatureChange(value: string | number): void {
  emit("selectTemperature", Number(value));
}

function handleApprovalChange(value: string | number): void {
  if (value === "request-approval" || value === "auto-approve") {
    emit("selectApproval", value);
  }
}

function formatHistoryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
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
        <button
          v-if="agentActivity"
          class="icon-button agent-activity-toggle"
          :class="{ 'is-collapsed': agentActivityCollapsed }"
          type="button"
          :aria-label="
            agentActivityCollapsed ? '展开智能体执行列表' : '收起智能体执行列表'
          "
          :aria-expanded="!agentActivityCollapsed"
          aria-controls="agent-activity-panel"
          @click="agentActivity.toggleCollapsed()"
        >
          <AppIcon
            class="agent-activity-toggle-icon"
            name="panel-top"
            :size="18"
          />
          <span
            v-if="agentActivityCollapsed && agentActivityItems.length"
            class="agent-activity-toggle-badge"
            aria-hidden="true"
          >
            {{ Math.min(agentActivityItems.length, 9)
            }}{{ agentActivityItems.length > 9 ? "+" : "" }}
          </span>
        </button>
        <div>
          <strong>{{ agentLabel }}</strong>
          <span class="context-caption">主上下文：{{ contextTitle }}</span>
        </div>
      </div>
      <div class="conversation-header-actions">
        <div
          class="conversation-history-control"
          @keydown.esc.stop="historyOpen = false"
        >
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
              <button
                type="button"
                aria-label="关闭历史对话"
                @click="historyOpen = false"
              >
                <AppIcon name="close" :size="15" />
              </button>
            </header>
            <div
              v-if="conversationHistory.length"
              class="conversation-history-list"
            >
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
                  <AppIcon
                    :name="item.current ? 'check' : 'message'"
                    :size="15"
                  />
                </span>
                <span class="conversation-history-copy">
                  <span class="conversation-history-title-row">
                    <strong>{{ item.title }}</strong>
                    <time :datetime="item.updatedAt">{{
                      formatHistoryTime(item.updatedAt)
                    }}</time>
                  </span>
                  <small>{{ item.preview || "暂无回复内容" }}</small>
                  <span class="conversation-history-meta">
                    {{
                      item.current
                        ? "当前对话"
                        : `${item.turnCount} 轮 · ${item.messageCount} 条消息`
                    }}
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
              {{
                responding
                  ? "当前回复完成或停止后，可切换到其他对话。"
                  : "选择历史记录即可切换对话。"
              }}
            </p>
          </section>
        </div>
        <button
          class="header-text-button"
          type="button"
          @click="emit('newConversation')"
        >
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
      <AgentActivityFloatPanel
        v-if="agentActivity && !agentActivityCollapsed"
        id="agent-activity-panel"
        :items="agentActivityItems"
        @select="selectAgentActivity"
      />
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
        :set-scroller="setConversationScroller"
        :set-message-list="setConversationMessageList"
        @suggestion="emit('suggestion', $event)"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
      />

      <ConversationTurnNavigator
        v-if="conversationTurns.length"
        :turns="conversationTurns"
        :active-turn-id="activeConversationTurnId"
        @select="scrollToConversationTurn"
      />
    </div>

    <footer class="composer-wrap">
      <div class="composer-stack">
        <div
          v-if="activeReference"
          id="composer-reference-menu"
          class="composer-reference-menu"
          role="listbox"
          :aria-label="referenceMenuTitle"
        >
          <div class="composer-reference-heading">
            <span class="composer-reference-trigger">{{
              activeReference.trigger
            }}</span>
            <div>
              <strong>{{ referenceMenuTitle }}</strong>
              <span>{{ referenceMenuHint }}</span>
            </div>
            <kbd>Esc</kbd>
          </div>
          <div
            v-if="filteredReferenceOptions.length"
            class="composer-reference-options"
          >
            <button
              v-for="(option, index) in filteredReferenceOptions"
              :id="`composer-reference-option-${index}`"
              :key="option.id"
              type="button"
              role="option"
              :aria-selected="index === activeReferenceIndex"
              :class="{ 'is-selected': index === activeReferenceIndex }"
              @mouseenter="activeReferenceIndex = index"
              @mousedown.prevent="selectReference(option)"
            >
              <span class="composer-reference-icon">
                <AppIcon
                  :name="
                    activeReference.trigger === '/' ? 'sparkles' : 'archive'
                  "
                  :size="17"
                />
              </span>
              <span class="composer-reference-copy">
                <strong>{{ option.label }}</strong>
                <small>{{ option.detail }}</small>
              </span>
              <span class="composer-reference-token">{{
                activeReference.trigger
              }}</span>
            </button>
          </div>
          <div v-else class="composer-reference-empty">
            {{
              referenceOptions.length
                ? "没有匹配的内容"
                : activeReference.trigger === "/"
                  ? "当前智能体没有可调用的技能"
                  : "当前智能体没有可用素材"
            }}
          </div>
          <div class="composer-reference-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 插入</span>
          </div>
        </div>

        <AgentUserInputCard
          v-if="userInputRequest"
          :request="userInputRequest"
          :submitting="userInputSubmitting"
          @submit="emit('submitUserInput', $event)"
        />

        <div v-else class="composer" :class="{ 'is-disabled': responding }">
          <div
            v-if="messages.length === 0"
            class="composer-context-bar"
            role="group"
            :aria-label="`当前绑定：书籍 ${bookTitle}，阶段 ${stageLabel}`"
          >
            <div
              class="composer-context-item composer-book-context"
              :title="`当前书籍：${bookTitle}`"
            >
              <AppIcon name="book" :size="16" />
              <strong>{{ bookTitle }}</strong>
            </div>
            <div
              class="composer-context-item composer-stage-context"
              :title="`当前阶段：${stageLabel}`"
            >
              <AppIcon name="wand" :size="16" />
              <strong>{{ stageLabel }}</strong>
            </div>
          </div>
          <div class="composer-input-surface">
            <input
              ref="attachmentInput"
              class="composer-file-input"
              type="file"
              multiple
              :accept="PROMPT_ATTACHMENT_ACCEPT"
              tabindex="-1"
              aria-hidden="true"
              @change="handleAttachmentChange"
            />
            <div
              v-if="editorReferences.length"
              class="composer-editor-reference-list"
              aria-label="已引用正文选区列表"
            >
              <div
                v-for="editorReference in editorReferences"
                :key="editorReference.id"
                class="composer-editor-reference"
              >
                <button
                  class="composer-editor-reference-main"
                  type="button"
                  :title="editorReferenceTooltip(editorReference)"
                  :aria-label="`定位到 ${editorReference.label}`"
                  @click="emit('locateEditorReference', editorReference)"
                >
                  <AppIcon name="quote" :size="13" />
                  <span>{{ editorReference.label }}</span>
                </button>
                <button
                  class="composer-editor-reference-remove"
                  type="button"
                  :aria-label="`移除正文引用 ${editorReference.label}`"
                  :disabled="responding"
                  @click="emit('removeEditorReference', editorReference.id)"
                >
                  <AppIcon name="close" :size="11" />
                </button>
              </div>
            </div>
            <div
              v-if="pendingAttachments.length || readingAttachments"
              class="composer-attachment-list"
              aria-label="待发送附件"
            >
              <article
                v-for="attachment in pendingAttachments"
                :key="attachment.id"
                class="composer-attachment-chip"
              >
                <img
                  v-if="attachmentPreview(attachment)"
                  :src="attachmentPreview(attachment)"
                  alt=""
                />
                <span
                  v-else
                  class="composer-attachment-icon"
                  aria-hidden="true"
                >
                  <AppIcon name="file" :size="16" />
                </span>
                <span class="composer-attachment-copy">
                  <strong>{{ attachment.name }}</strong>
                  <small>
                    {{
                      attachment.kind === "image"
                        ? "图片"
                        : attachment.mediaType === "application/pdf"
                          ? "PDF 文本"
                          : "文本"
                    }}
                    · {{ formatFileSize(attachment.size) }}
                    <template
                      v-if="attachment.kind === 'text' && attachment.truncated"
                    >
                      · 已截断</template
                    >
                  </small>
                </span>
                <button
                  type="button"
                  :aria-label="`移除附件 ${attachment.name}`"
                  :disabled="responding"
                  @click="removePendingAttachment(attachment.id)"
                >
                  <AppIcon name="close" :size="13" />
                </button>
              </article>
              <span
                v-if="readingAttachments"
                class="composer-attachment-loading"
              >
                正在读取附件…
              </span>
            </div>
            <textarea
              ref="composerInput"
              :value="draft"
              rows="1"
              :placeholder="composerPlaceholder"
              aria-label="智能体消息"
              aria-autocomplete="list"
              :aria-expanded="Boolean(activeReference)"
              :aria-controls="
                activeReference ? 'composer-reference-menu' : undefined
              "
              :aria-activedescendant="
                activeReference && filteredReferenceOptions.length
                  ? `composer-reference-option-${activeReferenceIndex}`
                  : undefined
              "
              :disabled="responding || !runtimeAvailable"
              @blur="closeReferenceMenu"
              @click="
                updateActiveReference($event.target as HTMLTextAreaElement)
              "
              @input="handleInput"
              @keydown="handleKeydown"
              @paste="handleComposerPaste"
            />
            <div class="composer-toolbar">
              <div class="composer-tools">
                <button
                  class="round-tool-button"
                  type="button"
                  aria-label="上传附件"
                  title="上传 TXT、MD、PDF 或图片"
                  :disabled="
                    responding || !runtimeAvailable || readingAttachments
                  "
                  @click="openAttachmentPicker"
                >
                  <AppIcon name="plus" :size="18" />
                </button>
                <PopupSelect
                  :model-value="selectedModelId"
                  :options="modelOptions"
                  accessible-label="选择模型"
                  placeholder="选择模型"
                  variant="compact"
                  :menu-min-width="210"
                  @update:model-value="handleModelChange"
                >
                  <template #prefix
                    ><AppIcon name="model" :size="14"
                  /></template>
                </PopupSelect>
                <PopupSelect
                  :model-value="thinkingLevel"
                  :options="availableThinkingOptions"
                  accessible-label="选择思考等级"
                  variant="compact"
                  :menu-min-width="180"
                  @update:model-value="handleThinkingChange"
                >
                  <template #prefix
                    ><AppIcon name="brain" :size="14"
                  /></template>
                </PopupSelect>
                <PopupSelect
                  v-if="showsTemperature"
                  :model-value="temperature"
                  :options="temperatureSelectOptions"
                  accessible-label="选择温度"
                  variant="compact"
                  :menu-min-width="160"
                  @update:model-value="handleTemperatureChange"
                >
                  <template #prefix
                    ><AppIcon name="temperature" :size="14"
                  /></template>
                </PopupSelect>
              </div>
              <div class="composer-actions">
                <PopupSelect
                  :model-value="approvalMode"
                  :options="approvalOptions"
                  accessible-label="选择正文修改权限"
                  variant="compact"
                  align="end"
                  :menu-min-width="300"
                  @update:model-value="handleApprovalChange"
                >
                  <template #prefix
                    ><AppIcon :name="approvalModeIcon" :size="14"
                  /></template>
                </PopupSelect>
                <button
                  class="round-tool-button"
                  type="button"
                  aria-label="语音输入"
                >
                  <AppIcon name="mic" :size="18" />
                </button>
                <button
                  v-if="!responding"
                  class="send-button"
                  type="button"
                  aria-label="发送消息"
                  :disabled="!canSubmit"
                  @click="submitMessage"
                >
                  <AppIcon name="arrow-up" :size="18" />
                </button>
                <button
                  v-else
                  class="send-button stop-button"
                  type="button"
                  aria-label="停止生成"
                  title="停止生成"
                  :disabled="!canStop"
                  @click="emit('stop')"
                >
                  <AppIcon name="stop" :size="15" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  </main>
</template>
