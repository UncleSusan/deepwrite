import { describe, expect, it } from "vitest";
import {
  LongCommitChapterInputSchema,
  LongLedgerCommitRecordSchema
} from "./index";

const record = {
  schemaVersion: 1 as const,
  id: "commit_first",
  bookId: "longbook_alpha",
  sequence: 1,
  chapterCardId: "chapter_one",
  committedAt: "2026-07-26T10:00:00.000Z",
  reversible: true,
  sourceWorkspaceRevision: 3,
  committedWorkspaceRevision: 4,
  sourceProjectRevision: 7,
  committedProjectRevision: 8,
  previousCommittedThroughChapterId: null,
  committedThroughChapterId: "chapter_one",
  previousChapterCommitId: null,
  placementChanges: [
    {
      placementId: "placement_letter",
      before: { status: "planned" as const, commitId: null },
      after: { status: "committed" as const, commitId: "commit_first" }
    }
  ],
  foreshadowingBeatChanges: [],
  fileChanges: [
    {
      fileId: "file_character_alice:current-state",
      path: "long/characters/alice/current-state.md",
      before: { revision: "v1:0:00000000", content: "" },
      after: {
        revision: "v1:1:1234abcd",
        content: "林岚已经收到来信。"
      }
    }
  ]
};

describe("long ledger contracts", () => {
  it("keeps schemaVersion 1 records readable with explicit legacy defaults", () => {
    const parsed = LongLedgerCommitRecordSchema.parse(record);
    expect(parsed.id).toBe("commit_first");
    expect(parsed.commitMessage).toBe("");
    expect(parsed.chapterSummary).toEqual({
      timeline: "",
      characterStates: "",
      factionStates: "",
      realmStates: "",
      foreshadowingStates: "",
      continuityNotes: ""
    });
    expect(parsed.placementChanges[0]?.note).toBe("");
    expect(parsed.foreshadowingThreadChanges).toEqual([]);
  });

  it("round-trips commit message, six summaries, evidence and thread status", () => {
    const chapterSummary = {
      timeline: "第一天雨夜收到旧信。",
      characterStates: "林岚开始怀疑寄信人。",
      factionStates: "守夜人尚未介入。",
      realmStates: "本章无境界变化。",
      foreshadowingStates: "蜡封线索已经种下。",
      continuityNotes: "下一章追查旧邮戳。"
    };
    const input = LongCommitChapterInputSchema.parse({
      bookId: "longbook_alpha",
      chapterCardId: "chapter_one",
      chapterFileRevisions: {
        body: "v1:0:00000000",
        characterState: "v1:0:00000000",
        handoff: "v1:0:00000000"
      },
      commitMessage: "确认雨夜来信章连续性",
      chapterSummary,
      placementDecisions: {
        placement_letter: {
          status: "committed",
          note: "正文明确写出林岚接过旧信。"
        }
      },
      foreshadowingBeatDecisions: {
        beat_letter: {
          status: "committed",
          note: "正文展示了不可熔化的蜡封。"
        }
      },
      fileUpdates: [],
      baseWorkspaceRevision: 3,
      baseProjectRevision: 7
    });
    expect(input.chapterSummary).toEqual(chapterSummary);

    const parsed = LongLedgerCommitRecordSchema.parse({
      ...record,
      commitMessage: input.commitMessage,
      chapterSummary: input.chapterSummary,
      placementChanges: [
        {
          ...record.placementChanges[0],
          note: input.placementDecisions.placement_letter!.note
        }
      ],
      foreshadowingThreadChanges: [
        {
          foreshadowingId: "foreshadow_letter",
          before: "planned",
          after: "open"
        }
      ]
    });
    expect(parsed).toMatchObject({
      commitMessage: "确认雨夜来信章连续性",
      chapterSummary,
      placementChanges: [
        { note: "正文明确写出林岚接过旧信。" }
      ],
      foreshadowingThreadChanges: [
        {
          foreshadowingId: "foreshadow_letter",
          before: "planned",
          after: "open"
        }
      ]
    });
  });

  it("rejects revision skips and decisions assigned to another commit", () => {
    expect(
      LongLedgerCommitRecordSchema.safeParse({
        ...record,
        committedWorkspaceRevision: 5
      }).success
    ).toBe(false);
    expect(
      LongLedgerCommitRecordSchema.safeParse({
        ...record,
        placementChanges: [
          {
            ...record.placementChanges[0],
            after: {
              status: "committed",
              commitId: "commit_other"
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("requires complete audit evidence for new records and commit commands", () => {
    expect(
      LongLedgerCommitRecordSchema.safeParse({
        ...record,
        schemaVersion: 2
      }).success
    ).toBe(false);
    expect(
      LongCommitChapterInputSchema.safeParse({
        bookId: "longbook_alpha",
        chapterCardId: "chapter_one",
        chapterFileRevisions: {
          body: "v1:0:00000000",
          characterState: "v1:0:00000000",
          handoff: "v1:0:00000000"
        },
        placementDecisions: {},
        foreshadowingBeatDecisions: {},
        fileUpdates: [],
        baseWorkspaceRevision: 3,
        baseProjectRevision: 7
      }).success
    ).toBe(false);
  });

  it("rejects duplicate decisions in persisted audit records", () => {
    expect(
      LongLedgerCommitRecordSchema.safeParse({
        ...record,
        placementChanges: [
          record.placementChanges[0],
          record.placementChanges[0]
        ]
      }).success
    ).toBe(false);
  });
});
