import {
  SystemEventEnvelopeSchema,
  chapterEvent,
  characterWriteEvent,
  continuityWriteEvent,
  createEnvelope,
  describe,
  dispatchEvent,
  emptyImpact,
  envelopeContext,
  expect,
  fileRevision,
  harness,
  it,
  ledgerAudit,
  ledgerEvent,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  mutationEvent,
  proposalBase,
  runtime,
  systemEvent,
  textFilesLedgerEvent,
  useLongWorkspaceProposals,
  vi,
  worldbuildingFileEvent,
  worldbuildingWriteEvent,
} from "./useLongWorkspaceProposals.test-support";
import type {
  LongMutationProposalEvent,
  LongWorkspaceOperationBatch,
  LongWorkspaceRendererApi,
  SystemEventEnvelope,
} from "./useLongWorkspaceProposals.test-support";

describe("long workspace proposal approval: quarantine-deduplication-and-finalization", () => {
  it("deduplicates a replayed tool proposal even when it has a new envelope id", async () => {
      const test = harness();
      const original = ledgerEvent();
      const replay = systemEvent({
        ...original,
        id: "event_ledger_replayed"
      });

      expect(await test.controller.handleEvent(original)).toBe(true);
      expect(await test.controller.handleEvent(replay)).toBe(false);

      expect(test.commitChapter).toHaveBeenCalledTimes(1);
      expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
    });

  it("quarantines a removed book and rejects late proposal events", async () => {
      const test = harness();
      await test.controller.handleEvent(mutationEvent());
      expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);

      test.controller.discardBook("longbook_test");
      expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
      expect(await test.controller.handleEvent(dispatchEvent())).toBe(false);
      expect(test.controller.itemsForBook("longbook_test")).toEqual([]);

      test.controller.activateBook("longbook_test");
      expect(await test.controller.handleEvent(dispatchEvent())).toBe(true);
      expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);
    });

  it("quarantines a canceled session, removes queued proposals, and rejects late ones", async () => {
      const test = harness();
      await test.controller.handleEvent(dispatchEvent());
      expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);

      test.controller.quarantineSession(
        "longbook_test",
        envelopeContext.sessionId
      );
      expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
      expect(await test.controller.handleEvent(dispatchEvent())).toBe(false);
      expect(test.controller.itemsForBook("longbook_test")).toEqual([]);

      const originalDispatchEvent = dispatchEvent();
      const otherSessionEvent = systemEvent({
        ...originalDispatchEvent,
        id: "event_dispatch_other_session",
        context: {
          ...originalDispatchEvent.context,
          sessionId: "session_long_other"
        },
        payload: {
          ...originalDispatchEvent.payload,
          sessionId: "session_long_other",
          toolCallId: "tool_dispatch_other_session"
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

  it("routes chapter drafts away and finalizes continuity on its dedicated API", async () => {
      const test = harness();
      expect(await test.controller.handleEvent(chapterEvent())).toBe(false);
      await test.controller.handleEvent(ledgerEvent());

      expect(test.writeChapter).not.toHaveBeenCalled();
      expect(test.commitChapter).toHaveBeenCalledWith(
        expect.objectContaining({ chapterCardId: "chapter_one" })
      );
      expect(test.onApplied).toHaveBeenCalledTimes(1);
      expect(test.notifications.error).not.toHaveBeenCalled();
    });

  it("waits for file approval before running hidden continuity finalization", async () => {
      const test = harness();
      test.previewOperations.mockImplementation(async ({ batch }) => ({
        bookId: proposalBase.bookId,
        preview: {
          baseRevision: batch.baseRevision,
          resultRevision: batch.baseRevision + 1,
          impact: emptyImpact,
          entityChanges: [],
          fileIntents: [],
          documentWrites: batch.documentWrites,
          provisionalIdMap: {}
        },
        projectRevision: 13
      }));
      await test.controller.handleEvent(continuityWriteEvent());
      await test.controller.handleEvent(ledgerEvent());

      expect(test.commitChapter).not.toHaveBeenCalled();
      expect(test.controller.itemsForBook("longbook_test")).toHaveLength(1);

      await test.controller.approve(
        "longbook_test",
        "event_continuity_file"
      );

      expect(test.notifications.error).not.toHaveBeenCalled();
      expect(test.commitChapter).toHaveBeenCalledTimes(1);
      expect(test.onApplied).toHaveBeenCalledTimes(2);
      expect(test.onApplied).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "long.ledger_commit_proposal" })
      );
      expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
        { status: "accepted" }
      ]);
    });

  it("does not turn a post-write refresh failure into a retryable write", async () => {
      const test = harness();
      test.onApplied.mockRejectedValueOnce(new Error("刷新超时"));
      await test.controller.handleEvent(ledgerEvent());

      expect(test.commitChapter).toHaveBeenCalledTimes(1);
      expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
      expect(test.notifications.success).toHaveBeenCalledWith(
        "本章连续性文件已完成归档。"
      );
      expect(test.notifications.warning).toHaveBeenCalledWith(
        "连续性文件已经归档，但后续刷新失败：刷新超时"
      );
      expect(test.notifications.error).not.toHaveBeenCalled();

      await test.controller.handleEvent(ledgerEvent());
      expect(test.commitChapter).toHaveBeenCalledTimes(1);
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
