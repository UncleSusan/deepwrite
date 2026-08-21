import type {
  ChatAssistantRequestContext,
  LongWorkspaceRuntimeContext,
  ModelSettings,
  ThinkingLevel,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  LibraryAgentWorkspaceSnapshotSchema,
  LongWorkspaceRuntimeContextSchema,
  ScriptWorkspaceSnapshotSchema,
  ShortWorkspaceSnapshotSchema,
  createExpertDraftDirectoryRevision,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import type { AgentApprovalMode } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import { cloneMessage } from "./clone";
import type { AgentConversationContext } from "./context";
import { nextConversationTimestamp } from "./context";
import {
  runPersistenceBatch,
  storeCurrentConversation
} from "./persistence-io";
import {
  clearIdleTimer,
  flushPendingAgentTextDelta,
  resetTransientConversationState,
  scheduleIdleTimeout
} from "./streaming";
import {
  failProtocol,
  finalizeRunningSubagents,
  markRunError
} from "./retry-subagent";
import { rememberRunApprovalMode } from "./approvals";
import { normalizeChatAssistantRequestContext } from "./chat-assistant-request";
import { buildConversationHistory } from "./history";
import { id, rememberBounded } from "./shared";
import type { AgentRunSettings, WorkspaceContextAttachments } from "./types";

export async function sendMessage(
  ctx: AgentConversationContext,
  activeDocument: WorkspaceDocument | null,
  workspaceDocuments: WorkspaceDocument[] = [],
  attachments: WorkspaceContextAttachments = {},
  promptAttachments: UserPromptAttachment[] = [],
  contextOverride?: WorkspaceRuntimeContext,
  mode: "workspace" | "chat-assistant" = "workspace",
  chatAssistant?: ChatAssistantRequestContext
): Promise<void> {
  const api = ctx.options.api();
  // Vue refs wrap objects in proxies, which Electron IPC cannot structured-clone.
  // Normalize at the API boundary so callers cannot accidentally leak proxies.
  const requestAttachments = promptAttachments.map((attachment) => ({
    ...attachment
  }));
  const requestChatAssistant =
    normalizeChatAssistantRequestContext(chatAssistant);
  const content =
    ctx.draft.value.trim() ||
    (requestAttachments.length ? "请阅读并分析我上传的附件。" : "");
  if (!api) {
    ctx.conversationError.value =
      "浏览器预览没有桌面 Agent Runtime，请使用 pnpm dev 启动客户端。";
    return;
  }
  if (!content || ctx.isBusy.value || ctx.hasPendingEditReview.value) {
    return;
  }

  const conversationHistory = buildConversationHistory(ctx.messages.value);

  const sendEpoch = ctx.epoch;
  const sendSessionId = ctx.sessionId.value;
  const attemptId = ++ctx.attemptSequence;
  const originalLength = activeDocument?.content.length ?? 0;
  const snapshotContent =
    activeDocument &&
    (activeDocument.workspaceType === "short" ||
      activeDocument.workspaceType === "script") &&
    activeDocument.stageId === "draft"
      ? activeDocument.content
      : (activeDocument?.content.slice(0, 20_000) ?? "");
  const contextSnapshot: WorkspaceRuntimeContext | undefined =
    mode === "chat-assistant"
      ? undefined
      : (contextOverride ??
        (activeDocument
          ? {
              activeResource: {
                id: activeDocument.id,
                domain: activeDocument.domain,
                title: activeDocument.title,
                path: [...activeDocument.path],
                ...(activeDocument.format
                  ? { format: activeDocument.format }
                  : {}),
                source: "live-editor" as const,
                content: snapshotContent,
                ...(originalLength > snapshotContent.length
                  ? { truncated: true as const, originalLength }
                  : {})
              }
            }
          : undefined));
  if (contextSnapshot && attachments.attachedSkills?.length) {
    contextSnapshot.attachedSkills = attachments.attachedSkills.map(
      (skill) => ({
        ...skill
      })
    );
  }
  if (contextSnapshot && attachments.attachedMaterials?.length) {
    contextSnapshot.attachedMaterials = attachments.attachedMaterials.map(
      (material) => ({
        ...material
      })
    );
  }
  if (!contextOverride && attachments.libraryWorkspace) {
    if (!contextSnapshot) return;
    contextSnapshot.libraryWorkspace =
      LibraryAgentWorkspaceSnapshotSchema.parse(attachments.libraryWorkspace);
  }
  if (
    !contextOverride &&
    contextSnapshot &&
    activeDocument &&
    (activeDocument.workspaceType === "short" ||
      activeDocument.workspaceType === "script") &&
    activeDocument.workspaceId &&
    activeDocument.workspaceTitle &&
    activeDocument.stageId
  ) {
    const workspaceType = activeDocument.workspaceType;
    const liveStages = workspaceDocuments.filter(
      (document) =>
        document.workspaceType === workspaceType &&
        document.workspaceId === activeDocument.workspaceId &&
        document.stageId
    );
    const plotStageDocuments = liveStages
      .filter(
        (document) =>
          document.draftFileKind === undefined &&
          document.plotStageOrder !== undefined &&
          document.plotStageDescription !== undefined
      )
      .sort(
        (left, right) =>
          (left.plotStageOrder ?? 0) - (right.plotStageOrder ?? 0)
      );
    const plotStages = plotStageDocuments.map((document) => ({
      id: document.stageId!,
      title: document.title,
      description: document.plotStageDescription!
    }));
    const textStageIds = [
      "character_design",
      ...plotStages.map(({ id }) => id)
    ];
    const stages = textStageIds.map((stageId) => {
      const document = liveStages.find(
        (candidate) =>
          candidate.stageId === stageId &&
          candidate.draftFileKind === undefined &&
          (stageId !== "character_design" ||
            candidate.characterFileKind !== "item")
      );
      if (!document) return undefined;
      return {
        stageId,
        title: document.title,
        content: document.content,
        revision: createShortWorkspaceContentRevision(document.content)
      };
    });
    const completeStages = stages.filter(
      (stage): stage is NonNullable<typeof stage> => stage !== undefined
    );
    const characterItemDocuments = liveStages
      .filter(
        (document) =>
          document.stageId === "character_design" &&
          document.characterFileKind === "item" &&
          document.characterItemId
      )
      .sort(
        (left, right) =>
          (left.characterItemOrder ?? 0) - (right.characterItemOrder ?? 0)
      );
    const characterStructure =
      characterItemDocuments.length > 0 ||
      liveStages.some(
        (document) =>
          document.stageId === "character_design" &&
          document.characterFileKind === "overview" &&
          document.path.length > 2
      )
        ? {
            format: "list" as const,
            items: characterItemDocuments.map((document, index) => {
              return {
                id: document.characterItemId!,
                title: document.title,
                order: document.characterItemOrder ?? index + 1,
                content: document.content,
                revision: createShortWorkspaceContentRevision(document.content)
              };
            })
          }
        : { format: "text" as const };
    const draftSections = new Map<
      string,
      {
        id: string;
        order: number;
        title: string;
        wordCountRequirement: string;
        body?: WorkspaceDocument;
        characterState?: WorkspaceDocument;
      }
    >();
    for (const document of liveStages) {
      if (
        document.stageId !== "draft" ||
        !document.expertSectionId ||
        !document.draftFileKind
      ) {
        continue;
      }
      const current = draftSections.get(document.expertSectionId) ?? {
        id: document.expertSectionId,
        order: document.expertSectionOrder ?? Number.MAX_SAFE_INTEGER,
        title:
          document.draftFileKind === "body"
            ? document.title
            : document.title.replace(/\s*·\s*人物状态$/u, ""),
        wordCountRequirement: document.expertWordCountRequirement ?? ""
      };
      if (document.draftFileKind === "body") {
        current.title = document.title;
        current.wordCountRequirement =
          document.expertWordCountRequirement ?? "";
        current.body = document;
      } else {
        current.characterState = document;
      }
      draftSections.set(document.expertSectionId, current);
    }
    const completeDraftSections = [...draftSections.values()]
      .sort((left, right) => left.order - right.order)
      .flatMap((section) => {
        if (!section.body || !section.characterState) return [];
        return [
          {
            id: section.id,
            title: section.title,
            wordCountRequirement: section.wordCountRequirement,
            body: {
              documentId: section.body.id,
              title: section.body.title,
              content: section.body.content,
              revision: createShortWorkspaceContentRevision(
                section.body.content
              )
            },
            characterState: {
              documentId: section.characterState.id,
              title: section.characterState.title,
              content: section.characterState.content,
              revision: createShortWorkspaceContentRevision(
                section.characterState.content
              )
            }
          }
        ];
      });
    if (
      completeStages.length === textStageIds.length &&
      completeDraftSections.length > 0
    ) {
      const expertDraftRevision = createExpertDraftDirectoryRevision(
        completeDraftSections.map((section) => ({
          id: section.id,
          title: section.title,
          wordCountRequirement: section.wordCountRequirement
        }))
      );
      const creativeWorkspace = {
        id: activeDocument.workspaceId,
        title: activeDocument.workspaceTitle,
        categories: [...(activeDocument.workspaceCategories ?? [])],
        activeStageId: activeDocument.stageId,
        plotStages,
        characterStructure,
        ...(activeDocument.shortAgentId
          ? { activeAgentId: activeDocument.shortAgentId }
          : {}),
        ...(activeDocument.expertSectionId
          ? { activeSectionId: activeDocument.expertSectionId }
          : {}),
        expertDraft: {
          id: "draft",
          title: workspaceType === "script" ? "剧集" : "正文",
          revision: expertDraftRevision,
          sections: completeDraftSections
        },
        stages: completeStages
      };
      if (workspaceType === "script") {
        contextSnapshot.scriptWorkspace =
          ScriptWorkspaceSnapshotSchema.parse(creativeWorkspace);
      } else {
        contextSnapshot.shortWorkspace =
          ShortWorkspaceSnapshotSchema.parse(creativeWorkspace);
      }
    }
  }

  ctx.messages.value.push({
    id: id("user"),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    ...(requestAttachments.length
      ? {
          attachments: requestAttachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            kind: attachment.kind,
            mediaType: attachment.mediaType,
            size: attachment.size,
            ...(attachment.kind === "text" && attachment.truncated
              ? { truncated: true }
              : {})
          }))
        }
      : {}),
    status: "completed"
  });
  ctx.draft.value = "";
  ctx.conversationError.value = null;
  ctx.pendingAttemptId.value = attemptId;
  ctx.approvalModeByAttempt.set(attemptId, ctx.approvalMode.value);
  ctx.submitting.value = true;
  scheduleIdleTimeout(ctx, {
    expectedEpoch: sendEpoch,
    expectedSessionId: sendSessionId,
    attemptId
  });

  try {
    const selectedModel = ctx.configuredModels.value.find(
      (model) => model.id === ctx.selectedModelId.value
    );
    const accepted = await api.session.prompt({
      sessionId: sendSessionId,
      message: content,
      ...(conversationHistory.length ? { conversationHistory } : {}),
      ...(mode === "chat-assistant"
        ? {
            mode,
            ...(requestChatAssistant
              ? { chatAssistant: requestChatAssistant }
              : {})
          }
        : {}),
      ...(requestAttachments.length ? { attachments: requestAttachments } : {}),
      ...(mode === "chat-assistant"
        ? {}
        : { writeApprovalMode: ctx.approvalModeByAttempt.get(attemptId) }),
      ...(ctx.selectedModelId.value
        ? { modelId: ctx.selectedModelId.value }
        : {}),
      ...(ctx.thinkingLevel.value === "off"
        ? {
            thinkingLevel: "off" as const,
            ...(selectedModel ? { temperature: ctx.temperature.value } : {})
          }
        : { thinkingLevel: ctx.thinkingLevel.value }),
      ...(contextSnapshot ? { workspaceContext: contextSnapshot } : {})
    });
    if (
      ctx.epoch !== sendEpoch ||
      ctx.sessionId.value !== sendSessionId ||
      ctx.pendingAttemptId.value !== attemptId
    ) {
      if (accepted.sessionId === sendSessionId) {
        void api.session
          .abort({
            sessionId: accepted.sessionId,
            runId: accepted.runId
          })
          .catch(() => undefined);
      }
      return;
    }
    if (accepted.sessionId !== sendSessionId) {
      const observedRunId = ctx.observedRunByAttempt.get(attemptId);
      if (observedRunId) {
        failProtocol(
          ctx,
          observedRunId,
          "智能体受理结果返回了错误的会话标识。",
          accepted.runtime
        );
      }
      ctx.pendingAttemptId.value = null;
      ctx.approvalModeByAttempt.delete(attemptId);
      ctx.submitting.value = false;
      clearIdleTimer(ctx);
      ctx.conversationError.value = "智能体受理结果返回了错误的会话标识。";
      return;
    }

    const observedRunId = ctx.observedRunByAttempt.get(attemptId);
    if (observedRunId && observedRunId !== accepted.runId) {
      failProtocol(
        ctx,
        observedRunId,
        "智能体受理结果与已到达事件的运行标识不一致。",
        accepted.runtime
      );
      ctx.pendingAttemptId.value = null;
      ctx.observedRunByAttempt.delete(attemptId);
      ctx.approvalModeByAttempt.delete(attemptId);
      rememberBounded(ctx.finishedRunIds, accepted.runId);
      return;
    }

    ctx.runtime.value = accepted.runtime;
    const acceptedApprovalMode = ctx.approvalModeByAttempt.get(attemptId);
    if (acceptedApprovalMode) {
      rememberRunApprovalMode(ctx, accepted.runId, acceptedApprovalMode);
    }
    ctx.pendingAttemptId.value = null;
    ctx.observedRunByAttempt.delete(attemptId);
    ctx.approvalModeByAttempt.delete(attemptId);
    ctx.submitting.value = false;
    if (!ctx.finishedRunIds.has(accepted.runId)) {
      ctx.activeRunId.value = accepted.runId;
      scheduleIdleTimeout(ctx, {
        expectedEpoch: sendEpoch,
        expectedSessionId: sendSessionId,
        runId: accepted.runId
      });
    } else {
      clearIdleTimer(ctx);
    }
  } catch (error: unknown) {
    if (
      ctx.epoch !== sendEpoch ||
      ctx.sessionId.value !== sendSessionId ||
      ctx.pendingAttemptId.value !== attemptId
    ) {
      return;
    }
    const messageText =
      error instanceof Error ? error.message : "智能体请求受理失败。";
    const observedRunId = ctx.observedRunByAttempt.get(attemptId);
    if (observedRunId) {
      markRunError(
        ctx,
        observedRunId,
        messageText,
        ctx.runtime.value ?? undefined
      );
      if (ctx.activeRunId.value === observedRunId) {
        ctx.activeRunId.value = null;
      }
    }
    ctx.pendingAttemptId.value = null;
    ctx.observedRunByAttempt.delete(attemptId);
    ctx.approvalModeByAttempt.delete(attemptId);
    ctx.submitting.value = false;
    clearIdleTimer(ctx);
    ctx.conversationError.value = messageText;
  }
}

