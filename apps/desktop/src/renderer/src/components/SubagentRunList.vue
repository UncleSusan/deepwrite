<script setup lang="ts">
import { computed } from "vue";
import type {
  AgentSubagentRun,
  AgentToolTrace,
  ChatMessage
} from "../types/conversation";
import { writeToolText } from "../utils/agentWriteToolPreview";
import {
  formatToolPayload,
  isWriteTool,
  toolDetail,
  toolGroupIsRunning,
  toolGroupLabel,
  toolIcon,
  toolLabel,
  visibleToolArguments,
  writeToolContentLabel,
  writeToolTarget
} from "./conversationToolPresentation";
import AppIcon from "./AppIcon.vue";
import StreamedContent from "./StreamedContent.vue";

const props = defineProps<{
  message: ChatMessage;
  now: number;
}>();

const runs = computed(() => props.message.subagentRuns ?? []);

type SubagentDisplayItem =
  | { id: string; type: "thinking"; content: string; createdAt: string }
  | { id: string; type: "response"; content: string; createdAt: string }
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt: string };

type SubagentProcessingDisplayItem =
  | Exclude<SubagentDisplayItem, { type: "tool" }>
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt: string }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] };

function subagentDisplayItems(run: AgentSubagentRun): SubagentDisplayItem[] {
  if (run.processingSteps.length) {
    const items: SubagentDisplayItem[] = [];
    for (const step of run.processingSteps) {
      if (step.type === "thinking" || step.type === "response") {
        items.push({ ...step });
        continue;
      }
      const tool = run.toolCalls.find(
        (candidate) => candidate.id === step.toolCallId
      );
      if (tool) {
        items.push({
          id: step.id,
          type: "tool",
          tool,
          createdAt: step.createdAt
        });
      }
    }
    return items;
  }

  const items: SubagentDisplayItem[] = [];
  if (run.thinking) {
    items.push({
      id: `${run.subagentRunId}_thinking`,
      type: "thinking",
      content: run.thinking,
      createdAt: run.startedAt
    });
  }
  if (run.output) {
    items.push({
      id: `${run.subagentRunId}_response`,
      type: "response",
      content: run.output,
      createdAt: run.startedAt
    });
  }
  for (const tool of run.toolCalls) {
    items.push({
      id: `${run.subagentRunId}_${tool.id}`,
      type: "tool",
      tool,
      createdAt: tool.requestedAt
    });
  }
  return items;
}

function subagentProcessingDisplayItems(
  run: AgentSubagentRun
): SubagentProcessingDisplayItem[] {
  const displayItems: SubagentProcessingDisplayItem[] = [];
  for (const item of subagentDisplayItems(run)) {
    if (item.type !== "tool" || isWriteTool(item.tool)) {
      displayItems.push(item);
      continue;
    }
    const previous = displayItems.at(-1);
    if (previous?.type === "tool-group") {
      previous.tools.push(item.tool);
      continue;
    }
    displayItems.push({
      id: `${item.id}_group`,
      type: "tool-group",
      tools: [item.tool]
    });
  }
  return displayItems;
}

const subagentStatusLabels: Record<AgentSubagentRun["status"], string> = {
  running: "执行中",
  completed: "已完成",
  error: "失败",
  stopped: "已停止"
};

function subagentStatusLabel(run: AgentSubagentRun): string {
  if (run.retry?.state === "trying") return "正在重试";
  if (run.retry?.state === "scheduled") {
    const retryAt = run.retry.retryAt
      ? Date.parse(run.retry.retryAt)
      : Number.NaN;
    const seconds = Number.isFinite(retryAt)
      ? Math.max(0, Math.ceil((retryAt - props.now) / 1_000))
      : Math.max(0, Math.ceil((run.retry.delayMs ?? 0) / 1_000));
    return `${seconds}s 后重试`;
  }
  return subagentStatusLabels[run.status];
}

function subagentRetryProgress(run: AgentSubagentRun): string | undefined {
  if (!run.retry) return undefined;
  return `第 ${Math.max(1, run.retry.attempt - 1)}/${Math.max(1, run.retry.maxAttempts - 1)} 次`;
}

