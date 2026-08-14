import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  type LongAgentTeamSettingsInput
} from "@deepwrite/contracts";
import { LongAgentTeamConfigStore } from "./long-agent-team-config-store";

describe("LongAgentTeamConfigStore", () => {
  it("persists five independent teams and resolves enabled definitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-long-team-store-"));
    const store = new LongAgentTeamConfigStore(root);
    const input = structuredClone(
      DEFAULT_LONG_AGENT_TEAM_SETTINGS
    ) as LongAgentTeamSettingsInput;
    input.teams
      .find(({ parentAgentId }) => parentAgentId === "plot_design")!
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
    const resolved = await store.resolve("plot_design");
    const disk = await readFile(
      join(root, "config", "long-agent-teams.json"),
      "utf8"
    );

    expect(saved.teams).toHaveLength(5);
    expect(resolved.map(({ id }) => id)).toEqual(["timeline_reviewer"]);
    expect(disk).toContain('"workspaceType": "long"');
  });
});
