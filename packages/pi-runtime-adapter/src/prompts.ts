import {
  isSingleModelLongTeam,
  renderLearningImitationSystemPrompt,
  resolveScriptWorkspaceStageReadAccess,
  resolveShortWorkspaceStageReadAccess,
  type LongAgentProfile
} from "@deepwrite/contracts";
import {
  buildLongFixedContextLines,
  buildLongFollowUpContextLines
} from "./prompts-long";
import type { UserMessage } from "@earendil-works/pi-ai";
import { buildChatAssistantSystemPrompt } from "./chat-assistant";
import {
  renderDeepSeekWebSearchCapabilityPrompt,
  renderDeepSeekWebSearchNetworkBoundary
} from "./deepseek-web-search";
import { buildRawUserText, imageContentBlocks } from "./prompts-user-message";
import { renderLongBookAnalysisSystemPrompt } from "./long-book-analysis/prompt";
import { buildWritingSystemPrompt } from "./prompts-writing";
import type { AgentRunInput } from "./runtime-types";
import { renderSubagentAuthoringSystemPrompt } from "./subagent-authoring-tools";

export {
  scriptRuntimeFormatRequirements,
  scriptRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts-writing";

export function buildDeepWriteSystemPrompt(): string {
  return [
    "你是 DeepWrite 的本地创作协作智能体。",
    "用户当前明确提出的要求优先；当前实时文稿是本轮工作对象，不得凭空推翻已提供的作品事实。",
    "技能是写作方法，不是作品事实；素材是参考信息，不能自动升级为作品设定。",
    "只能声称使用了本轮上下文快照中实际提供或显式附加的内容。",
    "只能调用本轮实际列出的工具；没有列出的写回、保存、文件、Shell、HTTP 或浏览器能力不得声称已经执行。",
    "回复使用结构清晰的中文纯文本，并明确区分建议、示例和已确认事实。"
  ].join("\n");
}

function appendWorkspaceWebSearchPrompt(
  prompt: string,
  webSearchEnabled: boolean
): string {
  if (!webSearchEnabled) return prompt;
  return [
    prompt,
    "",
    renderDeepSeekWebSearchCapabilityPrompt(),
    renderDeepSeekWebSearchNetworkBoundary()
  ].join("\n");
}

function buildWorkspaceAgentSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const subagentAuthoring = input.workspaceContext?.subagentAuthoring;
  if (subagentAuthoring) {
    return [
      basePrompt,
      "",
      "【当前任务：技能转子智能体】",
      renderSubagentAuthoringSystemPrompt(subagentAuthoring).trim(),
      "",
      "【DeepWrite 技能转子智能体工具边界】",
      "只能使用本轮列出的技能读取与草稿写入工具。write_subagent_draft 只更新预览区，不会写入智能体团队；正式加入必须等待用户在界面中确认。"
    ].join("\n");
  }
  const learningProfile = input.learningImitationProfile;
  const learningContext = input.workspaceContext?.learningImitation;
  if (learningProfile && learningContext) {
    const writeBoundary =
      input.writeApprovalMode === "auto-approve"
        ? "只能使用本轮列出的样本文档读取、搜索与预览写入工具。write_learning_result 更新预览区后，客户端会立即把结果加入后台串行落盘队列并写入预先选择的目标库；若目标库尚未选全则保留预览。界面确认成功前不得声称已正式落盘。"
        : "只能使用本轮列出的样本文档读取、搜索与预览写入工具。write_learning_result 只更新预览区，不会写入正式素材库或技能库。正式落盘必须等待用户在界面中确认。";
    return [
      basePrompt,
      "",
      `【当前学习仿写智能体：${learningProfile.label} / ${learningProfile.id}】`,
      renderLearningImitationSystemPrompt(
        learningProfile.systemPrompt,
        learningContext
      ).trim(),
      "",
      "【DeepWrite 学习仿写工具边界】",
      writeBoundary
    ].join("\n");
  }
  const longBookAnalysisProfile = input.longBookAnalysisProfile;
  const longBookAnalysisContext = input.workspaceContext?.longBookAnalysis;
  if (longBookAnalysisProfile && longBookAnalysisContext) {
    return [
      basePrompt,
      "",
      `【当前长篇拆书智能体：${longBookAnalysisProfile.name} / ${longBookAnalysisProfile.id}】`,
      renderLongBookAnalysisSystemPrompt(
        longBookAnalysisProfile,
        longBookAnalysisContext,
        input.longBookAnalysisOutputMode,
        input.longBookAnalysisInputMode
      ).trim(),
      "",
      "【DeepWrite 长篇拆书工具边界】",
      input.longBookAnalysisInputMode === "inline"
        ? "本轮输入已经直接提供，当前不提供任何工具。完成分析后直接输出结果正文；不得输出 JSON 包装。"
        : input.longBookAnalysisOutputMode === "text"
          ? "只能使用本轮列出的章节或中间笔记 list/read/search 工具。完成分析后直接输出结果正文；不得调用未列出的写入工具，也不得输出 JSON 包装。"
          : "只能使用本轮列出的章节或中间笔记 list/read/search 工具，以及当前阶段唯一允许的 write_analysis_note 或 write_analysis_result。写入工具只更新本次任务的内存笔记或结果预览，不会修改源文件，也不会直接写入资料库。"
    ].join("\n");
  }
  const libraryProfile = input.libraryAgentProfile;
  const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
  if (libraryProfile && libraryWorkspace) {
    const writeBoundary =
      input.writeApprovalMode === "auto-approve"
        ? "写入工具只提交资料库条目或库介绍变更；提案生成后客户端会立即加入后台串行队列、自动批准并尝试保存。智能体可以继续当前回复，但在审批卡确认成功前不得声称已经保存成功。"
        : "写入工具提交待用户审阅的资料库条目或库介绍变更；用户接受后客户端才会保存到本地文件，当前回复不得提前声称已经保存。";
    return [
      basePrompt,
      "",
      `【当前资料库智能体：${libraryProfile.label} / ${libraryProfile.domain}】`,
      libraryProfile.systemPrompt.trim(),
      "",
      "【DeepWrite 当前资料库工具边界】",
      "写入只允许管理本轮指定的当前资料库；若该库属于分组，list/read/search 也可读取同分组其它成员库条目，但不得写入那些库。",
      "条目正文必须通过本轮实际列出的读取和搜索工具按需取得。",
      "需要整理、创建或初始化等方法时，调用 load_skill 按需加载本轮可用技能；技能是方法，不会自动成为资料库事实。",
      libraryWorkspace.readOnly
        ? "当前资料库只读，本轮不会装配任何创建或编辑工具。"
        : writeBoundary,
      "当前库介绍可通过本轮列出的介绍编辑工具修改；删除条目、修改分组、绑定书籍和写入其它资料库均未接通。"
    ].join("\n");
  }
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const longProfile = input.longAgentProfile;
  if (longProfile && longWorkspace) {
    const prompt = longProfile.systemPrompt.trim();
    if (!isSingleModelLongTeam(input.subagentDefinitions)) return prompt;
    return [
      prompt,
      "",
      "【单模型多角色长篇编排约束】",
      "五个角色虽然复用同一模型，但每次调用都使用独立系统提示和全新子会话。不得把一个角色的隐含分析过程当成另一个角色已经确认的事实。",
      "复杂任务先调用主编形成分阶段任务单；拆书任务只向拆书分析提供当前章节窗口，继续沿用分卷归并和全书摘要归并，不得一次塞入整本小说。",
      "正文写作只接收已经确认的设定、大纲、章纲、近期摘要和相关文风技能，不得转交主编的完整思考过程。",
      "候选规划或正文交付前，必须把候选结果、结构化依据和必要证据交给审计终审做反方复核；收到反方意见后再由主编裁决冲突。",
      "同源角色的多数意见不构成证据。无法由来源章节或阶段报告支持的内容必须标为未知或待确认。"
    ].join("\n");
  }
  return buildWritingSystemPrompt(basePrompt, input);
}

