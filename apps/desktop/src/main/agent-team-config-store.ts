import { join } from "node:path";
import {
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileCreateInputSchema,
  AgentTeamProfileRenameInputSchema,
  AgentTeamProfileSaveInputSchema,
  AgentTeamProfileSetEnabledInputSchema,
  AgentTeamProfileTargetInputSchema,
  LongAgentIdSchema,
  ScriptWorkspaceAgentIdSchema,
  ShortWorkspaceAgentIdSchema,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile,
  type AgentTeamProfileCreateInput,
  type AgentTeamProfileRenameInput,
  type AgentTeamProfileSaveInput,
  type AgentTeamProfileSetEnabledInput,
  type AgentTeamProfileTargetInput,
  type AgentTeamWorkspaceType,
  type ShortAgentSubagentDefinition,
  type WorkspaceAgentId
} from "@deepwrite/contracts";
import {
  AGENT_TEAM_CATALOG_DISK_VERSION,
  atomicWriteAgentTeamJson,
  createAgentTeamProfile,
  createCatalogFromLegacyFiles,
  invalidAgentTeamConfig,
  migrateVersionOneCatalog,
  readAgentTeamJson,
  type AgentTeamDiskCatalog
} from "./agent-team-config-migration";

function cloneSnapshot(
  snapshot: AgentTeamCatalogSnapshot
): AgentTeamCatalogSnapshot {
  return AgentTeamCatalogSnapshotSchema.parse(structuredClone(snapshot));
}

