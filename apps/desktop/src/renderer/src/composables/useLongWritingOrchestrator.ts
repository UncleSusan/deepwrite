import { computed, ref, type ComputedRef, type Ref } from "vue";
import type {
  LongChapterReadiness,
  LongWritingScope
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalEvent } from "./useLongWorkspaceProposals";

export type LongWritingWorkflowPhase =
  | "idle"
  | "checking"
  | "awaiting_writer_approval"
  | "awaiting_ledger_approval"
  | "saving"
  | "error"
  | "complete";

type RetryPoint =
  | "check"
  | "after_write"
  | "after_ledger";

export interface LongWritingWorkflowState {
  bookId: string | null;
  scope: LongWritingScope | null;
  chapters: LongChapterReadiness[];
  currentIndex: number;
  phase: LongWritingWorkflowPhase;
  error: string | null;
  retryPoint: RetryPoint | null;
}

export interface LongWritingApprovalExpectation {
  bookId: string;
  chapterCardId: string;
  agentId: "expert_section_writer" | "continuity_ledger";
  sessionId: string;
  runId?: string;
}

export function canApproveLongWritingProposal(input: {
  active: boolean;
  state: LongWritingWorkflowState;
  currentChapter: LongChapterReadiness | null;
  expectation: LongWritingApprovalExpectation | null;
  event: LongWorkspaceProposalEvent;
}): boolean {
  if (!input.active) return true;
  const { state, currentChapter: chapter, expectation, event } = input;
  if (
    !chapter ||
    !expectation ||
    state.bookId !== event.payload.bookId ||
    expectation.bookId !== event.payload.bookId ||
    expectation.chapterCardId !== chapter.chapterCardId ||
    event.payload.agentId !== expectation.agentId ||
    event.payload.sessionId !== expectation.sessionId ||
    (expectation.runId !== undefined &&
      event.payload.runId !== expectation.runId)
  ) {
    return false;
  }
  return (
    (state.phase === "awaiting_writer_approval" &&
      expectation.agentId === "expert_section_writer" &&
      event.type === "long.chapter_write_proposal" &&
      event.payload.input.chapterCardId === chapter.chapterCardId) ||
    (state.phase === "awaiting_ledger_approval" &&
      expectation.agentId === "continuity_ledger" &&
      event.type === "long.ledger_commit_proposal" &&
      event.payload.input.chapterCardId === chapter.chapterCardId)
  );
}

interface LongWritingWorkflowNotifications {
  success(message: string): void;
  info(message: string): void;
  error(message: string): void;
}

export interface LongWritingRunGuard {
  isCurrent(): boolean;
}

export interface UseLongWritingOrchestratorOptions {
  resolveReadiness(
    bookId: string,
    chapterCardId: string
  ): Promise<LongChapterReadiness>;
  startWriter(
    bookId: string,
    readiness: LongChapterReadiness,
    guard: LongWritingRunGuard
  ): Promise<void>;
  startLedger(
    bookId: string,
    readiness: LongChapterReadiness,
    guard: LongWritingRunGuard
  ): Promise<void>;
  saveBarrier(bookId: string): Promise<boolean>;
  notifications: LongWritingWorkflowNotifications;
}

export interface LongWritingOrchestrator {
  state: Ref<LongWritingWorkflowState>;
  active: ComputedRef<boolean>;
  currentChapter: ComputedRef<LongChapterReadiness | null>;
  startDispatch(
    event: Extract<
      LongWorkspaceProposalEvent,
      { type: "long.chapter_dispatch_proposal" }
    >
  ): Promise<void>;
  handleApplied(event: LongWorkspaceProposalEvent): Promise<boolean>;
  handleRejected(event: LongWorkspaceProposalEvent): boolean;
  handleRunFailure(
    agentId: "expert_section_writer" | "continuity_ledger",
    error: string
  ): boolean;
  retry(): Promise<void>;
  cancel(): void;
}

