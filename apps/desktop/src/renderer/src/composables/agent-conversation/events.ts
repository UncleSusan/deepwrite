import { AgentEvaluationSnapshotSchema } from "@deepwrite/contracts";
import type { SystemEventEnvelope } from "@deepwrite/contracts";
import { finalizeUnfinishedMessageTools } from "./attempt-state";
import type { AgentConversationContext } from "./context";
import { rememberBounded } from "./shared";
import {
  clearIdleTimer,
  flushPendingAgentTextDelta,
  queueAgentTextDelta,
  scheduleIdleTimeout
} from "./streaming";
import {
  acceptsRetryActivity,
  ensureActivityMessage,
  ensureAssistantMessage,
  ensurePendingSubagentRunForTool,
  failProtocol,
  finalizeRunningSubagents,
  finishRun,
  handleRetryScheduled,
  handleSubagentEvent,
  handleTurnStarted,
  markRunError,
  markRunStopped
} from "./retry-subagent";
import { rememberRunApprovalMode } from "./approvals";
import type { SubagentEventEnvelope } from "./types";

export function handleEvent(
  ctx: AgentConversationContext,
  event: SystemEventEnvelope
): void {
  if (!isAgentEvent(event) || event.payload.sessionId !== ctx.sessionId.value) {
    return;
  }
  if (ctx.handledEventIds.has(event.id)) {
    return;
  }

  const runId = event.payload.runId;
  const subagentEvent = isSubagentEvent(event);
  const lateSubagentEvent =
    subagentEvent &&
    ctx.finishedRunIds.has(runId) &&
    ctx.messages.value.some(
      (message) => message.role === "assistant" && message.runId === runId
    );
  const lateEvaluationSnapshot =
    event.type === "agent.evaluation_snapshot" &&
    ctx.finishedRunIds.has(runId) &&
    ctx.messages.value.some(
      (message) => message.role === "assistant" && message.runId === runId
    );
  if (
    ctx.finishedRunIds.has(runId) &&
    !lateSubagentEvent &&
    !lateEvaluationSnapshot
  ) {
    return;
  }
  if (
    ctx.activeRunId.value &&
    ctx.activeRunId.value !== runId &&
    !lateSubagentEvent &&
    !lateEvaluationSnapshot
  ) {
    return;
  }
  if (!ctx.activeRunId.value && !lateSubagentEvent && !lateEvaluationSnapshot) {
    if (ctx.pendingAttemptId.value === null) {
      return;
    }
    const observedRunId = ctx.observedRunByAttempt.get(
      ctx.pendingAttemptId.value
    );
    if (observedRunId && observedRunId !== runId) {
      failProtocol(
        ctx,
        observedRunId,
        "同一次请求收到了多个运行标识。",
        ctx.runtime.value ?? undefined
      );
      return;
    }
    ctx.observedRunByAttempt.set(ctx.pendingAttemptId.value, runId);
    const pendingMode = ctx.approvalModeByAttempt.get(
      ctx.pendingAttemptId.value
    );
    if (pendingMode) rememberRunApprovalMode(ctx, runId, pendingMode);
    ctx.activeRunId.value = runId;
  }

  rememberBounded(ctx.handledEventIds, event.id);
  if (!lateSubagentEvent && !lateEvaluationSnapshot) {
    ctx.submitting.value = false;
    scheduleIdleTimeout(ctx, {
      expectedEpoch: ctx.epoch,
      expectedSessionId: ctx.sessionId.value,
      runId
    });
  }

  if (
    event.type !== "agent.message_delta" &&
    event.type !== "agent.thinking_delta"
  ) {
    // Terminal, retry, tool, and subagent events are ordering boundaries.
    // Settle every preceding text fragment before applying that event.
    flushPendingAgentTextDelta(ctx);
  }

  if (subagentEvent) {
    handleSubagentEvent(ctx, event);
    return;
  }

  if (event.type === "agent.user_input_requested") {
    ctx.pendingUserInput.value = event.payload;
    ctx.submittingUserInput.value = false;
    clearIdleTimer(ctx);
    return;
  }

  if (event.type === "agent.evaluation_snapshot") {
    const message = ensureAssistantMessage(
      ctx,
      runId,
      event.payload.messageId,
      event.payload.runtime,
      event.timestamp
    );
    if (message) {
      const parsedEvaluation = AgentEvaluationSnapshotSchema.safeParse(
        event.payload.snapshot
      );
      if (parsedEvaluation.success) {
        message.evaluationSnapshot = parsedEvaluation.data;
      }
    }
    return;
  }

  if (event.type === "agent.turn_started") {
    handleTurnStarted(ctx, event);
    return;
  }

  if (event.type === "agent.retry_scheduled") {
    handleRetryScheduled(ctx, event);
    return;
  }

  if (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta"
  ) {
    if (!acceptsRetryActivity(ctx, runId, event.timestamp)) return;
    queueAgentTextDelta(ctx, event);
    return;
  }

  if (event.type === "tool.call_stream") {
    if (!acceptsRetryActivity(ctx, runId, event.timestamp)) return;
    const message = ensureActivityMessage(
      ctx,
      runId,
      event.payload.runtime,
      event.timestamp
    );
    message.processingStartedAt ??= event.timestamp;
    let toolCall = event.payload.toolCallId
      ? message.toolCalls?.find(
          (candidate) => candidate.id === event.payload.toolCallId
        )
      : undefined;
    if (!toolCall) {
      const streamCandidate = message.toolCalls?.find(
        (candidate) => candidate.streamId === event.payload.streamId
      );
      const hasCompatibleIdentity =
        !event.payload.toolCallId ||
        streamCandidate?.id === event.payload.toolCallId ||
        streamCandidate?.id === event.payload.streamId;
      if (streamCandidate && hasCompatibleIdentity) {
        toolCall = streamCandidate;
      }
    }
    if (!toolCall) {
      toolCall = {
        id: event.payload.toolCallId ?? event.payload.streamId,
        streamId: event.payload.streamId,
        name: event.payload.toolName ?? "tool_call",
        args: event.payload.args,
        argumentsText: event.payload.argumentsDelta,
        argumentsComplete: event.payload.phase === "end",
        status: "preparing",
        requestedAt: event.timestamp
      };
      (message.toolCalls ??= []).push(toolCall);
      (message.processingSteps ??= []).push({
        id: event.id,
        type: "tool",
        toolCallId: toolCall.id,
        createdAt: event.timestamp
      });
    } else {
      const previousId = toolCall.id;
      toolCall.streamId = event.payload.streamId;
      toolCall.name = event.payload.toolName ?? toolCall.name;
      toolCall.argumentsText = `${toolCall.argumentsText ?? ""}${event.payload.argumentsDelta}`;
      toolCall.argumentsComplete = event.payload.phase === "end";
      if (event.payload.args !== undefined) {
        toolCall.args = event.payload.args;
      }
      if (event.payload.toolCallId && previousId !== event.payload.toolCallId) {
        toolCall.id = event.payload.toolCallId;
        for (const step of message.processingSteps ?? []) {
          if (step.type === "tool" && step.toolCallId === previousId) {
            step.toolCallId = event.payload.toolCallId;
          }
        }
      }
    }
    if (!message.tools?.some((tool) => tool.id === toolCall.id)) {
      message.tools = [
        ...(message.tools ?? []),
        {
          id: toolCall.id,
          name: toolCall.name,
          status: "running"
        }
      ];
    }
    return;
  }

  if (event.type === "tool.call_requested") {
    if (!acceptsRetryActivity(ctx, runId, event.timestamp)) return;
    const message = ensureActivityMessage(
      ctx,
      runId,
      event.payload.runtime,
      event.timestamp
    );
    if (event.payload.toolName === "spawn_subagent") {
      ensurePendingSubagentRunForTool(
        ctx,
        message,
        event.payload.toolCallId,
        event.payload.args,
        event.payload.runtime,
        event.timestamp
      );
    }
    if (!message.tools?.some((tool) => tool.id === event.payload.toolCallId)) {
      message.tools = [
        ...(message.tools ?? []),
        {
          id: event.payload.toolCallId,
          name: event.payload.toolName,
          status: "running"
        }
      ];
    }
    message.processingStartedAt ??= event.timestamp;
    const existing =
      message.toolCalls?.find(
        (toolCall) => toolCall.id === event.payload.toolCallId
      ) ??
      [...(message.toolCalls ?? [])]
        .reverse()
        .find(
          (toolCall) =>
            toolCall.status === "preparing" &&
            toolCall.name === event.payload.toolName
        );
    if (existing) {
      const previousId = existing.id;
      existing.id = event.payload.toolCallId;
      existing.name = event.payload.toolName;
      existing.args = event.payload.args;
      existing.status = "running";
      existing.argumentsComplete = true;
      for (const step of message.processingSteps ?? []) {
        if (step.type === "tool" && step.toolCallId === previousId) {
          step.toolCallId = event.payload.toolCallId;
        }
      }
    } else {
      (message.toolCalls ??= []).push({
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        args: event.payload.args,
        status: "running",
        requestedAt: event.timestamp
      });
    }
    if (
      !message.processingSteps?.some(
        (step) =>
          step.type === "tool" && step.toolCallId === event.payload.toolCallId
      )
    ) {
      (message.processingSteps ??= []).push({
        id: event.id,
        type: "tool",
        toolCallId: event.payload.toolCallId,
        createdAt: event.timestamp
      });
    }
    return;
  }

  if (event.type === "tool.execution_completed") {
    if (!acceptsRetryActivity(ctx, runId, event.timestamp)) return;
    const message = ensureActivityMessage(
      ctx,
      runId,
      event.payload.runtime,
      event.timestamp
    );
    if (event.payload.toolName === "spawn_subagent") {
      const subagentRun = message.subagentRuns?.find(
        (candidate) => candidate.parentToolCallId === event.payload.toolCallId
      );
      if (subagentRun?.status === "running") {
        subagentRun.status = event.payload.isError ? "error" : "completed";
        subagentRun.completedAt = event.timestamp;
        subagentRun.summary = event.payload.resultSummary;
        if (event.payload.isError) {
          subagentRun.errorMessage = event.payload.resultSummary;
        }
      }
    }
    const tools = message.tools ?? [];
    const existingTool = tools.find(
      (tool) => tool.id === event.payload.toolCallId
    );
    if (existingTool) {
      existingTool.status = event.payload.isError ? "error" : "completed";
      existingTool.summary = event.payload.resultSummary;
    } else {
      message.tools = [
        ...tools,
        {
          id: event.payload.toolCallId,
          name: event.payload.toolName,
          status: event.payload.isError ? "error" : "completed",
          summary: event.payload.resultSummary
        }
      ];
    }
    message.processingStartedAt ??= event.timestamp;
    let toolCall = message.toolCalls?.find(
      (item) => item.id === event.payload.toolCallId
    );
    if (!toolCall) {
      toolCall = {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        args: undefined,
        status: event.payload.isError ? "error" : "completed",
        requestedAt: event.timestamp
      };
      (message.toolCalls ??= []).push(toolCall);
    }
    if (
      !message.processingSteps?.some(
        (step) =>
          step.type === "tool" && step.toolCallId === event.payload.toolCallId
      )
    ) {
      (message.processingSteps ??= []).push({
        id: event.id,
        type: "tool",
        toolCallId: event.payload.toolCallId,
        createdAt: event.timestamp
      });
    }
    toolCall.name = event.payload.toolName;
    toolCall.status = event.payload.isError ? "error" : "completed";
    toolCall.completedAt = event.timestamp;
    toolCall.resultSummary = event.payload.resultSummary;
    toolCall.isError = event.payload.isError;
    return;
  }

  if (event.type === "agent.message_completed") {
    if (!acceptsRetryActivity(ctx, runId, event.timestamp)) return;
    const message = ensureAssistantMessage(
      ctx,
      runId,
      event.payload.messageId,
      event.payload.runtime,
      event.timestamp
    );
    if (!message) {
      return;
    }
    message.content = event.payload.content;
    if (event.payload.thinking?.trim() && !message.thinking) {
      message.thinking = event.payload.thinking;
      (message.processingSteps ??= []).push({
        id: `${event.id}_thinking`,
        type: "thinking",
        content: event.payload.thinking,
        createdAt: event.timestamp
      });
    }
    const lastStep = message.processingSteps?.at(-1);
    if (event.payload.content) {
      if (lastStep?.type === "response") {
        // The terminal payload contains the final assistant turn only. Earlier
        // response turns may have been followed by tools, so keep them as
        // separate chronological steps and replace only the final turn.
        lastStep.content = event.payload.content;
      } else {
        (message.processingSteps ??= []).push({
          id: `${event.id}_response`,
          type: "response",
          content: event.payload.content,
          createdAt: event.timestamp
        });
      }
    }
    finalizeRunningSubagents(
      ctx,
      message,
      "error",
      event.timestamp,
      "父智能体运行已完成，但子任务未返回完整终态。"
    );
    finalizeUnfinishedMessageTools(
      message,
      event.timestamp,
      "智能体运行已完成，但工具调用未返回完整终态。"
    );
    message.status = "completed";
    message.activityOnly = false;
    if (message.processingStartedAt) {
      message.processingCompletedAt = event.timestamp;
    }
    message.runtime = event.payload.runtime;
    if (event.payload.usage !== undefined) {
      message.usage = event.payload.usage;
    }
    finishRun(ctx, runId);
    return;
  }

  if (event.type !== "agent.error") {
    return;
  }

  if (event.payload.code === "pi_agent.aborted") {
    markRunStopped(ctx, runId, event.payload.runtime);
    ctx.conversationError.value = null;
    finishRun(ctx, runId);
    return;
  }

  markRunError(ctx, runId, event.payload.message, event.payload.runtime);
  ctx.conversationError.value = event.payload.message;
  finishRun(ctx, runId);
}

export function isAgentEvent(event: SystemEventEnvelope): event is Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.evaluation_snapshot"
      | "agent.turn_started"
      | "agent.retry_scheduled"
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.user_input_requested"
      | "agent.error"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed";
  }
> {
  return (
    event.type === "agent.evaluation_snapshot" ||
    event.type === "agent.turn_started" ||
    event.type === "agent.retry_scheduled" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.user_input_requested" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}

export function isSubagentEvent(
  event: SystemEventEnvelope
): event is SubagentEventEnvelope {
  return (
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}
