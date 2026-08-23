import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile
} from "@deepwrite/contracts";
import { AgentTeamConfigStore } from "./agent-team-config-store";

const roots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-agent-team-catalog-"));
  roots.add(root);
  return root;
}

function profileOfType<Type extends AgentTeamProfile["workspaceType"]>(
  snapshot: AgentTeamCatalogSnapshot,
  workspaceType: Type,
  name?: string
): Extract<AgentTeamProfile, { workspaceType: Type }> {
  const team = snapshot.teams.find(
    (candidate) =>
      candidate.workspaceType === workspaceType &&
      (!name || candidate.name === name)
  );
  if (!team || team.workspaceType !== workspaceType)
    throw new Error("缺少测试团队");
  return team as Extract<AgentTeamProfile, { workspaceType: Type }>;
}

afterEach(async () => {
  await Promise.all(
    [...roots].map((root) => rm(root, { recursive: true, force: true }))
  );
  roots.clear();
});

describe("AgentTeamConfigStore", () => {
  it("creates three blank disabled default teams and persists version two", async () => {
    const root = await temporaryRoot();
    const snapshot = await new AgentTeamConfigStore(root).list();

    expect(snapshot.enabledTeamIds).toEqual({});
    expect(snapshot.teams).toHaveLength(3);
    expect(profileOfType(snapshot, "short")).toMatchObject({
      name: "默认短篇团队",
      settings: DEFAULT_AGENT_TEAM_SETTINGS
    });
    expect(profileOfType(snapshot, "script")).toMatchObject({
      name: "默认剧本团队",
      settings: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS
    });
    expect(profileOfType(snapshot, "long")).toMatchObject({
      name: "默认长篇团队",
      settings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
    });
    expect(
      JSON.parse(
        await readFile(join(root, "config", "agent-team-profiles.json"), "utf8")
      )
    ).toMatchObject({ version: 2, enabledTeamIds: {} });
  });

  it("migrates each legacy type into its own enabled team without deleting sources", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    const short = structuredClone(DEFAULT_AGENT_TEAM_SETTINGS);
    short.teams[0]!.subagents.push({
      id: "short_helper",
      name: "短篇助手",
      description: "短篇",
      systemPrompt: "短篇",
      enabled: true,
      modelMode: "inherit"
    });
    const script = structuredClone(DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS);
    const long = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    await Promise.all([
      writeFile(
        join(config, "agent-teams.json"),
        JSON.stringify({ version: 1, ...short })
      ),
      writeFile(
        join(config, "agent-teams-script.json"),
        JSON.stringify({ version: 1, ...script })
      ),
      writeFile(
        join(config, "long-agent-teams.json"),
        JSON.stringify({ version: 2, ...long })
      )
    ]);

    const snapshot = await new AgentTeamConfigStore(root).list();
    expect(profileOfType(snapshot, "short").settings).toEqual(short);
    expect(profileOfType(snapshot, "script").settings).toEqual(script);
    expect(profileOfType(snapshot, "long").settings).toEqual(long);
    expect(snapshot.enabledTeamIds).toEqual({
      short: profileOfType(snapshot, "short").id,
      script: profileOfType(snapshot, "script").id,
      long: profileOfType(snapshot, "long").id
    });
    await expect(
      readFile(join(config, "agent-teams.json"), "utf8")
    ).resolves.toBeTruthy();
  });

  it("splits a version-one combined catalog into one profile per type", async () => {
    const root = await temporaryRoot();
    const config = join(root, "config");
    await mkdir(config);
    await writeFile(
      join(config, "agent-team-profiles.json"),
      JSON.stringify({
        version: 1,
        activeTeamId: "team_original",
        teams: [
          {
            id: "team_original",
            name: "默认团队",
            shortSettings: DEFAULT_AGENT_TEAM_SETTINGS,
            scriptSettings: DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS,
            longSettings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
          }
        ]
      })
    );

    const snapshot = await new AgentTeamConfigStore(root).list();
    expect(snapshot.teams.map((team) => team.name)).toEqual([
      "默认短篇团队",
      "默认剧本团队",
      "默认长篇团队"
    ]);
    expect(snapshot.enabledTeamIds).toEqual({
      short: profileOfType(snapshot, "short").id,
      script: profileOfType(snapshot, "script").id,
      long: profileOfType(snapshot, "long").id
    });
  });

  it("isolates profiles and allows one enabled team per type or none", async () => {
    const store = new AgentTeamConfigStore(await temporaryRoot());
    const created = await store.create({
      name: "审稿团队",
      workspaceType: "short"
    });
    const second = profileOfType(created, "short", "审稿团队");
    const settings = structuredClone(second.settings);
    settings.teams[1]!.subagents.push({
      id: "reviewer",
      name: "审阅",
      description: "检查剧情",
      systemPrompt: "审阅剧情",
      enabled: true,
      modelMode: "inherit"
    });
    await store.save({ teamId: second.id, settings });

    expect(await store.resolve("short", "plot_design")).toEqual([]);
    const enabled = await store.setEnabled({
      teamId: second.id,
      enabled: true
    });
    expect(enabled.enabledTeamIds.short).toBe(second.id);
    expect(await store.resolve("short", "plot_design")).toEqual([
      expect.objectContaining({ id: "reviewer" })
    ]);
    await expect(store.delete({ teamId: second.id })).rejects.toThrow(
      "不能删除"
    );
    const disabled = await store.setEnabled({
      teamId: second.id,
      enabled: false
    });
    expect(disabled.enabledTeamIds.short).toBeUndefined();
    await expect(store.delete({ teamId: second.id })).resolves.toBeTruthy();
  });

  it("enabling another team replaces only the enabled team of that type", async () => {
    const store = new AgentTeamConfigStore(await temporaryRoot());
    const initial = await store.list();
    const firstShort = profileOfType(initial, "short");
    const long = profileOfType(initial, "long");
    await store.setEnabled({ teamId: firstShort.id, enabled: true });
    await store.setEnabled({ teamId: long.id, enabled: true });
    const created = await store.create({
      name: "第二短篇团队",
      workspaceType: "short"
    });
    const secondShort = profileOfType(created, "short", "第二短篇团队");
    const result = await store.setEnabled({
      teamId: secondShort.id,
      enabled: true
    });

    expect(result.enabledTeamIds).toEqual({
      short: secondShort.id,
      long: long.id
    });
  });

  it("rejects duplicate names and invalid legacy input without overwriting it", async () => {
    const root = await temporaryRoot();
    const store = new AgentTeamConfigStore(root);
    await store.create({ name: "审稿团队", workspaceType: "short" });
    await expect(
      store.create({ name: "审稿团队", workspaceType: "long" })
    ).rejects.toThrow("已存在");

    const invalidRoot = await temporaryRoot();
    await mkdir(join(invalidRoot, "config"));
    await writeFile(
      join(invalidRoot, "config", "agent-teams.json"),
      JSON.stringify({ version: 1, workspaceType: "short", teams: [] })
    );
    await expect(new AgentTeamConfigStore(invalidRoot).list()).rejects.toThrow(
      "已停止加载"
    );
    await expect(
      readFile(join(invalidRoot, "config", "agent-team-profiles.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("continues its serialized write queue after a persistence failure", async () => {
    const root = await temporaryRoot();
    const configPath = join(root, "config");
    await writeFile(configPath, "not-a-directory");
    const store = new AgentTeamConfigStore(root);

    await expect(
      store.create({ name: "首次创建", workspaceType: "short" })
    ).rejects.toBeTruthy();
    await unlink(configPath);
    await mkdir(configPath);
    const recovered = await store.create({
      name: "恢复后的团队",
      workspaceType: "short"
    });
    expect(recovered.teams.some((team) => team.name === "恢复后的团队")).toBe(
      true
    );
  });
});
