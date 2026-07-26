import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_SETTINGS,
  CommandEnvelopeSchema,
  LongAgentSettingsInputSchema,
  LongAgentSettingsSchema,
  createEnvelope,
  getDefaultLongAgentProfile
} from "./index";

function editableDefaults() {
  return {
    workspaceType: "long" as const,
    agents: DEFAULT_LONG_AGENT_SETTINGS.agents.map((agent) => ({
      id: agent.id,
      systemPrompt: agent.systemPrompt,
      welcomeShortcuts: [...agent.welcomeShortcuts] as [
        string,
        string,
        string
      ],
      readAccess: {
        workspaceRoots: [...agent.readAccess.workspaceRoots],
        materialKinds: [...agent.readAccess.materialKinds],
        skillKinds: [...agent.readAccess.skillKinds]
      }
    }))
  };
}

describe("long agent settings contracts", () => {
  it("keeps long settings separate from short and script settings", () => {
    expect(
      LongAgentSettingsSchema.parse(DEFAULT_LONG_AGENT_SETTINGS).workspaceType
    ).toBe("long");
    expect(DEFAULT_LONG_AGENT_SETTINGS.agents).toHaveLength(6);
  });

  it("allows prompts, shortcuts and optional read roots to be customized", () => {
    const input = editableDefaults();
    const agent = input.agents.find(({ id }) => id === "worldbuilding")!;
    agent.systemPrompt = "先核对世界规则，再提出最小修改。";
    agent.welcomeShortcuts[0] = "检查当前世界规则";
    agent.readAccess.workspaceRoots.push("draft");

    expect(LongAgentSettingsInputSchema.parse(input)).toMatchObject({
      workspaceType: "long",
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "worldbuilding",
          systemPrompt: "先核对世界规则，再提出最小修改。"
        })
      ])
    });
  });

  it("rejects removal of a root needed by immutable write access", () => {
    const input = editableDefaults();
    const agent = input.agents.find(({ id }) => id === "plot_design")!;
    agent.readAccess.workspaceRoots =
      agent.readAccess.workspaceRoots.filter((root) => root !== "plot_design");

    expect(() => LongAgentSettingsInputSchema.parse(input)).toThrow(
      /immutable write root/
    );
  });

  it("rejects public settings that try to widen immutable write access", () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
    const agent = settings.agents.find(({ id }) => id === "worldbuilding")!;
    agent.writeAccess.workspaceRoots.push("draft");
    agent.writeAccess.capabilities.push("write_chapter_files");

    expect(() => LongAgentSettingsSchema.parse(settings)).toThrow(
      /write access is immutable/
    );
    expect(
      getDefaultLongAgentProfile("worldbuilding").writeAccess.workspaceRoots
    ).toEqual(["worldbuilding"]);
  });

  it("requires each of the six long agent ids exactly once", () => {
    const input = editableDefaults();
    input.agents[5] = structuredClone(input.agents[0]!);
    expect(() => LongAgentSettingsInputSchema.parse(input)).toThrow(
      /Duplicate|Missing/
    );
  });

  it("validates independent long agent list, save and reset commands", () => {
    const input = editableDefaults();
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("longAgents.list", {}, { id: "cmd_long_agents_list" })
      ).type
    ).toBe("longAgents.list");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("longAgents.save", input, {
          id: "cmd_long_agents_save"
        })
      ).type
    ).toBe("longAgents.save");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "longAgents.reset",
          { agentId: "continuity_ledger" },
          { id: "cmd_long_agents_reset" }
        )
      ).type
    ).toBe("longAgents.reset");
  });
});
