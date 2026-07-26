import { describe, expect, it, vi } from "vitest";
import type {
  LongChapterReadiness
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalEvent } from "./useLongWorkspaceProposals";
import {
  canApproveLongWritingProposal,
  useLongWritingOrchestrator,
  type LongWritingRunGuard
} from "./useLongWritingOrchestrator";

function readiness(
  chapterCardId: string,
  status: LongChapterReadiness["status"]
): LongChapterReadiness {
  return {
    chapterCardId,
    title: chapterCardId === "chapter_one" ? "第一章" : "第二章",
    status,
    missingFiles:
      status === "empty"
        ? ["body", "character_state", "handoff"]
        : status === "partial"
          ? ["handoff"]
          : []
  };
}

function dispatchEvent(): Extract<
  LongWorkspaceProposalEvent,
  { type: "long.chapter_dispatch_proposal" }
> {
  return {
    protocolVersion: 1,
    id: "event-dispatch",
    type: "long.chapter_dispatch_proposal",
    timestamp: "2026-07-26T12:00:00.000Z",
    context: {
      correlationId: "correlation-dispatch",
      sessionId: "session-dispatch",
      runId: "run-dispatch",
      resourceId: "longbook_test"
    },
    payload: {
      sessionId: "session-dispatch",
      runId: "run-dispatch",
      toolCallId: "tool-dispatch",
      bookId: "longbook_test",
      agentId: "draft",
      scope: "arc",
      chapterCardId: "chapter_one",
      title: "第一章",
      chapters: [
        readiness("chapter_one", "partial"),
        readiness("chapter_two", "ready_to_commit")
      ],
      workspaceRevision: 1,
      projectRevision: 1,
      summary: "写当前主弧",
      runtime: {
        provider: "deepwrite",
        model: "test",
        mode: "local-faux"
      }
    }
  };
}

function appliedEvent(
  type: "long.chapter_write_proposal" | "long.ledger_commit_proposal",
  chapterCardId: string
): LongWorkspaceProposalEvent {
  return {
    type,
    payload: {
      bookId: "longbook_test",
      input: { chapterCardId }
    }
  } as LongWorkspaceProposalEvent;
}

function approvalProposal(
  type: "long.chapter_write_proposal" | "long.ledger_commit_proposal",
  overrides: {
    bookId?: string;
    chapterCardId?: string;
    agentId?: "expert_section_writer" | "continuity_ledger";
    sessionId?: string;
    runId?: string;
  } = {}
): LongWorkspaceProposalEvent {
  return {
    type,
    payload: {
      bookId: overrides.bookId ?? "longbook_test",
      agentId:
        overrides.agentId ??
        (type === "long.chapter_write_proposal"
          ? "expert_section_writer"
          : "continuity_ledger"),
      sessionId: overrides.sessionId ?? "session-current",
      runId: overrides.runId ?? "run-current",
      input: {
        chapterCardId: overrides.chapterCardId ?? "chapter_one"
      }
    }
  } as LongWorkspaceProposalEvent;
}

function harness() {
  const live = new Map<string, LongChapterReadiness>([
    ["chapter_one", readiness("chapter_one", "partial")],
    ["chapter_two", readiness("chapter_two", "ready_to_commit")]
  ]);
  const startWriter = vi.fn();
  const startLedger = vi.fn();
  const saveBarrier = vi.fn(async () => true);
  const notifications = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  };
  const controller = useLongWritingOrchestrator({
    resolveReadiness: vi.fn(async (_bookId, chapterCardId) => {
      const result = live.get(chapterCardId);
      if (!result) throw new Error("missing fixture");
      return result;
    }),
    startWriter,
    startLedger,
    saveBarrier,
    notifications
  });
  return {
    controller,
    live,
    startWriter,
    startLedger,
    saveBarrier,
    notifications
  };
}

