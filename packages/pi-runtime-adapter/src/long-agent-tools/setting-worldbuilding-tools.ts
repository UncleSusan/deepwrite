import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  LongReadDocumentCommandEnvelopeSchema,
  LongReadDocumentResultSchema,
  LongSearchCommandEnvelopeSchema,
  LongSearchResultSchema,
  LongWorkspaceOperationBatchSchema,
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  type LongSearchResult,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation,
  type LongWorkspaceOperationBatch,
  type LongWorldbuildingFileChange
} from "@deepwrite/contracts";
import {
  strictObject,
  worldbuildingCategoryIdParameter,
  worldbuildingItemIdParameter,
  worldbuildingReadModeParameter
} from "./schemas";
import {
  formatWorldbuildingCategoryList,
  formatWorldbuildingItemList
} from "./formatting";
import {
  defineTool,
  nextContentRevision,
  stableEntityId,
  stableHash,
  textResult
} from "./shared";
import { longProposalResultSummary, type LongToolContext } from "./context";
import type { LongAgentToolDetails } from "./index";

export function resolveWorldbuildingTarget(
  index: LongWorkspaceIndexSnapshot,
  categoryId: string,
  itemId: string | undefined,
  worldbuildingDocumentOverlay: LongToolContext["worldbuildingDocumentOverlay"]
): {
  categoryTitle: string;
  itemTitle?: string;
  file: LongWorkspaceFileReference;
  overlay?: {
    content: string;
    pendingCreation: boolean;
  };
} {
  const category = index.worldbuilding.find(({ id }) => id === categoryId);
  if (!category) {
    throw new Error(`Worldbuilding category ${categoryId} does not exist.`);
  }
  if (category.format === "text") {
    if (itemId) {
      throw new Error("Text worldbuilding categories do not have items.");
    }
    const overlay = worldbuildingDocumentOverlay.get(category.file.id);
    return {
      categoryTitle: category.title,
      file: overlay?.file ?? category.file,
      ...(overlay
        ? {
            overlay: {
              content: overlay.content,
              pendingCreation: overlay.pendingCreation
            }
          }
        : {})
    };
  }
  if (!itemId) {
    if (!category.overview) {
      throw new Error(
        `Worldbuilding category ${categoryId} does not have an overview file.`
      );
    }
    const overlay = worldbuildingDocumentOverlay.get(category.overview.id);
    return {
      categoryTitle: category.title,
      itemTitle: "概览",
      file: overlay?.file ?? category.overview,
      ...(overlay
        ? {
            overlay: {
              content: overlay.content,
              pendingCreation: overlay.pendingCreation
            }
          }
        : {})
    };
  }
  const pending = [...worldbuildingDocumentOverlay.values()].find(
    (candidate) =>
      candidate.categoryId === categoryId &&
      candidate.itemId === itemId
  );
  const item = category.items.find(({ id }) => id === itemId);
  if (!item && pending) {
    return {
      categoryTitle: pending.categoryTitle,
      ...(pending.itemTitle ? { itemTitle: pending.itemTitle } : {}),
      file: pending.file,
      overlay: {
        content: pending.content,
        pendingCreation: pending.pendingCreation
      }
    };
  }
  if (!item) {
    throw new Error(
      `Worldbuilding item ${itemId} does not exist in ${categoryId}.`
    );
  }
  const overlay = worldbuildingDocumentOverlay.get(item.file.id);
  return {
    categoryTitle: category.title,
    itemTitle: item.title,
    file: overlay?.file ?? item.file,
    ...(overlay
      ? {
          overlay: {
            content: overlay.content,
            pendingCreation: overlay.pendingCreation
          }
        }
      : {})
  };
}

