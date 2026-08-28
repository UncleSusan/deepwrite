import type {
  BuiltInReasoningLevel,
  WorkspaceAgentId
} from "@deepwrite/contracts";

export interface ParentAgentMeta {
  id: WorkspaceAgentId;
  label: string;
  description: string;
}

export const SHORT_PARENT_AGENT = {
  id: "short",
  label: "短篇智能体",
  description: "为统一短篇智能体配置可在人物、剧情和正文阶段调用的专项助手。"
} as const satisfies ParentAgentMeta;

export const SCRIPT_PARENT_AGENTS = [
  {
    id: "script",
    label: "剧本智能体",
    description: "为统一剧本智能体配置可在人物、剧情和正文阶段调用的专项助手。"
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
