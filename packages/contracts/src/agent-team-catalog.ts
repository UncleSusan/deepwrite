import { z } from "zod";
import {
  AgentTeamSettingsSchema,
  ScriptAgentTeamSettingsSchema,
  WorkspaceAgentTeamSettingsInputSchema
} from "./agent-team";
import { EnvelopeBaseSchema } from "./envelope";
import { LongAgentTeamSettingsSchema } from "./long-agent-team";

export const AGENT_TEAM_PROFILE_NAME_MAX_LENGTH = 80;

export const AgentTeamWorkspaceTypeSchema = z.enum(["short", "script", "long"]);
export type AgentTeamWorkspaceType = z.infer<
  typeof AgentTeamWorkspaceTypeSchema
>;

export const AgentTeamProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const AgentTeamProfileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_TEAM_PROFILE_NAME_MAX_LENGTH);

const AgentTeamProfileBaseSchema = z.object({
  id: AgentTeamProfileIdSchema,
  name: AgentTeamProfileNameSchema
});

export const AgentTeamProfileSchema = z.discriminatedUnion("workspaceType", [
  AgentTeamProfileBaseSchema.extend({
    workspaceType: z.literal("short"),
    settings: AgentTeamSettingsSchema
  }).strict(),
  AgentTeamProfileBaseSchema.extend({
    workspaceType: z.literal("script"),
    settings: ScriptAgentTeamSettingsSchema
  }).strict(),
  AgentTeamProfileBaseSchema.extend({
    workspaceType: z.literal("long"),
    settings: LongAgentTeamSettingsSchema
  }).strict()
]);
export type AgentTeamProfile = z.infer<typeof AgentTeamProfileSchema>;

export const EnabledAgentTeamIdsSchema = z
  .object({
    short: AgentTeamProfileIdSchema.optional(),
    script: AgentTeamProfileIdSchema.optional(),
    long: AgentTeamProfileIdSchema.optional()
  })
  .strict();
export type EnabledAgentTeamIds = z.infer<typeof EnabledAgentTeamIdsSchema>;

export const AgentTeamCatalogSnapshotSchema = z
  .object({
    enabledTeamIds: EnabledAgentTeamIdsSchema,
    teams: z.array(AgentTeamProfileSchema).min(1)
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [index, team] of value.teams.entries()) {
      if (ids.has(team.id)) {
        context.addIssue({
          code: "custom",
          path: ["teams", index, "id"],
          message: `Duplicate agent team id: ${team.id}`
        });
      }
      ids.add(team.id);
      const normalizedName = team.name.toLocaleLowerCase();
      if (names.has(normalizedName)) {
        context.addIssue({
          code: "custom",
          path: ["teams", index, "name"],
          message: `Duplicate agent team name: ${team.name}`
        });
      }
      names.add(normalizedName);
    }
    for (const workspaceType of AgentTeamWorkspaceTypeSchema.options) {
      const enabledId = value.enabledTeamIds[workspaceType];
      if (!enabledId) continue;
      const enabledTeam = value.teams.find((team) => team.id === enabledId);
      if (!enabledTeam || enabledTeam.workspaceType !== workspaceType) {
        context.addIssue({
          code: "custom",
          path: ["enabledTeamIds", workspaceType],
          message: `Enabled ${workspaceType} agent team does not exist.`
        });
      }
    }
  });
export type AgentTeamCatalogSnapshot = z.infer<
  typeof AgentTeamCatalogSnapshotSchema
>;

export const AgentTeamProfileCreateInputSchema = z
  .object({
    name: AgentTeamProfileNameSchema,
    workspaceType: AgentTeamWorkspaceTypeSchema
  })
  .strict();
export type AgentTeamProfileCreateInput = z.infer<
  typeof AgentTeamProfileCreateInputSchema
>;

export const AgentTeamProfileRenameInputSchema = z
  .object({
    teamId: AgentTeamProfileIdSchema,
    name: AgentTeamProfileNameSchema
  })
  .strict();
export type AgentTeamProfileRenameInput = z.infer<
  typeof AgentTeamProfileRenameInputSchema
>;

export const AgentTeamProfileTargetInputSchema = z
  .object({ teamId: AgentTeamProfileIdSchema })
  .strict();
export type AgentTeamProfileTargetInput = z.infer<
  typeof AgentTeamProfileTargetInputSchema
>;

export const AgentTeamProfileSetEnabledInputSchema = z
  .object({
    teamId: AgentTeamProfileIdSchema,
    enabled: z.boolean()
  })
  .strict();
export type AgentTeamProfileSetEnabledInput = z.infer<
  typeof AgentTeamProfileSetEnabledInputSchema
>;

export const AgentTeamProfileSaveInputSchema = z
  .object({
    teamId: AgentTeamProfileIdSchema,
    settings: z.discriminatedUnion("workspaceType", [
      ...WorkspaceAgentTeamSettingsInputSchema.options,
      LongAgentTeamSettingsSchema
    ])
  })
  .strict();
export type AgentTeamProfileSaveInput = z.infer<
  typeof AgentTeamProfileSaveInputSchema
>;

export const AgentTeamsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agentTeams.list"),
  payload: z.object({}).strict()
});
export const AgentTeamsCreateCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agentTeams.create"),
  payload: AgentTeamProfileCreateInputSchema
});
export const AgentTeamsRenameCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agentTeams.rename"),
  payload: AgentTeamProfileRenameInputSchema
});
export const AgentTeamsDeleteCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agentTeams.delete"),
  payload: AgentTeamProfileTargetInputSchema
});
export const AgentTeamsSetEnabledCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.setEnabled"),
    payload: AgentTeamProfileSetEnabledInputSchema
  });
export const AgentTeamsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agentTeams.save"),
  payload: AgentTeamProfileSaveInputSchema
});
