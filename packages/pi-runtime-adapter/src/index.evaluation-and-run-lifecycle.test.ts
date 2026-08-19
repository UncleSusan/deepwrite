import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  PiAgentRuntimeAdapter,
  SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS,
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  Type,
  buildAgentEvaluationSnapshot,
  buildEffectiveSystemPrompt,
  buildProviderRuntime,
  buildRawUserMessage,
  buildRuntimeUserPrompt,
  captureDisabledThinkingPayload,
  captureThinkingPayload,
  captureToolPayload,
  cloneEmptyLearningImitationResult,
  createAssistantMessageEventStream,
  createDefaultCreativePlotStages,
  createShortWorkspaceContentRevision,
  describe,
  evaluationConversationHistory,
  expect,
  interceptToolCallStream,
  it,
  normalChatContext,
  ollamaGrammarRegressionTool,
  providerRuntime,
  reconcileToolCallArguments,
  screenplayWorkspace,
  scriptAgentProfile,
  toRuntimeEvents,
  toToolStreamRuntimeEvent,
  toUsageObservedRuntimeEvent,
  toolCallMessage,
  toolWithParameters,
} from "./index.test-support";
import type {
  AgentProviderRuntimeConfig,
  AgentRuntimeEvent,
  AgentTool,
  AssistantMessage,
  ChatAssistantRuntimeContext,
  LongWorkspaceRuntimeContext,
  ScriptWorkspaceAgentProfile,
  ScriptWorkspaceSnapshot,
  ShortWorkspaceSnapshot,
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: evaluation-and-run-lifecycle", () => {
  it("projects a child usage observation once without using its completed summary", () => {
      const input = {
        runId: "parent-usage-run",
        sessionId: "parent-usage-session",
        prompt: "委派统计"
      };
      const events = toRuntimeEvents(
        {
          type: "tool_execution_update",
          toolCallId: "spawn-usage",
          toolName: "spawn_subagent",
          args: {},
          partialResult: {
            content: [{ type: "text", text: "子智能体模型请求已完成。" }],
            details: {
              kind: "subagent-progress",
              progress: {
                type: "usage_observed",
                parentToolCallId: "spawn-usage",
                subagentRunId: "subrun-usage",
                subagentId: "reviewer",
                name: "审校",
                observationId: "subrun-usage:turn:1:attempt:1",
                observedAt: "2026-07-29T10:00:00.000Z",
                messageId: "subrun-usage_assistant",
                turnId: "subrun-usage:turn:1",
                attempt: 1,
                status: "completed",
                hadToolCall: true,
                usage: {
                  inputTokens: 12,
                  outputTokens: 5,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  totalTokens: 17
                },
                runtime: {
                  provider: "openai",
                  model: "child-model",
                  mode: "provider",
                  configId: "child-config"
                }
              }
            }
          }
        } as never,
        input,
        providerRuntime,
        "parent-usage-assistant"
      );

      expect(events).toEqual([{
        type: "agent.usage_observed",
        runId: input.runId,
        sessionId: input.sessionId,
        payload: {
          observationId: "subrun-usage:turn:1:attempt:1",
          observedAt: "2026-07-29T10:00:00.000Z",
          messageId: "subrun-usage_assistant",
          turnId: "subrun-usage:turn:1",
          attempt: 1,
          status: "completed",
          hadToolCall: true,
          usage: {
            inputTokens: 12,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 17
          },
          runtime: {
            provider: "openai",
            model: "child-model",
            mode: "provider",
            configId: "child-config"
          },
          parentToolCallId: "spawn-usage",
          subagentRunId: "subrun-usage",
          subagentId: "reviewer"
        }
      }]);
    });

  it("maps library mutation tool details to the renderer event contract", () => {
      const events = toRuntimeEvents(
        {
          type: "tool_execution_end",
          toolCallId: "tool_edit_material",
          toolName: "edit_material_entry",
          isError: false,
          result: {
            content: [{ type: "text", text: "等待审阅" }],
            details: {
              kind: "library-entry-mutation",
              operation: "edit",
              domain: "material",
              libraryId: "material-library-1",
              entryId: "entry-1",
              documentId: "document-1",
              stageId: "character",
              title: "人物甲",
              text: "修改后",
              baseRevision: createShortWorkspaceContentRevision("修改前"),
              baseProjectRevision: 4,
              summary: "等待审阅"
            }
          }
        } as never,
        {
          runId: "run_library_event",
          sessionId: "session_library_event",
          prompt: "修改人物"
        },
        providerRuntime,
        "assistant-library"
      );

      expect(events).toContainEqual({
        type: "library.editor_mutation",
        runId: "run_library_event",
        sessionId: "session_library_event",
        payload: {
          toolCallId: "tool_edit_material",
          operation: "edit",
          domain: "material",
          libraryId: "material-library-1",
          entryId: "entry-1",
          documentId: "document-1",
          stageId: "character",
          title: "人物甲",
          text: "修改后",
          baseRevision: createShortWorkspaceContentRevision("修改前"),
          baseProjectRevision: 4,
          summary: "等待审阅",
          runtime: providerRuntime
        }
      });

      const overviewEvents = toRuntimeEvents(
        {
          type: "tool_execution_end",
          toolCallId: "tool_edit_overview",
          toolName: "edit_material_library_overview",
          isError: false,
          result: {
            content: [{ type: "text", text: "等待审阅" }],
            details: {
              kind: "library-overview-mutation",
              operation: "edit-overview",
              domain: "material",
              libraryId: "material-library-1",
              documentId: "material-overview-1",
              title: "人物素材 · 库介绍",
              text: "修改后的库介绍",
              baseRevision: createShortWorkspaceContentRevision("修改前的库介绍"),
              baseProjectRevision: 5,
              summary: "等待审阅"
            }
          }
        } as never,
        {
          runId: "run_library_overview_event",
          sessionId: "session_library_event",
          prompt: "修改库介绍"
        },
        providerRuntime,
        "assistant-library-overview"
      );

      expect(overviewEvents).toContainEqual({
        type: "library.editor_mutation",
        runId: "run_library_overview_event",
        sessionId: "session_library_event",
        payload: {
          toolCallId: "tool_edit_overview",
          operation: "edit-overview",
          domain: "material",
          libraryId: "material-library-1",
          documentId: "material-overview-1",
          title: "人物素材 · 库介绍",
          text: "修改后的库介绍",
          baseRevision: createShortWorkspaceContentRevision("修改前的库介绍"),
          baseProjectRevision: 5,
          summary: "等待审阅",
          runtime: providerRuntime
        }
      });
    });

  it("starts each learning-imitation preset from a clean runtime transcript", async () => {
      const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });

      for (const [index, prompt] of ["第一次素材学习", "第二次素材学习"].entries()) {
        for await (const _event of runtime.start({
          runId: `run_learning_${index}`,
          sessionId: "session_learning",
          prompt,
          thinkingLevel: "off",
          learningImitationProfile: {
            id: "material_split",
            label: "素材拆分",
            systemPrompt: "分析当前样本文档。"
          },
          workspaceContext: {
            learningImitation: {
              stageId: "material_split",
              documents: [{
                id: "sample",
                name: "sample.txt",
                extension: "txt",
                mediaType: "text/plain",
                size: 4,
                text: "测试正文",
                charCount: 4
              }],
              result: cloneEmptyLearningImitationResult()
            }
          }
        })) {
          // Consume both complete runs before inspecting the stage-scoped cache.
        }
      }

      const cache = (
        runtime as unknown as {
          conversationAgents: Map<
            string,
            { state: { messages: Array<{ role?: string; content?: unknown }> } }
          >;
        }
      ).conversationAgents;
      const agent = cache.get("session_learning:learning-imitation:material_split");
      const userMessages = agent?.state.messages.filter(
        (message) => message.role === "user"
      );

      expect(userMessages).toHaveLength(1);
      expect(String(userMessages?.[0]?.content)).toContain(
        "【本次智能体会话固定上下文】"
      );
      expect(String(userMessages?.[0]?.content)).toContain("第二次素材学习");
    });

  it("aborts an active run through the caller signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0.01 });
      const events: AgentRuntimeEvent[] = [];

      for await (const event of runtime.start({
        runId: "run_aborted",
        sessionId: "session_aborted",
        prompt: "验证主动中止",
        signal: controller.signal
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "agent.error",
        payload: { code: "pi_agent.aborted" }
      });
    });
});
