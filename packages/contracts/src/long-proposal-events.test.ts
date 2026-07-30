import { describe, expect, it } from "vitest";
import {
  LongChapterWriteProposalEventEnvelopeSchema,
  LongChapterDispatchProposalEventEnvelopeSchema,
  LongLedgerCommitProposalEventEnvelopeSchema,
  LongMutationProposalEventEnvelopeSchema,
  LongWorldbuildingFileProposalEventEnvelopeSchema,
  SystemEventEnvelopeSchema,
  createEnvelope,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId
} from "./index";

const runtime = {
  provider: "deepwrite",
  model: "proposal-test",
  mode: "local-faux" as const
};
const context = {
  sessionId: "session-long-proposal",
  runId: "run-long-proposal",
  resourceId: "longbook_proposal"
};
const common = {
  sessionId: context.sessionId,
  runId: context.runId,
  toolCallId: "tool-long-proposal",
  bookId: "longbook_proposal",
  agentId: "worldbuilding" as const,
  summary: "形成待审阅提案。",
  runtime
};
const revision = "v1:0:00000000";
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

describe("long proposal event contracts", () => {
  it("accepts independent mutation, chapter-write and ledger-commit events", () => {
    const mutation = createEnvelope(
      "long.mutation_proposal",
      {
        ...common,
        batch: {
          baseRevision: 7,
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [
            {
              type: "worldbuilding.update" as const,
              id: "world_rules",
              patch: { title: "世界硬规则" }
            }
          ],
          documentWrites: []
        },
        baseProjectRevision: 11
      },
      { id: "event-long-mutation", context }
    );
    const chapter = createEnvelope(
      "long.chapter_write_proposal",
      {
        ...common,
        agentId: "expert_section_writer" as const,
        input: {
          bookId: common.bookId,
          chapterCardId: "chapter_one",
          body: { content: "正文", baseRevision: revision },
          characterState: { content: "人物状态", baseRevision: revision },
          handoff: { content: "下一章交接", baseRevision: revision },
          baseWorkspaceRevision: 7,
          baseProjectRevision: 11
        }
      },
      { id: "event-long-chapter", context }
    );
    const worldbuildingFile = createEnvelope(
      "long.worldbuilding_file_proposal",
      {
        ...common,
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
                  id: longWorldbuildingItemFileId("worlditem_memory"),
                  path: longWorldbuildingItemContentPath(
                    "world_rules",
                    "worlditem_memory"
                  ),
                  revision,
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
            fileId: longWorldbuildingItemFileId("worlditem_memory"),
            filePath: longWorldbuildingItemContentPath(
              "world_rules",
              "worlditem_memory"
            ),
            title: "记忆代价",
            operation: "create" as const,
            beforeText: "",
            afterText: "",
            beforeRevision: null,
            nextRevision: revision
          }
        ]
      },
      { id: "event-long-worldbuilding-file", context }
    );
    const dispatch = createEnvelope(
      "long.chapter_dispatch_proposal",
      {
        ...common,
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
      { id: "event-long-dispatch", context }
    );
    const ledger = createEnvelope(
      "long.ledger_commit_proposal",
      {
        ...common,
        agentId: "continuity_ledger" as const,
        input: {
          bookId: common.bookId,
          chapterCardId: "chapter_one",
          chapterFileRevisions: {
            body: revision,
            characterState: revision,
            handoff: revision
          },
          placementDecisions: {},
          foreshadowingBeatDecisions: {},
          fileUpdates: [],
          ...ledgerAudit,
          baseWorkspaceRevision: 7,
          baseProjectRevision: 11
        }
      },
      { id: "event-long-ledger", context }
    );

    expect(LongMutationProposalEventEnvelopeSchema.parse(mutation).payload)
      .toMatchObject({
        bookId: "longbook_proposal",
        baseProjectRevision: 11
      });
    expect(
      LongWorldbuildingFileProposalEventEnvelopeSchema.parse(
        worldbuildingFile
      ).payload
    ).toMatchObject({
      bookId: "longbook_proposal",
      files: [
        {
          title: "记忆代价",
          operation: "create",
          beforeRevision: null
        }
      ]
    });
    expect(LongChapterWriteProposalEventEnvelopeSchema.parse(chapter).payload.input)
      .toMatchObject({
        chapterCardId: "chapter_one",
        body: { content: "正文" }
      });
    expect(
      LongChapterDispatchProposalEventEnvelopeSchema.parse(dispatch).payload
    ).toMatchObject({
      chapterCardId: "chapter_one",
      title: "第一章",
      scope: "chapter",
      chapters: [
        expect.objectContaining({
          chapterCardId: "chapter_one",
          status: "empty"
        })
      ],
      workspaceRevision: 7,
      projectRevision: 11
    });
    expect(LongLedgerCommitProposalEventEnvelopeSchema.parse(ledger).payload.input)
      .toMatchObject({
        chapterCardId: "chapter_one",
        fileUpdates: []
      });
    expect([mutation, worldbuildingFile, dispatch, chapter, ledger].map(
      (event) => SystemEventEnvelopeSchema.parse(event).type
    )).toEqual([
      "long.mutation_proposal",
      "long.worldbuilding_file_proposal",
      "long.chapter_dispatch_proposal",
      "long.chapter_write_proposal",
      "long.ledger_commit_proposal"
    ]);
  });

  it("rejects context mismatch and nested inputs for another book", () => {
    const chapter = createEnvelope(
      "long.chapter_write_proposal",
      {
        ...common,
        agentId: "expert_section_writer" as const,
        input: {
          bookId: "longbook_other",
          chapterCardId: "chapter_one",
          body: { content: "", baseRevision: revision },
          characterState: { content: "", baseRevision: revision },
          handoff: { content: "", baseRevision: revision },
          baseWorkspaceRevision: 7,
          baseProjectRevision: 11
        }
      },
      { id: "event-long-chapter-other", context }
    );
    expect(() =>
      LongChapterWriteProposalEventEnvelopeSchema.parse(chapter)
    ).toThrow(/proposal book/u);

    const ledger = createEnvelope(
      "long.ledger_commit_proposal",
      {
        ...common,
        agentId: "continuity_ledger" as const,
        input: {
          bookId: common.bookId,
          chapterCardId: "chapter_one",
          chapterFileRevisions: {
            body: revision,
            characterState: revision,
            handoff: revision
          },
          placementDecisions: {},
          foreshadowingBeatDecisions: {},
          fileUpdates: [],
          ...ledgerAudit,
          baseWorkspaceRevision: 7,
          baseProjectRevision: 11
        }
      },
      {
        id: "event-long-ledger-bad-context",
        context: {
          ...context,
          runId: "run-other"
        }
      }
    );
    expect(() =>
      LongLedgerCommitProposalEventEnvelopeSchema.parse(ledger)
    ).toThrow(/runId must match/u);
  });
});
