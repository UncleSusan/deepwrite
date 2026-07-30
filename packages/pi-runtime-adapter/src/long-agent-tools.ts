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
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  type AgentWriteApprovalMode,
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
  type LongWorldbuildingFileChange,
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
      kind: "long-worldbuilding-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      baseProjectRevision: number;
      summary: string;
      files: LongWorldbuildingFileChange[];
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
  writeApprovalMode?: AgentWriteApprovalMode;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  executor?: LongCommandExecutor;
}

function longProposalResultSummary(
  input: BuildLongWorkspaceToolsInput,
  pendingSummary: string
): string {
  return input.writeApprovalMode === "auto-approve"
    ? pendingSummary.replace(
        /等待客户端审阅(?:与冲突检查)?。$/,
        "已提交实时自动保存队列；以审批卡的落盘状态为准。"
      )
    : pendingSummary;
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
const worldbuildingCategoryIdParameter = stableIdParameter("world");
const worldbuildingItemIdParameter = stableIdParameter("worlditem");
const worldbuildingReadModeParameter = literalUnion([
  "preview",
  "full"
] as const);
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
const characterDocumentParameter = literalUnion([
  "core_profile",
  "relationships",
  "current_state",
  "history"
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
const foreshadowingSpanParameter = Type.Union(
  [
    Type.Literal("local"),
    Type.Literal("within_volume"),
    Type.Literal("cross_volume")
  ],
  {
    description:
      "伏笔计划跨度：local 为局部剧情点，within_volume 为卷内，cross_volume 为跨卷。"
  }
);
const foreshadowingHiddenTruthParameter = Type.String({
  maxLength: 200_000,
  description: "作者掌握但暂不向读者公开的伏笔真相。"
});

function nullableEntityReferenceParameter(
  prefix: string,
  description: string
) {
  return Type.Union(
    [entityReferenceParameter(prefix), Type.Null()],
    { description }
  );
}

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
    type: Type.Literal("worldbuildingItem.create"),
    client_ref: clientReferenceParameter,
    categoryId: entityReferenceParameter("world"),
    title: titleParameter
  }),
  strictObject({
    type: Type.Literal("worldbuildingItem.update"),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
    })
  }),
  strictObject({
    type: Type.Literal("worldbuildingItem.delete"),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("worldbuildingItem.reorder"),
    categoryId: entityReferenceParameter("world"),
    orderedIds: Type.Array(entityReferenceParameter("worlditem"), {
      maxItems: 10_000,
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
    hiddenTruth: Type.Optional(foreshadowingHiddenTruthParameter),
    plannedSpan: Type.Optional(foreshadowingSpanParameter),
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
      hiddenTruth: Type.Optional(foreshadowingHiddenTruthParameter),
      plannedSpan: Type.Optional(foreshadowingSpanParameter),
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
    volumeId: Type.Optional(
      nullableEntityReferenceParameter(
        "volume",
        "卷级计划锚点；触点尚未细化到剧情点时使用，传 null 可清空。"
      )
    ),
    arcId: Type.Optional(
      nullableEntityReferenceParameter(
        "arc",
        "剧情点计划锚点（内部 LongArc）；传 null 可清空。"
      )
    ),
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
      volumeId: Type.Optional(
        nullableEntityReferenceParameter(
          "volume",
          "更新卷级计划锚点；传 null 可清空。"
        )
      ),
      arcId: Type.Optional(
        nullableEntityReferenceParameter(
          "arc",
          "更新剧情点计划锚点（内部 LongArc）；传 null 可清空。"
        )
      ),
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
      categoryId: entityReferenceParameter("world"),
      itemId: Type.Optional(entityReferenceParameter("worlditem"))
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

const LONG_WORLDBUILDING_STRUCTURE_OPERATION_PARAMETER = Type.Union([
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
    type: Type.Literal("worldbuildingItem.update"),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
    })
  }),
  strictObject({
    type: Type.Literal("worldbuildingItem.delete"),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("worldbuildingItem.reorder"),
    categoryId: entityReferenceParameter("world"),
    orderedIds: Type.Array(entityReferenceParameter("worlditem"), {
      maxItems: 10_000,
      uniqueItems: true
    })
  })
]);