/** @internal Exported for workspace-type prompt regression tests. */
export function buildEffectiveSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  if (input.mode === "chat-assistant") {
    if (!input.chatAssistantRuntimeContext) {
      throw new Error("Chat assistant runtime context is unavailable.");
    }
    return buildChatAssistantSystemPrompt(
      input.chatAssistantRuntimeContext,
      input.webSearchEnabled === true
    );
  }
  return appendWorkspaceWebSearchPrompt(
    buildWorkspaceAgentSystemPrompt(basePrompt, input),
    input.webSearchEnabled === true
  );
}

/** @internal Exported for prompt-boundary regression tests. */
export function buildRuntimeUserPrompt(input: AgentRunInput): string {
  const active = input.workspaceContext?.activeResource;
  const libraryContext = input.workspaceContext?.libraryWorkspace;
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const writingWorkspace = scriptWorkspace ?? shortWorkspace;
  const writingProfile = input.scriptAgentProfile ?? input.agentProfile;
  const longProfile = input.longAgentProfile;
  const skills = input.workspaceContext?.attachedSkills ?? [];
  const materials = input.workspaceContext?.attachedMaterials ?? [];
  const isWritingAgentRun = Boolean(writingWorkspace && writingProfile);
  const isLibraryAgentRun = Boolean(
    libraryContext && input.libraryAgentProfile
  );
  // The unified long agent owns every stage, so all fixed context is injected
  // and no implementation-level ids are exposed.
  const isLongRun = Boolean(longWorkspace && longProfile);
  const learningContext = input.workspaceContext?.learningImitation;
  const longBookAnalysisContext = input.workspaceContext?.longBookAnalysis;
  const writingStageReadAccess = scriptWorkspace
    ? resolveScriptWorkspaceStageReadAccess(scriptWorkspace.activeStageId)
    : shortWorkspace
      ? resolveShortWorkspaceStageReadAccess(shortWorkspace.activeStageId)
      : undefined;
  const readableSkills = writingProfile
    ? skills.filter(
        (item) =>
          item.kind !== undefined &&
          writingProfile.readAccess.skill.includes(item.kind) &&
          (!writingStageReadAccess ||
            writingStageReadAccess.skill.includes(item.kind))
      )
    : longProfile
      ? skills.filter(
          (item) =>
            item.kind !== undefined &&
            longProfile.readAccess.skillKinds.includes(item.kind)
        )
      : input.libraryAgentProfile
        ? skills
        : skills;
  const readableMaterials = writingProfile
    ? materials.filter(
        (item) =>
          item.kind !== undefined &&
          writingProfile.readAccess.material.includes(item.kind) &&
          (!writingStageReadAccess ||
            writingStageReadAccess.material.includes(item.kind))
      )
    : longProfile
      ? materials.filter(
          (item) =>
            item.kind !== undefined &&
            longProfile.readAccess.materialKinds.includes(item.kind)
        )
      : materials;
  const isLongAgentRun = isLongRun;
  const skillContext =
    isWritingAgentRun || isLibraryAgentRun || isLongAgentRun
      ? readableSkills.length
        ? isLibraryAgentRun
          ? `可按需加载的技能：\n${input
              .libraryAgentProfile!.readAccess.skills.map(
                (skill) => `- ${skill.name}：${skill.description || "无描述"}`
              )
              .join(
                "\n"
              )}\n需要正文时调用 load_skill；name 可用完整名称或唯一短名。`
          : `可按需加载的技能：\n${readableSkills
              .map((item) => `- ${item.title} [${item.kind}]（id=${item.id}）`)
              .join(
                "\n"
              )}\n需要正文时调用 load_skill；name 优先完整标题，也可用条目标题短名或库名（唯一命中即可）。`
        : "可按需加载的技能: 无"
      : skills.length
        ? `显式附加技能:\n${skills.map((item) => `- ${item.title}: ${item.content}`).join("\n")}`
        : "显式附加技能: 无";
  const materialContext =
    isWritingAgentRun || isLongAgentRun
      ? readableMaterials.length
        ? `当前读取范围内的关联素材：\n${readableMaterials
            .map((item) => `- ${item.title} [${item.kind}]（id=${item.id}）`)
            .join("\n")}\n需要条目正文时调用 query_linked_material_entries。`
        : "当前读取范围内的关联素材: 无"
      : materials.length
        ? `显式附加素材:\n${materials
            .map((item) => `- ${item.title}: ${item.content}`)
            .join("\n")}`
        : "显式附加素材: 无";
  const lines = [
    "【本次智能体会话固定上下文】",
    isLongRun ? "" : `sessionId: ${input.sessionId}`,
    isLongRun ? "" : `runId: ${input.runId}`,
    writingWorkspace
      ? `【${scriptWorkspace ? "剧本" : "短篇"}上下文（AGENTS.md）】\n${writingWorkspace.agentsMd ?? "未提供"}`
      : "",
    writingWorkspace
      ? `【当前${scriptWorkspace ? "剧本" : "短篇"}情况（发送时快照）】`
      : "",
    writingWorkspace
      ? `${scriptWorkspace ? "剧本" : "短篇"}作品: 《${writingWorkspace.title}》`
      : "",
    ...(isLongRun ? buildLongFixedContextLines(longWorkspace!) : []),
    writingWorkspace
      ? `作品分类: ${writingWorkspace.categories.join("、") || "未分类"}`
      : "",
    writingWorkspace ? `当前阶段: ${writingWorkspace.activeStageId}` : "",
    writingWorkspace
      ? `剧情结构顺序: ${writingWorkspace.plotStages
          .map((stage) => `${stage.title} (${stage.id})`)
          .join(" → ")}`
      : "",
    writingWorkspace?.activeSectionId
      ? `当前用户正在操作的${scriptWorkspace ? "剧集" : "小节"}: ${
          writingWorkspace.expertDraft.sections.find(
            (section) => section.id === writingWorkspace.activeSectionId
          )?.title ?? "未知标题"
        }（section_id=${writingWorkspace.activeSectionId}）`
      : "",
    writingWorkspace
      ? writingWorkspace.characterStructure?.format === "list"
        ? `人物结构: 条目样式；人物条目索引: ${
            writingWorkspace.characterStructure.items.length
              ? writingWorkspace.characterStructure.items
                  .map((item) => `${item.title} (${item.id})`)
                  .join("、")
              : "无"
          }`
        : "人物结构: 文本样式（所有人物写在同一份总稿，kind=character_overview、id=character_design）"
      : "",
    writingWorkspace?.expertDraft.sections.length
      ? `正文目录${scriptWorkspace ? "剧集" : "小节"}（由早到晚）: ${writingWorkspace.expertDraft.sections
          .map((section) => `${section.title} (${section.id})`)
          .join("、")}`
      : "",
    writingProfile
      ? `当前智能体: ${writingProfile.label} (${writingProfile.id})`
      : longProfile
        ? `当前智能体: ${longProfile.label}`
        : input.libraryAgentProfile
          ? `当前智能体: ${input.libraryAgentProfile.label} (${input.libraryAgentProfile.domain})`
          : input.learningImitationProfile
            ? `当前智能体: ${input.learningImitationProfile.label} (${input.learningImitationProfile.id})`
            : input.longBookAnalysisProfile
              ? `当前智能体: ${input.longBookAnalysisProfile.name} (${input.longBookAnalysisProfile.id})`
              : "",
    learningContext
      ? `学习阶段: ${learningContext.stageId}；样本文档: ${learningContext.documents.length} 篇`
      : "",
    longBookAnalysisContext
      ? `拆书阶段: ${longBookAnalysisContext.phase}；选择范围: 第 ${longBookAnalysisContext.selectionStart}-${longBookAnalysisContext.selectionEnd} 章`
      : "",
    libraryContext
      ? `当前资料库: 《${libraryContext.title}》 (${libraryContext.domain} / ${libraryContext.kind}；短篇、剧本、长篇共用)`
      : "",
    libraryContext
      ? `资料库状态: ${libraryContext.readOnly ? "只读" : "可写"}${libraryContext.projectRevision === undefined ? "" : `；项目版本 ${libraryContext.projectRevision}`}`
      : "",
    libraryContext?.activeEntryId
      ? `当前条目: ${libraryContext.activeEntryId}`
      : "",
    libraryContext
      ? `库介绍${libraryContext.overviewTruncated ? "（已截断）" : ""}:\n${libraryContext.overview || "未填写"}`
      : "",
    libraryContext
      ? `条目索引（正文请通过工具读取）:\n${
          libraryContext.entries.length
            ? libraryContext.entries
                .map(
                  (entry) =>
                    `- ${entry.title} (${entry.id}) [${entry.stageId}]${entry.readOnly ? " [只读]" : ""}${entry.truncated ? " [正文快照已截断]" : ""}`
                )
                .join("\n")
            : "- 无条目"
        }${libraryContext.omittedEntryCount ? `\n- 另有 ${libraryContext.omittedEntryCount} 个条目未进入本轮快照` : ""}`
      : "",
    active
      ? `当前资源: ${active.title} (${active.domain}${active.format ? ` / ${active.format}` : ""})`
      : learningContext
        ? "当前资源: 学习仿写样本文档（正文请通过工具按需读取）"
        : longBookAnalysisContext
          ? "当前资源: 长篇拆书输入（章节正文或中间笔记请通过工具按需读取）"
          : "当前资源: 未提供",
    active && !isLongRun ? `资源路径: ${active.path.join(" / ")}` : "",
    active &&
    !writingWorkspace &&
    !longWorkspace &&
    !input.workspaceContext?.libraryWorkspace
      ? `实时内容:\n${active.content}`
      : "",
    skillContext,
    materialContext,
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export function longAgentRefreshesDesignContextOnLaterTurns(
  agentId: LongAgentProfile["id"] | undefined
): boolean {
  return agentId !== undefined;
}

function buildLongFollowUpTurnUserPrompt(input: AgentRunInput): string {
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const agentId = input.longAgentProfile?.id;
  if (!longWorkspace || !longAgentRefreshesDesignContextOnLaterTurns(agentId)) {
    return buildRawUserText(input);
  }
  return [
    ...buildLongFollowUpContextLines(longWorkspace),
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function buildRuntimeUserMessageContent(
  input: AgentRunInput
): UserMessage["content"] {
  const images = imageContentBlocks(input);
  return images.length
    ? [{ type: "text", text: buildRuntimeUserPrompt(input) }, ...images]
    : buildRuntimeUserPrompt(input);
}

export function buildLongFollowUpTurnUserMessageContent(
  input: AgentRunInput
): UserMessage["content"] {
  const text = buildLongFollowUpTurnUserPrompt(input);
  const images = imageContentBlocks(input);
  return images.length ? [{ type: "text", text }, ...images] : text;
}

/** @internal Exported for prompt-content regression tests. */
export function buildRawUserMessage(
  input: AgentRunInput,
  timestamp = Date.now()
): UserMessage {
  const text = buildRawUserText(input);
  const images = imageContentBlocks(input);
  return {
    role: "user",
    content: images.length ? [{ type: "text", text }, ...images] : text,
    timestamp
  };
}
