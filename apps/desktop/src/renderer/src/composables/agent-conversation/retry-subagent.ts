import type { AgentRuntimeRef, SystemEventEnvelope } from "@deepwrite/contracts";
import type {
  AgentRetryMetadata,
  AgentSubagentRun,
  ChatMessage
} from "../../types/conversation";
import { cloneMessage, cloneSubagentRun } from "./clone";
import type { AgentConversationContext } from "./context";
import { id, isRecord, rememberBounded } from "./shared";
import { flushPendingAgentTextDelta, clearIdleTimer } from "./streaming";
import type {
  AgentTurnCheckpoint,
  SubagentActivityEventEnvelope,
  SubagentEventEnvelope,
  SubagentEventPayload,
  SubagentTurnCheckpoint
} from "./types";

export function assistantMessageForRun(ctx: AgentConversationContext, runId: string): ChatMessage | undefined {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  return (
    (mappedMessageId
      ? ctx.messages.value.find(
          (message) =>
            message.id === mappedMessageId &&
            message.role === "assistant" &&
            message.runId === runId
        )
      : undefined) ??
    ctx.messages.value.find(
      (message) => message.role === "assistant" && message.runId === runId
    )
  );
}

export function subagentTurnKey(ctx: AgentConversationContext, runId: string, subagentRunId: string): string {
  return `${runId}\u0000${subagentRunId}`;
}

export function clearRetryStateForRun(ctx: AgentConversationContext, runId: string): void {
  ctx.turnCheckpointByRun.delete(runId);
  const message = assistantMessageForRun(ctx, runId);
  if (message?.retry) delete message.retry;
  for (const run of message?.subagentRuns ?? []) {
    if (run.retry) delete run.retry;
    ctx.subagentTurnCheckpointByRun.delete(
      subagentTurnKey(ctx, runId, run.subagentRunId)
    );
  }
}

export function finalizeRunningSubagents(
  ctx: AgentConversationContext,
  message: ChatMessage,
  status: "error" | "stopped",
  completedAt: string,
  reason: string
): void {
  for (const run of message.subagentRuns ?? []) {
    if (run.status !== "running") continue;
    run.status = status;
    run.completedAt = completedAt;
    run.errorMessage = reason;
    for (const toolCall of run.toolCalls) {
      if (toolCall.status !== "preparing" && toolCall.status !== "running") {
        continue;
      }
      toolCall.status = "error";
      toolCall.completedAt = completedAt;
      toolCall.resultSummary ??= reason;
      toolCall.isError = true;
    }
  }
}

export function markRunError(
  ctx: AgentConversationContext,
  runId: string,
  messageText: string,
  eventRuntime?: AgentRuntimeRef
): void {
  flushPendingAgentTextDelta(ctx);
  const messageId = ctx.runMessageIds.get(runId) ?? `${runId}_assistant`;
  let message = ctx.messages.value.find(
    (item) => item.id === messageId && item.role === "assistant" && item.runId === runId
  );
  if (!message) {
    message = {
      id: ctx.messages.value.some((item) => item.id === messageId)
        ? `${messageId}_${id("error")}`
        : messageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      runId,
      status: "error",
      errorMessage: messageText,
      ...(eventRuntime ? { runtime: eventRuntime } : {})
    };
    ctx.messages.value.push(message);
    message = ctx.messages.value.find((item) => item.id === messageId)!;
    ctx.runMessageIds.set(runId, message.id);
  }
  message.status = "error";
  message.errorMessage = messageText;
  const completedAt = new Date().toISOString();
  finalizeRunningSubagents(ctx, message, "error", completedAt, messageText);
  if (message.processingStartedAt) {
    message.processingCompletedAt = completedAt;
  }
  clearRetryStateForRun(ctx, runId);
  rememberBounded(ctx.finishedRunIds, runId);
}

