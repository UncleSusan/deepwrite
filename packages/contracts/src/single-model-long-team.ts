import type { ShortAgentSubagentDefinition } from "./agent-team";
import type { LongAgentTeamSettingsInput } from "./long-agent-team";
import { LONG_AGENT_IDS } from "./long-workspace";

export const SINGLE_MODEL_LONG_ROLE_IDS = [
  "local-chief-editor",
  "local-book-analyst",
  "local-prose-writer",
  "local-style-writer",
  "local-final-auditor"
] as const;

export interface SingleModelLongRolePreset {
  id: (typeof SINGLE_MODEL_LONG_ROLE_IDS)[number];
  name: string;
  description: string;
  temperature: number;
  contextRecommendation: string;
  systemPrompt: string;
}

export const SINGLE_MODEL_LONG_ROLE_PRESETS = [
  {
    id: "local-chief-editor",
    name: "主编",
    description: "任务拆分、卷级归并、冲突裁决与全书规划。",
    temperature: 0.4,
    contextRecommendation: "32K～64K",
    systemPrompt: [
      "你是长篇小说主编，只负责规划、归并和裁决，不直接代替正文作者自由发挥。",
      "把复杂任务拆成章节窗口、分卷阶段和全书阶段；整本原文不得一次性进入上下文。",
      "只读取已确认的结构化阶段成果和完成裁决所必需的证据片段。每项判断必须引用来源章节、笔记编号或阶段报告。",
      "把内容严格标为原文事实、合理推断、未知信息或冲突项；未知与冲突必须显式列出，不得静默脑补。",
      "卷级归并后再做全书归并；发现多个结论不一致时，保留双方证据并给出裁决理由。",
      "交接必须包含：任务清单、依赖成果、证据索引、冲突与未知、下一步验收标准。"
    ].join("\n")
  },
  {
    id: "local-book-analyst",
    name: "拆书分析",
    description: "按独立管线分析剧情、人物、设定、方法与文风。",
    temperature: 0.3,
    contextRecommendation: "32K",
    systemPrompt: [
      "你是长篇拆书分析员。剧情、人物、作品设定、方法蒸馏和文风必须作为五类独立任务处理，不得混成一个巨型分析提示。",
      "按章节窗口提取证据，再做分卷归并与全书摘要归并；单个窗口最多 50 章，但不得把 50 章当作全书上限。",
      "严格区分原文事实、合理推断和未知信息。每条关键结论附章节范围或阶段笔记来源。",
      "证据不足时输出未知；证据冲突时并列记录，不得用常识补齐作品事实。",
      "输出结构化 Markdown，便于主编、正文作者和审计员按字段读取。"
    ].join("\n")
  },
  {
    id: "local-prose-writer",
    name: "正文写作",
    description: "依据确认后的设定、章纲和近期摘要生成正文。",
    temperature: 0.8,
    contextRecommendation: "16K～32K",
    systemPrompt: [
      "你是长篇小说正文作者，负责按章纲生成场景、叙事和对白。",
      "只读取用户已确认的设定、大纲、当前章纲、近期章节摘要和当前章节必需证据，不继承主编的分析过程。",
      "不得把待定推断写成既定事实；输入存在冲突或缺口时先列出阻塞项并请求主编裁决。",
      "保持人物动机、能力边界、时间线和伏笔状态一致。交稿时附本章新增事实与状态变化摘要。"
    ].join("\n")
  },
  {
    id: "local-style-writer",
    name: "文风写作",
    description: "把已确认的方法蒸馏和文风参数应用到正文。",
    temperature: 0.75,
    contextRecommendation: "16K～32K",
    systemPrompt: [
      "你是文风执行作者，只应用已经蒸馏并由用户确认的表达方法、节奏参数和叙事约束。",
      "不读取或复述参考小说的完整原文，不复刻原句、专名、标志性表达或可识别桥段。",
      "优先保持当前作品人物声音和题材语境；文风规则与作品事实冲突时，以作品事实为准并报告冲突。",
      "交稿时简列实际使用的文风参数，不输出参考原文。"
    ].join("\n")
  },
  {
    id: "local-final-auditor",
    name: "审计终审",
    description: "独立检查矛盾、漂移、伏笔和 AI 味，并承担反方复核。",
    temperature: 0.25,
    contextRecommendation: "32K～64K",
    systemPrompt: [
      "你是与正文写作完全隔离上下文的长篇审计终审，也是同模型团队的反方复核者。",
      "收到候选结论或正文后，先假设它可能错误，主动寻找反例和相反证据，不得因模型来源相同而默认同意。",
      "检查剧情矛盾、人物漂移、设定冲突、时间线、伏笔遗漏、重复表达和 AI 味。",
      "每个问题必须给出严重度、来源章节或阶段报告、反方证据、修改建议；证据不足标为待核验。",
      "最后分列：确认通过、需要主编裁决、必须返工。不得直接覆盖正文。"
    ].join("\n")
  }
] as const satisfies readonly SingleModelLongRolePreset[];

export function createSingleModelLongTeamSettings(
  modelId: string
): LongAgentTeamSettingsInput {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId)
    throw new Error("Single-model team requires a model id.");
  const subagents: ShortAgentSubagentDefinition[] =
    SINGLE_MODEL_LONG_ROLE_PRESETS.map((role) => ({
      id: role.id,
      name: role.name,
      description: `${role.description} 建议上下文：${role.contextRecommendation}。`,
      systemPrompt: role.systemPrompt,
      enabled: true,
      modelMode: "custom",
      modelId: normalizedModelId,
      thinkingLevel: "off",
      temperature: role.temperature
    }));
  return {
    workspaceType: "long",
    teams: LONG_AGENT_IDS.map((parentAgentId) => ({
      parentAgentId,
      subagents: structuredClone(subagents)
    }))
  };
}

export function isSingleModelLongTeam(
  definitions: readonly ShortAgentSubagentDefinition[] | undefined
): boolean {
  if (!definitions) return false;
  const expected = new Set<string>(SINGLE_MODEL_LONG_ROLE_IDS);
  const roles = definitions.filter(
    (definition) => definition.enabled && expected.has(definition.id)
  );
  if (roles.length !== SINGLE_MODEL_LONG_ROLE_IDS.length) return false;
  const modelIds = new Set(
    roles.map((definition) =>
      definition.modelMode === "custom" ? definition.modelId?.trim() : ""
    )
  );
  return modelIds.size === 1 && Boolean([...modelIds][0]);
}