export function resolveCharacterOverviewTarget(
  index: LongWorkspaceIndexSnapshot,
  characterDocumentOverlay: LongToolContext["characterDocumentOverlay"]
): {
  file: LongWorkspaceFileReference;
  overlay?: {
    content: string;
    pendingCreation: boolean;
  };
} {
  if (!index.characterOverview) {
    throw new Error("Character overview file does not exist.");
  }
  const overlay = characterDocumentOverlay.get(index.characterOverview.id);
  return {
    file: overlay?.file ?? index.characterOverview,
    ...(overlay
      ? {
          overlay: {
            content: overlay.content,
            pendingCreation: overlay.pendingCreation
          }
        }
      : {})
  };
}

export function resolveCharacterDocumentTarget(
  index: LongWorkspaceIndexSnapshot,
  characterId: string,
  document:
    | "core_profile"
    | "relationships"
    | "current_state"
    | "history",
  characterDocumentOverlay: LongToolContext["characterDocumentOverlay"]
): {
  characterName: string;
  file: LongWorkspaceFileReference;
  overlay?: {
    content: string;
    pendingCreation: boolean;
  };
} {
  const character = index.characters.find(({ id }) => id === characterId);
  const files = index.characterFiles.find(
    (entry) => entry.characterId === characterId
  );
  const pending = [...characterDocumentOverlay.values()].find(
    (candidate) =>
      candidate.characterId === characterId &&
      candidate.document === document
  );
  if ((!character || !files) && pending) {
    return {
      characterName: pending.characterName,
      file: pending.file,
      overlay: {
        content: pending.content,
        pendingCreation: pending.pendingCreation
      }
    };
  }
  if (!character || !files) {
    throw new Error(`Character ${characterId} does not exist.`);
  }
  const documents = {
    core_profile: files.coreProfile,
    relationships: files.relationships,
    current_state: files.currentState,
    history: files.history
  } as const;
  const file = documents[document];
  const overlay = characterDocumentOverlay.get(file.id);
  return {
    characterName: character.name,
    file: overlay?.file ?? file,
    ...(overlay
      ? {
          overlay: {
            content: overlay.content,
            pendingCreation: overlay.pendingCreation
          }
        }
      : {})
  };
}

export async function readWholeCharacterDocument(
  ctx: LongToolContext,
  file: LongWorkspaceFileReference,
  expectedWorkspaceRevision: number,
  expectedProjectRevision: number,
  signal?: AbortSignal
) {
  let offset = 0;
  let content = "";
  let authoritativeFile = file;
  while (true) {
    const command = LongReadDocumentCommandEnvelopeSchema.parse(
      createEnvelope(
        "long.readDocument",
        {
          bookId: ctx.workspace.bookId,
          fileId: file.id,
          offset,
          maxCharacters: 262_144
        },
        {
          id: `long-query-${ctx.input.runId}-character-${ctx.nextQuerySequence()}`,
          context: {
            sessionId: ctx.input.sessionId,
            runId: ctx.input.runId,
            resourceId: ctx.workspace.bookId
          }
        }
      )
    );
    const result = LongReadDocumentResultSchema.parse(
      await ctx.execute(command, signal)
    );
    if (
      result.bookId !== ctx.workspace.bookId ||
      result.file.id !== file.id ||
      result.file.path !== file.path ||
      result.offset !== offset ||
      result.workspaceRevision !== expectedWorkspaceRevision ||
      result.projectRevision !== expectedProjectRevision
    ) {
      throw new Error("Core returned a different character document.");
    }
    authoritativeFile = result.file;
    content += result.content;
    if (result.nextOffset === null) {
      return { content, file: authoritativeFile };
    }
    offset = result.nextOffset;
  }
}