export function markRunStopped(ctx: AgentConversationContext, runId: string, eventRuntime?: AgentRuntimeRef): void {
  flushPendingAgentTextDelta(ctx);
  const messageId = ctx.runMessageIds.get(runId) ?? `${runId}_assistant`;
  let message = ctx.messages.value.find(
    (item) => item.id === messageId && item.role === "assistant" && item.runId === runId
  );
  if (!message) {
    message = {
      id: ctx.messages.value.some((item) => item.id === messageId)
        ? `${messageId}_${id("stopped")}`
        : messageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      runId,
      status: "stopped",
      ...(eventRuntime ? { runtime: eventRuntime } : {})
    };
    ctx.messages.value.push(message);
    message = ctx.messages.value.find((item) => item.id === messageId)!;
    ctx.runMessageIds.set(runId, message.id);
  }
  message.status = "stopped";
  const completedAt = new Date().toISOString();
  finalizeRunningSubagents(ctx,
    message,
    "stopped",
    completedAt,
    "父智能体运行已停止，子任务同步停止。"
  );
  if (message.processingStartedAt) {
    message.processingCompletedAt = completedAt;
  }
  clearRetryStateForRun(ctx, runId);
  rememberBounded(ctx.finishedRunIds, runId);
}

export function invalidateAttemptForRun(ctx: AgentConversationContext, runId: string): void {
  for (const [attemptId, observedRunId] of ctx.observedRunByAttempt) {
    if (observedRunId !== runId) {
      continue;
    }
    ctx.observedRunByAttempt.delete(attemptId);
    ctx.approvalModeByAttempt.delete(attemptId);
    if (ctx.pendingAttemptId.value === attemptId) {
      ctx.pendingAttemptId.value = null;
    }
  }
}

export function failProtocol(ctx: AgentConversationContext, runId: string, messageText: string, eventRuntime?: AgentRuntimeRef): void {
  markRunError(ctx, runId, messageText, eventRuntime);
  invalidateAttemptForRun(ctx, runId);
  if (ctx.activeRunId.value === runId) {
    ctx.activeRunId.value = null;
  }
  ctx.submitting.value = false;
  ctx.stopping.value = false;
  ctx.conversationError.value = messageText;
  clearIdleTimer(ctx);
}

export function ensureAssistantMessage(
  ctx: AgentConversationContext,
  runId: string,
  messageId: string,
  eventRuntime?: AgentRuntimeRef,
  createdAt = new Date().toISOString()
): ChatMessage | undefined {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  if (mappedMessageId && mappedMessageId !== messageId) {
    const placeholder = ctx.messages.value.find(
      (message) =>
        message.id === mappedMessageId &&
        message.role === "assistant" &&
        message.runId === runId &&
        message.activityOnly
    );
    if (!placeholder || ctx.messages.value.some((message) => message.id === messageId)) {
      failProtocol(ctx, runId, "智能体为同一运行返回了不一致的消息标识。", eventRuntime);
      return undefined;
    }
    placeholder.id = messageId;
    placeholder.activityOnly = false;
    if (eventRuntime) {
      placeholder.runtime = eventRuntime;
    }
    ctx.runMessageIds.set(runId, messageId);
    return placeholder;
  }

  const existing = ctx.messages.value.find((message) => message.id === messageId);
  if (existing) {
    if (existing.role !== "assistant" || existing.runId !== runId) {
      failProtocol(ctx, runId, "智能体消息标识与现有消息发生冲突。", eventRuntime);
      return undefined;
    }
    ctx.runMessageIds.set(runId, messageId);
    existing.activityOnly = false;
    if (eventRuntime) {
      existing.runtime = eventRuntime;
    }
    return existing;
  }

  const message: ChatMessage = {
    id: messageId,
    role: "assistant",
    content: "",
    createdAt,
    runId,
    status: "streaming",
    ...(eventRuntime ? { runtime: eventRuntime } : {})
  };
  ctx.runMessageIds.set(runId, messageId);
  ctx.messages.value.push(message);
  return ctx.messages.value.find((candidate) => candidate.id === messageId)!;
}

