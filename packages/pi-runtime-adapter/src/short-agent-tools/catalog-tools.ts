import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { SHORT_MATERIAL_KINDS } from "@deepwrite/contracts";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "../resolve-attached-skill";
import { defineTool, literalUnion } from "./schema";
import { textResult, type BuildWritingWorkspaceToolsInput } from "./shared";

export function buildQueryLinkedMaterialEntriesTool(
  input: BuildWritingWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.material;
  return defineTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description:
      "列出、搜索或读取本轮显式附加且位于当前智能体读取范围内的素材。未显式附加的素材不会被读取。",
    parameters: Type.Object({
      mode: Type.Union([
        Type.Literal("list"),
        Type.Literal("search"),
        Type.Literal("read")
      ]),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_name: Type.Optional(Type.String({ maxLength: 240 })),
      material_kind: Type.Optional(
        literalUnion(allowedKinds.length ? allowedKinds : SHORT_MATERIAL_KINDS)
      )
    }),
    execute: async (_toolCallId, params) => {
      const items = (input.attachedMaterials ?? []).filter(
        (item) => item.kind !== undefined && allowedKinds.includes(item.kind)
      );
      const kind = params.material_kind ? String(params.material_kind) : "";
      const scoped = kind ? items.filter((item) => item.kind === kind) : items;
      if (params.mode === "read") {
        const name = String(params.entry_name ?? params.query ?? "").trim();
        const found = scoped.find((item) => item.title === name);
        return textResult(
          found
            ? `【${found.title}】${found.kind ? `（${found.kind}）` : ""}\n\n${found.content}`
            : "没有找到同名的已附加素材条目。"
        );
      }
      if (params.mode === "search") {
        const query = String(params.query ?? "").trim();
        const found = scoped.filter(
          (item) => item.title.includes(query) || item.content.includes(query)
        );
        return textResult(
          found.length
            ? found
                .map(
                  (item) =>
                    `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}: ${item.content.slice(0, 220)}`
                )
                .join("\n")
            : "已附加素材中没有匹配条目。"
        );
      }
      return textResult(
        scoped.length
          ? scoped
              .map(
                (item) => `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}`
              )
              .join("\n")
          : "本轮没有附加当前智能体可读的素材。"
      );
    }
  });
}

export function buildLoadSkillTool(
  input: BuildWritingWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.skill;
  return defineTool({
    name: "load_skill",
    label: "加载技能",
    description: LOAD_SKILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      name: Type.String(LOAD_SKILL_NAME_PARAMETER)
    }),
    execute: async (_toolCallId, params) => {
      const name = String(params.name ?? "");
      const attached = input.attachedSkills ?? [];
      const isReadable = (item: LoadSkillCandidate): boolean =>
        item.kind !== undefined &&
        (allowedKinds as readonly string[]).includes(item.kind);
      const result = resolveAttachedSkill(name, attached, isReadable);
      return textResult(
        formatLoadSkillToolResult(name, result, attached.filter(isReadable))
      );
    }
  });
}
