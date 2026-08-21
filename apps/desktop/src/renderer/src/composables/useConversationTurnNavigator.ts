import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref
} from "vue";
import type { ChatMessage } from "../types/conversation";

export interface ConversationTurn {
  id: string;
  number: number;
  prompt: string;
  response: string | undefined;
}

interface ConversationTurnNavigatorOptions {
  messages: () => readonly ChatMessage[];
  currentSessionId: () => string;
  scroller: Ref<HTMLElement | undefined>;
  messageList: Ref<HTMLElement | undefined>;
  beforeNavigate: () => void;
}

function compactConversationText(
  content: string,
  fallback: string,
  maxLength: number
): string {
  const compact = content
    .slice(0, 2_400)
    .replace(/```[\s\S]*?```/g, " 代码片段 ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " 图片 ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const text = compact || fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function promptFallback(message: ChatMessage): string {
  const attachmentNames = message.attachments
    ?.map((attachment) => attachment.name)
    .filter(Boolean)
    .join("、");
  return attachmentNames ? `附件：${attachmentNames}` : "无文字消息";
}

export function buildConversationTurns(
  messages: readonly ChatMessage[]
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;

    const response = messages
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.role === "user" ||
          (candidate.role === "assistant" && candidate.content.trim())
      );
    turns.push({
      id: message.id,
      number: turns.length + 1,
      prompt: compactConversationText(
        message.content,
        promptFallback(message),
        72
      ),
      response:
        response?.role === "assistant"
          ? compactConversationText(response.content, "", 132)
          : undefined
    });
  }
  return turns;
}

export function useConversationTurnNavigator(
  options: ConversationTurnNavigatorOptions
) {
  const activeTurnId = ref<string | null>(null);
  const turns = computed(() => buildConversationTurns(options.messages()));
  let updateFrame: number | undefined;
  let resizeObserver: ResizeObserver | undefined;

  function messageElement(messageId: string): HTMLElement | undefined {
    const list = options.messageList.value;
    if (!list) return undefined;
    return Array.from(
      list.querySelectorAll<HTMLElement>(
        ":scope > .message[data-conversation-message-id]"
      )
    ).find((element) => element.dataset.conversationMessageId === messageId);
  }

  function updateActiveTurn(): void {
    const container = options.scroller.value;
    if (!container || !turns.value.length) {
      activeTurnId.value = null;
      return;
    }
    const focusLine =
      container.getBoundingClientRect().top + container.clientHeight * 0.34;
    let nextActiveId = turns.value[0]!.id;
    for (const turn of turns.value) {
      const element = messageElement(turn.id);
      if (!element || element.getBoundingClientRect().top > focusLine) break;
      nextActiveId = turn.id;
    }
    activeTurnId.value = nextActiveId;
  }

  function scheduleActiveTurnUpdate(): void {
    if (updateFrame !== undefined) return;
    updateFrame = globalThis.requestAnimationFrame(() => {
      updateFrame = undefined;
      updateActiveTurn();
    });
  }

  function scrollToTurn(messageId: string): void {
    const container = options.scroller.value;
    const element = messageElement(messageId);
    if (!container || !element) return;
    options.beforeNavigate();
    activeTurnId.value = messageId;
    const targetTop =
      container.scrollTop +
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      22;
    const reduceMotion = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reduceMotion ? "auto" : "smooth"
    });
  }

  async function observeCurrentElements(): Promise<void> {
    await nextTick();
    if (!resizeObserver) return;
    if (options.scroller.value) resizeObserver.observe(options.scroller.value);
    if (options.messageList.value) {
      resizeObserver.observe(options.messageList.value);
    }
    updateActiveTurn();
  }

  onMounted(() => {
    resizeObserver = new ResizeObserver(scheduleActiveTurnUpdate);
    void observeCurrentElements();
  });

  watch(
    () => [options.currentSessionId(), options.messages().length],
    () => void observeCurrentElements()
  );

  onBeforeUnmount(() => {
    if (updateFrame !== undefined) {
      globalThis.cancelAnimationFrame(updateFrame);
    }
    resizeObserver?.disconnect();
  });

  return {
    activeTurnId,
    scheduleActiveTurnUpdate,
    scrollToTurn,
    turns
  };
}