export async function sendAssistantMessage(
  ctx: AgentConversationContext,
  context: ChatAssistantRequestContext = { mode: "normal" }
): Promise<void> {
  await sendMessage(
    ctx,
    null,
    [],
    {},
    [],
    undefined,
    "chat-assistant",
    context
  );
}

export async function sendLongMessage(
  ctx: AgentConversationContext,
  context: LongWorkspaceRuntimeContext,
  attachments: Pick<
    WorkspaceRuntimeContext,
    "attachedSkills" | "attachedMaterials"
  > = {},
  promptAttachments: UserPromptAttachment[] = []
): Promise<void> {
  const longWorkspace = LongWorkspaceRuntimeContextSchema.parse(context);
  await sendMessage(
    ctx,
    {
      id: longWorkspace.bookId,
      domain: "creation",
      title: longWorkspace.title,
      eyebrow: "长篇创作",
      path: [longWorkspace.title],
      content: "",
      readOnly: true
    },
    [],
    attachments,
    promptAttachments,
    { longWorkspace }
  );
}

export async function stopGeneration(
  ctx: AgentConversationContext
): Promise<boolean> {
  flushPendingAgentTextDelta(ctx);
  const api = ctx.options.api();
  const runId = ctx.activeRunId.value;
  if (!api || !runId || ctx.stopping.value) {
    return false;
  }

  const stopEpoch = ctx.epoch;
  const stopSessionId = ctx.sessionId.value;
  ctx.stopping.value = true;
  try {
    const accepted = await api.session.abort({
      sessionId: stopSessionId,
      runId
    });
    if (accepted.sessionId !== stopSessionId || accepted.runId !== runId) {
      throw new Error("智能体停止结果与当前运行不一致。");
    }
    return true;
  } catch (error: unknown) {
    if (
      ctx.epoch !== stopEpoch ||
      ctx.sessionId.value !== stopSessionId ||
      ctx.activeRunId.value !== runId
    ) {
      return false;
    }
    ctx.stopping.value = false;
    throw error;
  }
}

