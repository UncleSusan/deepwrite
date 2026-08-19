import { describe, expect, it, vi } from "vitest";
import { SystemEventEnvelopeSchema } from "@deepwrite/contracts/system";
import {
  createEnvelope,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
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
  agentId: "setting" as const,
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

function mutationEvent(
  options: {
    id?: string;
    toolCallId?: string;
    title?: string;
  } = {}
): LongMutationProposalEvent {
  return systemEvent(
    createEnvelope(
      "long.mutation_proposal",
      {
        ...proposalBase,
        toolCallId: options.toolCallId ?? proposalBase.toolCallId,
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [
            {
              type: "worldbuilding.update" as const,
              id: "world_rules",
              patch: { title: options.title ?? "世界规则" }
            }
          ],
          documentWrites: []
        },
        baseProjectRevision: 11
      },
      { id: options.id ?? "event_mutation", context: envelopeContext }
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
        agentId: "setting" as const,
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

function continuityWriteEvent() {
  const chapterCardId = "chapter_one";
  const fileId = longChapterForeshadowingChangesFileId(chapterCardId);
  const filePath = longChapterContinuityFilePath(
    chapterCardId,
    "foreshadowing-changes.md"
  );
  return systemEvent(
    createEnvelope(
      "long.continuity_file_proposal",
      {
        ...proposalBase,
        agentId: "continuity_ledger" as const,
        toolCallId: "tool_continuity_write",
        summary: "记录第一章伏笔变化",
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:01.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_chapter_one_foreshadowing",
              fileId,
              content: "本章无伏笔变化。",
              mode: "replace" as const,
              expectedRevision: fileRevision,
              nextRevision: "v1:9:12345678",
              updatedAt: "2026-07-26T12:00:01.000Z",
              reason: "记录第一章伏笔变化"
            }
          ]
        },
        baseProjectRevision: 11,
        files: [
          {
            chapterCardId,
            role: "foreshadowing_changes" as const,
            characterId: null,
            fileId,
            filePath,
            title: "第一章 / 伏笔变化",
            operation: "write" as const,
            beforeText: "",
            afterText: "本章无伏笔变化。",
            beforeRevision: fileRevision,
            nextRevision: "v1:9:12345678"
          }
        ]
      },
      { id: "event_continuity_file", context: envelopeContext }
    )
  );
}

function chapterEvent() {
  return systemEvent(
    createEnvelope(
      "long.chapter_write_proposal",
      {
        ...proposalBase,
        agentId: "draft" as const,
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [],
          documentWrites: [{
            proposalId: "proposal_chapter_one",
            fileId: longChapterBodyFileId("chapter_one"),
            content: "正文",
            mode: "replace" as const,
            expectedRevision: fileRevision,
            nextRevision: "v1:2:12345678",
            updatedAt: "2026-07-26T12:00:00.000Z",
            reason: "完成第一章"
          }]
        },
        baseProjectRevision: 11,
        file: {
          chapterCardId: "chapter_one",
          chapterTitle: "第一章",
          fileId: longChapterBodyFileId("chapter_one"),
          filePath: longChapterFilePath("chapter_one", "body.md"),
          operation: "create" as const,
          beforeText: "",
          afterText: "正文",
          beforeRevision: fileRevision,
          nextRevision: "v1:2:12345678"
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

function textFilesLedgerEvent() {
  return systemEvent(
    createEnvelope(
      "long.ledger_commit_proposal",
      {
        ...proposalBase,
        agentId: "continuity_ledger" as const,
        toolCallId: "tool_text_files_commit",
        input: {
          mode: "text_files" as const,
          bookId: proposalBase.bookId,
          chapterCardId: "chapter_one",
          chapterFileRevisions: { body: fileRevision },
          continuityFileRevisions: [
            {
              fileId: longChapterCharacterStateFileId("chapter_one"),
              revision: fileRevision
            },
            {
              fileId: longChapterHandoffFileId("chapter_one"),
              revision: fileRevision
            }
          ],
          foreshadowingBeatDecisions: {},
          commitMessage: "留存第一章连续性文本",
          baseWorkspaceRevision: 7,
          baseProjectRevision: 11
        }
      },
      { id: "event_text_files_ledger", context: envelopeContext }
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
  }) => {
    structuredClone(_input);
    return {
      bookId: proposalBase.bookId,
      preview: {
        baseRevision: _input.batch.baseRevision,
        resultRevision: _input.batch.baseRevision + 1,
        impact: emptyImpact,
        entityChanges: [],
        fileIntents: [],
        documentWrites:
          [] as LongWorkspaceOperationBatch["documentWrites"],
        provisionalIdMap: {}
      },
      projectRevision: 13
    };
  });
  const applyOperations = vi.fn(async (input: unknown) => {
    structuredClone(input);
    return undefined;
  });
  const getWorkspaceIndex = vi.fn(async () => ({
    bookId: proposalBase.bookId,
    workspaceIndex: {
      bookId: proposalBase.bookId,
      revision: 9,
      characters: [{ id: "character_lan", name: "林岚" }],
      plot: {
        chapterCards: [{ id: "chapter_one", title: "第一章" }]
      },
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
      ],
      chapters: [
        {
          chapterCardId: "chapter_one",
          body: {
            id: longChapterBodyFileId("chapter_one"),
            path: longChapterFilePath("chapter_one", "body.md"),
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          card: {
            id: longChapterCardFileId("chapter_one"),
            path: longChapterFilePath("chapter_one", "card.md"),
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          characterState: {
            id: longChapterCharacterStateFileId("chapter_one"),
            path: longChapterFilePath(
              "chapter_one",
              "character-state.md"
            ),
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          handoff: {
            id: longChapterHandoffFileId("chapter_one"),
            path: longChapterFilePath("chapter_one", "handoff.md"),
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          foreshadowingChanges: {
            id: longChapterForeshadowingChangesFileId("chapter_one"),
            path: longChapterContinuityFilePath(
              "chapter_one",
              "foreshadowing-changes.md"
            ),
            revision: fileRevision,
            updatedAt: "2026-07-26T11:00:00.000Z"
          },
          worldReveals: null,
          characterContinuity: [],
          commitId: null
        }
      ]
    },
    projectRevision: 13
  }));
  const readDocument = vi.fn(
    async ({ bookId, fileId, offset = 0 }: {
      bookId: string;
      fileId: string;
      offset?: number;
    }) => {
      const expectedFileId =
        longChapterForeshadowingChangesFileId("chapter_one");
      if (bookId !== proposalBase.bookId || fileId !== expectedFileId) {
        throw new Error("测试未配置该文档。");
      }
      return {
        bookId,
        file: {
          id: expectedFileId,
          path: longChapterContinuityFilePath(
            "chapter_one",
            "foreshadowing-changes.md"
          ),
          revision: fileRevision,
          updatedAt: "2026-07-26T11:00:00.000Z"
        },
        content: "",
        offset,
        totalCharacters: 0,
        nextOffset: null,
        workspaceRevision: 9,
        projectRevision: 13
      };
    }
  );
  const writeChapter = vi.fn(async () => undefined);
  const commitChapter = vi.fn(async (input: unknown) => {
    structuredClone(input);
  });
  const api = {
    getWorkspaceIndex,
    readDocument,
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
    readDocument,
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

export {
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
};
export type {
  LongMutationProposalEvent,
  LongWorkspaceOperationBatch,
  LongWorkspaceRendererApi,
  SystemEventEnvelope,
};
