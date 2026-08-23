import type {
  BuiltInReasoningLevel,
  WorkspaceAgentId
} from "@deepwrite/contracts";

export interface ParentAgentMeta {
  id: WorkspaceAgentId;
  label: string;
  description: string;
}

export const PARENT_AGENTS = [
  {
    id: "character_design",
    label: "人设",
    description: "为人物设计主智能体配置研究、审阅和设定补全助手。"
  },
  {
    id: "plot_design",
    label: "剧情",
    description: "为剧情主智能体配置结构、因果和钩子等专项助手。"
  },
  {
    id: "expert_draft_coordinator",
    label: "正文",
    description: "为正文总控配置审阅、润色和一致性检查助手。"
  }
] as const satisfies readonly ParentAgentMeta[];

export const BUILT_IN_THINKING_LABELS: Record<BuiltInReasoningLevel, string> = {
  minimal: "最低",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "极高",
  max: "最高"
};