export function retryMetadata(ctx: AgentConversationContext, input: {
  state: AgentRetryMetadata["state"];
  turnId: string;
  attempt: number;
  maxAttempts: number;
  retryAt?: string;
  delayMs?: number;
  reason?: string;
}): AgentRetryMetadata {
  return {
    state: input.state,
    turnId: input.turnId,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    ...(input.retryAt ? { retryAt: input.retryAt } : {}),
    ...(input.delayMs !== undefined ? { delayMs: input.delayMs } : {}),
    ...(input.reason ? { reason: input.reason } : {})
  };
}

export function restoreMessageCheckpoint(
  ctx: AgentConversationContext,
  runId: string,
  messageId: string,
  checkpoint: AgentTurnCheckpoint,
  retry: AgentRetryMetadata,
  eventRuntime: AgentRuntimeRef,
  eventTimestamp: string
): ChatMessage | undefined {
  const current = ensureAssistantMessage(ctx,
    runId,
    messageId,
    eventRuntime,
    eventTimestamp
  );
  if (!current) return undefined;
  const index = ctx.messages.value.indexOf(current);
  if (index < 0) return undefined;

  const restored = checkpoint.message
    ? cloneMessage(checkpoint.message)
    : {
        id: current.id,
        role: "assistant" as const,
        content: "",
        createdAt: current.createdAt,
        runId,
        status: "streaming" as const,
        runtime: { ...eventRuntime }
      };
  restored.status = "streaming";
  restored.runtime = { ...eventRuntime };
  restored.retry = retry;
  delete restored.errorMessage;
  delete restored.processingCompletedAt;
  ctx.messages.value.splice(index, 1, restored);
  ctx.runMessageIds.set(runId, restored.id);
  return restored;
}

export function handleTurnStarted(
  ctx: AgentConversationContext,
  event: Extract<SystemEventEnvelope, { type: "agent.turn_started" }>
): void {
  const { runId, messageId, turnId, attempt, maxAttempts, runtime: eventRuntime } =
    event.payload;
  const turnKey = `${runId}\u0000${turnId}`;
  let checkpoint = ctx.turnCheckpointByRun.get(runId);

  if (!checkpoint || checkpoint.turnId !== turnId) {
    if (ctx.seenTurnIds.has(turnKey)) return;
    const existing = assistantMessageForRun(ctx, runId);
    const snapshot = existing ? cloneMessage(existing) : null;
    if (snapshot?.retry) delete snapshot.retry;
    checkpoint = {
      turnId,
      messageId,
      attempt,
      maxAttempts,
      attemptStartedAt: event.timestamp,
      message: snapshot
    };
    ctx.turnCheckpointByRun.set(runId, checkpoint);
    rememberBounded(ctx.seenTurnIds, turnKey);
  } else {
    if (attempt <= checkpoint.attempt) return;
    checkpoint.attempt = attempt;
    checkpoint.maxAttempts = maxAttempts;
    checkpoint.attemptStartedAt = event.timestamp;
  }

  let message = ensureAssistantMessage(ctx,
    runId,
    messageId,
    eventRuntime,
    event.timestamp
  );
  if (!message) return;
  if (attempt > 1) {
    message = restoreMessageCheckpoint(ctx,
      runId,
      messageId,
      checkpoint,
      retryMetadata(ctx, {
        state: "trying",
        turnId,
        attempt,
        maxAttempts
      }),
      eventRuntime,
      event.timestamp
    );
  }
  if (message) {
    message.status = "streaming";
    message.runtime = { ...eventRuntime };
    message.processingStartedAt ??= event.timestamp;
  }
}

