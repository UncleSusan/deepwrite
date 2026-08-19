import {
  DEFAULT_LONG_AGENTS_MD,
  FIXED_NOW,
  LONG_AGENTS_MD_PATH,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectStore,
  MAX_MARKDOWN_BYTES,
  afterEach,
  createEmptyLongMarkdownFileReference,
  createFixture,
  createLongFileRevision,
  deriveLongForeshadowingStatus,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  lstat,
  mkdir,
  mkdtemp,
  projectTransactionContentSha256,
  readFile,
  readdir,
  realpath,
  rm,
  serializeLongWorldbuildingMarkdownList,
  store,
  symlink,
  temporaryParent,
  temporaryRoots,
  tmpdir,
  unlink,
  writeFile,
  writeFileSync,
} from "./long-project-store.test-support";
import type {
  LongForeshadowing,
} from "./long-project-store.test-support";

describe("LongProjectStore: commit-recovery-and-cas", () => {
  it("physically deletes workspace files transactionally and permits the same id and path to be recreated", async () => {
      const { projectStore, created } = await createFixture("delete-recreate");
      const initialCategory = created.book.workspaceIndex.worldbuilding[0]!;
      const converted = await projectStore.applyWorkspaceOperations(
        created.projectDirectory,
        {
          batch: {
            baseRevision: 0,
            updatedAt: FIXED_NOW,
            operations: [{
              type: "worldbuilding.update",
              id: initialCategory.id,
              patch: { format: "text" }
            }],
            documentWrites: []
          },
          expectedProjectRevision: 0
        }
      );
      const category = structuredClone(
        converted.book.workspaceIndex.worldbuilding[0]!
      );
      if (category.format !== "text") throw new Error("expected text category");

      await expect(
        projectStore.applyWorkspaceOperations(created.projectDirectory, {
          batch: {
            baseRevision: 1,
            updatedAt: FIXED_NOW,
            operations: [
              {
                type: "worldbuilding.delete",
                id: category.id,
                cascade: false
              }
            ],
            documentWrites: []
          },
          expectedProjectRevision: 1
        })
      ).resolves.toMatchObject({ projectRevision: 2 });
      await expect(
        lstat(join(created.projectDirectory, category.file.path))
      ).rejects.toMatchObject({ code: "ENOENT" });

      const content = "重建后的世界观内容";
      const recreatedFile = {
        ...category.file,
        revision: createLongFileRevision(content),
        updatedAt: FIXED_NOW
      };
      await expect(
        projectStore.applyWorkspaceOperations(created.projectDirectory, {
          batch: {
            baseRevision: 2,
            updatedAt: FIXED_NOW,
            operations: [
              {
                type: "worldbuilding.create",
                category: {
                  ...category,
                  file: recreatedFile
                }
              }
            ],
            documentWrites: [
              {
                proposalId: "proposal_recreate_worldbuilding",
                fileId: recreatedFile.id,
                mode: "create",
                expectedRevision: null,
                nextRevision: recreatedFile.revision,
                updatedAt: FIXED_NOW,
                content,
                reason: "验证删除后的同路径安全重建"
              }
            ]
          },
          expectedProjectRevision: 2
        })
      ).resolves.toMatchObject({ projectRevision: 3 });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: recreatedFile.id
        })
      ).resolves.toMatchObject({ content });
    });

  it("refuses to delete an indexed file changed outside DeepWrite", async () => {
      const { projectStore, created } = await createFixture(
        "delete-external-conflict"
      );
      const initialCategory = created.book.workspaceIndex.worldbuilding[0]!;
      const converted = await projectStore.applyWorkspaceOperations(
        created.projectDirectory,
        {
          batch: {
            baseRevision: 0,
            updatedAt: FIXED_NOW,
            operations: [{
              type: "worldbuilding.update",
              id: initialCategory.id,
              patch: { format: "text" }
            }],
            documentWrites: []
          },
          expectedProjectRevision: 0
        }
      );
      const category = converted.book.workspaceIndex.worldbuilding[0]!;
      if (category.format !== "text") throw new Error("expected text category");
      const externalContent = "该内容尚未经过 DeepWrite 的 CAS 确认。";
      await writeFile(
        join(created.projectDirectory, category.file.path),
        externalContent,
        "utf8"
      );

      await expect(
        projectStore.applyWorkspaceOperations(created.projectDirectory, {
          batch: {
            baseRevision: 1,
            updatedAt: FIXED_NOW,
            operations: [
              {
                type: "worldbuilding.delete",
                id: category.id,
                cascade: false
              }
            ],
            documentWrites: []
          },
          expectedProjectRevision: 1
        })
      ).rejects.toMatchObject({ scope: "file" });
      await expect(
        readFile(join(created.projectDirectory, category.file.path), "utf8")
      ).resolves.toBe(externalContent);
      await expect(
        projectStore.openBook(created.projectDirectory)
      ).resolves.toMatchObject({
        book: {
          projectRevision: 1,
          workspaceIndex: { revision: 1 }
        }
      });
    });

  it("enforces file, workspace and project CAS independently", async () => {
      const { projectStore, created } = await createFixture("cas");
      const initialBody = firstChapterFiles(created.book).body;
      const written = await projectStore.writeDocument(
        created.projectDirectory,
        {
          fileId: initialBody.id,
          content: "第一版",
          expectedFileRevision: initialBody.revision,
          expectedWorkspaceRevision: 0,
          expectedProjectRevision: 0
        }
      );

      await expect(
        projectStore.writeDocument(created.projectDirectory, {
          fileId: initialBody.id,
          content: "错误覆盖",
          expectedFileRevision: initialBody.revision,
          expectedWorkspaceRevision: written.workspaceRevision,
          expectedProjectRevision: written.projectRevision
        })
      ).rejects.toMatchObject({ scope: "file" });

      await expect(
        projectStore.writeDocument(created.projectDirectory, {
          fileId: initialBody.id,
          content: "错误覆盖",
          expectedFileRevision: written.fileRevision,
          expectedWorkspaceRevision: 0,
          expectedProjectRevision: written.projectRevision
        })
      ).rejects.toMatchObject({ scope: "workspace" });

      await expect(
        projectStore.writeDocument(created.projectDirectory, {
          fileId: initialBody.id,
          content: "错误覆盖",
          expectedFileRevision: written.fileRevision,
          expectedWorkspaceRevision: written.workspaceRevision,
          expectedProjectRevision: 0
        })
      ).rejects.toMatchObject({ scope: "project" });
    });

  it("writes the chapter triplet atomically, commits continuity, and rolls back only the last commit", async () => {
      const { projectStore, created } = await createFixture("ledger");
      const chapterCardId =
        created.book.workspaceIndex.plot.chapterCards[0]!.id;
      const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
      const files = firstChapterFiles(created.book);
      const emptyRevision = createLongFileRevision("");
      const characterFiles = {
        characterId: "character_alice",
        coreProfile: {
          id: longCharacterCoreProfileFileId("character_alice"),
          path: "long/characters/alice/core-profile.md",
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        relationships: {
          id: longCharacterRelationshipsFileId("character_alice"),
          path: "long/characters/alice/relationships.md",
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        currentState: {
          id: longCharacterCurrentStateFileId("character_alice"),
          path: "long/characters/alice/current-state.md",
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        history: {
          id: longCharacterHistoryFileId("character_alice"),
          path: "long/characters/alice/history.md",
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        }
      };
      await projectStore.applyWorkspaceOperations(
        created.projectDirectory,
        {
          batch: {
            baseRevision: 0,
            updatedAt: FIXED_NOW,
            operations: [
              {
                type: "character.create",
                character: {
                  id: "character_alice",
                  name: "林岚",
                  group: "protagonist",
                  order: 1,
                  aliases: []
                },
                files: characterFiles
              },
              {
                type: "event.create",
                event: {
                  id: "event_letter",
                  title: "收到旧信",
                  summary: "林岚在雨夜收到无法烧毁的信。",
                  timeMode: "sequence",
                  timeLabel: "第一天",
                  storyOrder: 1,
                  location: "林岚家",
                  arcIds: [arcId],
                  characterIds: []
                }
              },
              {
                type: "placement.create",
                placement: {
                  id: "placement_letter",
                  eventId: "event_letter",
                  chapterCardId,
                  orderInChapter: 1,
                  mode: "scene",
                  disclosure: "hint",
                  writingPrompt: "在雨夜呈现来信。",
                  status: "planned",
                  commitId: null
                }
              },
              {
                type: "foreshadowing.create",
                thread: {
                  id: "foreshadow_letter",
                  title: "寄信人身份",
                  coreQuestion: "谁寄出了旧信？",
                  truthEventId: "event_letter",
                  expectedReaderEffect: "产生怀疑。",
                  status: "planned",
                  beats: [
                    {
                      id: "beat_letter",
                      type: "plant",
                      order: 1,
                      eventId: "event_letter",
                      placementId: "placement_letter",
                      chapterCardId,
                      plannedScope: "",
                      note: "首次出现。",
                      status: "planned",
                      commitId: null
                    }
                  ]
                }
              }
            ],
            documentWrites: []
          },
          expectedProjectRevision: 0
        }
      );

      await expect(
        projectStore.writeChapter(created.projectDirectory, {
          chapterCardId,
          body: { content: "雨夜里，她收到一封信。", baseRevision: files.body.revision },
          characterState: {
            content: "林岚：开始怀疑寄信人。",
            baseRevision: files.characterState.revision
          },
          handoff: {
            content: "下一章追查信封上的旧邮戳。",
            baseRevision: "v1:0:deadbeef"
          },
          baseWorkspaceRevision: 1,
          baseProjectRevision: 1
        })
      ).rejects.toMatchObject({ scope: "file" });
      for (const file of Object.values(files)) {
        await expect(
          projectStore.readDocument(created.projectDirectory, {
            fileId: file.id
          })
        ).resolves.toMatchObject({ content: "" });
      }

      const written = await projectStore.writeChapter(
        created.projectDirectory,
        {
          chapterCardId,
          body: {
            content: "雨夜里，她收到一封信。",
            baseRevision: files.body.revision
          },
          characterState: {
            content: "",
            baseRevision: files.characterState.revision
          },
          handoff: {
            content: "",
            baseRevision: files.handoff.revision
          },
          baseWorkspaceRevision: 1,
          baseProjectRevision: 1
        }
      );
      expect(written).toMatchObject({
        chapterCardId,
        workspaceRevision: 2,
        projectRevision: 2
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: files.characterState.id
        })
      ).resolves.toMatchObject({ content: "" });

      const bookLine = created.book.workspaceIndex.bookLine;
      const commitInput: Parameters<LongProjectStore["commitChapter"]>[1] = {
          chapterCardId,
          chapterFileRevisions: {
            body: written.bodyRevision,
            characterState: written.characterStateRevision,
            handoff: written.handoffRevision
          },
          commitMessage: "确认第一章连续性",
          chapterSummary: {
            timeline: "第一天雨夜收到旧信。",
            characterStates: "林岚开始怀疑寄信人。",
            factionStates: "守夜人尚未介入。",
            realmStates: "本章无境界变化。",
            foreshadowingStates: "寄信人身份伏笔已经种下。",
            continuityNotes: "下一章追查信封上的旧邮戳。"
          },
          placementDecisions: {
            placement_letter: {
              status: "committed",
              note: "正文明确写出林岚收到旧信。"
            }
          },
          foreshadowingBeatDecisions: {
            beat_letter: {
              status: "committed",
              note: "正文展示旧信与寄信人身份线索。"
            }
          },
          fileUpdates: [
            {
              fileId: characterFiles.currentState.id,
              content: "林岚已收到旧信并开始追查寄信人。",
              baseRevision: characterFiles.currentState.revision,
              mode: "replace"
            },
            {
              fileId: characterFiles.history.id,
              content: "收到旧信，决定调查寄信人。",
              baseRevision: characterFiles.history.revision,
              mode: "append"
            }
          ],
          coverage: {
            character: {
              status: "changed",
              note: "林岚收到旧信并决定追查寄信人。"
            },
            plot: {
              status: "changed",
              note: "旧信推动调查线正式开始。"
            },
            foreshadowing: {
              status: "changed",
              note: "寄信人身份伏笔已经种下。"
            },
            world: {
              status: "unchanged",
              note: "本章没有新增世界观揭露。"
            },
            knowledge: {
              status: "changed",
              note: "读者确认旧信存在。"
            },
            openLoops: {
              status: "changed",
              note: "留下旧邮戳追查事项。"
            }
          },
          factMutations: [
            {
              factId: "fact_alice-suspicion",
              domain: "character",
              subjectId: "character_alice",
              field: "current_goal",
              value: "追查旧信的寄信人",
              evidence: "正文写明林岚决定调查寄信人。"
            }
          ],
          knowledgeMutations: [
            {
              factId: "fact_alice-suspicion",
              audienceType: "reader",
              audienceId: null,
              level: "knows",
              evidence: "读者随林岚一同看到旧信。"
            }
          ],
          openLoopMutations: [
            {
              loopId: "loop_old-postmark",
              kind: "plot",
              status: "open",
              detail: "追查信封上的旧邮戳",
              subjectId: "event_letter",
              factId: "fact_alice-suspicion",
              evidence: "章末决定从旧邮戳继续调查。"
            }
          ],
          chapterOutputs: {
            characterState: "林岚已收到旧信，当前目标是追查寄信人。",
            handoff: {
              summary: "下一章从旧邮戳线索继续追查。",
              mustCarry: ["林岚已经持有旧信"],
              nextChapterConstraints: ["调查必须从旧邮戳展开"],
              openLoops: ["loop_old-postmark"]
            }
          },
          baseWorkspaceRevision: 2,
          baseProjectRevision: 2
      };
      await writeFile(
        join(created.projectDirectory, files.body.path),
        "提案形成后被外部改写的正文",
        "utf8"
      );
      await expect(
        projectStore.commitChapter(created.projectDirectory, commitInput)
      ).rejects.toMatchObject({ scope: "file" });
      await writeFile(
        join(created.projectDirectory, files.body.path),
        "雨夜里，她收到一封信。",
        "utf8"
      );
      const preexistingRelationshipContent =
        "首次提交前由外部编辑器补充的人物关系。";
      await writeFile(
        join(created.projectDirectory, characterFiles.relationships.path),
        preexistingRelationshipContent,
        "utf8"
      );
      await expect(
        projectStore.commitChapter(created.projectDirectory, {
          ...commitInput,
          factMutations: [
            {
              ...commitInput.factMutations![0]!,
              subjectId: "character_missing"
            }
          ]
        })
      ).rejects.toThrow(/subjectId 未关联工作区现有对象/u);
      await expect(
        projectStore.commitChapter(created.projectDirectory, {
          ...commitInput,
          fileUpdates: commitInput.fileUpdates.filter(
            ({ fileId }) => fileId !== characterFiles.history.id
          )
        })
      ).rejects.toThrow(/必须同步更新人物当前状态和历史轨迹/u);
      const committed = await projectStore.commitChapter(
        created.projectDirectory,
        commitInput
      );
      expect(committed.record).toMatchObject({
        schemaVersion: 3,
        sequence: 1,
        chapterCardId,
        sourceWorkspaceRevision: 2,
        committedWorkspaceRevision: 3,
        commitMessage: "确认第一章连续性",
        chapterSummary: {
          timeline: "第一天雨夜收到旧信。",
          characterStates: "林岚开始怀疑寄信人。",
          factionStates: "守夜人尚未介入。",
          realmStates: "本章无境界变化。",
          foreshadowingStates: "寄信人身份伏笔已经种下。",
          continuityNotes: "下一章追查信封上的旧邮戳。"
        },
        placementChanges: [
          { note: "正文明确写出林岚收到旧信。" }
        ],
        foreshadowingBeatChanges: [
          { note: "正文展示旧信与寄信人身份线索。" }
        ],
        foreshadowingThreadChanges: [
          {
            foreshadowingId: "foreshadow_letter",
            before: "planned",
            after: "open"
          }
        ],
        factChanges: [
          {
            before: null,
            after: {
              factId: "fact_alice-suspicion",
              value: "追查旧信的寄信人"
            }
          }
        ],
        openLoopChanges: [
          {
            before: null,
            after: { loopId: "loop_old-postmark", status: "open" }
          }
        ]
      });
      const afterCommit = await projectStore.openBook(
        created.projectDirectory
      );
      expect(afterCommit.book.workspaceIndex.ledger.commits).toHaveLength(1);
      expect(afterCommit.book.workspaceIndex.ledger.commits[0]!.mode).toBe(
        "structured"
      );
      expect(afterCommit.book.workspaceIndex.chapters[0]!.commitId).toBe(
        committed.record.id
      );
      const migratedContinuityChapter =
        afterCommit.book.workspaceIndex.chapters[0]!;
      expect(migratedContinuityChapter.worldReveals).toBeNull();
      expect(migratedContinuityChapter.characterContinuity).toEqual([
        expect.objectContaining({ characterId: "character_alice" })
      ]);
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: migratedContinuityChapter.foreshadowingChanges.id
        })
      ).resolves.toMatchObject({
        content: expect.stringContaining("beat_letter: planned → committed")
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId:
            migratedContinuityChapter.characterContinuity[0]!.currentState.id
        })
      ).resolves.toMatchObject({
        content: "林岚已收到旧信并开始追查寄信人。"
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: migratedContinuityChapter.characterContinuity[0]!.history.id
        })
      ).resolves.toMatchObject({
        content: expect.stringContaining("收到旧信，决定调查寄信人")
      });
      expect(
        afterCommit.book.workspaceIndex.plot.foreshadowing[0]!.status
      ).toBe("open");
      expect(afterCommit.book.workspaceIndex.ledger.projection).toMatchObject({
        throughCommitId: committed.record.id,
        facts: [
          {
            factId: "fact_alice-suspicion",
            value: "追查旧信的寄信人"
          }
        ],
        knowledge: [
          {
            factId: "fact_alice-suspicion",
            audienceType: "reader",
            level: "knows"
          }
        ],
        openLoops: [
          { loopId: "loop_old-postmark", status: "open" }
        ],
        latestHandoff: {
          commitId: committed.record.id,
          summary: "下一章从旧邮戳线索继续追查。"
        }
      });
      const committedFiles = firstChapterFiles(afterCommit.book);
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedFiles.characterState.id
        })
      ).resolves.toMatchObject({
        content: "林岚已收到旧信，当前目标是追查寄信人。"
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedFiles.handoff.id
        })
      ).resolves.toMatchObject({
        content: expect.stringContaining(
          "## 未闭合事项\n\n- loop_old-postmark"
        )
      });
      for (const file of [
        committedFiles.characterState,
        committedFiles.handoff
      ]) {
        await expect(
          projectStore.writeDocument(created.projectDirectory, {
            fileId: file.id,
            content: "不应覆盖已提交章节",
            expectedFileRevision: file.revision,
            expectedWorkspaceRevision: 3,
            expectedProjectRevision: 3
          })
        ).rejects.toThrow(/已提交章节|由连续性账本生成/u);
      }
      await writeFile(
        join(created.projectDirectory, committedFiles.body.path),
        "外部篡改已提交正文",
        "utf8"
      );
      await expect(
        projectStore.rollbackLastCommit(created.projectDirectory, {
          expectedCommitId: committed.record.id,
          baseWorkspaceRevision: 3,
          baseProjectRevision: 3
        })
      ).rejects.toThrow(/索引外修改/u);
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedFiles.body.id
        })
      ).rejects.toThrow(/索引外修改/u);
      await writeFile(
        join(created.projectDirectory, committedFiles.body.path),
        "雨夜里，她收到一封信。",
        "utf8"
      );
      const committedCharacterFiles =
        afterCommit.book.workspaceIndex.characterFiles[0]!;
      expect(committedCharacterFiles.relationships.revision).toBe(
        createLongFileRevision(preexistingRelationshipContent)
      );
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.relationships.id
        })
      ).resolves.toMatchObject({
        content: preexistingRelationshipContent
      });
      await writeFile(
        join(
          created.projectDirectory,
          committedCharacterFiles.relationships.path
        ),
        "外部篡改未被本次提交更新的人物关系",
        "utf8"
      );
      await expect(
        projectStore.rollbackLastCommit(created.projectDirectory, {
          expectedCommitId: committed.record.id,
          baseWorkspaceRevision: 3,
          baseProjectRevision: 3
        })
      ).rejects.toThrow(/索引外修改/u);
      await writeFile(
        join(
          created.projectDirectory,
          committedCharacterFiles.relationships.path
        ),
        preexistingRelationshipContent,
        "utf8"
      );
      // Continuity records no longer take ownership of character design files;
      // direct-write behavior is covered by the focused store and operation tests.
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.currentState.id
        })
      ).resolves.toMatchObject({
        content: "林岚已收到旧信并开始追查寄信人。"
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.history.id
        })
      ).resolves.toMatchObject({
        content: expect.stringContaining("收到旧信，决定调查寄信人。")
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.history.id
        })
      ).resolves.toMatchObject({
        content: expect.stringContaining(`提交：${committed.record.id}`)
      });

      const overwriteThreadStatus = async (
        status: "open" | "progressing"
      ): Promise<void> => {
        const indexPath = join(
          created.projectDirectory,
          LONG_WORKSPACE_INDEX_PATH
        );
        const manifestPath = join(
          created.projectDirectory,
          "deepwrite.json"
        );
        const index = JSON.parse(await readFile(indexPath, "utf8")) as {
          plot: {
            foreshadowing: Array<{ status: "open" | "progressing" }>;
          };
        };
        index.plot.foreshadowing[0]!.status = status;
        const indexContent = `${JSON.stringify(index, null, 2)}\n`;
        await writeFile(indexPath, indexContent, "utf8");
        const manifest = JSON.parse(
          await readFile(manifestPath, "utf8")
        ) as {
          workspaceIndexFile: { revision: string };
        };
        manifest.workspaceIndexFile.revision =
          createLongFileRevision(indexContent);
        await writeFile(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          "utf8"
        );
      };
      await overwriteThreadStatus("progressing");
      await expect(
        projectStore.rollbackLastCommit(created.projectDirectory, {
          expectedCommitId: committed.record.id,
          baseWorkspaceRevision: 3,
          baseProjectRevision: 3
        })
      ).rejects.toThrow(
        /Foreshadowing status must be open|伏笔线状态已在提交后发生变化/u
      );
      await overwriteThreadStatus("open");

      const coreProfileWrite = await projectStore.writeDocument(
        created.projectDirectory,
        {
          fileId: committedCharacterFiles.coreProfile.id,
          content: "核心档案可在账本启动后继续编辑。",
          expectedFileRevision: committedCharacterFiles.coreProfile.revision,
          expectedWorkspaceRevision: 3,
          expectedProjectRevision: 3
        }
      );
      expect(coreProfileWrite).toMatchObject({
        workspaceRevision: 4,
        projectRevision: 4
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: bookLine.id
        })
      ).resolves.toMatchObject({ content: "" });

      const rolledBack = await projectStore.rollbackLastCommit(
        created.projectDirectory,
        {
          expectedCommitId: committed.record.id,
          baseWorkspaceRevision: 4,
          baseProjectRevision: 4
        }
      );
      expect(rolledBack).toMatchObject({
        rolledBackCommitId: committed.record.id,
        committedThroughChapterId: null,
        workspaceRevision: 5,
        projectRevision: 5
      });
      const afterRollback = await projectStore.openBook(
        created.projectDirectory
      );
      expect(afterRollback.book.workspaceIndex.ledger.commits).toEqual([]);
      expect(afterRollback.book.workspaceIndex.ledger.projection).toEqual({
        throughCommitId: null,
        facts: [],
        knowledge: [],
        openLoops: [],
        latestHandoff: null
      });
      expect(afterRollback.book.workspaceIndex.chapters[0]!.commitId).toBeNull();
      expect(
        afterRollback.book.workspaceIndex.plot.narrativePlacements[0]
      ).toMatchObject({ status: "planned", commitId: null });
      expect(
        afterRollback.book.workspaceIndex.plot.foreshadowing[0]!.beats[0]
      ).toMatchObject({ status: "planned", commitId: null });
      expect(
        afterRollback.book.workspaceIndex.plot.foreshadowing[0]!.status
      ).toBe("planned");
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedFiles.body.id
        })
      ).resolves.toMatchObject({ content: "雨夜里，她收到一封信。" });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedFiles.characterState.id
        })
      ).resolves.toMatchObject({ content: "" });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedFiles.handoff.id
        })
      ).resolves.toMatchObject({ content: "" });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.relationships.id
        })
      ).resolves.toMatchObject({
        content: preexistingRelationshipContent
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.currentState.id
        })
      ).resolves.toMatchObject({ content: "" });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.history.id
        })
      ).resolves.toMatchObject({ content: "" });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: committedCharacterFiles.coreProfile.id
        })
      ).resolves.toMatchObject({
        content: "核心档案可在账本启动后继续编辑。"
      });
      await expect(
        projectStore.writeDocument(created.projectDirectory, {
          fileId: firstChapterFiles(afterRollback.book).body.id,
          content: "回滚后可以继续修改正文。",
          expectedFileRevision: firstChapterFiles(afterRollback.book).body.revision,
          expectedWorkspaceRevision: 5,
          expectedProjectRevision: 5
        })
      ).resolves.toMatchObject({
        workspaceRevision: 6,
        projectRevision: 6
      });
      await expect(
        lstat(
          join(
            created.projectDirectory,
            afterCommit.book.workspaceIndex.ledger.commits[0]!.recordFile.path
          )
        )
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: bookLine.id
        })
      ).resolves.toMatchObject({ content: "" });
    }, 15_000);

  it("fails closed before extending a ledger with any tampered pinned file", async () => {
      const { projectStore, created } = await createFixture(
        "pinned-integrity"
      );
      const emptyRevision = createLongFileRevision("");
      const secondChapterId = "chapter_second";
      const secondChapterStorage = projectTransactionContentSha256(
        secondChapterId
      ).slice(0, 32);
      const secondChapterFiles = {
        chapterCardId: secondChapterId,
        bodyStatus: "empty" as const,
        body: {
          id: longChapterBodyFileId(secondChapterId),
          path: `long/chapters/${secondChapterStorage}/body.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        card: {
          id: longChapterCardFileId(secondChapterId),
          path: `long/chapters/${secondChapterStorage}/card.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        characterState: {
          id: longChapterCharacterStateFileId(secondChapterId),
          path: `long/chapters/${secondChapterStorage}/character-state.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        handoff: {
          id: longChapterHandoffFileId(secondChapterId),
          path: `long/chapters/${secondChapterStorage}/handoff.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        foreshadowingChanges: {
          id: longChapterForeshadowingChangesFileId(secondChapterId),
          path: longChapterContinuityFilePath(
            secondChapterId,
            "foreshadowing-changes.md"
          ),
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        worldReveals: null,
        characterContinuity: [],
        commitId: null
      };
      const characterId = "character_guard";
      const characterStorage =
        projectTransactionContentSha256(characterId).slice(0, 32);
      const characterFiles = {
        characterId,
        coreProfile: {
          id: longCharacterCoreProfileFileId(characterId),
          path: `long/characters/${characterStorage}/core-profile.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        relationships: {
          id: longCharacterRelationshipsFileId(characterId),
          path: `long/characters/${characterStorage}/relationships.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        currentState: {
          id: longCharacterCurrentStateFileId(characterId),
          path: `long/characters/${characterStorage}/current-state.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        },
        history: {
          id: longCharacterHistoryFileId(characterId),
          path: `long/characters/${characterStorage}/history.md`,
          revision: emptyRevision,
          updatedAt: FIXED_NOW
        }
      };
      const volume = created.book.workspaceIndex.plot.volumes[0]!;
      const arc = created.book.workspaceIndex.plot.arcs[0]!;
      const structured = await projectStore.applyWorkspaceOperations(
        created.projectDirectory,
        {
          batch: {
            baseRevision: 0,
            updatedAt: FIXED_NOW,
            operations: [
              {
                type: "character.create",
                character: {
                  id: characterId,
                  name: "守门人",
                  group: "minor_supporting",
                  order: 1,
                  aliases: []
                },
                files: characterFiles
              },
              {
                type: "chapter.create",
                chapterCard: {
                  id: secondChapterId,
                  volumeId: volume.id,
                  primaryArcId: arc.id,
                  title: "第二章",
                  narrativeOrder: 2
                },
                files: secondChapterFiles
              }
            ],
            documentWrites: []
          },
          expectedProjectRevision: 0
        }
      );
      const firstChapterId =
        structured.book.workspaceIndex.plot.chapterCards[0]!.id;
      const firstFiles = firstChapterFiles(structured.book);
      const firstWritten = await projectStore.writeChapter(
        created.projectDirectory,
        {
          chapterCardId: firstChapterId,
          body: {
            content: "第一章正文",
            baseRevision: firstFiles.body.revision
          },
          characterState: {
            content: "第一章角色状态",
            baseRevision: firstFiles.characterState.revision
          },
          handoff: {
            content: "转入第二章",
            baseRevision: firstFiles.handoff.revision
          },
          baseWorkspaceRevision: 1,
          baseProjectRevision: 1
        }
      );
      const chapterSummary = {
        timeline: "第一日。",
        characterStates: "守门人保持警觉。",
        factionStates: "阵营状态不变。",
        realmStates: "境界状态不变。",
        foreshadowingStates: "没有新增伏笔。",
        continuityNotes: "连续进入下一章。"
      };
      const firstCommitted = await projectStore.commitChapter(
        created.projectDirectory,
        {
          chapterCardId: firstChapterId,
          chapterFileRevisions: {
            body: firstWritten.bodyRevision,
            characterState: firstWritten.characterStateRevision,
            handoff: firstWritten.handoffRevision
          },
          commitMessage: "提交第一章",
          chapterSummary,
          placementDecisions: {},
          foreshadowingBeatDecisions: {},
          fileUpdates: [],
          baseWorkspaceRevision: 2,
          baseProjectRevision: 2
        }
      );
      const secondWritten = await projectStore.writeChapter(
        created.projectDirectory,
        {
          chapterCardId: secondChapterId,
          body: {
            content: "第二章正文",
            baseRevision: secondChapterFiles.body.revision
          },
          characterState: {
            content: "第二章角色状态",
            baseRevision: secondChapterFiles.characterState.revision
          },
          handoff: {
            content: "继续后续情节",
            baseRevision: secondChapterFiles.handoff.revision
          },
          baseWorkspaceRevision: 3,
          baseProjectRevision: 3
        }
      );
      const secondCommitInput: Parameters<
        LongProjectStore["commitChapter"]
      >[1] = {
        chapterCardId: secondChapterId,
        chapterFileRevisions: {
          body: secondWritten.bodyRevision,
          characterState: secondWritten.characterStateRevision,
          handoff: secondWritten.handoffRevision
        },
        commitMessage: "提交第二章",
        chapterSummary: {
          ...chapterSummary,
          timeline: "第二日。"
        },
        placementDecisions: {},
        foreshadowingBeatDecisions: {},
        fileUpdates: [],
        baseWorkspaceRevision: 4,
        baseProjectRevision: 4
      };
      const opened = await projectStore.openBook(created.projectDirectory);
      const ledgerPath =
        opened.book.workspaceIndex.ledger.commits[0]!.recordFile.path;
      const indexPath = join(
        created.projectDirectory,
        LONG_WORKSPACE_INDEX_PATH
      );
      const manifestPath = join(created.projectDirectory, "deepwrite.json");
      const stableMetadataHashes = await Promise.all(
        [manifestPath, indexPath].map(async (path) =>
          projectTransactionContentSha256(await readFile(path))
        )
      );
      const tamperCases = [
        {
          path: join(created.projectDirectory, ledgerPath),
          content: "{\"tampered\":true}\n"
        },
        {
          path: join(created.projectDirectory, firstFiles.body.path),
          content: "篡改第一章正文"
        },
        {
          path: join(
            created.projectDirectory,
            characterFiles.relationships.path
          ),
          content: "篡改账本接管的人物关系"
        }
      ];

      for (const tamperCase of tamperCases) {
        const original = await readFile(tamperCase.path);
        await writeFile(tamperCase.path, tamperCase.content, "utf8");
        await expect(
          projectStore.commitChapter(
            created.projectDirectory,
            secondCommitInput
          )
        ).rejects.toThrow();
        const currentMetadataHashes = await Promise.all(
          [manifestPath, indexPath].map(async (path) =>
            projectTransactionContentSha256(await readFile(path))
          )
        );
        expect(currentMetadataHashes).toEqual(stableMetadataHashes);
        await writeFile(tamperCase.path, original);
      }

      const ledgerAbsolutePath = join(created.projectDirectory, ledgerPath);
      const ledgerOriginal = await readFile(ledgerAbsolutePath);
      let injectAfterGate = true;
      const racingStore = new LongProjectStore({
        now: () => {
          if (injectAfterGate) {
            injectAfterGate = false;
            writeFileSync(
              ledgerAbsolutePath,
              "{\"changedAfterIntegrityGate\":true}\n",
              "utf8"
            );
          }
          return FIXED_NOW;
        }
      });
      await expect(
        racingStore.commitChapter(
          created.projectDirectory,
          secondCommitInput
        )
      ).rejects.toMatchObject({ scope: "transaction" });
      const afterRaceMetadataHashes = await Promise.all(
        [manifestPath, indexPath].map(async (path) =>
          projectTransactionContentSha256(await readFile(path))
        )
      );
      expect(afterRaceMetadataHashes).toEqual(stableMetadataHashes);
      await writeFile(ledgerAbsolutePath, ledgerOriginal);

      const after = await projectStore.openBook(created.projectDirectory);
      expect(after.book.workspaceIndex.revision).toBe(4);
      expect(after.book.workspaceIndex.ledger.commits).toHaveLength(1);
      expect(after.book.workspaceIndex.ledger.commits[0]!.id).toBe(
        firstCommitted.record.id
      );
    });
});
