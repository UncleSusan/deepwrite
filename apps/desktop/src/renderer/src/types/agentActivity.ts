import type { AgentConversationController } from "../composables/useAgentConversation";

export type AgentActivityStatus = "running" | "completed" | "error" | "stopped";

export interface AgentActivityDescriptor {
  conversationKey: string;
  agentLabel: string;
  contextLabel: string;
  targetResourceId: string;
}

export interface AgentActivityItem extends AgentActivityDescriptor {
  status: AgentActivityStatus;
  updatedAt: number;
}

export interface CurrentAgentActivityView {
  controller: AgentConversationController;
  agentLabel: string;
  contextLabel: string;
  targetResourceId: string;
}
