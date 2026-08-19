import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LIBRARY_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS,
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  afterEach,
  createDefaultAppearanceSettings,
  createDefaultCreativePlotStages,
  createDeferredApi,
  createDraftCoordinatorDocument,
  createEditProposal,
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  createMemoryStorage,
  createScriptWorkspaceDocuments,
  createShortWorkspaceContentRevision,
  createShortWorkspaceDocuments,
  describe,
  document,
  eventOptions,
  expect,
  it,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  mergeAgentConversationPersistenceSnapshots,
  plotStages,
  reactive,
  runtime,
  shortStageTitle,
  storedConversation,
  useAgentConversation,
  vi,
} from "./useAgentConversation.test-support";
import type {
  AgentConversationPersistenceRecord,
  AgentConversationPersistenceSnapshot,
  AgentEditProposal,
  DeepWriteApi,
  ModelSettings,
  SessionAbortCommandPayload,
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload,
  UseAgentConversationOptions,
  WorkspaceDocument,
} from "./useAgentConversation.test-support";

describe("agent conversation controller: proposal-persistence", () => {
  it("keeps a late evaluation snapshot after the run has already completed", async () => {
      const deferred = createDeferredApi();
      const controller = useAgentConversation({
        api: () => deferred.api,
        idleTimeoutMs: 10_000
      });
      controller.draft.value = "补齐评估历史";
      const sessionId = controller.sessionId.value;
      const sending = controller.sendMessage(document);
      const runId = "run_late_evaluation_history";
      deferred.resolveAccepted(0, {
        sessionId,
        runId,
        acceptedAt: new Date().toISOString(),
        runtime
      });
      await sending;
      controller.handleEvent(
        createEnvelope(
          "agent.message_completed",
          {
            sessionId,
            runId,
            messageId: `${runId}_assistant`,
            role: "assistant" as const,
            content: "本轮已完成。",
            runtime
          },
          eventOptions(sessionId, runId, "evt_late_eval_completed")
        )
      );
      controller.handleEvent(
        createEnvelope(
          "agent.evaluation_snapshot",
          {
            sessionId,
            runId,
            messageId: `${runId}_assistant`,
            runtime,
            snapshot: {
              schemaVersion: 1 as const,
              capturedAt: "2026-08-15T09:00:00.000Z",
              systemPrompt: "最终系统提示词",
              runtimeContext: {
                kind: "turn-context" as const,
                text: "补齐评估历史"
              },
              tools: [],
              conversationHistory: [
                { role: "user" as const, text: "补齐评估历史" },
                { role: "assistant" as const, text: "本轮已完成。" }
              ]
            }
          },
          eventOptions(sessionId, runId, "evt_late_eval_snapshot")
        )
      );

      expect(controller.messages.value.at(-1)).toMatchObject({
        status: "completed",
        evaluationSnapshot: {
          conversationHistory: [
            { role: "user", text: "补齐评估历史" },
            { role: "assistant", text: "本轮已完成。" }
          ]
        }
      });
      controller.dispose();
    });

  it("still persists conversation history when an evaluation snapshot cannot be cloned", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-invalid-evaluation-snapshot-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.messages.value = [
        {
          id: "user-keep-history",
          role: "user",
          content: "根据第一个大纲规划剧情点",
          createdAt: "2026-08-15T10:00:00.000Z",
          status: "completed"
        },
        {
          id: "assistant-invalid-eval",
          role: "assistant",
          content: "已创建剧情点",
          createdAt: "2026-08-15T10:00:01.000Z",
          status: "stopped",
          evaluationSnapshot: {
            schemaVersion: 1,
            capturedAt: "not-a-timestamp",
            systemPrompt: "系统提示词",
            runtimeContext: { kind: "turn-context", text: "用户消息" },
            tools: [],
            conversationHistory: [{ role: "assistant", text: "", toolName: "" }]
          } as never
        }
      ];
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(restored.messages.value.map((message) => message.content)).toEqual([
        "根据第一个大纲规划剧情点",
        "已创建剧情点"
      ]);
      expect(restored.messages.value[1]?.evaluationSnapshot).toBeUndefined();
      restored.dispose({ clearPersistence: true });
    });

  it("clears persisted conversations when a project runtime is disposed", async () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-project-removal-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.draft.value = "不应在删除项目后恢复";
      controller.dispose({ clearPersistence: true });
      await Promise.resolve();

      expect(storage.getItem(persistenceKey)).toBeNull();
      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(restored.draft.value).toBe("");
      expect(restored.messages.value).toEqual([]);
      restored.dispose({ clearPersistence: true });
    });

  it("persists edit proposals and restores interrupted acceptance as pending", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-edit-proposal-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      const interruptedProposal = createEditProposal({
        status: "accepting",
        truncated: true,
        statusMessage: "正在写入",
        laneId: "run_edit_1:short_story_1:draft:body",
        generation: 2,
        approvalMode: "auto-approve",
        predecessorProposalId: "proposal_0",
        sourceBaseRevision: "v1:5:22222222",
        decisionToken: "commit-token-2"
      });
      delete interruptedProposal.proposedText;
      controller.upsertEditProposal("run_edit_1", interruptedProposal);
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
        status: "pending",
        truncated: true,
        statusMessage: "正在写入",
        laneId: "run_edit_1:short_story_1:draft:body",
        generation: 2,
        approvalMode: "auto-approve",
        predecessorProposalId: "proposal_0",
        sourceBaseRevision: "v1:5:22222222",
        decisionToken: "commit-token-2",
        hunks: [
          {
            lines: [
              { type: "deletion", text: "旧句" },
              { type: "addition", text: "新句" },
              { type: "context", text: "保留句" }
            ]
          }
        ]
      });
      expect(restored.getEditProposal("run_edit_1", "proposal_1")).not.toHaveProperty(
        "proposedText"
      );
      expect(restored.hasPendingEditReview.value).toBe(true);
      restored.dispose();
    });

  it("persists accepted draft section ids for dependent proposal recovery", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-draft-section-mapping-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          stageId: "draft",
          documentId: "draft-section-creation:proposal_1",
          title: "创建 1 个空白章节",
          status: "accepted",
          proposedText: undefined,
          draftSectionCreationTarget: {
            sections: [{
              title: "第一节",
              wordCountRequirement: "1200 字",
              provisionalSectionId: "pending:section:proposal_1:1",
              realSectionId: "section_real_1"
            }],
            baseProjectRevision: 7,
            acceptedDirectoryRevision: "v1:12:1234abcd"
          }
        })
      );
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(
        restored.getEditProposal("run_edit_1", "proposal_1")
          ?.draftSectionCreationTarget
      ).toEqual({
        sections: [{
          title: "第一节",
          wordCountRequirement: "1200 字",
          provisionalSectionId: "pending:section:proposal_1:1",
          realSectionId: "section_real_1"
        }],
        baseProjectRevision: 7,
        acceptedDirectoryRevision: "v1:12:1234abcd"
      });
      restored.dispose();
    });

  it("persists draft section rename targets for the standard approval card", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-draft-section-rename-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          stageId: "draft",
          documentId: "draft-section-rename:proposal_1",
          title: "修改章节名称：旧名 → 新名",
          status: "pending",
          proposedText: "旧名 → 新名",
          draftSectionRenameTarget: {
            sectionId: "section-1",
            previousTitle: "旧名",
            title: "新名",
            baseProjectRevision: 3
          }
        })
      );
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(
        restored.getEditProposal("run_edit_1", "proposal_1")
          ?.draftSectionRenameTarget
      ).toEqual({
        sectionId: "section-1",
        previousTitle: "旧名",
        title: "新名",
        baseProjectRevision: 3
      });
      restored.dispose();
    });

  it("persists draft section deletion targets for the standard approval card", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-draft-section-deletion-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          stageId: "draft",
          documentId: "draft-section-deletion:proposal_1",
          title: "删除章节：旧名",
          status: "pending",
          proposedText: "删除：旧名",
          draftSectionDeletionTarget: {
            sectionId: "section-1",
            title: "旧名",
            baseProjectRevision: 4
          }
        })
      );
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(
        restored.getEditProposal("run_edit_1", "proposal_1")
          ?.draftSectionDeletionTarget
      ).toEqual({
        sectionId: "section-1",
        title: "旧名",
        baseProjectRevision: 4
      });
      restored.dispose();
    });

  it("persists long worldbuilding targets for the standard approval card", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-long-worldbuilding-proposal-test";
      const file = createEmptyLongMarkdownFileReference(
        longWorldbuildingItemFileId("worlditem_memory"),
        longWorldbuildingItemContentPath(
          "world_rules",
          "worlditem_memory"
        ),
        "2026-07-30T12:00:00.000Z"
      );
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          workspaceId: "long:longbook_test",
          stageId: "long-worldbuilding",
          documentId: file.id,
          title: "记忆代价",
          baseRevision: `long-missing:${file.id}`,
          proposedRevision: file.revision,
          proposedText: "",
          longWorldbuildingTarget: {
            bookId: "longbook_test",
            baseProjectRevision: 11,
            batch: {
              baseRevision: 7,
              updatedAt: "2026-07-30T12:00:00.000Z",
              operations: [{
                type: "worldbuildingItem.create",
                categoryId: "world_rules",
                item: {
                  id: "worlditem_memory",
                  title: "记忆代价",
                  order: 1,
                  file
                }
              }],
              documentWrites: []
            },
            file: {
              categoryId: "world_rules",
              itemId: "worlditem_memory",
              fileId: file.id,
              filePath: file.path,
              title: "记忆代价",
              operation: "create",
              beforeText: "",
              afterText: "",
              beforeRevision: null,
              nextRevision: file.revision
            }
          }
        })
      );
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(
        restored.getEditProposal("run_edit_1", "proposal_1")
          ?.longWorldbuildingTarget
      ).toMatchObject({
        bookId: "longbook_test",
        baseProjectRevision: 11,
        file: {
          itemId: "worlditem_memory",
          operation: "create",
          beforeRevision: null
        },
        batch: {
          operations: [{ type: "worldbuildingItem.create" }],
          documentWrites: []
        }
      });
      restored.dispose();
    });

  it("persists long character targets for the standard approval card", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-long-character-proposal-test";
      const file = createEmptyLongMarkdownFileReference(
        longCharacterCoreProfileFileId("character_memory"),
        longCharacterFilePath("character_memory", "core-profile.md"),
        "2026-07-30T12:00:00.000Z"
      );
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          workspaceId: "long:longbook_test",
          stageId: "long-character",
          documentId: file.id,
          title: "林岚 / 核心档案",
          baseRevision: file.revision,
          proposedRevision: "v1:4:12345678",
          proposedText: "新的核心档案",
          longCharacterTarget: {
            bookId: "longbook_test",
            baseProjectRevision: 11,
            batch: {
              baseRevision: 7,
              updatedAt: "2026-07-30T12:00:00.000Z",
              operations: [],
              documentWrites: [{
                proposalId: "proposal_character_memory",
                fileId: file.id,
                content: "新的核心档案",
                mode: "replace",
                expectedRevision: file.revision,
                nextRevision: "v1:4:12345678",
                updatedAt: "2026-07-30T12:00:00.000Z",
                reason: "更新人物核心档案"
              }]
            },
            files: [{
              characterId: "character_memory",
              characterName: "林岚",
              document: "core_profile",
              fileId: file.id,
              filePath: file.path,
              title: "林岚 / 核心档案",
              operation: "edit",
              beforeText: "旧的核心档案",
              afterText: "新的核心档案",
              beforeRevision: file.revision,
              nextRevision: "v1:4:12345678"
            }]
          }
        })
      );
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(
        restored.getEditProposal("run_edit_1", "proposal_1")
          ?.longCharacterTarget
      ).toMatchObject({
        bookId: "longbook_test",
        baseProjectRevision: 11,
        files: [{
          characterId: "character_memory",
          document: "core_profile",
          operation: "edit"
        }]
      });
      restored.dispose();
    });

  it("persists long plot design targets for the standard approval card", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-long-plot-design-proposal-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          workspaceId: "long:longbook_test",
          stageId: "long-plot-design",
          documentId: "plot-design",
          title: "剧情设计变更",
          baseRevision: "long-plot:11:7",
          proposedRevision: "long-plot:11:7:tool_edit_1",
          proposedText: "创建第二卷",
          longPlotDesignTarget: {
            bookId: "longbook_test",
            baseProjectRevision: 11,
            appliedProjectRevision: 12,
            batch: {
              baseRevision: 7,
              updatedAt: "2026-07-30T12:00:00.000Z",
              operations: [{
                type: "volume.create",
                volume: {
                  id: "volume_second",
                  title: "第二卷",
                  order: 2,
                  summary: "主角进入北境"
                }
              }],
              documentWrites: []
            }
          }
        })
      );
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(
        restored.getEditProposal("run_edit_1", "proposal_1")
          ?.longPlotDesignTarget
      ).toMatchObject({
        bookId: "longbook_test",
        baseProjectRevision: 11,
        appliedProjectRevision: 12,
        batch: {
          operations: [{
            type: "volume.create",
            volume: { id: "volume_second", title: "第二卷" }
          }],
          documentWrites: []
        }
      });
      restored.dispose();
    });

  it("still persists a plot design proposal after accept clears proposedText", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-long-plot-design-accept-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          workspaceId: "long:longbook_test",
          stageId: "long-plot-design",
          documentId: "plot-design",
          title: "剧情设计变更",
          baseRevision: "long-plot:11:7",
          proposedRevision: "long-plot:11:7:tool_edit_1",
          proposedText: "创建第二卷",
          longPlotDesignTarget: {
            bookId: "longbook_test",
            baseProjectRevision: 11,
            batch: {
              baseRevision: 7,
              updatedAt: "2026-07-30T12:00:00.000Z",
              operations: [{
                type: "volume.create",
                volume: {
                  id: "volume_second",
                  title: "第二卷",
                  order: 2,
                  summary: "主角进入北境"
                }
              }],
              documentWrites: []
            }
          }
        })
      );
      controller.updateEditProposal("run_edit_1", "proposal_1", {
        status: "accepted",
        proposedText: undefined,
        statusMessage: "已自动批准并保存剧情设计。"
      });
      expect(
        controller.capturePersistenceSnapshot().conversations[0]?.messages[0]
      ).toMatchObject({
        editProposals: [{
          status: "accepted",
          statusMessage: "已自动批准并保存剧情设计。",
          longPlotDesignTarget: { bookId: "longbook_test" }
        }]
      });
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
        status: "accepted",
        longPlotDesignTarget: { bookId: "longbook_test" }
      });
      expect(
        restored.getEditProposal("run_edit_1", "proposal_1")?.proposedText
      ).toBeUndefined();
      restored.dispose();
    });

  it("persists the target metadata required to review a library creation", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-library-proposal-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.upsertEditProposal(
        "run_edit_1",
        createEditProposal({
          workspaceId: "library:material:library-1",
          stageId: "library",
          documentId: "library-create:tool-1",
          title: "人物甲",
          baseRevision: createShortWorkspaceContentRevision(""),
          proposedRevision: createShortWorkspaceContentRevision("人物素材"),
          proposedText: "人物素材",
          libraryTarget: {
            operation: "create",
            domain: "material",
            libraryId: "library-1",
            stageId: "character",
            baseProjectRevision: 3
          }
        })
      );
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(restored.getEditProposal("run_edit_1", "proposal_1")).toMatchObject({
        stageId: "library",
        libraryTarget: {
          operation: "create",
          domain: "material",
          libraryId: "library-1",
          stageId: "character",
          baseProjectRevision: 3
        }
      });
      restored.dispose();
    });

  it("persists subagent details and restores interrupted child runs as stopped", () => {
      const storage = createMemoryStorage();
      const persistenceKey = "conversation-subagent-history-test";
      const controller = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      controller.messages.value = [{
        id: "assistant-subagent-history",
        role: "assistant",
        content: "",
        createdAt: "2026-07-24T02:00:00.000Z",
        runId: "run_subagent_history",
        status: "completed",
        subagentRuns: [{
          parentToolCallId: "spawn_history",
          subagentRunId: "subrun_history",
          subagentId: "researcher",
          name: "资料员",
          task: "检查旧设定",
          status: "running",
          runtime,
          thinking: "正在检查",
          output: "已经找到两条相关设定。",
          summary: "等待父智能体接收。",
          usage: {
            inputTokens: 30,
            outputTokens: 10,
            cacheReadTokens: 2,
            cacheWriteTokens: 0,
            totalTokens: 42
          },
          toolCalls: [{
            id: "subtool_history",
            name: "read_workspace_content",
            args: { stage: "outline" },
            status: "running",
            requestedAt: "2026-07-24T02:00:01.000Z"
          }],
          processingSteps: [{
            id: "substep_history",
            type: "tool",
            toolCallId: "subtool_history",
            createdAt: "2026-07-24T02:00:01.000Z"
          }],
          startedAt: "2026-07-24T02:00:00.000Z"
        }]
      }];
      controller.dispose();

      const restored = useAgentConversation({
        api: () => undefined,
        ...storage.options(persistenceKey)
      });
      expect(restored.messages.value[0]?.subagentRuns?.[0]).toMatchObject({
        subagentRunId: "subrun_history",
        status: "stopped",
        thinking: "正在检查",
        output: "已经找到两条相关设定。",
        summary: "等待父智能体接收。",
        usage: { totalTokens: 42 },
        errorMessage: "应用关闭或对话恢复时，子任务仍在运行。",
        toolCalls: [{
          id: "subtool_history",
          status: "error",
          isError: true
        }]
      });
      expect(
        restored.messages.value[0]?.subagentRuns?.[0]?.completedAt
      ).toBeTruthy();
      restored.dispose();
    });
});
