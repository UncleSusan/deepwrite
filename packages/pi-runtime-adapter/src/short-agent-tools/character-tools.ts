import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  createShortWorkspaceContentRevision,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import {
  readShortDocumentPage,
  recordShortDocumentPage,
  renderShortDocumentPageMetadata,
  SHORT_DOCUMENT_PAGE_DEFAULT_CHARACTERS,
  SHORT_DOCUMENT_PAGE_MAX_CHARACTERS,
  type ShortDocumentReadCoverage
} from "./paging";
import { defineTool } from "./schema";
import {
  replaceText,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolDetails,
  type ShortWorkspaceToolSharedState
} from "./shared";

export function buildCharacterTools(
  input: BuildWritingWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  sharedState: ShortWorkspaceToolSharedState
): AgentTool[] {
  const fullyRead = new Map<string, string>();
  const readCoverage = new Map<string, ShortDocumentReadCoverage>();
  // Older persisted session fixtures can reach the runtime without passing
  // through the latest snapshot parser. Treat an absent structure as the
  // backwards-compatible text format here as well.
  const characterStructure = input.workspace.characterStructure ?? {
    format: "text" as const
  };
  const isList = characterStructure.format === "list";
  const overviewId = "character_design";
  const orderedItems = () =>
    sharedState.characterItemOrder
      .map((id) => sharedState.characterItems.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const resolveTarget = (itemId?: string) => {
    if (!isList) {
      if (itemId) throw new Error("文本样式人物结构不接受 item_id。");
      return {
        documentId: overviewId,
        title: "人物",
        content: stageBodies.get("character_design") ?? "",
        revision: stageRevisions.get("character_design")!,
        itemId: undefined
      };
    }
    if (!itemId) {
      return {
        documentId: overviewId,
        title: "概览",
        content: stageBodies.get("character_design") ?? "",
        revision: stageRevisions.get("character_design")!,
        itemId: undefined
      };
    }
    const item = sharedState.characterItems.get(itemId);
    if (!item) throw new Error("人物条目不存在或已删除。");
    return {
      documentId: item.id,
      title: item.title,
      content: item.content,
      revision: item.revision,
      itemId: item.id
    };
  };
  const updateTarget = (
    target: ReturnType<typeof resolveTarget>,
    text: string,
    summary: string
  ) => {
    const baseRevision = target.revision;
    const revision = createShortWorkspaceContentRevision(text);
    if (target.itemId) {
      const item = sharedState.characterItems.get(target.itemId)!;
      sharedState.characterItems.set(target.itemId, { ...item, content: text, revision });
    } else {
      stageBodies.set("character_design", text);
      stageRevisions.set("character_design", revision);
    }
    fullyRead.set(target.documentId, text);
    return textResult(summary, {
      kind: "workspace-character-file-mutation",
      workspaceId: input.workspace.id,
      stageId: "character_design",
      documentId: target.documentId,
      ...(target.itemId ? { itemId: target.itemId } : {}),
      text,
      baseRevision,
      summary
    });
  };
  const tools: AgentTool[] = [
    defineTool({
      name: "list_characters",
      label: "列出人物",
      description: "列出当前人物结构格式、人物概览和有序人物条目，只返回业务 ID 与标题。",
      parameters: Type.Object({}),
      execute: async () =>
        textResult(JSON.stringify(
          isList
            ? {
                format: "list",
                overview: { title: "概览" },
                items: orderedItems().map(({ id, title }) => ({ item_id: id, title }))
              }
            : { format: "text", title: "人物" },
          null,
          2
        ))
    }),
    defineTool({
      name: "search_characters",
      label: "搜索人物",
      description: "搜索人物文本、概览和条目正文，返回 item_id、标题及少量上下文。",
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 256 }),
        max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
      }),
      execute: async (_id, params) => {
        const query = String(params.query);
        const sources = [
          { title: isList ? "概览" : "人物", content: stageBodies.get("character_design") ?? "" },
          ...(isList
            ? orderedItems().map((item) => ({
                item_id: item.id,
                title: item.title,
                content: item.content
              }))
            : [])
        ];
        const hits = [];
        const max = Number(params.max_matches ?? 20);
        for (const source of sources) {
          const index = source.content.indexOf(query);
          if (index < 0) continue;
          hits.push({
            ...( "item_id" in source ? { item_id: source.item_id } : {}),
            title: source.title,
            snippet: source.content.slice(Math.max(0, index - 100), index + query.length + 100)
          });
          if (hits.length >= max) break;
        }
        return textResult(JSON.stringify({ hits }, null, 2));
      }
    }),
    defineTool({
      name: "read_character",
      label: "读取人物",
      description:
        "读取人物文本。条目样式省略 item_id 读取概览，指定 item_id 读取条目；" +
        "mode=preview 返回首尾摘要，mode=full 分页返回正文。按 next_offset 连续读完所有页后才建立编辑凭据。",
      parameters: Type.Object({
        item_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
        mode: Type.Optional(Type.Union([Type.Literal("preview"), Type.Literal("full")])),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        max_characters: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: SHORT_DOCUMENT_PAGE_MAX_CHARACTERS
          })
        )
      }),
      execute: async (_id, params) => {
        const target = resolveTarget(params.item_id ? String(params.item_id) : undefined);
        const mode = params.mode ?? "full";
        if (mode === "preview") {
          const visible =
            target.content.length > 480
              ? `${target.content.slice(0, 240)}\n\n……\n\n${target.content.slice(-240)}`
              : target.content;
          return textResult(`【${target.title}】\n\n${visible || "（正文为空）"}`);
        }
        const requestedOffset = Number(params.offset ?? 0);
        const page = readShortDocumentPage(
          target.content,
          requestedOffset,
          Number(params.max_characters ?? SHORT_DOCUMENT_PAGE_DEFAULT_CHARACTERS)
        );
        if (requestedOffset > page.totalCharacters) {
          return textResult(
            `未读取：offset ${requestedOffset} 超过「${target.title}」总字符数 ${page.totalCharacters}。`
          );
        }
        if (recordShortDocumentPage(readCoverage, target.documentId, page)) {
          fullyRead.set(target.documentId, target.content);
        }
        return textResult(
          `【${target.title}】\n${renderShortDocumentPageMetadata(page)}\n\n` +
          `${page.content || "（正文为空）"}`
        );
      }
    })
  ];
  if (input.profile.id !== "character_design" || !isList) return tools;

  tools.push(
    defineTool({
      name: "create_character_file",
      label: "创建人物文件",
      description: "创建一个空白人物 Markdown 条目并返回稳定 item_id；随后可立即写入。",
      parameters: Type.Object({ title: Type.String({ minLength: 1, maxLength: 256 }) }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const title = String(params.title).trim();
        if (
          orderedItems().some(
            (item) =>
              item.title.toLocaleLowerCase() === title.toLocaleLowerCase()
          )
        ) {
          throw new Error("已存在同名人物条目。");
        }
        sharedState.pendingCharacterSeq += 1;
        const itemId = `character_${Date.now().toString(36)}_${sharedState.pendingCharacterSeq}`;
        const revision = createShortWorkspaceContentRevision("");
        sharedState.characterItems.set(itemId, {
          id: itemId,
          title,
          order: sharedState.characterItemOrder.length + 1,
          content: "",
          revision,
          provisional: true
        });
        sharedState.characterItemOrder.push(itemId);
        const summary = `已生成人物条目“${title}”的创建提案，等待用户审阅。`;
        return textResult(`${summary}\nitem_id=${itemId}`, {
          kind: "workspace-character-structure-mutation",
          workspaceId: input.workspace.id,
          stageId: "character_design",
          mutation: { type: "createItem", title, provisionalItemId: itemId },
          baseRevision: stageRevisions.get("character_design")!,
          summary
        });
      }
    }),
    defineTool({
      name: "write_character_file",
      label: "写入人物文件",
      description:
        "覆盖人物概览或条目全文。省略 item_id 只写概览（人物一览/索引），指定 item_id 写独立人物卡；不要把完整人物卡或剧情原文整段写入概览。已有内容必须先完整读取并显式允许覆盖。",
      parameters: Type.Object({
        item_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
        text: Type.String({ minLength: 1, maxLength: 200_000 }),
        allow_overwrite_existing: Type.Optional(Type.Boolean())
      }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const target = resolveTarget(params.item_id ? String(params.item_id) : undefined);
        if (target.content.trim() && !fullyRead.has(target.documentId)) {
          return textResult("未写入：目标已有正文，请先用 read_character（mode=full）完整读取。");
        }
        if (target.content.trim() && params.allow_overwrite_existing !== true) {
          return textResult("未写入：整体重写已有正文需设置 allow_overwrite_existing=true。");
        }
        return updateTarget(
          target,
          String(params.text),
          `已生成覆盖“${target.title}”的变更，等待用户审阅。`
        );
      }
    }),
    defineTool({
      name: "edit_character_file",
      label: "编辑人物文件",
      description: "在完整读取的人物概览或条目中按唯一原文片段精确替换。",
      parameters: Type.Object({
        item_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
        replacements: Type.Array(Type.Object({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }), { minItems: 1, maxItems: 20 })
      }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const target = resolveTarget(params.item_id ? String(params.item_id) : undefined);
        if (!fullyRead.has(target.documentId)) {
          return textResult("未编辑：请先用 read_character（mode=full）完整读取目标内容。");
        }
        const result = replaceText(target.content, params.replacements as Array<{ original_text: string; new_text: string }>);
        if (result.error || result.next === undefined) return textResult(`未编辑：${result.error}`);
        return updateTarget(target, result.next, `已生成“${target.title}”的局部变更，等待用户审阅。`);
      }
    }),
    ...buildCharacterStructureMutationTools(input, sharedState, stageRevisions, fullyRead)
  );
  return tools;
}

