import { describe, expect, it, vi } from "vitest";
import {
  SystemEventEnvelopeSchema,
  createEnvelope,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import {
  useLongWorkspaceProposals,
  type LongMutationProposalEvent
} from "./useLongWorkspaceProposals";

const runtime = {
  provider: "deepwrite",
  model: "long-proposal-test",
  mode: "local-faux" as const
};
const envelopeContext = {
  sessionId: "session_long",
  runId: "run_long",
  resourceId: "longbook_test"
};
const proposalBase = {
  sessionId: envelopeContext.sessionId,
  runId: envelopeContext.runId,
  toolCallId: "tool_long",
  bookId: "longbook_test",
  agentId: "worldbuilding" as const,
  summary: "待审阅长篇提案",
  runtime
};
const fileRevision = "v1:0:00000000";
const ledgerAudit = {
  commitMessage: "核验并提交第一章",
  chapterSummary: {
    timeline: "第一天。",
    characterStates: "人物状态。",
    factionStates: "势力状态。",
    realmStates: "境界状态。",
    foreshadowingStates: "伏笔状态。",
    continuityNotes: "连续性说明。"
  }
};
const emptyImpact = {
  createdEntityIds: [] as string[],
  updatedEntityIds: ["world_rules"],
  deletedEntityIds: [] as string[],
  createdFileIds: [] as string[],
  deletedFileIds: [] as string[],
  documentWriteProposalIds: [] as string[]
};

function systemEvent(event: unknown): SystemEventEnvelope {
  return SystemEventEnvelopeSchema.parse(event);
}

function mutationEvent(): LongMutationProposalEvent {
  return systemEvent(
    createEnvelope(
      "long.mutation_proposal",
      {
        ...proposalBase,
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [
            {
              type: "worldbuilding.update" as const,
              id: "world_rules",
              patch: { title: "世界规则" }
            }
          ],
          documentWrites: []
        },
        baseProjectRevision: 11
      },
      { id: "event_mutation", context: envelopeContext }
    )
  ) as LongMutationProposalEvent;
}

function chapterEvent() {
  return systemEvent(
    createEnvelope(
      "long.chapter_write_proposal",
      {
        ...proposalBase,
        agentId: "expert_section_writer" as const,
        input: {
          bookId: proposalBase.bookId,
          chapterCardId: "chapter_one",
          body: { content: "正文", baseRevision: fileRevision },
          characterState: {
            content: "人物状态",
            baseRevision: fileRevision
          },
          handoff: { content: "交接", baseRevision: fileRevision },
          baseWorkspaceRevision: 7,
          baseProjectRevision: 11
        }
      },
      { id: "event_chapter", context: envelopeContext }
    )
  );
}

function ledgerEvent() {
  return systemEvent(
    createEnvelope(
      "long.ledger_commit_proposal",
      {
        ...proposalBase,
        agentId: "continuity_ledger" as const,
        input: {
          bookId: proposalBase.bookId,
          chapterCardId: "chapter_one",
          chapterFileRevisions: {
            body: fileRevision,
            characterState: fileRevision,
            handoff: fileRevision
          },
          placementDecisions: {},
          foreshadowingBeatDecisions: {},
          fileUpdates: [],
          ...ledgerAudit,
          baseWorkspaceRevision: 7,
          baseProjectRevision: 11
        }
      },
      { id: "event_ledger", context: envelopeContext }
    )
  );
}

function dispatchEvent() {
  return systemEvent(
    createEnvelope(
      "long.chapter_dispatch_proposal",
      {
        ...proposalBase,
        agentId: "draft" as const,
        scope: "chapter" as const,
        chapterCardId: "chapter_one",
        title: "第一章",
        chapters: [
          {
            chapterCardId: "chapter_one",
            title: "第一章",
            status: "empty" as const,
            missingFiles: [
              "body" as const,
              "character_state" as const,
              "handoff" as const
            ]
          }
        ],
        workspaceRevision: 7,
        projectRevision: 11
      },
      { id: "event_dispatch", context: envelopeContext }
    )
  );
}

function harness(acceptsEvent = true) {
  const previewOperations = vi.fn(async () => ({
    bookId: proposalBase.bookId,
    preview: {
      baseRevision: 7,
      resultRevision: 8,
      impact: emptyImpact,
      entityChanges: [],
      fileIntents: [],
      documentWrites: [],
      provisionalIdMap: {}
    },
    projectRevision: 11
  }));
  const applyOperations = vi.fn(async () => undefined);
  const writeChapter = vi.fn(async () => undefined);
  const commitChapter = vi.fn(async () => undefined);
  const api = {
    previewOperations,
    applyOperations,
    writeChapter,
    commitChapter
  } as unknown as LongWorkspaceRendererApi;
  const notifications = {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  };
  const onApplied = vi.fn();
  const onDispatchApproved = vi.fn();
  const onRejected = vi.fn();
  const controller = useLongWorkspaceProposals({
    api: () => api,
    acceptsEvent: () => acceptsEvent,
    onApplied,
    onDispatchApproved,
    onRejected,
    notifications
  });
  return {
    controller,
    previewOperations,
    applyOperations,
    writeChapter,
    commitChapter,
    onApplied,
    onDispatchApproved,
    onRejected,
    notifications
  };
}