const LONG_WORLDBUILDING_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(
    LONG_WORLDBUILDING_STRUCTURE_OPERATION_PARAMETER,
    {
      minItems: 1,
      maxItems: 10_000
    }
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
  if (prefix === "worldbuilding" || prefix === "worldbuildingItem") {
    return "worldbuilding";
  }
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
    if (category.format === "text") {
      addFile(map, "worldbuilding", category.file);
    } else {
      if (category.overview) {
        addFile(map, "worldbuilding", category.overview);
      }
      for (const item of category.items) {
        addFile(map, "worldbuilding", item.file);
      }
    }
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
    return operation.category.format === "text"
      ? [operation.category.file]
      : [
          ...(operation.category.overview
            ? [operation.category.overview]
            : []),
          ...operation.category.items.map(({ file }) => file)
        ];
  }
  if (operation.type === "worldbuildingItem.create") {
    return [operation.item.file];
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
  "worldbuildingItem.create": "worlditem",
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
    ...index.worldbuilding.flatMap((category) =>
      category.format === "list"
        ? category.items.map(({ id }) => id)
        : []
    ),
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
          return operation.format === "list"
            ? {
                type: operation.type,
                category: {
                  id,
                  title: operation.title,
                  order: worldOrder,
                  format: "list" as const,
                  contentAuthority: "files" as const,
                  overview: createEmptyLongMarkdownFileReference(
                    longWorldbuildingOverviewFileId(id),
                    longWorldbuildingOverviewContentPath(id),
                    input.timestamp
                  ),
                  items: []
                }
              }
            : {
                type: operation.type,
                category: {
                  id,
                  title: operation.title,
                  order: worldOrder,
                  format: "text" as const,
                  contentAuthority: "markdown" as const,
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
        case "worldbuildingItem.create": {
          const id = generatedId!;
          const categoryId = ref(operation.categoryId, "world");
          const category = input.index.worldbuilding.find(
            (candidate) => candidate.id === categoryId
          );
          if (!category || category.format !== "list") {
            throw new Error(
              "Worldbuilding items can only be created in an existing list category."
            );
          }
          const priorCreates = input.rawOperations
            .slice(0, operationIndex)
            .filter(
              (candidate) =>
                candidate.type === "worldbuildingItem.create" &&
                ref(candidate.categoryId, "world") === categoryId
            ).length;
          return {
            type: operation.type,
            categoryId,
            item: {
              id,
              title: operation.title,
              order: category.items.length + priorCreates + 1,
              file: createEmptyLongMarkdownFileReference(
                longWorldbuildingItemFileId(id),
                longWorldbuildingItemContentPath(categoryId, id),
                input.timestamp
              )
            }
          };
        }
        case "worldbuildingItem.update":
        case "worldbuildingItem.delete":
          return {
            ...operation,
            categoryId: ref(operation.categoryId, "world"),
            id: ref(operation.id, "worlditem")
          } as LongWorkspaceOperation;
        case "worldbuildingItem.reorder":
          return {
            type: operation.type,
            categoryId: ref(operation.categoryId, "world"),
            orderedIds: refs(operation.orderedIds, "worlditem")
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
              ...(operation.hiddenTruth !== undefined
                ? { hiddenTruth: operation.hiddenTruth }
                : {}),
              ...(operation.plannedSpan !== undefined
                ? { plannedSpan: operation.plannedSpan }
                : {}),
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
              ...(operation.volumeId !== undefined
                ? {
                    volumeId: optionalRef(
                      operation.volumeId,
                      "volume"
                    )
                  }
                : {}),
              ...(operation.arcId !== undefined
                ? { arcId: optionalRef(operation.arcId, "arc") }
                : {}),
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
            volumeId,
            arcId,
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
              ...(volumeId !== undefined
                ? {
                    volumeId: optionalRef(volumeId, "volume")
                  }
                : {}),
              ...(arcId !== undefined
                ? { arcId: optionalRef(arcId, "arc") }
                : {}),
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
    if (category.format === "text") {
      if (update.target.itemId !== undefined) {
        throw new Error("Text worldbuilding categories do not have items.");
      }
      return { root: "worldbuilding", file: category.file };
    }
    if (!update.target.itemId) {
      if (!category.overview) {
        throw new Error("Worldbuilding overview does not exist.");
      }
      return { root: "worldbuilding", file: category.overview };
    }
    const itemId = resolveEntityReference(
      update.target.itemId,
      "worlditem",
      clientReferences
    );
    const item = category.items.find(({ id }) => id === itemId);
    if (!item) {
      throw new Error("Worldbuilding item does not exist.");
    }
    return { root: "worldbuilding", file: item.file };
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
    kind === "long-worldbuilding-file-proposal" ||
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
  if (
    (input.scope === "chapter" && (input.arcId || input.volumeId)) ||
    (input.scope === "arc" && (input.chapterCardId || input.volumeId)) ||
    (input.scope === "volume" && (input.chapterCardId || input.arcId))
  ) {
    throw new Error(
      "Long writing scope includes a selector that belongs to another scope."
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
  return {
    chapterCardId: input.chapterCardId,
    title: input.title,
    status:
      missingFiles.length === 1
        ? "empty"
        : "ready_to_commit",
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
  const isWorldbuildingAgent = profile.id === "worldbuilding";
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

  let querySequence = 0;
  const fullyReadWorldbuildingDocuments = new Map<
    string,
    {
      content: string;
      file: LongWorkspaceFileReference;
      workspaceRevision: number;
      projectRevision: number;
    }
  >();
  const worldbuildingDocumentOverlay = new Map<
    string,
    {
      categoryId: string;
      categoryTitle: string;
      itemId?: string;
      itemTitle?: string;
      file: LongWorkspaceFileReference;
      content: string;
      pendingCreation: boolean;
    }
  >();
  const fullyReadCharacterDocuments = new Map<
    string,
    {
      content: string;
      file: LongWorkspaceFileReference;
      workspaceRevision: number;
      projectRevision: number;
    }
  >();

  const resolveWorldbuildingTarget = (
    index: LongWorkspaceIndexSnapshot,
    categoryId: string,
    itemId?: string
  ): {
    categoryTitle: string;
    itemTitle?: string;
    file: LongWorkspaceFileReference;
    overlay?: {
      content: string;
      pendingCreation: boolean;
    };
  } => {
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
  };

  const readWholeWorldbuildingDocument = async (
    file: LongWorkspaceFileReference,
    expectedWorkspaceRevision: number,
    expectedProjectRevision: number,
    signal?: AbortSignal
  ) => {
    let offset = 0;
    let content = "";
    let authoritativeFile = file;
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
            id: `long-query-${input.runId}-worldbuilding-${++querySequence}`,
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
        result.offset !== offset ||
        result.workspaceRevision !== expectedWorkspaceRevision ||
        result.projectRevision !== expectedProjectRevision
      ) {
        throw new Error(
          "Core returned a different worldbuilding document."
        );
      }
      authoritativeFile = result.file;
      content += result.content;
      if (result.nextOffset === null) {
        return { content, file: authoritativeFile };
      }
      offset = result.nextOffset;
    }
  };

  const resolveCharacterDocumentTarget = (
    index: LongWorkspaceIndexSnapshot,
    characterId: string,
    document:
      | "core_profile"
      | "relationships"
      | "current_state"
      | "history"
  ): {
    characterName: string;
    file: LongWorkspaceFileReference;
  } => {
    const character = index.characters.find(({ id }) => id === characterId);
    const files = index.characterFiles.find(
      (entry) => entry.characterId === characterId
    );
    if (!character || !files) {
      throw new Error(`Character ${characterId} does not exist.`);
    }
    const documents = {
      core_profile: files.coreProfile,
      relationships: files.relationships,
      current_state: files.currentState,
      history: files.history
    } as const;
    return {
      characterName: character.name,
      file: documents[document]
    };
  };

  const readWholeCharacterDocument = async (
    file: LongWorkspaceFileReference,
    expectedWorkspaceRevision: number,
    expectedProjectRevision: number,
    signal?: AbortSignal
  ) => {
    let offset = 0;
    let content = "";
    let authoritativeFile = file;
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
            id: `long-query-${input.runId}-character-${++querySequence}`,
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
  };

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
          id: `long-query-${input.runId}-commit-revision-${++querySequence}`,
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
            id: `long-query-${input.runId}-readiness-${++querySequence}`,
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
    return classifyLongChapterReadiness({
      chapterCardId: chapter.id,
      title: chapter.title,
      body: bodyHasContent ? "present" : "",
      characterState: "",
      handoff: ""
    });
  };

  if (
    capabilities.has("query_structure") &&
    readableRoots.size > 0 &&
    !isWorldbuildingAgent
  ) {
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
                id: `long-query-${input.runId}-read-${++querySequence}`,
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
            result.file.path !== known.file.path ||
            result.offset !== (params.offset ?? 0) ||
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
                id: `long-query-${input.runId}-search-${++querySequence}`,
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
        label: "检查章节正文证据",
        description:
          "检查当前或指定未提交章的正文是否已经形成可供连续性结算的证据，返回 empty 或 ready_to_commit。",
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

  if (
    isWorldbuildingAgent &&
    capabilities.has("query_structure") &&
    readableRoots.has("worldbuilding")
  ) {
    tools.push(
      defineTool({
        name: "list_worldbuilding",
        label: "列出世界观",
        description:
          "列出世界观分类；指定 category_id 时列出该列表型分类的条目，并自动附带该分类手动维护的概览内容。返回顺序就是当前顺序，只显示分类和条目的业务 ID，不显示文件或版本信息。",
        parameters: strictObject({
          category_id: Type.Optional(worldbuildingCategoryIdParameter),
          page: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 10_000 })
          ),
          limit: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 100 })
          )
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const page = params.page ?? 1;
          const limit = params.limit ?? 50;
          const start = (page - 1) * limit;
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
            const end = Math.min(start + limit, categories.length);
            return textResult(JSON.stringify({
              categories: categories.slice(start, end),
              next_page:
                end < categories.length && page < 10_000 ? page + 1 : null
            }));
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
          const end = Math.min(start + limit, items.length);
          return textResult(JSON.stringify({
            category: {
              category_id: category.id,
              title: category.title,
              format: category.format
            },
            ...(category.format === "list"
              ? {
                  overview: overview ?? "",
                  items: items.slice(start, end)
                }
              : {
                  note: "这是文本型分类；读取内容时不要传 item_id。"
                }),
            next_page:
              end < items.length && page < 10_000 ? page + 1 : null
          }));
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
                  id: `long-query-${input.runId}-worldbuilding-search-${++querySequence}`,
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
            params.item_id
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

    tools.push(
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
          const itemId = `worlditem_${stableHash(
            `${workspace.bookId}:${input.runId}:${toolCallId}`
          ).slice(0, 24)}`;
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
            )}\n${title} → item_id=${itemId}\n同一轮内可立即使用该 item_id 调用 write_worldbuilding_file 写入正文。`,
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
            params.item_id
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
              "未写入：目标已有正文，请先调用 read_worldbuilding（mode=full）完整读取。"
            );
          }
          if (
            live.content.trim() &&
            params.allow_overwrite_existing !== true
          ) {
            return textResult(
              "未写入：目标已有正文；局部修改请使用 edit_worldbuilding_file，整体重写需设置 allow_overwrite_existing=true。"
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
            params.item_id
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
              "未编辑：请先调用 read_worldbuilding（mode=full）完整读取目标内容。"
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

  if (
    capabilities.has("query_structure") &&
    readableRoots.has("character_design") &&
    capabilities.has("mutate_structure") &&
    writableRoots.has("character_design")
  ) {
    tools.push(
      defineTool({
        name: "read_character_document",
        label: "读取人物文档",
        description:
          "按稳定 character_id 和文档角色完整读取一名人物的独立 Markdown 文件。完整读取会为后续覆盖或局部替换建立本轮读取凭据。",
        parameters: Type.Object({
          character_id: Type.String({ minLength: 3, maxLength: 160 }),
          document: characterDocumentParameter
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const target = resolveCharacterDocumentTarget(
            index,
            params.character_id,
            params.document
          );
          const result = await readWholeCharacterDocument(
            target.file,
            index.revision,
            projectRevision,
            signal
          );
          fullyReadCharacterDocuments.set(target.file.id, {
            content: result.content,
            file: result.file,
            workspaceRevision: index.revision,
            projectRevision
          });
          return textResult(
            JSON.stringify(
              {
                characterId: params.character_id,
                characterName: target.characterName,
                document: params.document,
                file: result.file,
                content: result.content,
                workspaceRevision: index.revision,
                projectRevision
              },
              null,
              2
            )
          );
        }
      })
    );
  }

  if (
    capabilities.has("mutate_structure") &&
    writableRoots.has("character_design")
  ) {
    const proposalResult = (
      batch: LongWorkspaceOperationBatch,
      projectRevision: number,
      summary: string
    ) =>
      textResult(longProposalResultSummary(
        input,
        "已形成人物文件变更提案，等待客户端审阅与冲突检查。"
      ), {
        kind: "long-mutation-proposal" as const,
        bookId: workspace.bookId,
        agentId: profile.id,
        batch,
        baseProjectRevision: projectRevision,
        summary
      });

    const assertCharacterDocumentIsDirectlyWritable = (
      index: LongWorkspaceIndexSnapshot,
      document:
        | "core_profile"
        | "relationships"
        | "current_state"
        | "history"
    ) => {
      if (
        index.ledger.commits.length > 0 &&
        document !== "core_profile"
      ) {
        throw new Error(
          "After the first continuity commit, relationships, current state, and history are ledger-owned; only the core profile remains directly writable."
        );
      }
    };

    tools.push(
      defineTool({
        name: "create_characters",
        label: "创建人物",
        description:
          "批量创建人物列表条目；每名人物获得稳定 character_id，以及核心档案、人物关系、当前状态和历史轨迹四份独立 Markdown 文件。可在同一次提案中提供初始内容。",
        parameters: Type.Object({
          characters: Type.Array(
            Type.Object({
              name: Type.String({ minLength: 1, maxLength: 256 }),
              group: characterGroupParameter,
              aliases: Type.Optional(aliasesParameter),
              documents: Type.Optional(
                Type.Object({
                  core_profile: Type.Optional(
                    Type.String({ maxLength: 1_000_000 })
                  ),
                  relationships: Type.Optional(
                    Type.String({ maxLength: 1_000_000 })
                  ),
                  current_state: Type.Optional(
                    Type.String({ maxLength: 1_000_000 })
                  ),
                  history: Type.Optional(
                    Type.String({ maxLength: 1_000_000 })
                  )
                })
              )
            }),
            { minItems: 1, maxItems: 100 }
          ),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          if (index.characters.length + params.characters.length > 100_000) {
            throw new Error(
              "A long workspace supports at most 100,000 characters."
            );
          }
          const timestamp = new Date().toISOString();
          const nextOrders = new Map(
            ([
              "protagonist",
              "major_supporting",
              "minor_supporting",
              "passerby"
            ] as const).map((group) => [
              group,
              maxOrder(
                index.characters
                  .filter((character) => character.group === group)
                  .map(({ order }) => order)
              )
            ])
          );
          const operations: LongWorkspaceOperation[] = [];
          const documentWrites: LongWorkspaceOperationBatch["documentWrites"] =
            [];
          const created: Array<{ characterId: string; name: string }> = [];

          params.characters.forEach((requested, characterIndex) => {
            const characterId = `character_${stableHash(
              `${workspace.bookId}:${input.runId}:${toolCallId}:${characterIndex}`
            ).slice(0, 24)}`;
            const order = (nextOrders.get(requested.group) ?? 0) + 1;
            nextOrders.set(requested.group, order);
            const emptyFiles = {
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
            const documents = requested.documents ?? {};
            const files = Object.fromEntries(
              Object.entries(emptyFiles).map(([document, emptyFile]) => {
                const content =
                  documents[
                    document as keyof typeof documents
                  ] ?? "";
                return [
                  document,
                  content
                    ? {
                        ...emptyFile,
                        revision: nextContentRevision(
                          emptyFile.revision,
                          content
                        )
                      }
                    : emptyFile
                ];
              })
            ) as typeof emptyFiles;

            operations.push({
              type: "character.create",
              character: {
                id: characterId,
                name: requested.name.trim(),
                group: requested.group,
                order,
                aliases: requested.aliases ?? []
              },
              files: {
                characterId,
                coreProfile: files.core_profile,
                relationships: files.relationships,
                currentState: files.current_state,
                history: files.history
              }
            });

            (Object.keys(files) as Array<keyof typeof files>).forEach(
              (document, documentIndex) => {
                const content = documents[document] ?? "";
                if (!content) return;
                documentWrites.push({
                  proposalId: `proposal_${stableHash(
                    `${workspace.bookId}:${input.runId}:${toolCallId}:content:${characterIndex}:${documentIndex}`
                  ).slice(0, 24)}`,
                  fileId: files[document].id,
                  content,
                  mode: "create",
                  expectedRevision: null,
                  nextRevision: files[document].revision,
                  updatedAt: timestamp,
                  reason: `初始化人物“${requested.name.trim()}”的${document}`
                });
              }
            );
            created.push({
              characterId,
              name: requested.name.trim()
            });
          });

          const summary =
            params.summary?.trim() ||
            `创建 ${created.length} 名人物`;
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations,
            documentWrites
          });
          return textResult(
            `${longProposalResultSummary(
              input,
              "已形成人物创建提案，等待客户端审阅与冲突检查。"
            )}\n${created
              .map(
                (character, characterIndex) =>
                  `${characterIndex + 1}. ${character.name} → character_id=${character.characterId}`
              )
              .join("\n")}`,
            {
              kind: "long-mutation-proposal",
              bookId: workspace.bookId,
              agentId: profile.id,
              batch,
              baseProjectRevision: projectRevision,
              summary
            }
          );
        }
      }),
      defineTool({
        name: "write_character_document",
        label: "写入人物文档",
        description:
          "覆盖一名人物的一份完整文档。空文件可直接写入；已有正文必须先完整读取并明确 allow_overwrite_existing=true。首次连续性提交后，仅核心档案仍允许直接写入。",
        parameters: Type.Object({
          character_id: Type.String({ minLength: 3, maxLength: 160 }),
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
            params.document
          );
          const live = await readWholeCharacterDocument(
            target.file,
            index.revision,
            projectRevision,
            signal
          );
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (live.content.trim() && !evidence) {
            return textResult(
              "未写入：目标已有正文，请先调用 read_character_document 完整读取。"
            );
          }
          if (
            live.content.trim() &&
            params.allow_overwrite_existing !== true
          ) {
            return textResult(
              "未写入：目标已有正文；局部修改请使用 replace_character_text，整体重写需设置 allow_overwrite_existing=true。"
            );
          }
          if (
            evidence &&
            (evidence.file.revision !== live.file.revision ||
              evidence.workspaceRevision !== index.revision ||
              evidence.projectRevision !== projectRevision)
          ) {
            throw new Error(
              "Character document changed after it was read."
            );
          }
          const timestamp = new Date().toISOString();
          const summary =
            params.summary?.trim() ||
            `写入人物“${target.characterName}”的${params.document}`;
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
              nextRevision: nextContentRevision(
                live.file.revision,
                params.text
              ),
              updatedAt: timestamp,
              reason: summary
            }]
          });
          return proposalResult(batch, projectRevision, summary);
        }
      }),
      defineTool({
        name: "replace_character_text",
        label: "替换人物文本",
        description:
          "在已完整读取的一份人物文档中按原文片段精确替换。每个 original_text 必须唯一存在；首次连续性提交后，仅核心档案仍允许直接修改。",
        parameters: Type.Object({
          character_id: Type.String({ minLength: 3, maxLength: 160 }),
          document: characterDocumentParameter,
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
          assertCharacterDocumentIsDirectlyWritable(index, params.document);
          const target = resolveCharacterDocumentTarget(
            index,
            params.character_id,
            params.document
          );
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision ||
            evidence.file.revision !== target.file.revision
          ) {
            return textResult(
              "未替换：请先调用 read_character_document 完整读取目标文件。"
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
            `局部修改人物“${target.characterName}”的${params.document}`;
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
          return proposalResult(batch, projectRevision, summary);
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
          profile.id === "worldbuilding"
            ? "提交世界观分类，以及已有条目的重命名、删除和排序等结构变更。此工具不能创建条目，也不能写入正文；创建条目必须使用 create_worldbuilding_file，正文必须使用 write_worldbuilding_file 或 edit_worldbuilding_file。提案只进入审阅队列，不直接写磁盘。"
            : "按显式领域操作提交当前长篇的结构变更提案。伏笔线可分别填写 hiddenTruth 与 plannedSpan，伏笔触点可用 volumeId 或 arcId 设置卷级/剧情点计划锚点。运行时锁定项目版本、生成新实体与文件信息并计算文档内容修订；只能更新逻辑文档目标，不能传路径或文件修订。提案只进入审阅队列，不直接写磁盘。",
        parameters:
          profile.id === "worldbuilding"
            ? LONG_WORLDBUILDING_MUTATION_PARAMETERS
            : LONG_MUTATION_PARAMETERS,
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          throwIfAborted(signal);
          const summary = params.summary.trim();
          if (!summary) {
            throw new Error(
              "Long mutation proposal summary must contain non-whitespace text."
            );
          }
          const { index, projectRevision } = await loadIndex(signal);
          const timestamp = new Date().toISOString();
          const idSeed = `${workspace.bookId}:${input.runId}:${toolCallId}`;
          const built = buildRuntimeOperations({
            rawOperations: params.operations,
            index,
            timestamp,
            idSeed
          });
          const documentUpdates =
            "document_updates" in params
              ? params.document_updates ?? []
              : [];
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
          return textResult(longProposalResultSummary(
            input,
            "已形成长篇结构变更提案，等待客户端审阅与冲突检查。"
          ), {
            kind: "long-mutation-proposal",
            bookId: workspace.bookId,
            agentId: profile.id,
            batch,
            baseProjectRevision: projectRevision,
            summary
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
          "按卷序和卷内叙事顺序，为单章、当前主弧的连续章节或当前卷形成串行写作调度提案；不支持整本调度。提案由客户端依据本轮审批模式处理，获批后启动每章独立写手运行。",
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
            longProposalResultSummary(
              input,
              `已形成从《${firstChapter.title}》开始的 ${chapters.length} 章串行写作调度提案，等待客户端审阅。`
            ),
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
    profile.id === "expert_section_writer" &&
    workspace.activeChapterCardId
  ) {
    const fileWrite = strictObject({
      content: Type.String({
        minLength: 1,
        maxLength: 16 * 1024 * 1024
      })
    });
    tools.push(
      defineTool({
        name: "propose_long_chapter_write",
        label: "提议写入当前章",
        description:
          "为运行时锁定的当前章提交正文证据提案；章末状态和下一章接续包由连续性账本核验正文后生成，不直接写磁盘。",
        parameters: strictObject({
          body: fileWrite,
          summary: Type.String({ minLength: 1, maxLength: 1_000 })
        }),
        executionMode: "sequential",
        execute: async (_toolCallId, params, signal) => {
          throwIfAborted(signal);
          const summary = params.summary.trim();
          if (!summary) {
            throw new Error(
              "Chapter write proposal summary must contain non-whitespace text."
            );
          }
          if (!params.body.content.trim()) {
            throw new Error(
              "Chapter write proposal must provide non-empty body content."
            );
          }
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
              content: "",
              baseRevision: characterStateRevision
            },
            handoff: {
              content: "",
              baseRevision: handoffRevision
            },
            baseWorkspaceRevision: index.revision,
            baseProjectRevision: projectRevision
          });
          return textResult(longProposalResultSummary(
            input,
            "已形成当前章正文证据提案，等待客户端审阅；章末状态与接续包将在连续性入账时生成。"
          ), {
            kind: "long-chapter-write-proposal",
            bookId: workspace.bookId,
            agentId: profile.id,
            input: chapterInput,
            summary
          });
        }
      })
    );
  }

  if (
    capabilities.has("commit_ledger") &&
    writableRoots.has("continuity_ledger") &&
    profile.id === "continuity_ledger" &&
    workspace.activeChapterCardId
  ) {
    tools.push(
      defineTool({
        name: "propose_long_ledger_commit",
        label: "提议提交连续性账本",
        description:
          "以运行时锁定章节的正文为证据，逐域核验人物、剧情、伏笔、世界状态、知识边界与开放环，生成章末状态和下一章接续包，并形成结构化连续性入账提案；不直接写磁盘。",
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
          coverage: strictObject({
            character: strictObject({
              status: literalUnion([
                "changed",
                "unchanged",
                "not_applicable"
              ]),
              note: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            plot: strictObject({
              status: literalUnion([
                "changed",
                "unchanged",
                "not_applicable"
              ]),
              note: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            foreshadowing: strictObject({
              status: literalUnion([
                "changed",
                "unchanged",
                "not_applicable"
              ]),
              note: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            world: strictObject({
              status: literalUnion([
                "changed",
                "unchanged",
                "not_applicable"
              ]),
              note: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            knowledge: strictObject({
              status: literalUnion([
                "changed",
                "unchanged",
                "not_applicable"
              ]),
              note: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            open_loops: strictObject({
              status: literalUnion([
                "changed",
                "unchanged",
                "not_applicable"
              ]),
              note: Type.String({ minLength: 1, maxLength: 4_000 })
            })
          }),
          fact_mutations: Type.Array(
            strictObject({
              fact_id: stableIdParameter("fact"),
              domain: literalUnion([
                "character",
                "relationship",
                "world",
                "plot",
                "foreshadowing"
              ]),
              subject_id: Type.String({ minLength: 3, maxLength: 160 }),
              field: Type.String({ minLength: 1, maxLength: 160 }),
              value: Type.String({ minLength: 1, maxLength: 200_000 }),
              evidence: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            { maxItems: 200_000 }
          ),
          knowledge_mutations: Type.Array(
            strictObject({
              fact_id: stableIdParameter("fact"),
              audience_type: literalUnion([
                "reader",
                "character",
                "faction"
              ]),
              audience_id: Type.Union([
                Type.Null(),
                Type.String({ minLength: 3, maxLength: 160 })
              ]),
              level: literalUnion([
                "unknown",
                "suspects",
                "believes",
                "knows",
                "misled"
              ]),
              evidence: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            { maxItems: 400_000 }
          ),
          open_loop_mutations: Type.Array(
            strictObject({
              loop_id: stableIdParameter("loop"),
              kind: literalUnion([
                "character",
                "relationship",
                "world",
                "plot",
                "foreshadowing",
                "knowledge",
                "continuity"
              ]),
              status: literalUnion([
                "open",
                "progressing",
                "resolved",
                "abandoned"
              ]),
              detail: Type.String({ minLength: 1, maxLength: 200_000 }),
              subject_id: Type.Union([
                Type.Null(),
                Type.String({ minLength: 3, maxLength: 160 })
              ]),
              fact_id: Type.Union([
                Type.Null(),
                stableIdParameter("fact")
              ]),
              evidence: Type.String({ minLength: 1, maxLength: 4_000 })
            }),
            { maxItems: 200_000 }
          ),
          chapter_outputs: strictObject({
            character_state: Type.String({
              minLength: 1,
              maxLength: 200_000
            }),
            handoff: strictObject({
              summary: Type.String({ minLength: 1, maxLength: 200_000 }),
              must_carry: Type.Array(
                Type.String({ minLength: 1, maxLength: 4_000 }),
                { maxItems: 1_024 }
              ),
              next_chapter_constraints: Type.Array(
                Type.String({ minLength: 1, maxLength: 4_000 }),
                { maxItems: 1_024 }
              ),
              open_loops: Type.Array(stableIdParameter("loop"), {
                maxItems: 100_000
              })
            })
          }),
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
          const summary = params.summary.trim();
          if (!summary) {
            throw new Error(
              "Ledger proposal summary must contain non-whitespace text."
            );
          }
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
          const projectedFactById = new Map(
            index.ledger.projection.facts.map((fact) => [fact.factId, fact])
          );
          const projectedFactByKey = new Map(
            index.ledger.projection.facts.map((fact) => [
              `${fact.domain}\0${fact.subjectId}\0${fact.field.normalize("NFC")}`,
              fact
            ])
          );
          const characterIds = new Set(
            index.characters.map(({ id }) => id)
          );
          const worldSubjectIds = new Set(
            index.worldbuilding.map(({ id }) => id)
          );
          const plotSubjectIds = new Set([
            index.bookId,
            ...index.plot.volumes.map(({ id }) => id),
            ...index.plot.arcs.map(({ id }) => id),
            ...index.plot.chapterCards.map(({ id }) => id),
            ...index.plot.storyEvents.map(({ id }) => id),
            ...index.plot.eventConnections.map(({ id }) => id),
            ...index.plot.narrativePlacements.map(({ id }) => id)
          ]);
          const foreshadowingSubjectIds = new Set(
            index.plot.foreshadowing.flatMap((thread) => [
              thread.id,
              ...thread.beats.map(({ id }) => id)
            ])
          );
          for (const mutation of params.fact_mutations) {
            const key =
              `${mutation.domain}\0${mutation.subject_id}\0` +
              mutation.field.trim().normalize("NFC");
            const existingById = projectedFactById.get(mutation.fact_id);
            const existingByKey = projectedFactByKey.get(key);
            if (
              (existingById &&
                (existingById.domain !== mutation.domain ||
                  existingById.subjectId !== mutation.subject_id ||
                  existingById.field !== mutation.field.trim())) ||
              (existingByKey && existingByKey.factId !== mutation.fact_id)
            ) {
              throw new Error(
                "Continuity fact ids and logical keys must remain stable across chapters."
              );
            }
            if (
              (mutation.domain === "character" ||
                mutation.domain === "relationship") &&
              !characterIds.has(mutation.subject_id)
            ) {
              throw new Error(
                "Character and relationship continuity facts must reference an existing character."
              );
            }
            if (
              mutation.domain === "world" &&
              !worldSubjectIds.has(mutation.subject_id)
            ) {
              throw new Error(
                "World continuity facts must reference an existing worldbuilding category."
              );
            }
            if (
              mutation.domain === "plot" &&
              !plotSubjectIds.has(mutation.subject_id)
            ) {
              throw new Error(
                "Plot continuity facts must reference an existing plot object."
              );
            }
            if (
              mutation.domain === "foreshadowing" &&
              !foreshadowingSubjectIds.has(mutation.subject_id)
            ) {
              throw new Error(
                "Foreshadowing continuity facts must reference an existing thread or beat."
              );
            }
          }
          const availableFactIds = new Set([
            ...index.ledger.projection.facts.map(({ factId }) => factId),
            ...params.fact_mutations.map(({ fact_id }) => fact_id)
          ]);
          for (const mutation of params.knowledge_mutations) {
            if (!availableFactIds.has(mutation.fact_id)) {
              throw new Error(
                "Knowledge mutations must reference an existing or newly proposed continuity fact."
              );
            }
            if (
              mutation.audience_type === "reader"
                ? mutation.audience_id !== null
                : mutation.audience_id === null
            ) {
              throw new Error(
                "Reader knowledge uses a null audience id; other audiences require a stable id."
              );
            }
            if (
              mutation.audience_type === "character" &&
              !index.characters.some(({ id }) => id === mutation.audience_id)
            ) {
              throw new Error(
                "Character knowledge must reference an existing character."
              );
            }
          }
          const availableLoopIds = new Set([
            ...index.ledger.projection.openLoops.map(({ loopId }) => loopId),
            ...params.open_loop_mutations.map(({ loop_id }) => loop_id)
          ]);
          if (
            params.open_loop_mutations.some(
              ({ fact_id }) =>
                fact_id !== null && !availableFactIds.has(fact_id)
            ) ||
            params.chapter_outputs.handoff.open_loops.some(
              (loopId) => !availableLoopIds.has(loopId)
            )
          ) {
            throw new Error(
              "Open-loop mutations and handoff references must resolve to projected facts and loops."
            );
          }
          const rootsByFile = fileRootMap(index);
          const characterFilesById = new Map(
            index.characterFiles.map((entry) => [entry.characterId, entry])
          );
          const fileUpdates = params.file_updates ?? [];
          const fileUpdateKeys = fileUpdates.map(
            ({ character_id, document }) =>
              `${character_id}\u0000${document}`
          );
          if (new Set(fileUpdateKeys).size !== fileUpdateKeys.length) {
            throw new Error(
              "Ledger proposal cannot update the same character document twice."
            );
          }
          if (
            fileUpdates.some(
              ({ content }) => content.trim().length === 0
            )
          ) {
            throw new Error(
              "Ledger file updates must contain non-empty content."
            );
          }
          const fileUpdateKeySet = new Set(fileUpdateKeys);
          const changedCharacterIds = new Set(
            params.fact_mutations
              .filter(({ domain }) => domain === "character")
              .map(({ subject_id }) => subject_id)
          );
          const changedRelationshipIds = new Set(
            params.fact_mutations
              .filter(({ domain }) => domain === "relationship")
              .map(({ subject_id }) => subject_id)
          );
          for (const characterId of changedCharacterIds) {
            if (
              !fileUpdateKeySet.has(`${characterId}\0current_state`) ||
              !fileUpdateKeySet.has(`${characterId}\0history`)
            ) {
              throw new Error(
                "Every changed character must materialize both current_state and history through the ledger."
              );
            }
          }
          for (const characterId of changedRelationshipIds) {
            if (
              !fileUpdateKeySet.has(`${characterId}\0relationships`) ||
              !fileUpdateKeySet.has(`${characterId}\0history`)
            ) {
              throw new Error(
                "Every changed relationship must materialize both relationships and history through the ledger."
              );
            }
          }
          const resolvedFileUpdateTargets = fileUpdates.map(
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
            commitMessage: summary,
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
            coverage: {
              character: params.coverage.character,
              plot: params.coverage.plot,
              foreshadowing: params.coverage.foreshadowing,
              world: params.coverage.world,
              knowledge: params.coverage.knowledge,
              openLoops: params.coverage.open_loops
            },
            factMutations: params.fact_mutations.map((mutation) => ({
              factId: mutation.fact_id,
              domain: mutation.domain,
              subjectId: mutation.subject_id,
              field: mutation.field,
              value: mutation.value,
              evidence: mutation.evidence
            })),
            knowledgeMutations: params.knowledge_mutations.map(
              (mutation) => ({
                factId: mutation.fact_id,
                audienceType: mutation.audience_type,
                audienceId: mutation.audience_id,
                level: mutation.level,
                evidence: mutation.evidence
              })
            ),
            openLoopMutations: params.open_loop_mutations.map(
              (mutation) => ({
                loopId: mutation.loop_id,
                kind: mutation.kind,
                status: mutation.status,
                detail: mutation.detail,
                subjectId: mutation.subject_id,
                factId: mutation.fact_id,
                evidence: mutation.evidence
              })
            ),
            chapterOutputs: {
              characterState: params.chapter_outputs.character_state,
              handoff: {
                summary: params.chapter_outputs.handoff.summary,
                mustCarry: params.chapter_outputs.handoff.must_carry,
                nextChapterConstraints:
                  params.chapter_outputs.handoff.next_chapter_constraints,
                openLoops: params.chapter_outputs.handoff.open_loops
              }
            },
            baseWorkspaceRevision: index.revision,
            baseProjectRevision: projectRevision
          });
          throwIfAborted(signal);
          return textResult(longProposalResultSummary(
            input,
            "已形成连续性账本提交提案，等待客户端审阅。"
          ), {
            kind: "long-ledger-commit-proposal",
            bookId: workspace.bookId,
            agentId: profile.id,
            input: commitInput,
            summary
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
