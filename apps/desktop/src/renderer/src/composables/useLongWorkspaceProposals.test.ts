import { describe, expect, it, vi } from "vitest";
import {
  SystemEventEnvelopeSchema,
  createEnvelope,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  type LongWorkspaceOperationBatch,
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

function worldbuildingFileEvent() {
  const fileId = longWorldbuildingItemFileId("worlditem_memory");
  const filePath = longWorldbuildingItemContentPath(
    "world_rules",
    "worlditem_memory"
  );
  return systemEvent(
    createEnvelope(
      "long.worldbuilding_file_proposal",
      {
        ...proposalBase,
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [
            {
              type: "worldbuildingItem.create" as const,
              categoryId: "world_rules",
              item: {
                id: "worlditem_memory",
                title: "记忆代价",
                order: 1,
                file: {
                  id: fileId,
                  path: filePath,
                  revision: fileRevision,
                  updatedAt: "2026-07-26T12:00:00.000Z"
                }
              }
            }
          ],
          documentWrites: []
        },
        baseProjectRevision: 11,
        files: [
          {
            categoryId: "world_rules",
            itemId: "worlditem_memory",
            fileId,
            filePath,
            title: "记忆代价",
            operation: "create" as const,
            beforeText: "",
            afterText: "",
            beforeRevision: null,
            nextRevision: fileRevision
          }
        ]
      },
      { id: "event_worldbuilding_file", context: envelopeContext }
    )
  );
}

function worldbuildingWriteEvent() {
  const fileId = longWorldbuildingItemFileId("worlditem_memory");
  const filePath = longWorldbuildingItemContentPath(
    "world_rules",
    "worlditem_memory"
  );
  return systemEvent(
    createEnvelope(
      "long.worldbuilding_file_proposal",
      {
        ...proposalBase,
        toolCallId: "tool_worldbuilding_write",
        summary: "写入记忆代价",
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:01.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_worlditem_memory_write",
              fileId,
              content: "每次施法都会遗忘一段记忆。",
              mode: "replace" as const,
              expectedRevision: fileRevision,
              nextRevision: "v1:4:11111111",
              updatedAt: "2026-07-26T12:00:01.000Z",
              reason: "写入记忆代价"
            }
          ]
        },
        baseProjectRevision: 11,
        files: [
          {
            categoryId: "world_rules",
            itemId: "worlditem_memory",
            fileId,
            filePath,
            title: "记忆代价",
            operation: "write" as const,
            beforeText: "",
            afterText: "每次施法都会遗忘一段记忆。",
            beforeRevision: fileRevision,
            nextRevision: "v1:4:11111111"
          }
        ]
      },
      { id: "event_worldbuilding_write", context: envelopeContext }
    )
  );
}

function characterWriteEvent() {
  const fileId = longCharacterCoreProfileFileId("character_lan");
  const filePath = longCharacterFilePath(
    "character_lan",
    "core-profile.md"
  );
  return systemEvent(
    createEnvelope(
      "long.character_file_proposal",
      {
        ...proposalBase,
        agentId: "character_design" as const,
        toolCallId: "tool_character_write",
        summary: "写入林岚核心档案",
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:01.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_character_lan_core",
              fileId,
              content: "雾港巡夜人。",
              mode: "replace" as const,
              expectedRevision: fileRevision,
              nextRevision: "v1:6:12345678",
              updatedAt: "2026-07-26T12:00:01.000Z",
              reason: "写入林岚核心档案"
            }
          ]
        },
        baseProjectRevision: 11,
        files: [
          {
            characterId: "character_lan",
            characterName: "林岚",
            document: "core_profile" as const,
            fileId,
            filePath,
            title: "林岚 / 核心档案",
            operation: "write" as const,
            beforeText: "",
            afterText: "雾港巡夜人。",
            beforeRevision: fileRevision,
            nextRevision: "v1:6:12345678"
          }
        ]
      },
      { id: "event_character_file", context: envelopeContext }
    )
  );
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

