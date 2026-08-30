import type { TextViewMode } from "@deepwrite/contracts";
import { nextTick, watch, type Ref } from "vue";
import {
  recalledEditorScrollPosition,
  rememberEditorScrollPosition
} from "../utils/editorScrollMemory";

export interface LongEditorScrollIdentity {
  bookId: string;
  selectionKey: string;
  fileId: string;
  worldbuildingItemId: string;
  bookLineVolumeId: string;
  bookLineContentTab: string;
  plotPointId: string;
  plotPointTab: string;
  storyPlotId: string;
  chapterCardId: string;
}

export function longEditorScrollMemoryKey(
  identity: LongEditorScrollIdentity
): string {
  return [
    "long-workspace",
    identity.bookId,
    identity.selectionKey,
    identity.fileId,
    identity.worldbuildingItemId,
    identity.bookLineVolumeId,
    identity.bookLineContentTab,
    identity.plotPointId,
    identity.plotPointTab,
    identity.storyPlotId,
    identity.chapterCardId
  ].join("\u0000");
}

interface ScrollElement {
  scrollTop: number;
}

function eventScrollElement(event: Event): ScrollElement | null {
  const target = event.currentTarget;
  if (!target || typeof target !== "object" || !("scrollTop" in target)) {
    return null;
  }
  return target as unknown as ScrollElement;
}

export function useLongEditorScrollMemory(options: {
  documentKey: () => string;
  viewMode: Ref<TextViewMode>;
  editorInput: Ref<HTMLTextAreaElement | null>;
  documentPreview: Ref<HTMLElement | null>;
}) {
  function scrollerFor(view: TextViewMode): ScrollElement | null {
    return view === "edit"
      ? options.editorInput.value
      : options.documentPreview.value;
  }

  function rememberScroll(
    key = options.documentKey(),
    view = options.viewMode.value
  ): void {
    const scroller = scrollerFor(view);
    if (!scroller) return;
    rememberEditorScrollPosition(key, view, scroller.scrollTop);
  }

  async function restoreScroll(
    key = options.documentKey(),
    view = options.viewMode.value
  ): Promise<void> {
    await nextTick();
    if (options.documentKey() !== key || options.viewMode.value !== view) {
      return;
    }
    const scroller = scrollerFor(view);
    if (!scroller) return;
    scroller.scrollTop = recalledEditorScrollPosition(key, view);
  }

  function handleScroll(event: Event): void {
    const scroller = eventScrollElement(event);
    if (!scroller) return;
    rememberEditorScrollPosition(
      options.documentKey(),
      options.viewMode.value,
      scroller.scrollTop
    );
  }

  watch(
    () => [options.documentKey(), options.viewMode.value] as const,
    ([nextKey, nextView], [previousKey, previousView]) => {
      rememberScroll(previousKey, previousView);
      void restoreScroll(nextKey, nextView);
    },
    { flush: "pre" }
  );

  return {
    handleScroll,
    rememberScroll,
    restoreScroll
  };
}
