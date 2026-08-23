import {
  describe,
  documentExecutor,
  expect,
  file,
  it,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitFileId,
  longTools,
  toolByName,
  twoWrittenChaptersIndex
} from "./long-agent-tools.test-support";

function writtenChapterDocuments(
  index: ReturnType<typeof twoWrittenChaptersIndex>
) {
  const chapter = index.chapters[0]!;
  return {
    chapter,
    contents: {
      [chapter.body.id]: "正文已写完。",
      [chapter.characterState.id]: "章末状态。",
      [chapter.handoff.id]: "接续下一章。"
    }
  };
}

describe("unified long-form tools: ledger", () => {
  it("commits continuity for a written chapter when no foreshadowing candidates exist", async () => {
    const index = twoWrittenChaptersIndex();
    const { contents } = writtenChapterDocuments(index);
    const tools = longTools({
      executor: documentExecutor(index, contents),
      activeRoot: "continuity_ledger",
      activeChapterCardId: "chapter_one",
      index
    });
    const result = await toolByName(tools, "propose_continuity_commit").execute(
      "commit",
      {
        summary: "登记第一章连续性",
        foreshadowing_touchpoint_decisions: []
      }
    );
    expect(result.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      agentId: "long",
      input: expect.objectContaining({
        chapterCardId: "chapter_one",
        mode: "text_files"
      })
    });
  });

  it("commits from the draft root when the live index is newer than send-time context", async () => {
    const frozen = twoWrittenChaptersIndex();
    const live = LongWorkspaceIndexSnapshotSchema.parse({
      ...frozen,
      revision: frozen.revision + 5,
      updatedAt: "2026-07-26T13:00:00.000Z"
    });
    const { contents } = writtenChapterDocuments(live);
    const tools = longTools({
      executor: documentExecutor(live, contents, 16),
      activeRoot: "draft",
      activeChapterCardId: "chapter_one",
      index: frozen
    });
    const result = await toolByName(tools, "propose_continuity_commit").execute(
      "commit",
      {
        chapter_card_id: "chapter_one",
        summary: "在正文处登记第一章连续性",
        foreshadowing_touchpoint_decisions: []
      }
    );
    expect(result.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: expect.objectContaining({
        chapterCardId: "chapter_one",
        baseWorkspaceRevision: live.revision,
        baseProjectRevision: 16
      })
    });
  });

  it("still rejects a commit when the live ledger prefix has changed", async () => {
    const frozen = twoWrittenChaptersIndex();
    const live = LongWorkspaceIndexSnapshotSchema.parse({
      ...frozen,
      revision: frozen.revision + 1,
      updatedAt: "2026-07-26T13:00:00.000Z",
      chapters: frozen.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, commitId: "commit_one" } : chapter
      ),
      ledger: {
        committedThroughChapterId: "chapter_one",
        commits: [
          {
            id: "commit_one",
            mode: "text_files",
            sequence: 1,
            chapterCardId: "chapter_one",
            committedAt: "2026-07-26T13:00:00.000Z",
            reversible: true,
            sourceRevision: frozen.revision,
            placementIds: [],
            foreshadowingBeatIds: [],
            recordFile: file(
              longLedgerCommitFileId("commit_one"),
              "long/ledger/commit-one.json"
            )
          }
        ]
      }
    });
    const { contents } = writtenChapterDocuments(live);
    const tools = longTools({
      executor: documentExecutor(live, contents, 12),
      activeRoot: "draft",
      activeChapterCardId: "chapter_two",
      index: frozen
    });
    await expect(
      toolByName(tools, "propose_continuity_commit").execute("commit", {
        chapter_card_id: "chapter_two",
        summary: "登记第二章连续性",
        foreshadowing_touchpoint_decisions: []
      })
    ).rejects.toThrow(
      "Long workspace context no longer matches the loaded workspace index."
    );
  });
});
