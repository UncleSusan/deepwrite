import type { AgentEditProposal, AgentToolTrace, ChatMessage } from "../types/conversation";
import type { IconName } from "../types/workspace";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { writeToolText } from "../utils/agentWriteToolPreview";

export function workspaceToolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_workspace_content: "读取工作区内容", search_workspace_text: "搜索工作区文本",
    query_linked_material_entries: "查询关联素材", load_skill: "加载技能",
    switch_storyline_stage: "切换剧情方向", write_workspace_editor: "写入阶段编辑器",
    replace_current_stage_text: "替换阶段文本", create_draft_sections: "创建章节文件",
    read_draft_sections: "读取正文章节", write_draft_section: "写入正文章节",
    replace_draft_section_text: "替换正文章节文本", rename_draft_section: "修改章节名称",
    delete_draft_section: "删除章节", list_setting: "列出设定",
    search_setting: "搜索设定", read_setting: "读取设定",
    create_setting: "创建设定", write_setting: "写入设定", edit_setting: "编辑设定",
    list_worldbuilding: "列出世界观", read_worldbuilding: "读取世界观",
    search_worldbuilding: "搜索世界观", read_worldbuilding_file: "读取世界观文件",
    create_worldbuilding_file: "创建世界观文件", write_worldbuilding_file: "写入世界观文件",
    edit_worldbuilding_file: "编辑世界观文件", create_worldbuilding_files: "创建世界观文件",
    read_worldbuilding_content: "读取世界观文件", create_worldbuilding_items: "创建世界观文件",
    write_worldbuilding_content: "写入世界观文件", replace_worldbuilding_text: "编辑世界观文件",
    list_characters: "列出人物", search_characters: "搜索人物", read_character: "读取人物",
    write_character_overview: "写入人物概览", edit_character_overview: "编辑人物概览",
    create_character: "创建人物", write_character_file: "写入人物文件",
    create_character_file: "创建人物文件", edit_character_file: "编辑人物文件",
    rename_character_item: "修改人物名称", move_character_item: "移动人物条目",
    delete_character_file: "删除人物文件", list_plot_design: "列出剧情设计",
    search_plot_design: "搜索剧情设计", read_plot_design: "读取剧情设计",
    create_plot_design: "创建剧情设计", write_plot_design: "写入剧情设计",
    edit_plot_design: "编辑剧情设计"
  };
  return labels[name] ?? name;
}

export function hasProcessing(message: ChatMessage): boolean {
  return processingItems(message).length > 0;
}

export function hasProcessingDisclosure(message: ChatMessage): boolean {
  return hasProcessing(message) || Boolean(message.subagentRuns?.length);
}

export function isSpawnSubagentTool(tool: AgentToolTrace): boolean {
  return tool.name === "spawn_subagent";
}

function hasSubagentRunForTool(message: ChatMessage, tool: AgentToolTrace): boolean {
  return Boolean(
    isSpawnSubagentTool(tool) &&
    message.subagentRuns?.some((run) => run.parentToolCallId === tool.id)
  );
}

export type ProcessingItem =
  | { id: string; type: "thinking"; content: string; createdAt: string }
  | { id: string; type: "response"; content: string; createdAt: string }
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt: string };

export type ApprovalCardItem =
  | { id: string; type: "edit-proposal"; createdAt: string; toolCallIds: string[]; proposal: AgentEditProposal }
  | { id: string; type: "long-proposal"; createdAt: string; toolCallIds: string[]; item: LongWorkspaceProposalItem };

export type ProcessingDisplayItem =
  | Exclude<ProcessingItem, { type: "tool" }>
  | { id: string; type: "tool"; tool: AgentToolTrace }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] }
  | ApprovalCardItem;

export function processingItems(message: ChatMessage): ProcessingItem[] {
  const items: ProcessingItem[] = [];
  if (message.processingSteps?.length) {
    let lastResponseIndex = -1;
    for (let index = message.processingSteps.length - 1; index >= 0; index -= 1) {
      if (message.processingSteps[index]?.type === "response") {
        lastResponseIndex = index;
        break;
      }
    }
    for (const [index, step] of message.processingSteps.entries()) {
      if (step.type === "thinking") {
        items.push({ id: step.id, type: "thinking", content: step.content, createdAt: step.createdAt });
        continue;
      }
      if (step.type === "response") {
        // While streaming every turn remains visible in arrival order. Once the
        // run ends, the last response moves outside the processed disclosure.
        if (message.status === "streaming" || index !== lastResponseIndex) {
          items.push({ id: step.id, type: "response", content: step.content, createdAt: step.createdAt });
        }
        continue;
      }
      const tool = message.toolCalls?.find((toolCall) => toolCall.id === step.toolCallId);
      if (tool && !hasSubagentRunForTool(message, tool)) {
        items.push({ id: step.id, type: "tool", tool, createdAt: step.createdAt });
      }
    }
    return items;
  }
  if (message.thinking) {
    items.push({
      id: `${message.id}_thinking`, type: "thinking", content: message.thinking, createdAt: message.createdAt
    });
  }
  for (const tool of message.toolCalls ?? []) {
    if (!hasSubagentRunForTool(message, tool)) {
      items.push({ id: `${message.id}_${tool.id}`, type: "tool", tool, createdAt: tool.requestedAt });
    }
  }
  return items;
}