export function handleRetryScheduled(
  ctx: AgentConversationContext,
  event: Extract<SystemEventEnvelope, { type: "agent.retry_scheduled" }>
): void {
  const {
    runId,
    messageId,
    turnId,
    failedAttempt,
    nextAttempt,
    maxAttempts,
    delayMs,
    retryAt,
    reason,
    runtime: eventRuntime
  } = event.payload;
  const checkpoint = ctx.turnCheckpointByRun.get(runId);
  if (
    !checkpoint ||
    checkpoint.turnId !== turnId ||
    checkpoint.attempt !== failedAttempt
  ) {
    return;
  }
  restoreMessageCheckpoint(ctx,
    runId,
    messageId,
    checkpoint,
    retryMetadata(ctx, {
      state: "scheduled",
      turnId,
      attempt: nextAttempt,
      maxAttempts,
      retryAt,
      delayMs,
      reason
    }),
    eventRuntime,
    event.timestamp
  );
  ctx.conversationError.value = null;
}

export function acceptsRetryActivity(ctx: AgentConversationContext, runId: string, eventTimestamp: string): boolean {
  const message = assistantMessageForRun(ctx, runId);
  if (!message?.retry) return true;
  if (message.retry.state === "scheduled") return false;
  const checkpoint = ctx.turnCheckpointByRun.get(runId);
  if (
    checkpoint &&
    Date.parse(eventTimestamp) < Date.parse(checkpoint.attemptStartedAt)
  ) {
    return false;
  }
  delete message.retry;
  return true;
}

export function ensureActivityMessage(
  ctx: AgentConversationContext,
  runId: string,
  eventRuntime: AgentRuntimeRef,
  createdAt: string
): ChatMessage {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  const existing = mappedMessageId
    ? ctx.messages.value.find(
        (message) =>
          message.id === mappedMessageId &&
          message.role === "assistant" &&
          message.runId === runId
      )
    : undefined;
  if (existing) {
    existing.runtime = eventRuntime;
    return existing;
  }

  const message: ChatMessage = {
    id: `${runId}_assistant`,
    role: "assistant",
    content: "",
    createdAt,
    runId,
    status: "streaming",
    runtime: eventRuntime,
    activityOnly: true,
    toolCalls: [],
    processingSteps: []
  };
  ctx.runMessageIds.set(runId, message.id);
  ctx.messages.value.push(message);
  return ctx.messages.value.find((candidate) => candidate.id === message.id)!;
}

export function ensureSubagentMessage(ctx: AgentConversationContext, runId: string, createdAt: string): ChatMessage {
  const mappedMessageId = ctx.runMessageIds.get(runId);
  const existing = mappedMessageId
    ? ctx.messages.value.find(
        (message) =>
          message.id === mappedMessageId &&
          message.role === "assistant" &&
          message.runId === runId
      )
    : ctx.messages.value.find(
        (message) => message.role === "assistant" && message.runId === runId
      );
  if (existing) {
    ctx.runMessageIds.set(runId, existing.id);
    return existing;
  }

  const preferredId = `${runId}_assistant`;
  const message: ChatMessage = {
    id: ctx.messages.value.some((candidate) => candidate.id === preferredId)
      ? `${preferredId}_${id("subagent")}`
      : preferredId,
    role: "assistant",
    content: "",
    createdAt,
    runId,
    status: "streaming",
    activityOnly: true,
    toolCalls: [],
    processingSteps: [],
    subagentRuns: []
  };
  ctx.runMessageIds.set(runId, message.id);
  ctx.messages.value.push(message);
  return ctx.messages.value.find((candidate) => candidate.id === message.id)!;
}

export function earlierTimestamp(ctx: AgentConversationContext, current: string, candidate: string): string {
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(currentTime)) return candidate;
  if (!Number.isFinite(candidateTime)) return current;
  return candidateTime < currentTime ? candidate : current;
}

export function ensurePendingSubagentRunForTool(
  ctx: AgentConversationContext,
  message: ChatMessage,
  toolCallId: string,
  args: unknown,
  eventRuntime: AgentRuntimeRef,
  eventTimestamp: string
): void {
  if (message.subagentRuns?.some((run) => run.parentToolCallId === toolCallId)) {
    return;
  }
  const record = isRecord(args) ? args : {};
  const subagentId =
    typeof record.subagent_id === "string" && record.subagent_id.trim()
      ? record.subagent_id.trim()
      : "subagent";
  const task =
    typeof record.task === "string" && record.task.trim()
      ? record.task.trim()
      : "正在接收子任务…";
  (message.subagentRuns ??= []).push({
    parentToolCallId: toolCallId,
    subagentRunId: `pending:${toolCallId}`,
    subagentId,
    name: subagentId,
    task,
    status: "running",
    runtime: { ...eventRuntime },
    toolCalls: [],
    processingSteps: [],
    startedAt: eventTimestamp
  });
}

