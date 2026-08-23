import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileIdSchema,
  AgentTeamProfileNameSchema,
  AgentTeamSettingsInputSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsInputSchema,
  SCRIPT_WORKSPACE_AGENT_IDS,
  SHORT_WORKSPACE_AGENT_IDS,
  ScriptAgentTeamSettingsInputSchema,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile,
  type AgentTeamProfileSaveInput,
  type AgentTeamWorkspaceType
} from "@deepwrite/contracts";

export const AGENT_TEAM_CATALOG_DISK_VERSION = 2 as const;
const LEGACY_LONG_DISK_VERSION = 2;

export interface AgentTeamDiskCatalog extends AgentTeamCatalogSnapshot {
  version: typeof AGENT_TEAM_CATALOG_DISK_VERSION;
}

export interface LegacyAgentTeamPaths {
  short: string;
  script: string;
  long: string;
}

function createTeamId(): string {
  return `team_${randomUUID().replaceAll("-", "")}`;
}

function defaultName(workspaceType: AgentTeamWorkspaceType): string {
  return workspaceType === "short"
    ? "默认短篇团队"
    : workspaceType === "script"
      ? "默认剧本团队"
      : "默认长篇团队";
}

export function createAgentTeamProfile(
  workspaceType: AgentTeamWorkspaceType,
  name = defaultName(workspaceType),
  settings?: AgentTeamProfileSaveInput["settings"]
): AgentTeamProfile {
  const base = { id: createTeamId(), name };
  if (workspaceType === "short") {
    return {
      ...base,
      workspaceType,
      settings: structuredClone(
        settings?.workspaceType === "short"
          ? settings
          : DEFAULT_AGENT_TEAM_SETTINGS
      )
    };
  }
  if (workspaceType === "script") {
    return {
      ...base,
      workspaceType,
      settings: structuredClone(
        settings?.workspaceType === "script"
          ? settings
          : DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
      )
    };
  }
  return {
    ...base,
    workspaceType,
    settings: structuredClone(
      settings?.workspaceType === "long"
        ? settings
        : DEFAULT_LONG_AGENT_TEAM_SETTINGS
    )
  };
}

export async function readAgentTeamJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function atomicWriteAgentTeamJson(
  path: string,
  value: unknown
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

export function invalidAgentTeamConfig(issue?: {
  path: PropertyKey[];
  message: string;
}): Error {
  return new Error(
    `智能体团队配置内容无效，已停止加载以避免覆盖原文件${
      issue ? `：${issue.path.join(".") || "root"} ${issue.message}` : "。"
    }`
  );
}

function normalizeLegacyWorkspace(
  raw: unknown,
  workspaceType: "short" | "script"
): unknown {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    raw.version !== 1
  ) {
    throw new Error("智能体团队配置版本无效，已停止加载以避免覆盖原文件。");
  }
  const allowed =
    workspaceType === "script"
      ? SCRIPT_WORKSPACE_AGENT_IDS
      : SHORT_WORKSPACE_AGENT_IDS;
  return {
    ...(raw as Record<string, unknown>),
    teams: Array.isArray((raw as Record<string, unknown>).teams)
      ? ((raw as Record<string, unknown>).teams as unknown[]).filter(
          (team) =>
            team !== null &&
            typeof team === "object" &&
            allowed.includes(
              (team as { parentAgentId?: never }).parentAgentId as never
            )
        )
      : (raw as Record<string, unknown>).teams
  };
}

