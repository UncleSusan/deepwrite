import { describe, expect, it } from "vitest";
import source from "./SingleModelLongTeamPreset.vue?raw";

describe("SingleModelLongTeamPreset", () => {
  it("shows same-model reuse, role parameters, and replacement confirmation", () => {
    expect(source).toContain("五个角色复用同一模型");
    expect(source).toContain("SINGLE_MODEL_LONG_ROLE_PRESETS");
    expect(source).toContain("role.temperature");
    expect(source).toContain("role.contextRecommendation");
    expect(source).toContain("反方复核");
    expect(source).toContain("替换现有角色配置？");
    expect(source).toContain("PopupSelect");
  });
});
