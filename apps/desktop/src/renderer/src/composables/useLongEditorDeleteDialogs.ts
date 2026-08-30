import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import type {
  LongChapterCardId,
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type {
  LongStructureMutationCompletion,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import { longDeletionDescription } from "../utils/longDeletionImpact";
import { longImpactConfirmationDescription } from "../utils/longImpactConfirmation";

export interface LongNavigationDeleteTarget {
  kind: "character" | "volume" | "plotPoint" | "chapterCard";
  id: string;
  title: string;
  label: string;
  description: string;
  previewPending?: boolean;
  expectedImpact?: LongWorkspaceImpactConfirmation;
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
  emitPreviewMutation: (
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ) => void;
  emitMutation: (
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ) => void;
  selectWorldbuildingItem: (itemId: string) => Promise<void>;
  selectWorldbuildingOverview: () => Promise<void>;
  emitPreviewDeleteStructure: (
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ) => void;
  emitDeleteStructure: (
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void
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
    description: string;
    previewPending: boolean;
    pending: boolean;
    expectedImpact?: LongWorkspaceImpactConfirmation;
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
  const worldbuildingDeletePreviewPending = ref(false);
  const worldbuildingDeletePending = ref(false);
  const worldbuildingDeleteImpact = ref<LongWorkspaceImpactConfirmation>();
  let worldbuildingDeleteRequest = 0;

  const pendingWorldbuildingDeleteItem = computed(() => {
    const item = options.currentWorldbuildingItems.value.find(
      ({ id }) => id === options.pendingWorldbuildingDeleteId.value
    );
    if (!item) return null;
    const expectedImpact = worldbuildingDeleteImpact.value;
    return {
      ...item,
      description: expectedImpact
        ? longImpactConfirmationDescription(
            expectedImpact,
            "该条目及其正文文件将被删除，分类内容与连续性投影会同步更新。"
          )
        : "该条目及其正文文件将被删除，分类内容与连续性投影会同步更新。",
      previewPending: worldbuildingDeletePreviewPending.value,
      pending: worldbuildingDeletePending.value,
      ...(expectedImpact ? { expectedImpact } : {})
    };
  });

  function worldbuildingDeleteBatch(
    categoryId: string,
    itemId: string,
    expectedImpact?: LongWorkspaceImpactConfirmation
  ): LongWorkspaceOperationBatch {
    return {
      updatedAt: new Date().toISOString(),
      operations: [
        {
          type: "worldbuildingItem.delete",
          categoryId,
          id: itemId
        }
      ],
      documentWrites: [],
      ...(expectedImpact ? { expectedImpact } : {})
    };
  }

  function openWorldbuildingItemDelete(itemId: string): void {
    if (options.currentReadOnly.value) return;
    worldbuildingDeletePreviousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const categoryId = props.selection?.key.slice("worldbuilding:".length);
    if (!categoryId) return;
    const request = ++worldbuildingDeleteRequest;
    options.pendingWorldbuildingDeleteId.value = itemId;
    worldbuildingDeleteImpact.value = undefined;
    worldbuildingDeletePending.value = false;
    worldbuildingDeletePreviewPending.value = true;
    options.emitPreviewMutation(
      worldbuildingDeleteBatch(categoryId, itemId),
      (expectedImpact) => {
        if (
          request !== worldbuildingDeleteRequest ||
          options.pendingWorldbuildingDeleteId.value !== itemId
        ) {
          return;
        }
        worldbuildingDeletePreviewPending.value = false;
        worldbuildingDeleteImpact.value = expectedImpact;
      }
    );
    void nextTick(() => {
      worldbuildingDeleteCancelButton.value?.focus({ preventScroll: true });
    });
  }

  function closeWorldbuildingItemDelete(): void {
    if (worldbuildingDeletePending.value) return;
    worldbuildingDeleteRequest += 1;
    options.pendingWorldbuildingDeleteId.value = null;
    worldbuildingDeletePreviewPending.value = false;
    worldbuildingDeleteImpact.value = undefined;
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
    if (
      !target?.expectedImpact ||
      target.previewPending ||
      worldbuildingDeletePending.value
    ) {
      return;
    }
    const items = options.currentWorldbuildingItems.value;
    const targetIndex = items.findIndex(({ id }) => id === target.id);
    const nextItems = items.filter(({ id }) => id !== target.id);
    const categoryId = props.selection?.key.slice("worldbuilding:".length);
    if (!categoryId) return;
    worldbuildingDeletePending.value = true;
    options.emitMutation(
      worldbuildingDeleteBatch(categoryId, target.id, target.expectedImpact),
      {
        succeed() {
          worldbuildingDeletePending.value = false;
          closeWorldbuildingItemDelete();
          const nextId =
            nextItems[Math.min(targetIndex, nextItems.length - 1)]?.id ?? null;
          if (nextId) {
            void options.selectWorldbuildingItem(nextId);
            return;
          }
          void options.selectWorldbuildingOverview();
        },
        fail(_message, changedImpact) {
          worldbuildingDeletePending.value = false;
          if (changedImpact) {
            worldbuildingDeleteImpact.value = changedImpact;
          }
        },
        appliedButRefreshFailed() {
          worldbuildingDeletePending.value = false;
          closeWorldbuildingItemDelete();
        }
      }
    );
  }

  function showNavigationDelete(target: LongNavigationDeleteTarget): void {
    navigationDeletePreviousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const pendingTarget: LongNavigationDeleteTarget = {
      ...target,
      previewPending: true
    };
    navigationDeleteTarget.value = pendingTarget;
    options.emitPreviewDeleteStructure(
      { kind: target.kind, id: target.id, title: target.title },
      (expectedImpact) => {
        if (navigationDeleteTarget.value !== pendingTarget) return;
        navigationDeleteTarget.value = {
          ...pendingTarget,
          previewPending: false,
          ...(expectedImpact
            ? {
                description: longImpactConfirmationDescription(
                  expectedImpact,
                  pendingTarget.description
                )
              }
            : {}),
          ...(expectedImpact ? { expectedImpact } : {})
        };
      }
    );
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
    if (
      !target ||
      target.previewPending ||
      !target.expectedImpact ||
      navigationDeletePending.value
    )
      return;
    navigationDeletePending.value = true;
    options.emitDeleteStructure(
      {
        kind: target.kind,
        id: target.id,
        title: target.title,
        expectedImpact: target.expectedImpact
      },
      (succeeded, changedImpact) => {
        navigationDeletePending.value = false;
        if (succeeded) {
          closeNavigationDelete();
          return;
        }
        if (changedImpact && navigationDeleteTarget.value === target) {
          const refreshed = options.currentNavigationDeleteTarget.value;
          navigationDeleteTarget.value = {
            ...(refreshed ?? target),
            description: longImpactConfirmationDescription(
              changedImpact,
              (refreshed ?? target).description
            ),
            expectedImpact: changedImpact,
            previewPending: false
          };
        }
      }
    );
  }

  function openChapterCardDelete(chapterCardId: LongChapterCardId): void {
    if (props.locked || options.currentReadOnly.value) {
      return;
    }
    const index = props.workspaceIndex;
    const chapterCard = index?.plot.chapterCards.find(
      ({ id }) => id === chapterCardId
    );
    if (!index || !chapterCard) return;
    showNavigationDelete({
      kind: "chapterCard",
      id: chapterCard.id,
      title: chapterCard.title,
      label: "章卡",
      description: longDeletionDescription(index, "chapterCard", chapterCard.id)
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
