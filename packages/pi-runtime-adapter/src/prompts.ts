import {
  longAgentAcceptsWorldbuildingDirectory,
  renderLearningImitationSystemPrompt,
  SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS,
  type LongAgentProfile,
  type LongPlotFocusSnapshot,
  type LongWorkspaceRuntimeContext,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type { UserMessage } from "@earendil-works/pi-ai";
import { buildChatAssistantSystemPrompt } from "./chat-assistant";
import type { AgentRunInput } from "./runtime-types";
import { renderSubagentAuthoringSystemPrompt } from "./subagent-authoring-tools";

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

/** @internal Exported for workspace-type prompt regression tests. */
export function buildEffectiveSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  if (input.mode === "chat-assistant") {
    if (!input.chatAssistantRuntimeContext) {
      throw new Error("Chat assistant runtime context is unavailable.");
    }
    return buildChatAssistantSystemPrompt(input.chatAssistantRuntimeContext);
  }
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
    const writeBoundary =
      input.writeApprovalMode === "auto-approve"
        ? "长篇写入工具只形成带基线版本和影响预览的提案；提案生成后客户端会立即加入按书籍串行的后台队列，自动完成影响预览、冲突检查和原子落盘。智能体可以继续当前回复，但在审批卡确认成功前不得声称已经保存或提交账本。"
        : "长篇写入工具只形成带基线版本和影响预览的提案；用户明确批准且冲突检查通过后才会原子落盘。不得提前声称已经保存或提交账本。";
    return [
      basePrompt,
      "",
      longProfile.id === "setting"
        ? `【当前长篇智能体：${longProfile.label}】`
        : `【当前长篇智能体：${longProfile.label} / ${longProfile.id}】`,
      longProfile.systemPrompt.trim(),
      "",
      "【DeepWrite 长篇工具边界】",
      "四个长篇智能体读取互通：设定用 list_setting / search_setting / read_setting（指定 domain=worldbuilding 或 domain=character），剧情用 list_plot_design / search_plot_design / read_plot_design，正文、章末人物状态与接续包用 list_chapters / search_chapters / read_chapter（document 可选 body / character_state / handoff），按章连续性文件用 list_continuity_files / read_continuity_file；写入仍只限当前阶段自身范围。",
      longProfile.id === "setting"
        ? "设定只使用本次固定上下文或工具返回的业务 ID 定位内容：世界观用 category_id / item_id，人物用 character_id / document。设定内容的查询、搜索和读取使用 list_setting / search_setting / read_setting，并指定 domain=worldbuilding 或 domain=character；其它阶段内容用各自阶段的 list / search / read 工具只读查阅。固定上下文目录已经完整列出目标时，不要仅为重复取得同一列表而调用 list_setting。目录标注存在省略项或需要核验本轮结构变更时再调用列表工具。长篇结构导航已写入固定上下文，仅供对照剧情框架；不得把剧情正文写入本轮固定上下文，也不得修改剧情结构。工具会处理其余实现细节，不得索取、猜测或复述。未读取正文不得当成事实。"
        : longProfile.id === "plot_design"
          ? "剧情设计只使用本次固定上下文或工具返回的业务 ID 定位内容：全书故事线用 book_line，分卷、剧情点、故事情节、章卡、故事事件、事件连接和叙事落点用各自稳定业务 ID。查询、搜索和读取使用 list_plot_design / search_plot_design / read_plot_design。世界观与人物目录已写入本轮固定上下文；条目正文仍须通过 list_setting / search_setting / read_setting（指定 domain=worldbuilding 或 domain=character）按需读取。目录已经完整列出目标时，不要仅为重复取得同一列表而调用 list_setting。不得把设定正文或 fileId 写入本轮固定上下文。不得使用底层索引、路径或 fileId，未读取内容不得当成事实。"
        : longProfile.id === "draft"
          ? "写手只使用本次固定上下文或工具返回的业务 ID 定位内容：世界观用 category_id / item_id，人物用 character_id / document，剧情与章节用各自稳定业务 ID。查询、搜索和读取使用 list_setting / search_setting / read_setting（指定 domain=worldbuilding 或 domain=character），以及剧情和章节的 list / search / read 工具。世界观、人物目录与长篇结构导航已写入本轮固定上下文；条目正文仍须按需读取。目录已经完整列出目标时，不要仅为重复取得同一列表而调用 list_setting。不得把设定正文、剧情正文或 fileId 写入本轮固定上下文。不得使用底层索引、路径或 fileId，未读取内容不得当成事实。"
        : longProfile.id === "continuity_ledger"
          ? "连续性账本只使用 list_setting / search_setting / read_setting（指定 domain）以及剧情和正文各阶段的 list / search / read 工具及其业务 ID；不得使用底层索引、路径或 fileId，未读取内容不得当成事实。"
          : "长篇项目只在本轮授权的 bookId 内按稳定实体 ID 和 fileId 查询；不得猜测路径，也不得把未读取内容当成事实。",
      writeBoundary,
      longProfile.id === "plot_design"
        ? "连续性记录只提供按章参考，不锁定章卡、故事情节或伏笔结构。允许创建、删除、移动和重排已有记录的章卡；删除章卡时客户端会在危险确认后级联清理该章正文、连续性文件和记录索引。章卡必须指定所属分卷，剧情点关联可为 null；非空时必须与章卡属于同一分卷。调用 create_plot_design 或 propose_long_mutation 前必须核对二者；伏笔线创建必须在 propose_long_mutation 的 operations 中精确使用 type=foreshadowing.create，伏笔触点创建精确使用 type=foreshadowingBeat.create，不得改写成 snake_case 或自然语言别名。跨卷移动章卡时可改绑目标卷内剧情点或解除关联。移动或删除剧情点只解除章卡的弱关联，不移动或删除章卡。同一次运行形成多个有效提案时，客户端会按先后依赖等待前序提案处理，并基于最新工作区重新预览；不得把待审提案说成已经落盘。故事情节或章卡的纯正文写入也会按文件修订等待前序创建或写入完成。工具返回未形成提案时，必须向用户解释约束，不得要求审批不存在的卡片。"
        : "",
      longProfile.id === "draft"
        ? "写手只允许为上下文锁定的当前章形成小说正文提案；不得生成或修改人物状态、handoff、接续包及其它连续性文件，这些内容由连续性账本智能体在正文获批后独立处理。未锁定章卡时只做规划、检查和调度，不得写入正文。"
        : "",
      longProfile.id === "continuity_ledger"
        ? "连续性阶段以按章文本文件留存章末状态、接续包，以及按需创建的世界观揭露和人物当前状态/历史轨迹。可对任意已有正文、尚未记录的章卡写入；未选中章卡时必须带 chapter_card_id。多张未记录章可一次追记：list_continuity_files 的 pending_catchup 中前文 brief 只写简短章末状态与接续包，最后一张 full 写完整账本。伏笔总览是唯一设计源：只核验 list_continuity_files 返回的本章既有伏笔触点，以 foreshadowing_id、beat_id、committed/missed 和正文证据登记变化；没有候选时不得写伏笔变化或‘本章无变化’，也不得自行新增伏笔。先 list/read，再 create/write/edit；仅当可选文件误创建或不再适用时使用 delete_continuity_file。每章文件完成后调用 propose_continuity_commit 登记内部归档；客户端会在文件卡全部获批后自动执行，不产生第二次审批。不得调用旧式 set_long_ledger_* 工作流。"
        : ""
    ]
      .filter(Boolean)
      .join("\n");
  }
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
  ].filter(Boolean).join("\n");
}

