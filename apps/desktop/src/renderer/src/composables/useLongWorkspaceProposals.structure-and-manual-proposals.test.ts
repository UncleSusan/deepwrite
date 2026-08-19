import {
  SystemEventEnvelopeSchema,
  chapterEvent,
  describe,
  dispatchEvent,
  emptyImpact,
  expect,
  harness,
  it,
  ledgerEvent,
  mutationEvent,
  proposalBase,
  vi
} from "./useLongWorkspaceProposals.test-support";

describe("long workspace proposal approval: structure-and-manual-proposals", () => {
  it("queues same-run mutation proposals and rebases the next one after approval", async () => {
    const test = harness();
    const first = mutationEvent();
    const second = mutationEvent({
      id: "event_mutation_second",
      toolCallId: "tool_long_second",
      title: "世界法则"
    });

    await test.controller.handleEvent(first);
    await test.controller.handleEvent(second);

    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      { status: "ready", event: { id: "event_mutation" } },
      { status: "waiting", event: { id: "event_mutation_second" } }
    ]);

    await test.controller.approve("longbook_test", "event_mutation");

    expect(test.controller.itemsForBook("longbook_test")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "accepted",
          event: expect.objectContaining({ id: "event_mutation" })
        }),
        expect.objectContaining({
          status: "ready",
          event: expect.objectContaining({ id: "event_mutation_second" }),
          effectiveBatch: expect.objectContaining({ baseRevision: 9 }),
          effectiveProjectRevision: 13
        })
      ])
    );
  });

  it("marks deterministic preview validation failures as non-retryable", async () => {
    const test = harness();
    test.previewOperations.mockRejectedValueOnce(
      new Error(
        "long.operation.invalid_reference: Target chapter volume and primary arc must match."
      )
    );

    await test.controller.handleEvent(mutationEvent());

    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "error",
        errorPhase: "preview",
        errorRetryable: false,
        error: expect.stringContaining("long.operation.invalid_reference")
      }
    ]);
    expect(test.applyOperations).not.toHaveBeenCalled();
  });

  it("keeps chapter drafts out of the legacy long queue and routes the remaining proposal types", async () => {
    const chapter = harness(true, "auto-approve");
    expect(await chapter.controller.handleEvent(chapterEvent())).toBe(false);
    expect(chapter.writeChapter).not.toHaveBeenCalled();

    const ledger = harness(true, "auto-approve");
    await ledger.controller.handleEvent(ledgerEvent());
    expect(ledger.commitChapter).toHaveBeenCalledTimes(1);
    expect(ledger.onApplied).toHaveBeenCalledTimes(1);
    expect(ledger.notifications.error).not.toHaveBeenCalled();
    expect(ledger.controller.itemsForBook("longbook_test")).toEqual([]);

    const dispatch = harness(true, "auto-approve");
    await dispatch.controller.handleEvent(dispatchEvent());
    expect(dispatch.onDispatchApproved).toHaveBeenCalledTimes(1);
  });

  it("serializes realtime durable writes for the same long book", async () => {
    const test = harness(true, "auto-approve");
    const order: string[] = [];
    let releaseMutation!: () => void;
    test.applyOperations.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          order.push("mutation:start");
          releaseMutation = () => {
            order.push("mutation:end");
            resolve(undefined);
          };
        })
    );
    test.commitChapter.mockImplementationOnce(async () => {
      order.push("ledger");
      return undefined;
    });

    const mutation = test.controller.handleEvent(mutationEvent());
    const ledger = test.controller.handleEvent(ledgerEvent());
    await vi.waitFor(() => {
      expect(order).toEqual(["mutation:start"]);
    });
    expect(test.commitChapter).not.toHaveBeenCalled();

    releaseMutation();
    await Promise.all([mutation, ledger]);

    expect(order).toEqual(["mutation:start", "mutation:end", "ledger"]);
  });

  it("previews structure impact before apply and binds expected impact", async () => {
    const test = harness();
    await test.controller.handleEvent(mutationEvent());

    expect(test.previewOperations).toHaveBeenCalledTimes(1);
    expect(test.applyOperations).not.toHaveBeenCalled();
    expect(test.controller.itemsForBook("longbook_test")[0]).toMatchObject({
      status: "ready",
      previewProjectRevision: 13
    });

    await test.controller.approve("longbook_test", "event_mutation");

    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 9,
        expectedImpact: emptyImpact
      }),
      baseProjectRevision: 13
    });
    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "accepted",
        event: { type: "long.mutation_proposal" }
      }
    ]);
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
      batch: expect.objectContaining({
        ...event.payload.batch,
        baseRevision: 9
      })
    });
    expect(test.controller.itemsForBook("longbook_test")[0]).toMatchObject({
      event: { id: event.id },
      status: "ready",
      previewProjectRevision: 13
    });

    await test.controller.approve("longbook_test", event.id);

    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 9,
        expectedImpact: emptyImpact
      }),
      baseProjectRevision: 13
    });
    expect(test.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "long.mutation_proposal",
        payload: expect.objectContaining({ bookId: "longbook_test" })
      })
    );
    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "accepted",
        event: { id: event.id, type: "long.mutation_proposal" }
      }
    ]);
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
      agentId: "setting",
      batch: mutationEvent().payload.batch,
      baseProjectRevision: 11,
      summary: "第二次手工调整"
    });

    expect(second.id).not.toBe(first.id);
    expect(second.payload.sessionId).not.toBe(first.payload.sessionId);
    expect(second.payload.runId).not.toBe(first.payload.runId);
    expect(second.payload.toolCallId).not.toBe(first.payload.toolCallId);
    expect(second.payload.agentId).toBe("setting");
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

  it("keeps internal continuity finalization out of the review queue", async () => {
    const ignored = harness(false);
    expect(await ignored.controller.handleEvent(ledgerEvent())).toBe(false);
    expect(ignored.controller.itemsForBook("longbook_test")).toEqual([]);

    const test = harness();
    await test.controller.handleEvent(ledgerEvent());

    expect(test.commitChapter).toHaveBeenCalledTimes(1);
    expect(test.onRejected).not.toHaveBeenCalled();
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
  });
});
