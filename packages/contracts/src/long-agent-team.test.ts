import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsSchema,
  createEnvelope
} from "./index";

describe("long agent team contracts", () => {
  it("defines the single long parent team without widening WorkspaceType", () => {
    const settings = LongAgentTeamSettingsSchema.parse(
      DEFAULT_LONG_AGENT_TEAM_SETTINGS
    );
    expect(settings.workspaceType).toBe("long");
    expect(settings.teams).toHaveLength(1);
    expect(settings.teams[0]!.parentAgentId).toBe("long");
  });

  it("rejects team lists that do not hold exactly the long parent role", () => {
    const extra = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    extra.teams.push(structuredClone(extra.teams[0]!));
    expect(() => LongAgentTeamSettingsSchema.parse(extra)).toThrow();

    const empty = { ...DEFAULT_LONG_AGENT_TEAM_SETTINGS, teams: [] };
    expect(() => LongAgentTeamSettingsSchema.parse(empty)).toThrow();
  });

  it("validates independent list and save commands", () => {
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "longAgentTeams.list",
          {},
          {
            id: "cmd_long_agent_teams_list"
          }
        )
      ).type
    ).toBe("longAgentTeams.list");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "longAgentTeams.save",
          DEFAULT_LONG_AGENT_TEAM_SETTINGS,
          {
            id: "cmd_long_agent_teams_save"
          }
        )
      ).type
    ).toBe("longAgentTeams.save");
  });
});