export async function createCatalogFromLegacyFiles(
  paths: LegacyAgentTeamPaths
): Promise<AgentTeamCatalogSnapshot> {
  const [shortRaw, scriptRaw, longRaw] = await Promise.all([
    readAgentTeamJson(paths.short),
    readAgentTeamJson(paths.script),
    readAgentTeamJson(paths.long)
  ]);
  const short = createAgentTeamProfile("short");
  const script = createAgentTeamProfile("script");
  const long = createAgentTeamProfile("long");
  if (short.workspaceType !== "short" || script.workspaceType !== "script") {
    throw invalidAgentTeamConfig();
  }
  if (long.workspaceType !== "long") throw invalidAgentTeamConfig();

  if (shortRaw !== undefined) {
    const parsed = AgentTeamSettingsInputSchema.safeParse(
      normalizeLegacyWorkspace(shortRaw, "short")
    );
    if (!parsed.success) throw invalidAgentTeamConfig(parsed.error.issues[0]);
    short.settings = parsed.data;
  }
  if (scriptRaw !== undefined) {
    const parsed = ScriptAgentTeamSettingsInputSchema.safeParse(
      normalizeLegacyWorkspace(scriptRaw, "script")
    );
    if (!parsed.success) throw invalidAgentTeamConfig(parsed.error.issues[0]);
    script.settings = parsed.data;
  }
  if (longRaw !== undefined) {
    if (!longRaw || typeof longRaw !== "object" || Array.isArray(longRaw)) {
      throw invalidAgentTeamConfig();
    }
    if (
      (longRaw as { version?: unknown }).version !== LEGACY_LONG_DISK_VERSION
    ) {
      throw new Error("智能体团队配置版本无效，已停止加载以避免覆盖原文件。");
    }
    const { version: _version, ...settings } = longRaw as Record<
      string,
      unknown
    >;
    const parsed = LongAgentTeamSettingsInputSchema.safeParse(settings);
    if (!parsed.success) throw invalidAgentTeamConfig(parsed.error.issues[0]);
    long.settings = parsed.data;
  }
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: {
      ...(shortRaw === undefined ? {} : { short: short.id }),
      ...(scriptRaw === undefined ? {} : { script: script.id }),
      ...(longRaw === undefined ? {} : { long: long.id })
    },
    teams: [short, script, long]
  });
}

export function migrateVersionOneCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot {
  const active = AgentTeamProfileIdSchema.safeParse(raw.activeTeamId);
  if (!active.success || !Array.isArray(raw.teams) || raw.teams.length === 0) {
    throw invalidAgentTeamConfig(
      active.success ? undefined : active.error.issues[0]
    );
  }
  const teams: AgentTeamProfile[] = [];
  const enabledTeamIds: AgentTeamCatalogSnapshot["enabledTeamIds"] = {};
  for (const candidate of raw.teams) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw invalidAgentTeamConfig();
    }
    const legacy = candidate as Record<string, unknown>;
    const id = AgentTeamProfileIdSchema.safeParse(legacy.id);
    const name = AgentTeamProfileNameSchema.safeParse(legacy.name);
    const short = AgentTeamSettingsInputSchema.safeParse(legacy.shortSettings);
    const script = ScriptAgentTeamSettingsInputSchema.safeParse(
      legacy.scriptSettings
    );
    const long = LongAgentTeamSettingsInputSchema.safeParse(
      legacy.longSettings
    );
    if (
      !id.success ||
      !name.success ||
      !short.success ||
      !script.success ||
      !long.success
    ) {
      throw invalidAgentTeamConfig();
    }
    const names =
      raw.teams.length === 1 && name.data === "默认团队"
        ? [defaultName("short"), defaultName("script"), defaultName("long")]
        : [`${name.data} · 短篇`, `${name.data} · 剧本`, `${name.data} · 长篇`];
    const split = [
      createAgentTeamProfile("short", names[0], short.data),
      createAgentTeamProfile("script", names[1], script.data),
      createAgentTeamProfile("long", names[2], long.data)
    ];
    teams.push(...split);
    if (id.data === active.data) {
      enabledTeamIds.short = split[0]!.id;
      enabledTeamIds.script = split[1]!.id;
      enabledTeamIds.long = split[2]!.id;
    }
  }
  return AgentTeamCatalogSnapshotSchema.parse({ enabledTeamIds, teams });
}
