import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  LONG_CHARACTER_OVERVIEW_CHANGE_ID, LongSearchCommandEnvelopeSchema, LongSearchResultSchema,
  LongWorkspaceOperationBatchSchema, createEmptyLongMarkdownFileReference, createEnvelope,
  longCharacterCoreProfileFileId, longCharacterCurrentStateFileId, longCharacterFilePath,
  longCharacterHistoryFileId, longCharacterRelationshipsFileId, type LongCharacterFileChange,
  type LongSearchResult, type LongWorkspaceIndexSnapshot, type LongWorkspaceOperation,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import {
  aliasesParameter, characterDocumentParameter, characterTypeIdParameter, stableIdParameter,
  strictObject, titleParameter, worldbuildingReadModeParameter
} from "./schemas";
import { formatCharacterList } from "./formatting";
import { defineTool, maxOrder, nextContentRevision, stableEntityId, stableHash, textResult } from "./shared";
import { longProposalResultSummary, type LongToolContext } from "./context";
import {
  readWholeCharacterDocument, resolveCharacterDocumentTarget, resolveCharacterOverviewTarget
} from "./setting-worldbuilding-tools";

export function buildCharacterSettingTools(ctx: LongToolContext): AgentTool[] {
  const { input, workspace, profile, readableRoots, writableRoots, capabilities, isSettingAgent, isPlotDesignAgent, isDraftWritingAgent, isContinuityLedgerAgent, execute, loadIndex, nextQuerySequence, fullyReadCharacterDocuments, characterDocumentOverlay } = ctx;
  const CHARACTER_DOCUMENT_TITLES = {
    core_profile: "核心档案", relationships: "人物关系", current_state: "当前状态", history: "历史轨迹"
  } as const;
  const assertCharacterDocumentIsDirectlyWritable = (
    index: LongWorkspaceIndexSnapshot,
    document: keyof typeof CHARACTER_DOCUMENT_TITLES
  ) => { void index; void document; };
  const characterQueryTools: AgentTool[] = [];
  if (
    (isSettingAgent ||
      isPlotDesignAgent ||
      isDraftWritingAgent ||
      isContinuityLedgerAgent) &&
    capabilities.has("query_structure") &&
    readableRoots.has("character_design")
  ) {
    characterQueryTools.push(
      defineTool({
        name: "list_characters",
        label: "列出人物",
        description:
          "一次列出当前人物类型目录和全部人物业务索引，可按 type_id 筛选，并自动附带人物设计阶段手动维护的概览完整内容，同时建立本轮 write_character_overview / edit_character_overview 所需的完整读取凭据。按行段落返回稳定 type_id、类型名称、character_id、姓名和别名，不暴露文件与版本信息。",
        parameters: strictObject({
          type_id: Type.Optional(characterTypeIdParameter)
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const pending = new Map<
            string,
            {
              character_id: string;
              name: string;
              type_id: string;
              type_title: string;
              aliases: string[];
            }
          >();
          for (const candidate of characterDocumentOverlay.values()) {
            if (
              !candidate.pendingCreation ||
              candidate.document === "overview" ||
              pending.has(candidate.characterId)
            ) {
              continue;
            }
            pending.set(candidate.characterId, {
              character_id: candidate.characterId,
              name: candidate.characterName,
              type_id: candidate.characterGroup ?? "major_supporting",
              type_title:
                index.characterTypes.find(
                  ({ id }) => id === candidate.characterGroup
                )?.title ?? candidate.characterGroup ?? "主要配角",
              aliases: candidate.aliases ?? []
            });
          }
          const characters = [
            ...index.characters.map((character) => ({
              character_id: character.id,
              name: character.name,
              type_id: character.group,
              type_title:
                index.characterTypes.find(({ id }) => id === character.group)
                  ?.title ?? character.group,
              aliases: character.aliases
            })),
            ...pending.values()
          ].filter(
            (character) =>
              !params.type_id || character.type_id === params.type_id
          );
          if (
            params.type_id &&
            !index.characterTypes.some(({ id }) => id === params.type_id)
          ) {
            throw new Error("The requested character type does not exist.");
          }
          let overview = "";
          if (index.characterOverview) {
            const cached = characterDocumentOverlay.get(
              index.characterOverview.id
            );
            if (cached) {
              overview = cached.content;
              fullyReadCharacterDocuments.set(cached.file.id, {
                content: cached.content,
                file: cached.file,
                workspaceRevision: index.revision,
                projectRevision
              });
            } else {
              const result = await readWholeCharacterDocument(
                ctx,
                index.characterOverview,
                index.revision,
                projectRevision,
                signal
              );
              overview = result.content;
              characterDocumentOverlay.set(result.file.id, {
                characterId: LONG_CHARACTER_OVERVIEW_CHANGE_ID,
                characterName: "人物概览",
                document: "overview",
                file: result.file,
                content: result.content,
                pendingCreation: false
              });
              fullyReadCharacterDocuments.set(result.file.id, {
                content: result.content,
                file: result.file,
                workspaceRevision: index.revision,
                projectRevision
              });
            }
          }
          return textResult(
            formatCharacterList({
              types: [...index.characterTypes]
                .sort((left, right) => left.order - right.order)
                .map((characterType) => ({
                  type_id: characterType.id,
                  title: characterType.title,
                  order: characterType.order,
                  character_count: index.characters.filter(
                    ({ group }) => group === characterType.id
                  ).length
                })),
              overview,
              characters
            })
          );
        }
      }),
      defineTool({
        name: "search_characters",
        label: "搜索人物",
        description:
          "搜索人物四类文档，可按现有 type_id 筛选，返回可继续读取的 character_id、姓名、type_id、类型名称、document 和少量上下文；不返回文件、路径或版本信息。",
        parameters: strictObject({
          query: Type.String({ minLength: 1, maxLength: 256 }),
          type_id: Type.Optional(characterTypeIdParameter),
          document: Type.Optional(characterDocumentParameter),
          page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
          if (
            params.type_id &&
            !index.characterTypes.some(({ id }) => id === params.type_id)
          ) {
            throw new Error("The requested character type does not exist.");
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
                  scope: "character_design",
                  ...(cursor ? { cursor } : {}),
                  limit,
                  maxSnippetCharacters: 320
                },
                {
                  id: `long-query-${input.runId}-character-search-${nextQuerySequence()}`,
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
              candidate.scope !== "character_design" ||
              candidate.hits.some((hit) => hit.root !== "character_design")
            ) {
              throw new Error(
                "Core returned search results outside character design."
              );
            }
            result = candidate;
            cursor = candidate.nextCursor ?? undefined;
          }
          if (!result) {
            return textResult(JSON.stringify({ hits: [], next_page: null }));
          }
          const targets = new Map<
            string,
            {
              character_id: string;
              name: string;
              type_id: string;
              type_title: string;
              document: keyof typeof CHARACTER_DOCUMENT_TITLES;
            }
          >();
          for (const character of index.characters) {
            const files = index.characterFiles.find(
              ({ characterId }) => characterId === character.id
            );
            if (!files) continue;
            targets.set(files.coreProfile.id, {
              character_id: character.id,
              name: character.name,
              type_id: character.group,
              type_title:
                index.characterTypes.find(({ id }) => id === character.group)
                  ?.title ?? character.group,
              document: "core_profile"
            });
            targets.set(files.relationships.id, {
              character_id: character.id,
              name: character.name,
              type_id: character.group,
              type_title:
                index.characterTypes.find(({ id }) => id === character.group)
                  ?.title ?? character.group,
              document: "relationships"
            });
            targets.set(files.currentState.id, {
              character_id: character.id,
              name: character.name,
              type_id: character.group,
              type_title:
                index.characterTypes.find(({ id }) => id === character.group)
                  ?.title ?? character.group,
              document: "current_state"
            });
            targets.set(files.history.id, {
              character_id: character.id,
              name: character.name,
              type_id: character.group,
              type_title:
                index.characterTypes.find(({ id }) => id === character.group)
                  ?.title ?? character.group,
              document: "history"
            });
          }
          const hits = result.hits.flatMap((hit) => {
            const target = targets.get(hit.fileId);
            if (!target) {
              throw new Error("Core returned an unknown character document.");
            }
            if (
              (params.type_id && target.type_id !== params.type_id) ||
              (params.document && target.document !== params.document)
            ) return [];
            return [
              {
                character_id: target.character_id,
                name: target.name,
                type_id: target.type_id,
                type_title: target.type_title,
                document: target.document,
                snippet: hit.snippet
              }
            ];
          });
          return textResult(
            JSON.stringify({
              hits,
              next_page:
                result.nextCursor === null || page >= 100
                  ? null
                  : page + 1
            })
          );
        }
      }),
      defineTool({
        name: "read_character",
        label: "读取人物",
        description:
          "按 character_id 和 document 读取人物内容。mode=preview 只返回摘录，mode=full 会建立本轮后续编辑所需的完整读取凭据。",
        parameters: strictObject({
          character_id: stableIdParameter("character"),
          document: characterDocumentParameter,
          mode: Type.Optional(worldbuildingReadModeParameter)
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const mode = params.mode ?? "full";
          const target = resolveCharacterDocumentTarget(
            index,
            params.character_id,
            params.document,
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
            ...(characterDocumentOverlay.get(result.file.id) ?? {}),
            characterId: params.character_id,
            characterName: target.characterName,
            document: params.document,
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
              `【${target.characterName} / ${CHARACTER_DOCUMENT_TITLES[params.document]}】`,
              mode === "preview"
                ? "预览（不建立整体覆盖凭据）："
                : "正文：",
              "",
              visible || "（正文为空）",
              ...(target.overlay?.pendingCreation
                ? ["", "（本人物为本轮待创建内容，尚未落盘。）"]
                : [])
            ].join("\n")
          );
        }
      })
    );
  }
  const characterMutationTools: AgentTool[] = [];
  if (
    capabilities.has("mutate_structure") &&
    writableRoots.has("character_design")
  ) {
    const proposalResult = (
      batch: LongWorkspaceOperationBatch,
      projectRevision: number,
      summary: string,
      files: LongCharacterFileChange[]
    ) =>
      textResult(
        longProposalResultSummary(
          input,
          "已形成人物文件变更提案，等待客户端审阅与冲突检查。"
        ),
        {
          kind: "long-character-file-proposal" as const,
          bookId: workspace.bookId,
          agentId: profile.id,
          batch,
          baseProjectRevision: projectRevision,
          summary,
          files
        }
      );

    characterMutationTools.push(
      defineTool({
        name: "create_character",
        label: "创建人物",
        description:
          "在现有 type_id 下创建一名人物及核心档案、人物关系、当前状态、历史轨迹四份空白 Markdown 文档，返回稳定 character_id。本工具不接受初始化正文；type_id 必须来自人物类型目录，创建后分别使用 write_character_file。",
        parameters: strictObject({
          name: titleParameter,
          type_id: characterTypeIdParameter,
          aliases: Type.Optional(aliasesParameter),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const pendingCharacterIds = new Set(
            [...characterDocumentOverlay.values()]
              .filter(({ pendingCreation }) => pendingCreation)
              .map(({ characterId }) => characterId)
          );
          const pendingInGroup = new Set(
            [...characterDocumentOverlay.values()]
              .filter(
                (candidate) =>
                  candidate.pendingCreation &&
                  candidate.characterGroup === params.type_id
              )
              .map(({ characterId }) => characterId)
          ).size;
          if (index.characters.length + pendingCharacterIds.size >= 100_000) {
            throw new Error(
              "A long workspace supports at most 100,000 characters."
            );
          }
          if (!index.characterTypes.some(({ id }) => id === params.type_id)) {
            throw new Error("The requested character type does not exist.");
          }
          const name = params.name.trim();
          if (
            index.characters.some((character) => character.name === name) ||
            [...characterDocumentOverlay.values()].some(
              (candidate) =>
                candidate.pendingCreation &&
                candidate.characterName === name
            )
          ) {
            throw new Error(
              "A character with the same name already exists or is pending creation."
            );
          }
          const timestamp = new Date().toISOString();
          const characterId = stableEntityId(
            "character",
            `${workspace.bookId}:${input.runId}:${toolCallId}`
          );
          const files = {
            core_profile: createEmptyLongMarkdownFileReference(
              longCharacterCoreProfileFileId(characterId),
              longCharacterFilePath(characterId, "core-profile.md"),
              timestamp
            ),
            relationships: createEmptyLongMarkdownFileReference(
              longCharacterRelationshipsFileId(characterId),
              longCharacterFilePath(characterId, "relationships.md"),
              timestamp
            ),
            current_state: createEmptyLongMarkdownFileReference(
              longCharacterCurrentStateFileId(characterId),
              longCharacterFilePath(characterId, "current-state.md"),
              timestamp
            ),
            history: createEmptyLongMarkdownFileReference(
              longCharacterHistoryFileId(characterId),
              longCharacterFilePath(characterId, "history.md"),
              timestamp
            )
          };
          const operation: LongWorkspaceOperation = {
            type: "character.create",
            character: {
              id: characterId,
              name,
              group: params.type_id,
              order: maxOrder(
                index.characters
                  .filter(({ group }) => group === params.type_id)
                  .map(({ order }) => order)
              ) + pendingInGroup + 1,
              aliases: params.aliases ?? []
            },
            files: {
              characterId,
              coreProfile: files.core_profile,
              relationships: files.relationships,
              currentState: files.current_state,
              history: files.history
            }
          };
          const changes = (Object.keys(files) as Array<keyof typeof files>).map(
            (document): LongCharacterFileChange => ({
              characterId,
              characterName: name,
              document,
              fileId: files[document].id,
              filePath: files[document].path,
              title: `${name} / ${CHARACTER_DOCUMENT_TITLES[document]}`,
              operation: "create",
              beforeText: "",
              afterText: "",
              beforeRevision: null,
              nextRevision: files[document].revision
            })
          );
          for (const change of changes) {
            const document = change.document as keyof typeof files;
            characterDocumentOverlay.set(change.fileId, {
              characterId,
              characterName: name,
              characterGroup: params.type_id,
              aliases: params.aliases ?? [],
              document,
              file: files[document],
              content: "",
              pendingCreation: true
            });
          }
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [operation],
            documentWrites: []
          });
          const summary = params.summary?.trim() || `创建人物“${name}”`;
          return textResult(
            `${longProposalResultSummary(
              input,
              "已形成一名人物及四份空白文档的创建提案，等待客户端审阅与冲突检查。"
            )}\n${name} → character_id=${characterId}\n同一轮内可立即使用该 character_id 调用 write_setting（domain=character）写入正文。`,
            {
              kind: "long-character-file-proposal",
              bookId: workspace.bookId,
              agentId: profile.id,
              batch,
              baseProjectRevision: projectRevision,
              summary,
              files: changes
            }
          );
        }
      }),
      defineTool({
        name: "write_character_file",
        label: "写入人物文件",
        description:
          "覆盖一名人物的一份完整文档。空文件可直接写入；已有正文必须先用 read_character mode=full 完整读取并明确 allow_overwrite_existing=true。局部修改应使用 edit_character_file。",
        parameters: strictObject({
          character_id: stableIdParameter("character"),
          document: characterDocumentParameter,
          text: Type.String({ minLength: 1, maxLength: 1_000_000 }),
          allow_overwrite_existing: Type.Optional(Type.Boolean()),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          assertCharacterDocumentIsDirectlyWritable(index, params.document);
          const target = resolveCharacterDocumentTarget(
            index,
            params.character_id,
            params.document,
            characterDocumentOverlay
          );
          const live = target.overlay
            ? { file: target.file, content: target.overlay.content }
            : await readWholeCharacterDocument(
                ctx,
                target.file,
                index.revision,
                projectRevision,
                signal
              );
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (live.content.trim() && !evidence) {
            return textResult(
              "未写入：目标已有正文，请先调用 read_setting（domain=character，mode=full）完整读取。"
            );
          }
          if (live.content.trim() && params.allow_overwrite_existing !== true) {
            return textResult(
              "未写入：目标已有正文；局部修改请使用 edit_setting（domain=character），整体重写需设置 allow_overwrite_existing=true。"
            );
          }
          if (
            evidence &&
            (evidence.file.revision !== live.file.revision ||
              evidence.workspaceRevision !== index.revision ||
              evidence.projectRevision !== projectRevision)
          ) {
            throw new Error("Character document changed after it was read.");
          }
          const timestamp = new Date().toISOString();
          const nextRevision = nextContentRevision(
            live.file.revision,
            params.text
          );
          const summary =
            params.summary?.trim() ||
            `写入人物“${target.characterName}”的${CHARACTER_DOCUMENT_TITLES[params.document]}`;
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
          characterDocumentOverlay.set(live.file.id, {
            ...(characterDocumentOverlay.get(live.file.id) ?? {}),
            characterId: params.character_id,
            characterName: target.characterName,
            document: params.document,
            file: nextFile,
            content: params.text,
            pendingCreation: target.overlay?.pendingCreation ?? false
          });
          fullyReadCharacterDocuments.set(live.file.id, {
            content: params.text,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return proposalResult(batch, projectRevision, summary, [
            {
              characterId: params.character_id,
              characterName: target.characterName,
              document: params.document,
              fileId: live.file.id,
              filePath: live.file.path,
              title: `${target.characterName} / ${CHARACTER_DOCUMENT_TITLES[params.document]}`,
              operation: "write",
              beforeText: live.content,
              afterText: params.text,
              beforeRevision: live.file.revision,
              nextRevision
            }
          ]);
        }
      }),
      defineTool({
        name: "edit_character_file",
        label: "编辑人物文件",
        description:
          "在已用 read_character mode=full 完整读取的人物文档中按原文片段精确替换。每个 original_text 必须唯一存在。",
        parameters: strictObject({
          character_id: stableIdParameter("character"),
          document: characterDocumentParameter,
          replacements: Type.Array(
            strictObject({
              original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
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
          assertCharacterDocumentIsDirectlyWritable(index, params.document);
          const target = resolveCharacterDocumentTarget(
            index,
            params.character_id,
            params.document,
            characterDocumentOverlay
          );
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision ||
            evidence.file.revision !== target.file.revision
          ) {
            return textResult(
              "未编辑：请先调用 read_setting（domain=character，mode=full）完整读取目标内容。"
            );
          }
          let content = evidence.content;
          for (const replacement of params.replacements) {
            const first = content.indexOf(replacement.original_text);
            const second = first < 0
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
          const nextRevision = nextContentRevision(
            evidence.file.revision,
            content
          );
          const summary =
            params.summary?.trim() ||
            `局部修改人物“${target.characterName}”的${CHARACTER_DOCUMENT_TITLES[params.document]}`;
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
              nextRevision,
              updatedAt: timestamp,
              reason: summary
            }]
          });
          const nextFile = {
            ...evidence.file,
            revision: nextRevision,
            updatedAt: timestamp
          };
          characterDocumentOverlay.set(evidence.file.id, {
            ...(characterDocumentOverlay.get(evidence.file.id) ?? {}),
            characterId: params.character_id,
            characterName: target.characterName,
            document: params.document,
            file: nextFile,
            content,
            pendingCreation: target.overlay?.pendingCreation ?? false
          });
          fullyReadCharacterDocuments.set(evidence.file.id, {
            content,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return proposalResult(batch, projectRevision, summary, [
            {
              characterId: params.character_id,
              characterName: target.characterName,
              document: params.document,
              fileId: evidence.file.id,
              filePath: evidence.file.path,
              title: `${target.characterName} / ${CHARACTER_DOCUMENT_TITLES[params.document]}`,
              operation: "edit",
              beforeText: evidence.content,
              afterText: content,
              beforeRevision: evidence.file.revision,
              nextRevision
            }
          ]);
        }
      }),
      defineTool({
        name: "write_character_overview",
        label: "写入人物概览",
        description:
          "覆盖人物设计阶段概览。空文件可直接写入；已有正文必须先用 list_characters 完整读取概览并明确 allow_overwrite_existing=true。局部修改应使用 edit_character_overview。概览应持续同步全部人物的 character_id、姓名、分组、别名与一句话定位。",
        parameters: strictObject({
          text: Type.String({ minLength: 1, maxLength: 1_000_000 }),
          allow_overwrite_existing: Type.Optional(Type.Boolean()),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const target = resolveCharacterOverviewTarget(index, characterDocumentOverlay);
          const live = target.overlay
            ? { file: target.file, content: target.overlay.content }
            : await readWholeCharacterDocument(
                ctx,
                target.file,
                index.revision,
                projectRevision,
                signal
              );
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (live.content.trim() && !evidence) {
            return textResult(
              "未写入：目标已有正文，请先调用 read_setting（domain=character，document=overview，mode=full）完整读取概览。"
            );
          }
          if (live.content.trim() && params.allow_overwrite_existing !== true) {
            return textResult(
              "未写入：目标已有正文；局部修改请使用 edit_character_overview，整体重写需设置 allow_overwrite_existing=true。"
            );
          }
          if (
            evidence &&
            (evidence.file.revision !== live.file.revision ||
              evidence.workspaceRevision !== index.revision ||
              evidence.projectRevision !== projectRevision)
          ) {
            throw new Error("Character overview changed after it was read.");
          }
          const timestamp = new Date().toISOString();
          const nextRevision = nextContentRevision(
            live.file.revision,
            params.text
          );
          const summary = params.summary?.trim() || "写入人物概览";
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
          characterDocumentOverlay.set(live.file.id, {
            characterId: LONG_CHARACTER_OVERVIEW_CHANGE_ID,
            characterName: "人物概览",
            document: "overview",
            file: nextFile,
            content: params.text,
            pendingCreation: false
          });
          fullyReadCharacterDocuments.set(live.file.id, {
            content: params.text,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return proposalResult(batch, projectRevision, summary, [
            {
              characterId: LONG_CHARACTER_OVERVIEW_CHANGE_ID,
              characterName: "人物概览",
              document: "overview",
              fileId: live.file.id,
              filePath: live.file.path,
              title: "人物概览",
              operation: "write",
              beforeText: live.content,
              afterText: params.text,
              beforeRevision: live.file.revision,
              nextRevision
            }
          ]);
        }
      }),
      defineTool({
        name: "edit_character_overview",
        label: "编辑人物概览",
        description:
          "在已用 list_characters 完整读取的人物概览中按原文片段精确替换。每个 original_text 必须唯一存在。创建、重命名、改组或删除人物后应同步更新概览。",
        parameters: strictObject({
          replacements: Type.Array(
            strictObject({
              original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
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
          const target = resolveCharacterOverviewTarget(index, characterDocumentOverlay);
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision ||
            evidence.file.revision !== target.file.revision
          ) {
            return textResult(
              "未编辑：请先调用 read_setting（domain=character，document=overview，mode=full）完整读取概览内容。"
            );
          }
          let content = evidence.content;
          for (const replacement of params.replacements) {
            const first = content.indexOf(replacement.original_text);
            const second = first < 0
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
          const nextRevision = nextContentRevision(
            evidence.file.revision,
            content
          );
          const summary = params.summary?.trim() || "局部修改人物概览";
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
              nextRevision,
              updatedAt: timestamp,
              reason: summary
            }]
          });
          const nextFile = {
            ...evidence.file,
            revision: nextRevision,
            updatedAt: timestamp
          };
          characterDocumentOverlay.set(evidence.file.id, {
            characterId: LONG_CHARACTER_OVERVIEW_CHANGE_ID,
            characterName: "人物概览",
            document: "overview",
            file: nextFile,
            content,
            pendingCreation: false
          });
          fullyReadCharacterDocuments.set(evidence.file.id, {
            content,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return proposalResult(batch, projectRevision, summary, [
            {
              characterId: LONG_CHARACTER_OVERVIEW_CHANGE_ID,
              characterName: "人物概览",
              document: "overview",
              fileId: evidence.file.id,
              filePath: evidence.file.path,
              title: "人物概览",
              operation: "edit",
              beforeText: evidence.content,
              afterText: content,
              beforeRevision: evidence.file.revision,
              nextRevision
            }
          ]);
        }
      })
    );
  }
  return [...characterQueryTools, ...characterMutationTools];
}