export function ensureSubagentRun(
  ctx: AgentConversationContext,
  message: ChatMessage,
  payload: SubagentEventPayload,
  eventTimestamp: string,
  task?: string
): AgentSubagentRun {
  let run = message.subagentRuns?.find(
    (candidate) => candidate.subagentRunId === payload.subagentRunId
  );
  run ??= message.subagentRuns?.find(
    (candidate) =>
      candidate.parentToolCallId === payload.parentToolCallId &&
      candidate.subagentRunId.startsWith("pending:")
  );
  if (!run) {
    run = {
      parentToolCallId: payload.parentToolCallId,
      subagentRunId: payload.subagentRunId,
      subagentId: payload.subagentId,
      name: payload.name,
      task: task ?? "正在接收子任务…",
      status: "running",
      runtime: { ...payload.runtime },
      toolCalls: [],
      processingSteps: [],
      startedAt: eventTimestamp
    };
    (message.subagentRuns ??= []).push(run);
    return run;
  }

  run.subagentRunId = payload.subagentRunId;
  run.parentToolCallId = payload.parentToolCallId;
  run.subagentId = payload.subagentId;
  run.name = payload.name;
  run.runtime = { ...payload.runtime };
  run.startedAt = earlierTimestamp(ctx, run.startedAt, eventTimestamp);
  if (task !== undefined) {
    run.task = task;
  }
  return run;
}

export function restoreSubagentCheckpoint(
  ctx: AgentConversationContext,
  run: AgentSubagentRun,
  checkpoint: SubagentTurnCheckpoint,
  retry: AgentRetryMetadata,
  eventRuntime: AgentRuntimeRef
): void {
  const restored = cloneSubagentRun(checkpoint.run);
  for (const key of [
    "thinking",
    "output",
    "completedAt",
    "summary",
    "errorMessage",
    "usage",
    "retry"
  ] as const) {
    delete run[key];
  }
  Object.assign(run, restored);
  run.status = "running";
  run.runtime = { ...eventRuntime };
  run.retry = retry;
}

export function handleSubagentTurnStarted(
  ctx: AgentConversationContext,
  event: SubagentActivityEventEnvelope,
  run: AgentSubagentRun,
  activity: Extract<
    SubagentActivityEventEnvelope["payload"]["activity"],
    { type: "turn_started" }
  >
): void {
  const key = subagentTurnKey(ctx, event.payload.runId, event.payload.subagentRunId);
  const seenKey = `${key}\u0000${activity.turnId}`;
  let checkpoint = ctx.subagentTurnCheckpointByRun.get(key);
  if (!checkpoint || checkpoint.turnId !== activity.turnId) {
    if (ctx.seenSubagentTurnIds.has(seenKey)) return;
    const snapshot = cloneSubagentRun(run);
    if (snapshot.retry) delete snapshot.retry;
    checkpoint = {
      turnId: activity.turnId,
      attempt: activity.attempt,
      maxAttempts: activity.maxAttempts,
      attemptStartedAt: event.timestamp,
      run: snapshot
    };
    ctx.subagentTurnCheckpointByRun.set(key, checkpoint);
    rememberBounded(ctx.seenSubagentTurnIds, seenKey);
  } else {
    if (activity.attempt <= checkpoint.attempt) return;
    checkpoint.attempt = activity.attempt;
    checkpoint.maxAttempts = activity.maxAttempts;
    checkpoint.attemptStartedAt = event.timestamp;
  }
  if (activity.attempt > 1) {
    restoreSubagentCheckpoint(ctx,
      run,
      checkpoint,
      retryMetadata(ctx, {
        state: "trying",
        turnId: activity.turnId,
        attempt: activity.attempt,
        maxAttempts: activity.maxAttempts
      }),
      event.payload.runtime
    );
  }
}

