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

describe("LongProjectStore: documents-and-structure", () => {
  it("updates only long-book bindings with project-revision CAS", async () => {
      const { projectStore, created } = await createFixture("bindings");
      const originalWorkspaceRevision = created.book.workspaceIndex.revision;
      const updated = await projectStore.updateBindings(
        created.projectDirectory,
        {
          expectedProjectRevision: created.summary.projectRevision,
          linkedMaterialIdsByKind: {
            character: [],
            gimmick: [],
            plot: ["material-long-plot", "missing-material"],
            draft: [],
            other: []
          },
          linkedSkillIdsByKind: {
            general: [],
            plot: [],
            style: ["skill-long-style"],
            other: []
          }
        }
      );

      expect(updated.summary.projectRevision).toBe(
        created.summary.projectRevision + 1
      );
      expect(updated.book.workspaceIndex.revision).toBe(
        originalWorkspaceRevision + 1
      );
      expect(updated.book.linkedMaterialIdsByKind.plot).toEqual([
        "material-long-plot",
        "missing-material"
      ]);
      expect(updated.book.linkedSkillIdsByKind.style).toEqual([
        "skill-long-style"
      ]);
      await expect(
        projectStore.updateBindings(created.projectDirectory, {
          expectedProjectRevision: created.summary.projectRevision,
          linkedMaterialIdsByKind:
            updated.book.linkedMaterialIdsByKind,
          linkedSkillIdsByKind: updated.book.linkedSkillIdsByKind
        })
      ).rejects.toThrow(/project revision 冲突/u);
    });

  it("renames a long book without renaming its project directory", async () => {
      const { projectStore, created } = await createFixture("rename-book");
      const originalWorkspaceRevision = created.book.workspaceIndex.revision;
      const updated = await projectStore.renameBook(created.projectDirectory, {
        expectedProjectRevision: created.summary.projectRevision,
        title: "新的长篇名称"
      });

      expect(updated.summary.title).toBe("新的长篇名称");
      expect(updated.summary.projectRevision).toBe(
        created.summary.projectRevision + 1
      );
      expect(updated.book.workspaceIndex.revision).toBe(
        originalWorkspaceRevision + 1
      );
      await expect(
        projectStore.openBook(created.projectDirectory)
      ).resolves.toMatchObject({ summary: { title: "新的长篇名称" } });
      await expect(
        projectStore.renameBook(created.projectDirectory, {
          expectedProjectRevision: created.summary.projectRevision,
          title: "过期修改"
        })
      ).rejects.toThrow(/project revision 冲突/u);
    });

  it(
      "rejects an oversized chapter before mutating manifest, index, or files",
      async () => {
        const { projectStore, created } = await createFixture(
          "chapter-byte-limit"
        );
        const files = firstChapterFiles(created.book);
        const manifestPath = join(created.projectDirectory, "deepwrite.json");
        const indexPath = join(
          created.projectDirectory,
          LONG_WORKSPACE_INDEX_PATH
        );
        const before = await Promise.all(
          [manifestPath, indexPath, join(created.projectDirectory, files.body.path)].map(
            async (path) =>
              projectTransactionContentSha256(await readFile(path))
          )
        );
        const oversizedBody = "界".repeat(
          Math.floor(MAX_MARKDOWN_BYTES / 3) + 1
        );

        await expect(
          projectStore.writeChapter(created.projectDirectory, {
            chapterCardId:
              created.book.workspaceIndex.plot.chapterCards[0]!.id,
            body: {
              content: oversizedBody,
              baseRevision: files.body.revision
            },
            characterState: {
              content: "角色状态",
              baseRevision: files.characterState.revision
            },
            handoff: {
              content: "交接摘要",
              baseRevision: files.handoff.revision
            },
            baseWorkspaceRevision: 0,
            baseProjectRevision: 0
          })
        ).rejects.toThrow(/UTF-8 字节限制/u);

        const after = await Promise.all(
          [manifestPath, indexPath, join(created.projectDirectory, files.body.path)].map(
            async (path) =>
              projectTransactionContentSha256(await readFile(path))
          )
        );
        expect(after).toEqual(before);
      },
      30_000
    );

  it(
      "rejects an append crossing the Markdown byte limit without publishing its index change",
      async () => {
        const { projectStore, created } = await createFixture(
          "append-byte-limit"
        );
        const body = firstChapterFiles(created.book).body;
        const bodyPath = join(created.projectDirectory, body.path);
        const nearLimit = "界".repeat(
          Math.floor((MAX_MARKDOWN_BYTES - 3) / 3)
        );
        const written = await projectStore.writeDocument(
          created.projectDirectory,
          {
            fileId: body.id,
            content: nearLimit,
            expectedFileRevision: body.revision,
            expectedWorkspaceRevision: 0,
            expectedProjectRevision: 0
          }
        );
        const indexPath = join(
          created.projectDirectory,
          LONG_WORKSPACE_INDEX_PATH
        );
        const manifestPath = join(created.projectDirectory, "deepwrite.json");
        const before = await Promise.all(
          [manifestPath, indexPath, bodyPath].map(async (path) =>
            projectTransactionContentSha256(await readFile(path))
          )
        );
        const appended = `${nearLimit}界界`;

        await expect(
          projectStore.applyWorkspaceOperations(created.projectDirectory, {
            batch: {
              baseRevision: 1,
              updatedAt: FIXED_NOW,
              operations: [
                {
                  type: "chapter.update",
                  id:
                    created.book.workspaceIndex.plot.chapterCards[0]!.id,
                  patch: { title: "验证越界 append 不落盘" }
                }
              ],
              documentWrites: [
                {
                  proposalId: "proposal_oversized_append",
                  fileId: body.id,
                  mode: "append",
                  expectedRevision: written.fileRevision,
                  nextRevision: createLongFileRevision(appended),
                  updatedAt: FIXED_NOW,
                  content: "界界",
                  reason: "验证最终 UTF-8 字节边界"
                }
              ]
            },
            expectedProjectRevision: 1
          })
        ).rejects.toThrow(/UTF-8 字节限制/u);

        const after = await Promise.all(
          [manifestPath, indexPath, bodyPath].map(async (path) =>
            projectTransactionContentSha256(await readFile(path))
          )
        );
        expect(after).toEqual(before);
      },
      30_000
    );

  it("rejects a manifest-sized binding update before either revision changes", async () => {
      const { projectStore, created } = await createFixture(
        "binding-byte-limit"
      );
      const manifestPath = join(created.projectDirectory, "deepwrite.json");
      const indexPath = join(
        created.projectDirectory,
        LONG_WORKSPACE_INDEX_PATH
      );
      const before = await Promise.all(
        [manifestPath, indexPath].map(async (path) =>
          projectTransactionContentSha256(await readFile(path))
        )
      );
      const oversizedIds = Array.from(
        { length: 2_200 },
        (_, index) => `material-${index}-${"x".repeat(470)}`
      );

      await expect(
        projectStore.updateBindings(created.projectDirectory, {
          expectedProjectRevision: 0,
          linkedMaterialIdsByKind: {
            character: [],
            gimmick: [],
            plot: oversizedIds,
            draft: [],
            other: []
          },
          linkedSkillIdsByKind: {
            general: [],
            plot: [],
            style: [],
            other: []
          }
        })
      ).rejects.toThrow(/UTF-8 字节限制/u);

      const after = await Promise.all(
        [manifestPath, indexPath].map(async (path) =>
          projectTransactionContentSha256(await readFile(path))
        )
      );
      expect(after).toEqual(before);
    });

  it("writes atomically, reads by character page and searches only explicit file scopes", async () => {
      const { projectStore, created } = await createFixture("read-search");
      const body = firstChapterFiles(created.book).body;
      const written = await projectStore.writeDocument(
        created.projectDirectory,
        {
          fileId: body.id,
          content: "甲乙关键词丙丁\n第二行关键词",
          expectedFileRevision: body.revision,
          expectedWorkspaceRevision: created.book.workspaceIndex.revision,
          expectedProjectRevision: created.book.projectRevision!
        }
      );

      expect(written.workspaceRevision).toBe(1);
      expect(written.projectRevision).toBe(1);
      const page = await projectStore.readDocument(created.projectDirectory, {
        fileId: body.id,
        offset: 2,
        limit: 3
      });
      expect(page.content).toBe("关键词");
      expect(page.nextOffset).toBe(5);

      await writeFile(
        join(created.projectDirectory, "orphan.md"),
        "关键词不应被搜索",
        "utf8"
      );
      const scoped = await projectStore.search(created.projectDirectory, {
        query: "关键词",
        fileIds: [body.id],
        maxResults: 10
      });
      expect(scoped.matches).toHaveLength(2);
      expect(scoped.matches.every((match) => match.fileId === body.id)).toBe(true);

      const excluded = await projectStore.search(created.projectDirectory, {
        query: "关键词",
        fileIds: [LONG_BOOK_LINE_FILE_ID]
      });
      expect(excluded.matches).toEqual([]);
      await expect(
        lstat(join(created.projectDirectory, ".deepwrite", "transaction.json"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

  it("supports the public 256K Unicode-character page limit", async () => {
      const { projectStore, created } = await createFixture("large-page");
      const body = firstChapterFiles(created.book).body;
      const content = "😀".repeat(70_000);
      await projectStore.writeDocument(created.projectDirectory, {
        fileId: body.id,
        content,
        expectedFileRevision: body.revision,
        expectedWorkspaceRevision: created.book.workspaceIndex.revision,
        expectedProjectRevision: created.book.projectRevision!
      });

      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: body.id,
          limit: 256 * 1024
        })
      ).resolves.toMatchObject({
        content,
        totalCharacters: 70_000,
        nextOffset: null
      });

      await projectStore.writeDocument(created.projectDirectory, {
        fileId: body.id,
        content: "甲😀乙😀丙",
        expectedFileRevision: (
          await projectStore.readDocument(created.projectDirectory, {
            fileId: body.id,
            limit: 1
          })
        ).revision,
        expectedWorkspaceRevision: 1,
        expectedProjectRevision: 1
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: body.id,
          offset: 1,
          limit: 3
        })
      ).resolves.toMatchObject({
        content: "😀乙😀",
        totalCharacters: 5,
        nextOffset: 4
      });
    });

  it("creates a stage-level character overview file for new books", async () => {
      const { projectStore, created } = await createFixture("character-overview");
      expect(created.book.workspaceIndex.characterOverview).toMatchObject({
        id: LONG_CHARACTER_OVERVIEW_FILE_ID,
        path: LONG_CHARACTER_OVERVIEW_PATH
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: LONG_CHARACTER_OVERVIEW_FILE_ID
        })
      ).resolves.toMatchObject({ content: "" });
    });

  it("migrates missing character overview onto existing projects", async () => {
      const { projectStore, created } = await createFixture(
        "missing-character-overview"
      );
      const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
      const manifestPath = join(created.projectDirectory, "deepwrite.json");
      const index = JSON.parse(await readFile(indexPath, "utf8")) as {
        characterOverview?: unknown;
      };
      expect(index.characterOverview).toBeDefined();
      await unlink(join(created.projectDirectory, LONG_CHARACTER_OVERVIEW_PATH));
      delete index.characterOverview;
      const indexContent = `${JSON.stringify(index, null, 2)}\n`;
      await writeFile(indexPath, indexContent, "utf8");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        workspaceIndexFile: { revision: string };
      };
      manifest.workspaceIndexFile.revision =
        createLongFileRevision(indexContent);
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );

      const opened = await projectStore.openBook(created.projectDirectory);
      expect(opened.book.workspaceIndex.characterOverview).toMatchObject({
        id: LONG_CHARACTER_OVERVIEW_FILE_ID,
        path: LONG_CHARACTER_OVERVIEW_PATH
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: LONG_CHARACTER_OVERVIEW_FILE_ID
        })
      ).resolves.toMatchObject({ content: "" });
    });

  it("migrates and writes back the default character type directory", async () => {
      const { projectStore, created } = await createFixture(
        "missing-character-types"
      );
      const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
      const manifestPath = join(created.projectDirectory, "deepwrite.json");
      const index = JSON.parse(await readFile(indexPath, "utf8")) as {
        characterTypes?: unknown;
      };
      delete index.characterTypes;
      const indexContent = `${JSON.stringify(index, null, 2)}\n`;
      await writeFile(indexPath, indexContent, "utf8");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        workspaceIndexFile: { revision: string };
      };
      manifest.workspaceIndexFile.revision = createLongFileRevision(indexContent);
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );

      const opened = await projectStore.openBook(created.projectDirectory);
      expect(opened.book.workspaceIndex.characterTypes.map(({ id }) => id)).toEqual([
        "protagonist",
        "major_supporting",
        "minor_supporting",
        "passerby"
      ]);
      const writtenBack = JSON.parse(await readFile(indexPath, "utf8")) as {
        characterTypes?: unknown[];
      };
      expect(writtenBack.characterTypes).toHaveLength(4);
    });

  it("stores every list worldbuilding item in its own versioned Markdown file", async () => {
      const { projectStore, created } = await createFixture("world-list");
      const category = created.book.workspaceIndex.worldbuilding[0]!;
      expect(category.format).toBe("list");
      if (category.format !== "list") throw new Error("expected list category");
      expect(category.overview).toMatchObject({
        id: longWorldbuildingOverviewFileId(category.id),
        path: longWorldbuildingOverviewContentPath(category.id)
      });
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: category.overview!.id
        })
      ).resolves.toMatchObject({ content: "" });
      const itemId = "worlditem_memory_cost";
      const updatedAt = FIXED_NOW;
      const file = createEmptyLongMarkdownFileReference(
        longWorldbuildingItemFileId(itemId),
        longWorldbuildingItemContentPath(category.id, itemId),
        updatedAt
      );
      const createdItem = await projectStore.applyWorkspaceOperations(
        created.projectDirectory,
        {
          batch: {
            baseRevision: 0,
            updatedAt,
            operations: [{
              type: "worldbuildingItem.create",
              categoryId: category.id,
              item: {
                id: itemId,
                title: "记忆代价",
                order: 1,
                file
              }
            }],
            documentWrites: []
          },
          expectedProjectRevision: 0
        }
      );
      const item = createdItem.book.workspaceIndex.worldbuilding[0]!;
      if (item.format !== "list") throw new Error("expected list category");
      expect(item.items).toHaveLength(1);
      await expect(
        projectStore.writeDocument(created.projectDirectory, {
          fileId: item.items[0]!.file.id,
          content: "每次施法都会遗忘一段记忆。",
          expectedFileRevision: item.items[0]!.file.revision,
          expectedWorkspaceRevision: 1,
          expectedProjectRevision: 1
        })
      ).resolves.toMatchObject({ workspaceRevision: 2 });
    });

  it("converts worldbuilding list/text formats transactionally without dropping existing content", async () => {
      const { projectStore, created } = await createFixture(
        "world-format-conversion"
      );
      const category = created.book.workspaceIndex.worldbuilding[0]!;
      if (category.format !== "list") throw new Error("expected list category");
      const itemId = "worlditem_conversion_source";
      const itemFile = createEmptyLongMarkdownFileReference(
        longWorldbuildingItemFileId(itemId),
        longWorldbuildingItemContentPath(category.id, itemId),
        FIXED_NOW
      );
      const withItem = await projectStore.applyWorkspaceOperations(
        created.projectDirectory,
        {
          batch: {
            baseRevision: 0,
            updatedAt: FIXED_NOW,
            operations: [{
              type: "worldbuildingItem.create",
              categoryId: category.id,
              item: {
                id: itemId,
                title: "潮汐历法",
                order: 1,
                file: itemFile
              }
            }],
            documentWrites: []
          },
          expectedProjectRevision: 0
        }
      );
      const written = await projectStore.writeDocument(
        created.projectDirectory,
        {
          fileId: itemFile.id,
          content: "每逢双月，海岸时间会比内陆慢一刻。",
          expectedFileRevision: itemFile.revision,
          expectedWorkspaceRevision: withItem.book.workspaceIndex.revision,
          expectedProjectRevision: withItem.projectRevision
        }
      );

      const conversionBatch = {
        baseRevision: written.workspaceRevision,
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "worldbuilding.update" as const,
            id: category.id,
            patch: { format: "text" as const }
          }
        ],
        documentWrites: []
      };
      const conversionPreview =
        await projectStore.previewWorkspaceOperations(
          created.projectDirectory,
          conversionBatch
        );
      expect(conversionPreview.documentWrites).toHaveLength(1);
      expect(conversionPreview.documentWrites[0]).toMatchObject({
        mode: "create",
        content: expect.stringContaining(
          "每逢双月，海岸时间会比内陆慢一刻。"
        )
      });
      expect(
        conversionPreview.entityChanges.find(
          ({ id }) => id === category.id
        )?.after
      ).toEqual(
        expect.objectContaining({
          format: "text",
          file: expect.objectContaining({
            revision: conversionPreview.documentWrites[0]!.nextRevision
          })
        })
      );

      const convertedToText =
        await projectStore.applyWorkspaceOperations(
          created.projectDirectory,
          {
            batch: conversionBatch,
            expectedProjectRevision: written.projectRevision
          }
        );
      const textCategory =
        convertedToText.book.workspaceIndex.worldbuilding[0]!;
      if (textCategory.format !== "text") throw new Error("expected text category");
      const textDocument = await projectStore.readDocument(
        created.projectDirectory,
        { fileId: textCategory.file.id }
      );
      expect(textDocument.content).not.toContain(
        "deepwrite-worldbuilding-list:v1"
      );
      expect(textDocument.content).toContain("## 潮汐历法");
      expect(textDocument.content).toContain(
        "每逢双月，海岸时间会比内陆慢一刻。"
      );
      expect(
        convertedToText.book.workspaceIndex.worldbuilding[0]!.format
      ).toBe("text");

      const convertedBack =
        await projectStore.applyWorkspaceOperations(
          created.projectDirectory,
          {
            batch: {
              baseRevision:
                convertedToText.book.workspaceIndex.revision,
              updatedAt: FIXED_NOW,
              operations: [
                {
                  type: "worldbuilding.update",
                  id: category.id,
                  patch: { format: "list" }
                }
              ],
              documentWrites: []
            },
            expectedProjectRevision: convertedToText.projectRevision
          }
        );
      const listCategory = convertedBack.book.workspaceIndex.worldbuilding[0]!;
      if (listCategory.format !== "list") throw new Error("expected list category");
      const listDocument = await projectStore.readDocument(
        created.projectDirectory,
        { fileId: listCategory.items[0]!.file.id }
      );
      expect(listCategory.items).toHaveLength(1);
      expect(listDocument.content).toContain("## 潮汐历法");
      expect(listDocument.content).toContain(
        "每逢双月，海岸时间会比内陆慢一刻。"
      );
      expect(
        convertedBack.book.workspaceIndex.worldbuilding[0]!.format
      ).toBe("list");
    });
});
