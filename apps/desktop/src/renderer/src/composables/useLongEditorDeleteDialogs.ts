import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import type {
  LongChapterCardId,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation
} from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";

export interface LongNavigationDeleteTarget {
  kind: "character" | "volume" | "plotPoint" | "chapterCard";
  id: string;
  title: string;
  label: string;
  description: string;
}

export function useLongEditorDeleteDialogs(options: {
  props: {
    selection: LongWorkspaceSelection | null;
    workspaceIndex: LongWorkspaceIndexSnapshot | null;
    locked?: boolean;
  };
  currentReadOnly: ComputedRef<boolean>;
  currentNavigationDeleteTarget: ComputedRef<LongNavigationDeleteTarget | null>;
  currentWorldbuildingItems: ComputedRef<Array<{ id: string; title: string }>>;
  pendingWorldbuildingDeleteId: Ref<string | null>;
  emitWorldbuildingItemMutation: (
    operations: LongWorkspaceOperation[],
    onSuccess?: () => void
  ) => void;
  selectWorldbuildingItem: (itemId: string) => Promise<void>;
  selectWorldbuildingOverview: () => Promise<void>;
  emitDeleteStructure: (
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (succeeded: boolean) => void
  ) => void;
}): {
  worldbuildingDeleteDialog: Ref<HTMLElement | undefined>;
  worldbuildingDeleteCancelButton: Ref<HTMLButtonElement | undefined>;
  navigationDeleteTarget: Ref<LongNavigationDeleteTarget | null>;
  navigationDeletePending: Ref<boolean>;
  navigationDeleteDialog: Ref<HTMLElement | undefined>;
  navigationDeleteCancelButton: Ref<HTMLButtonElement | undefined>;
  pendingWorldbuildingDeleteItem: ComputedRef<{
    id: string;
    title: string;
  } | null>;
  openWorldbuildingItemDelete: (itemId: string) => void;
  closeWorldbuildingItemDelete: () => void;
  handleWorldbuildingDeleteKeydown: (event: KeyboardEvent) => void;
  confirmWorldbuildingItemDelete: () => void;
  showNavigationDelete: (target: LongNavigationDeleteTarget) => void;
  openNavigationDelete: () => void;
  closeNavigationDelete: () => void;
  handleNavigationDeleteKeydown: (event: KeyboardEvent) => void;
  confirmNavigationDelete: () => void;
  openChapterCardDelete: (chapterCardId: LongChapterCardId) => void;
} {
  const { props } = options;
  const worldbuildingDeleteDialog = ref<HTMLElement>();
  const worldbuildingDeleteCancelButton = ref<HTMLButtonElement>();
  const navigationDeleteTarget = ref<LongNavigationDeleteTarget | null>(null);
  const navigationDeletePending = ref(false);
  const navigationDeleteDialog = ref<HTMLElement>();
  const navigationDeleteCancelButton = ref<HTMLButtonElement>();
  let worldbuildingDeletePreviousFocus: HTMLElement | null = null;
  let navigationDeletePreviousFocus: HTMLElement | null = null;

  const pendingWorldbuildingDeleteItem = computed(
    () =>
      options.currentWorldbuildingItems.value.find(
        ({ id }) => id === options.pendingWorldbuildingDeleteId.value
      ) ?? null
  );

  function openWorldbuildingItemDelete(itemId: string): void {
    if (options.currentReadOnly.value) return;
    worldbuildingDeletePreviousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    options.pendingWorldbuildingDeleteId.value = itemId;
    void nextTick(() => {
      worldbuildingDeleteCancelButton.value?.focus({ preventScroll: true });
    });
  }

  function closeWorldbuildingItemDelete(): void {
    options.pendingWorldbuildingDeleteId.value = null;
    const previousFocus = worldbuildingDeletePreviousFocus;
    worldbuildingDeletePreviousFocus = null;
    void nextTick(() => {
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    });
  }

  function handleWorldbuildingDeleteKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeWorldbuildingItemDelete();
      return;
    }
    if (event.key !== "Tab" || !worldbuildingDeleteDialog.value) return;
    const focusable = Array.from(
      worldbuildingDeleteDialog.value.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) {
      event.preventDefault();
      worldbuildingDeleteDialog.value.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function confirmWorldbuildingItemDelete(): void {
    const target = pendingWorldbuildingDeleteItem.value;
    if (!target) return;
    const items = options.currentWorldbuildingItems.value;
    const targetIndex = items.findIndex(({ id }) => id === target.id);
    const nextItems = items.filter(({ id }) => id !== target.id);
    const categoryId = props.selection?.key.slice("worldbuilding:".length);
    if (!categoryId) return;
    options.emitWorldbuildingItemMutation(
      [
        {
          type: "worldbuildingItem.delete",
          categoryId,
          id: target.id,
          cascade: true
        }
      ],
      () => {
        closeWorldbuildingItemDelete();
        const nextId =
          nextItems[Math.min(targetIndex, nextItems.length - 1)]?.id ?? null;
        if (nextId) {
          void options.selectWorldbuildingItem(nextId);
          return;
        }
        void options.selectWorldbuildingOverview();
      }
    );
  }

  function showNavigationDelete(target: LongNavigationDeleteTarget): void {
    navigationDeletePreviousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    navigationDeleteTarget.value = target;
    void nextTick(() => {
      navigationDeleteCancelButton.value?.focus({ preventScroll: true });
    });
  }

  function openNavigationDelete(): void {
    const target = options.currentNavigationDeleteTarget.value;
    if (!target || props.locked || options.currentReadOnly.value) return;
    showNavigationDelete(target);
  }

  function closeNavigationDelete(): void {
    if (navigationDeletePending.value) return;
    navigationDeleteTarget.value = null;
    const previousFocus = navigationDeletePreviousFocus;
    navigationDeletePreviousFocus = null;
    void nextTick(() => {
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    });
  }

  function handleNavigationDeleteKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeNavigationDelete();
      return;
    }
    if (event.key !== "Tab" || !navigationDeleteDialog.value) return;
    const focusable = Array.from(
      navigationDeleteDialog.value.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) {
      event.preventDefault();
      navigationDeleteDialog.value.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function confirmNavigationDelete(): void {
    const target = navigationDeleteTarget.value;
    if (!target || navigationDeletePending.value) return;
    navigationDeletePending.value = true;
    options.emitDeleteStructure(
      {
        kind: target.kind,
        id: target.id,
        title: target.title
      },
      (succeeded) => {
        navigationDeletePending.value = false;
        if (succeeded) closeNavigationDelete();
      }
    );
  }

  function openChapterCardDelete(chapterCardId: LongChapterCardId): void {
    if (props.locked || options.currentReadOnly.value) {
      return;
    }
    const chapterCard = props.workspaceIndex?.plot.chapterCards.find(
      ({ id }) => id === chapterCardId
    );
    if (!chapterCard) return;
    showNavigationDelete({
      kind: "chapterCard",
      id: chapterCard.id,
      title: chapterCard.title,
      label: "章卡",
      description:
        "将永久删除该章卡、章节正文、章末人物状态、下一章接续包，以及相关剧情落点和伏笔触点。"
    });
  }

  return {
    worldbuildingDeleteDialog,
    worldbuildingDeleteCancelButton,
    navigationDeleteTarget,
    navigationDeletePending,
    navigationDeleteDialog,
    navigationDeleteCancelButton,
    pendingWorldbuildingDeleteItem,
    openWorldbuildingItemDelete,
    closeWorldbuildingItemDelete,
    handleWorldbuildingDeleteKeydown,
    confirmWorldbuildingItemDelete,
    showNavigationDelete,
    openNavigationDelete,
    closeNavigationDelete,
    handleNavigationDeleteKeydown,
    confirmNavigationDelete,
    openChapterCardDelete
  };
}