export function buildCharacterStructureMutationTools(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  fullyRead: Map<string, string>
): AgentTool[] {
  const proposal = (mutation: Extract<ShortWorkspaceToolDetails, { kind: "workspace-character-structure-mutation" }>["mutation"], summary: string) =>
    textResult(summary, {
      kind: "workspace-character-structure-mutation",
      workspaceId: input.workspace.id,
      stageId: "character_design",
      mutation,
      baseRevision: stageRevisions.get("character_design")!,
      summary
    });
  return [
    defineTool({
      name: "rename_character_item",
      label: "修改人物名称",
      description: "修改人物条目标题，不改正文。",
      parameters: Type.Object({ item_id: Type.String({ minLength: 1, maxLength: 512 }), title: Type.String({ minLength: 1, maxLength: 256 }) }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const item = sharedState.characterItems.get(String(params.item_id));
        if (!item) throw new Error("人物条目不存在。");
        const previousTitle = item.title;
        const title = String(params.title).trim();
        if (
          [...sharedState.characterItems.values()].some(
            (candidate) =>
              candidate.id !== item.id &&
              candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
          )
        ) {
          throw new Error("已存在同名人物条目。");
        }
        sharedState.characterItems.set(item.id, { ...item, title });
        return proposal({ type: "updateItem", itemId: item.id, previousTitle, title }, `已生成人物条目改名提案：${previousTitle} → ${title}`);
      }
    }),
    defineTool({
      name: "move_character_item",
      label: "移动人物条目",
      description: "将人物条目上移或下移一位。",
      parameters: Type.Object({ item_id: Type.String({ minLength: 1, maxLength: 512 }), direction: Type.Union([Type.Literal("up"), Type.Literal("down")]) }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const itemId = String(params.item_id);
        const item = sharedState.characterItems.get(itemId);
        if (!item) throw new Error("人物条目不存在。");
        const index = sharedState.characterItemOrder.indexOf(itemId);
        const direction = params.direction as "up" | "down";
        const target = direction === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= sharedState.characterItemOrder.length) throw new Error("人物条目已经位于列表边界。");
        [sharedState.characterItemOrder[index], sharedState.characterItemOrder[target]] = [sharedState.characterItemOrder[target]!, sharedState.characterItemOrder[index]!];
        return proposal({ type: "moveItem", itemId, direction, title: item.title }, `已生成人物条目“${item.title}”的排序提案。`);
      }
    }),
    defineTool({
      name: "delete_character_file",
      label: "删除人物文件",
      description: "删除已完整读取的人物条目及正文；人物概览不能删除。",
      parameters: Type.Object({ item_id: Type.String({ minLength: 1, maxLength: 512 }) }),
      executionMode: "sequential",
      execute: async (_id, params) => {
        const itemId = String(params.item_id);
        const item = sharedState.characterItems.get(itemId);
        if (!item) throw new Error("人物条目不存在。");
        if (!fullyRead.has(itemId)) return textResult("未删除：请先用 read_character（mode=full）完整读取该人物条目。");
        sharedState.characterItems.delete(itemId);
        sharedState.characterItemOrder = sharedState.characterItemOrder.filter((id) => id !== itemId);
        return proposal({ type: "deleteItem", itemId, title: item.title, deletedText: item.content }, `已生成人物条目“${item.title}”的删除提案，等待用户审阅。`);
      }
    })
  ];
}