export function cancelPendingGeneration(
  ctx: AgentConversationContext
): boolean {
  if (ctx.pendingAttemptId.value === null || ctx.activeRunId.value !== null) {
    return false;
  }
  newConversation(ctx);
  return true;
}

export function stopStreamingMessages(ctx: AgentConversationContext): void {
  flushPendingAgentTextDelta(ctx);
  const completedAt = new Date().toISOString();
  for (const message of ctx.messages.value) {
    if (message.status !== "streaming") continue;
    message.status = "stopped";
    if (message.retry) delete message.retry;
    finalizeRunningSubagents(
      ctx,
      message,
      "stopped",
      completedAt,
      "会话已切换或关闭，子任务同步停止。"
    );
    for (const run of message.subagentRuns ?? []) {
      if (run.retry) delete run.retry;
    }
    if (message.processingStartedAt && !message.processingCompletedAt) {
      message.processingCompletedAt = completedAt;
    }
  }
}

export function newConversation(ctx: AgentConversationContext): void {
  runPersistenceBatch(ctx, () => {
    stopStreamingMessages(ctx);
    storeCurrentConversation(ctx);
    resetTransientConversationState(ctx);
    const timestamp = nextConversationTimestamp(ctx);
    ctx.sessionId.value = id("session");
    ctx.messages.value = [];
    ctx.draft.value = "";
    ctx.currentCreatedAt.value = timestamp;
    ctx.currentUpdatedAt.value = timestamp;
  });
}