describe("useLongWritingOrchestrator", () => {
  it("fills a partial triplet, waits for approval barriers, then serially advances", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());

    expect(test.startWriter).toHaveBeenCalledTimes(1);
    expect(test.startWriter).toHaveBeenCalledWith(
      "longbook_test",
      expect.objectContaining({
        chapterCardId: "chapter_one",
        missingFiles: ["handoff"]
      }),
      expect.objectContaining({ isCurrent: expect.any(Function) })
    );
    expect(test.startLedger).not.toHaveBeenCalled();

    test.live.set(
      "chapter_one",
      readiness("chapter_one", "ready_to_commit")
    );
    await test.controller.handleApplied(
      appliedEvent("long.chapter_write_proposal", "chapter_one")
    );
    expect(test.saveBarrier).toHaveBeenCalledTimes(1);
    expect(test.startLedger).toHaveBeenLastCalledWith(
      "longbook_test",
      expect.objectContaining({ chapterCardId: "chapter_one" }),
      expect.objectContaining({ isCurrent: expect.any(Function) })
    );

    await test.controller.handleApplied(
      appliedEvent("long.ledger_commit_proposal", "chapter_one")
    );
    expect(test.controller.state.value.currentIndex).toBe(1);
    expect(test.startWriter).toHaveBeenCalledTimes(1);
    expect(test.startLedger).toHaveBeenLastCalledWith(
      "longbook_test",
      expect.objectContaining({ chapterCardId: "chapter_two" }),
      expect.objectContaining({ isCurrent: expect.any(Function) })
    );

    await test.controller.handleApplied(
      appliedEvent("long.ledger_commit_proposal", "chapter_two")
    );
    expect(test.controller.state.value.phase).toBe("complete");
    expect(test.notifications.success).toHaveBeenCalledWith(
      "本次长篇串行写作计划已全部完成。"
    );
  });

  it("stops on a failed save barrier and retries the same chapter without skipping", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());
    test.live.set(
      "chapter_one",
      readiness("chapter_one", "ready_to_commit")
    );
    test.saveBarrier.mockResolvedValueOnce(false);

    await test.controller.handleApplied(
      appliedEvent("long.chapter_write_proposal", "chapter_one")
    );
    expect(test.controller.state.value).toMatchObject({
      currentIndex: 0,
      phase: "error",
      retryPoint: "after_write"
    });
    expect(test.startLedger).not.toHaveBeenCalled();

    test.saveBarrier.mockResolvedValueOnce(true);
    await test.controller.retry();
    expect(test.controller.state.value).toMatchObject({
      currentIndex: 0,
      phase: "awaiting_ledger_approval"
    });
    expect(test.startLedger).toHaveBeenCalledWith(
      "longbook_test",
      expect.objectContaining({ chapterCardId: "chapter_one" }),
      expect.objectContaining({ isCurrent: expect.any(Function) })
    );
  });

  it("refuses to start the ledger when the post-write check returns another chapter", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());
    test.live.set(
      "chapter_one",
      readiness("chapter_two", "ready_to_commit")
    );

    expect(
      await test.controller.handleApplied(
        appliedEvent("long.chapter_write_proposal", "chapter_one")
      )
    ).toBe(true);

    expect(test.controller.state.value).toMatchObject({
      currentIndex: 0,
      phase: "error",
      retryPoint: "after_write",
      error: "章节三件套保存检查返回了错误的章卡。"
    });
    expect(test.startLedger).not.toHaveBeenCalled();
  });

  it("does not advance when a different chapter proposal is approved", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());

    expect(
      await test.controller.handleApplied(
        appliedEvent("long.chapter_write_proposal", "chapter_two")
      )
    ).toBe(false);
    expect(test.saveBarrier).not.toHaveBeenCalled();
    expect(test.controller.state.value.currentIndex).toBe(0);
  });

  it("turns a rejected current proposal into a retryable same-chapter stop", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());
    expect(
      test.controller.handleRejected(
        appliedEvent("long.chapter_write_proposal", "chapter_one")
      )
    ).toBe(true);
    expect(test.controller.state.value).toMatchObject({
      currentIndex: 0,
      phase: "error",
      retryPoint: "check"
    });
    expect(test.startLedger).not.toHaveBeenCalled();
  });

  it("turns an asynchronous writer failure into a retry without advancing", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());
    expect(
      test.controller.handleRunFailure(
        "expert_section_writer",
        "模型连接中断"
      )
    ).toBe(true);
    expect(test.controller.state.value).toMatchObject({
      currentIndex: 0,
      phase: "error",
      retryPoint: "check"
    });
    expect(test.startLedger).not.toHaveBeenCalled();
  });

  it("cancels an error state and ignores late proposal progress", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());
    expect(
      test.controller.handleRejected(
        appliedEvent("long.chapter_write_proposal", "chapter_one")
      )
    ).toBe(true);
    expect(test.controller.active.value).toBe(true);

    test.controller.cancel();

    expect(test.controller.active.value).toBe(false);
    expect(test.controller.state.value).toMatchObject({
      bookId: null,
      phase: "idle",
      currentIndex: 0
    });
    expect(
      await test.controller.handleApplied(
        appliedEvent("long.chapter_write_proposal", "chapter_one")
      )
    ).toBe(false);
    await test.controller.retry();
    expect(test.startLedger).not.toHaveBeenCalled();
  });

  it("invalidates a writer start that is still waiting on asynchronous preflight", async () => {
    const test = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acceptedStarts = 0;
    test.startWriter.mockImplementation(
      async (
        _bookId: string,
        _readiness: LongChapterReadiness,
        guard: LongWritingRunGuard
      ) => {
        await gate;
        if (guard.isCurrent()) acceptedStarts += 1;
      }
    );

    const dispatch = test.controller.startDispatch(dispatchEvent());
    await vi.waitFor(() => {
      expect(test.startWriter).toHaveBeenCalledTimes(1);
    });
    test.controller.cancel();
    release();
    await dispatch;

    expect(acceptedStarts).toBe(0);
    expect(test.controller.state.value.phase).toBe("idle");
  });

  it("invalidates a ledger start that is still waiting on asynchronous preflight", async () => {
    const test = harness();
    test.live.set(
      "chapter_one",
      readiness("chapter_one", "ready_to_commit")
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acceptedStarts = 0;
    test.startLedger.mockImplementation(
      async (
        _bookId: string,
        _readiness: LongChapterReadiness,
        guard: LongWritingRunGuard
      ) => {
        await gate;
        if (guard.isCurrent()) acceptedStarts += 1;
      }
    );

    const dispatch = test.controller.startDispatch(dispatchEvent());
    await vi.waitFor(() => {
      expect(test.startLedger).toHaveBeenCalledTimes(1);
    });
    test.controller.cancel();
    release();
    await dispatch;

    expect(acceptedStarts).toBe(0);
    expect(test.controller.state.value.phase).toBe("idle");
  });

  it("only permits the exact current plan session, run, phase, agent, and chapter", async () => {
    const test = harness();
    await test.controller.startDispatch(dispatchEvent());
    const writerExpectation = {
      bookId: "longbook_test",
      chapterCardId: "chapter_one",
      agentId: "expert_section_writer" as const,
      sessionId: "session-current",
      runId: "run-current"
    };
    const permits = (event: LongWorkspaceProposalEvent) =>
      canApproveLongWritingProposal({
        active: test.controller.active.value,
        state: test.controller.state.value,
        currentChapter: test.controller.currentChapter.value,
        expectation: writerExpectation,
        event
      });

    expect(permits(approvalProposal("long.chapter_write_proposal"))).toBe(
      true
    );
    expect(
      permits(
        approvalProposal("long.chapter_write_proposal", {
          bookId: "longbook_other"
        })
      )
    ).toBe(false);
    expect(
      permits(
        approvalProposal("long.chapter_write_proposal", {
          sessionId: "session-old"
        })
      )
    ).toBe(false);
    expect(
      permits(
        approvalProposal("long.chapter_write_proposal", {
          runId: "run-old"
        })
      )
    ).toBe(false);
    expect(
      permits(
        approvalProposal("long.chapter_write_proposal", {
          agentId: "continuity_ledger"
        })
      )
    ).toBe(false);
    expect(
      permits(
        approvalProposal("long.chapter_write_proposal", {
          chapterCardId: "chapter_two"
        })
      )
    ).toBe(false);
    expect(permits(approvalProposal("long.ledger_commit_proposal"))).toBe(
      false
    );
    expect(permits(dispatchEvent())).toBe(false);

    test.live.set(
      "chapter_one",
      readiness("chapter_one", "ready_to_commit")
    );
    await test.controller.handleApplied(
      appliedEvent("long.chapter_write_proposal", "chapter_one")
    );
    expect(
      canApproveLongWritingProposal({
        active: test.controller.active.value,
        state: test.controller.state.value,
        currentChapter: test.controller.currentChapter.value,
        expectation: {
          ...writerExpectation,
          agentId: "continuity_ledger"
        },
        event: approvalProposal("long.ledger_commit_proposal")
      })
    ).toBe(true);
  });
});