const LONG_PLOT_NAVIGATION_ARC_LIMIT_PER_VOLUME = 50;
const LONG_PLOT_NAVIGATION_CHAPTER_CARD_LIMIT = 50;
const LONG_CHARACTER_DIRECTORY_LIMIT_PER_TYPE = 50;

function renderLongPlotNavigation(
  navigation: LongWorkspaceRuntimeContext["navigation"],
  activeChapterCardId?: string
): string {
  const counts = navigation.counts;
  const header =
    `全书共 ${counts.volumes} 卷、${counts.arcs} 个剧情点、` +
    `${counts.chapterCards} 张章卡、${counts.storyPlots} 条故事情节、` +
    `${counts.storyEvents} 个故事事件、${counts.foreshadowingThreads} 条伏笔线`;
  const volumes = [...navigation.volumes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const volumeOrder = new Map(
    volumes.map((volume) => [volume.id, volume.order])
  );
  const orderedChapters = [...navigation.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  );
  const writtenChapters = orderedChapters.filter((chapter) =>
    chapter.bodyStatus === "written"
  );
  const committedThrough = navigation.committedThroughChapterId
    ? navigation.chapterCards.find(
        (chapter) => chapter.id === navigation.committedThroughChapterId
      )
    : undefined;
  const bodyStatus = `正文进度：已写 ${writtenChapters.length} 章，空白 ${
    orderedChapters.length - writtenChapters.length
  } 章。`;
  const committedStatus = counts.committedChapters
    ? committedThrough
      ? `连续性记录：${counts.committedChapters} 章；最高连续记录位置为「${committedThrough.title}」(${committedThrough.id})。记录只作参考，不锁定正文或结构。`
      : `连续性记录：${counts.committedChapters} 章；尚未形成从第一章开始的连续记录区间。记录只作参考，不锁定正文或结构。`
    : "连续性记录：0 章。记录不会限制正文写作或结构调整。";
  const lines = volumes.map((volume) => {
    const arcs = navigation.arcs
      .filter((arc) => arc.volumeId === volume.id)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      );
    const visible = arcs.slice(0, LONG_PLOT_NAVIGATION_ARC_LIMIT_PER_VOLUME);
    const listing = visible.length
      ? visible.map((arc) => `「${arc.title}」(${arc.id})`).join("、")
      : "暂无剧情点";
    const overflow = arcs.length - visible.length;
    return `- 第 ${volume.order} 卷「${volume.title}」(${volume.id}): ${listing}${
      overflow > 0 ? `；另有 ${overflow} 个剧情点未列出` : ""
    }`;
  });
  const activeChapterIndex = activeChapterCardId
    ? orderedChapters.findIndex((chapter) => chapter.id === activeChapterCardId)
    : -1;
  const maxChapterWindowStart = Math.max(
    0,
    orderedChapters.length - LONG_PLOT_NAVIGATION_CHAPTER_CARD_LIMIT
  );
  const preferredChapterWindowStart =
    activeChapterIndex >= 0
      ? Math.max(
          0,
          activeChapterIndex -
            Math.floor((LONG_PLOT_NAVIGATION_CHAPTER_CARD_LIMIT - 1) / 2)
        )
      : 0;
  const chapterWindowStart = Math.min(
    preferredChapterWindowStart,
    maxChapterWindowStart
  );
  const visibleChapters = orderedChapters.slice(
    chapterWindowStart,
    chapterWindowStart + LONG_PLOT_NAVIGATION_CHAPTER_CARD_LIMIT
  );
  const arcById = new Map(
    navigation.arcs.map((arc) => [arc.id, arc] as const)
  );
  const volumeById = new Map(
    navigation.volumes.map((volume) => [volume.id, volume] as const)
  );
  const chapterLines = visibleChapters.length
    ? visibleChapters.map((chapter, index) => {
        const volume = volumeById.get(chapter.volumeId);
        const primaryArc = chapter.primaryArcId
          ? arcById.get(chapter.primaryArcId)
          : undefined;
        return [
          `${chapterWindowStart + index + 1}. 「${chapter.title}」(${chapter.id})`,
          `分卷=${
            volume
              ? `第 ${volume.order} 卷「${volume.title}」(${volume.id})`
              : chapter.volumeId
          }`,
          `卷内顺序=${chapter.narrativeOrder}`,
          `主剧情点=${
            primaryArc
              ? `「${primaryArc.title}」(${primaryArc.id})`
              : "未关联"
          }`,
          `正文=${chapter.bodyStatus === "written" ? "已写" : "空白"}`,
          chapter.id === activeChapterCardId ? "当前章=是" : ""
        ]
          .filter(Boolean)
          .join("；");
      })
    : ["- 暂无章卡"];
  const chapterWindowEnd = chapterWindowStart + visibleChapters.length;
  const omittedBefore = chapterWindowStart;
  const omittedAfter = orderedChapters.length - chapterWindowEnd;
  const chapterWindowNotice =
    omittedBefore > 0 || omittedAfter > 0
      ? `目录窗口：展示第 ${chapterWindowStart + 1}-${chapterWindowEnd} 张；之前省略 ${omittedBefore} 张，之后省略 ${omittedAfter} 张。需要完整目录时调用 list_chapters 分页查询。`
      : "";
  return [
    header,
    bodyStatus,
    committedStatus,
    "【分卷与剧情点】",
    ...lines,
    `【章卡目录（由早到晚；共 ${orderedChapters.length} 张）】`,
    ...chapterLines,
    chapterWindowNotice
  ]
    .filter(Boolean)
    .join("\n");
}