function compareApprovalCards(left: ApprovalCardItem, right: ApprovalCardItem): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function longProposalItemsForMessage(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): LongWorkspaceProposalItem[] {
  if (!message.runId) return [];
  return longProposalItems.filter((item) => item.event.payload.runId === message.runId);
}

export function approvalItemsForMessage(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): ApprovalCardItem[] {
  const editItems: ApprovalCardItem[] = (message.editProposals ?? []).map((proposal) => ({
    id: `edit:${proposal.id}`, type: "edit-proposal", createdAt: proposal.createdAt,
    toolCallIds: proposal.toolCallIds, proposal
  }));
  const longItems: ApprovalCardItem[] = longProposalItemsForMessage(message, longProposalItems).map(
    (item) => ({
      id: `long:${item.event.id}`, type: "long-proposal", createdAt: item.event.timestamp,
      toolCallIds: [item.event.payload.toolCallId], item
    })
  );
  return [...editItems, ...longItems].sort(compareApprovalCards);
}

export function liveTimelineItems(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): Array<ProcessingItem | ApprovalCardItem> {
  const processing = processingItems(message);
  const positioned: Array<{ position: number; sequence: number; item: ProcessingItem | ApprovalCardItem }> =
    processing.map((item, index) => ({ position: index * 2, sequence: index, item }));

  for (const [approvalIndex, approval] of approvalItemsForMessage(message, longProposalItems).entries()) {
    let anchorIndex = -1;
    for (const [index, item] of processing.entries()) {
      if (item.type === "tool" && approval.toolCallIds.includes(item.tool.id)) {
        anchorIndex = index;
      }
    }
    if (anchorIndex >= 0) {
      positioned.push({
        position: anchorIndex * 2 + 1,
        sequence: processing.length + approvalIndex,
        item: approval
      });
      continue;
    }
    const laterIndex = processing.findIndex(
      (item) => item.createdAt.localeCompare(approval.createdAt) > 0
    );
    positioned.push({
      position: laterIndex < 0 ? processing.length * 2 + 1 : laterIndex * 2 - 1,
      sequence: processing.length + approvalIndex,
      item: approval
    });
  }

  return positioned
    .sort((left, right) => {
      if (left.position !== right.position) return left.position - right.position;
      const leftApproval = left.item.type === "edit-proposal" || left.item.type === "long-proposal";
      const rightApproval = right.item.type === "edit-proposal" || right.item.type === "long-proposal";
      if (leftApproval && rightApproval) {
        return compareApprovalCards(left.item as ApprovalCardItem, right.item as ApprovalCardItem);
      }
      return left.sequence - right.sequence;
    })
    .map(({ item }) => item);
}

export function processingDisplayItems(
  message: ChatMessage,
  includeApprovalCards = false,
  longProposalItems: readonly LongWorkspaceProposalItem[] = []
): ProcessingDisplayItem[] {
  const displayItems: ProcessingDisplayItem[] = [];
  const timelineItems = includeApprovalCards
    ? liveTimelineItems(message, longProposalItems)
    : processingItems(message);
  for (const item of timelineItems) {
    if (item.type === "edit-proposal" || item.type === "long-proposal") {
      displayItems.push(item); continue;
    }
    if (item.type !== "tool" || isWriteTool(item.tool)) {
      displayItems.push(item); continue;
    }
    const previous = displayItems.at(-1);
    if (previous?.type === "tool-group") {
      previous.tools.push(item.tool); continue;
    }
    displayItems.push({ id: `${item.id}_group`, type: "tool-group", tools: [item.tool] });
  }
  return displayItems;
}

function hasResponseSteps(message: ChatMessage): boolean {
  return message.processingSteps?.some((step) => step.type === "response") ?? false;
}


