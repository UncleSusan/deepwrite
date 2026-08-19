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

describe("long workspace agent tools: capabilities-and-plot-reading", () => {
  it("assembles exact query and proposal tools by long capability only", () => {
      const worldNames = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-world",
        runId: "run-world"
      }).map((tool) => tool.name);
      const characterNames = buildLongWorkspaceTools({
        workspace: workspace("setting", "character_design"),
        profile: profile("setting"),
        sessionId: "session-character",
        runId: "run-character"
      }).map((tool) => tool.name);
      const writerNames = buildLongWorkspaceTools({
        workspace: workspace("draft", "draft", "chapter_one"),
        profile: profile("draft"),
        sessionId: "session-writer",
        runId: "run-writer"
      }).map((tool) => tool.name);
      const ledgerNames = buildLongWorkspaceTools({
        workspace: workspace("continuity_ledger", "continuity_ledger", "chapter_one"),
        profile: profile("continuity_ledger"),
        sessionId: "session-ledger",
        runId: "run-ledger"
      }).map((tool) => tool.name);
      const ledgerReadOnlyNames = buildLongWorkspaceTools({
        workspace: workspace("continuity_ledger", "continuity_ledger"),
        profile: profile("continuity_ledger"),
        sessionId: "session-ledger-read-only",
        runId: "run-ledger-read-only"
      }).map((tool) => tool.name);
      const draftNames = buildLongWorkspaceTools({
        workspace: workspace("draft", "draft"),
        profile: profile("draft"),
        sessionId: "session-draft",
        runId: "run-draft"
      }).map((tool) => tool.name);
      const plotNames = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-plot",
        runId: "run-plot"
      }).map((tool) => tool.name);
      const forgedSettingProfile = profile("setting");
      forgedSettingProfile.writeAccess.capabilities.push(
        "write_chapter_files"
      );
      forgedSettingProfile.writeAccess.workspaceRoots.push("draft");
      const forgedSettingNames = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding", "chapter_one"),
        profile: forgedSettingProfile,
        sessionId: "session-forged-setting",
        runId: "run-forged-setting"
      }).map((tool) => tool.name);
      const rootlessLedgerProfile = profile("continuity_ledger");
      rootlessLedgerProfile.writeAccess.workspaceRoots =
        rootlessLedgerProfile.writeAccess.workspaceRoots.filter(
          (root) => root !== "continuity_ledger"
        );
      const rootlessLedgerNames = buildLongWorkspaceTools({
        workspace: workspace(
          "continuity_ledger",
          "continuity_ledger",
          "chapter_one"
        ),
        profile: rootlessLedgerProfile,
        sessionId: "session-rootless-ledger",
        runId: "run-rootless-ledger"
      }).map((tool) => tool.name);

      const settingNames = [
        "query_linked_material_entries",
        "load_skill",
        "get_long_chapter_readiness",
        "list_setting",
        "search_setting",
        "read_setting",
        "create_setting",
        "write_setting",
        "edit_setting",
        "list_plot_design",
        "search_plot_design",
        "read_plot_design",
        "propose_long_mutation",
        "list_chapters",
        "search_chapters",
        "read_chapter",
        "list_continuity_files",
        "read_continuity_file"
      ];
      expect(worldNames).toEqual(settingNames);
      expect(characterNames).toEqual(settingNames);
      expect(worldNames).not.toEqual(
        expect.arrayContaining([
          "get_long_workspace_index",
          "read_long_document",
          "search_long_workspace",
          "list_worldbuilding",
          "list_characters"
        ])
      );
      const characterMutationSchema = JSON.stringify(
        toolByName(
          buildLongWorkspaceTools({
            workspace: workspace("setting", "character_design"),
            profile: profile("setting"),
            sessionId: "session-character-schema",
            runId: "run-character-schema"
          }),
          "propose_long_mutation"
        ).parameters
      );
      expect(characterMutationSchema).toContain('"character.update"');
      expect(characterMutationSchema).toContain('"worldbuilding.update"');
      expect(characterMutationSchema).not.toContain('"character.create"');
      expect(characterMutationSchema).not.toContain('"worldbuildingItem.create"');
      expect(characterMutationSchema).not.toContain('"document_updates"');
      expect(writerNames).toEqual([
        "query_linked_material_entries",
        "load_skill",
        "get_long_chapter_readiness",
        "list_setting",
        "search_setting",
        "read_setting",
        "list_plot_design",
        "search_plot_design",
        "read_plot_design",
        "propose_long_chapter_dispatch",
        "list_chapters",
        "search_chapters",
        "read_chapter",
        "write_chapter_draft",
        "edit_chapter_draft",
        "list_continuity_files",
        "read_continuity_file"
      ]);
      expect(ledgerNames).toEqual([
        "query_linked_material_entries",
        "load_skill",
        "get_long_chapter_readiness",
        "list_setting",
        "search_setting",
        "read_setting",
        "list_plot_design",
        "search_plot_design",
        "read_plot_design",
        "list_chapters",
        "search_chapters",
        "read_chapter",
        "list_continuity_files",
        "read_continuity_file",
        "create_continuity_file",
        "delete_continuity_file",
        "write_continuity_file",
        "edit_continuity_file",
        "propose_continuity_commit"
      ]);
      expect(ledgerReadOnlyNames).toEqual([
        "query_linked_material_entries",
        "load_skill",
        "get_long_chapter_readiness",
        "list_setting",
        "search_setting",
        "read_setting",
        "list_plot_design",
        "search_plot_design",
        "read_plot_design",
        "list_chapters",
        "search_chapters",
        "read_chapter",
        "list_continuity_files",
        "read_continuity_file",
        "create_continuity_file",
        "delete_continuity_file",
        "write_continuity_file",
        "edit_continuity_file",
        "propose_continuity_commit"
      ]);
      expect(draftNames).toEqual([
        "query_linked_material_entries",
        "load_skill",
        "get_long_chapter_readiness",
        "list_setting",
        "search_setting",
        "read_setting",
        "list_plot_design",
        "search_plot_design",
        "read_plot_design",
        "propose_long_chapter_dispatch",
        "list_chapters",
        "search_chapters",
        "read_chapter",
        "list_continuity_files",
        "read_continuity_file"
      ]);
      expect(plotNames).toEqual([
        "query_linked_material_entries",
        "load_skill",
        "get_long_chapter_readiness",
        "list_setting",
        "search_setting",
        "read_setting",
        "list_plot_design",
        "search_plot_design",
        "read_plot_design",
        "create_plot_design",
        "write_plot_design",
        "edit_plot_design",
        "propose_long_mutation",
        "propose_long_chapter_dispatch",
        "list_chapters",
        "search_chapters",
        "read_chapter",
        "list_continuity_files",
        "read_continuity_file"
      ]);
      const plotTools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-plot-schema",
        runId: "run-plot-schema"
      });
      const plotMutationSchema = JSON.stringify(
        toolByName(plotTools, "propose_long_mutation").parameters
      );
      const plotMutationDescription = toolByName(
        plotTools,
        "propose_long_mutation"
      ).description;
      expect(plotMutationDescription).toContain("连续性记录只作参考");
      expect(plotMutationDescription).toContain("不锁定这些结构");
      expect(plotMutationDescription).toContain("级联清理该章正文与记录");
      expect(plotMutationDescription).toContain("剧情点关联可为 null");
      expect(plotMutationDescription).toContain("预检失败不会生成审批卡");
      expect(toolByName(plotTools, "read_plot_design").description).toContain(
        "读取剧情点时一次返回概要"
      );
      expect(toolByName(plotTools, "write_plot_design").description).toContain(
        "读取剧情点（mode=full）也会同时建立其下故事事件与故事情节的完整读取凭据"
      );
      expect(toolByName(plotTools, "edit_plot_design").description).toContain(
        "读取剧情点（mode=full）后可直接局部修改该剧情点及其下故事事件、故事情节"
      );
      expect(plotMutationSchema).toContain("toPrimaryArcId 非空时必须属于该分卷");
      expect(plotMutationSchema).toContain('"null"');
      expect(plotMutationSchema).toContain('"foreshadowing.create"');
      expect(plotMutationSchema).toContain('"foreshadowingBeat.create"');
      expect(plotMutationSchema).toContain('"volume.update"');
      expect(plotMutationSchema).toContain('"storyPlot.update"');
      expect(plotMutationSchema).toContain('"storyPlot.delete"');
      expect(plotMutationSchema).toContain('"storyPlot.reorder"');
      expect(plotMutationSchema).not.toContain('"storyPlot.create"');
      expect(plotMutationSchema).not.toContain('"volume.create"');
      expect(plotMutationSchema).not.toContain('"arc.create"');
      expect(plotMutationSchema).not.toContain('"chapter.create"');
      expect(plotMutationSchema).not.toContain('"event.create"');
      expect(plotMutationSchema).not.toContain('"connection.create"');
      expect(plotMutationSchema).not.toContain('"placement.create"');
      expect(plotMutationSchema).not.toContain('"document_updates"');
      expect(
        [...worldNames, ...characterNames, ...writerNames, ...ledgerNames]
      ).not.toContain("write_workspace_editor");
      expect(forgedSettingNames).not.toContain("write_chapter_draft");
      expect(rootlessLedgerNames).not.toContain(
        "propose_continuity_commit"
      );
    });

  it("publishes unified setting tools with provider-compatible object roots", () => {
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-setting-provider-schema",
        runId: "run-setting-provider-schema"
      });

      for (const name of [
        "list_setting",
        "search_setting",
        "read_setting",
        "create_setting",
        "write_setting",
        "edit_setting"
      ]) {
        const schema = toolByName(tools, name).parameters as {
          type?: unknown;
          anyOf?: unknown;
        };
        expect(schema.type).toBe("object");
        expect(schema.anyOf).toBeInstanceOf(Array);
      }

      const listSchema = toolByName(tools, "list_setting").parameters;
      expect(Check(listSchema, { domain: "worldbuilding" })).toBe(true);
      expect(Check(listSchema, { domain: "character" })).toBe(true);
      expect(Check(listSchema, {})).toBe(false);
    });

  it("rejects a cross-volume chapter move before creating an approval proposal", async () => {
      const source = fixtureIndex();
      source.plot.volumes.push({
        id: "volume_prologue",
        title: "开篇/楔子卷",
        order: 2,
        summary: ""
      });
      const index = LongWorkspaceIndexSnapshotSchema.parse(source);
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(index);
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-cross-volume-chapter-move",
        runId: "run-cross-volume-chapter-move",
        executor
      });

      const result = await toolByName(
        tools,
        "propose_long_mutation"
      ).execute("cross-volume-chapter-move", {
        operations: [
          {
            type: "chapter.move",
            id: "chapter_one",
            toVolumeId: "volume_prologue",
            toPrimaryArcId: "arc_one"
          }
        ],
        summary: "将楔子章移入开篇卷并保留正片弧"
      });

      expect(result.details).toEqual({ kind: "none" });
      expect(resultText(result)).toContain("未形成长篇结构变更提案");
      expect(resultText(result)).toContain("开篇/楔子卷");
      expect(resultText(result)).toContain("主线");
      expect(resultText(result)).toContain("非空剧情点关联必须与章卡属于同一分卷");
      expect(resultText(result)).toContain("不会生成审批卡");
      expect(resultText(result)).toContain("将剧情点关联设为 null");

      const createResult = await toolByName(
        tools,
        "create_plot_design"
      ).execute("cross-volume-chapter-create", {
        domain: "worldbuilding", item: {
          kind: "chapter",
          volume_id: "volume_prologue",
          primary_arc_id: "arc_one",
          title: "楔子章"
        },
        summary: "在开篇卷创建绑定正片弧的楔子章"
      });
      expect(createResult.details).toEqual({ kind: "none" });
      expect(resultText(createResult)).toContain("章卡创建存在跨卷绑定");
      expect(resultText(createResult)).toContain("不会生成审批卡");

      const orderedResult = await toolByName(
        tools,
        "propose_long_mutation"
      ).execute("move-arc-before-chapter", {
        operations: [
          {
            type: "arc.move",
            id: "arc_one",
            toVolumeId: "volume_prologue"
          },
          {
            type: "chapter.move",
            id: "chapter_one",
            toVolumeId: "volume_prologue",
            toPrimaryArcId: "arc_one"
          }
        ],
        summary: "先移动主线，再核对章卡归属"
      });
      expect(orderedResult.details).toMatchObject({
        kind: "long-mutation-proposal"
      });
      expect(executor).toHaveBeenCalledTimes(1);
    });

  it("preflights plot-specific writes against committed event locks", async () => {
      const source = fixtureIndex();
      source.plot.storyEvents.push({
        id: "event_committed",
        title: "楔子事件",
        summary: "楔子中已经发生的事件。",
        timeMode: "sequence",
        timeLabel: "故事开始前",
        storyOrder: 1,
        location: "旧城门",
        arcIds: ["arc_one"],
        characterIds: ["character_alice"]
      });
      source.plot.narrativePlacements.push({
        id: "placement_committed",
        eventId: "event_committed",
        chapterCardId: "chapter_one",
        orderInChapter: 1,
        mode: "scene",
        disclosure: "full",
        writingPrompt: "完整呈现楔子事件。",
        status: "committed",
        commitId: "commit_one"
      });
      source.chapters[0]!.commitId = "commit_one";
      source.ledger.committedThroughChapterId = "chapter_one";
      source.ledger.commits.push({
        id: "commit_one",
        mode: "structured",
        sequence: 1,
        chapterCardId: "chapter_one",
        committedAt: NOW,
        reversible: true,
        sourceRevision: 6,
        placementIds: ["placement_committed"],
        foreshadowingBeatIds: [],
        recordFile: file(
          longLedgerCommitFileId("commit_one"),
          "long/ledger/commit-one.json"
        )
      });
      const index = LongWorkspaceIndexSnapshotSchema.parse(source);
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(index);
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-committed-event-write",
        runId: "run-committed-event-write",
        executor
      });

      await toolByName(tools, "read_plot_design").execute(
        "read-committed-event",
        {
          target: { kind: "event", event_id: "event_committed" },
          mode: "full"
        }
      );
      const result = await toolByName(tools, "write_plot_design").execute(
        "write-committed-event",
        {
          domain: "character", item: {
            kind: "event",
            event_id: "event_committed",
            summary: "试图改变已经提交的事件。",
            time_mode: "sequence",
            time_label: "故事开始前",
            location: "旧城门",
            arc_ids: ["arc_one"],
            character_ids: ["character_alice"]
          },
          allow_overwrite_existing: true,
          summary: "修改已提交事件"
        }
      );

      expect(result.details).toMatchObject({
        kind: "long-mutation-proposal"
      });
    });

  it("loads only long-bound resources allowed by the active long profile", async () => {
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-resources",
        runId: "run-resources",
        attachedMaterials: [
          {
            id: "material-plot",
            title: "潮汐设定",
            source: "attached-material",
            kind: "plot",
            content: "逆潮每十年出现一次。"
          },
          {
            id: "material-draft",
            title: "正文样章",
            source: "attached-material",
            kind: "draft",
            content: "世界观智能体不应读取这段。"
          }
        ],
        attachedSkills: [
          {
            id: "skill-general",
            title: "规则一致性",
            source: "attached-skill",
            kind: "general",
            content: "先检查规则是否自洽。"
          }
        ]
      });
      const listed = await toolByName(
        tools,
        "query_linked_material_entries"
      ).execute("list-materials", { mode: "list" });
      expect(listed.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("潮汐设定")
      });
      expect(JSON.stringify(listed.content)).toContain("正文样章");

      const skill = await toolByName(tools, "load_skill").execute(
        "load-skill",
        { name: "规则一致性" }
      );
      expect(skill.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("先检查规则是否自洽")
      });
    });

  it("lists plot design as paragraph text without pagination", async () => {
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
        sessionId: "session-plot-list",
        runId: "run-plot-list",
        executor
      });
      const list = toolByName(tools, "list_plot_design");
      const read = toolByName(tools, "read_plot_design");
      const preparedChapterAlias = list.prepareArguments?.({
        kind: "chapter_card"
      });
      const preparedChapterTarget = read.prepareArguments?.({
        target: {
          kind: "chapter_card",
          chapter_card_id: "chapter_one"
        }
      });

      expect(JSON.stringify(list.parameters)).not.toContain('"page"');
      expect(JSON.stringify(list.parameters)).not.toContain('"limit"');
      expect(list.description).toContain("章卡对应 kind=chapter");
      expect(Check(list.parameters, {})).toBe(true);
      expect(Check(list.parameters, { kind: "arc", volume_id: "volume_one" })).toBe(
        true
      );
      expect(Check(list.parameters, { kind: "chapter_card" })).toBe(false);
      expect(preparedChapterAlias).toEqual({ kind: "chapter" });
      expect(Check(list.parameters, preparedChapterAlias)).toBe(true);
      expect(preparedChapterTarget).toEqual({
        target: { kind: "chapter", chapter_card_id: "chapter_one" }
      });
      expect(Check(read.parameters, preparedChapterTarget)).toBe(true);
      expect(Check(list.parameters, { page: 1, limit: 1 })).toBe(false);

      const kindsText = resultText(await list.execute("list-kinds", {}));
      expect(() => JSON.parse(kindsText)).toThrow();
      expect(kindsText).toBe(
        [
          "剧情结构",
          "",
          "全书故事线",
          "kind=book_line",
          "条目数=1",
          "",
          "分卷",
          "kind=volume",
          "条目数=1",
          "",
          "剧情点",
          "kind=arc",
          "条目数=1",
          "",
          "故事情节",
          "kind=story_plot",
          "条目数=0",
          "",
          "章卡",
          "kind=chapter",
          "条目数=1",
          "",
          "故事事件",
          "kind=event",
          "条目数=0",
          "",
          "事件连接",
          "kind=connection",
          "条目数=0",
          "",
          "叙事落点",
          "kind=placement",
          "条目数=0"
        ].join("\n")
      );
      expect(kindsText).not.toContain("next_page");
      expect(kindsText).not.toContain("fileId");

      const bookLineText = resultText(
        await list.execute("list-book-line", { kind: "book_line" })
      );
      expect(bookLineText).toBe(["全书故事线", "kind=book_line"].join("\n"));

      const arcsText = resultText(
        await list.execute("list-arcs", { kind: "arc", volume_id: "volume_one" })
      );
      expect(() => JSON.parse(arcsText)).toThrow();
      expect(arcsText).toBe(
        [
          "剧情点",
          "",
          "主线",
          "arc_id=arc_one",
          "volume_id=volume_one",
          "顺序=1"
        ].join("\n")
      );

      const chaptersText = resultText(
        await list.execute("list-chapters", { kind: "chapter" })
      );
      expect(chaptersText).toBe(
        [
          "章卡",
          "",
          "第一章",
          "chapter_card_id=chapter_one",
          "volume_id=volume_one",
          "primary_arc_id=arc_one",
          "叙事顺序=1"
        ].join("\n")
      );

      const emptyEventsText = resultText(
        await list.execute("list-events", { kind: "event" })
      );
      expect(emptyEventsText).toBe(["故事事件", "（暂无故事事件）"].join("\n\n"));
    });

  it("reads plot design as paragraph text instead of JSON", async () => {
      const index = structuredClone(fixtureIndex());
      index.plot.volumes[0]!.title = "第一卷 青阳城·凡界蝼蚁";
      index.plot.volumes[0]!.summary = [
        "约1—180章，境界从凡人、炼气推进至筑基。核心是从被家族判定无望的蝼蚁，到拥有走出凡界资格的修士。本卷承担世界与金手指落地、主角性格建立、第一批敌友登场，青云宗成长体系展开，以及父亲失踪主线第一次抬头。",
        "外部矛盾：凌家主脉及赵昊凭天资和资源垄断羞辱主角；进入青云宗后，外门规则、资深弟子与资源匮乏继续压迫。"
      ].join("\n\n");
      index.plot.arcs[0]!.summary = "从凡界蝼蚁走到宗门门槛。";
      index.plot.arcs[0]!.outline = "城门受辱后转入青云宗试炼。";
      const snapshot = LongWorkspaceIndexSnapshotSchema.parse(index);
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(snapshot);
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-plot-read-paragraphs",
        runId: "run-plot-read-paragraphs",
        executor
      });
      const read = toolByName(tools, "read_plot_design");

      const volumeText = resultText(
        await read.execute("read-volume", {
          target: { kind: "volume", volume_id: "volume_one" },
          mode: "full"
        })
      );
      expect(() => JSON.parse(volumeText)).toThrow();
      expect(volumeText).not.toContain('"kind"');
      expect(volumeText).not.toContain('"volume_id"');
      expect(volumeText).not.toContain("\\n");
      expect(volumeText).toBe(
        [
          "完整内容：",
          "",
          "第一卷 青阳城·凡界蝼蚁",
          "kind=volume",
          "volume_id=volume_one",
          "顺序=1",
          "",
          "概要",
          "约1—180章，境界从凡人、炼气推进至筑基。核心是从被家族判定无望的蝼蚁，到拥有走出凡界资格的修士。本卷承担世界与金手指落地、主角性格建立、第一批敌友登场，青云宗成长体系展开，以及父亲失踪主线第一次抬头。",
          "",
          "外部矛盾：凌家主脉及赵昊凭天资和资源垄断羞辱主角；进入青云宗后，外门规则、资深弟子与资源匮乏继续压迫。"
        ].join("\n")
      );

      const arcText = resultText(
        await read.execute("read-arc", {
          target: { kind: "arc", arc_id: "arc_one" },
          mode: "full"
        })
      );
      expect(() => JSON.parse(arcText)).toThrow();
      expect(arcText).toBe(
        [
          "完整内容：",
          "",
          "主线",
          "kind=arc",
          "arc_id=arc_one",
          "volume_id=volume_one",
          "顺序=1",
          "",
          "概要",
          "从凡界蝼蚁走到宗门门槛。",
          "",
          "大纲",
          "城门受辱后转入青云宗试炼。",
          "",
          "故事事件",
          "",
          "（暂无故事事件）",
          "",
          "故事情节",
          "",
          "（暂无故事情节）"
        ].join("\n")
      );
      expect(read.description).toContain("读取剧情点时一次返回概要");
      expect(read.description).toContain("全部故事事件");
      expect(read.description).toContain("不要再分别为这些故事事件或故事情节调用本工具");
    });

  it("reads a plot point with story-event bodies, story-plot bodies, and related foreshadowing", async () => {
      const index = structuredClone(fixtureStoryPlotIndex());
      index.plot.arcs[0]!.summary = "从城门走到北上。";
      index.plot.arcs.push({
        id: "arc_two",
        volumeId: "volume_one",
        title: "支线",
        order: 2,
        outline: ""
      });
      index.plot.storyPlots.push({
        id: "storyplot_two",
        arcId: "arc_one",
        title: "北上启程",
        order: 2,
        file: file(
          longStoryPlotBodyFileId("storyplot_two"),
          longStoryPlotFilePath("storyplot_two")
        )
      });
      index.plot.storyEvents.push(
        {
          id: "event_gate",
          title: "城门初遇",
          summary: "追兵在城门外拦住主角，埋下北上线索。",
          timeMode: "sequence",
          timeLabel: "第一夜",
          storyOrder: 1,
          location: "南城门",
          arcIds: ["arc_one"],
          characterIds: ["character_alice"]
        },
        {
          id: "event_depart",
          title: "连夜北上",
          summary: "主角带着旧信离开青阳城。",
          timeMode: "sequence",
          timeLabel: "第二夜",
          storyOrder: 2,
          location: "官道",
          arcIds: ["arc_one"],
          characterIds: ["character_alice"]
        },
        {
          id: "event_other",
          title: "支线密谈",
          summary: "不该出现在主线剧情点里。",
          timeMode: "sequence",
          timeLabel: "同时",
          storyOrder: 3,
          location: "茶馆",
          arcIds: ["arc_two"],
          characterIds: ["character_alice"]
        }
      );
      index.plot.foreshadowing.push(
        {
          id: "foreshadow_letter",
          title: "旧信来源",
          coreQuestion: "旧信是谁留下的？",
          hiddenTruth: "父亲仍在北境。",
          plannedSpan: "within_volume",
          truthEventId: null,
          expectedReaderEffect: "让读者盯住蜡封。",
          status: "planned",
          beats: [
            {
              id: "beat_letter_plant",
              type: "plant",
              order: 1,
              arcId: "arc_one",
              eventId: "event_gate",
              placementId: null,
              chapterCardId: null,
              plannedScope: "城门初遇时露出半张旧信。",
              note: "只给图案，不给署名。",
              status: "planned",
              commitId: null
            }
          ]
        },
        {
          id: "foreshadow_other",
          title: "无关伏笔",
          coreQuestion: "茶馆里的人是谁？",
          truthEventId: null,
          expectedReaderEffect: "不应出现在主线剧情点。",
          status: "planned",
          beats: [
            {
              id: "beat_other",
              type: "plant",
              order: 1,
              arcId: "arc_two",
              eventId: "event_other",
              placementId: null,
              chapterCardId: null,
              plannedScope: "支线密谈",
              note: "只属于支线。",
              status: "planned",
              commitId: null
            }
          ]
        }
      );
      const snapshot = LongWorkspaceIndexSnapshotSchema.parse(index);
      const storyPlotBodies = new Map([
        [longStoryPlotBodyFileId("storyplot_one"), STORY_PLOT_BODY],
        [longStoryPlotBodyFileId("storyplot_two"), "连夜收拾行装，按旧信指示北上。"]
      ]);
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(snapshot);
        }
        if (command.type === "long.readDocument") {
          const content = storyPlotBodies.get(command.payload.fileId);
          if (content === undefined) {
            throw new Error(`Unexpected document: ${command.payload.fileId}`);
          }
          const storyPlot = snapshot.plot.storyPlots.find(
            (entry) => entry.file.id === command.payload.fileId
          );
          if (!storyPlot) {
            throw new Error("Missing story plot file.");
          }
          return {
            status: "accepted" as const,
            requestId: command.id,
            payload: {
              bookId: snapshot.bookId,
              file: storyPlot.file,
              content,
              offset: command.payload.offset,
              totalCharacters: Array.from(content).length,
              nextOffset: null,
              workspaceRevision: snapshot.revision,
              projectRevision: 11
            }
          };
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-plot-point-bundle",
        runId: "run-plot-point-bundle",
        executor
      });
      const read = toolByName(tools, "read_plot_design");
      const arcText = resultText(
        await read.execute("read-arc-bundle", {
          target: { kind: "arc", arc_id: "arc_one" },
          mode: "full"
        })
      );

      expect(arcText).toContain("概要");
      expect(arcText).toContain("从城门走到北上。");
      expect(arcText).toContain("故事事件");
      expect(arcText).toContain("event_id=event_gate");
      expect(arcText).toContain("追兵在城门外拦住主角，埋下北上线索。");
      expect(arcText).toContain("event_id=event_depart");
      expect(arcText).toContain("主角带着旧信离开青阳城。");
      expect(arcText).not.toContain("event_id=event_other");
      expect(arcText).not.toContain("不该出现在主线剧情点里");
      expect(arcText).toContain("故事情节");
      expect(arcText).toContain("story_plot_id=storyplot_one");
      expect(arcText).toContain(STORY_PLOT_BODY);
      expect(arcText).toContain("story_plot_id=storyplot_two");
      expect(arcText).toContain("连夜收拾行装，按旧信指示北上。");
      expect(arcText).toContain("关联伏笔");
      expect(arcText).toContain("foreshadowing_id=foreshadow_letter");
      expect(arcText).toContain("旧信是谁留下的？");
      expect(arcText).toContain("父亲仍在北境。");
      expect(arcText).toContain("beat_id=beat_letter_plant");
      expect(arcText).toContain("只给图案，不给署名。");
      expect(arcText).not.toContain("foreshadowing_id=foreshadow_other");
      expect(arcText).not.toContain("不应出现在主线剧情点");

      const writeEvent = await toolByName(tools, "write_plot_design").execute(
        "write-event-after-arc-read",
        {
          item: {
            kind: "event",
            event_id: "event_gate",
            summary: "追兵改从西门包抄。",
            time_mode: "sequence",
            time_label: "第一夜",
            location: "西城门",
            arc_ids: ["arc_one"],
            character_ids: ["character_alice"]
          },
          allow_overwrite_existing: true,
          summary: "改写城门事件"
        }
      );
      expect(writeEvent.details).toMatchObject({
        kind: "long-mutation-proposal",
        summary: "改写城门事件"
      });

      const writePlot = await toolByName(tools, "write_plot_design").execute(
        "write-story-plot-after-arc-read",
        {
          item: {
            kind: "story_plot",
            story_plot_id: "storyplot_one",
            text: "城门外改道西门，北上线索仍在。"
          },
          allow_overwrite_existing: true,
          summary: "改写故事情节正文"
        }
      );
      expect(writePlot.details).toMatchObject({
        kind: "long-mutation-proposal",
        summary: "改写故事情节正文",
        batch: {
          documentWrites: [
            {
              fileId: longStoryPlotBodyFileId("storyplot_one"),
              content: "城门外改道西门，北上线索仍在。"
            }
          ]
        }
      });
    });

  it("uses business-level plot tools for non-foreshadowing content", async () => {
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
        sessionId: "session-plot-business-tools",
        runId: "run-plot-business-tools",
        executor
      });

      const listed = await toolByName(tools, "list_plot_design").execute(
        "list-arcs",
        { kind: "arc", volume_id: "volume_one" }
      );
      const listedText = listed.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      expect(listedText).toContain("arc_id=arc_one");
      expect(listedText).not.toContain("fileId");

      await toolByName(tools, "read_plot_design").execute("read-arc", {
        target: { kind: "arc", arc_id: "arc_one" },
        mode: "full"
      });
      const edit = await toolByName(tools, "edit_plot_design").execute(
        "edit-arc",
        {
          item: {
            kind: "arc",
            arc_id: "arc_one",
            patch: { outline: "更新后的剧情点故事情节" }
          },
          summary: "细化剧情点"
        }
      );
      expect(edit.details).toMatchObject({
        kind: "long-mutation-proposal",
        summary: "细化剧情点",
        batch: {
          operations: [
            {
              type: "arc.update",
              id: "arc_one",
              patch: { outline: "更新后的剧情点故事情节" }
            }
          ]
        }
      });

      const create = await toolByName(tools, "create_plot_design").execute(
        "create-arc",
        {
          domain: "worldbuilding", item: {
            kind: "arc",
            volume_id: "volume_one",
            title: "新的剧情点",
            summary: "概要",
            outline: "故事情节"
          }
        }
      );
      expect(create.details).toMatchObject({
        kind: "long-mutation-proposal",
        batch: {
          operations: [
            {
              type: "arc.create",
              arc: {
                id: expect.stringMatching(/^arc_[0-9a-f]{8}$/u),
                volumeId: "volume_one",
                title: "新的剧情点",
                outline: "故事情节"
              }
            }
          ]
        }
      });
    });
});
