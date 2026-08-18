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
    expect(DEFAULT_LONG_AGENT_SETTINGS.agents).toHaveLength(4);
  });

  it("allows prompts, shortcuts and catalog read types to be customized", () => {
    const input = editableDefaults();
    const agent = input.agents.find(({ id }) => id === "setting")!;
    agent.systemPrompt = "先核对世界规则，再提出最小修改。";
    agent.welcomeShortcuts[0] = "检查当前世界规则";
    agent.readAccess.materialKinds = ["character", "plot"];
    agent.readAccess.skillKinds = ["general", "plot"];

    const parsed = LongAgentSettingsInputSchema.parse(input);
    expect(parsed.workspaceType).toBe("long");
    expect(parsed.agents.find(({ id }) => id === "setting")).toMatchObject({
      id: "setting",
      systemPrompt: "先核对世界规则，再提出最小修改。",
      readAccess: {
        materialKinds: ["character", "plot"],
        skillKinds: ["general", "plot"]
      }
    });
  });

  it("rejects input that narrows the fixed workspace read access", () => {
    const input = editableDefaults();
    input.agents.find(
      ({ id }) => id === "plot_design"
    )!.readAccess.workspaceRoots = ["plot_design"];

    expect(() => LongAgentSettingsInputSchema.parse(input)).toThrow(
      /builtin workspace read access/
    );
  });

  it("allows public catalog scopes but rejects workspace scope changes", () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
    const agent = settings.agents.find(({ id }) => id === "plot_design")!;
    agent.readAccess.materialKinds = ["plot"];
    agent.readAccess.skillKinds = ["general", "plot"];

    expect(LongAgentSettingsSchema.parse(settings)).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "plot_design",
          readAccess: {
            workspaceRoots: expect.any(Array),
            materialKinds: ["plot"],
            skillKinds: ["general", "plot"]
          }
        })
      ])
    });

    agent.readAccess.workspaceRoots = ["plot_design"];

    expect(() => LongAgentSettingsSchema.parse(settings)).toThrow(
      /workspace read access is immutable/
    );
    expect(
      getDefaultLongAgentProfile("plot_design").readAccess.workspaceRoots
    ).toEqual([
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]);
  });

  it("rejects public settings that try to widen immutable write access", () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_SETTINGS);
    const agent = settings.agents.find(({ id }) => id === "setting")!;
    agent.writeAccess.workspaceRoots.push("draft");
    agent.writeAccess.capabilities.push("write_chapter_files");

    expect(() => LongAgentSettingsSchema.parse(settings)).toThrow(
      /write access is immutable/
    );
    expect(
      getDefaultLongAgentProfile("setting").writeAccess.workspaceRoots
    ).toEqual(["worldbuilding", "character_design"]);
  });

  it("requires each of the four long agent ids exactly once", () => {
    const input = editableDefaults();
    input.agents[4] = structuredClone(input.agents[0]!);
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
