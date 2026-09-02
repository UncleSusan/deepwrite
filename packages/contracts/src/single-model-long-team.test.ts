import { describe, expect, it } from "vitest";
import { LongAgentTeamSettingsInputSchema } from "./long-agent-team";
import {
  SINGLE_MODEL_LONG_ROLE_PRESETS,
  createSingleModelLongTeamSettings,
  isSingleModelLongTeam
} from "./single-model-long-team";

describe("single-model long team preset", () => {
  it("creates five isolated roles bound to one model with exact temperatures", () => {
    const settings = createSingleModelLongTeamSettings("autodl-qwen");
    expect(LongAgentTeamSettingsInputSchema.safeParse(settings).success).toBe(
      true
    );
    const roles = settings.teams[0]!.subagents;
    expect(roles.map(({ name }) => name)).toEqual([
      "主编",
      "拆书分析",
      "正文写作",
      "文风写作",
      "审计终审"
    ]);
    expect(roles.map(({ modelId }) => modelId)).toEqual(
      Array.from({ length: 5 }, () => "autodl-qwen")
    );
    expect(roles.map(({ temperature }) => temperature)).toEqual([
      0.4, 0.3, 0.8, 0.75, 0.25
    ]);
    expect(new Set(roles.map(({ systemPrompt }) => systemPrompt)).size).toBe(5);
    expect(isSingleModelLongTeam(roles)).toBe(true);
  });

  it("keeps context sizes as recommendations instead of runtime fields", () => {
    expect(
      SINGLE_MODEL_LONG_ROLE_PRESETS.map(
        ({ contextRecommendation }) => contextRecommendation
      )
    ).toEqual(["32K～64K", "32K", "16K～32K", "16K～32K", "32K～64K"]);
    expect(
      createSingleModelLongTeamSettings("autodl-qwen").teams[0]!.subagents[0]
    ).not.toHaveProperty("contextWindow");
  });
});
