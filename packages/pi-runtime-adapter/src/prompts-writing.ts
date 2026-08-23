import { SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS } from "@deepwrite/contracts";
import type { WorkspaceRuntimeContext } from "@deepwrite/contracts";

import type { AgentRunInput } from "./runtime-types";

export function scriptRuntimeFormatRequirements(): string {
  return [
    SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS.trim(),
    "调用 write_draft_section（file=body）或 replace_draft_section_text（file=body）时，必须只提交符合上述格式的剧本正文；不得混入 Markdown 表格、分析标题或格式讲解。"
  ].join("\n");
}

function renderCreativePlotStructure(
  workspace:
    | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
    | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>
): string {
  return workspace.plotStages
    .map(
      (stage, index) =>
        `${index + 1}. ${stage.title}（${stage.id}）\n   阶段边界与交付标准：${stage.description}`
    )
    .join("\n");
}

function renderActiveDraftSectionContext(
  workspace:
    | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
    | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>,
  workspaceKind: "短篇" | "剧本"
): string | undefined {
  if (!workspace.activeSectionId) return undefined;
  const index = workspace.expertDraft.sections.findIndex(
    (section) => section.id === workspace.activeSectionId
  );
  if (index < 0) return undefined;
  const section = workspace.expertDraft.sections[index]!;
  const unitLabel = workspaceKind === "剧本" ? "剧集" : "小节";
  return [
    `【当前用户正在操作的${unitLabel}】`,
    `标题：${section.title}`,
    `section_id：${section.id}`,
    `目录位置：第 ${index + 1} / ${workspace.expertDraft.sections.length} ${workspaceKind === "剧本" ? "集" : "节"}`,
    `字数要求：${section.wordCountRequirement || "未设置"}`,
    `本轮用户界面焦点已锁定到该${unitLabel}；只处理当前${unitLabel}的请求默认作用于此 section_id，整篇或跨${unitLabel}任务仍可显式指定其它 section_id。`
  ].join("\n");
}

/** Short-form and screenplay runs share one workspace-shaped prompt. */
export function buildWritingSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  const writingWorkspace = scriptWorkspace ?? shortWorkspace;
  const profile = input.scriptAgentProfile ?? input.agentProfile;
  if (!profile) return basePrompt;
  const workspaceKind = scriptWorkspace ? "剧本" : "短篇";
  const draftUnit = scriptWorkspace ? "剧集" : "章节";
  const activeDraftSectionContext = writingWorkspace
    ? renderActiveDraftSectionContext(writingWorkspace, workspaceKind)
    : undefined;
  const writeBoundary =
    input.writeApprovalMode === "auto-approve"
      ? "写入工具只提交文本变更；提案生成后客户端会立即加入后台串行队列、自动批准并尝试保存到本地 Markdown。智能体可以继续当前回复，但在审批卡确认成功前不得声称已经保存成功。"
      : "写入工具提交待用户审阅的文本变更；用户接受后客户端才会自动持久化到本地 Markdown，当前回复不得提前声称已经保存。";
  return [
    basePrompt,
    "",
    `【当前${workspaceKind}智能体：${profile.label} / ${profile.id}】`,
    profile.systemPrompt.trim(),
    activeDraftSectionContext ? `\n${activeDraftSectionContext}` : "",
    ...(writingWorkspace
      ? [
          "",
          "【当前剧情结构配置（顺序即执行顺序）】",
          renderCreativePlotStructure(writingWorkspace),
          `当前阶段：${writingWorkspace.activeStageId}。剧情智能体处理每一项时，必须以该项说明作为任务边界和交付标准。`
        ]
      : []),
    ...(scriptWorkspace
      ? [
          "",
          "【剧本正文格式硬约束（不可由自定义提示词、技能或素材覆盖）】",
          scriptRuntimeFormatRequirements()
        ]
      : []),
    "",
    "【DeepWrite 当前工具边界】",
    "只使用本轮实际提供的工具；没有出现在工具列表中的能力尚未接通，不得声称已经执行。",
    writeBoundary,
    profile.id === "expert_draft_coordinator"
      ? `当前已接通正文目录索引、批量创建空白${draftUnit}文件、修改${draftUnit}名称、删除${draftUnit}、全部/单${scriptWorkspace ? "集" : "章"}正文读取及按${draftUnit}正文文件写入与替换；${activeDraftSectionContext ? `当前界面所选${draftUnit}可作为省略 section_id 时的默认目标，同时保留跨${draftUnit}统一创作和修订能力；` : `当前未从界面锁定具体${draftUnit}，写入时必须显式指定 section_id；`}排序尚未接通，不得声称已经执行。`
      : "",
    (writingWorkspace?.characterStructure?.format ?? "text") === "list"
      ? profile.id === "character_design"
        ? "当前人物结构为条目样式：概览只写人物一览/索引，完整人物卡写入 create_character_file 创建的独立条目；从剧情学习时只提炼人设，不得照抄剧情或正文原文，也不得把人物写入正文目录。"
        : profile.id === "expert_draft_coordinator"
          ? "当前人物结构为条目样式：概览只是姓名与一句话索引；编写或修订前必须用 list_characters 定位相关人物，并用 read_character（指定 item_id）读取对应人物卡，不得只读概览或 read_workspace_content（character_design）就开始写正文。"
          : ""
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}