export function visibleResponse(message: ChatMessage): string {
  if (message.status === "streaming" && hasResponseSteps(message)) return "";
  return message.content;
}

function retryProgress(message: ChatMessage): { current: number; total: number } | undefined {
  if (!message.retry) return undefined;
  return {
    current: Math.max(1, message.retry.attempt - 1),
    total: Math.max(1, message.retry.maxAttempts - 1)
  };
}

export function retryStatusLabel(message: ChatMessage, now: number): string | undefined {
  const retry = message.retry;
  const progress = retryProgress(message);
  if (!retry || !progress) return undefined;
  const suffix = `（第 ${progress.current}/${progress.total} 次）`;
  if (retry.state === "trying") return `正在重试${suffix}`;
  const retryAt = retry.retryAt ? Date.parse(retry.retryAt) : Number.NaN;
  const remainingSeconds = Number.isFinite(retryAt)
    ? Math.max(0, Math.ceil((retryAt - now) / 1_000))
    : Math.max(0, Math.ceil((retry.delayMs ?? 0) / 1_000));
  return `网络波动，${remainingSeconds}s 后重试${suffix}`;
}

export function hasFirstModelOutput(message: ChatMessage): boolean {
  if (message.content || message.thinking) return true;
  if (message.toolCalls?.length || message.subagentRuns?.length) return true;
  return message.processingSteps?.some(
    (step) =>
      step.type === "tool" ||
      ((step.type === "thinking" || step.type === "response") && step.content.length > 0)
  ) ?? false;
}

export const MODEL_QUEUE_LABEL_DELAY_MS = 10_000;

export function processingLabel(message: ChatMessage, now: number): string {
  const retryLabel = retryStatusLabel(message, now);
  if (retryLabel) return retryLabel;
  const start = Date.parse(message.processingStartedAt ?? message.createdAt);
  const end = message.processingCompletedAt
    ? Date.parse(message.processingCompletedAt)
    : message.status === "streaming"
      ? now
      : start + 1_000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return message.status === "streaming" ? "处理中" : "已处理";
  }
  const seconds = Math.max(1, Math.ceil((end - start) / 1_000));
  if (
    message.status === "streaming" &&
    end - start >= MODEL_QUEUE_LABEL_DELAY_MS &&
    !hasFirstModelOutput(message)
  ) {
    return `模型排队中 · 已等待 ${seconds}s`;
  }
  return `${message.status === "streaming" ? "处理中" : "已处理"} ${seconds}s`;
}

type ToolKind = "read" | "command" | "write" | "web" | "other";

const WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor", "replace_current_stage_text", "create_draft_sections",
  "write_draft_section", "replace_draft_section_text", "rename_draft_section",
  "delete_draft_section", "create_setting", "write_setting", "edit_setting",
  "create_worldbuilding_file", "write_worldbuilding_file", "edit_worldbuilding_file",
  "create_worldbuilding_items", "write_worldbuilding_content", "replace_worldbuilding_text",
  "create_character", "create_character_file", "write_character_file", "edit_character_file",
  "rename_character_item", "move_character_item", "delete_character_file",
  "write_character_overview", "edit_character_overview", "create_plot_design",
  "write_plot_design", "edit_plot_design", "write_chapter_draft", "edit_chapter_draft"
]);

const CREATE_FILE_TOOL_NAMES = new Set([
  "create_draft_sections", "create_setting", "create_worldbuilding_file",
  "create_worldbuilding_files", "create_worldbuilding_items", "create_character",
  "create_character_file", "create_plot_design"
]);

const DIRECT_WRITE_TOOL_NAMES = new Set([
  "write_workspace_editor", "create_draft_sections", "write_draft_section",
  "rename_draft_section", "delete_draft_section", "write_setting",
  "write_worldbuilding_file", "write_worldbuilding_content", "write_character_file",
  "write_character_overview", "write_plot_design", "write_chapter_draft"
]);

export function isWriteTool(tool: AgentToolTrace): boolean {
  return WRITE_TOOL_NAMES.has(tool.name) || toolKind(tool.name) === "write";
}

type WriteToolAction = "write" | "modify";

export function writeToolAction(tool: AgentToolTrace): WriteToolAction {
  return DIRECT_WRITE_TOOL_NAMES.has(tool.name) || /(?:write|save)/i.test(tool.name)
    ? "write"
    : "modify";
}

export function writeActionLabel(action: WriteToolAction): "写入" | "修改" {
  return action === "write" ? "写入" : "修改";
}

