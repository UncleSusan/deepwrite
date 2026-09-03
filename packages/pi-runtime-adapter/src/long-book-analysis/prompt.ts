import type {
  LongBookAnalysisAgentProfile,
  LongBookAnalysisRuntimeContext
} from "@deepwrite/contracts";

function phaseRequirements(context: LongBookAnalysisRuntimeContext): string {
  if (context.phase === "batch") {
    return [
      "当前是分批分析阶段。",
      "先调用 list_analysis_inputs，再通过 read_analysis_input 尽量读完所有章节片段；需要定位时可使用 search_analysis_inputs。",
      "完成后必须且只能调用一次 write_analysis_note，形成结构化、去重、带章节范围依据的中间笔记。",
      "本阶段不要生成正式素材或技能，不要调用未列出的工具。"
    ].join("\n");
  }
  if (context.phase === "reduce") {
    return [
      "当前是中间笔记归并阶段。",
      "必须读取全部输入笔记，合并相同结论、保留差异和章节证据，并压缩重复内容。",
      "归并笔记必须显著短于全部输入；只保留后续总报告必需的结论、证据范围、差异和未知项，控制在约 1200 个 token 以内。",
      "完成后必须且只能调用一次 write_analysis_note。不要生成正式素材或技能。"
    ].join("\n");
  }
  return [
    "当前是最终结果生成阶段。",
    "必须读取全部归并笔记，严格按照预设目标生成一份完整 Markdown 结果。",
    "完成后必须且只能调用一次 write_analysis_result。该工具只写预览区，不能声称已经正式落库。"
  ].join("\n");
}

export function renderLongBookAnalysisSystemPrompt(
  profile: LongBookAnalysisAgentProfile,
  context: LongBookAnalysisRuntimeContext
): string {
  return [
    profile.systemPrompt.trim(),
    "",
    "【DeepWrite 长篇拆书运行边界】",
    `来源：${context.sourceTitle}`,
    `选择范围：第 ${context.selectionStart}-${context.selectionEnd} 章`,
    `预设：${profile.name}`,
    phaseRequirements(context),
    "只能读取本轮工具实际提供的内容；不得访问文件、网络、Shell、其它会话或资料库。"
  ].join("\n");
}