function harness(
  acceptsEvent = true,
  approvalMode: "request-approval" | "auto-approve" = "request-approval"
) {
  const previewOperations = vi.fn(async (_input: {
    bookId: string;
    batch: LongWorkspaceOperationBatch;
  }) => ({
    bookId: proposalBase.bookId,
    preview: {
      baseRevision: 7,
      resultRevision: 8,
      impact: emptyImpact,
      entityChanges: [],
      fileIntents: [],
      documentWrites:
        [] as LongWorkspaceOperationBatch["documentWrites"],
      provisionalIdMap: {}
    },
    projectRevision: 11
  }));
  const applyOperations = vi.fn(async () => undefined);
  const getWorkspaceIndex = vi.fn(async () => ({
    bookId: proposalBase.bookId,
    workspaceIndex: {
      revision: 9,
      worldbuilding: [
        {
          id: "world_rules",
          title: "世界规则",
          order: 1,
          format: "list" as const,
          contentAuthority: "files" as const,
          items: [
            {
              id: "worlditem_existing",
              title: "已有条目",
              order: 1,
              file: {
                id: longWorldbuildingItemFileId("worlditem_existing"),
                path: longWorldbuildingItemContentPath(
                  "world_rules",
                  "worlditem_existing"
                ),
                revision: fileRevision,
                updatedAt: "2026-07-26T11:00:00.000Z"
              }
            }
          ]
        }
      ],
      characterFiles: [
        {
          characterId: "character_lan",
          coreProfile: {
            id: longCharacterCoreProfileFileId("character_lan"),
            path: longCharacterFilePath(
              "character_lan",
              "core-profile.md"
            ),
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          relationships: {
            id: "file_character_lan:relationships",
            path: "long/characters/character_lan/relationships.md",
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          currentState: {
            id: "file_character_lan:current-state",
            path: "long/characters/character_lan/current-state.md",
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          history: {
            id: "file_character_lan:history",
            path: "long/characters/character_lan/history.md",
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          }
        }
      ]
    },
    projectRevision: 13
  }));
  const writeChapter = vi.fn(async () => undefined);
  const commitChapter = vi.fn(async () => undefined);
  const api = {
    getWorkspaceIndex,
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
  const prepareAutoApprove = vi.fn(async () => undefined);
  const controller = useLongWorkspaceProposals({
    api: () => api,
    acceptsEvent: () => acceptsEvent,
    approvalModeForEvent: () => approvalMode,
    prepareAutoApprove,
    onApplied,
    onDispatchApproved,
    onRejected,
    notifications
  });
  return {
    controller,
    getWorkspaceIndex,
    previewOperations,
    applyOperations,
    writeChapter,
    commitChapter,
    onApplied,
    onDispatchApproved,
    onRejected,
    prepareAutoApprove,
    notifications
  };
}

describe("long workspace proposal approval", () => {
  it("previews and applies character file proposals through the same file path", async () => {
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

    await test.controller.handleEvent(characterWriteEvent());

    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "ready",
        event: { type: "long.character_file_proposal" }
      }
    ]);
    await test.controller.approve("longbook_test", "event_character_file");
    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 9,
        documentWrites: [
          expect.objectContaining({
            fileId: longCharacterCoreProfileFileId("character_lan")
          })
        ]
      }),
      baseProjectRevision: 13
    });
    expect(test.notifications.success).toHaveBeenCalledWith(
      "人物文件变更已保存到本地 Markdown。"
    );
  });

  it("waits for an empty-file creation before previewing its separate write", async () => {
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

    await test.controller.handleEvent(worldbuildingFileEvent());
    await test.controller.handleEvent(worldbuildingWriteEvent());

    expect(test.previewOperations).toHaveBeenCalledTimes(1);
    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      { status: "ready" },
      {
        status: "waiting",
        event: { type: "long.worldbuilding_file_proposal" }
      }
    ]);

    expect(
      test.controller.reject(
        "longbook_test",
        "event_worldbuilding_file"
      )
    ).toBe(true);
    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "error",
        error: expect.stringContaining("前序写入已被拒绝")
      }
    ]);
  });

  it("rebases and retains accepted long worldbuilding file cards", async () => {
    const test = harness(true, "auto-approve");
    test.previewOperations.mockImplementationOnce(async ({ batch }) => ({
      bookId: proposalBase.bookId,
      preview: {
        baseRevision: batch.baseRevision,
        resultRevision: batch.baseRevision + 1,
        impact: {
          ...emptyImpact,
          createdEntityIds: ["worlditem_memory"],
          createdFileIds: [
            longWorldbuildingItemFileId("worlditem_memory")
          ]
        },
        entityChanges: [],
        fileIntents: [],
        documentWrites: [],
        provisionalIdMap: {}
      },
      projectRevision: 13
    }));

    await test.controller.handleEvent(worldbuildingFileEvent());

    expect(test.getWorkspaceIndex).toHaveBeenCalledWith({
      bookId: "longbook_test"
    });
    expect(test.previewOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 9,
        operations: [
          expect.objectContaining({
            item: expect.objectContaining({ order: 2 })
          })
        ]
      })
    });
    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 9,
        expectedImpact: expect.objectContaining({
          createdEntityIds: ["worlditem_memory"]
        })
      }),
      baseProjectRevision: 13
    });
    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "accepted",
        event: { type: "long.worldbuilding_file_proposal" }
      }
    ]);
  });

  it("previews and atomically applies auto-approved structure proposals immediately", async () => {
    const test = harness(true, "auto-approve");

    await test.controller.handleEvent(mutationEvent());

    expect(test.previewOperations).toHaveBeenCalledTimes(1);
    expect(test.prepareAutoApprove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "event_mutation" })
    );
    expect(test.applyOperations).toHaveBeenCalledTimes(1);
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
  });

  it("immediately routes every auto-approved long proposal type", async () => {
    const chapter = harness(true, "auto-approve");
    await chapter.controller.handleEvent(chapterEvent());
    expect(chapter.writeChapter).toHaveBeenCalledTimes(1);

    const ledger = harness(true, "auto-approve");
    await ledger.controller.handleEvent(ledgerEvent());
    expect(ledger.commitChapter).toHaveBeenCalledTimes(1);

    const dispatch = harness(true, "auto-approve");
    await dispatch.controller.handleEvent(dispatchEvent());
    expect(dispatch.onDispatchApproved).toHaveBeenCalledTimes(1);
  });

  it("serializes realtime durable writes for the same long book", async () => {
    const test = harness(true, "auto-approve");
    const order: string[] = [];
    let releaseChapter!: () => void;
    test.writeChapter.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          order.push("chapter:start");
          releaseChapter = () => {
            order.push("chapter:end");
            resolve(undefined);
          };
        })
    );
    test.commitChapter.mockImplementationOnce(async () => {
      order.push("ledger");
      return undefined;
    });

    const chapter = test.controller.handleEvent(chapterEvent());
    const ledger = test.controller.handleEvent(ledgerEvent());
    await vi.waitFor(() => {
      expect(order).toEqual(["chapter:start"]);
    });
    expect(test.commitChapter).not.toHaveBeenCalled();

    releaseChapter();
    await Promise.all([chapter, ledger]);

    expect(order).toEqual(["chapter:start", "chapter:end", "ledger"]);
  });

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
      "章节正文证据已写入；正在进入连续性结算。"
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
