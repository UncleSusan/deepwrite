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

describe("long workspace agent tools: characters-and-foreshadowing", () => {
  it("lists and creates characters with a custom dynamic type id", async () => {
      const index = LongWorkspaceIndexSnapshotSchema.parse({
        ...fixtureIndex(),
        characterTypes: [
          ...fixtureIndex().characterTypes,
          { id: "chartype_antagonist", title: "反派", order: 5 }
        ]
      });
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") return indexResult(index);
        if (command.type === "long.readDocument") {
          return {
            status: "accepted" as const,
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              file: index.characterOverview!,
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
        workspace: workspace("setting", "character_design"),
        profile: profile("setting"),
        sessionId: "session-character-custom-type",
        runId: "run-character-custom-type",
        executor
      });

      expect(
        Check(
          toolByName(tools, "create_setting").parameters,
          { domain: "character", name: "陆烬", type_id: "chartype_antagonist" }
        )
      ).toBe(true);
      const listedText = resultText(
        await toolByName(tools, "list_setting").execute(
          "list-custom-types",
          { domain: "character", type_id: "chartype_antagonist" }
        )
      );
      expect(() => JSON.parse(listedText)).toThrow();
      expect(listedText).toContain("type_id=chartype_antagonist");
      expect(listedText).toContain("反派");
      expect(listedText).not.toContain("next_page");
      expect(JSON.stringify(
        toolByName(tools, "list_setting").parameters
      )).not.toContain('"page"');

      const created = await toolByName(tools, "create_setting").execute(
        "create-custom-type-character",
        { domain: "character", name: "陆烬", type_id: "chartype_antagonist" }
      );
      expect(created.details).toMatchObject({
        batch: {
          operations: [
            {
              type: "character.create",
              character: { name: "陆烬", group: "chartype_antagonist" }
            }
          ]
        }
      });
    });

  it("requires a full character-document read before safe replacement", async () => {
      const index = fixtureIndex();
      const coreProfile = index.characterFiles[0]!.coreProfile;
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
              file: coreProfile,
              content: "林岚害怕深水。",
              offset: command.payload.offset,
              totalCharacters: 7,
              nextOffset: null,
              workspaceRevision: index.revision,
              projectRevision: 11
            }
          };
        }
        throw new Error(`Unexpected command: ${command.type}`);
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "character_design"),
        profile: profile("setting"),
        sessionId: "session-character-document",
        runId: "run-character-document",
        executor
      });

      const beforeRead = await toolByName(
        tools,
        "edit_setting"
      ).execute("replace-before-read", {
        domain: "character", character_id: "character_alice",
        document: "core_profile",
        replacements: [{
          original_text: "害怕深水",
          new_text: "擅长潜水"
        }]
      });
      expect(beforeRead.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("请先调用 read_setting")
      });

      await toolByName(tools, "read_setting").execute(
        "read-character",
        {
          domain: "character", character_id: "character_alice",
          document: "core_profile",
          mode: "full"
        }
      );
      const proposal = await toolByName(
        tools,
        "edit_setting"
      ).execute("replace-after-read", {
        domain: "character", character_id: "character_alice",
        document: "core_profile",
        replacements: [{
          original_text: "害怕深水",
          new_text: "擅长潜水"
        }]
      });
      expect(proposal.details).toMatchObject({
        kind: "long-character-file-proposal",
        batch: {
          operations: [],
          documentWrites: [{
            fileId: coreProfile.id,
            expectedRevision: coreProfile.revision,
            content: "林岚擅长潜水。"
          }]
        }
      });
    });

  it("allows direct character state writes after continuity records exist", async () => {
      const index = committedFixtureIndex();
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(index);
        }
        if (command.type === "long.readDocument") {
          const target = index.characterFiles[0]!.currentState;
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: index.bookId,
              file: target,
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
        workspace: {
          ...workspace("setting", "character_design"),
          workspaceRevision: index.revision,
          navigation: createLongWorkspaceNavigationSnapshot(index)
        },
        profile: profile("setting"),
        sessionId: "session-character-ledger-owned",
        runId: "run-character-ledger-owned",
        executor
      });

      const result = await toolByName(tools, "write_setting").execute(
          "write-ledger-owned-state",
          {
            domain: "character", character_id: "character_alice",
            document: "current_state",
            text: "试图绕过连续性账本。"
          }
        );
      expect(result.details).toMatchObject({
        kind: "long-character-file-proposal"
      });
    });

  it("pins a mutation proposal to the Core index revision instead of stale session metadata", async () => {
      const latest = fixtureIndex();
      latest.revision = 9;
      const executor = vi.fn<LongCommandExecutor>(async (command) => ({
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          workspaceIndex: latest,
          projectRevision: 17
        }
      }));
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-latest-revision",
        runId: "run-latest-revision",
        executor
      });
      const proposal = await toolByName(
        tools,
        "propose_long_mutation"
      ).execute("latest-revision", {
        domain: "worldbuilding", operations: [
          {
            type: "worldbuilding.update",
            id: "world_rules",
            patch: { title: "最新规则" }
          }
        ],
        summary: "基于最新索引"
      });

      expect(proposal.details).toMatchObject({
        kind: "long-mutation-proposal",
        baseProjectRevision: 17,
        batch: { baseRevision: 9 }
      });
    });

  it("creates character files and chapter triplets with runtime-owned ids and empty content revisions", async () => {
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type !== "long.getWorkspaceIndex") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        return indexResult();
      });
      const characterTools = buildLongWorkspaceTools({
        workspace: workspace("setting", "character_design"),
        profile: profile("setting"),
        sessionId: "session-character-create",
        runId: "run-character-create",
        executor
      });
      const characterProposal = await toolByName(
        characterTools,
        "propose_long_mutation"
      ).execute("create-character", {
        domain: "character", operations: [
          {
            type: "character.create",
            name: "沈砚",
            type_id: "major_supporting",
            aliases: ["阿砚"]
          }
        ],
        summary: "创建人物"
      });
      expect(characterProposal.details).toMatchObject({
        kind: "long-mutation-proposal",
        batch: {
          operations: [
            {
              type: "character.create",
              character: {
                id: expect.stringMatching(/^character_[0-9a-f]{8}$/u),
                name: "沈砚",
                group: "major_supporting",
                order: 1,
                aliases: ["阿砚"]
              },
              files: {
                coreProfile: {
                  revision:
                    "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                },
                relationships: {
                  revision:
                    "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                },
                currentState: {
                  revision:
                    "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                },
                history: {
                  revision:
                    "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                }
              }
            }
          ]
        }
      });

      const plotProfile = profile("plot_design");
      expect(plotProfile.writeAccess.workspaceRoots).toEqual([
        "plot_design"
      ]);
      const plotTools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: plotProfile,
        sessionId: "session-chapter-create",
        runId: "run-chapter-create",
        executor
      });
      const chapterProposal = await toolByName(
        plotTools,
        "propose_long_mutation"
      ).execute("create-chapter", {
        domain: "worldbuilding", operations: [
          {
            type: "chapter.create",
            volumeId: "volume_one",
            primaryArcId: "arc_one",
            title: "第二章",
            characterIds: ["character_alice"]
          }
        ],
        summary: "创建章卡"
      });
      expect(chapterProposal.details).toMatchObject({
        kind: "long-mutation-proposal",
        batch: {
          operations: [
            {
              type: "chapter.create",
              chapterCard: {
                id: expect.stringMatching(/^chapter_[0-9a-f]{8}$/u),
                volumeId: "volume_one",
                primaryArcId: "arc_one",
                narrativeOrder: 2,
                title: "第二章"
              },
              files: {
                body: {
                  revision:
                    "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                },
                characterState: {
                  revision:
                    "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                },
                handoff: {
                  revision:
                    "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                },
                commitId: null
              }
            }
          ],
          documentWrites: []
        }
      });
    });

  it("translates foreshadowing thread and beat planning fields while preserving legacy calls", async () => {
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type !== "long.getWorkspaceIndex") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        return indexResult();
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-foreshadowing-planning",
        runId: "run-foreshadowing-planning",
        executor
      });
      const mutationTool = toolByName(tools, "propose_long_mutation");
      const parameterSchema = JSON.stringify(mutationTool.parameters);
      expect(parameterSchema).toContain('"hiddenTruth"');
      expect(parameterSchema).toContain('"plannedSpan"');
      expect(parameterSchema).toContain('"volumeId"');
      expect(parameterSchema).toContain('"arcId"');
      expect(parameterSchema).toContain("卷级计划锚点");
      expect(parameterSchema).toContain("剧情点计划锚点");
      expect(mutationTool.description).toContain("foreshadowing.create");
      expect(mutationTool.description).toContain("foreshadowingBeat.create");
      const preparedAliasCall = mutationTool.prepareArguments?.({
        operations: [
          {
            type: "create_foreshadow_thread",
            client_ref: "alias-thread",
            title: "别名伏笔调用",
            coreQuestion: "别名能否在校验前归一化？",
            hiddenTruth: "运行时会转换为正式操作类型。",
            plannedSpan: "cross_volume",
            expectedReaderEffect: "创建成功而不是返回联合校验噪声。"
          }
        ],
        summary: "兼容模型误生成的伏笔创建类型"
      });
      expect(preparedAliasCall).toMatchObject({
        operations: [{ type: "foreshadowing.create" }]
      });
      expect(Check(mutationTool.parameters, preparedAliasCall)).toBe(true);
      expect(
        Check(mutationTool.parameters, {
          operations: [
            {
              type: "foreshadowing.create",
              client_ref: "legacy-thread",
              title: "旧式伏笔调用"
            },
            {
              type: "foreshadowingBeat.create",
              threadId: "ref:legacy-thread",
              beatType: "plant",
              plannedScope: "第一卷"
            }
          ],
          summary: "旧调用仍可使用"
        })
      ).toBe(true);

      const proposal = await mutationTool.execute(
        "foreshadowing-planning",
        {
          domain: "worldbuilding", operations: [
            {
              type: "volume.create",
              client_ref: "second-volume",
              title: "第二卷"
            },
            {
              type: "arc.create",
              client_ref: "second-plot-point",
              volumeId: "ref:second-volume",
              title: "身份疑云"
            },
            {
              type: "foreshadowing.create",
              client_ref: "identity-thread",
              title: "失踪者身份",
              coreQuestion: "失踪者究竟是谁？",
              hiddenTruth: "失踪者一直以管家的身份留在宅邸。",
              plannedSpan: "within_volume"
            },
            {
              type: "foreshadowingBeat.create",
              client_ref: "identity-touch",
              threadId: "ref:identity-thread",
              beatType: "plant",
              volumeId: "ref:second-volume",
              arcId: "ref:second-plot-point",
              note: "先让旧照片露出半张侧脸。"
            },
            {
              type: "foreshadowing.update",
              id: "ref:identity-thread",
              patch: {
                hiddenTruth: "失踪者就是冒名顶替的现任管家。",
                plannedSpan: "cross_volume"
              }
            },
            {
              type: "foreshadowingBeat.update",
              id: "ref:identity-touch",
              patch: {
                volumeId: null,
                arcId: "ref:second-plot-point",
                note: "触点已细化到第一剧情点。"
              }
            }
          ],
          summary: "创建并细化伏笔线与触点"
        }
      );

      expect(proposal.details).toMatchObject({
        kind: "long-mutation-proposal",
        batch: {
          operations: [
            {
              type: "volume.create",
              volume: {
                id: expect.stringMatching(/^volume_[0-9a-f]{8}$/u),
                title: "第二卷"
              }
            },
            {
              type: "arc.create",
              arc: {
                id: expect.stringMatching(/^arc_[0-9a-f]{8}$/u),
                volumeId: expect.stringMatching(/^volume_[0-9a-f]{8}$/u),
                title: "身份疑云"
              }
            },
            {
              type: "foreshadowing.create",
              thread: {
                id: expect.stringMatching(/^foreshadow_[0-9a-f]{8}$/u),
                title: "失踪者身份",
                coreQuestion: "失踪者究竟是谁？",
                hiddenTruth: "失踪者一直以管家的身份留在宅邸。",
                plannedSpan: "within_volume",
                beats: []
              }
            },
            {
              type: "foreshadowingBeat.create",
              threadId: expect.stringMatching(/^foreshadow_[0-9a-f]{8}$/u),
              beat: {
                id: expect.stringMatching(/^beat_[0-9a-f]{8}$/u),
                type: "plant",
                volumeId: expect.stringMatching(/^volume_[0-9a-f]{8}$/u),
                arcId: expect.stringMatching(/^arc_[0-9a-f]{8}$/u),
                note: "先让旧照片露出半张侧脸。"
              }
            },
            {
              type: "foreshadowing.update",
              id: expect.stringMatching(/^foreshadow_[0-9a-f]{8}$/u),
              patch: {
                hiddenTruth: "失踪者就是冒名顶替的现任管家。",
                plannedSpan: "cross_volume"
              }
            },
            {
              type: "foreshadowingBeat.update",
              id: expect.stringMatching(/^beat_[0-9a-f]{8}$/u),
              patch: {
                volumeId: null,
                arcId: expect.stringMatching(/^arc_[0-9a-f]{8}$/u),
                note: "触点已细化到第一剧情点。"
              }
            }
          ]
        }
      });
      if (proposal.details?.kind !== "long-mutation-proposal") {
        throw new Error("Expected a long mutation proposal.");
      }
      const operations = proposal.details.batch.operations;
      const createdVolume = operations[0];
      const createdArc = operations[1];
      const createdThread = operations[2];
      const createdBeat = operations[3];
      const updatedThread = operations[4];
      const updatedBeat = operations[5];
      if (
        createdVolume?.type !== "volume.create" ||
        createdArc?.type !== "arc.create" ||
        createdThread?.type !== "foreshadowing.create" ||
        createdBeat?.type !== "foreshadowingBeat.create" ||
        updatedThread?.type !== "foreshadowing.update" ||
        updatedBeat?.type !== "foreshadowingBeat.update"
      ) {
        throw new Error("Expected translated foreshadowing operations.");
      }
      expect(createdArc.arc.volumeId).toBe(createdVolume.volume.id);
      expect(createdBeat.threadId).toBe(createdThread.thread.id);
      expect(createdBeat.beat.volumeId).toBe(createdVolume.volume.id);
      expect(createdBeat.beat.arcId).toBe(createdArc.arc.id);
      expect(updatedThread.id).toBe(createdThread.thread.id);
      expect(updatedBeat.id).toBe(createdBeat.beat.id);
      expect(updatedBeat.patch.arcId).toBe(createdArc.arc.id);
    });

  it("computes document revisions from logical targets and rejects the generic draft-write bypass", async () => {
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult();
        }
        if (command.type !== "long.readDocument") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        const index = fixtureIndex();
        const worldFile = fixtureWorldFile(index);
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: {
              ...worldFile,
              revision: "v1:2:77777777"
            },
            content: "旧",
            offset: 0,
            totalCharacters: 1,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("setting", "worldbuilding"),
        profile: profile("setting"),
        sessionId: "session-document-replace",
        runId: "run-document-replace",
        executor
      });
      const content = "潮汐规则只允许在月蚀时逆转。";
      const proposal = await toolByName(
        tools,
        "propose_long_mutation"
      ).execute("replace-world-document", {
        domain: "worldbuilding", operations: [
          {
            type: "worldbuilding.update",
            id: "world_rules",
            patch: { title: "潮汐规则" }
          }
        ],
        document_updates: [
          {
            target: {
              kind: "worldbuilding",
              categoryId: "world_rules"
            },
            content,
            reason: "同步完整规则正文"
          }
        ],
        summary: "更新规则标题与正文"
      });
      const expectedHash = createHash("sha256")
        .update(content, "utf8")
        .digest("hex");
      expect(proposal.details).toMatchObject({
        kind: "long-mutation-proposal",
        batch: {
          documentWrites: [
            {
              fileId: longWorldbuildingFileId("world_rules"),
              content,
              mode: "replace",
              expectedRevision: "v1:2:77777777",
              nextRevision: `v2:${Buffer.byteLength(content, "utf8")}:${expectedHash}`,
              reason: "同步完整规则正文"
            }
          ]
        }
      });

      const plotTools = buildLongWorkspaceTools({
        workspace: workspace("plot_design", "plot_design"),
        profile: profile("plot_design"),
        sessionId: "session-no-draft-bypass",
        runId: "run-no-draft-bypass",
        executor
      });
      expect(
        JSON.stringify(
          toolByName(plotTools, "propose_long_mutation").parameters
        )
      ).not.toContain('"kind":"draft"');
      await expect(
        toolByName(plotTools, "propose_long_mutation").execute(
          "draft-bypass",
          {
            domain: "worldbuilding", operations: [
              {
                type: "chapter.update",
                id: "chapter_one",
                patch: { title: "第一章（修订章卡）" }
              }
            ],
            document_updates: [
              {
                target: {
                  kind: "draft",
                  chapterCardId: "chapter_one",
                  role: "body"
                },
                content: "试图绕过三件套工具",
                reason: "越权"
              }
            ],
            summary: "越权"
          } as never
        )
      ).rejects.toThrow(/not valid generic mutation targets/u);
    });

  it("locks chapter writes to the active chapter and accepts body content only", async () => {
      const latest = fixtureIndex();
      latest.chapters[0]!.body.revision = "v1:4:11111111";
      latest.chapters[0]!.characterState.revision = "v1:5:22222222";
      latest.chapters[0]!.handoff.revision = "v1:6:33333333";
      const chapter = latest.chapters[0]!;
      const liveRevisions = new Map([
        [chapter.body.id, "v1:7:44444444"],
        [chapter.characterState.id, "v1:8:55555555"],
        [chapter.handoff.id, "v1:9:66666666"]
      ]);
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(latest);
        }
        if (command.type !== "long.readDocument") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        const requested = [
          chapter.body,
          chapter.characterState,
          chapter.handoff
        ].find(({ id }) => id === command.payload.fileId)!;
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: latest.bookId,
            file: {
              ...requested,
              revision: liveRevisions.get(requested.id)!
            },
            content: requested.id === chapter.body.id ? "" : "x",
            offset: 0,
            totalCharacters: requested.id === chapter.body.id ? 0 : 1,
            nextOffset: null,
            workspaceRevision: latest.revision,
            projectRevision: 11
          }
        };
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("draft", "draft", "chapter_one"),
        profile: profile("draft"),
        sessionId: "session-chapter",
        runId: "run-chapter",
        writeApprovalMode: "auto-approve",
        executor
      });
      const writeInput = {
        content: "正文",
        summary: "完成第一章"
      };
      const result = await toolByName(
        tools,
        "write_chapter_draft"
      ).execute("chapter-write", writeInput);

      expect(executor).toHaveBeenCalledTimes(2);
      expect(executor.mock.calls[0]?.[0].type).toBe("long.getWorkspaceIndex");
      expect(result.details).toMatchObject({
        kind: "long-chapter-write-proposal",
        bookId: "longbook_tools",
        batch: {
          baseRevision: 7,
          operations: [],
          documentWrites: [{
            fileId: longChapterBodyFileId("chapter_one"),
            content: "正文",
            mode: "replace",
            expectedRevision: "v1:7:44444444"
          }]
        },
        baseProjectRevision: 11,
        file: {
          chapterCardId: "chapter_one",
          operation: "write",
          beforeText: "",
          afterText: "正文",
          beforeRevision: "v1:7:44444444"
        }
      });
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("正文写入提案")
      });
      const tool = toolByName(tools, "write_chapter_draft");
      const parameters = JSON.stringify(tool.parameters);
      expect(parameters).not.toMatch(
        /bookId|book_id|chapter_card_id|character_state|handoff|path|revision/u
      );
      expect(Check(tool.parameters, writeInput)).toBe(true);
      expect(
        Check(tool.parameters, {
          content: "正文",
          base_revision: REVISION,
          summary: "旧参数"
        })
      ).toBe(false);
      await expect(
        tool.execute("chapter-write-empty", {
          ...writeInput,
          content: "   "
        })
      ).rejects.toThrow(/non-empty/u);
      await expect(
        tool.execute("chapter-write-empty-summary", {
          ...writeInput,
          summary: "   "
        })
      ).rejects.toThrow(/non-empty/u);
    });

  it("requires a full read and explicit permission before overwriting non-empty chapter text", async () => {
      const latest = fixtureIndex();
      const chapter = latest.chapters[0]!;
      chapter.bodyStatus = "written";
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(latest);
        }
        if (command.type !== "long.readDocument") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: latest.bookId,
            file: chapter.body,
            content: "旧正文",
            offset: 0,
            totalCharacters: 3,
            nextOffset: null,
            workspaceRevision: latest.revision,
            projectRevision: 11
          }
        };
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("draft", "draft", "chapter_one"),
        profile: profile("draft"),
        sessionId: "session-existing-chapter",
        runId: "run-existing-chapter",
        executor
      });
      const write = toolByName(tools, "write_chapter_draft");
      const input = {
        content: "新正文",
        summary: "重写第一章"
      };

      expect(resultText(await write.execute("without-confirmation", input))).toContain(
        "allow_overwrite_existing=true"
      );
      expect(
        resultText(
          await write.execute("without-full-read", {
            ...input,
            allow_overwrite_existing: true
          })
        )
      ).toContain("read_chapter（mode=full）");

      await toolByName(tools, "read_chapter").execute("full-read", {
        mode: "full"
      });
      const result = await write.execute("confirmed-overwrite", {
        ...input,
        allow_overwrite_existing: true
      });
      expect(result.details).toMatchObject({
        kind: "long-chapter-write-proposal",
        file: {
          operation: "write",
          beforeText: "旧正文",
          afterText: "新正文"
        }
      });
    });
});
