import {
  ActiveResourceSnapshotSchema,
  AgentEvaluationSnapshotEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentPromptCommandPayloadSchema,
  AgentRetryScheduledEventEnvelopeSchema,
  AgentTurnStartedEventEnvelopeSchema,
  AgentUsageObservedEventEnvelopeSchema,
  AppearanceSettingsSchema,
  AppearanceSettingsSnapshotSchema,
  CommandEnvelopeSchema,
  DEFAULT_LIBRARY_AGENT_SETTINGS,
  ExpertDraftFileSnapshotSchema,
  ExpertDraftSchema,
  ExportShortManuscriptResultSchema,
  LearningImitationDocumentSchema,
  LibraryAgentSettingsInputSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  PROMPT_IMAGE_ATTACHMENT_MAX_BYTES,
  PROTOCOL_VERSION,
  PromptTextAttachmentSchema,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  SessionPromptAcceptedPayloadSchema,
  ShortCharacterItemSnapshotSchema,
  ShortWorkspaceStageSnapshotSchema,
  SubagentActivitySchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  UserPromptAttachmentsSchema,
  UtilityInboundMessageSchema,
  UtilityOutboundMessageSchema,
  WorkspaceEditorMutationPayloadSchema,
  WorkspaceRuntimeContextSchema,
  createDefaultAppearanceSettings,
  createDefaultCreativePlotStages,
  createEnvelope,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  it,
  listAppearanceEditorFontFamilyOptions,
  listAppearanceUiFontFamilyOptions,
  resolveAppearanceEditorFontStack,
  resolveAppearanceUiFontStack,
  runtime,
  shortWorkspaceRuntimeFixture,
} from "./index.test-support";

