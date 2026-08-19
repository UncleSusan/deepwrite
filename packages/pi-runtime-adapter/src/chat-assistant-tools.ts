import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  StringEnum,
  Type,
  type Static,
  type TSchema
} from "@earendil-works/pi-ai";
import {
  LongSearchCommandEnvelopeSchema,
  LongSearchResultSchema,
  createEnvelope,
  getDefaultLongAgentProfile,
  type Book,
  type ChatAssistantRuntimeContext,
  type LongBookSummary
} from "@deepwrite/contracts";
import {
  buildLongWorkspaceTools,
  type LongCommandExecutor
} from "./long-agent-tools";
import { piStrictToolSampling } from "./pi-tool-schema";

type ReadOnlyDetails = { kind: "none" };

function textResult(text: string): AgentToolResult<ReadOnlyDetails> {
  return { content: [{ type: "text", text }], details: { kind: "none" } };
}

function jsonResult(value: unknown): AgentToolResult<ReadOnlyDetails> {
  return textResult(JSON.stringify(value, null, 2));
}

function defineTool<T extends TSchema>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<ReadOnlyDetails>>;
}): AgentTool<T, ReadOnlyDetails> {
  return {
    ...definition,
    ...piStrictToolSampling(definition.parameters)
  };
}

function normalizedQuery(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function page<Value>(
  values: readonly Value[],
  cursor: unknown,
  limit: unknown
) {
  const offset = Math.max(0, Number.parseInt(String(cursor ?? "0"), 10) || 0);
  const size = Math.min(100, Math.max(1, Number(limit ?? 30)));
  return {
    items: values.slice(offset, offset + size),
    next_cursor: offset + size < values.length ? String(offset + size) : null,
    total: values.length
  };
}

function projectSummaries(context: ChatAssistantRuntimeContext) {
  const shortAndScript = context.catalog.books.map((book) => ({
    project_type: book.bookType,
    project_id: book.id,
    title: book.title,
    genre: book.genre,
    status: book.status,
    stage_count: book.plotStages.filter((stage) => stage.enabled).length + 2,
    updated_at: book.updatedAt
  }));
  const long = context.longBooks.map((book) => ({
    project_type: "long" as const,
    project_id: book.id,
    title: book.title,
    genre: book.genre,
    status: book.status,
    stage_count: 5,
    updated_at: book.updatedAt
  }));
  return [...shortAndScript, ...long];
}

function librarySummaries(
  context: ChatAssistantRuntimeContext,
  domain: "material" | "skill"
) {
  const libraries =
    domain === "material" ? context.catalog.materials : context.catalog.skills;
  return libraries.map((library) => ({
    library_id: library.id,
    title: library.title,
    kind: "materialKind" in library ? library.materialKind : library.skillKind,
    library_type:
      "materialType" in library ? library.materialType : library.skillType,
    entry_count: library.entries.length,
    read_only: "readOnly" in library ? library.readOnly === true : false,
    updated_at: library.updatedAt
  }));
}

function buildNormalTools(context: ChatAssistantRuntimeContext): AgentTool[] {
  const listProjects = defineTool({
    name: "list_creation_projects",
    label: "列出创作项目",
    description: "列出本机登记的短篇、剧本和长篇项目元数据，不返回任何正文。",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ maxLength: 200 })),
      project_type: Type.Optional(
        StringEnum(["short", "script", "long"] as const)
      ),
      cursor: Type.Optional(Type.String({ maxLength: 32 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
    }),
    execute: async (_id, params) => {
      const query = normalizedQuery(params.query);
      const values = projectSummaries(context).filter(
        (item) =>
          (!params.project_type || item.project_type === params.project_type) &&
          (!query || item.title.toLocaleLowerCase().includes(query))
      );
      return jsonResult(page(values, params.cursor, params.limit));
    }
  });
  const getProject = defineTool({
    name: "get_creation_project_summary",
    label: "查看项目摘要",
    description: "读取指定创作项目的结构摘要和阶段目录；普通模式不返回正文。",
    parameters: Type.Object({
      project_type: StringEnum(["short", "script", "long"] as const),
      project_id: Type.String({ minLength: 1, maxLength: 512 })
    }),
    execute: async (_id, params) => {
      if (params.project_type === "long") {
        const book = context.longBooks.find(
          (candidate) => candidate.id === params.project_id
        );
        if (!book) return textResult("未找到指定长篇项目。");
        return jsonResult({
          project_type: "long",
          project_id: book.id,
          title: book.title,
          genre: book.genre,
          status: book.status,
          updated_at: book.updatedAt,
          navigation: book.navigation,
          linked_material_ids_by_kind: book.linkedMaterialIdsByKind,
          linked_skill_ids_by_kind: book.linkedSkillIdsByKind
        });
      }
      const book = context.catalog.books.find(
        (candidate) =>
          candidate.id === params.project_id &&
          candidate.bookType === params.project_type
      );
      if (!book) return textResult("未找到指定创作项目。");
      return jsonResult({
        project_type: book.bookType,
        project_id: book.id,
        title: book.title,
        genre: book.genre,
        status: book.status,
        updated_at: book.updatedAt,
        plot_stages: book.plotStages,
        character_format: book.characterStructure.format,
        documents: book.documents.map((document) => ({
          id: document.id,
          title: document.title,
          content_bytes: document.contentBytes,
          updated_at: document.updatedAt
        })),
        draft_sections: book.draft.sections.map((section) => ({
          id: section.id,
          title: section.title,
          word_count_requirement: section.wordCountRequirement,
          body_bytes: section.body.contentBytes,
          character_state_bytes: section.characterState.contentBytes
        })),
        linked_material_ids_by_kind: book.linkedMaterialIdsByKind,
        linked_skill_ids_by_kind: book.linkedSkillIdsByKind
      });
    }
  });

  const libraryTools = (["material", "skill"] as const).flatMap((domain) => {
    const domainLabel = domain === "material" ? "素材" : "技能";
    return [
      defineTool({
        name: `list_${domain}_libraries`,
        label: `列出${domainLabel}库`,
        description: `列出本机${domainLabel}库的元数据和条目数量，不返回库介绍或条目正文。`,
        parameters: Type.Object({
          query: Type.Optional(Type.String({ maxLength: 200 })),
          cursor: Type.Optional(Type.String({ maxLength: 32 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_id, params) => {
          const query = normalizedQuery(params.query);
          const values = librarySummaries(context, domain).filter(
            (item) => !query || item.title.toLocaleLowerCase().includes(query)
          );
          return jsonResult(page(values, params.cursor, params.limit));
        }
      }),
      defineTool({
        name: `get_${domain}_library_summary`,
        label: `查看${domainLabel}库摘要`,
        description: `读取指定${domainLabel}库的元数据和条目目录，不返回正文。`,
        parameters: Type.Object({
          library_id: Type.String({ minLength: 1, maxLength: 512 })
        }),
        execute: async (_id, params) => {
          const libraries =
            domain === "material"
              ? context.catalog.materials
              : context.catalog.skills;
          const library = libraries.find(
            (candidate) => candidate.id === params.library_id
          );
          if (!library) return textResult(`未找到指定${domainLabel}库。`);
          return jsonResult({
            library_id: library.id,
            title: library.title,
            kind:
              "materialKind" in library
                ? library.materialKind
                : library.skillKind,
            library_type:
              "materialType" in library
                ? library.materialType
                : library.skillType,
            updated_at: library.updatedAt,
            entries: library.entries.map((entry) => ({
              id: entry.id,
              title: entry.title,
              stage_id: entry.stageId,
              content_bytes: entry.contentBytes,
              updated_at: entry.updatedAt
            }))
          });
        }
      })
    ];
  });

  const modelTool = defineTool({
    name: "query_model_configs",
    label: "查询模型配置",
    description:
      "查询已配置模型的脱敏信息。不会返回 API Key、Base URL、请求路由或其它凭据。",
    parameters: Type.Object({
      model_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
    }),
    execute: async (_id, params) =>
      jsonResult({
        default_model_id: context.defaultModelId,
        models: params.model_id
          ? context.models.filter((model) => model.id === params.model_id)
          : context.models
      })
  });
  const usageTool = defineTool({
    name: "query_model_usage",
    label: "查询模型用量",
    description:
      "查询发送本轮消息前生成的模型用量汇总；当前尚未完成的调用不包含在内。",
    parameters: Type.Object({
      period: StringEnum(["today", "7d", "30d", "all"] as const),
      model_config_ids: Type.Optional(
        Type.Array(Type.String({ maxLength: 120 }), { maxItems: 100 })
      ),
      modules: Type.Optional(
        Type.Array(Type.String({ maxLength: 120 }), { maxItems: 20 })
      )
    }),
    execute: async (_id, params) => {
      const dashboard = context.usage[params.period];
      const modelIds = params.model_config_ids?.length
        ? new Set(params.model_config_ids)
        : undefined;
      const modules = params.modules?.length
        ? new Set(params.modules)
        : undefined;
      return jsonResult({
        period: params.period,
        generated_at: dashboard.generatedAt,
        totals: dashboard.totals,
        trend_granularity: dashboard.trendGranularity,
        trend: dashboard.trend,
        models: dashboard.models.filter(
          (item) => !modelIds || modelIds.has(item.model.configId)
        ),
        modules: dashboard.modules.filter(
          (item) => !modules || modules.has(item.module)
        ),
        recent_calls: dashboard.recentCalls.filter(
          (item) =>
            (!modelIds || modelIds.has(item.model.configId)) &&
            (!modules || modules.has(item.module))
        )
      });
    }
  });
  return [listProjects, getProject, ...libraryTools, modelTool, usageTool];
}

function bookTextSources(book: Book) {
  return [
    ...book.documents.map((document) => ({
      id: document.id,
      title: document.title,
      kind: "stage" as const,
      content: document.content
    })),
    ...book.draft.sections.flatMap((section) => [
      {
        id: section.body.id,
        title: `${section.title} · 正文`,
        kind: "draft-body" as const,
        content: section.body.content
      },
      {
        id: section.characterState.id,
        title: `${section.title} · 人物状态`,
        kind: "draft-character-state" as const,
        content: section.characterState.content
      }
    ])
  ];
}

function readPage(content: string, offset: number, maxCharacters: number) {
  const safeOffset = Math.min(content.length, Math.max(0, offset));
  const size = Math.min(32_768, Math.max(1, maxCharacters));
  const end = Math.min(content.length, safeOffset + size);
  return {
    offset: safeOffset,
    content: content.slice(safeOffset, end),
    next_offset: end < content.length ? end : null,
    total_characters: content.length
  };
}

function buildShortProjectTools(book: Book): AgentTool[] {
  const sources = bookTextSources(book);
  const listTool = defineTool({
    name: "list_workspace_content",
    label: "列出项目阶段",
    description:
      "列出当前短篇或剧本的阶段、人物文件和正文小节目录，不返回正文。",
    parameters: Type.Object({}),
    execute: async () =>
      jsonResult({
        project_id: book.id,
        project_type: book.bookType,
        title: book.title,
        plot_stages: book.plotStages,
        stage_documents: book.documents.map((item) => ({
          id: item.id,
          title: item.title
        })),
        characters:
          book.characterStructure.format === "list"
            ? book.characterStructure.items
            : [{ id: "character_design", title: "人物设计" }],
        draft_sections: book.draft.sections.map((section) => ({
          id: section.id,
          title: section.title,
          word_count_requirement: section.wordCountRequirement,
          body_document_id: section.body.id,
          character_state_document_id: section.characterState.id
        }))
      })
  });
  const searchTool = defineTool({
    name: "search_workspace_text",
    label: "搜索项目文本",
    description: "在当前锁定的短篇或剧本全部阶段中搜索原文，只返回定位片段。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 600 }),
      document_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
    }),
    execute: async (_id, params) => {
      const query = String(params.query);
      const limit = Math.min(50, Math.max(1, Number(params.max_matches ?? 10)));
      const matches: unknown[] = [];
      for (const source of sources) {
        if (params.document_id && source.id !== params.document_id) continue;
        let cursor = 0;
        while (matches.length < limit) {
          const index = source.content.indexOf(query, cursor);
          if (index < 0) break;
          matches.push({
            document_id: source.id,
            title: source.title,
            kind: source.kind,
            offset: index,
            snippet: source.content.slice(
              Math.max(0, index - 80),
              index + query.length + 80
            )
          });
          cursor = index + Math.max(1, query.length);
        }
        if (matches.length >= limit) break;
      }
      return jsonResult({ project_id: book.id, query, matches });
    }
  });
  const readTool = defineTool({
    name: "read_workspace_content",
    label: "读取项目内容",
    description:
      "按目录返回的 document_id 分页读取当前锁定项目的阶段、人物或正文文件。",
    parameters: Type.Object({
      document_id: Type.String({ minLength: 1, maxLength: 512 }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 32_768 })
      )
    }),
    execute: async (_id, params) => {
      const source = sources.find(
        (candidate) => candidate.id === params.document_id
      );
      if (!source) return textResult("指定文档不属于当前项目或不存在。");
      return jsonResult({
        project_id: book.id,
        document_id: source.id,
        title: source.title,
        kind: source.kind,
        ...readPage(
          source.content,
          Number(params.offset ?? 0),
          Number(params.max_characters ?? 12_000)
        )
      });
    }
  });
  const characters =
    book.characterStructure.format === "list"
      ? book.characterStructure.items
      : [{ id: "character_design", title: "人物设计", order: 1 }];
  const listCharacters = defineTool({
    name: "list_characters",
    label: "列出人物",
    description: "列出当前项目的人物目录。",
    parameters: Type.Object({}),
    execute: async () => jsonResult({ project_id: book.id, characters })
  });
  const searchCharacters = defineTool({
    name: "search_characters",
    label: "搜索人物",
    description: "按姓名或人物正文搜索当前项目人物。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 300 })
    }),
    execute: async (_id, params) => {
      const query = normalizedQuery(params.query);
      const matches = characters.filter((character) => {
        const body =
          sources.find((source) => source.id === character.id)?.content ?? "";
        return (
          character.title.toLocaleLowerCase().includes(query) ||
          body.toLocaleLowerCase().includes(query)
        );
      });
      return jsonResult({ project_id: book.id, matches });
    }
  });
  const readCharacter = defineTool({
    name: "read_character",
    label: "读取人物",
    description: "分页读取当前项目指定人物正文。",
    parameters: Type.Object({
      character_id: Type.String({ minLength: 1, maxLength: 512 }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 32_768 })
      )
    }),
    execute: async (_id, params) => {
      if (!characters.some((item) => item.id === params.character_id)) {
        return textResult("指定人物不属于当前项目。");
      }
      const source = sources.find((item) => item.id === params.character_id);
      if (!source) return textResult("人物正文不存在。");
      return jsonResult({
        project_id: book.id,
        character_id: params.character_id,
        title: source.title,
        ...readPage(
          source.content,
          Number(params.offset ?? 0),
          Number(params.max_characters ?? 12_000)
        )
      });
    }
  });
  const readDraft = defineTool({
    name: "read_draft_sections",
    label: "读取正文小节",
    description: "分页读取当前项目指定正文小节的正文或人物状态文件。",
    parameters: Type.Object({
      section_id: Type.String({ minLength: 1, maxLength: 512 }),
      file: StringEnum(["body", "character_state"] as const),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 32_768 })
      )
    }),
    execute: async (_id, params) => {
      const section = book.draft.sections.find(
        (item) => item.id === params.section_id
      );
      if (!section) return textResult("指定正文小节不属于当前项目。");
      const document =
        params.file === "body" ? section.body : section.characterState;
      return jsonResult({
        project_id: book.id,
        section_id: section.id,
        title: section.title,
        file: params.file,
        ...readPage(
          document.content,
          Number(params.offset ?? 0),
          Number(params.max_characters ?? 12_000)
        )
      });
    }
  });
  return [
    listTool,
    searchTool,
    readTool,
    listCharacters,
    searchCharacters,
    readCharacter,
    readDraft
  ];
}

