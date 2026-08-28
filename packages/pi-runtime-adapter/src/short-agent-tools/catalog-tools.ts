import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  SHORT_MATERIAL_KINDS,
  resolveScriptWorkspaceStageReadAccess,
  resolveShortWorkspaceStageReadAccess
} from "@deepwrite/contracts";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "../resolve-attached-skill";
import { defineTool, literalUnion } from "./schema";
import { textResult, type BuildWritingWorkspaceToolsInput } from "./shared";

type AttachedMaterial = NonNullable<
  BuildWritingWorkspaceToolsInput["attachedMaterials"]
>[number];

function materialShortName(title: string): string {
  const separator = title.lastIndexOf(" · ");
  return separator < 0 ? title : title.slice(separator + 3).trim() || title;
}

function resolveMaterialEntry(
  rawName: string,
  items: readonly AttachedMaterial[]
):
  | { status: "found"; item: AttachedMaterial }
  | { status: "ambiguous"; items: AttachedMaterial[] }
  | { status: "not_found" } {
  const name = rawName.trim();
  const candidateGroups = [
    items.filter((item) => item.title === name),
    items.filter((item) => item.id === name),
    items.filter((item) => materialShortName(item.title) === name)
  ];
  for (const candidates of candidateGroups) {
    if (candidates.length === 1) {
      return { status: "found", item: candidates[0]! };
    }
    if (candidates.length > 1) {
      return { status: "ambiguous", items: candidates };
    }
  }
  return { status: "not_found" };
}

function materialIndexLine(item: AttachedMaterial): string {
  return `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}（id=${item.id}）`;
}

export function buildQueryLinkedMaterialEntriesTool(
  input: BuildWritingWorkspaceToolsInput
): AgentTool {
  const stageAccess =
    input.workspaceType === "script"
      ? resolveScriptWorkspaceStageReadAccess(input.workspace.activeStageId)
      : resolveShortWorkspaceStageReadAccess(input.workspace.activeStageId);
  const allowedKinds = input.profile.readAccess.material.filter(
    (kind) => !stageAccess || stageAccess.material.includes(kind)
  );
  return defineTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description:
      "列出、搜索或按完整标题、唯一短名、稳定 id 读取本轮显式附加且位于当前智能体读取范围内的素材。多候选时必须改用稳定 id；未显式附加的素材不会被读取。",
    parameters: Type.Object({
      mode: Type.Union([
        Type.Literal("list"),
        Type.Literal("search"),
        Type.Literal("read")
      ]),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_name: Type.Optional(Type.String({ maxLength: 512 })),
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
        const resolved = resolveMaterialEntry(name, scoped);
        if (resolved.status === "ambiguous") {
          return textResult(
            [
              `名称「${name}」匹配到多个素材条目，请改用稳定 id：`,
              ...resolved.items.map(materialIndexLine)
            ].join("\n")
          );
        }
        return textResult(
          resolved.status === "found"
            ? `【${resolved.item.title}】${resolved.item.kind ? `（${resolved.item.kind}）` : ""}\n\n${resolved.item.content}`
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
                    `${materialIndexLine(item)}: ${item.content.slice(0, 220)}`
                )
                .join("\n")
            : "已附加素材中没有匹配条目。"
        );
      }
      return textResult(
        scoped.length
          ? scoped.map(materialIndexLine).join("\n")
          : "本轮没有附加当前智能体可读的素材。"
      );
    }
  });
}

export function buildLoadSkillTool(
  input: BuildWritingWorkspaceToolsInput
): AgentTool {
  const stageAccess =
    input.workspaceType === "script"
      ? resolveScriptWorkspaceStageReadAccess(input.workspace.activeStageId)
      : resolveShortWorkspaceStageReadAccess(input.workspace.activeStageId);
  const allowedKinds = input.profile.readAccess.skill.filter(
    (kind) => !stageAccess || stageAccess.skill.includes(kind)
  );
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