describe("long workspace proposal approval", () => {
  it("previews structure impact before apply and binds expected impact", async () => {
    const test = harness();
    await test.controller.handleEvent(mutationEvent());

    expect(test.previewOperations).toHaveBeenCalledTimes(1);
    expect(test.applyOperations).not.toHaveBeenCalled();
    expect(test.controller.itemsForBook("longbook_test")[0]).toMatchObject({
      status: "ready",
      previewProjectRevision: 11
    });

    await test.controller.approve("longbook_test", "event_mutation");

    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 7,
        expectedImpact: emptyImpact
      }),
      baseProjectRevision: 11
    });
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
  });

  it("enqueues schema-valid manual mutations through preview and approval", async () => {
    const test = harness(false);
    const event = await test.controller.enqueueManualMutation({
      bookId: proposalBase.bookId,
      batch: mutationEvent().payload.batch,
      baseProjectRevision: 11,
      summary: "手工调整世界观结构"
    });

    expect(SystemEventEnvelopeSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      type: "long.mutation_proposal",
      payload: {
        bookId: "longbook_test",
        agentId: "plot_design",
        summary: "手工调整世界观结构",
        baseProjectRevision: 11,
        runtime: {
          provider: "deepwrite",
          model: "manual-structure-manager",
          mode: "local-faux"
        }
      },
      context: {
        sessionId: event.payload.sessionId,
        runId: event.payload.runId,
        resourceId: "longbook_test"
      }
    });
    expect(test.previewOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: event.payload.batch
    });
    expect(test.controller.itemsForBook("longbook_test")[0]).toMatchObject({
      event: { id: event.id },
      status: "ready",
      previewProjectRevision: 11
    });

    await test.controller.approve("longbook_test", event.id);

    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 7,
        expectedImpact: emptyImpact
      }),
      baseProjectRevision: 11
    });
    expect(test.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "long.mutation_proposal",
        payload: expect.objectContaining({ bookId: "longbook_test" })
      })
    );
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
  });

  it("creates unique manual proposal envelopes and validates their payload", async () => {
    const test = harness();
    const first = await test.controller.enqueueManualMutation({
      bookId: proposalBase.bookId,
      batch: mutationEvent().payload.batch,
      baseProjectRevision: 11,
      summary: "第一次手工调整"
    });
    const second = await test.controller.enqueueManualMutation({
      bookId: proposalBase.bookId,
      agentId: "character_design",
      batch: mutationEvent().payload.batch,
      baseProjectRevision: 11,
      summary: "第二次手工调整"
    });

    expect(second.id).not.toBe(first.id);
    expect(second.payload.sessionId).not.toBe(first.payload.sessionId);
    expect(second.payload.runId).not.toBe(first.payload.runId);
    expect(second.payload.toolCallId).not.toBe(first.payload.toolCallId);
    expect(second.payload.agentId).toBe("character_design");
    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(2);

    await expect(
      test.controller.enqueueManualMutation({
        bookId: proposalBase.bookId,
        batch: mutationEvent().payload.batch,
        baseProjectRevision: 11,
        summary: " "
      })
    ).rejects.toThrow();
    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(2);
    expect(test.previewOperations).toHaveBeenCalledTimes(2);
  });

  it("does not reactivate a discarded book when manual proposal validation fails", async () => {
    const test = harness();
    test.controller.discardBook("longbook_test");

    await expect(
      test.controller.enqueueManualMutation({
        bookId: proposalBase.bookId,
        batch: mutationEvent().payload.batch,
        baseProjectRevision: 11,
        summary: " "
      })
    ).rejects.toThrow();

    expect(await test.controller.handleEvent(ledgerEvent())).toBe(false);
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
    expect(test.previewOperations).not.toHaveBeenCalled();
  });

  it("isolates rejected events and never turns rejection into a write", async () => {
    const ignored = harness(false);
    expect(await ignored.controller.handleEvent(chapterEvent())).toBe(false);
    expect(ignored.controller.itemsForBook("longbook_test")).toEqual([]);

    const test = harness();
    await test.controller.handleEvent(chapterEvent());
    test.controller.reject("longbook_test", "event_chapter");

    expect(test.writeChapter).not.toHaveBeenCalled();
    expect(test.onRejected).toHaveBeenCalledWith(
      expect.objectContaining({ type: "long.chapter_write_proposal" })
    );
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
  });

  it("deduplicates a replayed tool proposal even when it has a new envelope id", async () => {
    const test = harness();
    const original = chapterEvent();
    const replay = systemEvent({
      ...original,
      id: "event_chapter_replayed"
    });

    expect(await test.controller.handleEvent(original)).toBe(true);
    expect(await test.controller.handleEvent(replay)).toBe(false);

    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);
    expect(test.controller.itemsForBook("longbook_test")[0]?.event.id).toBe(
      "event_chapter"
    );
  });

  it("quarantines a removed book and rejects late proposal events", async () => {
    const test = harness();
    await test.controller.handleEvent(chapterEvent());
    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);

    test.controller.discardBook("longbook_test");
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
    expect(await test.controller.handleEvent(ledgerEvent())).toBe(false);
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);

    test.controller.activateBook("longbook_test");
    expect(await test.controller.handleEvent(ledgerEvent())).toBe(true);
    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);
  });

  it("quarantines a canceled session, removes queued proposals, and rejects late ones", async () => {
    const test = harness();
    await test.controller.handleEvent(chapterEvent());
    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);

    test.controller.quarantineSession(
      "longbook_test",
      envelopeContext.sessionId
    );
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
    await test.controller.approve("longbook_test", "event_chapter");
    expect(test.writeChapter).not.toHaveBeenCalled();

    expect(await test.controller.handleEvent(ledgerEvent())).toBe(false);
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);

    const originalLedgerEvent = ledgerEvent();
    const otherSessionEvent = systemEvent({
      ...originalLedgerEvent,
      id: "event_ledger_other_session",
      context: {
        ...originalLedgerEvent.context,
        sessionId: "session_long_other"
      },
      payload: {
        ...originalLedgerEvent.payload,
        sessionId: "session_long_other"
      }
    });
    expect(
      await test.controller.handleEvent(otherSessionEvent)
    ).toBe(true);
    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);
  });

  it("coalesces duplicate preview retries while one retry is in flight", async () => {
    const test = harness();
    test.previewOperations.mockRejectedValueOnce(
      new Error("首次预览失败")
    );
    await test.controller.handleEvent(mutationEvent());
    expect(test.controller.itemsForBook("longbook_test")[0]).toMatchObject({
      status: "error"
    });

    const firstRetry = test.controller.retryPreview(
      "longbook_test",
      "event_mutation"
    );
    const duplicateRetry = test.controller.retryPreview(
      "longbook_test",
      "event_mutation"
    );
    await Promise.all([firstRetry, duplicateRetry]);

    expect(test.previewOperations).toHaveBeenCalledTimes(2);
    expect(test.controller.itemsForBook("longbook_test")[0]).toMatchObject({
      status: "ready"
    });
  });

  it("routes chapter and ledger approvals to their dedicated APIs", async () => {
    const test = harness();
    await test.controller.handleEvent(chapterEvent());
    await test.controller.handleEvent(ledgerEvent());

    await test.controller.approve("longbook_test", "event_chapter");
    await test.controller.approve("longbook_test", "event_ledger");

    expect(test.writeChapter).toHaveBeenCalledWith(
      expect.objectContaining({ chapterCardId: "chapter_one" })
    );
    expect(test.commitChapter).toHaveBeenCalledWith(
      expect.objectContaining({ chapterCardId: "chapter_one" })
    );
    expect(test.onApplied).toHaveBeenCalledTimes(2);
  });

  it("does not let rejection race an in-flight durable approval", async () => {
    const test = harness();
    let releaseWrite!: () => void;
    test.writeChapter.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseWrite = () => resolve(undefined);
        })
    );
    await test.controller.handleEvent(chapterEvent());

    const approval = test.controller.approve(
      "longbook_test",
      "event_chapter"
    );
    await vi.waitFor(() => {
      expect(
        test.controller.itemsForBook("longbook_test")[0]?.status
      ).toBe("submitting");
    });

    expect(
      test.controller.reject("longbook_test", "event_chapter")
    ).toBe(false);
    expect(test.onRejected).not.toHaveBeenCalled();
    expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);

    releaseWrite();
    await approval;

    expect(test.onApplied).toHaveBeenCalledTimes(1);
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
  });

  it("does not turn a post-write refresh failure into a retryable write", async () => {
    const test = harness();
    test.onApplied.mockRejectedValueOnce(new Error("刷新超时"));
    await test.controller.handleEvent(chapterEvent());

    await test.controller.approve("longbook_test", "event_chapter");

    expect(test.writeChapter).toHaveBeenCalledTimes(1);
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
    expect(test.notifications.success).toHaveBeenCalledWith(
      "章节正文、人物状态和 Handoff 已写入。"
    );
    expect(test.notifications.warning).toHaveBeenCalledWith(
      "长篇提案已经写入，但后续刷新失败：刷新超时"
    );
    expect(test.notifications.error).not.toHaveBeenCalled();

    await test.controller.approve("longbook_test", "event_chapter");
    expect(test.writeChapter).toHaveBeenCalledTimes(1);
  });

  it("delegates an approved dispatch to the serial orchestrator without writing directly", async () => {
    const test = harness();
    await test.controller.handleEvent(dispatchEvent());
    await test.controller.approve("longbook_test", "event_dispatch");

    expect(test.onDispatchApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "long.chapter_dispatch_proposal",
        payload: expect.objectContaining({
          chapterCardId: "chapter_one"
        })
      })
    );
    expect(test.applyOperations).not.toHaveBeenCalled();
    expect(test.writeChapter).not.toHaveBeenCalled();
    expect(test.commitChapter).not.toHaveBeenCalled();
    expect(test.onApplied).not.toHaveBeenCalled();
  });
});