export class AgentTeamConfigStore {
  private readonly settingsPath: string;
  private readonly legacyShortPath: string;
  private readonly legacyScriptPath: string;
  private readonly legacyLongPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    const configRoot = join(userDataPath, "config");
    this.settingsPath = join(configRoot, "agent-team-profiles.json");
    this.legacyShortPath = join(configRoot, "agent-teams.json");
    this.legacyScriptPath = join(configRoot, "agent-teams-script.json");
    this.legacyLongPath = join(configRoot, "long-agent-teams.json");
  }

  private async readLegacyFiles(): Promise<AgentTeamCatalogSnapshot> {
    return createCatalogFromLegacyFiles({
      short: this.legacyShortPath,
      script: this.legacyScriptPath,
      long: this.legacyLongPath
    });
  }

  private async readSnapshot(): Promise<AgentTeamCatalogSnapshot> {
    const raw = await readAgentTeamJson(this.settingsPath);
    if (raw === undefined) {
      const snapshot = await this.readLegacyFiles();
      await this.writeSnapshot(snapshot);
      return snapshot;
    }
    if (!raw || typeof raw !== "object") throw invalidAgentTeamConfig();
    const version = (raw as { version?: unknown }).version;
    if (version === 1) {
      const { version: _version, ...legacy } = raw as Record<string, unknown>;
      const snapshot = migrateVersionOneCatalog(legacy);
      await this.writeSnapshot(snapshot);
      return snapshot;
    }
    if (version !== AGENT_TEAM_CATALOG_DISK_VERSION) {
      throw new Error("智能体团队目录版本无效，已停止加载以避免覆盖原文件。");
    }
    const { version: _version, ...snapshot } = raw as AgentTeamDiskCatalog;
    const parsed = AgentTeamCatalogSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw invalidAgentTeamConfig(parsed.error.issues[0]);
    return parsed.data;
  }

  private async writeSnapshot(
    snapshot: AgentTeamCatalogSnapshot
  ): Promise<void> {
    await atomicWriteAgentTeamJson(this.settingsPath, {
      version: AGENT_TEAM_CATALOG_DISK_VERSION,
      ...cloneSnapshot(snapshot)
    } satisfies AgentTeamDiskCatalog);
  }

  private async queue<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    let result: Result | undefined;
    const pending = this.writeChain.then(async () => {
      result = await operation();
    });
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    await pending;
    return result!;
  }

  private async mutate(
    operation: (snapshot: AgentTeamCatalogSnapshot) => void
  ): Promise<AgentTeamCatalogSnapshot> {
    return this.queue(async () => {
      const snapshot = await this.readSnapshot();
      operation(snapshot);
      const parsed = AgentTeamCatalogSnapshotSchema.parse(snapshot);
      await this.writeSnapshot(parsed);
      return cloneSnapshot(parsed);
    });
  }

  async list(): Promise<AgentTeamCatalogSnapshot> {
    return this.queue(async () => cloneSnapshot(await this.readSnapshot()));
  }

  async create(
    rawInput: AgentTeamProfileCreateInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileCreateInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      this.assertUniqueName(snapshot, input.name);
      snapshot.teams.push(
        createAgentTeamProfile(input.workspaceType, input.name)
      );
    });
  }

  async rename(
    rawInput: AgentTeamProfileRenameInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileRenameInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      this.requireTeam(snapshot, input.teamId).name = input.name;
      this.assertUniqueName(snapshot, input.name, input.teamId);
    });
  }

  async delete(
    rawInput: AgentTeamProfileTargetInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileTargetInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      const team = this.requireTeam(snapshot, input.teamId);
      if (snapshot.enabledTeamIds[team.workspaceType] === team.id) {
        throw new Error("已启用的团队不能删除，请先关闭该团队。");
      }
      if (snapshot.teams.length === 1)
        throw new Error("至少需要保留一个智能体团队。");
      snapshot.teams = snapshot.teams.filter(
        (candidate) => candidate.id !== team.id
      );
    });
  }

  async setEnabled(
    rawInput: AgentTeamProfileSetEnabledInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileSetEnabledInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      const team = this.requireTeam(snapshot, input.teamId);
      if (input.enabled) snapshot.enabledTeamIds[team.workspaceType] = team.id;
      else if (snapshot.enabledTeamIds[team.workspaceType] === team.id) {
        delete snapshot.enabledTeamIds[team.workspaceType];
      }
    });
  }

  async save(
    rawInput: AgentTeamProfileSaveInput
  ): Promise<AgentTeamCatalogSnapshot> {
    const input = AgentTeamProfileSaveInputSchema.parse(rawInput);
    return this.mutate((snapshot) => {
      const team = this.requireTeam(snapshot, input.teamId);
      if (team.workspaceType !== input.settings.workspaceType) {
        throw new Error("团队类型与保存的配置类型不一致。");
      }
      team.settings = input.settings as never;
    });
  }

  async resolve(
    workspaceType: AgentTeamWorkspaceType,
    rawParentAgentId: WorkspaceAgentId | "long"
  ): Promise<ShortAgentSubagentDefinition[]> {
    const snapshot = await this.list();
    const enabledId = snapshot.enabledTeamIds[workspaceType];
    if (!enabledId) return [];
    const team = this.requireTeam(snapshot, enabledId);
    const parentAgentId =
      workspaceType === "long"
        ? LongAgentIdSchema.parse(rawParentAgentId)
        : workspaceType === "script"
          ? ScriptWorkspaceAgentIdSchema.parse(rawParentAgentId)
          : ShortWorkspaceAgentIdSchema.parse(rawParentAgentId);
    return (
      team.settings.teams
        .find((candidate) => candidate.parentAgentId === parentAgentId)
        ?.subagents.filter((definition) => definition.enabled)
        .map((definition) => ({ ...definition })) ?? []
    );
  }

  private requireTeam(
    snapshot: AgentTeamCatalogSnapshot,
    teamId: string
  ): AgentTeamProfile {
    const team = snapshot.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new Error("智能体团队不存在或已被删除。");
    return team;
  }

  private assertUniqueName(
    snapshot: AgentTeamCatalogSnapshot,
    name: string,
    excludedId?: string
  ): void {
    const normalized = name.toLocaleLowerCase();
    if (
      snapshot.teams.some(
        (team) =>
          team.id !== excludedId && team.name.toLocaleLowerCase() === normalized
      )
    ) {
      throw new Error(`智能体团队名称“${name}”已存在。`);
    }
  }
}
