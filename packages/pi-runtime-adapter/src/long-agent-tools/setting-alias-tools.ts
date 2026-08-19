import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { LONG_CHARACTER_OVERVIEW_CHANGE_ID } from "@deepwrite/contracts";
import {
  aliasesParameter,
  characterDocumentParameter,
  characterTypeIdParameter,
  providerObjectUnion,
  settingCharacterDocumentParameter,
  stableIdParameter,
  strictObject,
  worldbuildingCategoryIdParameter,
  worldbuildingItemIdParameter,
  worldbuildingReadModeParameter
} from "./schemas";
import { defineTool, textResult } from "./shared";
import type { LongToolContext } from "./context";
import {
  buildWorldbuildingSettingTools,
  readWholeCharacterDocument,
  resolveCharacterOverviewTarget
} from "./setting-worldbuilding-tools";
import { buildCharacterSettingTools } from "./setting-character-tools";

export function buildSettingAliasTools(ctx: LongToolContext): AgentTool[] {
  const { loadIndex, fullyReadCharacterDocuments, characterDocumentOverlay } =
    ctx;
  const tools: AgentTool[] = [];
  const worldbuildingTools = buildWorldbuildingSettingTools(ctx);
  const characterTools = buildCharacterSettingTools(ctx);
  const worldbuildingQueryTools = worldbuildingTools.filter(
    (tool) =>
      tool.name === "list_worldbuilding" ||
      tool.name === "search_worldbuilding" ||
      tool.name === "read_worldbuilding"
  );
  const worldbuildingMutationTools = worldbuildingTools.filter(
    (tool) =>
      tool.name === "create_worldbuilding_file" ||
      tool.name === "write_worldbuilding_file" ||
      tool.name === "edit_worldbuilding_file"
  );
  const characterQueryTools = characterTools.filter(
    (tool) =>
      tool.name === "list_characters" ||
      tool.name === "search_characters" ||
      tool.name === "read_character"
  );
  const characterMutationTools = characterTools.filter(
    (tool) =>
      tool.name === "create_character" ||
      tool.name === "write_character_file" ||
      tool.name === "edit_character_file" ||
      tool.name === "write_character_overview" ||
      tool.name === "edit_character_overview"
  );
  const callNamedTool = (
    collection: readonly AgentTool[],
    name: string,
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal
  ) => {
    const tool = collection.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(`Setting domain tool ${name} is not available.`);
    }
    return tool.execute(toolCallId, params as never, signal);
  };
  if (worldbuildingQueryTools.length > 0 || characterQueryTools.length > 0) {
    tools.push(
      defineTool({
        name: "list_setting",
        label: "列出设定",
        description:
          "按 domain 列出世界观或人物。domain=worldbuilding 一次列出全部分类，指定 category_id 时列出该列表型分类条目并附带概览；domain=character 列出人物类型目录和人物索引，可按 type_id 筛选，并附带人物概览（同时建立后续写入概览所需的完整读取凭据）。",
        parameters: providerObjectUnion([
          strictObject({
            domain: Type.Literal("worldbuilding"),
            category_id: Type.Optional(worldbuildingCategoryIdParameter)
          }),
          strictObject({
            domain: Type.Literal("character"),
            type_id: Type.Optional(characterTypeIdParameter)
          })
        ]),
        execute: async (toolCallId, params, signal) => {
          if (params.domain === "worldbuilding") {
            return callNamedTool(
              worldbuildingQueryTools,
              "list_worldbuilding",
              toolCallId,
              { category_id: params.category_id },
              signal
            );
          }
          return callNamedTool(
            characterQueryTools,
            "list_characters",
            toolCallId,
            { type_id: params.type_id },
            signal
          );
        }
      }),
      defineTool({
        name: "search_setting",
        label: "搜索设定",
        description:
          "按 domain 搜索世界观或人物正文，返回可继续读取的业务 ID、标题和少量命中上下文；不返回文件、路径或版本信息。",
        parameters: providerObjectUnion([
          strictObject({
            domain: Type.Literal("worldbuilding"),
            query: Type.String({ minLength: 1, maxLength: 256 }),
            category_id: Type.Optional(worldbuildingCategoryIdParameter),
            page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
          }),
          strictObject({
            domain: Type.Literal("character"),
            query: Type.String({ minLength: 1, maxLength: 256 }),
            type_id: Type.Optional(characterTypeIdParameter),
            document: Type.Optional(characterDocumentParameter),
            page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
          })
        ]),
        execute: async (toolCallId, params, signal) => {
          if (params.domain === "worldbuilding") {
            return callNamedTool(
              worldbuildingQueryTools,
              "search_worldbuilding",
              toolCallId,
              {
                query: params.query,
                category_id: params.category_id,
                page: params.page,
                limit: params.limit
              },
              signal
            );
          }
          return callNamedTool(
            characterQueryTools,
            "search_characters",
            toolCallId,
            {
              query: params.query,
              type_id: params.type_id,
              document: params.document,
              page: params.page,
              limit: params.limit
            },
            signal
          );
        }
      }),
      defineTool({
        name: "read_setting",
        label: "读取设定",
        description:
          "按 domain 读取世界观或人物正文。世界观：文本型分类和列表型分类概览省略 item_id，列表条目同时提供 category_id 和 item_id。人物：读取文档时同时提供 character_id 和 document；读取概览时指定 document=overview 且省略 character_id。mode=preview 只返回摘录，mode=full 建立本轮后续编辑凭据。",
        parameters: providerObjectUnion([
          strictObject({
            domain: Type.Literal("worldbuilding"),
            category_id: worldbuildingCategoryIdParameter,
            item_id: Type.Optional(worldbuildingItemIdParameter),
            mode: Type.Optional(worldbuildingReadModeParameter)
          }),
          strictObject({
            domain: Type.Literal("character"),
            character_id: Type.Optional(stableIdParameter("character")),
            document: settingCharacterDocumentParameter,
            mode: Type.Optional(worldbuildingReadModeParameter)
          })
        ]),
        execute: async (toolCallId, params, signal) => {
          if (params.domain === "worldbuilding") {
            return callNamedTool(
              worldbuildingQueryTools,
              "read_worldbuilding",
              toolCallId,
              {
                category_id: params.category_id,
                item_id: params.item_id,
                mode: params.mode
              },
              signal
            );
          }
          if (params.document === "overview") {
            if (params.character_id) {
              throw new Error(
                "Character overview reads must omit character_id."
              );
            }
            const { index, projectRevision } = await loadIndex(signal);
            const mode = params.mode ?? "full";
            const target = resolveCharacterOverviewTarget(
              index,
              characterDocumentOverlay
            );
            const result = target.overlay
              ? { content: target.overlay.content, file: target.file }
              : await readWholeCharacterDocument(
                  ctx,
                  target.file,
                  index.revision,
                  projectRevision,
                  signal
                );
            characterDocumentOverlay.set(result.file.id, {
              characterId: LONG_CHARACTER_OVERVIEW_CHANGE_ID,
              characterName: "人物概览",
              document: "overview",
              file: result.file,
              content: result.content,
              pendingCreation: target.overlay?.pendingCreation ?? false
            });
            if (mode === "full") {
              fullyReadCharacterDocuments.set(result.file.id, {
                content: result.content,
                file: result.file,
                workspaceRevision: index.revision,
                projectRevision
              });
            }
            const previewLength = 240;
            const visible =
              mode === "preview" && result.content.length > previewLength * 2
                ? `${result.content.slice(0, previewLength)}\n\n……（中间省略 ${result.content.length - previewLength * 2} 个字符）……\n\n${result.content.slice(-previewLength)}`
                : result.content;
            return textResult(
              [
                "【人物概览】",
                mode === "preview" ? "预览（不建立整体覆盖凭据）：" : "正文：",
                "",
                visible || "（正文为空）"
              ].join("\n")
            );
          }
          if (!params.character_id) {
            throw new Error(
              "Character document reads require character_id and document."
            );
          }
          return callNamedTool(
            characterQueryTools,
            "read_character",
            toolCallId,
            {
              character_id: params.character_id,
              document: params.document,
              mode: params.mode
            },
            signal
          );
        }
      })
    );
  }
  if (
    worldbuildingMutationTools.length > 0 ||
    characterMutationTools.length > 0
  ) {
    tools.push(
      defineTool({
        name: "create_setting",
        label: "创建设定",
        description:
          "按 domain 创建一个空白设定文件。domain=worldbuilding 在列表型分类中创建一个空白条目并返回 item_id；domain=character 在现有 type_id 下创建一名人物及四份空白文档并返回 character_id。本工具不接受初始化正文。",
        parameters: providerObjectUnion([
          strictObject({
            domain: Type.Literal("worldbuilding"),
            category_id: worldbuildingCategoryIdParameter,
            title: Type.String({ minLength: 1, maxLength: 256 }),
            summary: Type.Optional(
              Type.String({ minLength: 1, maxLength: 1_000 })
            )
          }),
          strictObject({
            domain: Type.Literal("character"),
            name: Type.String({ minLength: 1, maxLength: 256 }),
            type_id: characterTypeIdParameter,
            aliases: Type.Optional(aliasesParameter),
            summary: Type.Optional(
              Type.String({ minLength: 1, maxLength: 1_000 })
            )
          })
        ]),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          if (params.domain === "worldbuilding") {
            return callNamedTool(
              worldbuildingMutationTools,
              "create_worldbuilding_file",
              toolCallId,
              {
                category_id: params.category_id,
                title: params.title,
                summary: params.summary
              },
              signal
            );
          }
          if (params.domain !== "character") {
            throw new Error(
              "create_setting requires domain=worldbuilding or domain=character."
            );
          }
          return callNamedTool(
            characterMutationTools,
            "create_character",
            toolCallId,
            {
              name: params.name,
              type_id: params.type_id,
              aliases: params.aliases,
              summary: params.summary
            },
            signal
          );
        }
      }),
      defineTool({
        name: "write_setting",
        label: "写入设定",
        description:
          "按 domain 覆盖世界观或人物的完整 Markdown。空文件可直接写入；已有正文必须先用 read_setting（mode=full）完整读取并明确 allow_overwrite_existing=true。人物概览指定 document=overview 且省略 character_id。局部修改应使用 edit_setting。",
        parameters: providerObjectUnion([
          strictObject({
            domain: Type.Literal("worldbuilding"),
            category_id: worldbuildingCategoryIdParameter,
            item_id: Type.Optional(worldbuildingItemIdParameter),
            text: Type.String({ minLength: 1, maxLength: 1_000_000 }),
            allow_overwrite_existing: Type.Optional(Type.Boolean()),
            summary: Type.Optional(
              Type.String({ minLength: 1, maxLength: 1_000 })
            )
          }),
          strictObject({
            domain: Type.Literal("character"),
            character_id: Type.Optional(stableIdParameter("character")),
            document: settingCharacterDocumentParameter,
            text: Type.String({ minLength: 1, maxLength: 1_000_000 }),
            allow_overwrite_existing: Type.Optional(Type.Boolean()),
            summary: Type.Optional(
              Type.String({ minLength: 1, maxLength: 1_000 })
            )
          })
        ]),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          if (params.domain === "worldbuilding") {
            return callNamedTool(
              worldbuildingMutationTools,
              "write_worldbuilding_file",
              toolCallId,
              {
                category_id: params.category_id,
                item_id: params.item_id,
                text: params.text,
                allow_overwrite_existing: params.allow_overwrite_existing,
                summary: params.summary
              },
              signal
            );
          }
          if (params.document === "overview") {
            if (params.character_id) {
              throw new Error(
                "Character overview writes must omit character_id."
              );
            }
            return callNamedTool(
              characterMutationTools,
              "write_character_overview",
              toolCallId,
              {
                text: params.text,
                allow_overwrite_existing: params.allow_overwrite_existing,
                summary: params.summary
              },
              signal
            );
          }
          if (!params.character_id) {
            throw new Error(
              "Character document writes require character_id and document."
            );
          }
          return callNamedTool(
            characterMutationTools,
            "write_character_file",
            toolCallId,
            {
              character_id: params.character_id,
              document: params.document,
              text: params.text,
              allow_overwrite_existing: params.allow_overwrite_existing,
              summary: params.summary
            },
            signal
          );
        }
      }),
      defineTool({
        name: "edit_setting",
        label: "编辑设定",
        description:
          "按 domain 在已完整读取的世界观或人物正文中按原文片段精确替换。每个 original_text 必须唯一存在。人物概览指定 document=overview 且省略 character_id。",
        parameters: providerObjectUnion([
          strictObject({
            domain: Type.Literal("worldbuilding"),
            category_id: worldbuildingCategoryIdParameter,
            item_id: Type.Optional(worldbuildingItemIdParameter),
            replacements: Type.Array(
              Type.Object({
                original_text: Type.String({
                  minLength: 1,
                  maxLength: 2_400
                }),
                new_text: Type.String({ maxLength: 20_000 })
              }),
              { minItems: 1, maxItems: 20 }
            ),
            summary: Type.Optional(
              Type.String({ minLength: 1, maxLength: 1_000 })
            )
          }),
          strictObject({
            domain: Type.Literal("character"),
            character_id: Type.Optional(stableIdParameter("character")),
            document: settingCharacterDocumentParameter,
            replacements: Type.Array(
              Type.Object({
                original_text: Type.String({
                  minLength: 1,
                  maxLength: 2_400
                }),
                new_text: Type.String({ maxLength: 20_000 })
              }),
              { minItems: 1, maxItems: 20 }
            ),
            summary: Type.Optional(
              Type.String({ minLength: 1, maxLength: 1_000 })
            )
          })
        ]),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          if (params.domain === "worldbuilding") {
            return callNamedTool(
              worldbuildingMutationTools,
              "edit_worldbuilding_file",
              toolCallId,
              {
                category_id: params.category_id,
                item_id: params.item_id,
                replacements: params.replacements,
                summary: params.summary
              },
              signal
            );
          }
          if (params.document === "overview") {
            if (params.character_id) {
              throw new Error(
                "Character overview edits must omit character_id."
              );
            }
            return callNamedTool(
              characterMutationTools,
              "edit_character_overview",
              toolCallId,
              {
                replacements: params.replacements,
                summary: params.summary
              },
              signal
            );
          }
          if (!params.character_id) {
            throw new Error(
              "Character document edits require character_id and document."
            );
          }
          return callNamedTool(
            characterMutationTools,
            "edit_character_file",
            toolCallId,
            {
              character_id: params.character_id,
              document: params.document,
              replacements: params.replacements,
              summary: params.summary
            },
            signal
          );
        }
      })
    );
  }
  return tools;
}