const LONG_QUERY_TOOL_NAMES = new Set([
  "list_setting",
  "search_setting",
  "read_setting",
  "list_plot_design",
  "search_plot_design",
  "read_plot_design",
  "list_chapters",
  "search_chapters",
  "read_chapter",
  "list_continuity_files",
  "read_continuity_file"
]);

function buildLongProjectTools(input: {
  runId: string;
  sessionId: string;
  book: LongBookSummary;
  executor?: LongCommandExecutor;
}): AgentTool[] {
  const profile = getDefaultLongAgentProfile("plot_design");
  const workspace = {
    bookId: input.book.id,
    title: input.book.title,
    activeRoot: "plot_design" as const,
    activeAgentId: "plot_design" as const,
    workspaceRevision: input.book.projectRevision,
    projectRevision: input.book.projectRevision,
    navigation: input.book.navigation
  };
  const tools = buildLongWorkspaceTools({
    workspace,
    profile,
    sessionId: input.sessionId,
    runId: input.runId,
    ...(input.executor ? { executor: input.executor } : {})
  }).filter((tool) => LONG_QUERY_TOOL_NAMES.has(tool.name));
  tools.push(
    defineTool({
      name: "search_continuity_files",
      label: "搜索连续性文件",
      description:
        "只在当前锁定长篇的连续性阶段搜索，结果不会暴露路径或底层文件标识。",
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 256 }),
        cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
      }),
      execute: async (_id, params, signal) => {
        if (!input.executor) throw new Error("长篇只读查询桥不可用。");
        const command = LongSearchCommandEnvelopeSchema.parse(
          createEnvelope(
            "long.search",
            {
              bookId: input.book.id,
              query: params.query,
              scope: "continuity_ledger",
              ...(params.cursor ? { cursor: params.cursor } : {}),
              limit: params.limit ?? 20,
              maxSnippetCharacters: 320
            },
            {
              id: `chat-project-${input.runId}-continuity-search`,
              context: {
                sessionId: input.sessionId,
                runId: input.runId,
                resourceId: input.book.id
              }
            }
          )
        );
        const result = await input.executor(command, signal);
        if (result.status === "rejected") throw new Error(result.error.message);
        const parsed = LongSearchResultSchema.parse(result.payload);
        return jsonResult({
          query: parsed.query,
          hits: parsed.hits.map((hit) => ({
            title: hit.title,
            start: hit.start,
            end: hit.end,
            snippet: hit.snippet
          })),
          next_cursor: parsed.nextCursor,
          project_revision: parsed.projectRevision
        });
      }
    })
  );
  return tools;
}

export function buildChatAssistantTools(input: {
  runId: string;
  sessionId: string;
  context: ChatAssistantRuntimeContext;
  longCommandExecutor?: LongCommandExecutor;
}): AgentTool[] {
  const tools = buildNormalTools(input.context);
  if (input.context.mode !== "project") return tools;
  if (input.context.projectBook.bookType === "long") {
    return [
      ...tools,
      ...buildLongProjectTools({
        runId: input.runId,
        sessionId: input.sessionId,
        book: input.context.projectBook,
        ...(input.longCommandExecutor
          ? { executor: input.longCommandExecutor }
          : {})
      })
    ];
  }
  return [...tools, ...buildShortProjectTools(input.context.projectBook)];
}
