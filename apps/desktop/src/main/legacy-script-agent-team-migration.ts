import {
  SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  ScriptAgentSubagentDefinitionSchema,
  ScriptAgentTeamSettingsInputSchema,
  type ScriptAgentSubagentDefinition,
  type ScriptAgentTeamSettings
} from "@deepwrite/contracts";

const LEGACY_SCRIPT_PARENT_LABELS = {
  character_design: "人物",
  plot_design: "剧情",
  expert_draft_coordinator: "正文",
  script: "剧本"
} as const;

const LEGACY_STAGE_TEAM_MAX_COUNT = 20;

type LegacyScriptParentId = keyof typeof LEGACY_SCRIPT_PARENT_LABELS;

interface DefinitionWithParent {
  definition: ScriptAgentSubagentDefinition;
  parentAgentId: LegacyScriptParentId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLegacyParentId(value: unknown): value is LegacyScriptParentId {
  return typeof value === "string" && value in LEGACY_SCRIPT_PARENT_LABELS;
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
    raw.workspaceType !== "script" ||
    !Array.isArray(raw.teams) ||
    raw.teams.length !== 3
  ) {
    return undefined;
  }
  const byParent = new Map<LegacyScriptParentId, DefinitionWithParent[]>();
  for (const team of raw.teams) {
    if (!isRecord(team) || !isLegacyParentId(team.parentAgentId)) {
      return undefined;
    }
    if (
      team.parentAgentId === "script" ||
      byParent.has(team.parentAgentId) ||
      !Array.isArray(team.subagents) ||
      team.subagents.length > LEGACY_STAGE_TEAM_MAX_COUNT
    ) {
      return undefined;
    }
    const definitions: DefinitionWithParent[] = [];
    for (const candidate of team.subagents) {
      const parsed = ScriptAgentSubagentDefinitionSchema.safeParse(candidate);
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
    ...(byParent.get("expert_draft_coordinator") ?? [])
  ];
}

function makeUnique(
  entries: readonly DefinitionWithParent[]
): ScriptAgentSubagentDefinition[] {
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
      `（${LEGACY_SCRIPT_PARENT_LABELS[parentAgentId]}）`,
      SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
      usedNames
    )
  }));
}

export function migrateLegacyScriptAgentTeamSettings(
  raw: Record<string, unknown>
): ScriptAgentTeamSettings | undefined {
  const current = ScriptAgentTeamSettingsInputSchema.safeParse(raw);
  if (current.success) return current.data;
  const definitions = collectDefinitions(raw);
  if (!definitions) return undefined;
  const migrated = ScriptAgentTeamSettingsInputSchema.safeParse({
    workspaceType: "script",
    teams: [{ parentAgentId: "script", subagents: makeUnique(definitions) }]
  });
  return migrated.success ? migrated.data : undefined;
}
