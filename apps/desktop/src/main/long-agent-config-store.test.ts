import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_SETTINGS,
  type LongAgentSettingsInput
} from "@deepwrite/contracts";
import { LongAgentConfigStore } from "./long-agent-config-store";

async function createStore(): Promise<{
  root: string;
  store: LongAgentConfigStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-long-agent-store-"));
  return { root, store: new LongAgentConfigStore(root) };
}

function editableDefaults(): LongAgentSettingsInput {
  return {
    workspaceType: "long",
    agents: DEFAULT_LONG_AGENT_SETTINGS.agents.map((agent) => ({
      id: agent.id,
      systemPrompt: agent.systemPrompt,
      welcomeShortcuts: [
        agent.welcomeShortcuts[0],
        agent.welcomeShortcuts[1],
        agent.welcomeShortcuts[2]
      ],
      readAccess: {
        workspaceRoots: [...agent.readAccess.workspaceRoots],
        materialKinds: [...agent.readAccess.materialKinds],
        skillKinds: [...agent.readAccess.skillKinds]
      }
    }))
  };
}

describe("LongAgentConfigStore", () => {
  it("returns six independent defaults without creating a file", async () => {
    const { store } = await createStore();
    const settings = await store.list();
    expect(settings.workspaceType).toBe("long");
    expect(settings.agents.map(({ id }) => id)).toEqual(
      DEFAULT_LONG_AGENT_SETTINGS.agents.map(({ id }) => id)
    );
  });

  it("persists only configurable fields and resolves the runtime profile", async () => {
    const { root, store } = await createStore();
    const input = editableDefaults();
    const agent = input.agents.find(({ id }) => id === "character_design")!;
    agent.systemPrompt = "自定义长篇人物提示词";
    agent.welcomeShortcuts[1] = "追踪本章人物状态";
    agent.readAccess.materialKinds = ["character"];

    const saved = await store.save(input);
    const resolved = await store.resolve("character_design");
    const disk = JSON.parse(
      await readFile(
        join(root, "config", "long-workspace-agents.json"),
        "utf8"
      )
    ) as Record<string, unknown>;

    expect(saved.agents).toHaveLength(6);
    expect(resolved.systemPrompt).toBe("自定义长篇人物提示词");
    expect(resolved.readAccess.materialKinds).toEqual(["character"]);
    expect(resolved.writeAccess).toEqual(
      DEFAULT_LONG_AGENT_SETTINGS.agents.find(
        ({ id }) => id === "character_design"
      )!.writeAccess
    );
    expect(JSON.stringify(disk)).not.toContain("writeAccess");
    expect(JSON.stringify(disk)).not.toContain("capabilities");
  });

  it("resets one role without changing the other five roles", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    input.agents.find(({ id }) => id === "worldbuilding")!.systemPrompt =
      "custom:world";
    input.agents.find(({ id }) => id === "plot_design")!.systemPrompt =
      "custom:plot";
    await store.save(input);

    const reset = await store.reset("worldbuilding");
    expect(
      reset.agents.find(({ id }) => id === "worldbuilding")!.systemPrompt
    ).toBe(
      DEFAULT_LONG_AGENT_SETTINGS.agents.find(
        ({ id }) => id === "worldbuilding"
      )!.systemPrompt
    );
    expect(
      reset.agents.find(({ id }) => id === "plot_design")!.systemPrompt
    ).toBe("custom:plot");
  });

  it("does not silently overwrite a malformed settings file", async () => {
    const { root, store } = await createStore();
    const path = join(root, "config", "long-workspace-agents.json");
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(path, "{broken", "utf8");

    await expect(store.list()).rejects.toThrow();
  });
});
