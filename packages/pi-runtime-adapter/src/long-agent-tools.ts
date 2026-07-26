import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { createHash } from "node:crypto";
import { Type, type Static, type TSchema } from "typebox";
import {
  LONG_WORKSPACE_ROOTS,
  MATERIAL_KINDS,
  SKILL_KINDS,
  LongCommitChapterInputSchema,
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  LongReadDocumentCommandEnvelopeSchema,
  LongReadDocumentResultSchema,
  LongSearchCommandEnvelopeSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWorkspaceOperationBatchSchema,
  LongWriteChapterInputSchema,
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  longChapterBodyFileId,
  longChapterCharacterStateFileId,
  longChapterFilePath,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  type CommandResult,
  type LongAgentProfile,
  type LongChapterReadiness,
  type LongCommitChapterInput,
  type LongReadDocumentResult,
  type LongSearchResult,
  type LongWritingScope,
  type LongWorkspaceCommandEnvelope,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation,
  type LongWorkspaceOperationBatch,
  type LongWorkspaceRoot,
  type LongWorkspaceRuntimeContext,
  type LongWriteChapterInput,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "./resolve-attached-skill";

export type LongQueryCommandEnvelope = Extract<
  LongWorkspaceCommandEnvelope,
  {
    type:
      | "long.getWorkspaceIndex"
      | "long.readDocument"
      | "long.search";
  }
>;

export type LongCommandExecutor = (
  command: LongQueryCommandEnvelope,
  signal?: AbortSignal
) => Promise<CommandResult>;

export type LongAgentToolDetails =
  | { kind: "none" }
  | {
      kind: "long-mutation-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      baseProjectRevision: number;
      summary: string;
    }
  | {
      kind: "long-chapter-write-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      input: LongWriteChapterInput;
      summary: string;
    }
  | {
      kind: "long-ledger-commit-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      input: LongCommitChapterInput;
      summary: string;
    }
  | {
      kind: "long-chapter-dispatch-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      scope: LongWritingScope;
      chapterCardId: string;
      title: string;
      chapters: LongChapterReadiness[];
      workspaceRevision: number;
      projectRevision: number;
      summary: string;
    };

export interface BuildLongWorkspaceToolsInput {
  workspace: LongWorkspaceRuntimeContext;
  profile: LongAgentProfile;
  sessionId: string;
  runId: string;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  executor?: LongCommandExecutor;
}

const ALL_ROOTS = new Set<LongWorkspaceRoot>(LONG_WORKSPACE_ROOTS);
const STABLE_ID_SUFFIX_PATTERN =
  "[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?";
const CLIENT_REFERENCE_PATTERN =
  "ref:[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?";

function strictObject<T extends Record<string, TSchema>>(
  properties: T,
  options: Record<string, unknown> = {}
) {
  return Type.Object(properties, {
    additionalProperties: false,
    ...options
  });
}

function stableIdParameter(prefix: string) {
  return Type.String({
    minLength: 3,
    maxLength: 160,
    pattern: `^${prefix}_${STABLE_ID_SUFFIX_PATTERN}$`
  });
}

function entityReferenceParameter(prefix: string) {
  return Type.Union([
    stableIdParameter(prefix),
    Type.String({
      minLength: 5,
      maxLength: 84,
      pattern: `^${CLIENT_REFERENCE_PATTERN}$`
    })
  ]);
}

const clientReferenceParameter = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$"
  })
);
const titleParameter = Type.String({ minLength: 1, maxLength: 256 });
const textParameter = Type.String({ maxLength: 200_000 });
const shortTextParameter = Type.String({ maxLength: 4_000 });
const aliasesParameter = Type.Array(
  Type.String({ minLength: 1, maxLength: 120 }),
  { maxItems: 64, uniqueItems: true }
);
const characterGroupParameter = literalUnion([
  "protagonist",
  "major_supporting",
  "minor_supporting",
  "passerby"
] as const);
const storyTimeModeParameter = literalUnion([
  "exact",
  "relative",
  "sequence",
  "unknown"
] as const);
const connectionTypeParameter = literalUnion([
  "before",
  "same_time",
  "overlaps",
  "causes",
  "enables",
  "conceals"
] as const);
const narrativeModeParameter = literalUnion([
  "scene",
  "flashback",
  "retelling",
  "clue",
  "misdirection",
  "reveal",
  "dream",
  "prophecy"
] as const);
const disclosureParameter = literalUnion([
  "hint",
  "partial",
  "full",
  "false"
] as const);
const beatTypeParameter = literalUnion([
  "source",
  "plant",
  "reinforce",
  "misdirect",
  "partial_reveal",
  "reveal",
  "payoff",
  "aftermath"
] as const);

function patchParameter<T extends Record<string, TSchema>>(
  properties: T
) {
  return strictObject(properties, { minProperties: 1 });
}