describe("DeepWrite desktop contracts: commands-models-and-prompts", () => {
  it("creates a versioned command envelope with a correlation id", () => {
      const envelope = createEnvelope("system.health", {}, { id: "cmd_health" });

      expect(CommandEnvelopeSchema.parse(envelope)).toMatchObject({
        protocolVersion: PROTOCOL_VERSION,
        id: "cmd_health",
        type: "system.health",
        context: { correlationId: "cmd_health" }
      });
    });

  it("rejects unknown protocol versions", () => {
      const envelope = createEnvelope("system.health", {}, { id: "cmd_health" });

      expect(() => CommandEnvelopeSchema.parse({ ...envelope, protocolVersion: 2 })).toThrow();
    });

  it("accepts a validated short manuscript export command and result", () => {
      const envelope = createEnvelope(
        "manuscript.exportShort",
        {
          title: "雨夜来信",
          format: "epub" as const,
          sections: [
            { title: "导语", content: "雨落下来。" },
            { title: "第一节", content: "她打开了门。" }
          ]
        },
        { id: "cmd_export_short" }
      );

      expect(CommandEnvelopeSchema.parse(envelope)).toMatchObject({
        type: "manuscript.exportShort",
        payload: { format: "epub" }
      });
      expect(
        ExportShortManuscriptResultSchema.parse({
          status: "saved",
          filePath: "/tmp/雨夜来信.epub"
        })
      ).toMatchObject({ status: "saved" });
    });

  it("accepts three healthy utility workers", () => {
      const workers = ["core", "agent", "tool"].map((name, index) => ({
        name,
        status: "ok",
        pid: 1000 + index,
        details: {}
      }));

      expect(
        SystemHealthPayloadSchema.parse({
          status: "ok",
          checkedAt: new Date().toISOString(),
          workers
        }).workers
      ).toHaveLength(3);
    });

  it("accepts a prompt with a matching session and live editor snapshot", () => {
      const envelope = createEnvelope(
        "session.prompt",
        {
          sessionId: "session_1",
          message: "续写这一段",
          thinkingLevel: "medium" as const,
          writeApprovalMode: "auto-approve" as const,
          workspaceContext: {
            activeResource: {
              id: "chapter_1",
              domain: "creation" as const,
              title: "第一章",
              path: ["长篇小说", "第一章"],
              format: "markdown",
              source: "live-editor" as const,
              content: "窗外正在下雨。"
            }
          }
        },
        {
          id: "cmd_prompt",
          context: { sessionId: "session_1", resourceId: "chapter_1" }
        }
      );

      expect(CommandEnvelopeSchema.parse(envelope)).toMatchObject({
        type: "session.prompt",
        payload: { writeApprovalMode: "auto-approve" }
      });
    });

  it("keeps chat-assistant prompts isolated from workspace and write context", () => {
      const accepted = createEnvelope(
        "session.prompt",
        {
          sessionId: "session_chat_1",
          message: "聊聊今天的计划",
          mode: "chat-assistant" as const,
          thinkingLevel: "medium" as const
        },
        { id: "cmd_chat", context: { sessionId: "session_chat_1" } }
      );
      expect(CommandEnvelopeSchema.parse(accepted)).toMatchObject({
        payload: { mode: "chat-assistant" }
      });

      const project = createEnvelope(
        "session.prompt",
        {
          sessionId: "session_chat_project",
          message: "核对第一章伏笔",
          mode: "chat-assistant" as const,
          chatAssistant: {
            mode: "project" as const,
            project: { projectType: "long" as const, projectId: "book-1" }
          }
        },
        { id: "cmd_chat_project", context: { sessionId: "session_chat_project" } }
      );
      expect(CommandEnvelopeSchema.parse(project)).toMatchObject({
        payload: {
          chatAssistant: {
            mode: "project",
            project: { projectType: "long", projectId: "book-1" }
          }
        }
      });

      const invalidProject = createEnvelope(
        "session.prompt",
        {
          sessionId: "session_chat_project",
          message: "缺少项目",
          mode: "chat-assistant" as const,
          chatAssistant: { mode: "project" as const }
        },
        { id: "cmd_chat_project_invalid", context: { sessionId: "session_chat_project" } }
      );
      expect(() => CommandEnvelopeSchema.parse(invalidProject)).toThrow();

      for (const forbidden of [
        { workspaceContext: {} },
        { writeApprovalMode: "request-approval" as const }
      ]) {
        const envelope = createEnvelope(
          "session.prompt",
          {
            sessionId: "session_chat_1",
            message: "不要读取工作区",
            mode: "chat-assistant" as const,
            ...forbidden
          },
          { id: "cmd_chat_forbidden", context: { sessionId: "session_chat_1" } }
        );
        expect(() => CommandEnvelopeSchema.parse(envelope)).toThrow();
      }
    });

  it("accepts extracted text and base64 image prompt attachments", () => {
      const attachments = UserPromptAttachmentsSchema.parse([
        {
          id: "attachment_notes",
          kind: "text",
          name: "notes.md",
          mediaType: "text/markdown",
          size: 18,
          content: "雨夜场景需要更压抑。"
        },
        {
          id: "attachment_reference",
          kind: "image",
          name: "reference.png",
          mediaType: "image/png",
          size: 3,
          data: "AQID"
        }
      ]);

      expect(attachments.map((attachment) => attachment.kind)).toEqual(["text", "image"]);
      expect(() =>
        UserPromptAttachmentsSchema.parse([
          {
            id: "too_large",
            kind: "image",
            name: "too-large.png",
            mediaType: "image/png",
            size: PROMPT_IMAGE_ATTACHMENT_MAX_BYTES + 1,
            data: "AQID"
          }
        ])
      ).toThrow();
      expect(() =>
        UserPromptAttachmentsSchema.parse([
          {
            id: "forged_size",
            kind: "image",
            name: "forged.png",
            mediaType: "image/png",
            size: 1,
            data: "AQID"
          }
        ])
      ).toThrow();
    });

  it("normalizes public model settings without exposing API keys", () => {
      const settings = ModelSettingsSchema.parse({
        defaultModelId: "deepseek",
        models: [
          {
            id: "deepseek",
            label: "DeepSeek",
            provider: "deepseek",
            modelId: "deepseek-chat",
            api: "openai-completions",
            baseUrl: "https://api.deepseek.com.example.test/v1",
            reasoning: true,
            defaultThinkingLevel: "xhigh",
            hasApiKey: true,
            apiKey: "must-not-cross-the-boundary"
          }
        ]
      });

      expect(settings.models[0]?.defaultThinkingLevel).toBe("xhigh");
      expect(settings.models[0]?.thinkingLevelOptions).toEqual([
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]);
      expect(settings.models[0]?.temperatureOptions).toEqual([0.1, 0.7, 1]);
      expect("apiKey" in (settings.models[0] ?? {})).toBe(false);
    });

  it("accepts max and one custom provider thinking level", () => {
      const settings = ModelSettingsInputSchema.parse({
        defaultModelId: "writer",
        models: [
          {
            id: "writer",
            label: "Writer",
            provider: "custom",
            modelId: "writer-model",
            api: "openai-responses",
            baseUrl: "https://ollama.example.test/v1",
            reasoning: true,
            defaultThinkingLevel: "ultra",
            thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max", "ultra"],
            temperatureOptions: [0.1, 0.7, 1]
          }
        ]
      });

      expect(settings.models[0]?.thinkingLevelOptions).toContain("max");
      expect(settings.models[0]?.defaultThinkingLevel).toBe("ultra");
    });

  it("rejects invalid model defaults and reasoning defaults", () => {
      const model = {
        id: "plain",
        label: "Plain model",
        provider: "custom",
        modelId: "plain-model",
        api: "openai-completions" as const,
        baseUrl: "https://ollama.example.test/v1",
        reasoning: false,
        defaultThinkingLevel: "high" as const
      };

      expect(() =>
        ModelSettingsInputSchema.parse({ models: [model], defaultModelId: "plain" })
      ).toThrow();
      expect(() =>
        ModelSettingsInputSchema.parse({
          models: [{ ...model, reasoning: true, defaultThinkingLevel: "medium" }],
          defaultModelId: "missing"
        })
      ).toThrow();
      expect(() =>
        ModelSettingsInputSchema.parse({
          models: [
            {
              ...model,
              reasoning: true,
              defaultThinkingLevel: "high",
              thinkingLevelOptions: ["low", "medium"]
            }
          ],
          defaultModelId: "plain"
        })
      ).toThrow();
      expect(() =>
        ModelSettingsInputSchema.parse({
          models: [
            {
              ...model,
              defaultThinkingLevel: "off",
              temperatureOptions: [0.7, 0.7, 1]
            }
          ],
          defaultModelId: "plain"
        })
      ).toThrow();
    });

  it("accepts an unsaved model draft for a connection test", () => {
      const envelope = createEnvelope(
        "models.test",
        {
          model: {
            id: "draft-model",
            label: "Draft model",
            provider: "custom",
            modelId: "draft-v1",
            api: "openai-completions" as const,
            baseUrl: "https://ollama.example.test/v1",
            reasoning: false,
            defaultThinkingLevel: "off" as const,
            apiKey: "not-yet-saved"
          }
        },
        { id: "cmd_test_draft" }
      );

      expect(CommandEnvelopeSchema.parse(envelope).type).toBe("models.test");
    });

  it("accepts a remote model list request from an unsaved draft", () => {
      const envelope = createEnvelope(
        "models.listRemote",
        {
          id: "draft-model",
          provider: "custom",
          api: "openai-completions" as const,
          baseUrl: "https://api.example.test/v1",
          apiKey: "not-a-real-key"
        },
        { id: "cmd_list_remote" }
      );

      expect(CommandEnvelopeSchema.parse(envelope).type).toBe("models.listRemote");
    });

  it("rejects blank prompts and mismatched session context", () => {
      const blank = createEnvelope(
        "session.prompt",
        { sessionId: "session_1", message: "   " },
        { id: "cmd_blank", context: { sessionId: "session_1" } }
      );
      const mismatch = createEnvelope(
        "session.prompt",
        { sessionId: "session_1", message: "继续" },
        { id: "cmd_mismatch", context: { sessionId: "session_2" } }
      );

      expect(() => CommandEnvelopeSchema.parse(blank)).toThrow();
      expect(() => CommandEnvelopeSchema.parse(mismatch)).toThrow();
    });

  it("validates a session abort against its session and run context", () => {
      const abort = createEnvelope(
        "session.abort",
        { sessionId: "session_1", runId: "run_1" },
        {
          id: "cmd_abort",
          context: { sessionId: "session_1", runId: "run_1" }
        }
      );
      const mismatch = createEnvelope(
        "session.abort",
        { sessionId: "session_1", runId: "run_1" },
        {
          id: "cmd_abort_mismatch",
          context: { sessionId: "session_1", runId: "run_2" }
        }
      );

      expect(CommandEnvelopeSchema.parse(abort).type).toBe("session.abort");
      expect(() => CommandEnvelopeSchema.parse(mismatch)).toThrow();
    });

  it("validates quick acceptance independently from streamed events", () => {
      expect(
        SessionPromptAcceptedPayloadSchema.parse({
          sessionId: "session_1",
          runId: "run_1",
          acceptedAt: new Date().toISOString(),
          runtime
        })
      ).toMatchObject({ runId: "run_1", runtime });
    });

  it("accepts delta and completion events with consistent envelope identity", () => {
      const delta = createEnvelope(
        "agent.message_delta",
        {
          sessionId: "session_1",
          runId: "run_1",
          messageId: "message_1",
          delta: "第一段",
          runtime
        },
        {
          id: "event_delta",
          context: { sessionId: "session_1", runId: "run_1" }
        }
      );
      const completed = createEnvelope(
        "agent.message_completed",
        {
          sessionId: "session_1",
          runId: "run_1",
          messageId: "message_1",
          role: "assistant" as const,
          content: "第一段",
          thinking: "先理解上下文。",
          stopReason: "stop",
          runtime
        },
        {
          id: "event_completed",
          context: { sessionId: "session_1", runId: "run_1" }
        }
      );

      expect(AgentMessageDeltaEventEnvelopeSchema.parse(delta).payload.delta).toBe("第一段");
      expect(AgentMessageCompletedEventEnvelopeSchema.parse(completed).payload.content).toBe(
        "第一段"
      );
      expect(SystemEventEnvelopeSchema.parse(completed).type).toBe("agent.message_completed");
    });
});