function renderLongPlotFocus(focus: LongPlotFocusSnapshot): string {
  switch (focus.section) {
    case "book_line":
      return "全书故事线";
    case "foreshadowing":
      return "伏笔总览";
    case "plot_point":
      return focus.arcId
        ? `剧情点「${focus.arcTitle}」(${focus.arcId})，所属分卷「${focus.volumeTitle}」(${focus.volumeId})`
        : `分卷「${focus.volumeTitle}」(${focus.volumeId}) 的剧情点列表，尚未选中具体剧情点`;
    case "chapter_card":
      return focus.chapterCardId
        ? `章卡「${focus.chapterCardTitle}」(${focus.chapterCardId})，所属分卷「${focus.volumeTitle}」(${focus.volumeId})`
        : `分卷「${focus.volumeTitle}」(${focus.volumeId}) 的章卡列表，尚无章卡`;
  }
}

function renderLongWorldbuildingDirectory(
  directory: NonNullable<
    LongWorkspaceRuntimeContext["worldbuildingDirectory"]
  >
): string {
  const lines = directory.categories.flatMap((category) => {
    if (category.format === "text") {
      return [
        `- ${category.title}（category_id=${category.categoryId}；类型=文本）`
      ];
    }
    const header = `- ${category.title}（category_id=${category.categoryId}；类型=条目列表；共 ${category.itemCount} 项）`;
    const items = category.items.length
      ? category.items.map(
          (item) =>
            `  - ${item.title}（item_id=${item.itemId}；顺序=${item.order}）`
        )
      : ["  - 暂无条目"];
    if (category.omittedItemCount > 0) {
      items.push(
        `  - 另有 ${category.omittedItemCount} 项未进入固定上下文，需要时调用 list_setting（domain=worldbuilding）查询。`
      );
    }
    return [header, ...items];
  });
  if (directory.omittedCategoryCount > 0) {
    lines.push(
      `- 另有 ${directory.omittedCategoryCount} 个分类未进入固定上下文，需要时调用 list_setting（domain=worldbuilding）查询。`
    );
  }
  return lines.length ? lines.join("\n") : "- 暂无世界观分类";
}