export function selectConversation(
  ctx: AgentConversationContext,
  nextSessionId: string
): boolean {
  if (nextSessionId === ctx.sessionId.value) return true;
  if (ctx.isBusy.value) return false;

  // A selectable conversation should already be idle. Normalize any stale
  // presentation state before persisting so a detached streaming card cannot
  // be restored without an owning run.
  let selected = false;
  runPersistenceBatch(ctx, () => {
    stopStreamingMessages(ctx);
    storeCurrentConversation(ctx);
    const selectedConversation = ctx.storedConversations.value.find(
      (conversation) => conversation.sessionId === nextSessionId
    );
    if (!selectedConversation) return;

    resetTransientConversationState(ctx);
    ctx.sessionId.value = selectedConversation.sessionId;
    ctx.messages.value = selectedConversation.messages.map(cloneMessage);
    ctx.draft.value = selectedConversation.draft;
    ctx.currentCreatedAt.value = selectedConversation.createdAt;
    ctx.currentUpdatedAt.value = nextConversationTimestamp(ctx);
    selected = true;
  });
  return selected;
}

export function applyRunSettings(
  ctx: AgentConversationContext,
  settings: AgentRunSettings
): void {
  ctx.hasRunSettingsPreference = true;
  ctx.approvalMode.value = settings.approvalMode;
  if (ctx.configuredModels.value.length === 0) {
    if (ctx.modelSettingsApplied) {
      ctx.selectedModelId.value = "";
      ctx.thinkingLevel.value = "medium";
      ctx.temperature.value = 0.7;
    } else {
      ctx.selectedModelId.value = settings.selectedModelId;
      ctx.thinkingLevel.value = settings.thinkingLevel;
      ctx.temperature.value = settings.temperature;
    }
    return;
  }

  const preferredModel = ctx.configuredModels.value.find(
    (model) => model.id === settings.selectedModelId
  );
  const selected =
    preferredModel ??
    ctx.configuredModels.value.find(
      (model) => model.id === ctx.defaultModelId.value
    ) ??
    ctx.configuredModels.value[0];
  if (!selected) return;

  ctx.selectedModelId.value = selected.id;
  ctx.thinkingLevel.value =
    preferredModel &&
    (settings.thinkingLevel === "off" ||
      selected.thinkingLevelOptions.includes(settings.thinkingLevel))
      ? settings.thinkingLevel
      : selected.defaultThinkingLevel;
  ctx.temperature.value =
    preferredModel && selected.temperatureOptions.includes(settings.temperature)
      ? settings.temperature
      : (selected.temperatureOptions[1] ?? 0.7);
}