const LONG_MUTATION_OPERATION_PARAMETER = Type.Union([
  strictObject({
    type: Type.Literal("worldbuilding.create"),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    format: Type.Optional(literalUnion(["list", "text"] as const))
  }),
  strictObject({
    type: Type.Literal("worldbuilding.update"),
    id: entityReferenceParameter("world"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      format: Type.Optional(literalUnion(["list", "text"] as const))
    })
  }),
  strictObject({
    type: Type.Literal("worldbuilding.delete"),
    id: entityReferenceParameter("world"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("worldbuilding.reorder"),
    orderedIds: Type.Array(entityReferenceParameter("world"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("character.create"),
    client_ref: clientReferenceParameter,
    name: titleParameter,
    group: characterGroupParameter,
    aliases: Type.Optional(aliasesParameter)
  }),
  strictObject({
    type: Type.Literal("character.update"),
    id: entityReferenceParameter("character"),
    patch: patchParameter({
      name: Type.Optional(titleParameter),
      aliases: Type.Optional(aliasesParameter)
    })
  }),
  strictObject({
    type: Type.Literal("character.delete"),
    id: entityReferenceParameter("character"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("character.move"),
    id: entityReferenceParameter("character"),
    toGroup: characterGroupParameter,
    beforeCharacterId: Type.Optional(
      entityReferenceParameter("character")
    )
  }),
  strictObject({
    type: Type.Literal("character.reorder"),
    group: characterGroupParameter,
    orderedIds: Type.Array(entityReferenceParameter("character"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("volume.create"),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    summary: Type.Optional(textParameter)
  }),
  strictObject({
    type: Type.Literal("volume.update"),
    id: entityReferenceParameter("volume"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      summary: Type.Optional(textParameter)
    })
  }),
  strictObject({
    type: Type.Literal("volume.delete"),
    id: entityReferenceParameter("volume"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("volume.reorder"),
    orderedIds: Type.Array(entityReferenceParameter("volume"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("arc.create"),
    client_ref: clientReferenceParameter,
    volumeId: entityReferenceParameter("volume"),
    title: titleParameter,
    outline: Type.Optional(textParameter)
  }),
  strictObject({
    type: Type.Literal("arc.update"),
    id: entityReferenceParameter("arc"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      outline: Type.Optional(textParameter)
    })
  }),
  strictObject({
    type: Type.Literal("arc.delete"),
    id: entityReferenceParameter("arc"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("arc.move"),
    id: entityReferenceParameter("arc"),
    toVolumeId: entityReferenceParameter("volume"),
    beforeArcId: Type.Optional(entityReferenceParameter("arc"))
  }),
  strictObject({
    type: Type.Literal("arc.reorder"),
    volumeId: entityReferenceParameter("volume"),
    orderedIds: Type.Array(entityReferenceParameter("arc"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("chapter.create"),
    client_ref: clientReferenceParameter,
    volumeId: entityReferenceParameter("volume"),
    primaryArcId: entityReferenceParameter("arc"),
    title: titleParameter,
    outline: Type.Optional(textParameter),
    worldConstraints: Type.Optional(textParameter),
    characterIds: Type.Optional(
      Type.Array(entityReferenceParameter("character"), {
        maxItems: 1_024,
        uniqueItems: true
      })
    )
  }),
  strictObject({
    type: Type.Literal("chapter.update"),
    id: entityReferenceParameter("chapter"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      outline: Type.Optional(textParameter),
      worldConstraints: Type.Optional(textParameter),
      characterIds: Type.Optional(
        Type.Array(entityReferenceParameter("character"), {
          maxItems: 1_024,
          uniqueItems: true
        })
      )
    })
  }),
  strictObject({
    type: Type.Literal("chapter.delete"),
    id: entityReferenceParameter("chapter"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("chapter.move"),
    id: entityReferenceParameter("chapter"),
    toVolumeId: entityReferenceParameter("volume"),
    toPrimaryArcId: entityReferenceParameter("arc"),
    beforeChapterCardId: Type.Optional(
      entityReferenceParameter("chapter")
    )
  }),
  strictObject({
    type: Type.Literal("chapter.reorder"),
    volumeId: entityReferenceParameter("volume"),
    orderedIds: Type.Array(entityReferenceParameter("chapter"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("event.create"),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    summary: Type.Optional(textParameter),
    timeMode: storyTimeModeParameter,
    timeLabel: Type.Optional(Type.String({ maxLength: 1_000 })),
    timeValue: Type.Optional(Type.String({ maxLength: 1_000 })),
    location: Type.Optional(Type.String({ maxLength: 1_000 })),
    arcIds: Type.Optional(
      Type.Array(entityReferenceParameter("arc"), {
        maxItems: 1_024,
        uniqueItems: true
      })
    ),
    characterIds: Type.Optional(
      Type.Array(entityReferenceParameter("character"), {
        maxItems: 1_024,
        uniqueItems: true
      })
    )
  }),
  strictObject({
    type: Type.Literal("event.update"),
    id: entityReferenceParameter("event"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      summary: Type.Optional(textParameter),
      timeMode: Type.Optional(storyTimeModeParameter),
      timeLabel: Type.Optional(Type.String({ maxLength: 1_000 })),
      timeValue: Type.Optional(Type.String({ maxLength: 1_000 })),
      location: Type.Optional(Type.String({ maxLength: 1_000 })),
      arcIds: Type.Optional(
        Type.Array(entityReferenceParameter("arc"), {
          maxItems: 1_024,
          uniqueItems: true
        })
      ),
      characterIds: Type.Optional(
        Type.Array(entityReferenceParameter("character"), {
          maxItems: 1_024,
          uniqueItems: true
        })
      )
    })
  }),
  strictObject({
    type: Type.Literal("event.delete"),
    id: entityReferenceParameter("event"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("event.reorder"),
    orderedIds: Type.Array(entityReferenceParameter("event"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("connection.create"),
    client_ref: clientReferenceParameter,
    sourceEventId: entityReferenceParameter("event"),
    targetEventId: entityReferenceParameter("event"),
    connectionType: connectionTypeParameter,
    note: Type.Optional(shortTextParameter)
  }),
  strictObject({
    type: Type.Literal("connection.update"),
    id: entityReferenceParameter("connection"),
    patch: patchParameter({
      sourceEventId: Type.Optional(entityReferenceParameter("event")),
      targetEventId: Type.Optional(entityReferenceParameter("event")),
      connectionType: Type.Optional(connectionTypeParameter),
      note: Type.Optional(shortTextParameter)
    })
  }),
  strictObject({
    type: Type.Literal("connection.delete"),
    id: entityReferenceParameter("connection"),
    cascade: Type.Boolean()
  }),

  strictObject({
    type: Type.Literal("placement.create"),
    client_ref: clientReferenceParameter,
    eventId: entityReferenceParameter("event"),
    chapterCardId: entityReferenceParameter("chapter"),
    mode: narrativeModeParameter,
    disclosure: disclosureParameter,
    writingPrompt: Type.Optional(shortTextParameter)
  }),
  strictObject({
    type: Type.Literal("placement.update"),
    id: entityReferenceParameter("placement"),
    patch: patchParameter({
      eventId: Type.Optional(entityReferenceParameter("event")),
      mode: Type.Optional(narrativeModeParameter),
      disclosure: Type.Optional(disclosureParameter),
      writingPrompt: Type.Optional(shortTextParameter)
    })
  }),
  strictObject({
    type: Type.Literal("placement.delete"),
    id: entityReferenceParameter("placement"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("placement.move"),
    id: entityReferenceParameter("placement"),
    toChapterCardId: entityReferenceParameter("chapter"),
    beforePlacementId: Type.Optional(
      entityReferenceParameter("placement")
    )
  }),
  strictObject({
    type: Type.Literal("placement.reorder"),
    chapterCardId: entityReferenceParameter("chapter"),
    orderedIds: Type.Array(entityReferenceParameter("placement"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("foreshadowing.create"),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    coreQuestion: Type.Optional(textParameter),
    truthEventId: Type.Optional(
      Type.Union([entityReferenceParameter("event"), Type.Null()])
    ),
    expectedReaderEffect: Type.Optional(textParameter),
    status: Type.Optional(Type.Literal("planned"))
  }),
  strictObject({
    type: Type.Literal("foreshadowing.update"),
    id: entityReferenceParameter("foreshadow"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      coreQuestion: Type.Optional(textParameter),
      truthEventId: Type.Optional(
        Type.Union([entityReferenceParameter("event"), Type.Null()])
      ),
      expectedReaderEffect: Type.Optional(textParameter),
      status: Type.Optional(literalUnion(["planned", "abandoned"] as const))
    })
  }),
  strictObject({
    type: Type.Literal("foreshadowing.delete"),
    id: entityReferenceParameter("foreshadow"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("foreshadowing.reorder"),
    orderedIds: Type.Array(entityReferenceParameter("foreshadow"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: Type.Literal("foreshadowingBeat.create"),
    client_ref: clientReferenceParameter,
    threadId: entityReferenceParameter("foreshadow"),
    beatType: beatTypeParameter,
    eventId: Type.Optional(
      Type.Union([entityReferenceParameter("event"), Type.Null()])
    ),
    placementId: Type.Optional(
      Type.Union([entityReferenceParameter("placement"), Type.Null()])
    ),
    chapterCardId: Type.Optional(
      Type.Union([entityReferenceParameter("chapter"), Type.Null()])
    ),
    plannedScope: Type.Optional(Type.String({ maxLength: 1_000 })),
    note: Type.Optional(shortTextParameter)
  }),
  strictObject({
    type: Type.Literal("foreshadowingBeat.update"),
    id: entityReferenceParameter("beat"),
    patch: patchParameter({
      beatType: Type.Optional(beatTypeParameter),
      eventId: Type.Optional(
        Type.Union([entityReferenceParameter("event"), Type.Null()])
      ),
      placementId: Type.Optional(
        Type.Union([entityReferenceParameter("placement"), Type.Null()])
      ),
      chapterCardId: Type.Optional(
        Type.Union([entityReferenceParameter("chapter"), Type.Null()])
      ),
      plannedScope: Type.Optional(Type.String({ maxLength: 1_000 })),
      note: Type.Optional(shortTextParameter)
    })
  }),
  strictObject({
    type: Type.Literal("foreshadowingBeat.delete"),
    id: entityReferenceParameter("beat"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("foreshadowingBeat.move"),
    id: entityReferenceParameter("beat"),
    toThreadId: entityReferenceParameter("foreshadow"),
    beforeBeatId: Type.Optional(entityReferenceParameter("beat"))
  }),
  strictObject({
    type: Type.Literal("foreshadowingBeat.reorder"),
    threadId: entityReferenceParameter("foreshadow"),
    orderedIds: Type.Array(entityReferenceParameter("beat"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  })
]);

const LONG_DOCUMENT_UPDATE_PARAMETER = Type.Union([
  strictObject({
    target: strictObject({ kind: Type.Literal("book_line") }),
    content: Type.String({ maxLength: 10_000_000 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 })
  }),
  strictObject({
    target: strictObject({
      kind: Type.Literal("worldbuilding"),
      categoryId: entityReferenceParameter("world")
    }),
    content: Type.String({ maxLength: 10_000_000 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 })
  }),
  strictObject({
    target: strictObject({
      kind: Type.Literal("character"),
      characterId: entityReferenceParameter("character"),
      role: literalUnion([
        "core_profile",
        "relationships",
        "current_state",
        "history"
      ] as const)
    }),
    content: Type.String({ maxLength: 10_000_000 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 })
  })
]);

const LONG_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_MUTATION_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  document_updates: Type.Optional(
    Type.Array(LONG_DOCUMENT_UPDATE_PARAMETER, { maxItems: 10_000 })
  ),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

function textResult(
  text: string,
  details: LongAgentToolDetails = { kind: "none" }
): AgentToolResult<LongAgentToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function defineTool<T extends ReturnType<typeof Type.Object>>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<LongAgentToolDetails>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, LongAgentToolDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    execute: definition.execute,
    ...(definition.executionMode ? { executionMode: definition.executionMode } : {})
  };
}

function literalUnion<T extends string>(values: readonly T[]) {
  if (values.length === 1) return Type.Literal(values[0]!);
  return Type.Union(values.map((value) => Type.Literal(value)));
}

function buildQueryLinkedMaterialEntriesTool(
  input: BuildLongWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.materialKinds;
  return defineTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description:
      "列出、搜索或读取当前长篇显式绑定且位于本智能体读取范围内的素材。缺失或未绑定的 Catalog 内容不会被猜测。",
    parameters: Type.Object({
      mode: Type.Union([
        Type.Literal("list"),
        Type.Literal("search"),
        Type.Literal("read")
      ]),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_name: Type.Optional(Type.String({ maxLength: 240 })),
      material_kind: Type.Optional(
        literalUnion(allowedKinds.length ? allowedKinds : MATERIAL_KINDS)
      )
    }),
    execute: async (_toolCallId, params) => {
      const items = (input.attachedMaterials ?? []).filter(
        (item) =>
          item.kind !== undefined && allowedKinds.includes(item.kind)
      );
      const kind = params.material_kind
        ? String(params.material_kind)
        : "";
      const scoped = kind
        ? items.filter((item) => item.kind === kind)
        : items;
      if (params.mode === "read") {
        const name = String(
          params.entry_name ?? params.query ?? ""
        ).trim();
        const found = scoped.find((item) => item.title === name);
        return textResult(
          found
            ? `【${found.title}】${found.kind ? `（${found.kind}）` : ""}\n\n${found.content}`
            : "没有找到同名的已绑定长篇素材条目。"
        );
      }
      if (params.mode === "search") {
        const query = String(params.query ?? "").trim();
        const found = scoped.filter(
          (item) =>
            item.title.includes(query) || item.content.includes(query)
        );
        return textResult(
          found.length
            ? found
                .map(
                  (item) =>
                    `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}: ${item.content.slice(0, 220)}`
                )
                .join("\n")
            : "已绑定长篇素材中没有匹配条目。"
        );
      }
      return textResult(
        scoped.length
          ? scoped
              .map(
                (item) =>
                  `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}`
              )
              .join("\n")
          : "本轮没有当前智能体可读的已绑定长篇素材。"
      );
    }
  });
}

function buildLoadSkillTool(
  input: BuildLongWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.skillKinds;
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
        formatLoadSkillToolResult(
          name,
          result,
          attached.filter(isReadable)
        )
      );
    }
  });
}

function abortError(): Error {
  const error = new Error("Long workspace query was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function requireExecutor(
  executor: LongCommandExecutor | undefined
): LongCommandExecutor {
  if (!executor) {
    throw new Error("Long workspace Core bridge is unavailable.");
  }
  return executor;
}

function requireAccepted(result: CommandResult): unknown {
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.payload;
}

function rootForOperation(operation: LongWorkspaceOperation): LongWorkspaceRoot {
  const prefix = operation.type.split(".", 1)[0];
  if (prefix === "worldbuilding") return "worldbuilding";
  if (prefix === "character") return "character_design";
  // Chapter cards are plot structure. Their three Markdown files live under
  // the draft root, but generic structure proposals may only create those
  // empty files; chapter prose is owned by propose_long_chapter_write.
  if (prefix === "chapter") return "plot_design";
  return "plot_design";
}

function createdFileRootForOperation(
  operation: LongWorkspaceOperation
): LongWorkspaceRoot {
  return operation.type === "chapter.create"
    ? "draft"
    : rootForOperation(operation);
}

function filePathBelongsToRoot(
  file: LongWorkspaceFileReference,
  root: LongWorkspaceRoot
): boolean {
  const prefixes: Record<LongWorkspaceRoot, readonly string[]> = {
    worldbuilding: ["long/worldbuilding/"],
    character_design: ["long/characters/"],
    plot_design: ["long/plot/"],
    draft: ["long/chapters/"],
    continuity_ledger: ["long/ledger/"]
  };
  return prefixes[root].some((prefix) => file.path.startsWith(prefix));
}

function addFile(
  map: Map<string, { root: LongWorkspaceRoot; file: LongWorkspaceFileReference }>,
  root: LongWorkspaceRoot,
  file: LongWorkspaceFileReference
): void {
  map.set(file.id, { root, file });
}

function fileRootMap(
  index: LongWorkspaceIndexSnapshot
): Map<string, { root: LongWorkspaceRoot; file: LongWorkspaceFileReference }> {
  const map = new Map<
    string,
    { root: LongWorkspaceRoot; file: LongWorkspaceFileReference }
  >();
  addFile(map, "plot_design", index.bookLine);
  for (const category of index.worldbuilding) {
    addFile(map, "worldbuilding", category.file);
  }
  for (const entry of index.characterFiles) {
    addFile(map, "character_design", entry.coreProfile);
    addFile(map, "character_design", entry.relationships);
    addFile(map, "character_design", entry.currentState);
    addFile(map, "character_design", entry.history);
  }
  for (const entry of index.chapters) {
    addFile(map, "draft", entry.body);
    addFile(map, "draft", entry.characterState);
    addFile(map, "draft", entry.handoff);
  }
  for (const entry of index.ledger.commits) {
    addFile(map, "continuity_ledger", entry.recordFile);
  }
  return map;
}

function collectOperationFiles(
  operation: LongWorkspaceOperation
): LongWorkspaceFileReference[] {
  if (operation.type === "worldbuilding.create") {
    return [operation.category.file];
  }
  if (operation.type === "character.create") {
    return [
      operation.files.coreProfile,
      operation.files.relationships,
      operation.files.currentState,
      operation.files.history
    ];
  }
  if (operation.type === "chapter.create") {
    return [
      operation.files.body,
      operation.files.characterState,
      operation.files.handoff
    ];
  }
  return [];
}

type LongMutationToolParameters = Static<typeof LONG_MUTATION_PARAMETERS>;
type LongMutationToolOperation =
  LongMutationToolParameters["operations"][number];
type LongDocumentUpdateParameter = NonNullable<
  LongMutationToolParameters["document_updates"]
>[number];

const CREATE_OPERATION_PREFIX = {
  "worldbuilding.create": "world",
  "character.create": "character",
  "volume.create": "volume",
  "arc.create": "arc",
  "chapter.create": "chapter",
  "event.create": "event",
  "connection.create": "connection",
  "placement.create": "placement",
  "foreshadowing.create": "foreshadow",
  "foreshadowingBeat.create": "beat"
} as const;

function allEntityIds(index: LongWorkspaceIndexSnapshot): Set<string> {
  return new Set([
    ...index.worldbuilding.map(({ id }) => id),
    ...index.characters.map(({ id }) => id),
    ...index.plot.volumes.map(({ id }) => id),
    ...index.plot.arcs.map(({ id }) => id),
    ...index.plot.chapterCards.map(({ id }) => id),
    ...index.plot.storyEvents.map(({ id }) => id),
    ...index.plot.eventConnections.map(({ id }) => id),
    ...index.plot.narrativePlacements.map(({ id }) => id),
    ...index.plot.foreshadowing.flatMap((thread) => [
      thread.id,
      ...thread.beats.map(({ id }) => id)
    ])
  ]);
}

function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createRuntimeStableId(
  prefix: string,
  seed: string,
  occupied: Set<string>
): string {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const id = `${prefix}_${stableHash(`${seed}:${attempt}`).slice(0, 24)}`;
    if (!occupied.has(id)) {
      occupied.add(id);
      return id;
    }
  }
  throw new Error(`Unable to allocate a stable ${prefix} id.`);
}

function resolveEntityReference(
  value: string,
  prefix: string,
  clientReferences: ReadonlyMap<string, string>
): string {
  if (value.startsWith("ref:")) {
    const resolved = clientReferences.get(value.slice(4));
    if (!resolved) {
      throw new Error(`Unknown long mutation client reference: ${value}`);
    }
    if (!resolved.startsWith(`${prefix}_`)) {
      throw new Error(`Long mutation client reference ${value} has the wrong entity type.`);
    }
    return resolved;
  }
  if (!value.startsWith(`${prefix}_`)) {
    throw new Error(`Expected a ${prefix} entity reference.`);
  }
  return value;
}

function resolveOptionalReference(
  value: string | null | undefined,
  prefix: string,
  clientReferences: ReadonlyMap<string, string>
): string | null | undefined {
  return typeof value === "string"
    ? resolveEntityReference(value, prefix, clientReferences)
    : value;
}

function maxOrder(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function incrementCounter(
  counters: Map<string, number>,
  key: string
): number {
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}

function buildRuntimeOperations(input: {
  rawOperations: LongMutationToolOperation[];
  index: LongWorkspaceIndexSnapshot;
  timestamp: string;
  idSeed: string;
}): {
  operations: LongWorkspaceOperation[];
  clientReferences: ReadonlyMap<string, string>;
} {
  const occupied = allEntityIds(input.index);
  const generatedIds = new Map<number, string>();
  const clientReferences = new Map<string, string>();

  input.rawOperations.forEach((operation, operationIndex) => {
    const prefix =
      CREATE_OPERATION_PREFIX[
        operation.type as keyof typeof CREATE_OPERATION_PREFIX
      ];
    if (!prefix) return;
    const id = createRuntimeStableId(
      prefix,
      `${input.idSeed}:${operationIndex}:${operation.type}`,
      occupied
    );
    generatedIds.set(operationIndex, id);
    const clientRef =
      "client_ref" in operation ? operation.client_ref : undefined;
    if (clientRef) {
      if (clientReferences.has(clientRef)) {
        throw new Error(
          `Duplicate long mutation client reference: ${clientRef}`
        );
      }
      clientReferences.set(clientRef, id);
    }
  });

  let worldOrder = maxOrder(
    input.index.worldbuilding.map(({ order }) => order)
  );
  const characterOrders = new Map(
    (["protagonist", "major_supporting", "minor_supporting", "passerby"] as const)
      .map(
        (group) =>
          [
            group,
            maxOrder(
              input.index.characters
                .filter((character) => character.group === group)
                .map(({ order }) => order)
            )
          ] as const
      )
  );
  let volumeOrder = maxOrder(
    input.index.plot.volumes.map(({ order }) => order)
  );
  const arcOrders = new Map<string, number>();
  for (const arc of input.index.plot.arcs) {
    arcOrders.set(
      arc.volumeId,
      Math.max(arcOrders.get(arc.volumeId) ?? 0, arc.order)
    );
  }
  const chapterOrders = new Map<string, number>();
  for (const chapter of input.index.plot.chapterCards) {
    chapterOrders.set(
      chapter.volumeId,
      Math.max(
        chapterOrders.get(chapter.volumeId) ?? 0,
        chapter.narrativeOrder
      )
    );
  }
  let storyOrder = maxOrder(
    input.index.plot.storyEvents.map(({ storyOrder: order }) => order)
  );
  const placementOrders = new Map<string, number>();
  for (const placement of input.index.plot.narrativePlacements) {
    placementOrders.set(
      placement.chapterCardId,
      Math.max(
        placementOrders.get(placement.chapterCardId) ?? 0,
        placement.orderInChapter
      )
    );
  }
  const beatOrders = new Map<string, number>(
    input.index.plot.foreshadowing.map((thread) => [
      thread.id,
      maxOrder(thread.beats.map(({ order }) => order))
    ])
  );

  const ref = (value: string, prefix: string) =>
    resolveEntityReference(value, prefix, clientReferences);
  const refs = (values: readonly string[], prefix: string) =>
    values.map((value) => ref(value, prefix));
  const optionalRef = (
    value: string | null | undefined,
    prefix: string
  ) => resolveOptionalReference(value, prefix, clientReferences);

  return {
    clientReferences,
    operations: input.rawOperations.map((operation, operationIndex) => {
      const generatedId = generatedIds.get(operationIndex);
      switch (operation.type) {
        case "worldbuilding.create": {
          const id = generatedId!;
          worldOrder += 1;
          return {
            type: operation.type,
            category: {
              id,
              title: operation.title,
              order: worldOrder,
              format: operation.format ?? "text",
              contentAuthority: "markdown",
              file: createEmptyLongMarkdownFileReference(
                longWorldbuildingFileId(id),
                longWorldbuildingContentPath(id),
                input.timestamp
              )
            }
          };
        }
        case "worldbuilding.update":
        case "worldbuilding.delete":
          return {
            ...operation,
            id: ref(operation.id, "world")
          } as LongWorkspaceOperation;
        case "worldbuilding.reorder":
          return {
            type: operation.type,
            orderedIds: refs(operation.orderedIds, "world")
          };

        case "character.create": {
          const id = generatedId!;
          const order = incrementCounter(characterOrders, operation.group);
          return {
            type: operation.type,
            character: {
              id,
              name: operation.name,
              group: operation.group,
              order,
              aliases: operation.aliases ?? []
            },
            files: {
              characterId: id,
              coreProfile: createEmptyLongMarkdownFileReference(
                longCharacterCoreProfileFileId(id),
                longCharacterFilePath(id, "core-profile.md"),
                input.timestamp
              ),
              relationships: createEmptyLongMarkdownFileReference(
                longCharacterRelationshipsFileId(id),
                longCharacterFilePath(id, "relationships.md"),
                input.timestamp
              ),
              currentState: createEmptyLongMarkdownFileReference(
                longCharacterCurrentStateFileId(id),
                longCharacterFilePath(id, "current-state.md"),
                input.timestamp
              ),
              history: createEmptyLongMarkdownFileReference(
                longCharacterHistoryFileId(id),
                longCharacterFilePath(id, "history.md"),
                input.timestamp
              )
            }
          };
        }
        case "character.update":
        case "character.delete":
          return {
            ...operation,
            id: ref(operation.id, "character")
          } as LongWorkspaceOperation;
        case "character.move":
          return {
            type: operation.type,
            id: ref(operation.id, "character"),
            toGroup: operation.toGroup,
            ...(operation.beforeCharacterId
              ? {
                  beforeCharacterId: ref(
                    operation.beforeCharacterId,
                    "character"
                  )
                }
              : {})
          };
        case "character.reorder":
          return {
            type: operation.type,
            group: operation.group,
            orderedIds: refs(operation.orderedIds, "character")
          };

        case "volume.create":
          volumeOrder += 1;
          return {
            type: operation.type,
            volume: {
              id: generatedId!,
              title: operation.title,
              order: volumeOrder,
              summary: operation.summary ?? ""
            }
          };
        case "volume.update":
        case "volume.delete":
          return {
            ...operation,
            id: ref(operation.id, "volume")
          } as LongWorkspaceOperation;
        case "volume.reorder":
          return {
            type: operation.type,
            orderedIds: refs(operation.orderedIds, "volume")
          };

        case "arc.create": {
          const volumeId = ref(operation.volumeId, "volume");
          return {
            type: operation.type,
            arc: {
              id: generatedId!,
              volumeId,
              title: operation.title,
              order: incrementCounter(arcOrders, volumeId),
              outline: operation.outline ?? ""
            }
          };
        }
        case "arc.update":
        case "arc.delete":
          return {
            ...operation,
            id: ref(operation.id, "arc")
          } as LongWorkspaceOperation;
        case "arc.move":
          return {
            type: operation.type,
            id: ref(operation.id, "arc"),
            toVolumeId: ref(operation.toVolumeId, "volume"),
            ...(operation.beforeArcId
              ? { beforeArcId: ref(operation.beforeArcId, "arc") }
              : {})
          };
        case "arc.reorder":
          return {
            type: operation.type,
            volumeId: ref(operation.volumeId, "volume"),
            orderedIds: refs(operation.orderedIds, "arc")
          };

        case "chapter.create": {
          const id = generatedId!;
          const volumeId = ref(operation.volumeId, "volume");
          return {
            type: operation.type,
            chapterCard: {
              id,
              volumeId,
              primaryArcId: ref(operation.primaryArcId, "arc"),
              title: operation.title,
              narrativeOrder: incrementCounter(chapterOrders, volumeId),
              outline: operation.outline ?? "",
              worldConstraints: operation.worldConstraints ?? "",
              characterIds: refs(operation.characterIds ?? [], "character")
            },
            files: {
              chapterCardId: id,
              body: createEmptyLongMarkdownFileReference(
                longChapterBodyFileId(id),
                longChapterFilePath(id, "body.md"),
                input.timestamp
              ),
              characterState: createEmptyLongMarkdownFileReference(
                longChapterCharacterStateFileId(id),
                longChapterFilePath(id, "character-state.md"),
                input.timestamp
              ),
              handoff: createEmptyLongMarkdownFileReference(
                longChapterHandoffFileId(id),
                longChapterFilePath(id, "handoff.md"),
                input.timestamp
              ),
              commitId: null
            }
          };
        }
        case "chapter.update":
          return {
            type: operation.type,
            id: ref(operation.id, "chapter"),
            patch: {
              ...operation.patch,
              ...(operation.patch.characterIds
                ? {
                    characterIds: refs(
                      operation.patch.characterIds,
                      "character"
                    )
                  }
                : {})
            }
          };
        case "chapter.delete":
          return {
            ...operation,
            id: ref(operation.id, "chapter")
          };
        case "chapter.move":
          return {
            type: operation.type,
            id: ref(operation.id, "chapter"),
            toVolumeId: ref(operation.toVolumeId, "volume"),
            toPrimaryArcId: ref(operation.toPrimaryArcId, "arc"),
            ...(operation.beforeChapterCardId
              ? {
                  beforeChapterCardId: ref(
                    operation.beforeChapterCardId,
                    "chapter"
                  )
                }
              : {})
          };
        case "chapter.reorder":
          return {
            type: operation.type,
            volumeId: ref(operation.volumeId, "volume"),
            orderedIds: refs(operation.orderedIds, "chapter")
          };

        case "event.create":
          storyOrder += 1;
          return {
            type: operation.type,
            event: {
              id: generatedId!,
              title: operation.title,
              summary: operation.summary ?? "",
              timeMode: operation.timeMode,
              timeLabel: operation.timeLabel ?? "",
              ...(operation.timeValue !== undefined
                ? { timeValue: operation.timeValue }
                : {}),
              storyOrder,
              location: operation.location ?? "",
              arcIds: refs(operation.arcIds ?? [], "arc"),
              characterIds: refs(
                operation.characterIds ?? [],
                "character"
              )
            }
          };
        case "event.update":
          return {
            type: operation.type,
            id: ref(operation.id, "event"),
            patch: {
              ...operation.patch,
              ...(operation.patch.arcIds
                ? { arcIds: refs(operation.patch.arcIds, "arc") }
                : {}),
              ...(operation.patch.characterIds
                ? {
                    characterIds: refs(
                      operation.patch.characterIds,
                      "character"
                    )
                  }
                : {})
            }
          };
        case "event.delete":
          return {
            ...operation,
            id: ref(operation.id, "event")
          };
        case "event.reorder":
          return {
            type: operation.type,
            orderedIds: refs(operation.orderedIds, "event")
          };

        case "connection.create":
          return {
            type: operation.type,
            connection: {
              id: generatedId!,
              sourceEventId: ref(operation.sourceEventId, "event"),
              targetEventId: ref(operation.targetEventId, "event"),
              type: operation.connectionType,
              note: operation.note ?? ""
            }
          };
        case "connection.update": {
          const { connectionType, ...patch } = operation.patch;
          return {
            type: operation.type,
            id: ref(operation.id, "connection"),
            patch: {
              ...patch,
              ...(patch.sourceEventId
                ? { sourceEventId: ref(patch.sourceEventId, "event") }
                : {}),
              ...(patch.targetEventId
                ? { targetEventId: ref(patch.targetEventId, "event") }
                : {}),
              ...(connectionType !== undefined
                ? { type: connectionType }
                : {})
            }
          };
        }
        case "connection.delete":
          return {
            ...operation,
            id: ref(operation.id, "connection")
          };

        case "placement.create": {
          const chapterCardId = ref(
            operation.chapterCardId,
            "chapter"
          );
          return {
            type: operation.type,
            placement: {
              id: generatedId!,
              eventId: ref(operation.eventId, "event"),
              chapterCardId,
              orderInChapter: incrementCounter(
                placementOrders,
                chapterCardId
              ),
              mode: operation.mode,
              disclosure: operation.disclosure,
              writingPrompt: operation.writingPrompt ?? "",
              status: "planned",
              commitId: null
            }
          };
        }
        case "placement.update":
          return {
            type: operation.type,
            id: ref(operation.id, "placement"),
            patch: {
              ...operation.patch,
              ...(operation.patch.eventId
                ? { eventId: ref(operation.patch.eventId, "event") }
                : {})
            }
          };
        case "placement.delete":
          return {
            ...operation,
            id: ref(operation.id, "placement")
          };
        case "placement.move":
          return {
            type: operation.type,
            id: ref(operation.id, "placement"),
            toChapterCardId: ref(
              operation.toChapterCardId,
              "chapter"
            ),
            ...(operation.beforePlacementId
              ? {
                  beforePlacementId: ref(
                    operation.beforePlacementId,
                    "placement"
                  )
                }
              : {})
          };
        case "placement.reorder":
          return {
            type: operation.type,
            chapterCardId: ref(operation.chapterCardId, "chapter"),
            orderedIds: refs(operation.orderedIds, "placement")
          };

        case "foreshadowing.create":
          beatOrders.set(generatedId!, 0);
          return {
            type: operation.type,
            thread: {
              id: generatedId!,
              title: operation.title,
              coreQuestion: operation.coreQuestion ?? "",
              truthEventId:
                optionalRef(operation.truthEventId, "event") ?? null,
              expectedReaderEffect: operation.expectedReaderEffect ?? "",
              status: operation.status ?? "planned",
              beats: []
            }
          };
        case "foreshadowing.update":
          return {
            type: operation.type,
            id: ref(operation.id, "foreshadow"),
            patch: {
              ...operation.patch,
              ...(operation.patch.truthEventId !== undefined
                ? {
                    truthEventId: optionalRef(
                      operation.patch.truthEventId,
                      "event"
                    )
                  }
                : {})
            }
          };
        case "foreshadowing.delete":
          return {
            ...operation,
            id: ref(operation.id, "foreshadow")
          };
        case "foreshadowing.reorder":
          return {
            type: operation.type,
            orderedIds: refs(operation.orderedIds, "foreshadow")
          };

        case "foreshadowingBeat.create": {
          const threadId = ref(operation.threadId, "foreshadow");
          return {
            type: operation.type,
            threadId,
            beat: {
              id: generatedId!,
              type: operation.beatType,
              order: incrementCounter(beatOrders, threadId),
              eventId: optionalRef(operation.eventId, "event") ?? null,
              placementId:
                optionalRef(operation.placementId, "placement") ?? null,
              chapterCardId:
                optionalRef(operation.chapterCardId, "chapter") ?? null,
              plannedScope: operation.plannedScope ?? "",
              note: operation.note ?? "",
              status: "planned",
              commitId: null
            }
          };
        }
        case "foreshadowingBeat.update": {
          const {
            beatType,
            eventId,
            placementId,
            chapterCardId,
            ...patch
          } = operation.patch;
          return {
            type: operation.type,
            id: ref(operation.id, "beat"),
            patch: {
              ...patch,
              ...(beatType !== undefined ? { type: beatType } : {}),
              ...(eventId !== undefined
                ? { eventId: optionalRef(eventId, "event") }
                : {}),
              ...(placementId !== undefined
                ? {
                    placementId: optionalRef(
                      placementId,
                      "placement"
                    )
                  }
                : {}),
              ...(chapterCardId !== undefined
                ? {
                    chapterCardId: optionalRef(
                      chapterCardId,
                      "chapter"
                    )
                  }
                : {})
            }
          };
        }
        case "foreshadowingBeat.delete":
          return {
            ...operation,
            id: ref(operation.id, "beat")
          };
        case "foreshadowingBeat.move":
          return {
            type: operation.type,
            id: ref(operation.id, "beat"),
            toThreadId: ref(operation.toThreadId, "foreshadow"),
            ...(operation.beforeBeatId
              ? {
                  beforeBeatId: ref(
                    operation.beforeBeatId,
                    "beat"
                  )
                }
              : {})
          };
        case "foreshadowingBeat.reorder":
          return {
            type: operation.type,
            threadId: ref(operation.threadId, "foreshadow"),
            orderedIds: refs(operation.orderedIds, "beat")
          };
      }
    })
  };
}

function nextContentRevision(
  currentRevision: string,
  content: string
): string {
  if (!/^(?:v1|v2):\d+:[0-9a-f]+$/u.test(currentRevision)) {
    throw new Error("The current long document has an invalid revision.");
  }
  return `v2:${new TextEncoder().encode(content).byteLength}:${stableHash(
    content
  )}`;
}

function resolveDocumentUpdateTarget(
  update: LongDocumentUpdateParameter,
  index: LongWorkspaceIndexSnapshot,
  clientReferences: ReadonlyMap<string, string>
): {
  root: LongWorkspaceRoot;
  file: LongWorkspaceFileReference;
} {
  if (update.target.kind === "book_line") {
    return { root: "plot_design", file: index.bookLine };
  }
  if (update.target.kind === "worldbuilding") {
    const categoryId = resolveEntityReference(
      update.target.categoryId,
      "world",
      clientReferences
    );
    const category = index.worldbuilding.find(({ id }) => id === categoryId);
    if (!category) {
      throw new Error(
        "New worldbuilding documents remain empty until the proposal is applied; update them in a later run."
      );
    }
    return { root: "worldbuilding", file: category.file };
  }
  if (update.target.kind !== "character") {
    throw new Error(
      "Draft and ledger documents are not valid generic mutation targets."
    );
  }
  const characterId = resolveEntityReference(
    update.target.characterId,
    "character",
    clientReferences
  );
  const files = index.characterFiles.find(
    (entry) => entry.characterId === characterId
  );
  if (!files) {
    throw new Error(
      "New character documents remain empty until the proposal is applied; update them in a later run."
    );
  }
  const roles = {
    core_profile: files.coreProfile,
    relationships: files.relationships,
    current_state: files.currentState,
    history: files.history
  } as const;
  return {
    root: "character_design",
    file: roles[update.target.role]
  };
}

function buildRuntimeDocumentWrites(input: {
  updates: readonly LongDocumentUpdateParameter[];
  index: LongWorkspaceIndexSnapshot;
  clientReferences: ReadonlyMap<string, string>;
  writableRoots: ReadonlySet<LongWorkspaceRoot>;
  liveRevisions: ReadonlyMap<string, string>;
  timestamp: string;
  idSeed: string;
}): LongWorkspaceOperationBatch["documentWrites"] {
  const seenFileIds = new Set<string>();
  return input.updates.map((update, updateIndex) => {
    const target = resolveDocumentUpdateTarget(
      update,
      input.index,
      input.clientReferences
    );
    if (
      target.root === "draft" ||
      !input.writableRoots.has(target.root)
    ) {
      throw new Error(
        "Document update proposal is outside the agent's write roots."
      );
    }
    if (seenFileIds.has(target.file.id)) {
      throw new Error(
        `A mutation proposal may update ${target.file.id} only once.`
      );
    }
    seenFileIds.add(target.file.id);
    const expectedRevision =
      input.liveRevisions.get(target.file.id) ?? target.file.revision;
    return {
      proposalId: `proposal_${stableHash(
        `${input.idSeed}:document:${updateIndex}`
      ).slice(0, 24)}`,
      fileId: target.file.id,
      content: update.content,
      mode: "replace" as const,
      expectedRevision,
      nextRevision: nextContentRevision(
        expectedRevision,
        update.content
      ),
      updatedAt: input.timestamp,
      reason: update.reason.trim()
    };
  });
}

function projectIndex(
  index: LongWorkspaceIndexSnapshot,
  projectRevision: number,
  allowedRoots: ReadonlySet<LongWorkspaceRoot>
): Record<string, unknown> {
  const roots: Partial<Record<LongWorkspaceRoot, unknown>> = {};
  if (allowedRoots.has("worldbuilding")) {
    roots.worldbuilding = { categories: index.worldbuilding };
  }
  if (allowedRoots.has("character_design")) {
    roots.character_design = {
      characters: index.characters,
      files: index.characterFiles
    };
  }
  if (allowedRoots.has("plot_design")) {
    roots.plot_design = {
      bookLine: index.bookLine,
      plot: index.plot
    };
  }
  if (allowedRoots.has("draft")) {
    roots.draft = {
      chapterCards: index.plot.chapterCards,
      chapters: index.chapters
    };
  }
  if (allowedRoots.has("continuity_ledger")) {
    roots.continuity_ledger = { ledger: index.ledger };
  }
  return {
    bookId: index.bookId,
    workspaceRevision: index.revision,
    projectRevision,
    updatedAt: index.updatedAt,
    roots
  };
}

export function isLongAgentToolDetails(
  value: unknown
): value is LongAgentToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "none" ||
    kind === "long-mutation-proposal" ||
    kind === "long-chapter-write-proposal" ||
    kind === "long-ledger-commit-proposal" ||
    kind === "long-chapter-dispatch-proposal"
  );
}

function orderedLongChapterCards(
  index: LongWorkspaceIndexSnapshot
): LongWorkspaceIndexSnapshot["plot"]["chapterCards"] {
  const volumeOrder = new Map(
    index.plot.volumes.map((volume) => [volume.id, volume.order])
  );
  return [...index.plot.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  );
}

/** @internal Exported for deterministic ordering regression tests. */
export function selectNextLongChapterForDispatch(
  index: LongWorkspaceIndexSnapshot
): LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number] | undefined {
  return orderedLongChapterCards(index)[index.ledger.commits.length];
}

export interface SelectLongWritingScopeInput {
  scope: LongWritingScope;
  chapterCardId?: string;
  arcId?: string;
  volumeId?: string;
}

/**
 * Resolves only a continuous, uncommitted prefix. Arc and volume scheduling
 * deliberately stop at the first chapter outside the requested scope so the
 * coordinator can never skip an intervening chapter.
 */
export function selectLongChaptersForWritingScope(
  index: LongWorkspaceIndexSnapshot,
  input: SelectLongWritingScopeInput
): LongWorkspaceIndexSnapshot["plot"]["chapterCards"] {
  if (
    input.scope !== "chapter" &&
    input.scope !== "arc" &&
    input.scope !== "volume"
  ) {
    throw new Error(
      "Long writing scope must be chapter, arc, or volume; whole-book scheduling is not supported."
    );
  }
  const ordered = orderedLongChapterCards(index);
  const firstIndex = index.ledger.commits.length;
  const first = ordered[firstIndex];
  if (!first) return [];

  if (input.scope === "chapter") {
    if (input.chapterCardId && input.chapterCardId !== first.id) {
      throw new Error(
        "Chapter writing must start from the continuous next chapter."
      );
    }
    return [first];
  }

  if (input.scope === "arc") {
    const arcId = input.arcId ?? first.primaryArcId ?? undefined;
    if (!arcId || first.primaryArcId !== arcId) {
      throw new Error(
        "Arc writing must target the continuous next chapter's primary arc."
      );
    }
    const chapters: typeof ordered = [];
    for (const chapter of ordered.slice(firstIndex)) {
      if (
        chapter.volumeId !== first.volumeId ||
        chapter.primaryArcId !== arcId
      ) {
        break;
      }
      chapters.push(chapter);
    }
    return chapters;
  }

  const volumeId = input.volumeId ?? first.volumeId;
  if (volumeId !== first.volumeId) {
    throw new Error(
      "Volume writing must target the continuous next chapter's volume."
    );
  }
  const chapters: typeof ordered = [];
  for (const chapter of ordered.slice(firstIndex)) {
    if (chapter.volumeId !== volumeId) break;
    chapters.push(chapter);
  }
  return chapters;
}

export function classifyLongChapterReadiness(
  input: {
    chapterCardId: string;
    title: string;
    body: string;
    characterState: string;
    handoff: string;
  }
): LongChapterReadiness {
  const missingFiles: LongChapterReadiness["missingFiles"] = [];
  if (!input.body.trim()) missingFiles.push("body");
  if (!input.characterState.trim()) missingFiles.push("character_state");
  if (!input.handoff.trim()) missingFiles.push("handoff");
  return {
    chapterCardId: input.chapterCardId,
    title: input.title,
    status:
      missingFiles.length === 3
        ? "empty"
        : missingFiles.length === 0
          ? "ready_to_commit"
          : "partial",
    missingFiles
  };
}

export function buildLongWorkspaceTools(
  input: BuildLongWorkspaceToolsInput
): AgentTool[] {
  const { workspace, profile } = input;
  if (
    profile.workspaceType !== "long" ||
    profile.id !== workspace.activeAgentId
  ) {
    throw new Error("Long agent profile does not match the active workspace agent.");
  }

  const readableRoots = new Set(profile.readAccess.workspaceRoots);
  const writableRoots = new Set(profile.writeAccess.workspaceRoots);
  const capabilities = new Set(profile.writeAccess.capabilities);
  const tools: AgentTool[] = [
    buildQueryLinkedMaterialEntriesTool(input),
    buildLoadSkillTool(input)
  ];
  let indexPromise:
    | Promise<{
        index: LongWorkspaceIndexSnapshot;
        projectRevision: number;
      }>
    | undefined;

  const execute = async (
    command: LongQueryCommandEnvelope,
    signal?: AbortSignal
  ): Promise<unknown> => {
    throwIfAborted(signal);
    const result = await requireExecutor(input.executor)(command, signal);
    throwIfAborted(signal);
    return requireAccepted(result);
  };

  const loadIndex = async (
    signal?: AbortSignal
  ): Promise<{
    index: LongWorkspaceIndexSnapshot;
    projectRevision: number;
  }> => {
    if (!indexPromise) {
      const command = LongGetWorkspaceIndexCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.getWorkspaceIndex",
          { bookId: workspace.bookId },
          {
            id: `long-query-${input.runId}-index`,
            context: {
              sessionId: input.sessionId,
              runId: input.runId,
              resourceId: workspace.bookId
            }
          }
        )
      );
      indexPromise = execute(command, signal)
        .then((payload) => LongWorkspaceIndexResultSchema.parse(payload))
        .then((result) => {
          if (result.bookId !== workspace.bookId) {
            throw new Error("Core returned a workspace index for another book.");
          }
          return {
            index: result.workspaceIndex,
            projectRevision: result.projectRevision
          };
        })
        .catch((error) => {
          indexPromise = undefined;
          throw error;
        });
    }
    const value = await indexPromise;
    throwIfAborted(signal);
    return value;
  };

  const loadActiveChapterMutationContext = async (
    signal?: AbortSignal
  ): Promise<{
    index: LongWorkspaceIndexSnapshot;
    projectRevision: number;
    activeChapterCardId: string;
    chapter: LongWorkspaceIndexSnapshot["chapters"][number];
  }> => {
    const { index, projectRevision } = await loadIndex(signal);
    const activeChapterCardId = workspace.activeChapterCardId;
    if (!activeChapterCardId) {
      throw new Error("Long workspace context has no active chapter.");
    }
    if (
      workspace.navigation.bookId !== index.bookId ||
      workspace.workspaceRevision !== index.revision ||
      workspace.navigation.revision !== index.revision ||
      workspace.projectRevision !== projectRevision ||
      workspace.navigation.committedThroughChapterId !==
        index.ledger.committedThroughChapterId
    ) {
      throw new Error(
        "Long workspace context no longer matches the loaded workspace index."
      );
    }

    const chapterCard = index.plot.chapterCards.find(
      (candidate) => candidate.id === activeChapterCardId
    );
    const navigationChapterCard = workspace.navigation.chapterCards.find(
      (candidate) => candidate.id === activeChapterCardId
    );
    const chapter = index.chapters.find(
      (candidate) => candidate.chapterCardId === activeChapterCardId
    );
    if (
      !chapterCard ||
      !navigationChapterCard ||
      !chapter ||
      navigationChapterCard.volumeId !== chapterCard.volumeId ||
      navigationChapterCard.primaryArcId !== chapterCard.primaryArcId ||
      navigationChapterCard.title !== chapterCard.title ||
      navigationChapterCard.narrativeOrder !== chapterCard.narrativeOrder
    ) {
      throw new Error(
        "Long workspace active chapter no longer matches the loaded workspace index."
      );
    }
    if (chapter.commitId !== null) {
      throw new Error("The active long chapter is already committed.");
    }
    return {
      index,
      projectRevision,
      activeChapterCardId,
      chapter
    };
  };

  let documentReadSequence = 0;
  const loadLiveDocumentRevision = async (
    file: LongWorkspaceFileReference,
    expectedWorkspaceRevision: number,
    expectedProjectRevision: number,
    signal?: AbortSignal
  ): Promise<string> => {
    const command = LongReadDocumentCommandEnvelopeSchema.parse(
      createEnvelope(
        "long.readDocument",
        {
          bookId: workspace.bookId,
          fileId: file.id,
          offset: 0,
          maxCharacters: 1
        },
        {
          id: `long-query-${input.runId}-commit-revision-${++documentReadSequence}`,
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: workspace.bookId
          }
        }
      )
    );
    const result = LongReadDocumentResultSchema.parse(
      await execute(command, signal)
    );
    if (
      result.bookId !== workspace.bookId ||
      result.file.id !== file.id ||
      result.file.path !== file.path ||
      result.offset !== 0 ||
      result.workspaceRevision !== expectedWorkspaceRevision ||
      result.projectRevision !== expectedProjectRevision
    ) {
      throw new Error(
        "Core returned a different document while locking the ledger proposal."
      );
    }
    return result.file.revision;
  };

  const readDocumentHasContent = async (
    file: LongWorkspaceFileReference,
    expectedWorkspaceRevision: number,
    expectedProjectRevision: number,
    signal?: AbortSignal
  ): Promise<boolean> => {
    let offset = 0;
    while (true) {
      const command = LongReadDocumentCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.readDocument",
          {
            bookId: workspace.bookId,
            fileId: file.id,
            offset,
            maxCharacters: 262_144
          },
          {
            id: `long-query-${input.runId}-readiness-${++documentReadSequence}`,
            context: {
              sessionId: input.sessionId,
              runId: input.runId,
              resourceId: workspace.bookId
            }
          }
        )
      );
      const result = LongReadDocumentResultSchema.parse(
        await execute(command, signal)
      );
      if (
        result.bookId !== workspace.bookId ||
        result.file.id !== file.id ||
        result.offset !== offset ||
        result.workspaceRevision !== expectedWorkspaceRevision ||
        result.projectRevision !== expectedProjectRevision
      ) {
        throw new Error(
          "Core returned a different document while checking chapter readiness."
        );
      }
      if (result.content.trim()) return true;
      if (result.nextOffset === null) return false;
      offset = result.nextOffset;
    }
  };

  const loadChapterReadiness = async (
    index: LongWorkspaceIndexSnapshot,
    projectRevision: number,
    chapterCardId: string,
    signal?: AbortSignal
  ): Promise<LongChapterReadiness> => {
    const chapter = index.plot.chapterCards.find(
      ({ id }) => id === chapterCardId
    );
    const files = index.chapters.find(
      (entry) => entry.chapterCardId === chapterCardId
    );
    if (!chapter || !files) {
      throw new Error("The requested chapter or its triplet no longer exists.");
    }
    if (files.commitId !== null) {
      throw new Error("Committed chapters cannot be scheduled for writing.");
    }
    const bodyHasContent = await readDocumentHasContent(
      files.body,
      index.revision,
      projectRevision,
      signal
    );
    const characterStateHasContent = await readDocumentHasContent(
      files.characterState,
      index.revision,
      projectRevision,
      signal
    );
    const handoffHasContent = await readDocumentHasContent(
      files.handoff,
      index.revision,
      projectRevision,
      signal
    );
    return classifyLongChapterReadiness({
      chapterCardId: chapter.id,
      title: chapter.title,
      body: bodyHasContent ? "present" : "",
      characterState: characterStateHasContent ? "present" : "",
      handoff: handoffHasContent ? "present" : ""
    });
  };

  if (capabilities.has("query_structure") && readableRoots.size > 0) {
    tools.push(
      defineTool({
        name: "get_long_workspace_index",
        label: "读取长篇结构索引",
        description:
          "读取当前长篇项目中本智能体获准访问的结构根。bookId 与路径由运行时锁定。",
        parameters: Type.Object({}),
        execute: async (_toolCallId, _params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          return textResult(
            JSON.stringify(
              projectIndex(index, projectRevision, readableRoots),
              null,
              2
            )
          );
        }
      }),
      defineTool({
        name: "read_long_document",
        label: "读取长篇文档",
        description:
          "按稳定 fileId 分页读取当前长篇中已授权根下的文档。不能传路径或 bookId。",
        parameters: Type.Object({
          file_id: Type.String({ minLength: 3, maxLength: 160 }),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          max_characters: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 262_144 })
          )
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
          const known = fileRootMap(index).get(params.file_id);
          if (!known || !readableRoots.has(known.root)) {
            throw new Error("The requested long document is outside this agent's read roots.");
          }
          const command = LongReadDocumentCommandEnvelopeSchema.parse(
            createEnvelope(
              "long.readDocument",
              {
                bookId: workspace.bookId,
                fileId: params.file_id,
                offset: params.offset ?? 0,
                maxCharacters: params.max_characters ?? 32_768
              },
              {
                id: `long-query-${input.runId}-read-${Date.now()}`,
                context: {
                  sessionId: input.sessionId,
                  runId: input.runId,
                  resourceId: workspace.bookId
                }
              }
            )
          );
          const result = LongReadDocumentResultSchema.parse(
            await execute(command, signal)
          );
          if (
            result.bookId !== workspace.bookId ||
            result.file.id !== params.file_id ||
            !filePathBelongsToRoot(result.file, known.root)
          ) {
            throw new Error("Core returned a long document outside the authorized file.");
          }
          return textResult(JSON.stringify(result, null, 2));
        }
      }),
      defineTool({
        name: "search_long_workspace",
        label: "搜索长篇工作区",
        description:
          "在本智能体获准读取的单个根中搜索当前长篇。不能传路径或 bookId。",
        parameters: Type.Object({
          query: Type.String({ minLength: 1, maxLength: 256 }),
          scope: Type.Optional(
            literalUnion(
              readableRoots.size === ALL_ROOTS.size
                ? ["all", ...profile.readAccess.workspaceRoots]
                : profile.readAccess.workspaceRoots
            )
          ),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          max_snippet_characters: Type.Optional(
            Type.Integer({ minimum: 40, maximum: 2_000 })
          )
        }),
        execute: async (_toolCallId, params, signal) => {
          const defaultScope = readableRoots.has(workspace.activeRoot)
            ? workspace.activeRoot
            : profile.readAccess.workspaceRoots[0]!;
          const scope = params.scope ?? defaultScope;
          if (
            scope !== "all" &&
            !readableRoots.has(scope as LongWorkspaceRoot)
          ) {
            throw new Error("The requested search scope is not authorized.");
          }
          if (scope === "all" && readableRoots.size !== ALL_ROOTS.size) {
            throw new Error("Searching all roots requires read access to every root.");
          }
          const command = LongSearchCommandEnvelopeSchema.parse(
            createEnvelope(
              "long.search",
              {
                bookId: workspace.bookId,
                query: params.query,
                scope,
                ...(params.cursor ? { cursor: params.cursor } : {}),
                limit: params.limit ?? 20,
                maxSnippetCharacters: params.max_snippet_characters ?? 320
              },
              {
                id: `long-query-${input.runId}-search-${Date.now()}`,
                context: {
                  sessionId: input.sessionId,
                  runId: input.runId,
                  resourceId: workspace.bookId
                }
              }
            )
          );
          const result = LongSearchResultSchema.parse(
            await execute(command, signal)
          );
          if (
            result.bookId !== workspace.bookId ||
            result.hits.some((hit) => !readableRoots.has(hit.root))
          ) {
            throw new Error("Core returned search hits outside the authorized roots.");
          }
          return textResult(JSON.stringify(result, null, 2));
        }
      })
    );
  }

  if (
    capabilities.has("query_structure") &&
    readableRoots.has("draft")
  ) {
    tools.push(
      defineTool({
        name: "get_long_chapter_readiness",
        label: "检查章节三件套",
        description:
          "检查当前或指定未提交章的正文、人物状态和 Handoff 是否为空，返回 empty、partial 或 ready_to_commit 及明确缺失项。",
        parameters: Type.Object({
          chapter_card_id: Type.Optional(
            Type.String({ minLength: 3, maxLength: 160 })
          )
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const chapterCardId =
            params.chapter_card_id ?? workspace.activeChapterCardId;
          if (!chapterCardId) {
            throw new Error(
              "A chapter must be active or explicitly selected for readiness."
            );
          }
          return textResult(
            JSON.stringify(
              await loadChapterReadiness(
                index,
                projectRevision,
                chapterCardId,
                signal
              ),
              null,
              2
            )
          );
        }
      })
    );
  }

  if (capabilities.has("mutate_structure") && writableRoots.size > 0) {
    tools.push(
      defineTool({
        name: "propose_long_mutation",
        label: "提议长篇结构变更",
        description:
          "按显式领域操作提交当前长篇的结构变更提案。运行时锁定项目版本、生成新实体与文件信息并计算文档内容修订；只能更新逻辑文档目标，不能传路径或文件修订。提案只进入审阅队列，不直接写磁盘。",
        parameters: LONG_MUTATION_PARAMETERS,
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          throwIfAborted(signal);
          const { index, projectRevision } = await loadIndex(signal);
          const timestamp = new Date().toISOString();
          const idSeed = `${workspace.bookId}:${input.runId}:${toolCallId}`;
          const built = buildRuntimeOperations({
            rawOperations: params.operations,
            index,
            timestamp,
            idSeed
          });
          const documentUpdates = params.document_updates ?? [];
          const documentTargets = documentUpdates.map((update) => {
            const target = resolveDocumentUpdateTarget(
              update,
              index,
              built.clientReferences
            );
            if (
              target.root === "draft" ||
              !writableRoots.has(target.root)
            ) {
              throw new Error(
                "Document update proposal is outside the agent's write roots."
              );
            }
            return target;
          });
          const liveRevisions = new Map(
            await Promise.all(
              documentTargets.map(async (target) => [
                target.file.id,
                await loadLiveDocumentRevision(
                  target.file,
                  index.revision,
                  projectRevision,
                  signal
                )
              ] as const)
            )
          );
          const batch = LongWorkspaceOperationBatchSchema.parse(
            {
              baseRevision: index.revision,
              updatedAt: timestamp,
              operations: built.operations,
              documentWrites: buildRuntimeDocumentWrites({
                updates: documentUpdates,
                index,
                clientReferences: built.clientReferences,
                writableRoots,
                liveRevisions,
                timestamp,
                idSeed
              })
            }
          );
          for (const operation of batch.operations) {
            const root = rootForOperation(operation);
            if (!writableRoots.has(root)) {
              throw new Error(`Operation ${operation.type} is outside the agent's write roots.`);
            }
            for (const file of collectOperationFiles(operation)) {
              if (
                !filePathBelongsToRoot(
                  file,
                  createdFileRootForOperation(operation)
                )
              ) {
                throw new Error(`Operation ${operation.type} contains an out-of-root file path.`);
              }
            }
          }
          throwIfAborted(signal);
          return textResult("已形成长篇结构变更提案，等待客户端审阅与冲突检查。", {
            kind: "long-mutation-proposal",
            bookId: workspace.bookId,
            agentId: profile.id,
            batch,
            baseProjectRevision: projectRevision,
            summary: params.summary.trim()
          });
        }
      })
    );
  }

  if (
    capabilities.has("dispatch_chapter_writer") &&
    (profile.id === "draft" || profile.id === "plot_design")
  ) {
    tools.push(
      defineTool({
        name: "propose_long_chapter_dispatch",
        label: "提议启动长篇写作",
        description:
          "按卷序和卷内叙事顺序，为单章、当前主弧的连续章节或当前卷形成串行写作调度提案；不支持整本调度。提案获批后客户端才启动每章独立写手运行，且所有磁盘写入仍逐项审批。",
        parameters: Type.Object({
          scope: Type.Optional(
            literalUnion(["chapter", "arc", "volume"])
          ),
          chapter_card_id: Type.Optional(
            Type.String({ minLength: 3, maxLength: 160 })
          ),
          arc_id: Type.Optional(
            Type.String({ minLength: 3, maxLength: 160 })
          ),
          volume_id: Type.Optional(
            Type.String({ minLength: 3, maxLength: 160 })
          ),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (_toolCallId, params, signal) => {
          throwIfAborted(signal);
          const { index, projectRevision } = await loadIndex(signal);
          const scope = params.scope ?? "chapter";
          const selectedChapters = selectLongChaptersForWritingScope(index, {
            scope,
            ...(params.chapter_card_id
              ? { chapterCardId: params.chapter_card_id }
              : {}),
            ...(params.arc_id ? { arcId: params.arc_id } : {}),
            ...(params.volume_id ? { volumeId: params.volume_id } : {})
          });
          const firstChapter = selectedChapters[0];
          if (!firstChapter) {
            return textResult("全部章卡均已连续提交，没有可调度的下一章。");
          }
          const chapters: LongChapterReadiness[] = [];
          for (const chapter of selectedChapters) {
            chapters.push(
              await loadChapterReadiness(
                index,
                projectRevision,
                chapter.id,
                signal
              )
            );
          }
          const summary =
            params.summary?.trim() ||
            `准备按${scope === "chapter" ? "单章" : scope === "arc" ? "主弧" : "当前卷"}串行写作 ${chapters.length} 章，从《${firstChapter.title}》开始。`;
          return textResult(
            `已形成从《${firstChapter.title}》开始的 ${chapters.length} 章串行写作调度提案，等待客户端审阅。`,
            {
              kind: "long-chapter-dispatch-proposal",
              bookId: workspace.bookId,
              agentId: profile.id,
              scope,
              chapterCardId: firstChapter.id,
              title: firstChapter.title,
              chapters,
              workspaceRevision: index.revision,
              projectRevision,
              summary
            }
          );
        }
      })
    );
  }

  if (
    capabilities.has("write_chapter_files") &&
    writableRoots.has("draft") &&
    workspace.activeChapterCardId
  ) {
    const fileWrite = strictObject({
      content: Type.String({ maxLength: 16 * 1024 * 1024 })
    });
    tools.push(
      defineTool({
        name: "propose_long_chapter_write",
        label: "提议写入当前章",
        description:
          "为运行时锁定的当前章同时提交正文、人物状态和 handoff 提案，不直接写磁盘。",
        parameters: strictObject({
          body: fileWrite,
          character_state: fileWrite,
          handoff: fileWrite,
          summary: Type.String({ minLength: 1, maxLength: 1_000 })
        }),
        executionMode: "sequential",
        execute: async (_toolCallId, params, signal) => {
          throwIfAborted(signal);
          const {
            index,
            projectRevision,
            activeChapterCardId,
            chapter
          } = await loadActiveChapterMutationContext(signal);
          const [
            bodyRevision,
            characterStateRevision,
            handoffRevision
          ] = await Promise.all([
            loadLiveDocumentRevision(
              chapter.body,
              index.revision,
              projectRevision,
              signal
            ),
            loadLiveDocumentRevision(
              chapter.characterState,
              index.revision,
              projectRevision,
              signal
            ),
            loadLiveDocumentRevision(
              chapter.handoff,
              index.revision,
              projectRevision,
              signal
            )
          ]);
          const chapterInput = LongWriteChapterInputSchema.parse({
            bookId: workspace.bookId,
            chapterCardId: activeChapterCardId,
            body: {
              content: params.body.content,
              baseRevision: bodyRevision
            },
            characterState: {
              content: params.character_state.content,
              baseRevision: characterStateRevision
            },
            handoff: {
              content: params.handoff.content,
              baseRevision: handoffRevision
            },
            baseWorkspaceRevision: index.revision,
            baseProjectRevision: projectRevision
          });
          return textResult("已形成当前章三文件写入提案，等待客户端审阅。", {
            kind: "long-chapter-write-proposal",
            bookId: workspace.bookId,
            agentId: profile.id,
            input: chapterInput,
            summary: params.summary.trim()
          });
        }
      })
    );
  }

  if (capabilities.has("commit_ledger") && workspace.activeChapterCardId) {
    tools.push(
      defineTool({
        name: "propose_long_ledger_commit",
        label: "提议提交连续性账本",
        description:
          "为运行时锁定的当前章形成连续性提交提案；每项决定必须给出证据，并完整总结时间线、人物、势力、境界、伏笔和连续性，不直接提交账本或写磁盘。",
        parameters: strictObject({
          placement_decisions: Type.Optional(
            Type.Record(
              Type.String({ minLength: 3, maxLength: 160 }),
              strictObject({
                status: Type.Union([
                  Type.Literal("committed"),
                  Type.Literal("missed")
                ]),
                note: Type.String({ minLength: 1, maxLength: 4_000 })
              })
            )
          ),
          foreshadowing_beat_decisions: Type.Optional(
            Type.Record(
              Type.String({ minLength: 3, maxLength: 160 }),
              strictObject({
                status: Type.Union([
                  Type.Literal("committed"),
                  Type.Literal("missed")
                ]),
                note: Type.String({ minLength: 1, maxLength: 4_000 })
              })
            )
          ),
          file_updates: Type.Optional(
            Type.Array(
              strictObject({
                character_id: stableIdParameter("character"),
                document: literalUnion([
                  "relationships",
                  "current_state",
                  "history"
                ]),
                content: Type.String({ maxLength: 16 * 1024 * 1024 }),
                mode: Type.Union([
                  Type.Literal("replace"),
                  Type.Literal("append")
                ])
              }),
              { maxItems: 1_024 }
            )
          ),
          chapter_summary: strictObject({
            timeline: Type.String({ minLength: 1, maxLength: 200_000 }),
            character_states: Type.String({
              minLength: 1,
              maxLength: 200_000
            }),
            faction_states: Type.String({
              minLength: 1,
              maxLength: 200_000
            }),
            realm_states: Type.String({
              minLength: 1,
              maxLength: 200_000
            }),
            foreshadowing_states: Type.String({
              minLength: 1,
              maxLength: 200_000
            }),
            continuity_notes: Type.String({
              minLength: 1,
              maxLength: 200_000
            })
          }),
          summary: Type.String({ minLength: 1, maxLength: 1_000 })
        }),
        executionMode: "sequential",
        execute: async (_toolCallId, params, signal) => {
          throwIfAborted(signal);
          const {
            index,
            projectRevision,
            activeChapterCardId,
            chapter
          } = await loadActiveChapterMutationContext(signal);
          const chapterIdByPlacementId = new Map(
            index.plot.narrativePlacements.map((placement) => [
              placement.id,
              placement.chapterCardId
            ])
          );
          const placementIds = new Set(
            index.plot.narrativePlacements
              .filter((item) => item.chapterCardId === activeChapterCardId)
              .map((item) => item.id)
          );
          const beatIds = new Set(
            index.plot.foreshadowing.flatMap((thread) =>
              thread.beats
                .filter(
                  (beat) =>
                    (beat.chapterCardId ??
                      (beat.placementId
                        ? chapterIdByPlacementId.get(beat.placementId)
                        : undefined)) === activeChapterCardId
                )
                .map((beat) => beat.id)
            )
          );
          const proposedPlacementIds = Object.keys(
            params.placement_decisions ?? {}
          );
          if (
            proposedPlacementIds.length !== placementIds.size ||
            proposedPlacementIds.some((id) => !placementIds.has(id))
          ) {
            throw new Error(
              "Ledger proposal must decide every placement in the active chapter and no others."
            );
          }
          if (
            Object.values(params.placement_decisions ?? {}).some(
              ({ note }) => note.trim().length === 0
            )
          ) {
            throw new Error(
              "Every ledger placement decision must include a non-empty evidence note."
            );
          }
          const proposedBeatIds = Object.keys(
            params.foreshadowing_beat_decisions ?? {}
          );
          if (
            proposedBeatIds.length !== beatIds.size ||
            proposedBeatIds.some((id) => !beatIds.has(id))
          ) {
            throw new Error(
              "Ledger proposal must decide every foreshadowing beat in the active chapter and no others."
            );
          }
          if (
            Object.values(
              params.foreshadowing_beat_decisions ?? {}
            ).some(({ note }) => note.trim().length === 0)
          ) {
            throw new Error(
              "Every ledger foreshadowing-beat decision must include a non-empty evidence note."
            );
          }
          if (
            [
              params.chapter_summary.timeline,
              params.chapter_summary.character_states,
              params.chapter_summary.faction_states,
              params.chapter_summary.realm_states,
              params.chapter_summary.foreshadowing_states,
              params.chapter_summary.continuity_notes
            ].some((value) => value.trim().length === 0)
          ) {
            throw new Error(
              "Ledger chapter summary must provide all six non-empty continuity sections."
            );
          }
          const rootsByFile = fileRootMap(index);
          const characterFilesById = new Map(
            index.characterFiles.map((entry) => [entry.characterId, entry])
          );
          const resolvedFileUpdateTargets = (params.file_updates ?? []).map(
            (update) => {
              const characterFiles = characterFilesById.get(
                update.character_id
              );
              if (!characterFiles) {
                throw new Error(
                  "Ledger file update references an unknown character."
                );
              }
              const file =
                update.document === "relationships"
                  ? characterFiles.relationships
                  : update.document === "current_state"
                    ? characterFiles.currentState
                    : characterFiles.history;
              const known = rootsByFile.get(file.id);
              const expectedMode =
                update.document === "history" ? "append" : "replace";
              if (
                !known ||
                !writableRoots.has(known.root) ||
                known.root !== "character_design" ||
                update.mode !== expectedMode
              ) {
                throw new Error(
                  "Ledger file update is outside the agent's write roots."
                );
              }
              return {
                file: known.file,
                content: update.content,
                mode: update.mode
              };
            }
          );
          const resolvedFileUpdates = await Promise.all(
            resolvedFileUpdateTargets.map(async (update) => ({
              fileId: update.file.id,
              content: update.content,
              baseRevision: await loadLiveDocumentRevision(
                update.file,
                index.revision,
                projectRevision,
                signal
              ),
              mode: update.mode
            }))
          );
          const [
            bodyRevision,
            characterStateRevision,
            handoffRevision
          ] = await Promise.all([
            loadLiveDocumentRevision(
              chapter.body,
              index.revision,
              projectRevision,
              signal
            ),
            loadLiveDocumentRevision(
              chapter.characterState,
              index.revision,
              projectRevision,
              signal
            ),
            loadLiveDocumentRevision(
              chapter.handoff,
              index.revision,
              projectRevision,
              signal
            )
          ]);
          const commitInput = LongCommitChapterInputSchema.parse({
            bookId: workspace.bookId,
            chapterCardId: activeChapterCardId,
            chapterFileRevisions: {
              body: bodyRevision,
              characterState: characterStateRevision,
              handoff: handoffRevision
            },
            placementDecisions: params.placement_decisions ?? {},
            foreshadowingBeatDecisions:
              params.foreshadowing_beat_decisions ?? {},
            fileUpdates: resolvedFileUpdates,
            commitMessage: params.summary.trim(),
            chapterSummary: {
              timeline: params.chapter_summary.timeline.trim(),
              characterStates:
                params.chapter_summary.character_states.trim(),
              factionStates:
                params.chapter_summary.faction_states.trim(),
              realmStates: params.chapter_summary.realm_states.trim(),
              foreshadowingStates:
                params.chapter_summary.foreshadowing_states.trim(),
              continuityNotes:
                params.chapter_summary.continuity_notes.trim()
            },
            baseWorkspaceRevision: index.revision,
            baseProjectRevision: projectRevision
          });
          throwIfAborted(signal);
          return textResult("已形成连续性账本提交提案，等待客户端审阅。", {
            kind: "long-ledger-commit-proposal",
            bookId: workspace.bookId,
            agentId: profile.id,
            input: commitInput,
            summary: params.summary.trim()
          });
        }
      })
    );
  }

  return tools;
}

export type {
  LongReadDocumentResult,
  LongSearchResult
};