function renderLongCharacterDirectory(
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const types = [...navigation.characterTypes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const knownTypeIds = new Set(types.map((characterType) => characterType.id));
  const extraGroups = [
    ...new Set(
      navigation.characters
        .map((character) => character.group)
        .filter((group) => !knownTypeIds.has(group))
    )
  ].sort((left, right) => left.localeCompare(right));
  const sections = [
    ...types.map((characterType) => ({
      typeId: characterType.id,
      title: characterType.title
    })),
    ...extraGroups.map((group) => ({
      typeId: group,
      title: group
    }))
  ];
  const lines = sections.flatMap((section) => {
    const characters = navigation.characters
      .filter((character) => character.group === section.typeId)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      );
    const visible = characters.slice(0, LONG_CHARACTER_DIRECTORY_LIMIT_PER_TYPE);
    const header = `- ${section.title}（type_id=${section.typeId}；共 ${characters.length} 人）`;
    const items = visible.length
      ? visible.map(
          (character) =>
            `  - ${character.name}（character_id=${character.id}；顺序=${character.order}）`
        )
      : ["  - 暂无条目"];
    const omitted = characters.length - visible.length;
    if (omitted > 0) {
      items.push(
        `  - 另有 ${omitted} 人未进入固定上下文，需要时调用 list_setting（domain=character, type_id=${section.typeId}）查询。`
      );
    }
    return [header, ...items];
  });
  return lines.length ? lines.join("\n") : "- 暂无人物类型";
}

