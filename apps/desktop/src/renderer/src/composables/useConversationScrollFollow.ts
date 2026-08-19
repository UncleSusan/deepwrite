import { nextTick, onBeforeUnmount, ref } from "vue";
import type { ChatMessage } from "../types/conversation";
import { createTransientScrollbarController } from "../utils/transientScrollbar";

const TAIL_FOLLOW_THRESHOLD = 72;

export function useConversationScrollFollow(options: {
  messages: () => ChatMessage[];
  responding: () => boolean;
  onScroll?: () => void;
}) {
  const scroller = ref<HTMLElement>();
  const conversationScrollbar = createTransientScrollbarController();
  const followsConversationTail = ref(true);
  const tailFollowLockedForResponse = ref(false);
  let lastConversationScrollTop = 0;
  let scrollFrame: number | undefined;

  function isNearConversationTail(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= TAIL_FOLLOW_THRESHOLD;
  }

  function hasActiveConversationResponse(): boolean {
    return (
      options.responding() ||
      options.messages().some(
        (message) => message.role === "assistant" && message.status === "streaming"
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

  function handleConversationWheel(event: WheelEvent): void {
    if (event.deltaY < 0) lockConversationTailForCurrentResponse();
  }

  function handleConversationScroll(): void {
    const element = scroller.value;
    if (!element) return;
    conversationScrollbar.reveal(element);
    const nextScrollTop = element.scrollTop;
    if (hasActiveConversationResponse() && nextScrollTop < lastConversationScrollTop - 1) {
      lockConversationTailForCurrentResponse();
    }
    if (hasActiveConversationResponse()) {
      followsConversationTail.value = !tailFollowLockedForResponse.value;
    } else {
      followsConversationTail.value = isNearConversationTail(element);
    }
    lastConversationScrollTop = nextScrollTop;
    options.onScroll?.();
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

  function resetScrollForSession(): void {
    tailFollowLockedForResponse.value = false;
    followsConversationTail.value = true;
    void nextTick(() => {
      lastConversationScrollTop = scroller.value?.scrollTop ?? 0;
      scheduleConversationTailFollow();
    });
  }

  onBeforeUnmount(() => {
    if (scrollFrame !== undefined) globalThis.cancelAnimationFrame(scrollFrame);
    conversationScrollbar.dispose();
  });

  return {
    scroller,
    followsConversationTail,
    tailFollowLockedForResponse,
    lastConversationScrollTop: () => lastConversationScrollTop,
    setLastConversationScrollTop: (value: number) => {
      lastConversationScrollTop = value;
    },
    isNearConversationTail,
    hasActiveConversationResponse,
    lockConversationTailForCurrentResponse,
    handleConversationWheel,
    handleConversationScroll,
    scheduleConversationTailFollow,
    resetScrollForSession
  };
}