export function handleSubagentRetryScheduled(
  ctx: AgentConversationContext,
  event: SubagentActivityEventEnvelope,
  run: AgentSubagentRun,
  activity: Extract<
    SubagentActivityEventEnvelope["payload"]["activity"],
    { type: "retry_scheduled" }
  >
): void {
  const key = subagentTurnKey(ctx, event.payload.runId, event.payload.subagentRunId);
  const checkpoint = ctx.subagentTurnCheckpointByRun.get(key);
  if (
    !checkpoint ||
    checkpoint.turnId !== activity.turnId ||
    checkpoint.attempt !== activity.failedAttempt
  ) {
    return;
  }
  restoreSubagentCheckpoint(ctx,
    run,
    checkpoint,
    retryMetadata(ctx, {
      state: "scheduled",
      turnId: activity.turnId,
      attempt: activity.nextAttempt,
      maxAttempts: activity.maxAttempts,
      retryAt: activity.retryAt,
      delayMs: activity.delayMs,
      reason: activity.reason
    }),
    event.payload.runtime
  );
}

export function acceptsSubagentRetryActivity(
  ctx: AgentConversationContext,
  event: SubagentActivityEventEnvelope,
  run: AgentSubagentRun
): boolean {
  if (!run.retry) return true;
  if (run.retry.state === "scheduled") return false;
  const checkpoint = ctx.subagentTurnCheckpointByRun.get(
    subagentTurnKey(ctx, event.payload.runId, event.payload.subagentRunId)
  );
  if (
    checkpoint &&
    Date.parse(event.timestamp) < Date.parse(checkpoint.attemptStartedAt)
  ) {
    return false;
  }
  delete run.retry;
  return true;
}