function subagentRetryStatus(run: AgentSubagentRun): string | undefined {
  const progress = subagentRetryProgress(run);
  if (!run.retry || !progress) return undefined;
  if (run.retry.state === "trying") return `正在重试（${progress}）`;
  const retryAt = run.retry.retryAt
    ? Date.parse(run.retry.retryAt)
    : Number.NaN;
  const seconds = Number.isFinite(retryAt)
    ? Math.max(0, Math.ceil((retryAt - props.now) / 1_000))
    : Math.max(0, Math.ceil((run.retry.delayMs ?? 0) / 1_000));
  return `网络波动，${seconds}s 后重试（${progress}）`;
}

function subagentDuration(run: AgentSubagentRun): string {
  const start = Date.parse(run.startedAt);
  const end = run.completedAt
    ? Date.parse(run.completedAt)
    : run.status === "running"
      ? props.now
      : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.ceil((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function subagentPendingReviewCount(
  message: ChatMessage,
  run: AgentSubagentRun
): number {
  const toolCallIds = new Set(run.toolCalls.map((toolCall) => toolCall.id));
  return (message.editProposals ?? []).filter(
    (proposal) =>
      (proposal.status === "pending" || proposal.status === "accepting") &&
      proposal.toolCallIds.some((toolCallId) => toolCallIds.has(toolCallId))
  ).length;
}

function subagentWriteToolCount(run: AgentSubagentRun): number {
  return run.toolCalls.filter(isWriteTool).length;
}

function subagentReviewHint(
  message: ChatMessage,
  run: AgentSubagentRun
): string | undefined {
  const pendingCount = subagentPendingReviewCount(message, run);
  if (pendingCount > 0) return `${pendingCount} 项待审阅`;
  const writeCount = subagentWriteToolCount(run);
  return writeCount > 0 ? `${writeCount} 次写入调用` : undefined;
}

function subagentUsageLabel(run: AgentSubagentRun): string | undefined {
  return run.usage
    ? `${run.usage.totalTokens.toLocaleString("zh-CN")} tokens`
    : undefined;
}
</script>

<template>
  <section
    v-if="runs.length"
    class="subagent-run-list"
    aria-label="子智能体执行记录"
  >
    <details
      v-for="run in runs"
      :key="run.parentToolCallId"
      class="subagent-run-card"
      :class="`is-${run.status}`"
      :aria-busy="run.status === 'running'"
    >
      <summary>
        <span class="subagent-run-icon" aria-hidden="true">
          <AppIcon name="user" :size="17" />
        </span>
        <span class="subagent-run-heading">
          <span class="subagent-run-title-row">
            <strong>{{ run.name }}</strong>
            <span class="subagent-run-status" :class="`is-${run.status}`">
              {{ subagentStatusLabel(run) }}
            </span>
          </span>
          <span class="subagent-run-task">{{ run.task }}</span>
        </span>
        <span class="subagent-run-meta" aria-label="子任务运行摘要">
          <span v-if="subagentDuration(run)">{{ subagentDuration(run) }}</span>
          <span v-if="subagentRetryProgress(run)">{{
            subagentRetryProgress(run)
          }}</span>
          <span>{{ run.toolCalls.length }} 个工具</span>
          <span v-if="subagentReviewHint(message, run)" class="is-review">
            {{ subagentReviewHint(message, run) }}
          </span>
        </span>
        <AppIcon class="subagent-run-chevron" name="chevron" :size="14" />
      </summary>

      <div class="subagent-run-detail">
        <div v-if="subagentRetryStatus(run)" class="subagent-run-waiting">
          {{ subagentRetryStatus(run) }}
        </div>
        <div
          v-if="subagentProcessingDisplayItems(run).length"
          class="subagent-processing-list"
          aria-label="子智能体执行过程"
        >
          <template
            v-for="item in subagentProcessingDisplayItems(run)"
            :key="item.id"
          >
            <details
              v-if="item.type === 'thinking'"
              class="processing-live-item processing-live-thinking"
            >
              <summary>
                <span>{{
                  run.status === "running" ? "思考中" : "思考过程"
                }}</span>
                <AppIcon name="chevron" :size="13" />
              </summary>
              <div class="processing-live-body processing-thinking">
                <StreamedContent
                  :content="item.content"
                  :streaming="run.status === 'running'"
                />
              </div>
            </details>
            <div
              v-else-if="item.type === 'response'"
              class="processing-step processing-response subagent-processing-response"
            >
              <StreamedContent
                :content="item.content"
                :streaming="run.status === 'running'"
              />
            </div>
            <details
              v-else-if="item.type === 'tool'"
              class="processing-live-item processing-live-tool"
            >
              <summary>
                <div
                  class="tool-trace"
                  :class="[
                    `is-${item.tool.status}`,
                    { 'is-write': isWriteTool(item.tool) }
                  ]"
                >
                  <AppIcon
                    v-if="!isWriteTool(item.tool)"
                    :name="toolIcon(item.tool)"
                    :size="17"
                  />
                  <div>
                    <div v-if="isWriteTool(item.tool)" class="write-tool-label">
                      <strong>{{ toolLabel(item.tool) }}</strong>
                      <AppIcon name="chevron" :size="13" />
                    </div>
                    <strong v-else>{{ toolLabel(item.tool) }}</strong>
                    <span v-if="toolDetail(item.tool)">{{
                      toolDetail(item.tool)
                    }}</span>
                  </div>
                </div>
                <AppIcon
                  v-if="!isWriteTool(item.tool)"
                  name="chevron"
                  :size="13"
                />
              </summary>
              <div class="processing-live-body tool-detail">
                <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
                  <div class="write-tool-output-heading">
                    <span>{{ writeToolContentLabel(item.tool) }}</span>
                    <small v-if="writeToolTarget(item.tool)">
                      {{ writeToolTarget(item.tool) }}
                    </small>
                    <small>
                      {{
                        writeToolText(item.tool).length.toLocaleString("zh-CN")
                      }}
                      字符
                    </small>
                  </div>
                  <pre
                    class="write-tool-output"
                    :class="{
                      'is-streaming': item.tool.status === 'preparing'
                    }"
                    >{{
                      writeToolText(item.tool) || "正在等待写入内容……"
                    }}</pre>
                </div>
                <div
                  v-else-if="formatToolPayload(visibleToolArguments(item.tool))"
                >
                  <span>调用参数</span>
                  <pre>{{
                    formatToolPayload(visibleToolArguments(item.tool))
                  }}</pre>
                </div>
                <div v-if="item.tool.resultSummary">
                  <span>执行结果</span>
                  <p>{{ item.tool.resultSummary }}</p>
                </div>
              </div>
            </details>
            <details
              v-else
              class="processing-live-item processing-live-thinking processing-tool-group"
              :aria-busy="toolGroupIsRunning(item.tools)"
            >
              <summary>
                <span>{{ toolGroupLabel(item.tools) }}</span>
                <AppIcon name="chevron" :size="13" />
              </summary>
              <div
                class="processing-live-body tool-call-list"
                aria-label="工具调用列表"
              >
                <details
                  v-for="tool in item.tools"
                  :key="tool.id"
                  class="processing-live-item processing-live-tool tool-call-list-item"
                >
                  <summary>
                    <div class="tool-trace" :class="`is-${tool.status}`">
                      <AppIcon :name="toolIcon(tool)" :size="17" />
                      <div>
                        <strong>{{ toolLabel(tool) }}</strong>
                        <span v-if="toolDetail(tool)">{{
                          toolDetail(tool)
                        }}</span>
                      </div>
                    </div>
                    <AppIcon name="chevron" :size="13" />
                  </summary>
                  <div class="processing-live-body tool-detail">
                    <div v-if="formatToolPayload(visibleToolArguments(tool))">
                      <span>调用参数</span>
                      <pre>{{
                        formatToolPayload(visibleToolArguments(tool))
                      }}</pre>
                    </div>
                    <div v-if="tool.resultSummary">
                      <span>执行结果</span>
                      <p>{{ tool.resultSummary }}</p>
                    </div>
                  </div>
                </details>
              </div>
            </details>
          </template>
        </div>
        <div v-else-if="run.status === 'running'" class="subagent-run-waiting">
          正在启动独立上下文并接收执行事件…
        </div>

        <section
          v-if="run.summary || run.errorMessage"
          class="subagent-run-handoff"
          :class="{ 'is-error': run.status === 'error' }"
        >
          <strong>{{
            run.status === "completed" ? "交接摘要" : "结束说明"
          }}</strong>
          <StreamedContent v-if="run.summary" :content="run.summary" />
          <p v-if="run.errorMessage">{{ run.errorMessage }}</p>
          <small v-if="subagentUsageLabel(run)">{{
            subagentUsageLabel(run)
          }}</small>
        </section>
      </div>
    </details>
  </section>
</template>
