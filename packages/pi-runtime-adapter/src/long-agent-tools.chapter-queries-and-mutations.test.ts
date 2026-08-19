import {
  Check,
  DEFAULT_LONG_AGENT_PROFILES,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LongWorkspaceIndexSnapshotSchema,
  NOW,
  REVISION,
  STORY_PLOT_BODY,
  buildLongWorkspaceTools,
  committedFixtureIndex,
  createHash,
  createLongWorkspaceNavigationSnapshot,
  describe,
  expect,
  expectNoPhysicalWorldbuildingMetadata,
  file,
  fixtureIndex,
  fixtureStoryPlotIndex,
  fixtureWorldFile,
  fixtureWorldbuildingIndex,
  indexResult,
  it,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  profile,
  resultText,
  selectLongChaptersForWritingScope,
  selectNextLongChapterForDispatch,
  storyPlotExecutor,
  toRuntimeEvents,
  toolByName,
  twoWrittenChaptersIndex,
  vi,
  workspace,
} from "./long-agent-tools.test-support";
import type {
  AgentTool,
  LongAgentId,
  LongAgentProfile,
  LongAgentToolDetails,
  LongCommandExecutor,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRoot,
  LongWorkspaceRuntimeContext,
} from "./long-agent-tools.test-support";

describe("long workspace agent tools: chapter-queries-and-mutations", () => {
  it("lists and searches chapters as paragraph text", async () => {
      const index = fixtureIndex();
      const first = index.chapters[0]!;
      index.plot.chapterCards.push({
        id: "chapter_two",
        volumeId: "volume_one",
        primaryArcId: "arc_one",
        title: "第二章",
        narrativeOrder: 2
      });
      index.chapters.push({
        ...first,
        chapterCardId: "chapter_two",
        bodyStatus: "written",
        body: file(
          longChapterBodyFileId("chapter_two"),
          "long/chapters/two/body.md"
        ),
        card: file(
          longChapterCardFileId("chapter_two"),
          "long/chapters/two/card.md"
        ),
        characterState: file(
          longChapterCharacterStateFileId("chapter_two"),
          "long/chapters/two/character-state.md"
        ),
        handoff: file(
          longChapterHandoffFileId("chapter_two"),
          "long/chapters/two/handoff.md"
        ),
        foreshadowingChanges: file(
          longChapterForeshadowingChangesFileId("chapter_two"),
          longChapterContinuityFilePath(
            "chapter_two",
            "foreshadowing-changes.md"
          )
        )
      });
      const parsed = LongWorkspaceIndexSnapshotSchema.parse(index);
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(parsed);
        }
        if (command.type !== "long.search") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        expect(command.payload.scope).toBe("draft");
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: parsed.bookId,
            query: command.payload.query,
            scope: "draft",
            hits: [
              {
                fileId: first.body.id,
                path: first.body.path,
                root: "draft",
                title: "第一章",
                start: 0,
                end: 4,
                snippet: "测灵台上那团青光",
                revision: first.body.revision
              }
            ],
            nextCursor: "chapter-search-next",
            workspaceRevision: parsed.revision,
            projectRevision: 11
          }
        };
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("draft", "draft", "chapter_one"),
        profile: profile("draft"),
        sessionId: "session-chapter-paragraphs",
        runId: "run-chapter-paragraphs",
        executor
      });
      const list = toolByName(tools, "list_chapters");
      const search = toolByName(tools, "search_chapters");

      expect(list.description).toContain("按行段落返回");
      expect(list.description).toContain("不包装成 JSON");
      expect(search.description).toContain("按行段落返回");
      expect(toolByName(tools, "read_chapter").description).toContain(
        "不包装成 JSON"
      );

      const listText = resultText(await list.execute("list-chapters", {}));
      expect(() => JSON.parse(listText)).toThrow();
      expect(listText).not.toContain('"chapter_card_id"');
      expect(listText).toBe(
        [
          "正文章节",
          "第 1 页 / 共 2 条",
          "",
          "第一章",
          "chapter_card_id=chapter_one",
          "叙事顺序=1",
          "正文状态=空",
          "提交状态=未记录",
          "当前章=是",
          "",
          "第二章",
          "chapter_card_id=chapter_two",
          "叙事顺序=2",
          "正文状态=已写",
          "提交状态=未记录",
          "当前章=否"
        ].join("\n")
      );

      const searchText = resultText(
        await search.execute("search-chapters", { query: "测灵台" })
      );
      expect(() => JSON.parse(searchText)).toThrow();
      expect(searchText).toBe(
        [
          "搜索",
          "query=测灵台",
          "",
          "第一章",
          "chapter_card_id=chapter_one",
          "document=body",
          "摘录",
          "测灵台上那团青光",
          "",
          "next_cursor=chapter-search-next"
        ].join("\n")
      );
    });

  it("derives chapter readiness from body content only", async () => {
      const index = fixtureIndex();
      const entry = index.chapters[0]!;
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") return indexResult();
        if (command.type !== "long.readDocument") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        expect(command.payload.fileId).toBe(entry.body.id);
        const content = "已有正文";
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: entry.body,
            content,
            offset: 0,
            totalCharacters: Array.from(content).length,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace(
          "draft",
          "draft",
          "chapter_one"
        ),
        profile: profile("draft"),
        sessionId: "session-readiness",
        runId: "run-readiness",
        executor
      });
      const result = await toolByName(
        tools,
        "get_long_chapter_readiness"
      ).execute("readiness", {});
      const readinessText = resultText(result);
      expect(() => JSON.parse(readinessText)).toThrow();
      expect(readinessText).toBe(
        [
          "第一章",
          "chapter_card_id=chapter_one",
          "状态=可结算",
          "缺失文件=（无）"
        ].join("\n")
      );
      expect(executor).toHaveBeenCalledTimes(2);
    });

  it("forms a dispatch proposal from one index query and stops cleanly when complete", async () => {
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult();
        }
        if (command.type === "long.readDocument") {
          const index = fixtureIndex();
          const entry = index.chapters[0]!;
          const requested = entry.body;
          if (requested.id !== command.payload.fileId) {
            throw new Error("Unexpected chapter file.");
          }
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              file: requested,
              content: "",
              offset: 0,
              totalCharacters: 0,
              nextOffset: null,
              workspaceRevision: index.revision,
              projectRevision: 11
            }
          };
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("draft", "draft"),
        profile: profile("draft"),
        sessionId: "session-dispatch",
        runId: "run-dispatch",
        executor
      });
      const proposal = await toolByName(
        tools,
        "propose_long_chapter_dispatch"
      ).execute("dispatch-next", { summary: "调度连续下一章" });

      expect(executor).toHaveBeenCalledTimes(2);
      expect(executor.mock.calls[0]?.[0].type).toBe("long.getWorkspaceIndex");
      expect(proposal.details).toMatchObject({
        kind: "long-chapter-dispatch-proposal",
        bookId: "longbook_tools",
        agentId: "draft",
        scope: "chapter",
        chapterCardId: "chapter_one",
        title: "第一章",
        chapters: [
          {
            chapterCardId: "chapter_one",
            title: "第一章",
            status: "empty",
            missingFiles: ["body"]
          }
        ],
        workspaceRevision: 7,
        projectRevision: 11,
        summary: "调度连续下一章"
      });
      expect(
        toRuntimeEvents(
          {
            type: "tool_execution_end",
            toolCallId: "dispatch-next",
            toolName: "propose_long_chapter_dispatch",
            result: proposal,
            isError: false
          },
          {
            runId: "run-dispatch",
            sessionId: "session-dispatch",
            prompt: "调度下一章"
          },
          {
            provider: "deepwrite",
            model: "test",
            mode: "local-faux"
          },
          "message-dispatch"
        )
      ).toMatchObject([
        { type: "agent.tool_completed" },
        {
          type: "long.chapter_dispatch_proposal",
          payload: {
            scope: "chapter",
            chapterCardId: "chapter_one",
            title: "第一章",
            chapters: [
              expect.objectContaining({
                chapterCardId: "chapter_one",
                status: "empty"
              })
            ],
            workspaceRevision: 7,
            projectRevision: 11
          }
        }
      ]);

      const completeExecutor = vi.fn<LongCommandExecutor>(
        async (command) => ({
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: "longbook_tools",
            workspaceIndex: committedFixtureIndex(),
            projectRevision: 12
          }
        })
      );
      const completeTools = buildLongWorkspaceTools({
        workspace: workspace("draft", "draft"),
        profile: profile("draft"),
        sessionId: "session-complete",
        runId: "run-complete",
        executor: completeExecutor
      });
      const complete = await toolByName(
        completeTools,
        "propose_long_chapter_dispatch"
      ).execute("dispatch-complete", {});
      expect(complete.details).toEqual({ kind: "none" });
      expect(complete.content).toEqual([
        {
          type: "text",
          text: "全部章卡均已有正文，没有可调度的下一章。"
        }
      ]);
      expect(
        toRuntimeEvents(
          {
            type: "tool_execution_end",
            toolCallId: "dispatch-complete",
            toolName: "propose_long_chapter_dispatch",
            result: complete,
            isError: false
          },
          {
            runId: "run-complete",
            sessionId: "session-complete",
            prompt: "继续"
          },
          {
            provider: "deepwrite",
            model: "test",
            mode: "local-faux"
          },
          "message-complete"
        ).map((event) => event.type)
      ).toEqual(["agent.tool_completed"]);
    });

  it("locks Core queries to the active book, read roots and AbortSignal", async () => {
      const index = fixtureIndex();
      const characterFile = index.characterFiles[0]!.coreProfile;
      const seenSignals: Array<AbortSignal | undefined> = [];
      const executor = vi.fn<LongCommandExecutor>(async (command, signal) => {
        seenSignals.push(signal);
        if (command.type === "long.getWorkspaceIndex") return indexResult(index);
        if (command.type === "long.readDocument") {
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              file: characterFile,
              content: "人物档案正文",
              offset: 0,
              totalCharacters: 6,
              nextOffset: null,
              workspaceRevision: index.revision,
              projectRevision: 11
            }
          };
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            query: command.payload.query,
            scope: command.payload.scope,
            hits: [],
            nextCursor: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      });
      const characterProfile = profile("setting");
      characterProfile.readAccess.workspaceRoots = ["character_design"];
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "character_design"),
        profile: characterProfile,
        sessionId: "session-query",
        runId: "run-query",
        executor
      });
      const controller = new AbortController();
      await toolByName(tools, "read_setting").execute(
        "read-character",
        {
          domain: "character", character_id: "character_alice",
          document: "core_profile",
          mode: "full"
        },
        controller.signal
      );
      await toolByName(tools, "search_setting").execute(
        "search-character",
        { domain: "character", query: "人物" },
        controller.signal
      );

      expect(executor).toHaveBeenCalledTimes(3);
      expect(executor.mock.calls.map(([command]) => command.type)).toEqual([
        "long.getWorkspaceIndex",
        "long.readDocument",
        "long.search"
      ]);
      expect(
        executor.mock.calls.every(
          ([command]) =>
            command.payload.bookId === index.bookId &&
            !("path" in command.payload)
        )
      ).toBe(true);
      expect(seenSignals.every((signal) => signal === controller.signal)).toBe(true);

      const aborted = new AbortController();
      aborted.abort();
      await expect(
        toolByName(tools, "search_setting").execute(
          "search-aborted",
          { domain: "character", query: "人物" },
          aborted.signal
        )
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(executor).toHaveBeenCalledTimes(3);
    });

  it("uses unique command ids for concurrent document reads in one run", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(123);
      try {
        const index = fixtureIndex();
        const characterFile = index.characterFiles[0]!.coreProfile;
        const executor = vi.fn<LongCommandExecutor>(async (command) => {
          if (command.type === "long.getWorkspaceIndex") {
            return indexResult(index);
          }
          if (command.type !== "long.readDocument") {
            throw new Error(`Unexpected command: ${command.type}`);
          }
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              file: characterFile,
              content: "人物档案正文",
              offset: command.payload.offset,
              totalCharacters: 6,
              nextOffset: null,
              workspaceRevision: index.revision,
              projectRevision: 11
            }
          };
        });
        const tools = buildLongWorkspaceTools({
          workspace: workspace("setting", "character_design"),
          profile: profile("setting"),
          sessionId: "session-concurrent-query",
          runId: "run-concurrent-query",
          executor
        });
        const readTool = toolByName(tools, "read_setting");

        await Promise.all([
          readTool.execute("read-character-one", {
            domain: "character", character_id: "character_alice",
            document: "core_profile",
            mode: "full"
          }),
          readTool.execute("read-character-two", {
            domain: "character", character_id: "character_alice",
            document: "core_profile",
            mode: "full"
          })
        ]);

        const readCommandIds = executor.mock.calls
          .map(([command]) => command)
          .filter((command) => command.type === "long.readDocument")
          .map(({ id }) => id);
        expect(readCommandIds).toHaveLength(2);
        expect(new Set(readCommandIds).size).toBe(2);
      } finally {
        now.mockRestore();
      }
    });

  it("rejects a Core worldbuilding response that changes the internally mapped file", async () => {
      const index = fixtureIndex();
      const worldFile = fixtureWorldFile(index);
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(index);
        }
        if (command.type !== "long.readDocument") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: {
              ...worldFile,
              path: "long/worldbuilding/other/content.md"
            },
            content: "错误文件",
            offset: command.payload.offset,
            totalCharacters: 4,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-wrong-file",
        runId: "run-wrong-file",
        executor
      });

      await expect(
        toolByName(tools, "read_setting").execute(
          "read-wrong-file",
          { domain: "worldbuilding", category_id: "world_rules", mode: "full" }
        )
      ).rejects.toThrow(/different worldbuilding document/u);
    });

  it("builds typed mutation batches from the latest index without invoking a write command", async () => {
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type !== "long.getWorkspaceIndex") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        return indexResult();
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-mutation",
        runId: "run-mutation",
        executor
      });
      const proposal = await toolByName(tools, "propose_long_mutation").execute(
        "mutation-1",
        {
          domain: "worldbuilding", operations: [
            {
              type: "worldbuilding.update",
              id: "world_rules",
              patch: { title: "世界硬规则" }
            }
          ],
          summary: "更新世界规则标题"
        }
      );

      expect(executor).toHaveBeenCalledTimes(1);
      expect(executor.mock.calls[0]?.[0].type).toBe(
        "long.getWorkspaceIndex"
      );
      expect(proposal.details).toMatchObject({
        kind: "long-mutation-proposal",
        bookId: "longbook_tools",
        agentId: "setting",
        baseProjectRevision: 11,
        summary: "更新世界规则标题",
        batch: {
          baseRevision: 7,
          operations: [
            {
              type: "worldbuilding.update",
              id: "world_rules",
              patch: { title: "世界硬规则" }
            }
          ],
          documentWrites: []
        }
      });
      const parameterSchema = JSON.stringify(
        toolByName(tools, "propose_long_mutation").parameters
      );
      expect(parameterSchema).not.toMatch(
        /"batch"|"baseRevision"|"updatedAt"|"fileId"|"file_id"|"path"|"nextRevision"|"expectedRevision"/u
      );
      expect(parameterSchema).toContain('"worldbuilding.create"');
      expect(parameterSchema).not.toContain('"worldbuildingItem.create"');
      expect(parameterSchema).not.toContain('"document_updates"');
      expect(parameterSchema).not.toContain('"character.create"');
      expect(parameterSchema).not.toContain('"chapter.create"');
      expect(tools.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "list_setting",
          "search_setting",
          "read_setting",
          "create_setting",
          "write_setting",
          "edit_setting"
        ])
      );

      const createProposal = await toolByName(
        tools,
        "propose_long_mutation"
      ).execute("mutation-create", {
        domain: "worldbuilding", operations: [
          {
            type: "worldbuilding.create",
            client_ref: "weather",
            title: "气候",
            format: "text"
          }
        ],
        summary: "新增气候设定"
      });
      expect(createProposal.details).toMatchObject({
        kind: "long-mutation-proposal"
      });
      if (createProposal.details?.kind !== "long-mutation-proposal") {
        throw new Error("Expected a mutation proposal.");
      }
      const createdCategory = createProposal.details.batch.operations[0];
      expect(createdCategory).toMatchObject({
        type: "worldbuilding.create",
        category: {
          id: expect.stringMatching(/^world_[0-9a-f]{8}$/u),
          title: "气候",
          order: 2,
          format: "text",
          contentAuthority: "markdown",
          file: {
            revision:
              "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
          }
        }
      });
      if (createdCategory.type !== "worldbuilding.create") {
        throw new Error("Expected a worldbuilding create operation.");
      }
      expect(createdCategory.category.file.id).toBe(
        longWorldbuildingFileId(createdCategory.category.id)
      );
      expect(createdCategory.category.file.path).toBe(
        `long/worldbuilding/${createdCategory.category.id}/content.md`
      );

      await expect(
        toolByName(tools, "propose_long_mutation").execute("mutation-bad", {
          operations: [
            {
              type: "volume.update",
              id: "volume_one",
              patch: { title: "越权修改" }
            }
          ],
          summary: "越权"
        })
      ).rejects.toThrow(/outside the agent's write roots/u);
      await expect(
        toolByName(tools, "propose_long_mutation").execute(
          "mutation-empty-summary",
          {
            operations: [],
            summary: "   "
          }
        )
      ).rejects.toThrow(/non-whitespace text/u);
    });

  it("creates exactly one empty worldbuilding file and returns its stable item id", async () => {
      const index = fixtureIndex();
      index.worldbuilding = [{
        id: "world_rules",
        title: "世界规则",
        order: 1,
        format: "list",
        contentAuthority: "files",
        items: []
      }];
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(index);
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-world-items",
        runId: "run-world-items",
        executor
      });
      const createParameters = JSON.stringify(
        toolByName(tools, "create_setting").parameters
      );
      expect(createParameters).toContain('"title"');
      expect(createParameters).not.toContain('"content"');

      const proposal = await toolByName(
        tools,
        "create_setting"
      ).execute("create-world-items", {
        domain: "worldbuilding", category_id: "world_rules",
        title: "记忆代价"
      });

      expect(proposal.details).toMatchObject({
        kind: "long-worldbuilding-file-proposal",
        batch: {
          operations: [{
            type: "worldbuildingItem.create",
            categoryId: "world_rules",
            item: {
              id: expect.stringMatching(/^worlditem_[0-9a-f]{8}$/u),
              title: "记忆代价",
              file: {
                path: expect.stringContaining("/items/")
              }
            }
          }],
          documentWrites: []
        },
        files: [{
          categoryId: "world_rules",
          itemId: expect.stringMatching(/^worlditem_[0-9a-f]{8}$/u),
          title: "记忆代价",
          operation: "create",
          beforeText: "",
          afterText: "",
          beforeRevision: null,
          filePath: expect.stringContaining("/items/")
        }]
      });
      if (
        proposal.details?.kind !== "long-worldbuilding-file-proposal"
      ) {
        throw new Error("Expected a worldbuilding file creation proposal.");
      }
      const createdItemId = proposal.details.files[0]!.itemId!;
      const write = await toolByName(
        tools,
        "write_setting"
      ).execute("write-created-world-file", {
        domain: "worldbuilding", category_id: "world_rules",
        item_id: createdItemId,
        text: "每次施法都会遗忘一段记忆。"
      });
      expect(write.details).toMatchObject({
        kind: "long-worldbuilding-file-proposal",
        batch: {
          operations: [],
          documentWrites: [{
            mode: "replace",
            content: "每次施法都会遗忘一段记忆。"
          }]
        },
        files: [{
          itemId: createdItemId,
          operation: "write",
          beforeText: "",
          afterText: "每次施法都会遗忘一段记忆。"
        }]
      });
    });

  it("returns independent long worldbuilding file proposals for full writes and edits", async () => {
      const index = fixtureIndex();
      const category = index.worldbuilding[0]!;
      if (category.format !== "text") {
        throw new Error("Expected a text worldbuilding category.");
      }
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(index);
        }
        if (command.type === "long.readDocument") {
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              file: category.file,
              content: "旧规则。",
              offset: command.payload.offset,
              totalCharacters: 4,
              nextOffset: null,
              workspaceRevision: index.revision,
              projectRevision: 11
            }
          };
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-world-files",
        runId: "run-world-files",
        executor
      });

      await toolByName(tools, "read_setting").execute(
        "read-world-file",
        { domain: "worldbuilding", category_id: category.id, mode: "full" }
      );
      const write = await toolByName(
        tools,
        "write_setting"
      ).execute("write-world-file", {
        domain: "worldbuilding", category_id: category.id,
        text: "完整新规则。",
        allow_overwrite_existing: true
      });
      expect(write.details).toMatchObject({
        kind: "long-worldbuilding-file-proposal",
        files: [{
          categoryId: category.id,
          fileId: category.file.id,
          filePath: category.file.path,
          title: category.title,
          operation: "write",
          beforeText: "旧规则。",
          afterText: "完整新规则。",
          beforeRevision: category.file.revision
        }]
      });

      const edit = await toolByName(
        tools,
        "edit_setting"
      ).execute("edit-world-file", {
        domain: "worldbuilding", category_id: category.id,
        replacements: [{
          original_text: "完整新规则",
          new_text: "精炼新规则"
        }]
      });
      expect(edit.details).toMatchObject({
        kind: "long-worldbuilding-file-proposal",
        files: [{
          operation: "edit",
          beforeText: "完整新规则。",
          afterText: "精炼新规则。"
        }]
      });
    });

  it("creates one empty character and then writes its independent files", async () => {
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult();
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "character_design"),
        profile: profile("setting"),
        sessionId: "session-character-items",
        runId: "run-character-items",
        executor
      });

      const proposal = await toolByName(
        tools,
        "create_setting"
      ).execute("create-character", {
        domain: "character", name: "沈砚",
        type_id: "major_supporting",
        aliases: ["阿砚"]
      });

      expect(proposal.details).toMatchObject({
        kind: "long-character-file-proposal",
        batch: {
          operations: [{
            type: "character.create",
            character: {
              id: expect.stringMatching(/^character_[0-9a-f]{8}$/u),
              name: "沈砚",
              group: "major_supporting",
              aliases: ["阿砚"]
            },
            files: {
              coreProfile: {
                path: expect.stringMatching(
                  /^long\/characters\/character_[0-9a-f]{8}\/core-profile\.md$/u
                )
              },
              relationships: {
                path: expect.stringMatching(
                  /^long\/characters\/character_[0-9a-f]{8}\/relationships\.md$/u
                )
              },
              currentState: {
                path: expect.stringMatching(
                  /^long\/characters\/character_[0-9a-f]{8}\/current-state\.md$/u
                )
              },
              history: {
                path: expect.stringMatching(
                  /^long\/characters\/character_[0-9a-f]{8}\/history\.md$/u
                )
              }
            }
          }],
          documentWrites: []
        },
        files: expect.arrayContaining([
          expect.objectContaining({
            document: "core_profile",
            operation: "create",
            beforeRevision: null
          }),
          expect.objectContaining({
            document: "relationships",
            operation: "create",
            beforeRevision: null
          })
        ])
      });
      expect(proposal.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("character_id=character_")
      });
      if (proposal.details?.kind !== "long-character-file-proposal") {
        throw new Error("Expected a character file proposal.");
      }
      const characterId = proposal.details.files[0]!.characterId;
      const write = await toolByName(tools, "write_setting").execute(
        "write-created-character",
        {
          domain: "character", character_id: characterId,
          document: "core_profile",
          text: "沈砚是负责追查旧案的年轻捕快。"
        }
      );
      expect(write.details).toMatchObject({
        kind: "long-character-file-proposal",
        files: [{
          characterId,
          document: "core_profile",
          operation: "write",
          beforeText: "",
          afterText: "沈砚是负责追查旧案的年轻捕快。"
        }]
      });
    });
});