function renderLongWorldbuildingStageBrief(
  focus: NonNullable<LongWorkspaceRuntimeContext["worldbuildingFocus"]>,
  directory: LongWorkspaceRuntimeContext["worldbuildingDirectory"]
): string {
  const category = directory?.categories.find(
    (entry) => entry.title === focus.categoryTitle
  );
  const categoryId = category?.categoryId;
  const itemId =
    focus.currentStage.kind === "item" && category?.format === "list"
      ? category.items.find((item) => item.title === focus.currentStage.title)
          ?.itemId
      : undefined;
  const ids = [
    categoryId ? `category_id=${categoryId}` : "",
    itemId ? `item_id=${itemId}` : ""
  ]
    .filter(Boolean)
    .join("；");
  const location =
    focus.format === "list"
      ? `列表型分类「${focus.categoryTitle}」${
          focus.currentStage.kind === "item"
            ? ` / 条目「${focus.currentStage.title}」`
            : " / 分类概览"
        }${ids ? `（${ids}）` : ""}`
      : `文本型分类「${focus.categoryTitle}」${
          categoryId ? `（category_id=${categoryId}）` : ""
        }`;
  const readArgs = [
    "domain=worldbuilding",
    categoryId ? `category_id=${categoryId}` : "",
    itemId ? `item_id=${itemId}` : ""
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `当前用户所处的世界观阶段: ${location}`,
    `当前阶段简要信息: 仅定位当前页面，正文未注入；需要时调用 read_setting（${readArgs}）读取。`
  ].join("\n");
}

function renderLongCharacterStageBrief(
  focus: NonNullable<LongWorkspaceRuntimeContext["characterFocus"]>,
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  if (focus.currentDocument.kind === "overview") {
    return [
      "当前用户所处的人物阶段: 人物概览",
      "当前阶段简要信息: 仅定位人物概览，正文未注入；需要时调用 read_setting（domain=character, document=overview）读取。"
    ].join("\n");
  }
  const character = navigation.characters.find(
    (entry) =>
      entry.name === focus.characterName &&
      (focus.group === undefined || entry.group === focus.group)
  );
  const characterId = character?.id;
  const typeId = focus.group ?? character?.group;
  const ids = [
    characterId ? `character_id=${characterId}` : "",
    `document=${focus.currentDocument.kind}`,
    typeId ? `type_id=${typeId}` : ""
  ]
    .filter(Boolean)
    .join("；");
  const readArgs = [
    "domain=character",
    characterId ? `character_id=${characterId}` : "",
    `document=${focus.currentDocument.kind}`
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `当前用户所处的人物阶段: 「${focus.characterName}」 / ${focus.currentDocument.title}${
      ids ? `（${ids}）` : ""
    }`,
    `当前阶段简要信息: 仅定位当前人物文档，正文未注入；需要时调用 read_setting（${readArgs}）读取。`
  ].join("\n");
}

