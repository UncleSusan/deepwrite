import type {
  LongCommandExecutor,
  LongWorkspaceIndexSnapshot
} from "./long-agent-tools.test-support";
import {
  Check,
  REVISION,
  STORY_PLOT_BODY,
  buildLongWorkspaceTools,
  committedFixtureIndex,
  describe,
  expect,
  expectNoPhysicalWorldbuildingMetadata,
  fixtureIndex,
  fixtureStoryPlotIndex,
  fixtureWorldbuildingIndex,
  indexResult,
  it,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  profile,
  resultText,
  selectLongChaptersForWritingScope,
  selectNextLongChapterForDispatch,
  storyPlotExecutor,
  toolByName,
  vi,
  workspace
} from "./long-agent-tools.test-support";

describe("long workspace agent tools: plot-and-worldbuilding", () => {
  it("lists, reads, writes and edits story plots attached to a plot point", async () => {
    const index = fixtureStoryPlotIndex();
    const executor = storyPlotExecutor(index);
    const tools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-story-plot-tools",
      runId: "run-story-plot-tools",
      executor
    });

    const listed = await toolByName(tools, "list_plot_design").execute(
      "list-story-plots",
      { kind: "story_plot", arc_id: "arc_one" }
    );
    const listedText = listed.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(listedText).toContain("story_plot_id=storyplot_one");
    expect(listedText).toContain("arc_id=arc_one");
    expect(listedText).not.toContain("fileId");

    const premature = await toolByName(tools, "write_plot_design").execute(
      "write-without-read",
      {
        item: {
          kind: "story_plot",
          story_plot_id: "storyplot_one",
          text: "未读先写"
        },
        allow_overwrite_existing: true
      }
    );
    expect(resultText(premature)).toContain(
      "未写入：请先调用 read_plot_design"
    );

    const read = await toolByName(tools, "read_plot_design").execute(
      "read-story-plot",
      {
        target: { kind: "story_plot", story_plot_id: "storyplot_one" },
        mode: "full"
      }
    );
    const readText = resultText(read);
    expect(() => JSON.parse(readText)).toThrow();
    expect(readText).toContain("story_plot_id=storyplot_one");
    expect(readText).not.toContain('"story_plot_id"');
    expect(readText).toContain(STORY_PLOT_BODY);

    const unconfirmed = await toolByName(tools, "write_plot_design").execute(
      "write-without-confirm",
      {
        item: {
          kind: "story_plot",
          story_plot_id: "storyplot_one",
          text: "覆盖"
        }
      }
    );
    expect(resultText(unconfirmed)).toContain("allow_overwrite_existing=true");

    const nextBody = "城门内重逢，线索兑现。";
    const write = await toolByName(tools, "write_plot_design").execute(
      "write-story-plot",
      {
        item: {
          kind: "story_plot",
          story_plot_id: "storyplot_one",
          text: nextBody
        },
        allow_overwrite_existing: true,
        summary: "重写故事情节正文"
      }
    );
    expect(write.details).toMatchObject({
      kind: "long-mutation-proposal",
      summary: "重写故事情节正文",
      batch: {
        operations: [],
        documentWrites: [
          {
            fileId: longStoryPlotBodyFileId("storyplot_one"),
            content: nextBody,
            mode: "replace",
            expectedRevision: REVISION
          }
        ]
      }
    });
    const writeText = resultText(write);
    expect(writeText).toContain("已写入故事情节");
    expect(writeText).not.toContain("提案");
    expect(writeText).not.toContain("审批");

    const reread = await toolByName(tools, "read_plot_design").execute(
      "reread-after-write",
      {
        target: { kind: "story_plot", story_plot_id: "storyplot_one" },
        mode: "full"
      }
    );
    expect(resultText(reread)).toContain(nextBody);

    const editTools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-story-plot-edit",
      runId: "run-story-plot-edit",
      executor
    });
    await toolByName(editTools, "read_plot_design").execute("read-for-edit", {
      target: { kind: "story_plot", story_plot_id: "storyplot_one" },
      mode: "full"
    });
    const ambiguous = await toolByName(editTools, "edit_plot_design").execute(
      "edit-ambiguous",
      {
        item: {
          kind: "story_plot",
          story_plot_id: "storyplot_one",
          replacements: [{ original_text: "城中旧宅", new_text: "伏笔" }]
        }
      }
    );
    expect(resultText(ambiguous)).toContain("未替换：原文片段必须唯一存在");

    const edit = await toolByName(editTools, "edit_plot_design").execute(
      "edit-story-plot",
      {
        item: {
          kind: "story_plot",
          story_plot_id: "storyplot_one",
          replacements: [
            { original_text: "埋下北上线索", new_text: "北上线索改为南归" }
          ]
        },
        summary: "局部修改故事情节"
      }
    );
    expect(edit.details).toMatchObject({
      kind: "long-mutation-proposal",
      summary: "局部修改故事情节",
      batch: {
        operations: [],
        documentWrites: [
          {
            fileId: longStoryPlotBodyFileId("storyplot_one"),
            content: "城门外初遇追兵，北上线索改为南归。",
            mode: "replace",
            expectedRevision: REVISION
          }
        ]
      }
    });
  });

  it("allows plot design to refine a committed chapter card", async () => {
    const index = committedFixtureIndex();
    const chapter = index.chapters[0]!;
    const cardContent = "旧章卡内容";
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      expect(command.payload.fileId).toBe(chapter.card.id);
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: chapter.card,
          content: cardContent,
          offset: 0,
          totalCharacters: Array.from(cardContent).length,
          nextOffset: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-refine-committed-card",
      runId: "run-refine-committed-card",
      executor
    });

    await toolByName(tools, "read_plot_design").execute("read-committed-card", {
      target: { kind: "chapter", chapter_card_id: "chapter_one" },
      mode: "full"
    });
    const result = await toolByName(tools, "edit_plot_design").execute(
      "edit-committed-card",
      {
        item: {
          kind: "chapter",
          chapter_card_id: "chapter_one",
          replacements: [
            { original_text: cardContent, new_text: "精修后的章卡内容" }
          ]
        },
        summary: "精修已提交章卡"
      }
    );

    expect(result.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [],
        documentWrites: [
          {
            fileId: chapter.card.id,
            content: "精修后的章卡内容",
            mode: "replace"
          }
        ]
      }
    });
  });

  it("creates a chapter card and writes its complete text once without an extra read", async () => {
    const index = fixtureIndex();
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-chapter-card-tools",
      runId: "run-chapter-card-tools",
      executor
    });

    const create = await toolByName(tools, "create_plot_design").execute(
      "create-chapter-card",
      {
        domain: "worldbuilding",
        item: {
          kind: "chapter",
          volume_id: "volume_one",
          primary_arc_id: null,
          title: "第二章"
        },
        summary: "创建第二章章卡"
      }
    );
    const createDetails = create.details;
    if (!createDetails || createDetails.kind !== "long-mutation-proposal") {
      throw new Error("Expected a chapter-card creation proposal.");
    }
    const createOperation = createDetails.batch.operations[0];
    if (!createOperation || createOperation.type !== "chapter.create") {
      throw new Error("Expected a chapter.create operation.");
    }
    const chapterCardId = createOperation.chapterCard.id;
    expect(createOperation.chapterCard).toMatchObject({
      volumeId: "volume_one",
      primaryArcId: null,
      title: "第二章",
      narrativeOrder: 2
    });
    expect(createDetails.batch.documentWrites).toHaveLength(0);
    expect(resultText(create)).toContain("无需再次读取");

    const initialText = "本章从北门追逐开始，结尾揭示内应身份。";
    const write = await toolByName(tools, "write_plot_design").execute(
      "write-new-chapter-card",
      {
        item: {
          kind: "chapter",
          chapter_card_id: chapterCardId,
          text: initialText
        },
        summary: "一次性写入第二章章卡"
      }
    );
    expect(write.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [],
        documentWrites: [
          {
            fileId: createOperation.files.card.id,
            content: initialText,
            mode: "replace",
            expectedRevision: createOperation.files.card.revision
          }
        ]
      }
    });
    expect(resultText(write)).toContain("已写入章卡");

    const edit = await toolByName(tools, "edit_plot_design").execute(
      "edit-new-chapter-card",
      {
        item: {
          kind: "chapter",
          chapter_card_id: chapterCardId,
          replacements: [
            {
              original_text: "结尾揭示内应身份",
              new_text: "结尾只留下内应线索"
            }
          ]
        },
        summary: "调整第二章结尾"
      }
    );
    expect(edit.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [],
        documentWrites: [
          {
            fileId: createOperation.files.card.id,
            content: "本章从北门追逐开始，结尾只留下内应线索。",
            mode: "replace"
          }
        ]
      }
    });
  });

  it("creates story plots under a plot point and proposes story plot structure changes", async () => {
    const index = fixtureStoryPlotIndex();
    const executor = storyPlotExecutor(index);
    const tools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-story-plot-create",
      runId: "run-story-plot-create",
      executor
    });

    const create = await toolByName(tools, "create_plot_design").execute(
      "create-story-plot",
      {
        domain: "worldbuilding",
        item: {
          kind: "story_plot",
          arc_id: "arc_one",
          title: "新的故事情节"
        },
        summary: "创建故事情节"
      }
    );
    const createDetails = create.details;
    if (!createDetails || createDetails.kind !== "long-mutation-proposal") {
      throw new Error("Expected a mutation proposal.");
    }
    const createOperation = createDetails.batch.operations[0];
    if (!createOperation || createOperation.type !== "storyPlot.create") {
      throw new Error("Expected a storyPlot.create operation.");
    }
    expect(createOperation.storyPlot).toMatchObject({
      id: expect.stringMatching(/^storyplot_[0-9a-f]{8}$/u),
      arcId: "arc_one",
      title: "新的故事情节",
      order: 2,
      file: {
        id: longStoryPlotBodyFileId(createOperation.storyPlot.id),
        path: longStoryPlotFilePath(createOperation.storyPlot.id)
      }
    });
    expect(createDetails.batch.documentWrites).toHaveLength(0);

    const createdStoryPlotId = createOperation.storyPlot.id;
    const createText = resultText(create);
    expect(createText).toContain("已形成故事情节");
    expect(createText).toContain(createdStoryPlotId);
    expect(createText).toContain("创建提案");
    expect(createText).toContain("等待本创建提案获批");

    const secondCreate = await toolByName(tools, "create_plot_design").execute(
      "create-second-story-plot",
      {
        domain: "worldbuilding",
        item: {
          kind: "story_plot",
          arc_id: "arc_one",
          title: "第二个故事情节"
        },
        summary: "创建第二个故事情节"
      }
    );
    const secondDetails = secondCreate.details;
    if (!secondDetails || secondDetails.kind !== "long-mutation-proposal") {
      throw new Error("Expected a mutation proposal.");
    }
    const secondOperation = secondDetails.batch.operations[0];
    if (!secondOperation || secondOperation.type !== "storyPlot.create") {
      throw new Error("Expected a storyPlot.create operation.");
    }
    // 同一轮内第二个创建必须基于待落盘的第一个故事情节继续递增 order，
    // 否则落盘校验会因 order 不连续而失败。
    expect(secondOperation.storyPlot.order).toBe(3);
    expect(secondDetails.batch.documentWrites).toHaveLength(0);

    const pendingRead = await toolByName(tools, "read_plot_design").execute(
      "read-pending-story-plot",
      {
        target: { kind: "story_plot", story_plot_id: createdStoryPlotId },
        mode: "full"
      }
    );
    expect(resultText(pendingRead)).toContain(createdStoryPlotId);
    expect(resultText(pendingRead)).toContain("（内容为空）");

    const pendingList = await toolByName(tools, "list_plot_design").execute(
      "list-with-pending",
      { kind: "story_plot", arc_id: "arc_one" }
    );
    const pendingListText = resultText(pendingList);
    expect(pendingListText).toContain("story_plot_id=storyplot_one");
    expect(pendingListText).toContain(createdStoryPlotId);

    const pendingSearch = await toolByName(tools, "search_plot_design").execute(
      "search-pending",
      { domain: "worldbuilding", query: "新的故事情节", kind: "story_plot" }
    );
    expect(resultText(pendingSearch)).toContain(createdStoryPlotId);

    const pendingWrite = await toolByName(tools, "write_plot_design").execute(
      "write-pending-story-plot",
      {
        item: {
          kind: "story_plot",
          story_plot_id: createdStoryPlotId,
          text: "落盘前重写的正文。"
        },
        allow_overwrite_existing: true,
        summary: "重写待审故事情节"
      }
    );
    expect(resultText(pendingWrite)).toContain("已写入故事情节");
    expect(pendingWrite.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [],
        documentWrites: [
          {
            fileId: createOperation.storyPlot.file.id,
            content: "落盘前重写的正文。",
            mode: "replace"
          }
        ]
      }
    });

    const rereadPending = await toolByName(tools, "read_plot_design").execute(
      "reread-pending-story-plot",
      {
        target: { kind: "story_plot", story_plot_id: createdStoryPlotId },
        mode: "full"
      }
    );
    expect(resultText(rereadPending)).toContain("落盘前重写的正文。");

    const mutation = await toolByName(tools, "propose_long_mutation").execute(
      "story-plot-structure",
      {
        domain: "worldbuilding",
        operations: [
          {
            type: "storyPlot.update",
            id: "storyplot_one",
            patch: { title: "城门初遇（改）" }
          },
          {
            type: "storyPlot.reorder",
            arcId: "arc_one",
            orderedIds: ["storyplot_one"]
          },
          { type: "storyPlot.delete", id: "storyplot_one", cascade: true }
        ],
        summary: "调整故事情节结构"
      }
    );
    expect(mutation.details).toMatchObject({
      kind: "long-mutation-proposal",
      summary: "调整故事情节结构",
      batch: {
        operations: [
          {
            type: "storyPlot.update",
            id: "storyplot_one",
            patch: { title: "城门初遇（改）" }
          },
          {
            type: "storyPlot.reorder",
            arcId: "arc_one",
            orderedIds: ["storyplot_one"]
          },
          { type: "storyPlot.delete", id: "storyplot_one", cascade: true }
        ],
        documentWrites: []
      }
    });
  });

  it("lists worldbuilding through semantic ids and rejects physical-id parameters", async () => {
    const index = fixtureWorldbuildingIndex();
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type === "long.readDocument") {
        const category = index.worldbuilding.find(
          ({ id }) => id === "world_magic"
        );
        if (!category || category.format !== "list" || !category.overview) {
          throw new Error("Expected a list category overview.");
        }
        const overviewContent = "记忆代价：施法会消耗施法者的记忆。";
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: category.overview,
            content: overviewContent,
            offset: command.payload.offset,
            totalCharacters: Array.from(overviewContent).length,
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
      sessionId: "session-world-list",
      runId: "run-world-list",
      executor
    });
    const list = toolByName(tools, "list_setting");
    const read = toolByName(tools, "read_setting");
    const search = toolByName(tools, "search_setting");
    const write = toolByName(tools, "write_setting");

    for (const tool of [list, read, search, write]) {
      const parameterSchema = JSON.stringify(tool.parameters);
      for (const forbidden of [
        "file_id",
        "fileId",
        "book_id",
        "bookId",
        "path",
        "revision",
        "cursor"
      ]) {
        expect(parameterSchema).not.toContain(`"${forbidden}"`);
      }
    }
    expect(JSON.stringify(list.parameters)).not.toContain('"page"');
    expect(JSON.stringify(list.parameters)).not.toContain('"limit"');
    expect(JSON.stringify(search.parameters)).toContain('"page"');
    expect(JSON.stringify(search.parameters)).toContain('"limit"');
    expect(Check(list.parameters, {})).toBe(false);
    expect(Check(list.parameters, { domain: "worldbuilding" })).toBe(true);
    expect(Check(list.parameters, { page: 1, limit: 1 })).toBe(false);
    expect(
      Check(list.parameters, {
        domain: "worldbuilding",
        category_id: "world_rules",
        file_id: "file_world_rules:content"
      })
    ).toBe(false);
    expect(Check(search.parameters, { query: "记忆", limit: 101 })).toBe(false);
    expect(
      Check(read.parameters, {
        domain: "worldbuilding",
        category_id: "world_rules",
        mode: "preview"
      })
    ).toBe(true);
    expect(
      Check(read.parameters, {
        domain: "worldbuilding",
        category_id: "world_rules",
        file_id: "file_world_rules:content"
      })
    ).toBe(false);
    expect(
      Check(read.parameters, {
        domain: "worldbuilding",
        category_id: "file_world_rules:content",
        mode: "preview"
      })
    ).toBe(false);
    expect(
      Check(read.parameters, {
        domain: "worldbuilding",
        category_id: "world_magic",
        item_id: "file_worlditem_memory:content",
        mode: "full"
      })
    ).toBe(false);
    expect(
      Check(write.parameters, {
        domain: "worldbuilding",
        category_id: "file_world_rules:content",
        text: "不应接受文件 ID"
      })
    ).toBe(false);

    const categoriesText = resultText(
      await list.execute("list-world-categories", { domain: "worldbuilding" })
    );
    expect(() => JSON.parse(categoriesText)).toThrow();
    expect(categoriesText).toBe(
      [
        "世界观分类",
        "",
        "世界规则",
        "category_id=world_rules",
        "类型=文本",
        "",
        "魔法体系",
        "category_id=world_magic",
        "类型=条目列表",
        "条目数=2"
      ].join("\n")
    );
    expectNoPhysicalWorldbuildingMetadata(categoriesText);

    const itemsText = resultText(
      await list.execute("list-world-items", {
        domain: "worldbuilding",
        category_id: "world_magic"
      })
    );
    expect(() => JSON.parse(itemsText)).toThrow();
    expect(itemsText).toBe(
      [
        "分类：魔法体系",
        "category_id=world_magic",
        "类型=条目列表",
        "",
        "概览",
        "记忆代价：施法会消耗施法者的记忆。",
        "",
        "条目",
        "",
        "记忆代价",
        "item_id=worlditem_memory",
        "",
        "血脉门槛",
        "item_id=worlditem_blood"
      ].join("\n")
    );
    expectNoPhysicalWorldbuildingMetadata(itemsText);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("reads worldbuilding through internal file mappings without leaking them", async () => {
    const index = fixtureWorldbuildingIndex();
    const category = index.worldbuilding.find(({ id }) => id === "world_magic");
    if (!category || category.format !== "list") {
      throw new Error("Expected the fixture magic category to be a list.");
    }
    const item = category.items[0]!;
    const replacementSource = "每次施法都会遗忘一段记忆。";
    const middleMarker = "WORLD_BUILDING_MIDDLE_SENTINEL";
    const content = `${"开篇".repeat(130)}${replacementSource}${middleMarker}${"收束".repeat(130)}`;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const isOverview = command.payload.fileId === category.overview?.id;
      expect([item.file.id, category.overview?.id]).toContain(
        command.payload.fileId
      );
      const resultContent = isOverview
        ? "记忆代价：施法会消耗施法者的记忆。"
        : content;
      const resultFile = isOverview ? category.overview! : item.file;
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: resultFile,
          content: resultContent,
          offset: command.payload.offset,
          totalCharacters: Array.from(resultContent).length,
          nextOffset: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("setting", "worldbuilding"),
      profile: profile("setting"),
      sessionId: "session-world-read",
      runId: "run-world-read",
      executor
    });
    const read = toolByName(tools, "read_setting");
    const edit = toolByName(tools, "edit_setting");

    const preview = await read.execute("preview-world-item", {
      domain: "worldbuilding",
      category_id: category.id,
      item_id: item.id,
      mode: "preview"
    });
    const previewText = resultText(preview);
    expect(previewText).toContain("【魔法体系 / 记忆代价】");
    expect(previewText).toContain("预览（不建立整体覆盖凭据）");
    expect(previewText).not.toContain(middleMarker);
    expectNoPhysicalWorldbuildingMetadata(previewText);

    const blockedEdit = await edit.execute("edit-after-preview", {
      domain: "worldbuilding",
      category_id: category.id,
      item_id: item.id,
      replacements: [
        {
          original_text: replacementSource,
          new_text: "每次施法都会遗忘一段珍贵记忆。"
        }
      ]
    });
    expect(resultText(blockedEdit)).toContain(
      "read_setting（domain=worldbuilding，mode=full）"
    );

    const full = await read.execute("full-world-item", {
      domain: "worldbuilding",
      category_id: category.id,
      item_id: item.id,
      mode: "full"
    });
    const fullText = resultText(full);
    expect(fullText).toContain(middleMarker);
    expect(fullText).toContain(replacementSource);
    expectNoPhysicalWorldbuildingMetadata(fullText);

    const edited = await edit.execute("edit-after-full", {
      domain: "worldbuilding",
      category_id: category.id,
      item_id: item.id,
      replacements: [
        {
          original_text: replacementSource,
          new_text: "每次施法都会遗忘一段珍贵记忆。"
        }
      ]
    });
    expect(edited.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      files: [
        {
          categoryId: category.id,
          itemId: item.id,
          operation: "edit",
          afterText: expect.stringContaining("珍贵记忆")
        }
      ]
    });
    await expect(
      read.execute("text-category-with-item", {
        domain: "worldbuilding",
        category_id: "world_rules",
        item_id: item.id,
        mode: "full"
      })
    ).rejects.toThrow(/do not have items/u);
    const overview = await read.execute("list-category-without-item", {
      domain: "worldbuilding",
      category_id: category.id,
      mode: "full"
    });
    expect(resultText(overview)).toContain("【魔法体系 / 概览】");
    expect(resultText(overview)).toContain(
      "记忆代价：施法会消耗施法者的记忆。"
    );
  });

  it("maps Core worldbuilding search hits back to category and item ids", async () => {
    const index = fixtureWorldbuildingIndex();
    const textCategory = index.worldbuilding.find(
      ({ id }) => id === "world_rules"
    );
    const listCategory = index.worldbuilding.find(
      ({ id }) => id === "world_magic"
    );
    if (
      !textCategory ||
      textCategory.format !== "text" ||
      !listCategory ||
      listCategory.format !== "list"
    ) {
      throw new Error("Expected both worldbuilding fixture categories.");
    }
    const item = listCategory.items[0]!;
    let returnUnknownFile = false;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type !== "long.search") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      expect(command.payload.bookId).toBe(index.bookId);
      expect(command.payload.scope).toBe("worldbuilding");
      expect(command.payload.limit).toBe(2);
      expect(command.payload).not.toHaveProperty("path");
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          query: command.payload.query,
          scope: "worldbuilding",
          hits: returnUnknownFile
            ? [
                {
                  fileId: "file_worlditem_unknown:content",
                  path: "long/worldbuilding/world_magic/items/worlditem_unknown.md",
                  root: "worldbuilding",
                  title: "不应映射的文件",
                  start: 0,
                  end: 2,
                  snippet: "未知命中",
                  revision: REVISION
                }
              ]
            : [
                {
                  fileId: textCategory.file.id,
                  path: textCategory.file.path,
                  root: "worldbuilding",
                  title: "Core 内部标题",
                  start: 0,
                  end: 2,
                  snippet: "规则命中",
                  revision: textCategory.file.revision
                },
                {
                  fileId: item.file.id,
                  path: item.file.path,
                  root: "worldbuilding",
                  title: "Core 内部条目标题",
                  start: 3,
                  end: 5,
                  snippet: "记忆命中",
                  revision: item.file.revision
                }
              ],
          nextCursor: "core-private-page-token",
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("setting", "worldbuilding"),
      profile: profile("setting"),
      sessionId: "session-world-search",
      runId: "run-world-search",
      executor
    });
    const search = toolByName(tools, "search_setting");

    const result = JSON.parse(
      resultText(
        await search.execute("search-world", {
          domain: "worldbuilding",
          query: "记忆",
          page: 1,
          limit: 2
        })
      )
    );
    expect(result).toEqual({
      hits: [
        {
          category_id: "world_rules",
          title: "世界规则",
          snippet: "规则命中"
        },
        {
          category_id: "world_magic",
          item_id: "worlditem_memory",
          title: "记忆代价",
          snippet: "记忆命中"
        }
      ],
      next_page: 2
    });
    const resultTextValue = JSON.stringify(result);
    expect(resultTextValue).not.toContain("core-private-page-token");
    expectNoPhysicalWorldbuildingMetadata(resultTextValue);

    const filtered = JSON.parse(
      resultText(
        await search.execute("search-world-category", {
          domain: "worldbuilding",
          query: "记忆",
          category_id: "world_magic",
          page: 1,
          limit: 2
        })
      )
    );
    expect(filtered.hits).toEqual([
      {
        category_id: "world_magic",
        item_id: "worlditem_memory",
        title: "记忆代价",
        snippet: "记忆命中"
      }
    ]);
    expectNoPhysicalWorldbuildingMetadata(JSON.stringify(filtered));

    returnUnknownFile = true;
    await expect(
      search.execute("search-world-unknown-file", {
        domain: "worldbuilding",
        query: "未知",
        page: 1,
        limit: 2
      })
    ).rejects.toThrow(/unknown worldbuilding document/u);
  });

  it("selects the continuous next chapter by volume and in-volume narrative order", () => {
    const index = {
      plot: {
        volumes: [
          { id: "volume_two", order: 2 },
          { id: "volume_one", order: 1 }
        ],
        chapterCards: [
          {
            id: "chapter_volume_two",
            volumeId: "volume_two",
            narrativeOrder: 1
          },
          {
            id: "chapter_one_second",
            volumeId: "volume_one",
            narrativeOrder: 2
          },
          {
            id: "chapter_one_first",
            volumeId: "volume_one",
            narrativeOrder: 1
          }
        ]
      },
      ledger: {
        commits: [{ chapterCardId: "chapter_one_first" }]
      },
      chapters: [
        { chapterCardId: "chapter_one_first", bodyStatus: "written" },
        { chapterCardId: "chapter_one_second", bodyStatus: "empty" },
        { chapterCardId: "chapter_volume_two", bodyStatus: "empty" }
      ]
    } as unknown as LongWorkspaceIndexSnapshot;

    expect(selectNextLongChapterForDispatch(index)).toMatchObject({
      id: "chapter_one_second"
    });
    index.chapters[1]!.bodyStatus = "written";
    index.chapters[2]!.bodyStatus = "written";
    expect(selectNextLongChapterForDispatch(index)).toBeUndefined();
  });

  it("selects chapter, contiguous arc, or current volume without allowing book scope", () => {
    const index = {
      plot: {
        volumes: [
          { id: "volume_two", order: 2 },
          { id: "volume_one", order: 1 }
        ],
        chapterCards: [
          {
            id: "chapter_four",
            volumeId: "volume_one",
            primaryArcId: "arc_one",
            narrativeOrder: 4
          },
          {
            id: "chapter_five",
            volumeId: "volume_two",
            primaryArcId: "arc_three",
            narrativeOrder: 1
          },
          {
            id: "chapter_two",
            volumeId: "volume_one",
            primaryArcId: "arc_one",
            narrativeOrder: 2
          },
          {
            id: "chapter_three",
            volumeId: "volume_one",
            primaryArcId: "arc_two",
            narrativeOrder: 3
          },
          {
            id: "chapter_one",
            volumeId: "volume_one",
            primaryArcId: "arc_one",
            narrativeOrder: 1
          }
        ]
      },
      ledger: { commits: [] }
    } as unknown as LongWorkspaceIndexSnapshot;

    expect(
      selectLongChaptersForWritingScope(index, { scope: "chapter" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_one"]);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "arc" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_one", "chapter_two"]);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "volume" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_one", "chapter_two", "chapter_three", "chapter_four"]);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "book" as never
      })
    ).toThrow(/whole-book/u);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "chapter",
        arcId: "arc_one"
      })
    ).toThrow(/selector.*another scope/u);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "arc",
        volumeId: "volume_one"
      })
    ).toThrow(/selector.*another scope/u);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "volume",
        chapterCardId: "chapter_one"
      })
    ).toThrow(/selector.*another scope/u);

    index.ledger.commits.push({} as never, {} as never);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "arc" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_three"]);

    index.ledger.commits.length = 0;
    index.plot.chapterCards.find(
      ({ id }) => id === "chapter_one"
    )!.primaryArcId = null;
    expect(() =>
      selectLongChaptersForWritingScope(index, { scope: "arc" })
    ).toThrow(/primary arc/u);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "volume" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_one", "chapter_two", "chapter_three", "chapter_four"]);
  });
});
