import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { tryMigrateCombinedCatalog } from "./agent-team-config-migration";
import { migrateLegacyShortAgentTeamSettings } from "./legacy-short-agent-team-migration";

function definition(
  index: number,
  parent: "character" | "plot" | "draft"
): ShortAgentSubagentDefinition {
  return {
    id: `helper_${index}`,
    name: `助手 ${index}`,
    description: `${parent} 阶段助手`,
    systemPrompt: `处理 ${parent} 阶段任务。`,
    enabled: index % 2 === 0,
    modelMode: "custom",
    modelId: `model-${parent}`,
    thinkingLevel: index === 1 ? "off" : "high",
    ...(index === 1 ? { temperature: 0.7 } : {})
  };
}

function legacySettings(count = 20) {
  return {
    workspaceType: "short",
    teams: [
      {
        parentAgentId: "character_design",
        subagents: Array.from({ length: count }, (_, index) =>
          definition(index + 1, "character")
        )
      },
      {
        parentAgentId: "plot_design",
        subagents: Array.from({ length: count }, (_, index) =>
          definition(index + 1, "plot")
        )
      },
      {
        parentAgentId: "expert_draft_coordinator",
        subagents: Array.from({ length: count }, (_, index) =>
          definition(index + 1, "draft")
        )
      }
    ]
  };
}

describe("legacy short agent team migration", () => {
  it("merges three full teams in stage order without losing runtime fields", () => {
    const migrated = migrateLegacyShortAgentTeamSettings(legacySettings());
    expect(migrated?.teams).toHaveLength(1);
    const definitions = migrated?.teams[0]?.subagents ?? [];
    expect(definitions).toHaveLength(60);
    expect(
      new Set(definitions.map(({ id }) => id.toLocaleLowerCase())).size
    ).toBe(60);
    expect(
      new Set(definitions.map(({ name }) => name.toLocaleLowerCase())).size
    ).toBe(60);
    expect(definitions[0]).toMatchObject({
      id: "helper_1",
      modelId: "model-character",
      thinkingLevel: "off",
      temperature: 0.7,
      enabled: false
    });
    expect(definitions[20]).toMatchObject({
      id: "helper_1_plot_design",
      name: "助手 1（剧情）",
      modelId: "model-plot"
    });
    expect(definitions[40]).toMatchObject({
      id: "helper_1_expert_draft_coordinator",
      name: "助手 1（正文）",
      modelId: "model-draft"
    });
  });

  it("rejects malformed legacy teams instead of manufacturing a replacement", () => {
    expect(
      migrateLegacyShortAgentTeamSettings({
        workspaceType: "short",
        teams: []
      })
    ).toBeUndefined();
    expect(
      migrateLegacyShortAgentTeamSettings(legacySettings(21))
    ).toBeUndefined();
  });

  it("adds an incrementing suffix when the stage suffix is already occupied", () => {
    const raw = legacySettings(0);
    raw.teams[0]!.subagents = [
      { ...definition(1, "character"), id: "helper", name: "助手" },
      {
        ...definition(2, "character"),
        id: "helper_expert_draft_coordinator",
        name: "助手（正文）"
      }
    ];
    raw.teams[2]!.subagents = [
      { ...definition(1, "draft"), id: "HELPER", name: "助手" }
    ];

    const definitions =
      migrateLegacyShortAgentTeamSettings(raw)?.teams[0]?.subagents ?? [];
    expect(definitions[2]).toMatchObject({
      id: "HELPER_expert_draft_coordinator_2",
      name: "助手（正文）_2"
    });
  });

  it("preserves profile identity, name and enabled short profile id", () => {
    const migrated = tryMigrateCombinedCatalog({
      enabledTeamIds: { short: "profile_short" },
      teams: [
        {
          id: "profile_short",
          name: "我的短篇团队",
          workspaceType: "short",
          settings: legacySettings(1)
        },
        {
          id: "profile_script",
          name: "我的剧本团队",
          workspaceType: "script",
          settings: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
        },
        {
          id: "profile_long",
          name: "我的长篇团队",
          workspaceType: "long",
          settings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
        }
      ]
    });
    const short = migrated?.teams.find(
      (team) => team.workspaceType === "short"
    );
    expect(short).toMatchObject({
      id: "profile_short",
      name: "我的短篇团队",
      settings: {
        teams: [{ parentAgentId: "short" }]
      }
    });
    expect(migrated?.enabledTeamIds.short).toBe("profile_short");
  });
});
