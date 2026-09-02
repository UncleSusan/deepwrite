import {
  DEFAULT_LONG_AGENT_PROFILES,
  createSingleModelLongTeamSettings,
  type LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { buildEffectiveSystemPrompt } from "./prompts";

describe("single-model long-team orchestration prompt", () => {
  it("requires staged evidence and an adversarial audit only for the preset", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES[0]!;
    const workspace = {} as LongWorkspaceRuntimeContext;
    const roles =
      createSingleModelLongTeamSettings("autodl-qwen").teams[0]!.subagents;
    const prompt = buildEffectiveSystemPrompt("base", {
      runId: "run-single-model-team",
      sessionId: "session-single-model-team",
      prompt: "规划并写一章",
      longAgentProfile: profile,
      subagentDefinitions: roles,
      workspaceContext: { longWorkspace: workspace }
    });

    expect(prompt).toContain("【单模型多角色长篇编排约束】");
    expect(prompt).toContain("全新子会话");
    expect(prompt).toContain("分卷归并和全书摘要归并");
    expect(prompt).toContain("审计终审做反方复核");
    expect(prompt).toContain("再由主编裁决冲突");
  });
});
