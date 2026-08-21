<script setup lang="ts">
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { ProcessingDisplayItem } from "./conversationToolPresentation";
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
import { writeToolText } from "../utils/agentWriteToolPreview";
import AppIcon from "./AppIcon.vue";
import AgentEditProposalCard from "./AgentEditProposalCard.vue";
import LongProposalReview from "./LongProposalReview.vue";
import StreamedContent from "./StreamedContent.vue";

const props = withDefaults(
  defineProps<{
    item: ProcessingDisplayItem;
    streaming: boolean;
    messageStatus?: "streaming" | "completed" | "stopped" | "error" | undefined;
    allowLiveEditReview?: boolean;
    longWorkspaceIndex?: LongWorkspaceIndexSnapshot | null;
  }>(),
  {
    allowLiveEditReview: false,
    longWorkspaceIndex: null
  }
);

const emit = defineEmits<{
  reviewEdit: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locateEditProposal: [payload: { runId: string; proposalId: string }];
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [eventId: string];
}>();

function writeToolFallback(): string {
  return props.streaming ? "正在等待写入内容……" : "没有写入内容";
}
</script>

<template>
  <details
    v-if="item.type === 'thinking'"
    class="processing-live-item processing-live-thinking"
  >
    <summary>
      <span>{{ streaming ? "思考中" : "思考过程" }}</span>
      <AppIcon name="chevron" :size="13" />
    </summary>
    <div class="processing-live-body processing-thinking">
      <StreamedContent :content="item.content" :streaming="streaming" />
    </div>
  </details>

  <div
    v-else-if="item.type === 'response'"
    class="processing-step processing-response"
  >
    <StreamedContent :content="item.content" :streaming="streaming" />
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
          <span v-if="toolDetail(item.tool)">{{ toolDetail(item.tool) }}</span>
        </div>
      </div>
      <AppIcon v-if="!isWriteTool(item.tool)" name="chevron" :size="13" />
    </summary>
    <div class="processing-live-body tool-detail">
      <div v-if="isWriteTool(item.tool)" class="write-tool-detail">
        <div class="write-tool-output-heading">
          <span>{{ writeToolContentLabel(item.tool) }}</span>
          <small v-if="writeToolTarget(item.tool)">{{
            writeToolTarget(item.tool)
          }}</small>
          <small
            >{{
              writeToolText(item.tool).length.toLocaleString("zh-CN")
            }}
            字符</small
          >
        </div>
        <pre
          class="write-tool-output"
          :class="{
            'is-streaming': streaming && item.tool.status === 'preparing'
          }"
          >{{ writeToolText(item.tool) || writeToolFallback() }}</pre>
      </div>
      <div v-else-if="formatToolPayload(visibleToolArguments(item.tool))">
        <span>调用参数</span>
        <pre>{{ formatToolPayload(visibleToolArguments(item.tool)) }}</pre>
      </div>
      <div v-if="item.tool.resultSummary">
        <span>执行结果</span>
        <p>{{ item.tool.resultSummary }}</p>
      </div>
    </div>
  </details>

  <AgentEditProposalCard
    v-else-if="item.type === 'edit-proposal'"
    class="approval-timeline-card"
    :proposal="item.proposal"
    :message-status="messageStatus"
    :allow-live-edit-review="allowLiveEditReview"
    @review="emit('reviewEdit', $event)"
    @locate="emit('locateEditProposal', $event)"
  />

  <LongProposalReview
    v-else-if="item.type === 'long-proposal'"
    class="approval-timeline-card"
    embedded
    conversation-card
    :items="[item.item]"
    :workspace-index="longWorkspaceIndex"
    @approve="emit('approveLongProposal', $event)"
    @reject="emit('rejectLongProposal', $event)"
    @retry-preview="emit('retryLongProposalPreview', $event)"
    @locate="emit('locateLongProposal', $event)"
  />

  <details
    v-else
    class="processing-live-item processing-live-thinking processing-tool-group"
    :aria-busy="toolGroupIsRunning(item.tools)"
  >
    <summary>
      <span>{{ toolGroupLabel(item.tools) }}</span>
      <AppIcon name="chevron" :size="13" />
    </summary>
    <div class="processing-live-body tool-call-list" aria-label="工具调用列表">
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
              <span v-if="toolDetail(tool)">{{ toolDetail(tool) }}</span>
            </div>
          </div>
          <AppIcon name="chevron" :size="13" />
        </summary>
        <div class="processing-live-body tool-detail">
          <div v-if="formatToolPayload(visibleToolArguments(tool))">
            <span>调用参数</span>
            <pre>{{ formatToolPayload(visibleToolArguments(tool)) }}</pre>
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
