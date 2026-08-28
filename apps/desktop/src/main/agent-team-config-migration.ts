import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileIdSchema,
  AgentTeamProfileNameSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsInputSchema,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile,
  type AgentTeamProfileSaveInput,
  type AgentTeamWorkspaceType,
  type LongAgentTeamSettings
} from "@deepwrite/contracts";
import { migrateLegacyLongAgentTeamSettings } from "./legacy-long-agent-team-migration";
import { migrateLegacyScriptAgentTeamSettings } from "./legacy-script-agent-team-migration";
import { migrateLegacyShortAgentTeamSettings } from "./legacy-short-agent-team-migration";

export const AGENT_TEAM_CATALOG_DISK_VERSION = 4 as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (short.workspaceType !== "short" || script.workspaceType !== "script") {
    throw invalidAgentTeamConfig();
  }

  if (shortRaw !== undefined) {
    if (!shortRaw || typeof shortRaw !== "object" || Array.isArray(shortRaw)) {
      throw invalidAgentTeamConfig();
    }
    const { version: _version, ...settings } = shortRaw as Record<
      string,
      unknown
    >;
    const migrated = migrateLegacyShortAgentTeamSettings(settings);
    if (!migrated) throw invalidAgentTeamConfig();
    short.settings = migrated;
  }
  if (scriptRaw !== undefined) {
    if (
      !scriptRaw ||
      typeof scriptRaw !== "object" ||
      Array.isArray(scriptRaw)
    ) {
      throw invalidAgentTeamConfig();
    }
    const { version: _version, ...settings } = scriptRaw as Record<
      string,
      unknown
    >;
    const migrated = migrateLegacyScriptAgentTeamSettings(settings);
    if (!migrated) throw invalidAgentTeamConfig();
    script.settings = migrated;
  }
  let longProfiles = [createAgentTeamProfile("long")];
  if (longRaw !== undefined) {
    if (!longRaw || typeof longRaw !== "object" || Array.isArray(longRaw)) {
      throw invalidAgentTeamConfig();
    }
    const { version: _version, ...settings } = longRaw as Record<
      string,
      unknown
    >;
    const migrated = migrateLegacyLongAgentTeamSettings(settings);
    if (!migrated) {
      const parsed = LongAgentTeamSettingsInputSchema.safeParse(settings);
      throw invalidAgentTeamConfig(
        parsed.success ? undefined : parsed.error.issues[0]
      );
    }
    longProfiles = migrated.map((longSettings, index) =>
      createAgentTeamProfile(
        "long",
        index === 0 ? defaultName("long") : `迁移长篇团队 ${index + 1}`,
        longSettings
      )
    );
  }
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: {
      ...(shortRaw === undefined ? {} : { short: short.id }),
      ...(scriptRaw === undefined ? {} : { script: script.id }),
      ...(longRaw === undefined ? {} : { long: longProfiles[0]!.id })
    },
    teams: [short, script, ...longProfiles]
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
    const short = isRecord(legacy.shortSettings)
      ? migrateLegacyShortAgentTeamSettings(legacy.shortSettings)
      : undefined;
    const script = isRecord(legacy.scriptSettings)
      ? migrateLegacyScriptAgentTeamSettings(legacy.scriptSettings)
      : undefined;
    const long = LongAgentTeamSettingsInputSchema.safeParse(
      legacy.longSettings
    );
    if (!id.success || !name.success || !short || !script || !long.success) {
      throw invalidAgentTeamConfig();
    }
    const names =
      raw.teams.length === 1 && name.data === "默认团队"
        ? [defaultName("short"), defaultName("script"), defaultName("long")]
        : [`${name.data} · 短篇`, `${name.data} · 剧本`, `${name.data} · 长篇`];
    const split = [
      createAgentTeamProfile("short", names[0], short),
      createAgentTeamProfile("script", names[1], script),
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

function migrateProfileCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot | undefined {
  if (!isRecord(raw.enabledTeamIds) || !Array.isArray(raw.teams)) {
    return undefined;
  }
  const teams: AgentTeamProfile[] = [];
  const usedNames = new Set<string>();
  for (const candidate of raw.teams) {
    if (!isRecord(candidate) || !isRecord(candidate.settings)) {
      return undefined;
    }
    const id = AgentTeamProfileIdSchema.safeParse(candidate.id);
    const name = AgentTeamProfileNameSchema.safeParse(candidate.name);
    if (!id.success || !name.success) return undefined;
    usedNames.add(name.data.toLocaleLowerCase());
    if (candidate.workspaceType === "short") {
      const settings = migrateLegacyShortAgentTeamSettings(candidate.settings);
      if (!settings) return undefined;
      teams.push({
        id: id.data,
        name: name.data,
        workspaceType: "short",
        settings
      });
      continue;
    }
    if (candidate.workspaceType === "script") {
      const settings = migrateLegacyScriptAgentTeamSettings(candidate.settings);
      if (!settings) return undefined;
      teams.push({
        id: id.data,
        name: name.data,
        workspaceType: "script",
        settings
      });
      continue;
    }
    if (candidate.workspaceType !== "long") return undefined;
    const settings = migrateLegacyLongAgentTeamSettings(candidate.settings);
    if (!settings) return undefined;
    settings.forEach((longSettings, index) => {
      let migratedName = name.data;
      if (index > 0) {
        const suffix = ` · 迁移 ${index + 1}`;
        migratedName = `${name.data.slice(0, 80 - suffix.length)}${suffix}`;
        for (
          let sequence = 2;
          usedNames.has(migratedName.toLocaleLowerCase());
          sequence += 1
        ) {
          const numberedSuffix = `${suffix}-${sequence}`;
          migratedName = `${name.data.slice(0, 80 - numberedSuffix.length)}${numberedSuffix}`;
        }
      }
      usedNames.add(migratedName.toLocaleLowerCase());
      teams.push({
        id: index === 0 ? id.data : createTeamId(),
        name: migratedName,
        workspaceType: "long",
        settings: longSettings
      });
    });
  }
  const enabled = raw.enabledTeamIds;
  const parsed = AgentTeamCatalogSnapshotSchema.safeParse({
    enabledTeamIds: {
      ...(typeof enabled.short === "string" ? { short: enabled.short } : {}),
      ...(typeof enabled.script === "string" ? { script: enabled.script } : {}),
      ...(typeof enabled.long === "string" ? { long: enabled.long } : {})
    },
    teams
  });
  return parsed.success ? parsed.data : undefined;
}

export function tryMigrateCombinedCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot | undefined {
  const profileCatalog = migrateProfileCatalog(raw);
  if (profileCatalog) return profileCatalog;
  try {
    return migrateVersionOneCatalog(raw);
  } catch {
    return undefined;
  }
}

function catalogFromStandaloneSettings(
  settings: AgentTeamProfileSaveInput["settings"]
): AgentTeamCatalogSnapshot {
  const short = createAgentTeamProfile("short", defaultName("short"), settings);
  const script = createAgentTeamProfile(
    "script",
    defaultName("script"),
    settings
  );
  const long = createAgentTeamProfile("long", defaultName("long"), settings);
  const matching =
    settings.workspaceType === "short"
      ? short
      : settings.workspaceType === "script"
        ? script
        : long;
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: { [settings.workspaceType]: matching.id },
    teams: [short, script, long]
  });
}

function catalogFromLongSettings(
  settings: readonly LongAgentTeamSettings[]
): AgentTeamCatalogSnapshot {
  const short = createAgentTeamProfile("short");
  const script = createAgentTeamProfile("script");
  const longProfiles = settings.map((longSettings, index) =>
    createAgentTeamProfile(
      "long",
      index === 0 ? defaultName("long") : `迁移长篇团队 ${index + 1}`,
      longSettings
    )
  );
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: { long: longProfiles[0]!.id },
    teams: [short, script, ...longProfiles]
  });
}

export function tryMigrateStandaloneCatalog(
  raw: Record<string, unknown>
): AgentTeamCatalogSnapshot | undefined {
  const short = migrateLegacyShortAgentTeamSettings(raw);
  if (short) return catalogFromStandaloneSettings(short);
  const script = migrateLegacyScriptAgentTeamSettings(raw);
  if (script) return catalogFromStandaloneSettings(script);
  const long = migrateLegacyLongAgentTeamSettings(raw);
  return long ? catalogFromLongSettings(long) : undefined;
}