export function buildWorldbuildingSettingTools(ctx: LongToolContext): AgentTool[] {
  const { input, workspace, profile, readableRoots, writableRoots, capabilities, isSettingAgent, isPlotDesignAgent, isDraftWritingAgent, isContinuityLedgerAgent, execute, loadIndex, nextQuerySequence, fullyReadWorldbuildingDocuments, worldbuildingDocumentOverlay, readWholeWorldbuildingDocument } = ctx;
  const tools: AgentTool[] = [];
  const worldbuildingQueryTools: AgentTool[] = [];
  if (
    (isSettingAgent ||
      isPlotDesignAgent ||
      isDraftWritingAgent ||
      isContinuityLedgerAgent) &&
    capabilities.has("query_structure") &&
    readableRoots.has("worldbuilding")
  ) {
    worldbuildingQueryTools.push(
      defineTool({
        name: "list_worldbuilding",
        label: "列出世界观",
        description:
          "一次列出全部世界观分类；指定 category_id 时列出该列表型分类的全部条目，并自动附带该分类手动维护的概览内容。按行段落返回，顺序就是当前顺序，只显示分类和条目的业务 ID，不显示文件或版本信息。",
        parameters: strictObject({
          category_id: Type.Optional(worldbuildingCategoryIdParameter)
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          if (!params.category_id) {
            const categories = index.worldbuilding.map((category) => {
              const pendingItemCount =
                category.format === "list"
                  ? [...worldbuildingDocumentOverlay.values()].filter(
                      (candidate) =>
                        candidate.pendingCreation &&
                        candidate.categoryId === category.id
                    ).length
                  : 0;
              return {
                category_id: category.id,
                title: category.title,
                format: category.format,
                ...(category.format === "list"
                  ? { item_count: category.items.length + pendingItemCount }
                  : {})
              };
            });
            return textResult(formatWorldbuildingCategoryList(categories));
          }

          const category = index.worldbuilding.find(
            ({ id }) => id === params.category_id
          );
          if (!category) {
            throw new Error(
              `Worldbuilding category ${params.category_id} does not exist.`
            );
          }
          const items =
            category.format === "list"
              ? [
                  ...category.items.map((item) => ({
                    item_id: item.id,
                    title: item.title
                  })),
                  ...[...worldbuildingDocumentOverlay.values()]
                    .filter(
                      (candidate) =>
                        candidate.pendingCreation &&
                        candidate.categoryId === category.id &&
                        candidate.itemId !== undefined
                    )
                    .map((candidate) => ({
                      item_id: candidate.itemId!,
                      title: candidate.itemTitle ?? "未命名条目"
                    }))
                ]
              : [];
          let overview: string | undefined;
          if (category.format === "list" && category.overview) {
            const cached = worldbuildingDocumentOverlay.get(
              category.overview.id
            );
            if (cached) {
              overview = cached.content;
            } else {
              const result = await readWholeWorldbuildingDocument(
                category.overview,
                index.revision,
                projectRevision,
                signal
              );
              overview = result.content;
              worldbuildingDocumentOverlay.set(category.overview.id, {
                categoryId: category.id,
                categoryTitle: category.title,
                itemTitle: "概览",
                file: result.file,
                content: result.content,
                pendingCreation: false
              });
            }
          }
          return textResult(
            formatWorldbuildingItemList({
              category_id: category.id,
              title: category.title,
              format: category.format,
              ...(category.format === "list"
                ? {
                    overview: overview ?? "",
                    items
                  }
                : {})
            })
          );
        }
      }),
      defineTool({
        name: "search_worldbuilding",
        label: "搜索世界观",
        description:
          "在世界观正文中搜索，返回可继续读取的分类/条目 ID、标题和少量命中上下文；不返回文件、路径或版本信息。",
        parameters: strictObject({
          query: Type.String({ minLength: 1, maxLength: 256 }),
          category_id: Type.Optional(worldbuildingCategoryIdParameter),
          page: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 100 })
          ),
          limit: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 100 })
          )
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
          const categoryId = params.category_id;
          if (
            categoryId &&
            !index.worldbuilding.some(({ id }) => id === categoryId)
          ) {
            throw new Error(
              `Worldbuilding category ${categoryId} does not exist.`
            );
          }
          const page = params.page ?? 1;
          const limit = params.limit ?? 20;
          let cursor: string | undefined;
          let result: LongSearchResult | undefined;
          for (let currentPage = 1; currentPage <= page; currentPage += 1) {
            if (currentPage > 1 && !cursor) break;
            const command = LongSearchCommandEnvelopeSchema.parse(
              createEnvelope(
                "long.search",
                {
                  bookId: workspace.bookId,
                  query: params.query,
                  scope: "worldbuilding",
                  ...(cursor ? { cursor } : {}),
                  limit,
                  maxSnippetCharacters: 320
                },
                {
                  id: `long-query-${input.runId}-worldbuilding-search-${nextQuerySequence()}`,
                  context: {
                    sessionId: input.sessionId,
                    runId: input.runId,
                    resourceId: workspace.bookId
                  }
                }
              )
            );
            const candidate = LongSearchResultSchema.parse(
              await execute(command, signal)
            );
            if (
              candidate.bookId !== workspace.bookId ||
              candidate.scope !== "worldbuilding" ||
              candidate.hits.some((hit) => hit.root !== "worldbuilding")
            ) {
              throw new Error("Core returned search results outside worldbuilding.");
            }
            result = candidate;
            cursor = candidate.nextCursor ?? undefined;
          }
          if (!result) {
            return textResult(JSON.stringify({ hits: [], next_page: null }));
          }

          const targets = new Map<
            string,
            { category_id: string; item_id?: string; title: string }
          >();
          for (const category of index.worldbuilding) {
            if (category.format === "text") {
              targets.set(category.file.id, {
                category_id: category.id,
                title: category.title
              });
              continue;
            }
            if (category.overview) {
              targets.set(category.overview.id, {
                category_id: category.id,
                title: `${category.title} / 概览`
              });
            }
            for (const item of category.items) {
              targets.set(item.file.id, {
                category_id: category.id,
                item_id: item.id,
                title: item.title
              });
            }
          }
          const hits = result.hits.flatMap((hit) => {
            const target = targets.get(hit.fileId);
            if (!target) {
              throw new Error("Core returned an unknown worldbuilding document.");
            }
            if (categoryId && target.category_id !== categoryId) return [];
            return [{ ...target, snippet: hit.snippet }];
          });
          return textResult(JSON.stringify({
            hits,
            next_page:
              result.nextCursor === null || page >= 100 ? null : page + 1
          }));
        }
      }),
      defineTool({
        name: "read_worldbuilding",
        label: "读取世界观",
        description:
          "按世界观分类与条目 ID 读取内容。文本型分类省略 item_id；列表型分类省略 item_id 时读取概览，指定 item_id 时读取具体条目。mode=preview 只返回摘录，mode=full 会建立本轮后续编辑所需的完整读取凭据。",
        parameters: strictObject({
          category_id: worldbuildingCategoryIdParameter,
          item_id: Type.Optional(worldbuildingItemIdParameter),
          mode: Type.Optional(worldbuildingReadModeParameter)
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const mode = params.mode ?? "full";
          const target = resolveWorldbuildingTarget(
            index,
            params.category_id,
            params.item_id,
            worldbuildingDocumentOverlay
          );
          const render = (
            content: string,
            pendingCreation: boolean
          ): AgentToolResult<LongAgentToolDetails> => {
            const title = target.itemTitle
              ? `${target.categoryTitle} / ${target.itemTitle}`
              : target.categoryTitle;
            const previewLength = 240;
            const preview =
              content.length <= previewLength * 2
                ? content
                : `${content.slice(0, previewLength)}\n\n……（中间省略 ${content.length - previewLength * 2} 个字符）……\n\n${content.slice(-previewLength)}`;
            return textResult(
              [
                `【${title}】`,
                mode === "preview"
                  ? "预览（不建立整体覆盖凭据）："
                  : "正文：",
                "",
                mode === "preview" ? preview || "（正文为空）" : content || "（正文为空）",
                ...(pendingCreation
                  ? ["", "（本条目为本轮待创建内容，尚未落盘。）"]
                  : [])
              ].join("\n")
            );
          };
          if (target.overlay) {
            if (mode === "full") {
              fullyReadWorldbuildingDocuments.set(target.file.id, {
                content: target.overlay.content,
                file: target.file,
                workspaceRevision: index.revision,
                projectRevision
              });
            }
            return render(
              target.overlay.content,
              target.overlay.pendingCreation
            );
          }
          const result = await readWholeWorldbuildingDocument(
            target.file,
            index.revision,
            projectRevision,
            signal
          );
          worldbuildingDocumentOverlay.set(target.file.id, {
            categoryId: params.category_id,
            categoryTitle: target.categoryTitle,
            ...(params.item_id ? { itemId: params.item_id } : {}),
            ...(target.itemTitle ? { itemTitle: target.itemTitle } : {}),
            file: result.file,
            content: result.content,
            pendingCreation: false
          });
          if (mode === "full") {
            fullyReadWorldbuildingDocuments.set(target.file.id, {
              content: result.content,
              file: result.file,
              workspaceRevision: index.revision,
              projectRevision
            });
          }
          return render(result.content, false);
        }
      })
    );
  }
  const worldbuildingMutationTools: AgentTool[] = [];
  if (
    capabilities.has("mutate_structure") &&
    writableRoots.has("worldbuilding")
  ) {
    const proposalResult = (
      batch: LongWorkspaceOperationBatch,
      projectRevision: number,
      summary: string,
      files: LongWorldbuildingFileChange[]
    ) =>
      textResult(longProposalResultSummary(
        input,
        "已形成世界观文件变更提案，等待客户端审阅与冲突检查。"
      ), {
        kind: "long-worldbuilding-file-proposal" as const,
        bookId: workspace.bookId,
        agentId: profile.id,
        batch,
        baseProjectRevision: projectRevision,
        summary,
        files
      });

    worldbuildingMutationTools.push(
      defineTool({
        name: "create_worldbuilding_file",
        label: "创建世界观文件",
        description:
          "在一个列表型世界观分类中创建一个空白 Markdown 条目文件，并返回稳定 item_id。同一轮可立即把该 item_id 交给 write_worldbuilding_file；本工具不接受也不写入初始化正文。",
        parameters: strictObject({
          category_id: worldbuildingCategoryIdParameter,
          title: Type.String({ minLength: 1, maxLength: 256 }),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const category = index.worldbuilding.find(
            ({ id }) => id === params.category_id
          );
          if (!category || category.format !== "list") {
            throw new Error(
              "Worldbuilding items can only be created in an existing list category."
            );
          }
          const pendingItems = [...worldbuildingDocumentOverlay.values()]
            .filter(
              (candidate) =>
                candidate.pendingCreation &&
                candidate.categoryId === category.id
            );
          if (category.items.length + pendingItems.length >= 10_000) {
            throw new Error(
              "A worldbuilding list category supports at most 10,000 items."
            );
          }
          const title = params.title.trim();
          if (
            category.items.some((item) => item.title === title) ||
            pendingItems.some((item) => item.itemTitle === title)
          ) {
            throw new Error(
              "A worldbuilding file with the same title already exists or is pending creation."
            );
          }
          const timestamp = new Date().toISOString();
          const itemId = stableEntityId(
            "worlditem",
            `${workspace.bookId}:${input.runId}:${toolCallId}`
          );
          const file = createEmptyLongMarkdownFileReference(
            longWorldbuildingItemFileId(itemId),
            longWorldbuildingItemContentPath(category.id, itemId),
            timestamp
          );
          const operation: LongWorkspaceOperation = {
            type: "worldbuildingItem.create",
            categoryId: category.id,
            item: {
              id: itemId,
              title,
              order: category.items.length + pendingItems.length + 1,
              file
            }
          };
          const fileChange: LongWorldbuildingFileChange = {
            categoryId: category.id,
            itemId,
            fileId: file.id,
            filePath: file.path,
            title,
            operation: "create",
            beforeText: "",
            afterText: "",
            beforeRevision: null,
            nextRevision: file.revision
          };
          worldbuildingDocumentOverlay.set(file.id, {
            categoryId: category.id,
            categoryTitle: category.title,
            itemId,
            itemTitle: title,
            file,
            content: "",
            pendingCreation: true
          });
          const summary =
            params.summary?.trim() ||
            `创建世界观文件“${title}”`;
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [operation],
            documentWrites: []
          });
          return textResult(
            `${longProposalResultSummary(
              input,
              "已形成一个空白世界观文件创建提案，等待客户端审阅与冲突检查。"
            )}\n${title} → item_id=${itemId}\n同一轮内可立即使用该 item_id 调用 write_setting（domain=worldbuilding）写入正文。`,
            {
              kind: "long-worldbuilding-file-proposal",
              bookId: workspace.bookId,
              agentId: profile.id,
              batch,
              baseProjectRevision: projectRevision,
              summary,
              files: [fileChange]
            }
          );
        }
      }),
      defineTool({
        name: "write_worldbuilding_file",
        label: "写入世界观文件",
        description:
          "覆盖一个文本型世界观分类、列表型分类概览（省略 item_id）或列表型条目的完整 Markdown 文件。空文件可直接写入；已有正文必须先完整读取并明确 allow_overwrite_existing=true。局部修改应使用 edit_worldbuilding_file。",
        parameters: strictObject({
          category_id: worldbuildingCategoryIdParameter,
          item_id: Type.Optional(worldbuildingItemIdParameter),
          text: Type.String({ minLength: 1, maxLength: 1_000_000 }),
          allow_overwrite_existing: Type.Optional(Type.Boolean()),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const target = resolveWorldbuildingTarget(
            index,
            params.category_id,
            params.item_id,
            worldbuildingDocumentOverlay
          );
          const live = target.overlay
            ? {
                file: target.file,
                content: target.overlay.content
              }
            : await readWholeWorldbuildingDocument(
                target.file,
                index.revision,
                projectRevision,
                signal
              );
          const evidence = fullyReadWorldbuildingDocuments.get(
            target.file.id
          );
          if (live.content.trim() && !evidence) {
            return textResult(
              "未写入：目标已有正文，请先调用 read_setting（domain=worldbuilding，mode=full）完整读取。"
            );
          }
          if (
            live.content.trim() &&
            params.allow_overwrite_existing !== true
          ) {
            return textResult(
              "未写入：目标已有正文；局部修改请使用 edit_setting（domain=worldbuilding），整体重写需设置 allow_overwrite_existing=true。"
            );
          }
          if (
            evidence &&
            (evidence.file.revision !== live.file.revision ||
              evidence.workspaceRevision !== index.revision ||
              evidence.projectRevision !== projectRevision)
          ) {
            throw new Error(
              "Worldbuilding content changed after it was read."
            );
          }
          const timestamp = new Date().toISOString();
          const nextRevision = nextContentRevision(
            live.file.revision,
            params.text
          );
          const summary =
            params.summary?.trim() ||
            `写入世界观“${target.itemTitle ?? target.categoryTitle}”`;
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [],
            documentWrites: [{
              proposalId: `proposal_${stableHash(
                `${workspace.bookId}:${input.runId}:${toolCallId}`
              ).slice(0, 24)}`,
              fileId: live.file.id,
              content: params.text,
              mode: "replace",
              expectedRevision: live.file.revision,
              nextRevision,
              updatedAt: timestamp,
              reason: summary
            }]
          });
          const nextFile = {
            ...live.file,
            revision: nextRevision,
            updatedAt: timestamp
          };
          worldbuildingDocumentOverlay.set(live.file.id, {
            categoryId: params.category_id,
            categoryTitle: target.categoryTitle,
            ...(params.item_id ? { itemId: params.item_id } : {}),
            ...(target.itemTitle ? { itemTitle: target.itemTitle } : {}),
            file: nextFile,
            content: params.text,
            pendingCreation: target.overlay?.pendingCreation ?? false
          });
          fullyReadWorldbuildingDocuments.set(live.file.id, {
            content: params.text,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return proposalResult(batch, projectRevision, summary, [{
            categoryId: params.category_id,
            ...(params.item_id ? { itemId: params.item_id } : {}),
            fileId: live.file.id,
            filePath: live.file.path,
            title: target.itemTitle ?? target.categoryTitle,
            operation: "write",
            beforeText: live.content,
            afterText: params.text,
            beforeRevision: live.file.revision,
            nextRevision
          }]);
        }
      }),
      defineTool({
        name: "edit_worldbuilding_file",
        label: "编辑世界观文件",
        description:
          "在已完整读取的文本型世界观分类、列表型分类概览（省略 item_id）或列表条目中按原文片段精确替换。每个 original_text 必须唯一存在。",
        parameters: strictObject({
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
        executionMode: "sequential",
        execute: async (toolCallId, params) => {
          const { index, projectRevision } = await loadIndex();
          const target = resolveWorldbuildingTarget(
            index,
            params.category_id,
            params.item_id,
            worldbuildingDocumentOverlay
          );
          const evidence = fullyReadWorldbuildingDocuments.get(
            target.file.id
          );
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision ||
            evidence.file.revision !== target.file.revision
          ) {
            return textResult(
              "未编辑：请先调用 read_setting（domain=worldbuilding，mode=full）完整读取目标内容。"
            );
          }
          let content = evidence.content;
          for (const replacement of params.replacements) {
            const first = content.indexOf(replacement.original_text);
            const second =
              first < 0
                ? -1
                : content.indexOf(
                    replacement.original_text,
                    first + replacement.original_text.length
                  );
            if (first < 0 || second >= 0) {
              return textResult(
                `未替换：原文片段必须唯一存在：${replacement.original_text.slice(0, 80)}`
              );
            }
            content =
              content.slice(0, first) +
              replacement.new_text +
              content.slice(first + replacement.original_text.length);
          }
          const timestamp = new Date().toISOString();
          const summary =
            params.summary?.trim() ||
            `局部修改世界观“${target.itemTitle ?? target.categoryTitle}”`;
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [],
            documentWrites: [{
              proposalId: `proposal_${stableHash(
                `${workspace.bookId}:${input.runId}:${toolCallId}`
              ).slice(0, 24)}`,
              fileId: evidence.file.id,
              content,
              mode: "replace",
              expectedRevision: evidence.file.revision,
              nextRevision: nextContentRevision(
                evidence.file.revision,
                content
              ),
              updatedAt: timestamp,
              reason: summary
            }]
          });
          const nextRevision = nextContentRevision(
            evidence.file.revision,
            content
          );
          const nextFile = {
            ...evidence.file,
            revision: nextRevision,
            updatedAt: timestamp
          };
          worldbuildingDocumentOverlay.set(evidence.file.id, {
            categoryId: params.category_id,
            categoryTitle: target.categoryTitle,
            ...(params.item_id ? { itemId: params.item_id } : {}),
            ...(target.itemTitle ? { itemTitle: target.itemTitle } : {}),
            file: nextFile,
            content,
            pendingCreation: target.overlay?.pendingCreation ?? false
          });
          fullyReadWorldbuildingDocuments.set(evidence.file.id, {
            content,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return proposalResult(batch, projectRevision, summary, [{
            categoryId: params.category_id,
            ...(params.item_id ? { itemId: params.item_id } : {}),
            fileId: evidence.file.id,
            filePath: evidence.file.path,
            title: target.itemTitle ?? target.categoryTitle,
            operation: "edit",
            beforeText: evidence.content,
            afterText: content,
            beforeRevision: evidence.file.revision,
            nextRevision
          }]);
        }
      })
    );
  }
  tools.push(...worldbuildingQueryTools, ...worldbuildingMutationTools);
  return tools;
}