export function handleSubagentEvent(ctx: AgentConversationContext, event: SubagentEventEnvelope): void {
  const message = ensureSubagentMessage(ctx, event.payload.runId, event.timestamp);
  message.processingStartedAt ??= event.timestamp;
  const run = ensureSubagentRun(ctx,
    message,
    event.payload,
    event.timestamp,
    event.type === "subagent.started" ? event.payload.task : undefined
  );

  if (
    event.type !== "subagent.completed" &&
    run.status === "running" &&
    (message.status === "stopped" || message.status === "error")
  ) {
    run.status = message.status;
    run.completedAt = message.processingCompletedAt ?? event.timestamp;
    run.errorMessage =
      message.status === "stopped"
        ? "父智能体运行已停止，子任务同步停止。"
        : message.errorMessage ?? "父智能体运行异常结束，子任务同步停止。";
  }

  if (event.type === "subagent.started") {
    return;
  }

  if (event.type === "subagent.activity") {
    const activity = event.payload.activity;
    if (activity.type === "turn_started") {
      if (run.status === "running") {
        handleSubagentTurnStarted(ctx, event, run, activity);
      }
      return;
    }

    if (activity.type === "retry_scheduled") {
      if (run.status === "running") {
        handleSubagentRetryScheduled(ctx, event, run, activity);
      }
      return;
    }

    if (!acceptsSubagentRetryActivity(ctx, event, run)) return;
    if (activity.type === "thinking_delta") {
      run.thinking = `${run.thinking ?? ""}${activity.delta}`;
      const lastStep = run.processingSteps.at(-1);
      if (lastStep?.type === "thinking") {
        lastStep.content += activity.delta;
      } else {
        run.processingSteps.push({
          id: event.id,
          type: "thinking",
          content: activity.delta,
          createdAt: event.timestamp
        });
      }
      return;
    }

    if (activity.type === "message_delta") {
      run.output = `${run.output ?? ""}${activity.delta}`;
      const lastStep = run.processingSteps.at(-1);
      if (lastStep?.type === "response") {
        lastStep.content += activity.delta;
      } else {
        run.processingSteps.push({
          id: event.id,
          type: "response",
          content: activity.delta,
          createdAt: event.timestamp
        });
      }
      return;
    }

    let toolCall = run.toolCalls.find(
      (candidate) => candidate.id === activity.toolCallId
    );
    if (activity.type === "tool_requested") {
      if (toolCall) {
        toolCall.name = activity.toolName;
        toolCall.args = activity.args;
        toolCall.requestedAt = earlierTimestamp(ctx,
          toolCall.requestedAt,
          event.timestamp
        );
        if (toolCall.status !== "completed" && toolCall.status !== "error") {
          toolCall.status = "running";
        }
      } else {
        const terminalStatus =
          run.status === "completed" ? "completed" : "error";
        toolCall = {
          id: activity.toolCallId,
          name: activity.toolName,
          args: activity.args,
          status: run.status === "running" ? "running" : terminalStatus,
          requestedAt: event.timestamp,
          ...(run.status === "running"
            ? {}
            : {
                completedAt: run.completedAt ?? event.timestamp,
                ...(terminalStatus === "error"
                  ? {
                      resultSummary:
                        run.errorMessage ?? "子任务已经结束。",
                      isError: true
                    }
                  : {})
              })
        };
        run.toolCalls.push(toolCall);
      }
      if (!run.processingSteps.some(
        (step) => step.type === "tool" && step.toolCallId === activity.toolCallId
      )) {
        run.processingSteps.push({
          id: event.id,
          type: "tool",
          toolCallId: activity.toolCallId,
          createdAt: event.timestamp
        });
      }
      return;
    }

    if (!toolCall) {
      toolCall = {
        id: activity.toolCallId,
        name: activity.toolName,
        args: undefined,
        status: activity.isError ? "error" : "completed",
        requestedAt: event.timestamp
      };
      run.toolCalls.push(toolCall);
    }
    if (!run.processingSteps.some(
      (step) => step.type === "tool" && step.toolCallId === activity.toolCallId
    )) {
      run.processingSteps.push({
        id: event.id,
        type: "tool",
        toolCallId: activity.toolCallId,
        createdAt: event.timestamp
      });
    }
    toolCall.name = activity.toolName;
    toolCall.status = activity.isError ? "error" : "completed";
    toolCall.completedAt = event.timestamp;
    toolCall.resultSummary = activity.resultSummary;
    toolCall.isError = activity.isError;
    return;
  }

  run.status =
    event.payload.status === "aborted" ? "stopped" : event.payload.status;
  delete run.retry;
  ctx.subagentTurnCheckpointByRun.delete(
    subagentTurnKey(ctx, event.payload.runId, event.payload.subagentRunId)
  );
  run.completedAt = event.timestamp;
  run.summary = event.payload.summary;
  if (event.payload.errorMessage !== undefined) {
    run.errorMessage = event.payload.errorMessage;
  } else {
    delete run.errorMessage;
  }
  if (event.payload.usage !== undefined) {
    run.usage = { ...event.payload.usage };
  } else {
    delete run.usage;
  }
  for (const toolCall of run.toolCalls) {
    if (toolCall.status !== "preparing" && toolCall.status !== "running") {
      continue;
    }
    toolCall.status = run.status === "completed" ? "completed" : "error";
    toolCall.completedAt = event.timestamp;
    if (run.status !== "completed") {
      toolCall.resultSummary ??= "子任务结束前未返回工具结果。";
      toolCall.isError = true;
    }
  }
}

export function finishRun(ctx: AgentConversationContext, runId: string): void {
  clearRetryStateForRun(ctx, runId);
  rememberBounded(ctx.finishedRunIds, runId);
  if (ctx.activeRunId.value === runId) {
    ctx.activeRunId.value = null;
  }
  ctx.submitting.value = false;
  ctx.stopping.value = false;
  clearIdleTimer(ctx);
}