export function applyModelSettings(
  ctx: AgentConversationContext,
  settings: ModelSettings
): void {
  const currentRunSettings: AgentRunSettings = {
    selectedModelId: ctx.selectedModelId.value,
    thinkingLevel: ctx.thinkingLevel.value,
    temperature: ctx.temperature.value,
    approvalMode: ctx.approvalMode.value
  };
  ctx.configuredModels.value = settings.models;
  ctx.defaultModelId.value = settings.defaultModelId;
  ctx.modelSettingsApplied = true;
  if (settings.models.length === 0) {
    ctx.selectedModelId.value = "";
    ctx.thinkingLevel.value = "medium";
    ctx.temperature.value = 0.7;
    return;
  }
  if (ctx.hasRunSettingsPreference) {
    applyRunSettings(ctx, currentRunSettings);
    return;
  }

  const selected =
    settings.models.find((model) => model.id === settings.defaultModelId) ??
    settings.models[0];
  ctx.selectedModelId.value = selected?.id ?? "";
  ctx.thinkingLevel.value = selected?.defaultThinkingLevel ?? "medium";
  ctx.temperature.value = selected?.temperatureOptions[1] ?? 0.7;
  ctx.hasRunSettingsPreference = true;
}

export function selectModel(
  ctx: AgentConversationContext,
  modelId: string
): void {
  const selected = ctx.configuredModels.value.find(
    (model) => model.id === modelId
  );
  if (!selected) {
    return;
  }
  ctx.selectedModelId.value = selected.id;
  ctx.thinkingLevel.value = selected.defaultThinkingLevel;
  ctx.temperature.value = selected.temperatureOptions[1];
}

export function selectThinkingLevel(
  ctx: AgentConversationContext,
  level: ThinkingLevel
): void {
  const selected = ctx.configuredModels.value.find(
    (model) => model.id === ctx.selectedModelId.value
  );
  if (!selected) {
    ctx.thinkingLevel.value = level;
    return;
  }
  if (level !== "off" && !selected.thinkingLevelOptions.includes(level)) {
    return;
  }
  ctx.thinkingLevel.value = level;
}

export function selectTemperature(
  ctx: AgentConversationContext,
  value: number
): void {
  const selected = ctx.configuredModels.value.find(
    (model) => model.id === ctx.selectedModelId.value
  );
  if (
    !selected ||
    ctx.thinkingLevel.value !== "off" ||
    !selected.temperatureOptions.includes(value)
  ) {
    return;
  }
  ctx.temperature.value = value;
}

export function selectApprovalMode(
  ctx: AgentConversationContext,
  mode: AgentApprovalMode
): void {
  if (mode === "request-approval" || mode === "auto-approve") {
    ctx.approvalMode.value = mode;
  }
}
