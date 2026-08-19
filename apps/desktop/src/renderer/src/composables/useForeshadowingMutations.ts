import { computed, ref, type Ref } from "vue";
import type {
  LongForeshadowingBeatType,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  createLongStructureMutationBuilder,
  type LongStructureMutationBuilder
} from "../types/longStructureMutations";
import type { LongStructureMutationCompletion } from "../types/longWorkspace";
import type {
  ForeshadowingBeat,
  ForeshadowingThread
} from "./useForeshadowingFilters";

export type FormKind = "thread" | "beat";
export type FormMode = "create" | "edit";
export type MutationSurface = "form" | "delete" | "background";

export interface ThreadDraft {
  id: string | null;
  title: string;
  coreQuestion: string;
  hiddenTruth: string;
  expectedReaderEffect: string;
  plannedSpan: "local" | "within_volume" | "cross_volume";
  status: "planned" | "abandoned";
}

export interface BeatDraft {
  id: string | null;
  threadId: string;
  type: LongForeshadowingBeatType;
  volumeId: string;
  arcId: string;
  plannedScope: string;
  note: string;
}

export type DeleteTarget =
  | {
      kind: "thread";
      thread: ForeshadowingThread;
    }
  | {
      kind: "beat";
      thread: ForeshadowingThread;
      beat: ForeshadowingBeat;
    };

export function useForeshadowingMutations(
  props: {
    snapshot: LongWorkspaceIndexSnapshot;
    disabled?: boolean | undefined;
  },
  emit: {
    (
      event: "mutation",
      batch: LongWorkspaceOperationBatch,
      completion: LongStructureMutationCompletion
    ): void;
  },
  state: {
    threadDraft: ThreadDraft;
    beatDraft: BeatDraft;
    formKind: Ref<FormKind>;
    formMode: Ref<FormMode>;
    formOpen: Ref<boolean>;
    deleteTarget: Ref<DeleteTarget | null>;
    threads: { value: ForeshadowingThread[] };
    firstFormInput: { value: HTMLInputElement | null };
    restoreFocus: () => void;
    isThreadLocked: (thread: ForeshadowingThread) => boolean;
  }
) {
  const pendingMutation = ref<{
    id: number;
    surface: MutationSurface;
  } | null>(null);
  let mutationClock = 0;
  const {
    threadDraft,
    beatDraft,
    formKind,
    formMode,
    threads,
    firstFormInput
  } = state;

  const mutationLocked = computed(
    () => props.disabled || pendingMutation.value !== null
  );

  function finishMutation(
    requestId: number,
    outcome: "succeeded" | "failed" | "applied-refresh-failed"
  ): void {
    const pending = pendingMutation.value;
    if (!pending || pending.id !== requestId) return;
    pendingMutation.value = null;
    if (outcome === "failed") return;
    if (pending.surface === "form") {
      state.formOpen.value = false;
    } else if (pending.surface === "delete") {
      state.deleteTarget.value = null;
    }
    state.restoreFocus();
  }

  function emitMutation(
    build: (
      builder: LongStructureMutationBuilder
    ) => LongWorkspaceOperationBatch,
    surface: MutationSurface
  ): boolean {
    if (mutationLocked.value) return false;
    try {
      const batch = build(createLongStructureMutationBuilder(props.snapshot));
      const requestId = ++mutationClock;
      pendingMutation.value = { id: requestId, surface };
      emit("mutation", batch, {
        succeed: () => finishMutation(requestId, "succeeded"),
        fail: () => finishMutation(requestId, "failed"),
        appliedButRefreshFailed: () =>
          finishMutation(requestId, "applied-refresh-failed")
      });
      return true;
    } catch (error: unknown) {
      uiMessage.warning(
        error instanceof Error ? error.message : "无法生成伏笔结构变更。"
      );
      return false;
    }
  }

  function submitThread(): void {
    const title = threadDraft.title.trim();
    if (!title) {
      uiMessage.warning("请输入伏笔线名称。");
      firstFormInput.value?.focus({ preventScroll: true });
      return;
    }

    emitMutation((builder) => {
      const input = {
        title,
        coreQuestion: threadDraft.coreQuestion,
        hiddenTruth: threadDraft.hiddenTruth,
        expectedReaderEffect: threadDraft.expectedReaderEffect,
        plannedSpan: threadDraft.plannedSpan,
        status:
          formMode.value === "create"
            ? ("planned" as const)
            : threadDraft.status
      };
      if (formMode.value === "create") {
        return builder.createForeshadowing(input);
      }
      if (!threadDraft.id) throw new Error("缺少待编辑伏笔线的稳定 ID。");
      const originalThread = threads.value.find(
        (thread) => thread.id === threadDraft.id
      );
      if (originalThread && state.isThreadLocked(originalThread)) {
        return builder.updateForeshadowing(threadDraft.id, {
          ...(originalThread.hiddenTruth === undefined
            ? { hiddenTruth: threadDraft.hiddenTruth }
            : {}),
          ...(originalThread.plannedSpan === undefined
            ? { plannedSpan: threadDraft.plannedSpan }
            : {}),
          status: threadDraft.status
        });
      }
      return builder.updateForeshadowing(threadDraft.id, input);
    }, "form");
  }

  function submitBeat(): void {
    if (!beatDraft.threadId) {
      uiMessage.warning("请选择所属伏笔线。");
      return;
    }
    const originalBeat =
      formMode.value === "edit" && beatDraft.id
        ? threads.value
            .flatMap((thread) => thread.beats)
            .find((beat) => beat.id === beatDraft.id)
        : undefined;
    const hasLegacyAnchor = Boolean(
      originalBeat?.eventId ||
      originalBeat?.placementId ||
      originalBeat?.chapterCardId
    );
    if (
      !beatDraft.volumeId &&
      !beatDraft.arcId &&
      !beatDraft.plannedScope.trim() &&
      !hasLegacyAnchor
    ) {
      uiMessage.warning("请选择分卷或剧情点，或填写计划范围。");
      return;
    }

    emitMutation((builder) => {
      const input = {
        threadId: beatDraft.threadId,
        type: beatDraft.type,
        volumeId: beatDraft.arcId ? null : beatDraft.volumeId || null,
        arcId: beatDraft.arcId || null,
        plannedScope: beatDraft.plannedScope,
        note: beatDraft.note
      };
      if (formMode.value === "create") {
        return builder.createForeshadowingBeat(input);
      }
      if (!beatDraft.id) throw new Error("缺少待编辑触点的稳定 ID。");
      return builder.updateForeshadowingBeat(beatDraft.id, input);
    }, "form");
  }

  function submitForm(): void {
    if (formKind.value === "thread") {
      submitThread();
    } else {
      submitBeat();
    }
  }

  function confirmDelete(): void {
    const target = state.deleteTarget.value;
    if (!target) return;
    emitMutation(
      (builder) =>
        target.kind === "thread"
          ? builder.deleteForeshadowing(target.thread.id, true)
          : builder.deleteForeshadowingBeat(target.beat.id),
      "delete"
    );
  }

  return {
    pendingMutation,
    mutationLocked,
    emitMutation,
    finishMutation,
    submitThread,
    submitBeat,
    submitForm,
    confirmDelete
  };
}