export function toolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (WRITE_TOOL_NAMES.has(name) || /(write|edit|replace|patch|save|apply)/.test(name)) {
    return "write";
  }
  if (/(read|list|search|find|glob|file)/.test(name)) {
    return "read";
  }
  if (/(exec|shell|command|terminal|run)/.test(name)) {
    return "command";
  }
  if (/(browser|web|http|fetch|url)/.test(name)) {
    return "web";
  }
  return "other";
}

export function toolIcon(tool: AgentToolTrace): IconName {
  const kind = toolKind(tool.name);
  if (kind === "read") return "folder";
  if (kind === "command") return "terminal";
  if (kind === "write") return "file";
  if (kind === "web") return "globe";
  return "sparkles";
}

export function toolLabel(tool: AgentToolTrace): string {
  const displayName = workspaceToolLabel(tool.name);
  if (tool.name === "write_chapter_draft") {
    if (tool.status === "error") return "正文审核生成失败";
    if (tool.status === "completed") return "当前章正文待审核";
    if (tool.status === "running") return "正在生成正文审核";
    return "正在生成当前章正文";
  }
  if (tool.name === "edit_chapter_draft") {
    if (tool.status === "error") return "正文修改审核生成失败";
    if (tool.status === "completed") return "当前章正文修改待审核";
    if (tool.status === "running") return "正在生成正文修改审核";
    return "正在生成当前章正文修改";
  }
  if (CREATE_FILE_TOOL_NAMES.has(tool.name)) {
    if (tool.status === "error") return "创建文件失败";
    if (tool.status === "completed") return "文件创建变更已生成";
    return "正在创建文件";
  }
  if (isWriteTool(tool)) {
    const action = writeActionLabel(writeToolAction(tool));
    if (tool.status === "error") return `${action}失败`;
    if (tool.status === "completed") return `${action}结果已生成`;
    return `正在${action}`;
  }
  if (tool.status === "error") return `执行 ${displayName} 时出错`;
  if (tool.status === "preparing") return `正在准备${displayName}`;
  const running = tool.status === "running";
  const kind = toolKind(tool.name);
  if (kind === "read") return running ? "正在读取文件" : "已读取文件";
  if (kind === "command") return running ? "正在运行命令" : "运行了命令";
  if (kind === "write") return running ? "正在提交文本变更" : "已生成文本变更";
  if (kind === "web") return running ? "正在访问页面" : "已访问页面";
  return `${running ? "正在执行" : "已执行"} ${displayName}`;
}

export function toolGroupIsRunning(tools: AgentToolTrace[]): boolean {
  return tools.some((tool) => tool.status === "preparing" || tool.status === "running");
}

export function toolGroupLabel(tools: AgentToolTrace[]): "执行中" | "执行完成" {
  return toolGroupIsRunning(tools) ? "执行中" : "执行完成";
}

function compactTrace(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

export function toolDetail(tool: AgentToolTrace): string | undefined {
  if (tool.status === "preparing") {
    const length = writeToolText(tool).length;
    return length > 0
      ? `已生成 ${length.toLocaleString("zh-CN")} 字符`
      : isWriteTool(tool)
        ? "待审阅文本生成中"
        : "参数生成中";
  }
  if (isWriteTool(tool) && tool.status === "running") {
    return `正在提交${writeActionLabel(writeToolAction(tool))}内容`;
  }
  if (tool.resultSummary?.trim()) {
    return compactTrace(tool.resultSummary);
  }
  if (!tool.args || typeof tool.args !== "object") {
    return undefined;
  }
  const args = tool.args as Record<string, unknown>;
  for (const key of ["path", "file", "command", "query", "url"]) {
    if (typeof args[key] === "string") {
      return compactTrace(args[key]);
    }
  }
  try {
    return compactTrace(JSON.stringify(args));
  } catch {
    return undefined;
  }
}

export function writeToolContentLabel(tool: AgentToolTrace): string {
  return tool.name === "write_chapter_draft" || tool.name === "edit_chapter_draft" ? "待审阅正文" : "写入内容";
}

export function writeToolTarget(tool: AgentToolTrace): string | undefined {
  if (!tool.args || typeof tool.args !== "object") return undefined;
  const args = tool.args as Record<string, unknown>;
  return typeof args.target_stage_id === "string" ? args.target_stage_id : undefined;
}

export function visibleToolArguments(tool: AgentToolTrace): unknown {
  return tool.args ?? tool.argumentsText;
}

export function formatToolPayload(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return formatted.length > 3_000 ? `${formatted.slice(0, 3_000)}\n…` : formatted;
  } catch {
    return String(value);
  }
}
