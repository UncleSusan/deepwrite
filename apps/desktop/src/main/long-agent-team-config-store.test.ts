import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  type LongAgentTeamSettingsInput
} from "@deepwrite/contracts";
import {
  LONG_AGENT_TEAMS_DISK_VERSION,
  LongAgentTeamConfigStore
} from "./long-agent-team-config-store";

describe("LongAgentTeamConfigStore", () => {
  it("persists the single long team and resolves enabled definitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-long-team-store-"));
    const store = new LongAgentTeamConfigStore(root);
    const input = structuredClone(
      DEFAULT_LONG_AGENT_TEAM_SETTINGS
    ) as LongAgentTeamSettingsInput;
    input.teams
      .find(({ parentAgentId }) => parentAgentId === "long")!
      .subagents.push(
        {
          id: "timeline_reviewer",
          name: "时间线审阅",
          description: "核对事件顺序和叙事落点。",
          systemPrompt: "只核对时间线并提交结论。",
          enabled: true,
          modelMode: "inherit"
        },
        {
          id: "disabled_helper",
          name: "停用助手",
          description: "不应装配。",
          systemPrompt: "不运行。",
          enabled: false,
          modelMode: "inherit"
        }
      );

    const saved = await store.save(input);
    const resolved = await store.resolve("long");
    const disk = JSON.parse(
      await readFile(join(root, "config", "long-agent-teams.json"), "utf8")
    ) as { version: number; workspaceType: string };

    expect(saved.teams).toHaveLength(1);
    expect(resolved.map(({ id }) => id)).toEqual(["timeline_reviewer"]);
    expect(disk.version).toBe(LONG_AGENT_TEAMS_DISK_VERSION);
    expect(disk.workspaceType).toBe("long");
  });

  it("falls back to empty teams for pre-merge configs", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-long-team-store-"));
    const store = new LongAgentTeamConfigStore(root);
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(
      join(root, "config", "long-agent-teams.json"),
      `${JSON.stringify(
        {
          version: 1,
          workspaceType: "long",
          teams: [
            {
              parentAgentId: "draft",
              subagents: [
                {
                  id: "style_helper",
                  name: "文风助手",
                  description: "检查当前章文风。",
                  systemPrompt: "只检查文风。",
                  enabled: true,
                  modelMode: "inherit"
                }
              ]
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const settings = await store.list();
    expect(settings.teams.map(({ parentAgentId }) => parentAgentId)).toEqual([
      "long"
    ]);
    expect(settings.teams[0]!.subagents).toEqual([]);
    expect(await store.resolve("long")).toEqual([]);
  });
});
