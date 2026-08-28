import {
  AgentTeamSettingsInputSchema,
  SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  ShortAgentSubagentDefinitionSchema,
  type AgentTeamSettings,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";

const LEGACY_SHORT_PARENT_LABELS = {
  character_design: "人物",
  plot_design: "剧情",
  expert_draft_coordinator: "正文",
  short: "短篇"
} as const;

const LEGACY_STAGE_TEAM_MAX_COUNT = 20;

type LegacyShortParentId = keyof typeof LEGACY_SHORT_PARENT_LABELS;

interface DefinitionWithParent {
  definition: ShortAgentSubagentDefinition;
  parentAgentId: LegacyShortParentId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLegacyParentId(value: unknown): value is LegacyShortParentId {
  return typeof value === "string" && value in LEGACY_SHORT_PARENT_LABELS;
}

function uniqueValue(
  original: string,
  suffix: string,
  maxLength: number,
  used: Set<string>
): string {
  if (!used.has(original.toLocaleLowerCase())) {
    used.add(original.toLocaleLowerCase());
    return original;
  }
  for (let sequence = 1; ; sequence += 1) {
    const discriminator = sequence === 1 ? suffix : `${suffix}_${sequence}`;
    const prefix = original.slice(
      0,
      Math.max(1, maxLength - discriminator.length)
    );
    const candidate = `${prefix}${discriminator}`;
    const key = candidate.toLocaleLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
  }
}

function collectDefinitions(
  raw: Record<string, unknown>
): DefinitionWithParent[] | undefined {
  if (
    raw.workspaceType !== "short" ||
    !Array.isArray(raw.teams) ||
    raw.teams.length !== 3
  ) {
    return undefined;
  }
  const byParent = new Map<LegacyShortParentId, DefinitionWithParent[]>();
  for (const team of raw.teams) {
    if (!isRecord(team) || !isLegacyParentId(team.parentAgentId)) {
      return undefined;
    }
    if (
      team.parentAgentId === "short" ||
      byParent.has(team.parentAgentId) ||
      !Array.isArray(team.subagents) ||
      team.subagents.length > LEGACY_STAGE_TEAM_MAX_COUNT
    ) {
      return undefined;
    }
    const definitions: DefinitionWithParent[] = [];
    for (const candidate of team.subagents) {
      const parsed = ShortAgentSubagentDefinitionSchema.safeParse(candidate);
      if (!parsed.success) return undefined;
      definitions.push({
        definition: parsed.data,
        parentAgentId: team.parentAgentId
      });
    }
    byParent.set(team.parentAgentId, definitions);
  }
  if (
    !byParent.has("character_design") ||
    !byParent.has("plot_design") ||
    !byParent.has("expert_draft_coordinator")
  ) {
    return undefined;
  }
  return [
    ...(byParent.get("character_design") ?? []),
    ...(byParent.get("plot_design") ?? []),
    ...(byParent.get("expert_draft_coordinator") ?? []),
    ...(byParent.get("short") ?? [])
  ];
}

function makeUnique(
  entries: readonly DefinitionWithParent[]
): ShortAgentSubagentDefinition[] {
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  return entries.map(({ definition, parentAgentId }) => ({
    ...definition,
    id: uniqueValue(
      definition.id,
      `_${parentAgentId}`,
      SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
      usedIds
    ),
    name: uniqueValue(
      definition.name,
      `（${LEGACY_SHORT_PARENT_LABELS[parentAgentId]}）`,
      SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
      usedNames
    )
  }));
}

export function migrateLegacyShortAgentTeamSettings(
  raw: Record<string, unknown>
): AgentTeamSettings | undefined {
  const current = AgentTeamSettingsInputSchema.safeParse(raw);
  if (current.success) return current.data;
  const definitions = collectDefinitions(raw);
  if (!definitions) return undefined;
  const migrated = AgentTeamSettingsInputSchema.safeParse({
    workspaceType: "short",
    teams: [{ parentAgentId: "short", subagents: makeUnique(definitions) }]
  });
  return migrated.success ? migrated.data : undefined;
}
