import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { LongToolContext } from "./context";
import { buildSettingAliasTools } from "./setting-alias-tools";

export function buildSettingTools(ctx: LongToolContext): AgentTool[] {
  return buildSettingAliasTools(ctx);
}
