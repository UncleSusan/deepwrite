import type { LongWorkspaceOperationBatch } from "./useLongWorkspaceProposals.test-support";
import {
  characterWriteEvent,
  continuityWriteEvent,
  createEnvelope,
  describe,
  emptyImpact,
  envelopeContext,
  expect,
  fileRevision,
  harness,
  it,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longWorldbuildingItemFileId,
  mutationEvent,
  proposalBase,
  systemEvent,
  textFilesLedgerEvent,
  worldbuildingFileEvent,
  worldbuildingWriteEvent
} from "./useLongWorkspaceProposals.test-support";

describe("long workspace proposal approval: file-and-continuity-proposals", () => {
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

  it("previews and saves per-chapter continuity Markdown proposals", async () => {
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

    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "ready",
        event: { type: "long.continuity_file_proposal" }
      }
    ]);
    await test.controller.approve("longbook_test", "event_continuity_file");
    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({
        baseRevision: 9,
        documentWrites: [
          expect.objectContaining({
            fileId: longChapterForeshadowingChangesFileId("chapter_one")
          })
        ]
      }),
      baseProjectRevision: 13
    });
    expect(test.notifications.success).toHaveBeenCalledWith(
      "本章连续性记录已保存到本地 Markdown。"
    );
  });

  it("revalidates each manual file approval after earlier cards advance the project revision", async () => {
    const test = harness();
    const baseSnapshot = await test.getWorkspaceIndex();
    const baseDocument = await test.readDocument({
      bookId: proposalBase.bookId,
      fileId: longChapterForeshadowingChangesFileId("chapter_one"),
      offset: 0
    });
    let liveWorkspaceRevision = 9;
    let liveProjectRevision = 13;

    test.getWorkspaceIndex.mockImplementation(async () => ({
      ...structuredClone(baseSnapshot),
      workspaceIndex: {
        ...structuredClone(baseSnapshot.workspaceIndex),
        revision: liveWorkspaceRevision
      },
      projectRevision: liveProjectRevision
    }));
    test.readDocument.mockImplementation(async ({ offset = 0 }) => ({
      ...structuredClone(baseDocument),
      offset,
      workspaceRevision: liveWorkspaceRevision,
      projectRevision: liveProjectRevision
    }));
    test.previewOperations.mockImplementation(async ({ batch }) => {
      expect(batch.baseRevision).toBe(liveWorkspaceRevision);
      return {
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
        projectRevision: liveProjectRevision
      };
    });
    test.applyOperations.mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as {
        batch: LongWorkspaceOperationBatch;
        baseProjectRevision: number;
      };
      if (
        input.batch.baseRevision !== liveWorkspaceRevision ||
        input.baseProjectRevision !== liveProjectRevision
      ) {
        throw new Error("审批仍在使用已过期的全局 revision。");
      }
      liveWorkspaceRevision += 1;
      liveProjectRevision += 1;
      return undefined;
    });

    await test.controller.handleEvent(characterWriteEvent());
    await test.controller.handleEvent(continuityWriteEvent());
    expect(test.controller.itemsForBook(proposalBase.bookId)).toMatchObject([
      { status: "ready" },
      { status: "ready" }
    ]);

    await Promise.all([
      test.controller.approve(proposalBase.bookId, "event_character_file"),
      test.controller.approve(proposalBase.bookId, "event_continuity_file")
    ]);

    expect(test.applyOperations).toHaveBeenCalledTimes(2);
    expect(test.applyOperations).toHaveBeenLastCalledWith({
      bookId: proposalBase.bookId,
      batch: expect.objectContaining({ baseRevision: 10 }),
      baseProjectRevision: 14
    });
    expect(test.notifications.error).not.toHaveBeenCalled();
    expect(test.controller.itemsForBook(proposalBase.bookId)).toMatchObject([
      { status: "accepted" },
      { status: "accepted" }
    ]);
  });

  it("clears a previously trusted continuity diff when retry validation fails", async () => {
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
    expect(test.controller.itemsForBook("longbook_test")[0]).toMatchObject({
      status: "ready",
      preview: expect.any(Object)
    });

    const changedContent = "文件已在磁盘发生变化。";
    test.readDocument.mockResolvedValueOnce({
      bookId: proposalBase.bookId,
      file: {
        id: longChapterForeshadowingChangesFileId("chapter_one"),
        path: longChapterContinuityFilePath(
          "chapter_one",
          "foreshadowing-changes.md"
        ),
        revision: fileRevision,
        updatedAt: "2026-07-26T11:00:00.000Z"
      },
      content: changedContent,
      offset: 0,
      totalCharacters: Array.from(changedContent).length,
      nextOffset: null,
      workspaceRevision: 9,
      projectRevision: 13
    });

    await test.controller.retryPreview(
      "longbook_test",
      "event_continuity_file"
    );

    const item = test.controller.itemsForBook("longbook_test")[0]!;
    expect(item).toMatchObject({
      status: "error",
      error: expect.stringContaining("原始内容与实际文件不一致")
    });
    expect(item).not.toHaveProperty("preview");
    expect(item).not.toHaveProperty("effectiveBatch");
  });

  it.each([
    {
      label: "伪造路径",
      suffix: "path",
      patch: {
        filePath:
          "long/chapters/chapter_two/continuity/foreshadowing-changes.md"
      },
      error: "文件路径",
      readCount: 0
    },
    {
      label: "伪造原文",
      suffix: "before",
      patch: { beforeText: "这是伪造的文件原文。" },
      error: "原始内容与实际文件不一致",
      readCount: 1
    }
  ])(
    "fails closed before previewing continuity proposals with $label",
    async ({ suffix, patch, error, readCount }) => {
      const test = harness();
      const original = continuityWriteEvent();
      if (original.type !== "long.continuity_file_proposal") {
        throw new Error("测试提案类型不正确。");
      }
      const forged = systemEvent({
        ...original,
        id: `event_continuity_forged_${suffix}`,
        payload: {
          ...original.payload,
          toolCallId: `tool_continuity_forged_${suffix}`,
          files: original.payload.files.map((file) => ({
            ...file,
            ...patch
          }))
        }
      });

      await test.controller.handleEvent(forged);

      expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
        {
          status: "error",
          error: expect.stringContaining(error)
        }
      ]);
      expect(test.readDocument).toHaveBeenCalledTimes(readCount);
      expect(test.previewOperations).not.toHaveBeenCalled();
      expect(test.applyOperations).not.toHaveBeenCalled();
    }
  );

  it("rebases lightweight continuity commits after their file proposals", async () => {
    const test = harness();

    await test.controller.handleEvent(textFilesLedgerEvent());

    expect(test.commitChapter).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "text_files",
        baseWorkspaceRevision: 9,
        baseProjectRevision: 13,
        chapterFileRevisions: { body: fileRevision },
        continuityFileRevisions: expect.not.arrayContaining([
          expect.objectContaining({
            fileId: longChapterForeshadowingChangesFileId("chapter_one")
          })
        ]),
        foreshadowingBeatDecisions: {}
      })
    );
    expect(test.notifications.error).not.toHaveBeenCalled();
    expect(test.controller.itemsForBook("longbook_test")).toEqual([]);
  });

  it("finalizes two text-file continuity commits from the same run in order", async () => {
    const test = harness();
    const latest = await test.getWorkspaceIndex();
    test.getWorkspaceIndex.mockResolvedValue({
      ...latest,
      workspaceIndex: {
        ...latest.workspaceIndex,
        plot: {
          chapterCards: [
            { id: "chapter_one", title: "第一章" },
            { id: "chapter_two", title: "第二章" }
          ]
        },
        chapters: [
          ...latest.workspaceIndex.chapters,
          {
            chapterCardId: "chapter_two",
            body: {
              id: longChapterBodyFileId("chapter_two"),
              path: longChapterFilePath("chapter_two", "body.md"),
              revision: fileRevision,
              updatedAt: "2026-07-26T11:00:00.000Z"
            },
            card: {
              id: longChapterCardFileId("chapter_two"),
              path: longChapterFilePath("chapter_two", "card.md"),
              revision: fileRevision,
              updatedAt: "2026-07-26T11:00:00.000Z"
            },
            characterState: {
              id: longChapterCharacterStateFileId("chapter_two"),
              path: longChapterFilePath("chapter_two", "character-state.md"),
              revision: fileRevision,
              updatedAt: "2026-07-26T11:00:00.000Z"
            },
            handoff: {
              id: longChapterHandoffFileId("chapter_two"),
              path: longChapterFilePath("chapter_two", "handoff.md"),
              revision: fileRevision,
              updatedAt: "2026-07-26T11:00:00.000Z"
            },
            foreshadowingChanges: {
              id: longChapterForeshadowingChangesFileId("chapter_two"),
              path: longChapterContinuityFilePath(
                "chapter_two",
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
      }
    });

    await test.controller.handleEvent(textFilesLedgerEvent());
    await test.controller.handleEvent(
      systemEvent(
        createEnvelope(
          "long.ledger_commit_proposal",
          {
            ...proposalBase,
            agentId: "continuity_ledger" as const,
            toolCallId: "tool_text_files_commit_two",
            input: {
              mode: "text_files" as const,
              bookId: proposalBase.bookId,
              chapterCardId: "chapter_two",
              chapterFileRevisions: { body: fileRevision },
              continuityFileRevisions: [
                {
                  fileId: longChapterCharacterStateFileId("chapter_two"),
                  revision: fileRevision
                },
                {
                  fileId: longChapterHandoffFileId("chapter_two"),
                  revision: fileRevision
                }
              ],
              foreshadowingBeatDecisions: {},
              commitMessage: "留存第二章连续性文本",
              baseWorkspaceRevision: 7,
              baseProjectRevision: 11
            }
          },
          { id: "event_text_files_ledger_two", context: envelopeContext }
        )
      )
    );

    expect(test.commitChapter).toHaveBeenCalledTimes(2);
    expect(test.commitChapter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chapterCardId: "chapter_one",
        baseWorkspaceRevision: 9,
        baseProjectRevision: 13
      })
    );
    expect(test.commitChapter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chapterCardId: "chapter_two",
        baseWorkspaceRevision: 9,
        baseProjectRevision: 13
      })
    );
    expect(test.notifications.error).not.toHaveBeenCalled();
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
      test.controller.reject("longbook_test", "event_worldbuilding_file")
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
          createdFileIds: [longWorldbuildingItemFileId("worlditem_memory")]
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
    expect(test.controller.itemsForBook("longbook_test")).toMatchObject([
      {
        status: "accepted",
        event: { id: "event_mutation", type: "long.mutation_proposal" }
      }
    ]);
  });
});
