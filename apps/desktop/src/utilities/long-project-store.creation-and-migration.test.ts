import type { LongForeshadowing } from "./long-project-store.test-support";
import {
  DEFAULT_LONG_AGENTS_MD,
  FIXED_NOW,
  LONG_AGENTS_MD_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  createEmptyLongMarkdownFileReference,
  createFixture,
  createLongFileRevision,
  deriveLongForeshadowingStatus,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longWorldbuildingFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  lstat,
  mkdir,
  projectTransactionContentSha256,
  readFile,
  readdir,
  realpath,
  serializeLongWorldbuildingMarkdownList,
  store,
  temporaryParent,
  unlink,
  writeFile
} from "./long-project-store.test-support";

describe("LongProjectStore: creation-and-migration", () => {
  it("initializes AGENTS.md, lazily restores missing files, and copies it on duplicate", async () => {
    const { parent, projectStore, created } = await createFixture("agents-md");
    const agentsPath = join(created.projectDirectory, LONG_AGENTS_MD_PATH);
    await expect(readFile(agentsPath, "utf8")).resolves.toBe(
      DEFAULT_LONG_AGENTS_MD
    );
    await expect(
      projectStore.readAgentsMd(created.projectDirectory)
    ).resolves.toEqual({
      content: DEFAULT_LONG_AGENTS_MD,
      truncated: false
    });

    const custom = "# 长篇上下文\n\n自定义说明";
    await projectStore.writeAgentsMd(created.projectDirectory, custom);
    await expect(
      projectStore.readAgentsMd(created.projectDirectory)
    ).resolves.toEqual({ content: custom, truncated: false });

    await unlink(agentsPath);
    await expect(
      projectStore.readAgentsMd(created.projectDirectory)
    ).resolves.toEqual({
      content: DEFAULT_LONG_AGENTS_MD,
      truncated: false
    });
    await expect(readFile(agentsPath, "utf8")).resolves.toBe(
      DEFAULT_LONG_AGENTS_MD
    );

    await projectStore.writeAgentsMd(created.projectDirectory, custom);
    const duplicated = await projectStore.duplicateBook(
      parent,
      created.projectDirectory,
      "副本"
    );
    await expect(
      projectStore.readAgentsMd(duplicated.projectDirectory)
    ).resolves.toEqual({ content: custom, truncated: false });
  });

  it("defaults new long books to right-side item layouts and persists changes", async () => {
    const { projectStore, created } = await createFixture(
      "worldbuilding-item-layout"
    );
    expect(
      created.book.workspaceIndex.featureSettings.worldbuildingItemLayout
    ).toBe("right-list");
    expect(
      created.book.workspaceIndex.featureSettings
        .characterAndContinuityItemLayout
    ).toBe("right-list");
    expect(created.book.workspaceIndex.featureSettings.plotItemLayout).toBe(
      "right-list"
    );

    await projectStore.applyWorkspaceOperations(created.projectDirectory, {
      batch: {
        baseRevision: created.book.workspaceIndex.revision,
        updatedAt: FIXED_NOW,
        operations: [
          {
            type: "featureSettings.update",
            patch: {
              worldbuildingItemLayout: "left-tree",
              characterAndContinuityItemLayout: "left-tree",
              plotItemLayout: "left-tree"
            }
          }
        ],
        documentWrites: []
      },
      expectedProjectRevision: created.summary.projectRevision
    });

    const reopened = await store().openBook(created.projectDirectory);
    expect(
      reopened.book.workspaceIndex.featureSettings.worldbuildingItemLayout
    ).toBe("left-tree");
    expect(
      reopened.book.workspaceIndex.featureSettings
        .characterAndContinuityItemLayout
    ).toBe("left-tree");
    expect(reopened.book.workspaceIndex.featureSettings.plotItemLayout).toBe(
      "left-tree"
    );
  });

  it("creates a missing nested parent directory for a new long book", async () => {
    const root = await temporaryParent();
    const parent = join(root, "小说", "Deepwrite", "books");

    const created = await store().createBook(parent, {
      id: "longbook_missing-parent",
      title: "首次创建长篇",
      genre: "悬疑"
    });

    expect(created.projectDirectory).toBe(
      join(await realpath(parent), "longbook_missing-parent")
    );
    expect((await lstat(parent)).isDirectory()).toBe(true);
    expect((await lstat(created.projectDirectory)).isDirectory()).toBe(true);
  });

  it("uses a full SHA-256 v2 revision with UTF-8 byte length", () => {
    expect(createLongFileRevision("正文")).toMatch(/^v2:6:[0-9a-f]{64}$/u);
    expect(createLongFileRevision("正文")).toBe(
      `v2:6:${projectTransactionContentSha256("正文")}`
    );
  });

  it("reads legacy v1 revisions and upgrades the hydrated file to v2", async () => {
    const { projectStore, created } = await createFixture("legacy-revision");
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      chapters: Array<{ body: { revision: string } }>;
    };
    index.chapters[0]!.body.revision = `v1:0:${projectTransactionContentSha256(
      ""
    ).slice(0, 8)}`;
    const indexContent = `${JSON.stringify(index, null, 2)}\n`;
    await writeFile(indexPath, indexContent, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      workspaceIndexFile: { revision: string };
    };
    manifest.workspaceIndexFile.revision = `v1:${Buffer.byteLength(
      indexContent,
      "utf8"
    )}:${projectTransactionContentSha256(indexContent).slice(0, 8)}`;
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const opened = await projectStore.openBook(created.projectDirectory);
    const body = firstChapterFiles(opened.book).body;
    expect(body.revision).toMatch(/^v1:/u);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: body.id
      })
    ).resolves.toMatchObject({
      content: "",
      revision: expect.stringMatching(/^v2:0:[0-9a-f]{64}$/u)
    });
  });

  it("migrates legacy aggregate worldbuilding Markdown into independent item files on open", async () => {
    const { projectStore, created } = await createFixture(
      "legacy-worldbuilding-storage"
    );
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const legacyPath = "long/worldbuilding/legacy-rules/content.md";
    const legacyContent = serializeLongWorldbuildingMarkdownList([
      {
        id: "worlditem_legacy_rule",
        title: "旧规则",
        content: "旧项目中的独立规则正文。"
      }
    ]);
    await mkdir(
      join(created.projectDirectory, "long/worldbuilding/legacy-rules"),
      {
        recursive: true
      }
    );
    await writeFile(
      join(created.projectDirectory, legacyPath),
      legacyContent,
      "utf8"
    );
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      worldbuilding: Array<Record<string, unknown>>;
    };
    const category = index.worldbuilding[0]!;
    const overview = category.overview as { path: string };
    await unlink(join(created.projectDirectory, overview.path));
    index.worldbuilding[0] = {
      id: category.id,
      title: category.title,
      order: category.order,
      format: "list",
      contentAuthority: "markdown",
      file: {
        id: longWorldbuildingFileId(String(category.id)),
        path: legacyPath,
        revision: createLongFileRevision(legacyContent),
        updatedAt: FIXED_NOW
      }
    };
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
    const migrated = opened.book.workspaceIndex.worldbuilding[0]!;
    if (migrated.format !== "list") throw new Error("expected list category");
    expect(migrated.contentAuthority).toBe("files");
    expect(migrated.overview).toMatchObject({
      id: longWorldbuildingOverviewFileId(migrated.id),
      path: longWorldbuildingOverviewContentPath(migrated.id)
    });
    expect(migrated.items).toHaveLength(1);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: migrated.items[0]!.file.id
      })
    ).resolves.toMatchObject({
      content: "旧项目中的独立规则正文。"
    });
    await expect(
      lstat(join(created.projectDirectory, legacyPath))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an existing chapter-card file while migrating legacy structured fields", async () => {
    const { projectStore, created } = await createFixture(
      "legacy-chapter-card-content"
    );
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      plot: { chapterCards: Array<Record<string, unknown>> };
      chapters: Array<{ card: { id: string; path: string; revision: string } }>;
    };
    const chapterCard = index.plot.chapterCards[0]!;
    const cardFile = index.chapters[0]!.card;
    const existingContent = "## 已有章卡内容\n\n保留这段人工编辑。";
    await writeFile(
      join(created.projectDirectory, cardFile.path),
      existingContent,
      "utf8"
    );
    cardFile.revision = createLongFileRevision(existingContent);
    chapterCard.outline = "旧版章节规划";
    chapterCard.worldConstraints = "旧版世界约束";
    chapterCard.characterIds = [];
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
    const migratedCard = opened.book.workspaceIndex.plot.chapterCards[0]!;
    expect(migratedCard).not.toHaveProperty("outline");
    expect(migratedCard).not.toHaveProperty("worldConstraints");
    expect(migratedCard).not.toHaveProperty("characterIds");
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: cardFile.id
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining(existingContent)
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: cardFile.id
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining("旧版章节规划")
    });
  });

  it("recreates a missing chapter-card file from legacy structured content", async () => {
    const { created } = await createFixture("missing-legacy-chapter-card");
    const indexPath = join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH);
    const manifestPath = join(created.projectDirectory, "deepwrite.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      plot: { chapterCards: Array<Record<string, unknown>> };
      chapters: Array<{ card: { id: string; path: string } }>;
    };
    const chapterCard = index.plot.chapterCards[0]!;
    const cardFile = index.chapters[0]!.card;
    chapterCard.outline = "重启后应恢复的章节规划";
    chapterCard.worldConstraints = "重启后应恢复的世界约束";
    chapterCard.characterIds = [];
    await unlink(join(created.projectDirectory, cardFile.path));
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

    const restartedStore = store();
    const reopened = await restartedStore.openBook(created.projectDirectory);
    const recoveredCard = reopened.book.workspaceIndex.chapters[0]!.card;
    await expect(
      restartedStore.readDocument(created.projectDirectory, {
        fileId: recoveredCard.id
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining("重启后应恢复的章节规划")
    });
    await expect(
      lstat(join(created.projectDirectory, recoveredCard.path))
    ).resolves.toBeDefined();
  });

  it("repairs missing overview files for existing list worldbuilding categories", async () => {
    const { projectStore, created } = await createFixture(
      "missing-worldbuilding-overview"
    );
    const categories = created.book.workspaceIndex.worldbuilding.filter(
      (category) => category.format === "list"
    );
    expect(categories.length).toBeGreaterThan(1);
    for (const category of categories) {
      expect(category.overview).toBeDefined();
      await expect(
        lstat(join(created.projectDirectory, category.overview!.path))
      ).resolves.toBeDefined();
    }

    const target = categories[0]!;
    await unlink(join(created.projectDirectory, target.overview!.path));

    const opened = await projectStore.openBook(created.projectDirectory);
    const repaired = opened.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === target.id
    );
    if (!repaired || repaired.format !== "list" || !repaired.overview) {
      throw new Error("expected repaired list worldbuilding category");
    }
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: repaired.overview.id
      })
    ).resolves.toMatchObject({ content: "" });
  });

  it("derives every foreshadowing lifecycle status from committed beat types", () => {
    const thread = (
      status: LongForeshadowing["status"],
      types: LongForeshadowing["beats"][number]["type"][]
    ): LongForeshadowing =>
      ({
        id: "foreshadow_status",
        title: "状态推导",
        coreQuestion: "",
        truthEventId: null,
        expectedReaderEffect: "",
        status,
        beats: types.map((type, index) => ({
          id: `beat_status-${index}`,
          type,
          order: index + 1,
          eventId: null,
          placementId: null,
          chapterCardId: null,
          plannedScope: "测试",
          note: "",
          status: "committed",
          commitId: "commit_status"
        }))
      }) as LongForeshadowing;

    expect(deriveLongForeshadowingStatus(thread("planned", ["source"]))).toBe(
      "planned"
    );
    expect(deriveLongForeshadowingStatus(thread("planned", ["plant"]))).toBe(
      "open"
    );
    for (const type of ["reinforce", "misdirect", "partial_reveal"] as const) {
      expect(deriveLongForeshadowingStatus(thread("open", [type]))).toBe(
        "progressing"
      );
    }
    for (const type of ["reveal", "payoff"] as const) {
      expect(deriveLongForeshadowingStatus(thread("progressing", [type]))).toBe(
        "resolved"
      );
    }
    expect(deriveLongForeshadowingStatus(thread("abandoned", ["payoff"]))).toBe(
      "abandoned"
    );
  });

  it("creates through staging and opens the independent default project", async () => {
    const { parent, projectStore, created } = await createFixture("create");

    expect(created.book.bookType).toBe("long");
    expect(created.book.workspaceIndex.worldbuilding).toHaveLength(7);
    expect(
      created.book.workspaceIndex.characterTypes.map(({ id }) => id)
    ).toEqual([
      "protagonist",
      "major_supporting",
      "minor_supporting",
      "passerby"
    ]);
    expect(created.book.workspaceIndex.plot.volumes).toHaveLength(1);
    expect(created.book.workspaceIndex.plot.arcs).toHaveLength(1);
    expect(created.book.workspaceIndex.plot.arcs[0]?.title).toBe("第一剧情点");
    expect(created.book.workspaceIndex.plot.chapterCards).toHaveLength(1);
    expect(created.book.workspaceIndex.chapters).toHaveLength(1);
    expect(
      created.book.workspaceIndex.chapters[0]!.foreshadowingChanges
    ).toMatchObject({
      id: longChapterForeshadowingChangesFileId(
        created.book.workspaceIndex.chapters[0]!.chapterCardId
      ),
      path: longChapterContinuityFilePath(
        created.book.workspaceIndex.chapters[0]!.chapterCardId,
        "foreshadowing-changes.md"
      )
    });
    expect(created.summary.navigation.counts).toMatchObject({
      worldbuildingCategories: 7,
      volumes: 1,
      arcs: 1,
      chapterCards: 1
    });

    const files = [
      created.book.workspaceIndex.bookLine,
      ...Object.values(firstChapterFiles(created.book)),
      created.book.workspaceIndex.chapters[0]!.foreshadowingChanges
    ];
    for (const file of files) {
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: file.id
        })
      ).resolves.toMatchObject({ content: "", totalCharacters: 0 });
    }

    const opened = await projectStore.openBook(created.projectDirectory);
    expect(opened.book.id).toBe(created.book.id);
    expect(JSON.stringify(opened.summary)).not.toContain("workspaceIndex");
    expect(JSON.stringify(opened.summary)).not.toContain("body.md");
    expect(await readdir(parent)).toEqual(["longbook_create"]);
    await expect(
      lstat(join(created.projectDirectory, "deepwrite.json"))
    ).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(
      lstat(join(created.projectDirectory, LONG_WORKSPACE_INDEX_PATH))
    ).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it("persists chapter-card text across a complete store restart", async () => {
    const { created } = await createFixture("chapter-card-restart");
    const card = firstChapterFiles(created.book).card;
    const content = "## 第一章\n\n这是重启后仍需读取的章卡内容。";
    const initialStore = store();
    await initialStore.writeDocument(created.projectDirectory, {
      fileId: card.id,
      content,
      expectedFileRevision: card.revision,
      expectedWorkspaceRevision: 0,
      expectedProjectRevision: 0
    });

    const restartedStore = store();
    const reopened = await restartedStore.openBook(created.projectDirectory);
    const reopenedCard = firstChapterFiles(reopened.book).card;
    await expect(
      restartedStore.readDocument(created.projectDirectory, {
        fileId: reopenedCard.id
      })
    ).resolves.toMatchObject({ content });
  });

  it("commits a chapter without adding foreshadowing output when no overview touchpoint applies", async () => {
    const { projectStore, created } = await createFixture(
      "text-file-no-foreshadowing"
    );
    const chapter = created.book.workspaceIndex.chapters[0]!;
    const contents = [
      [chapter.body, "第一章正文没有触及任何已规划伏笔。"],
      [chapter.characterState, "章末状态保持稳定。"],
      [chapter.handoff, "下一章从日常行程继续。"]
    ] as const;
    const written = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          baseRevision: 0,
          updatedAt: FIXED_NOW,
          operations: [],
          documentWrites: contents.map(([reference, content], index) => ({
            proposalId: `proposal_no_foreshadowing_${index}`,
            fileId: reference.id,
            mode: "replace" as const,
            expectedRevision: reference.revision,
            nextRevision: createLongFileRevision(content),
            updatedAt: FIXED_NOW,
            content,
            reason: "写入无伏笔章节的连续性文件"
          }))
        },
        expectedProjectRevision: 0
      }
    );
    const writtenChapter = written.book.workspaceIndex.chapters[0]!;
    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      {
        mode: "text_files",
        chapterCardId: writtenChapter.chapterCardId,
        chapterFileRevisions: { body: writtenChapter.body.revision },
        continuityFileRevisions: [
          {
            fileId: writtenChapter.characterState.id,
            revision: writtenChapter.characterState.revision
          },
          {
            fileId: writtenChapter.handoff.id,
            revision: writtenChapter.handoff.revision
          }
        ],
        foreshadowingBeatDecisions: {},
        commitMessage: "归档无既有伏笔触点的章节",
        baseWorkspaceRevision: 1,
        baseProjectRevision: 1
      }
    );

    expect(committed.record.foreshadowingBeatChanges).toEqual([]);
    expect(committed.record.foreshadowingThreadChanges).toEqual([]);
    expect(
      committed.record.continuityFiles.map(({ fileId }) => fileId)
    ).toEqual([writtenChapter.characterState.id, writtenChapter.handoff.id]);
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: writtenChapter.foreshadowingChanges.id
      })
    ).resolves.toMatchObject({ content: "" });

    await expect(
      projectStore.rollbackLastCommit(created.projectDirectory, {
        expectedCommitId: committed.record.id,
        baseWorkspaceRevision: 2,
        baseProjectRevision: 2
      })
    ).resolves.toMatchObject({
      rolledBackCommitId: committed.record.id,
      committedThroughChapterId: null,
      workspaceRevision: 3,
      projectRevision: 3
    });
  });

  it("commits chapter continuity as lightweight per-chapter text files and leaves them editable after rollback", async () => {
    const { projectStore, created } = await createFixture(
      "text-file-continuity"
    );
    const chapterCardId = created.book.workspaceIndex.plot.chapterCards[0]!.id;
    const arcId = created.book.workspaceIndex.plot.arcs[0]!.id;
    const emptyRevision = createLongFileRevision("");
    const characterId = "character_linlan";
    const characterFiles = {
      characterId,
      coreProfile: createEmptyLongMarkdownFileReference(
        longCharacterCoreProfileFileId(characterId),
        longCharacterFilePath(characterId, "core-profile.md"),
        FIXED_NOW
      ),
      relationships: createEmptyLongMarkdownFileReference(
        longCharacterRelationshipsFileId(characterId),
        longCharacterFilePath(characterId, "relationships.md"),
        FIXED_NOW
      ),
      currentState: createEmptyLongMarkdownFileReference(
        longCharacterCurrentStateFileId(characterId),
        longCharacterFilePath(characterId, "current-state.md"),
        FIXED_NOW
      ),
      history: createEmptyLongMarkdownFileReference(
        longCharacterHistoryFileId(characterId),
        longCharacterFilePath(characterId, "history.md"),
        FIXED_NOW
      )
    };
    const worldReveals = createEmptyLongMarkdownFileReference(
      longChapterWorldRevealsFileId(chapterCardId),
      longChapterContinuityFilePath(chapterCardId, "world-reveals.md"),
      FIXED_NOW
    );
    const characterCurrentState = createEmptyLongMarkdownFileReference(
      longChapterCharacterCurrentStateFileId(chapterCardId, characterId),
      longChapterCharacterContinuityFilePath(
        chapterCardId,
        characterId,
        "current-state.md"
      ),
      FIXED_NOW
    );
    const characterHistory = createEmptyLongMarkdownFileReference(
      longChapterCharacterHistoryFileId(chapterCardId, characterId),
      longChapterCharacterContinuityFilePath(
        chapterCardId,
        characterId,
        "history.md"
      ),
      FIXED_NOW
    );

    const withContinuityFiles = await projectStore.applyWorkspaceOperations(
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
                id: "event_text_continuity",
                title: "收到旧信",
                summary: "林岚在雨夜收到无法烧毁的信。",
                timeMode: "sequence",
                timeLabel: "第一天",
                storyOrder: 1,
                location: "林岚家",
                arcIds: [arcId],
                characterIds: [characterId]
              }
            },
            {
              type: "placement.create",
              placement: {
                id: "placement_text_continuity",
                eventId: "event_text_continuity",
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
                id: "foreshadow_text_continuity",
                title: "寄信人身份",
                coreQuestion: "谁寄出了旧信？",
                truthEventId: "event_text_continuity",
                expectedReaderEffect: "产生怀疑。",
                status: "planned",
                beats: [
                  {
                    id: "beat_text_continuity",
                    type: "plant",
                    order: 1,
                    eventId: "event_text_continuity",
                    placementId: "placement_text_continuity",
                    chapterCardId,
                    plannedScope: "",
                    note: "首次出现。",
                    status: "planned",
                    commitId: null
                  }
                ]
              }
            },
            {
              type: "chapterContinuity.worldReveals.create",
              chapterCardId,
              file: worldReveals
            },
            {
              type: "chapterContinuity.character.create",
              chapterCardId,
              characterId,
              currentState: characterCurrentState,
              history: characterHistory
            }
          ],
          documentWrites: []
        },
        expectedProjectRevision: 0
      }
    );
    const createdChapter = withContinuityFiles.book.workspaceIndex.chapters[0]!;
    expect(createdChapter.worldReveals).toEqual(worldReveals);
    expect(createdChapter.characterContinuity).toEqual([
      {
        characterId,
        currentState: characterCurrentState,
        history: characterHistory
      }
    ]);
    for (const reference of [
      worldReveals,
      characterCurrentState,
      characterHistory
    ]) {
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: reference.id
        })
      ).resolves.toMatchObject({ content: "", revision: emptyRevision });
    }

    const chapterContinuity = createdChapter.characterContinuity[0]!;
    const textDocuments = [
      {
        reference: createdChapter.body,
        content: "雨夜里，林岚收到一封带有旧王朝印记的信。"
      },
      {
        reference: createdChapter.characterState,
        content: "林岚持有旧信，决定追查寄信人。"
      },
      {
        reference: createdChapter.handoff,
        content: "下一章从信封上的旧邮戳继续追查。"
      },
      {
        reference: createdChapter.foreshadowingChanges,
        content: "寄信人身份伏笔已种下，等待后续揭露。"
      },
      {
        reference: createdChapter.worldReveals!,
        content: "旧王朝曾使用带月纹的官方火漆。"
      },
      {
        reference: chapterContinuity.currentState,
        content: "林岚：警觉；持有旧信；目标是确认寄信人。"
      },
      {
        reference: chapterContinuity.history,
        content: "第一章：收到旧信并开始调查。"
      }
    ];
    const written = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          baseRevision: 1,
          updatedAt: FIXED_NOW,
          operations: [],
          documentWrites: textDocuments.map(
            ({ reference, content }, index) => ({
              proposalId: `proposal_continuity_${index}`,
              fileId: reference.id,
              mode: "replace" as const,
              expectedRevision: reference.revision,
              nextRevision: createLongFileRevision(content),
              updatedAt: FIXED_NOW,
              content,
              reason: "记录第一章连续性"
            })
          )
        },
        expectedProjectRevision: 1
      }
    );
    const writtenChapter = written.book.workspaceIndex.chapters[0]!;
    const writtenCharacterContinuity = writtenChapter.characterContinuity[0]!;
    const continuityReferences = [
      writtenChapter.characterState,
      writtenChapter.handoff,
      writtenChapter.foreshadowingChanges,
      writtenChapter.worldReveals!,
      writtenCharacterContinuity.currentState,
      writtenCharacterContinuity.history
    ];
    const continuityFileRevisions = continuityReferences.map(
      ({ id, revision }) => ({ fileId: id, revision })
    );
    const commitInput = {
      mode: "text_files" as const,
      chapterCardId,
      chapterFileRevisions: {
        body: writtenChapter.body.revision
      },
      continuityFileRevisions,
      foreshadowingBeatDecisions: {
        beat_text_continuity: {
          status: "committed" as const,
          note: "正文写明林岚收到带旧王朝印记与火漆的信。"
        }
      },
      commitMessage: "留存第一章连续性文本",
      baseWorkspaceRevision: 2,
      baseProjectRevision: 2
    };

    await expect(
      projectStore.commitChapter(created.projectDirectory, {
        ...commitInput,
        foreshadowingBeatDecisions: {}
      })
    ).rejects.toThrow(/伏笔触点决策必须完整覆盖/u);
    await expect(
      projectStore.commitChapter(created.projectDirectory, {
        ...commitInput,
        continuityFileRevisions: continuityFileRevisions.slice(0, -1)
      })
    ).rejects.toThrow(/必须精确引用/u);
    await expect(
      projectStore.commitChapter(created.projectDirectory, {
        ...commitInput,
        continuityFileRevisions: continuityFileRevisions.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                revision: createLongFileRevision("过期的章末状态")
              }
            : entry
        )
      })
    ).rejects.toMatchObject({ scope: "file" });

    const projectionBefore = structuredClone(
      written.book.workspaceIndex.ledger.projection
    );
    const globalCharacterFilesBefore =
      written.book.workspaceIndex.characterFiles[0]!;
    const committed = await projectStore.commitChapter(
      created.projectDirectory,
      commitInput
    );
    expect(committed.record).toMatchObject({
      schemaVersion: 4,
      sequence: 1,
      chapterCardId,
      commitMessage: "留存第一章连续性文本",
      placementChanges: [
        {
          placementId: "placement_text_continuity",
          before: { status: "planned", commitId: null },
          after: {
            status: "committed",
            commitId: committed.record.id
          },
          note: ""
        }
      ],
      foreshadowingBeatChanges: [
        {
          foreshadowingId: "foreshadow_text_continuity",
          beatId: "beat_text_continuity",
          before: { status: "planned", commitId: null },
          after: {
            status: "committed",
            commitId: committed.record.id
          },
          note: "正文写明林岚收到带旧王朝印记与火漆的信。"
        }
      ],
      foreshadowingThreadChanges: [
        {
          foreshadowingId: "foreshadow_text_continuity",
          before: "planned",
          after: "open"
        }
      ],
      fileChanges: [],
      continuityFiles: continuityReferences.map(({ id, path, revision }) => ({
        fileId: id,
        path,
        revision
      }))
    });
    const afterCommit = await projectStore.openBook(created.projectDirectory);
    expect(afterCommit.book.workspaceIndex.ledger.projection).toEqual(
      projectionBefore
    );
    expect(afterCommit.book.workspaceIndex.characterFiles[0]).toEqual(
      globalCharacterFilesBefore
    );
    for (const reference of Object.values(globalCharacterFilesBefore).filter(
      (value): value is typeof globalCharacterFilesBefore.coreProfile =>
        typeof value === "object"
    )) {
      await expect(
        projectStore.readDocument(created.projectDirectory, {
          fileId: reference.id
        })
      ).resolves.toMatchObject({ content: "", revision: emptyRevision });
    }
    const commitEntry = afterCommit.book.workspaceIndex.ledger.commits[0]!;
    expect(commitEntry.mode).toBe("text_files");
    const rawRecord = await readFile(
      join(created.projectDirectory, commitEntry.recordFile.path),
      "utf8"
    );
    expect(rawRecord).not.toContain("收到旧信并开始调查");
    expect(rawRecord).not.toContain("旧王朝曾使用");

    const committedChapter = afterCommit.book.workspaceIndex.chapters[0]!;
    expect(
      afterCommit.book.workspaceIndex.plot.narrativePlacements[0]
    ).toMatchObject({
      id: "placement_text_continuity",
      status: "committed",
      commitId: committed.record.id
    });
    expect(
      afterCommit.book.workspaceIndex.plot.foreshadowing[0]!.beats[0]
    ).toMatchObject({
      id: "beat_text_continuity",
      status: "committed",
      commitId: committed.record.id
    });
    const refinedBody = "第一章正文（提交后精修措辞）。";
    const refined = await projectStore.writeDocument(created.projectDirectory, {
      fileId: committedChapter.body.id,
      content: refinedBody,
      expectedFileRevision: committedChapter.body.revision,
      expectedWorkspaceRevision: 3,
      expectedProjectRevision: 3
    });
    expect(refined).toMatchObject({
      workspaceRevision: 4,
      projectRevision: 4
    });
    expect(refined.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );
    const refinedBodyReference = refined.book.workspaceIndex.chapters[0]!.body;
    const agentRefinedBody = "第一章正文（提交后由智能体继续精修措辞）。";
    const agentRefined = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          baseRevision: 4,
          updatedAt: FIXED_NOW,
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_refine_committed_body",
              fileId: refinedBodyReference.id,
              mode: "replace",
              expectedRevision: refinedBodyReference.revision,
              nextRevision: createLongFileRevision(agentRefinedBody),
              updatedAt: FIXED_NOW,
              content: agentRefinedBody,
              reason: "精修已提交正文"
            }
          ]
        },
        expectedProjectRevision: 4
      }
    );
    expect(agentRefined.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );
    const refinedCardContent = "章卡内容（提交后精修）。";
    const refinedCard = await projectStore.writeDocument(
      created.projectDirectory,
      {
        fileId: committedChapter.card.id,
        content: refinedCardContent,
        expectedFileRevision: committedChapter.card.revision,
        expectedWorkspaceRevision: 5,
        expectedProjectRevision: 5
      }
    );
    expect(refinedCard).toMatchObject({
      workspaceRevision: 6,
      projectRevision: 6
    });
    expect(refinedCard.book.workspaceIndex.chapters[0]!.commitId).toBe(
      committed.record.id
    );

    for (const reference of [
      committedChapter.characterState,
      committedChapter.handoff,
      committedChapter.foreshadowingChanges,
      committedChapter.worldReveals!,
      ...committedChapter.characterContinuity.flatMap((entry) => [
        entry.currentState,
        entry.history
      ])
    ]) {
      await expect(
        projectStore.writeDocument(created.projectDirectory, {
          fileId: reference.id,
          content: "提交后不应允许覆盖",
          expectedFileRevision: reference.revision,
          expectedWorkspaceRevision: 6,
          expectedProjectRevision: 6
        })
      ).rejects.toThrow(/已提交章节/u);
    }

    const rolledBack = await projectStore.rollbackLastCommit(
      created.projectDirectory,
      {
        expectedCommitId: committed.record.id,
        baseWorkspaceRevision: 6,
        baseProjectRevision: 6
      }
    );
    expect(rolledBack).toMatchObject({
      rolledBackCommitId: committed.record.id,
      committedThroughChapterId: null,
      workspaceRevision: 7,
      projectRevision: 7
    });
    const afterRollback = await projectStore.openBook(created.projectDirectory);
    expect(afterRollback.book.workspaceIndex.ledger.commits).toEqual([]);
    expect(afterRollback.book.workspaceIndex.chapters[0]!.commitId).toBeNull();
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: committedChapter.body.id
      })
    ).resolves.toMatchObject({ content: agentRefinedBody });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: committedChapter.card.id
      })
    ).resolves.toMatchObject({ content: refinedCardContent });
    expect(
      afterRollback.book.workspaceIndex.plot.narrativePlacements[0]
    ).toMatchObject({
      id: "placement_text_continuity",
      status: "planned",
      commitId: null
    });
    expect(
      afterRollback.book.workspaceIndex.plot.foreshadowing[0]!.beats[0]
    ).toMatchObject({
      id: "beat_text_continuity",
      status: "planned",
      commitId: null
    });
    await expect(
      projectStore.readDocument(created.projectDirectory, {
        fileId: writtenCharacterContinuity.history.id
      })
    ).resolves.toMatchObject({
      content: "第一章：收到旧信并开始调查。"
    });
    await expect(
      projectStore.writeDocument(created.projectDirectory, {
        fileId: writtenCharacterContinuity.currentState.id,
        content: "回滚后可继续修订人物当前状态。",
        expectedFileRevision: writtenCharacterContinuity.currentState.revision,
        expectedWorkspaceRevision: 7,
        expectedProjectRevision: 7
      })
    ).resolves.toMatchObject({
      workspaceRevision: 8,
      projectRevision: 8
    });
  }, 10_000);
});