const EMPTY_STATE: LongWritingWorkflowState = {
  bookId: null,
  scope: null,
  chapters: [],
  currentIndex: 0,
  phase: "idle",
  error: null,
  retryPoint: null
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useLongWritingOrchestrator(
  options: UseLongWritingOrchestratorOptions
): LongWritingOrchestrator {
  const state = ref<LongWritingWorkflowState>({ ...EMPTY_STATE });
  let epoch = 0;

  const currentChapter = computed(
    () => state.value.chapters[state.value.currentIndex] ?? null
  );
  const active = computed(
    () =>
      state.value.phase !== "idle" &&
      state.value.phase !== "complete"
  );

  function patch(values: Partial<LongWritingWorkflowState>): void {
    state.value = { ...state.value, ...values };
  }

  function fail(error: unknown, retryPoint: RetryPoint): void {
    const message = errorMessage(error, "长篇串行写作编排失败。");
    patch({ phase: "error", error: message, retryPoint });
    options.notifications.error(message);
  }

  function replaceReadiness(readiness: LongChapterReadiness): void {
    const chapters = [...state.value.chapters];
    chapters[state.value.currentIndex] = readiness;
    patch({ chapters });
  }

  function runGuard(runEpoch: number): LongWritingRunGuard {
    return {
      isCurrent: () => runEpoch === epoch
    };
  }

  async function startLedger(
    runEpoch: number,
    readiness: LongChapterReadiness
  ): Promise<void> {
    const bookId = state.value.bookId;
    if (!bookId || runEpoch !== epoch) return;
    patch({
      phase: "awaiting_ledger_approval",
      error: null,
      retryPoint: null
    });
    try {
      await options.startLedger(bookId, readiness, runGuard(runEpoch));
    } catch (error: unknown) {
      if (
        runEpoch === epoch &&
        state.value.phase === "awaiting_ledger_approval" &&
        currentChapter.value?.chapterCardId === readiness.chapterCardId
      ) {
        fail(error, "after_write");
      }
    }
  }

  async function checkAndStart(runEpoch: number): Promise<void> {
    const bookId = state.value.bookId;
    const chapter = currentChapter.value;
    if (!bookId || !chapter || runEpoch !== epoch) return;
    patch({ phase: "checking", error: null, retryPoint: null });
    try {
      const readiness = await options.resolveReadiness(
        bookId,
        chapter.chapterCardId
      );
      if (runEpoch !== epoch) return;
      if (readiness.chapterCardId !== chapter.chapterCardId) {
        throw new Error("章节正文检查返回了错误的章卡。");
      }
      replaceReadiness(readiness);
      if (readiness.status === "ready_to_commit") {
        await startLedger(runEpoch, readiness);
        return;
      }
      patch({
        phase: "awaiting_writer_approval",
        error: null,
        retryPoint: null
      });
      await options.startWriter(bookId, readiness, runGuard(runEpoch));
    } catch (error: unknown) {
      if (
        runEpoch === epoch &&
        state.value.phase === "awaiting_writer_approval" &&
        currentChapter.value?.chapterCardId === chapter.chapterCardId
      ) {
        fail(error, "check");
      }
    }
  }

  async function passWriteBarrier(runEpoch: number): Promise<void> {
    const bookId = state.value.bookId;
    const chapter = currentChapter.value;
    if (!bookId || !chapter || runEpoch !== epoch) return;
    patch({ phase: "saving", error: null, retryPoint: null });
    try {
      if (!(await options.saveBarrier(bookId))) {
        throw new Error(
          "章节正文已经写入，但工作区刷新屏障尚未完成；请重试后再进入连续性结算。"
        );
      }
      if (runEpoch !== epoch) return;
      const readiness = await options.resolveReadiness(
        bookId,
        chapter.chapterCardId
      );
      if (runEpoch !== epoch) return;
      if (readiness.chapterCardId !== chapter.chapterCardId) {
        throw new Error("章节正文保存检查返回了错误的章卡。");
      }
      if (readiness.status !== "ready_to_commit") {
        throw new Error(
          `章节正文保存后仍不完整：${readiness.missingFiles.join("、")}。`
        );
      }
      replaceReadiness(readiness);
      await startLedger(runEpoch, readiness);
    } catch (error: unknown) {
      if (runEpoch === epoch) fail(error, "after_write");
    }
  }

  async function passLedgerBarrier(runEpoch: number): Promise<void> {
    const bookId = state.value.bookId;
    if (!bookId || runEpoch !== epoch) return;
    patch({ phase: "saving", error: null, retryPoint: null });
    try {
      if (!(await options.saveBarrier(bookId))) {
        throw new Error(
          "连续性提交已写入，但工作区刷新屏障尚未完成；请重试，编排不会跳过本章。"
        );
      }
      if (runEpoch !== epoch) return;
      const nextIndex = state.value.currentIndex + 1;
      if (nextIndex >= state.value.chapters.length) {
        patch({
          currentIndex: nextIndex,
          phase: "complete",
          error: null,
          retryPoint: null
        });
        options.notifications.success("本次长篇串行写作计划已全部完成。");
        return;
      }
      patch({ currentIndex: nextIndex });
      await checkAndStart(runEpoch);
    } catch (error: unknown) {
      if (runEpoch === epoch) fail(error, "after_ledger");
    }
  }

  async function startDispatch(
    event: Extract<
      LongWorkspaceProposalEvent,
      { type: "long.chapter_dispatch_proposal" }
    >
  ): Promise<void> {
    if (active.value) {
      throw new Error(
        "已有长篇串行写作计划正在执行，请先完成当前计划。"
      );
    }
    epoch += 1;
    const runEpoch = epoch;
    state.value = {
      bookId: event.payload.bookId,
      scope: event.payload.scope,
      chapters: event.payload.chapters.map((chapter) => ({
        ...chapter,
        missingFiles: [...chapter.missingFiles]
      })),
      currentIndex: 0,
      phase: "checking",
      error: null,
      retryPoint: null
    };
    options.notifications.info(
      `已启动 ${event.payload.chapters.length} 章串行写作计划。`
    );
    await checkAndStart(runEpoch);
  }

  async function handleApplied(
    event: LongWorkspaceProposalEvent
  ): Promise<boolean> {
    const bookId = state.value.bookId;
    const chapter = currentChapter.value;
    if (
      !bookId ||
      !chapter ||
      event.payload.bookId !== bookId
    ) {
      return false;
    }
    const runEpoch = epoch;
    if (event.type === "long.chapter_write_proposal") {
      if (
        state.value.phase !== "awaiting_writer_approval" ||
        event.payload.input.chapterCardId !== chapter.chapterCardId
      ) {
        return false;
      }
      await passWriteBarrier(runEpoch);
      return true;
    }
    if (event.type === "long.ledger_commit_proposal") {
      if (
        state.value.phase !== "awaiting_ledger_approval" ||
        event.payload.input.chapterCardId !== chapter.chapterCardId
      ) {
        return false;
      }
      await passLedgerBarrier(runEpoch);
      return true;
    }
    return false;
  }

  async function retry(): Promise<void> {
    if (
      state.value.phase !== "error" ||
      state.value.retryPoint === null
    ) {
      return;
    }
    const runEpoch = epoch;
    if (state.value.retryPoint === "after_write") {
      await passWriteBarrier(runEpoch);
      return;
    }
    if (state.value.retryPoint === "after_ledger") {
      await passLedgerBarrier(runEpoch);
      return;
    }
    await checkAndStart(runEpoch);
  }

  function handleRejected(event: LongWorkspaceProposalEvent): boolean {
    const chapter = currentChapter.value;
    if (
      !chapter ||
      state.value.bookId !== event.payload.bookId
    ) {
      return false;
    }
    if (
      event.type === "long.chapter_write_proposal" &&
      state.value.phase === "awaiting_writer_approval" &&
      event.payload.input.chapterCardId === chapter.chapterCardId
    ) {
      fail(
        new Error(
          `已拒绝“${chapter.title}”的正文写入；可修改要求后重试当前章，计划不会跳章。`
        ),
        "check"
      );
      return true;
    }
    if (
      event.type === "long.ledger_commit_proposal" &&
      state.value.phase === "awaiting_ledger_approval" &&
      event.payload.input.chapterCardId === chapter.chapterCardId
    ) {
      fail(
        new Error(
          `已拒绝“${chapter.title}”的连续性提交；可重试当前章核对，计划不会推进。`
        ),
        "after_write"
      );
      return true;
    }
    return false;
  }

  function handleRunFailure(
    agentId: "expert_section_writer" | "continuity_ledger",
    error: string
  ): boolean {
    const chapter = currentChapter.value;
    if (!chapter) return false;
    if (
      agentId === "expert_section_writer" &&
      state.value.phase === "awaiting_writer_approval"
    ) {
      fail(
        new Error(
          `“${chapter.title}”单章写手运行失败：${error}。可重试当前章，计划不会跳章。`
        ),
        "check"
      );
      return true;
    }
    if (
      agentId === "continuity_ledger" &&
      state.value.phase === "awaiting_ledger_approval"
    ) {
      fail(
        new Error(
          `“${chapter.title}”连续性核对运行失败：${error}。可重试当前章，计划不会推进。`
        ),
        "after_write"
      );
      return true;
    }
    return false;
  }

  function cancel(): void {
    epoch += 1;
    state.value = { ...EMPTY_STATE };
  }

  return {
    state,
    active,
    currentChapter,
    startDispatch,
    handleApplied,
    handleRejected,
    handleRunFailure,
    retry,
    cancel
  };
}
