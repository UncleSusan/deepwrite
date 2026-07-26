import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  LONG_AGENT_IDS,
  LongAgentIdSchema,
  LongAgentSettingsInputSchema,
  LongAgentSettingsSchema,
  getDefaultLongAgentProfile,
  type LongAgentId,
  type LongAgentProfile,
  type LongAgentReadAccess,
  type LongAgentSettings,
  type LongAgentSettingsInput,
  type LongAgentSettingsInputAgent
} from "@deepwrite/contracts";

interface DiskLongAgentSettings extends LongAgentSettingsInput {
  version: 1;
}

function cloneReadAccess(access: LongAgentReadAccess): LongAgentReadAccess {
  return {
    workspaceRoots: [...access.workspaceRoots],
    materialKinds: [...access.materialKinds],
    skillKinds: [...access.skillKinds]
  };
}

function cloneInputAgent(
  agent: LongAgentSettingsInputAgent
): LongAgentSettingsInputAgent {
  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    welcomeShortcuts: [
      agent.welcomeShortcuts[0],
      agent.welcomeShortcuts[1],
      agent.welcomeShortcuts[2]
    ],
    readAccess: cloneReadAccess(agent.readAccess)
  };
}

function cloneProfile(profile: LongAgentProfile): LongAgentProfile {
  return {
    ...profile,
    welcomeShortcuts: [
      profile.welcomeShortcuts[0],
      profile.welcomeShortcuts[1],
      profile.welcomeShortcuts[2]
    ],
    readAccess: cloneReadAccess(profile.readAccess),
    writeAccess: {
      workspaceRoots: [...profile.writeAccess.workspaceRoots],
      capabilities: [...profile.writeAccess.capabilities]
    }
  };
}

function defaultsAsInput(): LongAgentSettingsInput {
  return {
    workspaceType: "long",
    agents: DEFAULT_LONG_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      welcomeShortcuts: [
        profile.welcomeShortcuts[0],
        profile.welcomeShortcuts[1],
        profile.welcomeShortcuts[2]
      ],
      readAccess: cloneReadAccess(profile.readAccess)
    }))
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

function parseDiskSettings(raw: unknown): LongAgentSettingsInput {
  if (raw === undefined) return defaultsAsInput();
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    raw.version !== 1
  ) {
    throw new Error("长篇智能体配置版本无效，已停止加载以避免覆盖原文件。");
  }
  const { version: _version, ...settings } = raw as DiskLongAgentSettings;
  const parsed = LongAgentSettingsInputSchema.safeParse(settings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `长篇智能体配置内容无效，已停止加载以避免覆盖原文件${
        issue ? `：${issue.path.join(".") || "root"} ${issue.message}` : "。"
      }`
    );
  }
  return {
    workspaceType: "long",
    agents: parsed.data.agents.map(cloneInputAgent)
  };
}

export class LongAgentConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(
      userDataPath,
      "config",
      "long-workspace-agents.json"
    );
  }

  async list(): Promise<LongAgentSettings> {
    await this.writeChain;
    return this.toPublicSettings(await this.readInput());
  }

  async save(rawInput: LongAgentSettingsInput): Promise<LongAgentSettings> {
    const input = LongAgentSettingsInputSchema.parse(rawInput);
    let saved: LongAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const normalized: LongAgentSettingsInput = {
        workspaceType: "long",
        agents: input.agents.map(cloneInputAgent)
      };
      await this.writeInput(normalized);
      saved = this.toPublicSettings(normalized);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async reset(rawAgentId?: LongAgentId): Promise<LongAgentSettings> {
    const agentId = rawAgentId
      ? LongAgentIdSchema.parse(rawAgentId)
      : undefined;
    let saved: LongAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const next = agentId ? await this.readInput() : defaultsAsInput();
      if (agentId) {
        const builtin = getDefaultLongAgentProfile(agentId);
        const replacement: LongAgentSettingsInputAgent = {
          id: builtin.id,
          systemPrompt: builtin.systemPrompt,
          welcomeShortcuts: [
            builtin.welcomeShortcuts[0],
            builtin.welcomeShortcuts[1],
            builtin.welcomeShortcuts[2]
          ],
          readAccess: cloneReadAccess(builtin.readAccess)
        };
        const index = next.agents.findIndex((agent) => agent.id === agentId);
        if (index < 0) {
          throw new Error(`长篇智能体配置缺少角色：${agentId}`);
        }
        next.agents[index] = replacement;
      }
      const validated = LongAgentSettingsInputSchema.parse(next);
      await this.writeInput(validated);
      saved = this.toPublicSettings(validated);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async resolve(rawAgentId: LongAgentId): Promise<LongAgentProfile> {
    const agentId = LongAgentIdSchema.parse(rawAgentId);
    const settings = await this.list();
    const profile = settings.agents.find((agent) => agent.id === agentId);
    return profile
      ? cloneProfile(profile)
      : cloneProfile(getDefaultLongAgentProfile(agentId));
  }

  private trackWrite(operation: Promise<unknown>): void {
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
  }

  private async readInput(): Promise<LongAgentSettingsInput> {
    return parseDiskSettings(await readJson(this.settingsPath));
  }

  private async writeInput(input: LongAgentSettingsInput): Promise<void> {
    const disk: DiskLongAgentSettings = {
      version: 1,
      workspaceType: "long",
      agents: input.agents.map(cloneInputAgent)
    };
    await atomicWriteJson(this.settingsPath, disk);
  }

  private toPublicSettings(
    input: LongAgentSettingsInput
  ): LongAgentSettings {
    const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
    return LongAgentSettingsSchema.parse({
      workspaceType: "long",
      agents: LONG_AGENT_IDS.map((id) => {
        const builtin = getDefaultLongAgentProfile(id);
        const override = byId.get(id);
        if (!override) return builtin;
        return {
          ...builtin,
          systemPrompt: override.systemPrompt,
          welcomeShortcuts: [
            override.welcomeShortcuts[0],
            override.welcomeShortcuts[1],
            override.welcomeShortcuts[2]
          ],
          readAccess: cloneReadAccess(override.readAccess),
          writeAccess: {
            workspaceRoots: [...builtin.writeAccess.workspaceRoots],
            capabilities: [...builtin.writeAccess.capabilities]
          }
        };
      })
    });
  }
}