function renderLongCurrentStageSection(
  worldbuildingFocus: LongWorkspaceRuntimeContext["worldbuildingFocus"],
  characterFocus: LongWorkspaceRuntimeContext["characterFocus"],
  longWorkspace: LongWorkspaceRuntimeContext | undefined
): string {
  const parts = [
    worldbuildingFocus
      ? renderLongWorldbuildingStageBrief(
          worldbuildingFocus,
          longWorkspace?.worldbuildingDirectory
        )
      : "",
    characterFocus && longWorkspace
      ? renderLongCharacterStageBrief(characterFocus, longWorkspace.navigation)
      : ""
  ].filter(Boolean);
  return parts.length
    ? `【当前阶段信息与要求】\n${parts.join("\n")}`
    : "";
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
  const isWritingAgentRun = Boolean(
    writingWorkspace && writingProfile
  );
  const isLibraryAgentRun = Boolean(
    libraryContext && input.libraryAgentProfile
  );
  const isSettingAgentRun = Boolean(
    longWorkspace && longProfile?.id === "setting"
  );
  const isPlotDesignAgentRun = Boolean(
    longWorkspace && longProfile?.id === "plot_design"
  );
  const injectsCrossDomainDesignSnapshots = Boolean(
    longWorkspace &&
      longProfile &&
      longAgentAcceptsWorldbuildingDirectory(longProfile.id)
  );
  const omitLongImplementationIds = injectsCrossDomainDesignSnapshots;
  const plotFocus = isPlotDesignAgentRun
    ? longWorkspace?.plotFocus
    : undefined;
  const worldbuildingFocus = isSettingAgentRun
    ? longWorkspace?.worldbuildingFocus
    : undefined;
  const characterFocus = isSettingAgentRun
    ? longWorkspace?.characterFocus
    : undefined;
  const learningContext = input.workspaceContext?.learningImitation;
  const readableSkills = writingProfile
    ? skills.filter(
        (item) =>
          item.kind !== undefined && writingProfile.readAccess.skill.includes(item.kind)
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
          item.kind !== undefined && writingProfile.readAccess.material.includes(item.kind)
      )
    : longProfile
      ? materials.filter(
          (item) =>
            item.kind !== undefined &&
            longProfile.readAccess.materialKinds.includes(item.kind)
        )
      : materials;
  const isLongAgentRun = Boolean(longWorkspace && longProfile);
  const skillContext = isWritingAgentRun || isLibraryAgentRun || isLongAgentRun
    ? readableSkills.length
      ? isLibraryAgentRun
        ? `可按需加载的技能：\n${input.libraryAgentProfile!.readAccess.skills
            .map((skill) => `- ${skill.name}：${skill.description || "无描述"}`)
            .join("\n")}\n需要正文时调用 load_skill；name 可用完整名称或唯一短名。`
        : `可按需加载的技能：\n${readableSkills
            .map((item) => `- ${item.title} [${item.kind}]`)
            .join("\n")}\n需要正文时调用 load_skill；name 优先完整标题，也可用条目标题短名或库名（唯一命中即可）。`
      : "可按需加载的技能: 无"
    : skills.length
      ? `显式附加技能:\n${skills.map((item) => `- ${item.title}: ${item.content}`).join("\n")}`
      : "显式附加技能: 无";
  const materialContext = isWritingAgentRun || isLongAgentRun
    ? readableMaterials.length
      ? `当前读取范围内的关联素材：\n${readableMaterials
          .map((item) => `- ${item.title} [${item.kind}]`)
          .join("\n")}\n需要条目正文时调用 query_linked_material_entries。`
      : "当前读取范围内的关联素材: 无"
    : materials.length
      ? `显式附加素材:\n${materials
          .map((item) => `- ${item.title}: ${item.content}`)
          .join("\n")}`
      : "显式附加素材: 无";
  const lines = [
    "【本次智能体会话固定上下文】",
    omitLongImplementationIds
      ? ""
      : `sessionId: ${input.sessionId}`,
    omitLongImplementationIds
      ? ""
      : `runId: ${input.runId}`,
    writingWorkspace
      ? `${scriptWorkspace ? "剧本" : "短篇"}作品: 《${writingWorkspace.title}》`
      : "",
    longWorkspace ? `长篇作品: 《${longWorkspace.title}》` : "",
    longWorkspace?.agentsMd?.trim()
      ? `【长篇上下文（AGENTS.md）】\n${longWorkspace.agentsMd.trim()}`
      : "",
    injectsCrossDomainDesignSnapshots &&
    longWorkspace?.worldbuildingDirectory
      ? `【世界观条目列表（发送时快照）】\n${renderLongWorldbuildingDirectory(
          longWorkspace.worldbuildingDirectory
        )}`
      : "",
    injectsCrossDomainDesignSnapshots && longWorkspace
      ? `【人物设计列表（发送时快照）】\n${renderLongCharacterDirectory(
          longWorkspace.navigation
        )}\n创建、筛选或移动人物时只能使用目录中的 type_id；人物类型目录只能由用户在结构管理中维护。超出列表的人物调用 list_setting（domain=character）查询。`
      : "",
    injectsCrossDomainDesignSnapshots
      ? `【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】\n${renderLongPlotNavigation(
          longWorkspace!.navigation,
          longWorkspace!.activeChapterCardId
        )}`
      : "",
    plotFocus ? `当前剧情工作区: ${renderLongPlotFocus(plotFocus)}` : "",
    renderLongCurrentStageSection(
      worldbuildingFocus,
      characterFocus,
      longWorkspace
    ),
    longWorkspace && !isSettingAgentRun
      ? `长篇项目: ${longWorkspace.bookId}；结构版本 ${longWorkspace.workspaceRevision}；项目版本 ${longWorkspace.projectRevision}`
      : "",
    longWorkspace && !omitLongImplementationIds
      ? `当前根节点: ${longWorkspace.activeRoot}；当前智能体: ${longWorkspace.activeAgentId}`
      : "",
    longWorkspace?.activeChapterCardId &&
    !isSettingAgentRun
      ? `当前章卡: ${longWorkspace.activeChapterCardId}`
      : "",
    longWorkspace?.activeFileId &&
    !omitLongImplementationIds
      ? `当前文件: ${longWorkspace.activeFileId} (${longWorkspace.activeFileRevision})`
      : "",
    writingWorkspace
      ? `作品分类: ${writingWorkspace.categories.join("、") || "未分类"}`
      : "",
    writingWorkspace
      ? `当前阶段: ${writingWorkspace.activeStageId}`
      : "",
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
    writingWorkspace?.expertDraft.sections.length
      ? `正文目录${scriptWorkspace ? "剧集" : "小节"}（由早到晚）: ${writingWorkspace.expertDraft.sections
          .map((section) => `${section.title} (${section.id})`)
          .join("、")}`
      : "",
    writingProfile
      ? `当前智能体: ${writingProfile.label} (${writingProfile.id})`
      : longProfile
        ? isSettingAgentRun
          ? `当前智能体: ${longProfile.label}`
          : `当前智能体: ${longProfile.label} (${longProfile.id})`
      : input.libraryAgentProfile
        ? `当前智能体: ${input.libraryAgentProfile.label} (${input.libraryAgentProfile.domain})`
      : input.learningImitationProfile
        ? `当前智能体: ${input.learningImitationProfile.label} (${input.learningImitationProfile.id})`
      : "",
    learningContext
      ? `学习阶段: ${learningContext.stageId}；样本文档: ${learningContext.documents.length} 篇`
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
        : "当前资源: 未提供",
    active && !omitLongImplementationIds
      ? `资源路径: ${active.path.join(" / ")}`
      : "",
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

function buildRawUserText(input: AgentRunInput): string {
  const attachments = input.attachments ?? [];
  const textAttachments = attachments.filter(
    (attachment) => attachment.kind === "text"
  );
  const imageAttachments = attachments.filter(
    (attachment) => attachment.kind === "image"
  );
  const lines = [input.prompt];
  if (textAttachments.length) {
    lines.push("", "【用户上传的文本附件】");
    for (const attachment of textAttachments) {
      lines.push(
        "",
        `--- ${attachment.name} (${attachment.mediaType}) ---`,
        attachment.content,
        attachment.truncated
          ? `[DeepWrite：附件文本已截断；原文 ${attachment.originalLength?.toLocaleString("zh-CN") ?? "超过限制"} 个字符。]`
          : ""
      );
    }
  }
  if (imageAttachments.length) {
    lines.push(
      "",
      `【用户上传的图片】${imageAttachments.map((attachment) => attachment.name).join("、")}`
    );
  }
  return lines.filter((line) => line !== "").join("\n");
}

export function longAgentRefreshesDesignContextOnLaterTurns(
  agentId: LongAgentProfile["id"] | undefined
): boolean {
  return agentId === "plot_design" || agentId === "draft";
}

function buildLongFollowUpTurnUserPrompt(input: AgentRunInput): string {
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const agentId = input.longAgentProfile?.id;
  if (
    !longWorkspace ||
    !longAgentRefreshesDesignContextOnLaterTurns(agentId)
  ) {
    return buildRawUserText(input);
  }
  const plotFocus =
    agentId === "plot_design" ? longWorkspace.plotFocus : undefined;
  const lines = [
    agentId === "plot_design"
      ? "【本轮剧情工作区上下文】"
      : "【本轮写手工作区上下文】",
    `长篇作品: 《${longWorkspace.title}》`,
    longWorkspace.agentsMd?.trim()
      ? `【长篇上下文（AGENTS.md）】\n${longWorkspace.agentsMd.trim()}`
      : "",
    `结构版本 ${longWorkspace.workspaceRevision}；项目版本 ${longWorkspace.projectRevision}`,
    longWorkspace.activeChapterCardId
      ? `当前章卡: ${longWorkspace.activeChapterCardId}`
      : "",
    `【长篇结构导航（本轮发送时快照；条目正文与最新修订请通过工具读取）】\n${renderLongPlotNavigation(
      longWorkspace.navigation,
      longWorkspace.activeChapterCardId
    )}`,
    agentId === "plot_design"
      ? plotFocus
        ? `当前剧情工作区: ${renderLongPlotFocus(plotFocus)}`
        : "当前剧情工作区: 剧情设计根节点（未定位具体页面）"
      : "",
    "",
    "【用户消息与上传附件】",
    buildRawUserText(input)
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function imageContentBlocks(input: AgentRunInput): Array<{
  type: "image";
  data: string;
  mimeType: string;
}> {
  return (input.attachments ?? []).flatMap((attachment) =>
    attachment.kind === "image"
      ? [{ type: "image" as const, data: attachment.data, mimeType: attachment.mediaType }]
      : []
  );
}

export function buildRuntimeUserMessageContent(input: AgentRunInput): UserMessage["content"] {
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
export function buildRawUserMessage(input: AgentRunInput, timestamp = Date.now()): UserMessage {
  const text = buildRawUserText(input);
  const images = imageContentBlocks(input);
  return {
    role: "user",
    content: images.length ? [{ type: "text", text }, ...images] : text,
    timestamp
  };
}
