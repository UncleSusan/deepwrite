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
  LONG_CHARACTER_OVERVIEW_CHANGE_ID,
  EMPTY_LONG_MARKDOWN_REVISION,
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterFilePath,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  type AgentWriteApprovalMode,
  type CommandResult,
  type LongAgentProfile,
  type LongCharacterFileChange,
  type LongChapterBodyChange,
  type LongChapterReadiness,
  type LongCommitChapterInput,
  type LongContinuityFileChange,
  type LongContinuityFileRole,
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
      kind: "long-character-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      baseProjectRevision: number;
      summary: string;
      files: LongCharacterFileChange[];
    }
  | {
      kind: "long-continuity-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      baseProjectRevision: number;
      summary: string;
      files: LongContinuityFileChange[];
    }
  | {
      kind: "long-chapter-write-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      baseProjectRevision: number;
      file: LongChapterBodyChange;
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
const plotItemKindParameter = literalUnion([
  "book_line",
  "volume",
  "arc",
  "story_plot",
  "chapter",
  "event",
  "connection",
  "placement"
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
const continuityFileTargetParameter = Type.Union([
  strictObject({
    document: literalUnion([
      "foreshadowing_changes",
      "world_reveals",
      "chapter_end_state",
      "handoff"
    ] as const)
  }),
  strictObject({
    document: literalUnion([
      "character_current_state",
      "character_history"
    ] as const),
    character_id: stableIdParameter("character")
  })
]);
const continuityCreateTargetParameter = Type.Union([
  strictObject({ document: Type.Literal("world_reveals") }),
  strictObject({
    document: Type.Literal("character"),
    character_id: stableIdParameter("character")
  })
]);
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
    summary: Type.Optional(textParameter),
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
    title: titleParameter
  }),
  strictObject({
    type: Type.Literal("chapter.update"),
    id: entityReferenceParameter("chapter"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
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
    type: Type.Literal("storyPlot.create"),
    client_ref: clientReferenceParameter,
    arcId: entityReferenceParameter("arc"),
    title: titleParameter
  }),
  strictObject({
    type: Type.Literal("storyPlot.update"),
    id: entityReferenceParameter("storyplot"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
    })
  }),
  strictObject({
    type: Type.Literal("storyPlot.delete"),
    id: entityReferenceParameter("storyplot"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("storyPlot.reorder"),
    arcId: entityReferenceParameter("arc"),
    orderedIds: Type.Array(entityReferenceParameter("storyplot"), {
      maxItems: 100_000,
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

const LONG_CHARACTER_STRUCTURE_OPERATION_PARAMETER = Type.Union([
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
      maxItems: 100_000,
      uniqueItems: true
    })
  })
]);

const LONG_CHARACTER_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_CHARACTER_STRUCTURE_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

const LONG_PLOT_STRUCTURE_OPERATION_PARAMETER = Type.Union([
  strictObject({
    type: Type.Literal("volume.update"),
    id: entityReferenceParameter("volume"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: Type.Literal("volume.delete"),
    id: entityReferenceParameter("volume"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("volume.reorder"),
    orderedIds: Type.Array(entityReferenceParameter("volume"), {
      maxItems: 10_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: Type.Literal("arc.update"),
    id: entityReferenceParameter("arc"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
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
      maxItems: 100_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: Type.Literal("chapter.update"),
    id: entityReferenceParameter("chapter"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
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
    beforeChapterCardId: Type.Optional(entityReferenceParameter("chapter"))
  }),
  strictObject({
    type: Type.Literal("chapter.reorder"),
    volumeId: entityReferenceParameter("volume"),
    orderedIds: Type.Array(entityReferenceParameter("chapter"), {
      maxItems: 100_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: Type.Literal("event.update"),
    id: entityReferenceParameter("event"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: Type.Literal("event.delete"),
    id: entityReferenceParameter("event"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("event.reorder"),
    orderedIds: Type.Array(entityReferenceParameter("event"), {
      maxItems: 200_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: Type.Literal("storyPlot.update"),
    id: entityReferenceParameter("storyplot"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: Type.Literal("storyPlot.delete"),
    id: entityReferenceParameter("storyplot"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("storyPlot.reorder"),
    arcId: entityReferenceParameter("arc"),
    orderedIds: Type.Array(entityReferenceParameter("storyplot"), {
      maxItems: 100_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: Type.Literal("connection.update"),
    id: entityReferenceParameter("connection"),
    patch: patchParameter({
      sourceEventId: Type.Optional(entityReferenceParameter("event")),
      targetEventId: Type.Optional(entityReferenceParameter("event")),
      connectionType: Type.Optional(connectionTypeParameter)
    })
  }),
  strictObject({
    type: Type.Literal("connection.delete"),
    id: entityReferenceParameter("connection"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: Type.Literal("placement.update"),
    id: entityReferenceParameter("placement"),
    patch: patchParameter({
      eventId: Type.Optional(entityReferenceParameter("event")),
      mode: Type.Optional(narrativeModeParameter),
      disclosure: Type.Optional(disclosureParameter)
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
    beforePlacementId: Type.Optional(entityReferenceParameter("placement"))
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
      maxItems: 100_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: Type.Literal("foreshadowingBeat.create"),
    client_ref: clientReferenceParameter,
    threadId: entityReferenceParameter("foreshadow"),
    beatType: beatTypeParameter,
    volumeId: Type.Optional(nullableEntityReferenceParameter("volume", "卷级计划锚点；传 null 可清空。")),
    arcId: Type.Optional(nullableEntityReferenceParameter("arc", "剧情点计划锚点；传 null 可清空。")),
    eventId: Type.Optional(Type.Union([entityReferenceParameter("event"), Type.Null()])),
    placementId: Type.Optional(Type.Union([entityReferenceParameter("placement"), Type.Null()])),
    chapterCardId: Type.Optional(Type.Union([entityReferenceParameter("chapter"), Type.Null()])),
    plannedScope: Type.Optional(Type.String({ maxLength: 1_000 })),
    note: Type.Optional(shortTextParameter)
  }),
  strictObject({
    type: Type.Literal("foreshadowingBeat.update"),
    id: entityReferenceParameter("beat"),
    patch: patchParameter({
      beatType: Type.Optional(beatTypeParameter),
      volumeId: Type.Optional(nullableEntityReferenceParameter("volume", "更新卷级计划锚点；传 null 可清空。")),
      arcId: Type.Optional(nullableEntityReferenceParameter("arc", "更新剧情点计划锚点；传 null 可清空。")),
      eventId: Type.Optional(Type.Union([entityReferenceParameter("event"), Type.Null()])),
      placementId: Type.Optional(Type.Union([entityReferenceParameter("placement"), Type.Null()])),
      chapterCardId: Type.Optional(Type.Union([entityReferenceParameter("chapter"), Type.Null()])),
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
      maxItems: 10_000,
      uniqueItems: true
    })
  })
]);

const LONG_PLOT_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_PLOT_STRUCTURE_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

const LONG_PLOT_CREATE_PARAMETERS = strictObject({
  item: Type.Union([
    strictObject({
      kind: Type.Literal("volume"),
      title: titleParameter,
      summary: Type.Optional(textParameter)
    }),
    strictObject({
      kind: Type.Literal("arc"),
      volume_id: entityReferenceParameter("volume"),
      title: titleParameter,
      summary: Type.Optional(textParameter),
      outline: Type.Optional(textParameter)
    }),
    strictObject({
      kind: Type.Literal("story_plot"),
      arc_id: entityReferenceParameter("arc"),
      title: titleParameter
    }),
    strictObject({
      kind: Type.Literal("chapter"),
      volume_id: entityReferenceParameter("volume"),
      primary_arc_id: entityReferenceParameter("arc"),
      title: titleParameter
    }),
    strictObject({
      kind: Type.Literal("event"),
      title: titleParameter,
      summary: Type.Optional(textParameter),
      time_mode: storyTimeModeParameter,
      time_label: Type.Optional(Type.String({ maxLength: 1_000 })),
      time_value: Type.Optional(Type.String({ maxLength: 1_000 })),
      location: Type.Optional(Type.String({ maxLength: 1_000 })),
      arc_ids: Type.Optional(
        Type.Array(entityReferenceParameter("arc"), {
          maxItems: 1_024,
          uniqueItems: true
        })
      ),
      character_ids: Type.Optional(
        Type.Array(entityReferenceParameter("character"), {
          maxItems: 1_024,
          uniqueItems: true
        })
      )
    }),
    strictObject({
      kind: Type.Literal("connection"),
      source_event_id: entityReferenceParameter("event"),
      target_event_id: entityReferenceParameter("event"),
      connection_type: connectionTypeParameter,
      note: Type.Optional(shortTextParameter)
    }),
    strictObject({
      kind: Type.Literal("placement"),
      event_id: entityReferenceParameter("event"),
      chapter_card_id: entityReferenceParameter("chapter"),
      mode: narrativeModeParameter,
      disclosure: disclosureParameter,
      writing_prompt: Type.Optional(shortTextParameter)
    }),
    strictObject({
      kind: Type.Literal("placements"),
      items: Type.Array(
        strictObject({
          event_id: entityReferenceParameter("event"),
          chapter_card_id: entityReferenceParameter("chapter"),
          mode: narrativeModeParameter,
          disclosure: disclosureParameter,
          writing_prompt: Type.Optional(shortTextParameter)
        }),
        { minItems: 1, maxItems: 50 }
      )
    })
  ]),
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 }))
});

const LONG_PLOT_ITEM_TARGET_PARAMETER = Type.Union([
  strictObject({ kind: Type.Literal("book_line") }),
  strictObject({ kind: Type.Literal("volume"), volume_id: stableIdParameter("volume") }),
  strictObject({ kind: Type.Literal("arc"), arc_id: stableIdParameter("arc") }),
  strictObject({ kind: Type.Literal("story_plot"), story_plot_id: stableIdParameter("storyplot") }),
  strictObject({ kind: Type.Literal("chapter"), chapter_card_id: stableIdParameter("chapter") }),
  strictObject({ kind: Type.Literal("event"), event_id: stableIdParameter("event") }),
  strictObject({ kind: Type.Literal("connection"), connection_id: stableIdParameter("connection") }),
  strictObject({ kind: Type.Literal("placement"), placement_id: stableIdParameter("placement") })
]);

const LONG_PLOT_WRITE_PARAMETERS = strictObject({
  item: Type.Union([
    strictObject({ kind: Type.Literal("book_line"), text: Type.String({ minLength: 1, maxLength: 1_000_000 }) }),
    strictObject({ kind: Type.Literal("volume"), volume_id: stableIdParameter("volume"), summary: textParameter }),
    strictObject({ kind: Type.Literal("arc"), arc_id: stableIdParameter("arc"), summary: textParameter, outline: textParameter }),
    strictObject({ kind: Type.Literal("story_plot"), story_plot_id: stableIdParameter("storyplot"), text: Type.String({ minLength: 1, maxLength: 1_000_000 }) }),
    strictObject({
      kind: Type.Literal("chapter"),
      chapter_card_id: stableIdParameter("chapter"),
      text: Type.String({ minLength: 1, maxLength: 1_000_000 })
    }),
    strictObject({
      kind: Type.Literal("event"),
      event_id: stableIdParameter("event"),
      summary: textParameter,
      time_mode: storyTimeModeParameter,
      time_label: Type.String({ maxLength: 1_000 }),
      time_value: Type.Optional(Type.String({ maxLength: 1_000 })),
      location: Type.String({ maxLength: 1_000 }),
      arc_ids: Type.Array(entityReferenceParameter("arc"), { maxItems: 1_024, uniqueItems: true }),
      character_ids: Type.Array(entityReferenceParameter("character"), { maxItems: 1_024, uniqueItems: true })
    }),
    strictObject({ kind: Type.Literal("connection"), connection_id: stableIdParameter("connection"), note: shortTextParameter }),
    strictObject({ kind: Type.Literal("placement"), placement_id: stableIdParameter("placement"), writing_prompt: shortTextParameter })
  ]),
  allow_overwrite_existing: Type.Optional(Type.Boolean()),
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 }))
});

const LONG_PLOT_EDIT_PARAMETERS = strictObject({
  item: Type.Union([
    strictObject({
      kind: Type.Literal("book_line"),
      replacements: Type.Array(
        strictObject({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }),
        { minItems: 1, maxItems: 20 }
      )
    }),
    strictObject({ kind: Type.Literal("volume"), volume_id: stableIdParameter("volume"), patch: patchParameter({ summary: Type.Optional(textParameter) }) }),
    strictObject({ kind: Type.Literal("arc"), arc_id: stableIdParameter("arc"), patch: patchParameter({ summary: Type.Optional(textParameter), outline: Type.Optional(textParameter) }) }),
    strictObject({
      kind: Type.Literal("story_plot"),
      story_plot_id: stableIdParameter("storyplot"),
      replacements: Type.Array(
        strictObject({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }),
        { minItems: 1, maxItems: 20 }
      )
    }),
    strictObject({
      kind: Type.Literal("chapter"),
      chapter_card_id: stableIdParameter("chapter"),
      replacements: Type.Array(
        strictObject({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }),
        { minItems: 1, maxItems: 20 }
      )
    }),
    strictObject({
      kind: Type.Literal("event"), event_id: stableIdParameter("event"),
      patch: patchParameter({
        summary: Type.Optional(textParameter),
        time_mode: Type.Optional(storyTimeModeParameter),
        time_label: Type.Optional(Type.String({ maxLength: 1_000 })),
        time_value: Type.Optional(Type.String({ maxLength: 1_000 })),
        location: Type.Optional(Type.String({ maxLength: 1_000 })),
        arc_ids: Type.Optional(Type.Array(entityReferenceParameter("arc"), { maxItems: 1_024, uniqueItems: true })),
        character_ids: Type.Optional(Type.Array(entityReferenceParameter("character"), { maxItems: 1_024, uniqueItems: true }))
      })
    }),
    strictObject({ kind: Type.Literal("connection"), connection_id: stableIdParameter("connection"), patch: patchParameter({ note: Type.Optional(shortTextParameter) }) }),
    strictObject({ kind: Type.Literal("placement"), placement_id: stableIdParameter("placement"), patch: patchParameter({ writing_prompt: Type.Optional(shortTextParameter) }) })
  ]),
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 }))
});

function textResult(
  text: string,
  details: LongAgentToolDetails = { kind: "none" }
): AgentToolResult<LongAgentToolDetails> {
  return { content: [{ type: "text", text }], details };
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
  if (prefix === "chapterContinuity") return "continuity_ledger";
  // Chapter cards are plot structure. Their three Markdown files live under
  // the draft root, but generic structure proposals may only create those
  // empty files; chapter prose is owned by the typed chapter draft tools.
  if (prefix === "chapter") return "plot_design";
  return "plot_design";
}

function createdFileRootForOperation(
  operation: LongWorkspaceOperation
): LongWorkspaceRoot {
  if (operation.type === "chapter.create") return "draft";
  return rootForOperation(operation);
}

function filePathBelongsToRoot(
  file: LongWorkspaceFileReference,
  root: LongWorkspaceRoot
): boolean {
  if (
    root === "plot_design" &&
    file.id.startsWith("file_chapter_") &&
    file.id.endsWith(":card") &&
    file.path.startsWith("long/chapters/") &&
    file.path.endsWith("/card.md")
  ) {
    return true;
  }
  const prefixes: Record<LongWorkspaceRoot, readonly string[]> = {
    worldbuilding: ["long/worldbuilding/"],
    character_design: ["long/characters/"],
    plot_design: ["long/plot/", "long/story-plots/"],
    draft: ["long/chapters/"],
    continuity_ledger: ["long/continuity/", "long/ledger/"]
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
  for (const storyPlot of index.plot.storyPlots) {
    addFile(map, "plot_design", storyPlot.file);
  }
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
  if (index.characterOverview) {
    addFile(map, "character_design", index.characterOverview);
  }
  for (const entry of index.characterFiles) {
    addFile(map, "character_design", entry.coreProfile);
    addFile(map, "character_design", entry.relationships);
    addFile(map, "character_design", entry.currentState);
    addFile(map, "character_design", entry.history);
  }
  for (const entry of index.chapters) {
    addFile(map, "draft", entry.body);
    addFile(map, "plot_design", entry.card);
    addFile(map, "draft", entry.characterState);
    addFile(map, "draft", entry.handoff);
    addFile(map, "continuity_ledger", entry.foreshadowingChanges);
    if (entry.worldReveals) {
      addFile(map, "continuity_ledger", entry.worldReveals);
    }
    for (const character of entry.characterContinuity) {
      addFile(map, "continuity_ledger", character.currentState);
      addFile(map, "continuity_ledger", character.history);
    }
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
  if (operation.type === "storyPlot.create") {
    return [operation.storyPlot.file];
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
      operation.files.card,
      operation.files.characterState,
      operation.files.handoff,
      operation.files.foreshadowingChanges
    ];
  }
  if (operation.type === "chapterContinuity.worldReveals.create") {
    return [operation.file];
  }
  if (operation.type === "chapterContinuity.character.create") {
    return [operation.currentState, operation.history];
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
  "storyPlot.create": "storyplot",
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
    ...index.plot.storyPlots.map(({ id }) => id),
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
  const storyPlotOrders = new Map<string, number>();
  for (const storyPlot of input.index.plot.storyPlots) {
    storyPlotOrders.set(
      storyPlot.arcId,
      Math.max(storyPlotOrders.get(storyPlot.arcId) ?? 0, storyPlot.order)
    );
  }
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
              ...(operation.summary === undefined
                ? {}
                : { summary: operation.summary }),
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
              narrativeOrder: incrementCounter(chapterOrders, volumeId)
            },
            files: {
              chapterCardId: id,
              body: createEmptyLongMarkdownFileReference(
                longChapterBodyFileId(id),
                longChapterFilePath(id, "body.md"),
                input.timestamp
              ),
              card: createEmptyLongMarkdownFileReference(
                longChapterCardFileId(id),
                longChapterFilePath(id, "card.md"),
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
              foreshadowingChanges: createEmptyLongMarkdownFileReference(
                longChapterForeshadowingChangesFileId(id),
                longChapterContinuityFilePath(
                  id,
                  "foreshadowing-changes.md"
                ),
                input.timestamp
              ),
              worldReveals: null,
              characterContinuity: [],
              commitId: null
            }
          };
        }
        case "chapter.update":
          return {
            type: operation.type,
            id: ref(operation.id, "chapter"),
            patch: operation.patch
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

        case "storyPlot.create": {
          const id = generatedId!;
          const arcId = ref(operation.arcId, "arc");
          return {
            type: operation.type,
            storyPlot: {
              id,
              arcId,
              title: operation.title,
              order: incrementCounter(storyPlotOrders, arcId),
              file: createEmptyLongMarkdownFileReference(
                longStoryPlotBodyFileId(id),
                longStoryPlotFilePath(id),
                input.timestamp
              )
            }
          };
        }
        case "storyPlot.update":
        case "storyPlot.delete":
          return {
            ...operation,
            id: ref(operation.id, "storyplot")
          } as LongWorkspaceOperation;
        case "storyPlot.reorder":
          return {
            type: operation.type,
            arcId: ref(operation.arcId, "arc"),
            orderedIds: refs(operation.orderedIds, "storyplot")
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
    kind === "long-character-file-proposal" ||
    kind === "long-continuity-file-proposal" ||
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
  const isCharacterDesignAgent = profile.id === "character_design";
  const isPlotDesignAgent = profile.id === "plot_design";
  const isDraftWritingAgent =
    profile.id === "draft" || profile.id === "expert_section_writer";
  const isContinuityLedgerAgent = profile.id === "continuity_ledger";
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
  const characterDocumentOverlay = new Map<
    string,
    {
      characterId: string;
      characterName: string;
      characterGroup?:
        | "protagonist"
        | "major_supporting"
        | "minor_supporting"
        | "passerby";
      aliases?: string[];
      document:
        | "overview"
        | "core_profile"
        | "relationships"
        | "current_state"
        | "history";
      file: LongWorkspaceFileReference;
      content: string;
      pendingCreation: boolean;
    }
  >();
  type PlotItemKind = Static<typeof plotItemKindParameter>;
  const fullyReadPlotItems = new Map<
    string,
    {
      serialized: string;
      workspaceRevision: number;
      projectRevision: number;
    }
  >();
  const fullyReadChapterBodies = new Map<
    string,
    {
      content: string;
      file: LongWorkspaceFileReference;
      workspaceRevision: number;
      projectRevision: number;
    }
  >();
  const chapterBodyOverlay = new Map<
    string,
    {
      chapterCardId: string;
      chapterTitle: string;
      file: LongWorkspaceFileReference;
      content: string;
    }
  >();
  const fullyReadContinuityDocuments = new Map<
    string,
    {
      content: string;
      file: LongWorkspaceFileReference;
      workspaceRevision: number;
      projectRevision: number;
    }
  >();
  const continuityDocumentOverlay = new Map<
    string,
    {
      chapterCardId: string;
      chapterTitle: string;
      role: LongContinuityFileRole;
      characterId: string | null;
      characterName: string | null;
      file: LongWorkspaceFileReference;
      content: string;
      pendingCreation: boolean;
    }
  >();

  const storyPlotOverlay = new Map<
    string,
    {
      arcId: string;
      title: string;
      order: number;
      file: LongWorkspaceFileReference;
      content: string;
      pendingCreation: boolean;
    }
  >();

  // 与 storyPlotOverlay 同理：本轮创建但尚未落盘的章卡只存在于缓存快照之外，
  // 需要内存覆盖层支撑同轮 read/write/edit 与 narrativeOrder 的连续分配。
  const chapterCardOverlay = new Map<
    string,
    {
      volumeId: string;
      primaryArcId: string;
      title: string;
      narrativeOrder: number;
      file: LongWorkspaceFileReference;
      content: string;
      pendingCreation: boolean;
    }
  >();

  const plotItemKey = (kind: PlotItemKind, id?: string) =>
    kind === "book_line" ? kind : `${kind}:${id ?? ""}`;

  const plotBusinessId = (
    item: { kind: Exclude<PlotItemKind, "book_line"> } & Record<string, unknown>
  ): string => {
    const id =
      item.kind === "volume"
        ? item.volume_id
        : item.kind === "arc"
          ? item.arc_id
          : item.kind === "story_plot"
            ? item.story_plot_id
            : item.kind === "chapter"
              ? item.chapter_card_id
              : item.kind === "event"
                ? item.event_id
                : item.kind === "connection"
                  ? item.connection_id
                  : item.placement_id;
    if (typeof id !== "string") {
      throw new Error(`Plot ${item.kind} target is missing its business id.`);
    }
    return id;
  };

  const resolvePlotItem = (
    index: LongWorkspaceIndexSnapshot,
    kind: Exclude<PlotItemKind, "book_line">,
    id: string
  ): Record<string, unknown> => {
    const collection =
      kind === "volume"
        ? index.plot.volumes
        : kind === "arc"
          ? index.plot.arcs
          : kind === "story_plot"
            ? index.plot.storyPlots
            : kind === "chapter"
              ? index.plot.chapterCards
              : kind === "event"
                ? index.plot.storyEvents
                : kind === "connection"
                  ? index.plot.eventConnections
                  : index.plot.narrativePlacements;
    const item = collection.find((candidate) => candidate.id === id);
    if (!item) {
      throw new Error(`Plot ${kind} ${id} does not exist.`);
    }
    return item as unknown as Record<string, unknown>;
  };

  const toPlotBusinessItem = (
    kind: Exclude<PlotItemKind, "book_line">,
    item: Record<string, unknown>
  ): Record<string, unknown> => {
    if (kind === "volume") {
      return {
        kind,
        volume_id: item.id,
        title: item.title,
        order: item.order,
        summary: item.summary
      };
    }
    if (kind === "arc") {
      return {
        kind,
        arc_id: item.id,
        volume_id: item.volumeId,
        title: item.title,
        order: item.order,
        summary: item.summary ?? "",
        outline: item.outline
      };
    }
    if (kind === "story_plot") {
      return {
        kind,
        story_plot_id: item.id,
        arc_id: item.arcId,
        title: item.title,
        order: item.order
      };
    }
    if (kind === "chapter") {
      return {
        kind,
        chapter_card_id: item.id,
        volume_id: item.volumeId,
        primary_arc_id: item.primaryArcId,
        title: item.title,
        narrative_order: item.narrativeOrder
      };
    }
    if (kind === "event") {
      return {
        kind,
        event_id: item.id,
        title: item.title,
        summary: item.summary,
        time_mode: item.timeMode,
        time_label: item.timeLabel,
        ...(item.timeValue === undefined ? {} : { time_value: item.timeValue }),
        story_order: item.storyOrder,
        location: item.location,
        arc_ids: item.arcIds,
        character_ids: item.characterIds
      };
    }
    if (kind === "connection") {
      return {
        kind,
        connection_id: item.id,
        source_event_id: item.sourceEventId,
        target_event_id: item.targetEventId,
        connection_type: item.type,
        note: item.note
      };
    }
    return {
      kind,
      placement_id: item.id,
      event_id: item.eventId,
      chapter_card_id: item.chapterCardId,
      order_in_chapter: item.orderInChapter,
      mode: item.mode,
      disclosure: item.disclosure,
      writing_prompt: item.writingPrompt,
      status: item.status,
      commit_id: item.commitId
    };
  };

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

  const resolveCharacterOverviewTarget = (
    index: LongWorkspaceIndexSnapshot
  ): {
    file: LongWorkspaceFileReference;
    overlay?: {
      content: string;
      pendingCreation: boolean;
    };
  } => {
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
    overlay?: {
      content: string;
      pendingCreation: boolean;
    };
  } => {
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
    !isWorldbuildingAgent &&
    !isCharacterDesignAgent &&
    !isPlotDesignAgent &&
    !isDraftWritingAgent &&
    !isContinuityLedgerAgent
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
    (isWorldbuildingAgent ||
      isCharacterDesignAgent ||
      isPlotDesignAgent ||
      isDraftWritingAgent ||
      isContinuityLedgerAgent) &&
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

  const CHARACTER_DOCUMENT_TITLES = {
    core_profile: "核心档案",
    relationships: "人物关系",
    current_state: "当前状态",
    history: "历史轨迹"
  } as const;

  const assertCharacterDocumentIsDirectlyWritable = (
    index: LongWorkspaceIndexSnapshot,
    document: keyof typeof CHARACTER_DOCUMENT_TITLES
  ) => {
    if (index.ledger.commits.length > 0 && document !== "core_profile") {
      throw new Error(
        "After the first continuity commit, relationships, current state, and history are ledger-owned; only the core profile remains directly writable."
      );
    }
  };

  if (
    (isCharacterDesignAgent ||
      isPlotDesignAgent ||
      isDraftWritingAgent ||
      isContinuityLedgerAgent) &&
    capabilities.has("query_structure") &&
    readableRoots.has("character_design")
  ) {
    tools.push(
      defineTool({
        name: "list_characters",
        label: "列出人物",
        description:
          "列出人物业务索引，可按分组筛选，并自动附带人物设计阶段手动维护的概览完整内容，同时建立本轮 write_character_overview / edit_character_overview 所需的完整读取凭据。优先用概览中的 character_id 定位人物。返回 character_id、姓名、分组和别名，不暴露文件与版本信息。",
        parameters: strictObject({
          group: Type.Optional(characterGroupParameter),
          page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const pending = new Map<
            string,
            {
              character_id: string;
              name: string;
              group: string;
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
              group: candidate.characterGroup ?? "major_supporting",
              aliases: candidate.aliases ?? []
            });
          }
          const characters = [
            ...index.characters.map((character) => ({
              character_id: character.id,
              name: character.name,
              group: character.group,
              aliases: character.aliases
            })),
            ...pending.values()
          ].filter(
            (character) =>
              !params.group || character.group === params.group
          );
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
          const page = params.page ?? 1;
          const limit = params.limit ?? 50;
          const start = (page - 1) * limit;
          const end = Math.min(start + limit, characters.length);
          return textResult(JSON.stringify({
            overview,
            characters: characters.slice(start, end),
            next_page: end < characters.length ? page + 1 : null
          }));
        }
      }),
      defineTool({
        name: "search_characters",
        label: "搜索人物",
        description:
          "搜索人物四类文档，返回可继续读取的 character_id、姓名、document 和少量上下文；不返回文件、路径或版本信息。",
        parameters: strictObject({
          query: Type.String({ minLength: 1, maxLength: 256 }),
          group: Type.Optional(characterGroupParameter),
          document: Type.Optional(characterDocumentParameter),
          page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
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
                  id: `long-query-${input.runId}-character-search-${++querySequence}`,
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
              group: string;
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
              group: character.group,
              document: "core_profile"
            });
            targets.set(files.relationships.id, {
              character_id: character.id,
              name: character.name,
              group: character.group,
              document: "relationships"
            });
            targets.set(files.currentState.id, {
              character_id: character.id,
              name: character.name,
              group: character.group,
              document: "current_state"
            });
            targets.set(files.history.id, {
              character_id: character.id,
              name: character.name,
              group: character.group,
              document: "history"
            });
          }
          const hits = result.hits.flatMap((hit) => {
            const target = targets.get(hit.fileId);
            if (!target) {
              throw new Error("Core returned an unknown character document.");
            }
            if (
              (params.group && target.group !== params.group) ||
              (params.document && target.document !== params.document)
            ) return [];
            return [
              {
                character_id: target.character_id,
                name: target.name,
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
            params.document
          );
          const result = target.overlay
            ? { content: target.overlay.content, file: target.file }
            : await readWholeCharacterDocument(
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

  if (
    isCharacterDesignAgent &&
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

    tools.push(
      defineTool({
        name: "create_character",
        label: "创建人物",
        description:
          "创建一名人物及核心档案、人物关系、当前状态、历史轨迹四份空白 Markdown 文档，返回稳定 character_id。本工具不接受初始化正文；创建后分别使用 write_character_file。",
        parameters: strictObject({
          name: titleParameter,
          group: characterGroupParameter,
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
                  candidate.characterGroup === params.group
              )
              .map(({ characterId }) => characterId)
          ).size;
          if (index.characters.length + pendingCharacterIds.size >= 100_000) {
            throw new Error(
              "A long workspace supports at most 100,000 characters."
            );
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
          const characterId = `character_${stableHash(
            `${workspace.bookId}:${input.runId}:${toolCallId}`
          ).slice(0, 24)}`;
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
              group: params.group,
              order: maxOrder(
                index.characters
                  .filter(({ group }) => group === params.group)
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
              characterGroup: params.group,
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
            )}\n${name} → character_id=${characterId}\n同一轮内可立即使用该 character_id 调用 write_character_file。`,
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
            params.document
          );
          const live = target.overlay
            ? { file: target.file, content: target.overlay.content }
            : await readWholeCharacterDocument(
                target.file,
                index.revision,
                projectRevision,
                signal
              );
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (live.content.trim() && !evidence) {
            return textResult(
              "未写入：目标已有正文，请先调用 read_character（mode=full）完整读取。"
            );
          }
          if (live.content.trim() && params.allow_overwrite_existing !== true) {
            return textResult(
              "未写入：目标已有正文；局部修改请使用 edit_character_file，整体重写需设置 allow_overwrite_existing=true。"
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
              "未编辑：请先调用 read_character（mode=full）完整读取目标内容。"
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
          const target = resolveCharacterOverviewTarget(index);
          const live = target.overlay
            ? { file: target.file, content: target.overlay.content }
            : await readWholeCharacterDocument(
                target.file,
                index.revision,
                projectRevision,
                signal
              );
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (live.content.trim() && !evidence) {
            return textResult(
              "未写入：目标已有正文，请先调用 list_characters 完整读取概览。"
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
          const target = resolveCharacterOverviewTarget(index);
          const evidence = fullyReadCharacterDocuments.get(target.file.id);
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision ||
            evidence.file.revision !== target.file.revision
          ) {
            return textResult(
              "未编辑：请先调用 list_characters 完整读取概览内容。"
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

  if (
    (isPlotDesignAgent || isDraftWritingAgent || isContinuityLedgerAgent) &&
    capabilities.has("query_structure") &&
    readableRoots.has("plot_design")
  ) {
    const plotCollections = (index: LongWorkspaceIndexSnapshot) => ({
      volume: index.plot.volumes,
      arc: index.plot.arcs,
      story_plot: index.plot.storyPlots,
      chapter: index.plot.chapterCards,
      event: index.plot.storyEvents,
      connection: index.plot.eventConnections,
      placement: index.plot.narrativePlacements
    });

    tools.push(
      defineTool({
        name: "list_plot_design",
        label: "列出剧情设计",
        description:
          "列出全书故事线及剧情结构类型；指定 kind 时分页返回对应条目的业务 ID 与标题/关联摘要。伏笔不在本工具中，继续使用现有伏笔结构工具。",
        parameters: strictObject({
          kind: Type.Optional(plotItemKindParameter),
          volume_id: Type.Optional(stableIdParameter("volume")),
          arc_id: Type.Optional(stableIdParameter("arc")),
          chapter_card_id: Type.Optional(stableIdParameter("chapter")),
          page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
          if (!params.kind) {
            const pendingStoryPlotCount = [...storyPlotOverlay.entries()].filter(
              ([id, entry]) =>
                entry.pendingCreation &&
                !index.plot.storyPlots.some((storyPlot) => storyPlot.id === id)
            ).length;
            const pendingChapterCount = [...chapterCardOverlay.entries()].filter(
              ([id, entry]) =>
                entry.pendingCreation &&
                !index.plot.chapterCards.some((chapter) => chapter.id === id)
            ).length;
            return textResult(JSON.stringify({
              sections: [
                { kind: "book_line", label: "全书故事线", count: 1 },
                { kind: "volume", label: "分卷", count: index.plot.volumes.length },
                { kind: "arc", label: "剧情点", count: index.plot.arcs.length },
                { kind: "story_plot", label: "故事情节", count: index.plot.storyPlots.length + pendingStoryPlotCount },
                { kind: "chapter", label: "章卡", count: index.plot.chapterCards.length + pendingChapterCount },
                { kind: "event", label: "故事事件", count: index.plot.storyEvents.length },
                { kind: "connection", label: "事件连接", count: index.plot.eventConnections.length },
                { kind: "placement", label: "叙事落点", count: index.plot.narrativePlacements.length }
              ],
              note: "伏笔线与伏笔触点沿用独立的现有工具设计。"
            }));
          }
          if (params.kind === "book_line") {
            return textResult(JSON.stringify({
              items: [{ kind: "book_line", title: "全书故事线" }],
              next_page: null
            }));
          }
          const source = plotCollections(index)[params.kind]
            .filter((item) => {
              const value = item as unknown as Record<string, unknown>;
              return (
                (!params.volume_id || value.volumeId === params.volume_id) &&
                (!params.arc_id || value.arcId === params.arc_id) &&
                (!params.chapter_card_id || value.chapterCardId === params.chapter_card_id)
              );
            })
            .map((item) => {
              const value = toPlotBusinessItem(
                params.kind as Exclude<PlotItemKind, "book_line">,
                item as unknown as Record<string, unknown>
              );
              return {
                kind: params.kind,
                ...(params.kind === "volume" ? { volume_id: item.id } : {}),
                ...(params.kind === "arc" ? { arc_id: item.id } : {}),
                ...(params.kind === "story_plot" ? { story_plot_id: item.id } : {}),
                ...(params.kind === "chapter" ? { chapter_card_id: item.id } : {}),
                ...(params.kind === "event" ? { event_id: item.id } : {}),
                ...(params.kind === "connection" ? { connection_id: item.id } : {}),
                ...(params.kind === "placement" ? { placement_id: item.id } : {}),
                ...(typeof value.title === "string" ? { title: value.title } : {}),
                ...(value.volume_id ? { volume_id: value.volume_id } : {}),
                ...(value.arc_id && params.kind !== "arc" ? { arc_id: value.arc_id } : {}),
                ...(value.chapter_card_id ? { chapter_card_id: value.chapter_card_id } : {}),
                ...(value.source_event_id ? { source_event_id: value.source_event_id } : {}),
                ...(value.target_event_id ? { target_event_id: value.target_event_id } : {}),
                ...(value.event_id ? { event_id: value.event_id } : {})
              };
            });
          const pendingStoryPlots =
            params.kind === "story_plot"
              ? [...storyPlotOverlay.entries()]
                  .filter(
                    ([id, entry]) =>
                      entry.pendingCreation &&
                      !index.plot.storyPlots.some((storyPlot) => storyPlot.id === id) &&
                      (!params.arc_id || entry.arcId === params.arc_id)
                  )
                  .map(([id, entry]) => ({
                    kind: params.kind as "story_plot",
                    story_plot_id: id,
                    title: entry.title,
                    arc_id: entry.arcId,
                    order: entry.order
                  }))
              : [];
          const pendingChapterCards =
            params.kind === "chapter"
              ? [...chapterCardOverlay.entries()]
                  .filter(
                    ([id, entry]) =>
                      entry.pendingCreation &&
                      !index.plot.chapterCards.some((chapter) => chapter.id === id) &&
                      (!params.volume_id || entry.volumeId === params.volume_id) &&
                      (!params.arc_id || entry.primaryArcId === params.arc_id)
                  )
                  .map(([id, entry]) => ({
                    kind: params.kind as "chapter",
                    chapter_card_id: id,
                    title: entry.title,
                    volume_id: entry.volumeId,
                    primary_arc_id: entry.primaryArcId,
                    narrative_order: entry.narrativeOrder
                  }))
              : [];
          const items = [...source, ...pendingStoryPlots, ...pendingChapterCards];
          const page = params.page ?? 1;
          const limit = params.limit ?? 50;
          const start = (page - 1) * limit;
          const end = Math.min(start + limit, items.length);
          return textResult(JSON.stringify({
            items: items.slice(start, end),
            next_page: end < items.length ? page + 1 : null
          }));
        }
      }),
      defineTool({
        name: "search_plot_design",
        label: "搜索剧情设计",
        description:
          "搜索全书故事线及非伏笔剧情结构，返回可交给 read_plot_design 的业务目标和少量上下文。",
        parameters: strictObject({
          query: Type.String({ minLength: 1, maxLength: 256 }),
          kind: Type.Optional(plotItemKindParameter),
          page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const query = params.query.normalize("NFC").toLocaleLowerCase();
          const candidates: Array<{
            target: Record<string, unknown>;
            searchable: string;
          }> = [];
          if (!params.kind || params.kind === "book_line") {
            const bookLine = await readWholeWorldbuildingDocument(
              index.bookLine,
              index.revision,
              projectRevision,
              signal
            );
            candidates.push({
              target: { kind: "book_line", title: "全书故事线" },
              searchable: bookLine.content
            });
          }
          for (const [kind, collection] of Object.entries(plotCollections(index)) as Array<[
            Exclude<PlotItemKind, "book_line">,
            Array<{ id: string }>
          ]>) {
            if (params.kind && params.kind !== kind) continue;
            for (const item of collection) {
              const business = toPlotBusinessItem(
                kind,
                item as unknown as Record<string, unknown>
              );
              candidates.push({
                target: {
                  kind,
                  ...(kind === "volume" ? { volume_id: item.id } : {}),
                  ...(kind === "arc" ? { arc_id: item.id } : {}),
                  ...(kind === "story_plot" ? { story_plot_id: item.id } : {}),
                  ...(kind === "chapter" ? { chapter_card_id: item.id } : {}),
                  ...(kind === "event" ? { event_id: item.id } : {}),
                  ...(kind === "connection" ? { connection_id: item.id } : {}),
                  ...(kind === "placement" ? { placement_id: item.id } : {}),
                  ...(business.title ? { title: business.title } : {})
                },
                searchable: JSON.stringify(business)
              });
            }
          }
          if (!params.kind || params.kind === "story_plot") {
            for (const [id, entry] of storyPlotOverlay) {
              if (!entry.pendingCreation) continue;
              if (index.plot.storyPlots.some((storyPlot) => storyPlot.id === id)) {
                continue;
              }
              candidates.push({
                target: {
                  kind: "story_plot",
                  story_plot_id: id,
                  arc_id: entry.arcId,
                  title: entry.title
                },
                searchable: JSON.stringify({
                  kind: "story_plot",
                  story_plot_id: id,
                  arc_id: entry.arcId,
                  title: entry.title,
                  order: entry.order
                })
              });
            }
          }
          if (!params.kind || params.kind === "chapter") {
            for (const [id, entry] of chapterCardOverlay) {
              if (!entry.pendingCreation) continue;
              if (index.plot.chapterCards.some((chapter) => chapter.id === id)) {
                continue;
              }
              candidates.push({
                target: {
                  kind: "chapter",
                  chapter_card_id: id,
                  volume_id: entry.volumeId,
                  title: entry.title
                },
                searchable: [
                  JSON.stringify({
                    kind: "chapter",
                    chapter_card_id: id,
                    volume_id: entry.volumeId,
                    primary_arc_id: entry.primaryArcId,
                    title: entry.title,
                    narrative_order: entry.narrativeOrder
                  }),
                  entry.content
                ].join("\n")
              });
            }
          }
          const hits = candidates.flatMap((candidate) => {
            const normalized = candidate.searchable.normalize("NFC").toLocaleLowerCase();
            const offset = normalized.indexOf(query);
            if (offset < 0) return [];
            const start = Math.max(0, offset - 120);
            const end = Math.min(candidate.searchable.length, offset + params.query.length + 200);
            return [{ ...candidate.target, snippet: candidate.searchable.slice(start, end) }];
          });
          const page = params.page ?? 1;
          const limit = params.limit ?? 20;
          const start = (page - 1) * limit;
          const end = Math.min(start + limit, hits.length);
          return textResult(JSON.stringify({
            hits: hits.slice(start, end),
            next_page: end < hits.length ? page + 1 : null
          }));
        }
      }),
      defineTool({
        name: "read_plot_design",
        label: "读取剧情设计",
        description:
          "按业务目标读取全书故事线或一个非伏笔剧情条目。mode=preview 只返回摘录；mode=full 会建立本轮 write_plot_design / edit_plot_design 所需的完整读取凭据。",
        parameters: strictObject({
          target: LONG_PLOT_ITEM_TARGET_PARAMETER,
          mode: Type.Optional(worldbuildingReadModeParameter)
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const mode = params.mode ?? "full";
          let serialized: string;
          let key: string;
          let display: string | undefined;
          if (params.target.kind === "book_line") {
            const result = await readWholeWorldbuildingDocument(
              index.bookLine,
              index.revision,
              projectRevision,
              signal
            );
            serialized = result.content;
            key = plotItemKey("book_line");
          } else if (params.target.kind === "story_plot") {
            const targetId = plotBusinessId(params.target);
            const overlayEntry = storyPlotOverlay.get(targetId);
            let meta: Record<string, unknown>;
            if (overlayEntry) {
              meta = {
                kind: "story_plot",
                story_plot_id: targetId,
                arc_id: overlayEntry.arcId,
                title: overlayEntry.title,
                order: overlayEntry.order
              };
              serialized = overlayEntry.content;
            } else {
              const item = resolvePlotItem(index, "story_plot", targetId);
              const result = await readWholeWorldbuildingDocument(
                item.file as LongWorkspaceFileReference,
                index.revision,
                projectRevision,
                signal
              );
              meta = toPlotBusinessItem("story_plot", item);
              serialized = result.content;
            }
            key = plotItemKey("story_plot", targetId);
            display = [
              JSON.stringify(meta, null, 2),
              "",
              "正文：",
              serialized || "（内容为空）"
            ].join("\n");
          } else if (params.target.kind === "chapter") {
            const targetId = plotBusinessId(params.target);
            const overlayEntry = chapterCardOverlay.get(targetId);
            let meta: Record<string, unknown>;
            if (overlayEntry) {
              meta = {
                kind: "chapter",
                chapter_card_id: targetId,
                volume_id: overlayEntry.volumeId,
                primary_arc_id: overlayEntry.primaryArcId,
                title: overlayEntry.title,
                narrative_order: overlayEntry.narrativeOrder
              };
              serialized = overlayEntry.content;
            } else {
              const item = resolvePlotItem(index, "chapter", targetId);
              const fileEntry = index.chapters.find(
                (entry) => entry.chapterCardId === targetId
              );
              if (!fileEntry) {
                throw new Error(`Chapter ${targetId} is missing its file index.`);
              }
              const result = await readWholeWorldbuildingDocument(
                fileEntry.card,
                index.revision,
                projectRevision,
                signal
              );
              meta = toPlotBusinessItem("chapter", item);
              serialized = result.content;
            }
            key = plotItemKey("chapter", targetId);
            display = [
              JSON.stringify(meta, null, 2),
              "",
              "正文：",
              serialized || "（内容为空）"
            ].join("\n");
          } else {
            const targetId = plotBusinessId(params.target);
            const item = resolvePlotItem(index, params.target.kind, targetId);
            serialized = JSON.stringify(
              toPlotBusinessItem(params.target.kind, item),
              null,
              2
            );
            key = plotItemKey(params.target.kind, targetId);
          }
          if (mode === "full") {
            fullyReadPlotItems.set(key, {
              serialized,
              workspaceRevision: index.revision,
              projectRevision
            });
          }
          const previewLength = 320;
          const visibleSource = display ?? serialized;
          const visible =
            mode === "preview" && visibleSource.length > previewLength * 2
              ? `${visibleSource.slice(0, previewLength)}\n\n……（中间省略 ${visibleSource.length - previewLength * 2} 个字符）……\n\n${visibleSource.slice(-previewLength)}`
              : visibleSource;
          return textResult(
            [
              mode === "preview" ? "预览（不建立整体覆盖凭据）：" : "完整内容：",
              "",
              visible || "（内容为空）"
            ].join("\n")
          );
        }
      })
    );
  }

  if (
    isPlotDesignAgent &&
    capabilities.has("mutate_structure") &&
    writableRoots.has("plot_design")
  ) {
    const plotProposal = (
      batch: LongWorkspaceOperationBatch,
      projectRevision: number,
      summary: string,
      message = "已形成剧情设计变更提案，等待客户端审阅与冲突检查。",
      plain = false
    ) =>
      textResult(plain ? message : longProposalResultSummary(input, message), {
        kind: "long-mutation-proposal",
        bookId: workspace.bookId,
        agentId: profile.id,
        batch,
        baseProjectRevision: projectRevision,
        summary
      });

    const plotUpdateOperation = (
      item: Exclude<Static<typeof LONG_PLOT_WRITE_PARAMETERS>["item"], { kind: "book_line" } | { kind: "story_plot" }> |
        Exclude<Static<typeof LONG_PLOT_EDIT_PARAMETERS>["item"], { kind: "book_line" } | { kind: "story_plot" }>,
      patch: Record<string, unknown>
    ): LongWorkspaceOperation => {
      const id = plotBusinessId(item);
      if (item.kind === "volume") {
        return { type: "volume.update", id, patch } as LongWorkspaceOperation;
      }
      if (item.kind === "arc") {
        return { type: "arc.update", id, patch } as LongWorkspaceOperation;
      }
      if (item.kind === "chapter") {
        return { type: "chapter.update", id, patch } as LongWorkspaceOperation;
      }
      if (item.kind === "event") {
        return { type: "event.update", id, patch } as LongWorkspaceOperation;
      }
      if (item.kind === "connection") {
        return { type: "connection.update", id, patch } as LongWorkspaceOperation;
      }
      return { type: "placement.update", id, patch } as LongWorkspaceOperation;
    };

    tools.push(
      defineTool({
        name: "create_plot_design",
        label: "创建剧情设计",
        description:
          "一次创建一个非伏笔剧情条目并返回稳定业务 ID（叙事落点可用 placements 一次批量创建多个，只形成一张审批卡）。创建只建立结构条目（故事情节与章卡同时建立空正文文件），不在创建时初始化内容；故事情节必须通过 arc_id 挂载到既有剧情点，章卡必须通过 volume_id 与 primary_arc_id 绑定既有分卷与主剧情点；两者创建后可立即读取，正文使用 write_plot_design 或 edit_plot_design 写入。伏笔线和伏笔触点继续使用现有结构提案工具。",
        parameters: LONG_PLOT_CREATE_PARAMETERS,
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const item = params.item;
          // loadIndex 在同一轮内复用缓存快照，本轮已创建但尚未落盘的故事情节只存在于
          // storyPlotOverlay；构建创建操作时必须一并计入，否则同一剧情点下的
          // order 会被重复分配，落盘校验将因 order 不连续而失败。章卡同理。
          const pendingStoryPlots = [...storyPlotOverlay.entries()]
            .filter(
              ([id, entry]) =>
                entry.pendingCreation &&
                !index.plot.storyPlots.some((storyPlot) => storyPlot.id === id)
            )
            .map(([id, entry]) => ({
              id,
              arcId: entry.arcId,
              title: entry.title,
              order: entry.order,
              file: entry.file
            }));
          const pendingChapterCards = [...chapterCardOverlay.entries()]
            .filter(
              ([id, entry]) =>
                entry.pendingCreation &&
                !index.plot.chapterCards.some((chapter) => chapter.id === id)
            )
            .map(([id, entry]) => ({
              id,
              volumeId: entry.volumeId,
              primaryArcId: entry.primaryArcId,
              title: entry.title,
              narrativeOrder: entry.narrativeOrder
            }));
          const buildIndex =
            pendingStoryPlots.length > 0 || pendingChapterCards.length > 0
              ? {
                  ...index,
                  plot: {
                    ...index.plot,
                    storyPlots: [
                      ...index.plot.storyPlots,
                      ...pendingStoryPlots
                    ],
                    chapterCards: [
                      ...index.plot.chapterCards,
                      ...pendingChapterCards
                    ]
                  }
                }
              : index;
          const rawOperations = (
            item.kind === "placements"
              ? item.items.map((placement) => ({
                  type: "placement.create" as const,
                  eventId: placement.event_id,
                  chapterCardId: placement.chapter_card_id,
                  mode: placement.mode,
                  disclosure: placement.disclosure,
                  writingPrompt: placement.writing_prompt
                }))
              : [
                  item.kind === "volume"
                    ? { type: "volume.create" as const, title: item.title, summary: item.summary }
                    : item.kind === "arc"
                      ? { type: "arc.create" as const, volumeId: item.volume_id, title: item.title, summary: item.summary, outline: item.outline }
                      : item.kind === "story_plot"
                        ? { type: "storyPlot.create" as const, arcId: item.arc_id, title: item.title }
                        : item.kind === "chapter"
                        ? {
                            type: "chapter.create" as const,
                            volumeId: item.volume_id,
                            primaryArcId: item.primary_arc_id,
                            title: item.title
                          }
                        : item.kind === "event"
                          ? {
                              type: "event.create" as const,
                              title: item.title,
                              summary: item.summary,
                              timeMode: item.time_mode,
                              timeLabel: item.time_label,
                              timeValue: item.time_value,
                              location: item.location,
                              arcIds: item.arc_ids,
                              characterIds: item.character_ids
                            }
                          : item.kind === "connection"
                            ? {
                                type: "connection.create" as const,
                                sourceEventId: item.source_event_id,
                                targetEventId: item.target_event_id,
                                connectionType: item.connection_type,
                                note: item.note
                              }
                            : {
                                type: "placement.create" as const,
                                eventId: item.event_id,
                                chapterCardId: item.chapter_card_id,
                                mode: item.mode,
                                disclosure: item.disclosure,
                                writingPrompt: item.writing_prompt
                              }
                ]
          ) as LongMutationToolOperation[];
          const built = buildRuntimeOperations({
            rawOperations,
            index: buildIndex,
            timestamp: new Date().toISOString(),
            idSeed: `${workspace.bookId}:${input.runId}:${toolCallId}`
          });
          const timestamp = new Date().toISOString();
          const created = built.operations[0];
          const createdId =
            created && "volume" in created
              ? created.volume.id
              : created && "arc" in created
                ? created.arc.id
                : created && "storyPlot" in created
                  ? created.storyPlot.id
                  : created && "chapterCard" in created
                    ? created.chapterCard.id
                    : created && "event" in created
                      ? created.event.id
                      : created && "connection" in created
                        ? created.connection.id
                        : created && "placement" in created
                          ? created.placement.id
                          : "";
          const summary = params.summary?.trim() ||
            (item.kind === "placements"
              ? `批量创建 ${item.items.length} 个叙事落点`
              : `创建${item.kind}“${"title" in item ? item.title : createdId}”`);
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: built.operations,
            documentWrites: []
          });
          if (
            item.kind === "story_plot" &&
            created &&
            created.type === "storyPlot.create"
          ) {
            storyPlotOverlay.set(createdId, {
              arcId: created.storyPlot.arcId,
              title: created.storyPlot.title,
              order: created.storyPlot.order,
              file: created.storyPlot.file,
              content: "",
              pendingCreation: true
            });
            fullyReadPlotItems.set(plotItemKey("story_plot", createdId), {
              serialized: "",
              workspaceRevision: index.revision,
              projectRevision
            });
          }
          if (
            item.kind === "chapter" &&
            created &&
            created.type === "chapter.create"
          ) {
            chapterCardOverlay.set(createdId, {
              volumeId: created.chapterCard.volumeId,
              primaryArcId: created.chapterCard.primaryArcId,
              title: created.chapterCard.title,
              narrativeOrder: created.chapterCard.narrativeOrder,
              file: created.files.card,
              content: "",
              pendingCreation: true
            });
            fullyReadPlotItems.set(plotItemKey("chapter", createdId), {
              serialized: "",
              workspaceRevision: index.revision,
              projectRevision
            });
          }
          const createdIdLabel =
            item.kind === "volume"
              ? "volume_id"
              : item.kind === "arc"
                ? "arc_id"
                : item.kind === "story_plot"
                  ? "story_plot_id"
                  : item.kind === "chapter"
                  ? "chapter_card_id"
                  : item.kind === "event"
                    ? "event_id"
                    : item.kind === "connection"
                      ? "connection_id"
                      : "placement_id";
          if (item.kind === "placements") {
            const placementIds = built.operations.map((operation) =>
              operation.type === "placement.create" ? operation.placement.id : ""
            );
            return textResult(
              `${longProposalResultSummary(input, `已形成一个叙事落点批量创建提案（${placementIds.length} 个落点），等待客户端审阅与冲突检查。`)}\nplacements → ${placementIds.join(", ")}`,
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
          return textResult(
            item.kind === "story_plot"
              ? `已创建故事情节“${item.title}”，story_plot_id=${createdId}。可直接使用 write_plot_design 一次性写入其正文，无需再次读取。`
              : item.kind === "chapter"
                ? `已创建章卡“${item.title}”，chapter_card_id=${createdId}。可直接使用 write_plot_design 一次性写入其正文，无需再次读取。`
              : `${longProposalResultSummary(input, "已形成一个剧情设计条目创建提案，等待客户端审阅与冲突检查。")}\n${item.kind} → ${createdIdLabel}=${createdId}`,
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
        name: "write_plot_design",
        label: "写入剧情设计",
        description:
          "完整覆盖全书故事线、一个既有非伏笔剧情条目的内容字段，或故事情节/章卡的整篇正文。既有目标必须先用 read_plot_design mode=full 完整读取，并明确 allow_overwrite_existing=true；本轮刚创建的空白故事情节或章卡可直接一次性写入，无需再次读取或确认覆盖。局部修改应使用 edit_plot_design。故事情节与章卡正文一次性整篇写入，不要分段多次写入。",
        parameters: LONG_PLOT_WRITE_PARAMETERS,
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const item = params.item;
          const itemId = item.kind === "book_line" ? undefined : plotBusinessId(item);
          const key = plotItemKey(item.kind, itemId);
          const evidence = fullyReadPlotItems.get(key);
          const pendingEmptyTextItem =
            item.kind === "story_plot"
              ? (() => {
                  const entry = storyPlotOverlay.get(itemId!);
                  return entry?.pendingCreation === true && entry.content === "";
                })()
              : item.kind === "chapter"
                ? (() => {
                    const entry = chapterCardOverlay.get(itemId!);
                    return entry?.pendingCreation === true && entry.content === "";
                  })()
                : false;
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision
          ) {
            return textResult("未写入：请先调用 read_plot_design（mode=full）完整读取目标内容。");
          }
          if (!pendingEmptyTextItem && params.allow_overwrite_existing !== true) {
            return textResult("未写入：完整覆盖需明确设置 allow_overwrite_existing=true；局部修改请使用 edit_plot_design。");
          }
          const timestamp = new Date().toISOString();
          const summary = params.summary?.trim() || `完整写入剧情设计 ${key}`;
          if (item.kind === "book_line") {
            const live = await readWholeWorldbuildingDocument(
              index.bookLine,
              index.revision,
              projectRevision,
              signal
            );
            if (live.content !== evidence.serialized) {
              throw new Error("Book line changed after it was read.");
            }
            const nextRevision = nextContentRevision(live.file.revision, item.text);
            const batch = LongWorkspaceOperationBatchSchema.parse({
              baseRevision: index.revision,
              updatedAt: timestamp,
              operations: [],
              documentWrites: [{
                proposalId: `proposal_${stableHash(`${workspace.bookId}:${input.runId}:${toolCallId}`).slice(0, 24)}`,
                fileId: live.file.id,
                content: item.text,
                mode: "replace",
                expectedRevision: live.file.revision,
                nextRevision,
                updatedAt: timestamp,
                reason: summary
              }]
            });
            fullyReadPlotItems.set(key, { serialized: item.text, workspaceRevision: index.revision, projectRevision });
            return plotProposal(batch, projectRevision, summary);
          }
          if (item.kind === "story_plot") {
            const overlayEntry = storyPlotOverlay.get(itemId!);
            let meta: { arcId: string; title: string; order: number };
            let liveFile: LongWorkspaceFileReference;
            let liveContent: string;
            if (overlayEntry) {
              meta = {
                arcId: overlayEntry.arcId,
                title: overlayEntry.title,
                order: overlayEntry.order
              };
              liveFile = overlayEntry.file;
              liveContent = overlayEntry.content;
            } else {
              const storyPlot = resolvePlotItem(index, "story_plot", itemId!);
              const result = await readWholeWorldbuildingDocument(
                storyPlot.file as LongWorkspaceFileReference,
                index.revision,
                projectRevision,
                signal
              );
              meta = {
                arcId: storyPlot.arcId as string,
                title: storyPlot.title as string,
                order: storyPlot.order as number
              };
              liveFile = result.file;
              liveContent = result.content;
            }
            if (liveContent !== evidence.serialized) {
              throw new Error("Story plot changed after it was read.");
            }
            const nextRevision = nextContentRevision(liveFile.revision, item.text);
            const batch = LongWorkspaceOperationBatchSchema.parse({
              baseRevision: index.revision,
              updatedAt: timestamp,
              operations: [],
              documentWrites: [{
                proposalId: `proposal_${stableHash(`${workspace.bookId}:${input.runId}:${toolCallId}`).slice(0, 24)}`,
                fileId: liveFile.id,
                content: item.text,
                mode: "replace",
                expectedRevision: liveFile.revision,
                nextRevision,
                updatedAt: timestamp,
                reason: summary
              }]
            });
            storyPlotOverlay.set(itemId!, {
              ...meta,
              file: { ...liveFile, revision: nextRevision, updatedAt: timestamp },
              content: item.text,
              pendingCreation: overlayEntry?.pendingCreation ?? false
            });
            fullyReadPlotItems.set(key, { serialized: item.text, workspaceRevision: index.revision, projectRevision });
            return plotProposal(batch, projectRevision, summary, `已写入故事情节“${meta.title}”正文。`, true);
          }
          if (item.kind === "chapter") {
            const committed = new Set(
              index.ledger.commits.map((commit) => commit.chapterCardId)
            );
            if (committed.has(itemId!)) {
              return textResult("未写入：该章卡已提交连续性账本，属于不可修改的连续性事实。");
            }
            const overlayEntry = chapterCardOverlay.get(itemId!);
            let meta: { volumeId: string; primaryArcId: string; title: string; narrativeOrder: number };
            let liveFile: LongWorkspaceFileReference;
            let liveContent: string;
            if (overlayEntry) {
              meta = {
                volumeId: overlayEntry.volumeId,
                primaryArcId: overlayEntry.primaryArcId,
                title: overlayEntry.title,
                narrativeOrder: overlayEntry.narrativeOrder
              };
              liveFile = overlayEntry.file;
              liveContent = overlayEntry.content;
            } else {
              resolvePlotItem(index, "chapter", itemId!);
              const fileEntry = index.chapters.find(
                (entry) => entry.chapterCardId === itemId
              );
              if (!fileEntry) {
                throw new Error(`Chapter ${itemId} is missing its file index.`);
              }
              const result = await readWholeWorldbuildingDocument(
                fileEntry.card,
                index.revision,
                projectRevision,
                signal
              );
              const chapterItem = resolvePlotItem(index, "chapter", itemId!);
              meta = {
                volumeId: chapterItem.volumeId as string,
                primaryArcId: chapterItem.primaryArcId as string,
                title: chapterItem.title as string,
                narrativeOrder: chapterItem.narrativeOrder as number
              };
              liveFile = result.file;
              liveContent = result.content;
            }
            if (liveContent !== evidence.serialized) {
              throw new Error("Chapter card changed after it was read.");
            }
            const nextRevision = nextContentRevision(liveFile.revision, item.text);
            const batch = LongWorkspaceOperationBatchSchema.parse({
              baseRevision: index.revision,
              updatedAt: timestamp,
              operations: [],
              documentWrites: [{
                proposalId: `proposal_${stableHash(`${workspace.bookId}:${input.runId}:${toolCallId}`).slice(0, 24)}`,
                fileId: liveFile.id,
                content: item.text,
                mode: "replace",
                expectedRevision: liveFile.revision,
                nextRevision,
                updatedAt: timestamp,
                reason: summary
              }]
            });
            chapterCardOverlay.set(itemId!, {
              ...meta,
              file: { ...liveFile, revision: nextRevision, updatedAt: timestamp },
              content: item.text,
              pendingCreation: overlayEntry?.pendingCreation ?? false
            });
            fullyReadPlotItems.set(key, { serialized: item.text, workspaceRevision: index.revision, projectRevision });
            return plotProposal(batch, projectRevision, summary, `已写入章卡“${meta.title}”正文。`, true);
          }
          const current = JSON.stringify(
            toPlotBusinessItem(item.kind, resolvePlotItem(index, item.kind, itemId!)),
            null,
            2
          );
          if (current !== evidence.serialized) {
            throw new Error("Plot item changed after it was read.");
          }
          const patch =
            item.kind === "volume"
              ? { summary: item.summary }
              : item.kind === "arc"
                ? { summary: item.summary, outline: item.outline }
                : item.kind === "event"
                  ? {
                      summary: item.summary,
                      timeMode: item.time_mode,
                      timeLabel: item.time_label,
                      ...(item.time_value === undefined ? {} : { timeValue: item.time_value }),
                      location: item.location,
                      arcIds: item.arc_ids,
                      characterIds: item.character_ids
                    }
                  : item.kind === "connection"
                    ? { note: item.note }
                    : { writingPrompt: item.writing_prompt };
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [plotUpdateOperation(item, patch)],
            documentWrites: []
          });
          return plotProposal(batch, projectRevision, summary);
        }
      }),
      defineTool({
        name: "edit_plot_design",
        label: "编辑剧情设计",
        description:
          "在已用 read_plot_design mode=full 完整读取的目标上做局部修改。全书故事线、故事情节与章卡正文按唯一原文片段替换；其余结构化剧情条目只更新明确给出的内容字段。",
        parameters: LONG_PLOT_EDIT_PARAMETERS,
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const item = params.item;
          const itemId = item.kind === "book_line" ? undefined : plotBusinessId(item);
          const key = plotItemKey(item.kind, itemId);
          const evidence = fullyReadPlotItems.get(key);
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision
          ) {
            return textResult("未编辑：请先调用 read_plot_design（mode=full）完整读取目标内容。");
          }
          const timestamp = new Date().toISOString();
          const summary = params.summary?.trim() || `局部修改剧情设计 ${key}`;
          if (item.kind === "book_line") {
            const live = await readWholeWorldbuildingDocument(
              index.bookLine,
              index.revision,
              projectRevision,
              signal
            );
            if (live.content !== evidence.serialized) {
              throw new Error("Book line changed after it was read.");
            }
            let content = live.content;
            for (const replacement of item.replacements) {
              const first = content.indexOf(replacement.original_text);
              const second = first < 0 ? -1 : content.indexOf(replacement.original_text, first + replacement.original_text.length);
              if (first < 0 || second >= 0) {
                return textResult(`未替换：原文片段必须唯一存在：${replacement.original_text.slice(0, 80)}`);
              }
              content = content.slice(0, first) + replacement.new_text + content.slice(first + replacement.original_text.length);
            }
            const nextRevision = nextContentRevision(live.file.revision, content);
            const batch = LongWorkspaceOperationBatchSchema.parse({
              baseRevision: index.revision,
              updatedAt: timestamp,
              operations: [],
              documentWrites: [{
                proposalId: `proposal_${stableHash(`${workspace.bookId}:${input.runId}:${toolCallId}`).slice(0, 24)}`,
                fileId: live.file.id,
                content,
                mode: "replace",
                expectedRevision: live.file.revision,
                nextRevision,
                updatedAt: timestamp,
                reason: summary
              }]
            });
            fullyReadPlotItems.set(key, { serialized: content, workspaceRevision: index.revision, projectRevision });
            return plotProposal(batch, projectRevision, summary);
          }
          if (item.kind === "story_plot") {
            const overlayEntry = storyPlotOverlay.get(itemId!);
            let meta: { arcId: string; title: string; order: number };
            let liveFile: LongWorkspaceFileReference;
            let liveContent: string;
            if (overlayEntry) {
              meta = {
                arcId: overlayEntry.arcId,
                title: overlayEntry.title,
                order: overlayEntry.order
              };
              liveFile = overlayEntry.file;
              liveContent = overlayEntry.content;
            } else {
              const storyPlot = resolvePlotItem(index, "story_plot", itemId!);
              const result = await readWholeWorldbuildingDocument(
                storyPlot.file as LongWorkspaceFileReference,
                index.revision,
                projectRevision,
                signal
              );
              meta = {
                arcId: storyPlot.arcId as string,
                title: storyPlot.title as string,
                order: storyPlot.order as number
              };
              liveFile = result.file;
              liveContent = result.content;
            }
            if (liveContent !== evidence.serialized) {
              throw new Error("Story plot changed after it was read.");
            }
            let content = liveContent;
            for (const replacement of item.replacements) {
              const first = content.indexOf(replacement.original_text);
              const second = first < 0 ? -1 : content.indexOf(replacement.original_text, first + replacement.original_text.length);
              if (first < 0 || second >= 0) {
                return textResult(`未替换：原文片段必须唯一存在：${replacement.original_text.slice(0, 80)}`);
              }
              content = content.slice(0, first) + replacement.new_text + content.slice(first + replacement.original_text.length);
            }
            const nextRevision = nextContentRevision(liveFile.revision, content);
            const batch = LongWorkspaceOperationBatchSchema.parse({
              baseRevision: index.revision,
              updatedAt: timestamp,
              operations: [],
              documentWrites: [{
                proposalId: `proposal_${stableHash(`${workspace.bookId}:${input.runId}:${toolCallId}`).slice(0, 24)}`,
                fileId: liveFile.id,
                content,
                mode: "replace",
                expectedRevision: liveFile.revision,
                nextRevision,
                updatedAt: timestamp,
                reason: summary
              }]
            });
            storyPlotOverlay.set(itemId!, {
              ...meta,
              file: { ...liveFile, revision: nextRevision, updatedAt: timestamp },
              content,
              pendingCreation: overlayEntry?.pendingCreation ?? false
            });
            fullyReadPlotItems.set(key, { serialized: content, workspaceRevision: index.revision, projectRevision });
            return plotProposal(batch, projectRevision, summary, `已局部修改故事情节“${meta.title}”正文。`, true);
          }
          if (item.kind === "chapter") {
            const committed = new Set(
              index.ledger.commits.map((commit) => commit.chapterCardId)
            );
            if (committed.has(itemId!)) {
              return textResult("未编辑：该章卡已提交连续性账本，属于不可修改的连续性事实。");
            }
            const overlayEntry = chapterCardOverlay.get(itemId!);
            let meta: { volumeId: string; primaryArcId: string; title: string; narrativeOrder: number };
            let liveFile: LongWorkspaceFileReference;
            let liveContent: string;
            if (overlayEntry) {
              meta = {
                volumeId: overlayEntry.volumeId,
                primaryArcId: overlayEntry.primaryArcId,
                title: overlayEntry.title,
                narrativeOrder: overlayEntry.narrativeOrder
              };
              liveFile = overlayEntry.file;
              liveContent = overlayEntry.content;
            } else {
              const chapterItem = resolvePlotItem(index, "chapter", itemId!);
              const fileEntry = index.chapters.find(
                (entry) => entry.chapterCardId === itemId
              );
              if (!fileEntry) {
                throw new Error(`Chapter ${itemId} is missing its file index.`);
              }
              const result = await readWholeWorldbuildingDocument(
                fileEntry.card,
                index.revision,
                projectRevision,
                signal
              );
              meta = {
                volumeId: chapterItem.volumeId as string,
                primaryArcId: chapterItem.primaryArcId as string,
                title: chapterItem.title as string,
                narrativeOrder: chapterItem.narrativeOrder as number
              };
              liveFile = result.file;
              liveContent = result.content;
            }
            if (liveContent !== evidence.serialized) {
              throw new Error("Chapter card changed after it was read.");
            }
            let content = liveContent;
            for (const replacement of item.replacements) {
              const first = content.indexOf(replacement.original_text);
              const second = first < 0 ? -1 : content.indexOf(replacement.original_text, first + replacement.original_text.length);
              if (first < 0 || second >= 0) {
                return textResult(`未替换：原文片段必须唯一存在：${replacement.original_text.slice(0, 80)}`);
              }
              content = content.slice(0, first) + replacement.new_text + content.slice(first + replacement.original_text.length);
            }
            const nextRevision = nextContentRevision(liveFile.revision, content);
            const batch = LongWorkspaceOperationBatchSchema.parse({
              baseRevision: index.revision,
              updatedAt: timestamp,
              operations: [],
              documentWrites: [{
                proposalId: `proposal_${stableHash(`${workspace.bookId}:${input.runId}:${toolCallId}`).slice(0, 24)}`,
                fileId: liveFile.id,
                content,
                mode: "replace",
                expectedRevision: liveFile.revision,
                nextRevision,
                updatedAt: timestamp,
                reason: summary
              }]
            });
            chapterCardOverlay.set(itemId!, {
              ...meta,
              file: { ...liveFile, revision: nextRevision, updatedAt: timestamp },
              content,
              pendingCreation: overlayEntry?.pendingCreation ?? false
            });
            fullyReadPlotItems.set(key, { serialized: content, workspaceRevision: index.revision, projectRevision });
            return plotProposal(batch, projectRevision, summary, `已局部修改章卡“${meta.title}”正文。`, true);
          }
          const current = JSON.stringify(
            toPlotBusinessItem(item.kind, resolvePlotItem(index, item.kind, itemId!)),
            null,
            2
          );
          if (current !== evidence.serialized) {
            throw new Error("Plot item changed after it was read.");
          }
          const raw = item.patch as Record<string, unknown>;
          const patch =
            item.kind === "event"
              ? {
                  ...(raw.summary === undefined ? {} : { summary: raw.summary }),
                  ...(raw.time_mode === undefined ? {} : { timeMode: raw.time_mode }),
                  ...(raw.time_label === undefined ? {} : { timeLabel: raw.time_label }),
                  ...(raw.time_value === undefined ? {} : { timeValue: raw.time_value }),
                  ...(raw.location === undefined ? {} : { location: raw.location }),
                  ...(raw.arc_ids === undefined ? {} : { arcIds: raw.arc_ids }),
                  ...(raw.character_ids === undefined ? {} : { characterIds: raw.character_ids })
                }
              : item.kind === "placement"
                ? { writingPrompt: raw.writing_prompt }
                : raw;
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [plotUpdateOperation(item, patch)],
            documentWrites: []
          });
          return plotProposal(batch, projectRevision, summary);
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
            : profile.id === "character_design"
              ? "提交人物重命名、别名、分组、删除和排序等结构变更。此工具不能创建人物，也不能写入人物正文；创建人物必须使用 create_character，正文必须使用 write_character_file 或 edit_character_file。提案只进入审阅队列，不直接写磁盘。"
            : profile.id === "plot_design"
              ? "提交既有分卷、剧情点、故事情节、章卡、故事事件、事件连接和叙事落点的重命名、关联、移动、删除、排序，以及全部伏笔线/伏笔触点变更。非伏笔条目创建必须使用 create_plot_design，内容写入必须使用 write_plot_design 或 edit_plot_design。提案只进入审阅队列，不直接写磁盘。"
            : "按显式领域操作提交当前长篇的结构变更提案。伏笔线可分别填写 hiddenTruth 与 plannedSpan，伏笔触点可用 volumeId 或 arcId 设置卷级/剧情点计划锚点。运行时锁定项目版本、生成新实体与文件信息并计算文档内容修订；只能更新逻辑文档目标，不能传路径或文件修订。提案只进入审阅队列，不直接写磁盘。",
        parameters:
          profile.id === "worldbuilding"
            ? LONG_WORLDBUILDING_MUTATION_PARAMETERS
            : profile.id === "character_design"
              ? LONG_CHARACTER_MUTATION_PARAMETERS
              : profile.id === "plot_design"
                ? LONG_PLOT_MUTATION_PARAMETERS
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
              const createdRoots: LongWorkspaceRoot[] =
                operation.type === "chapter.create"
                  ? ["draft", "plot_design", "continuity_ledger"]
                  : [createdFileRootForOperation(operation)];
              if (
                !createdRoots.some((candidate) =>
                  filePathBelongsToRoot(file, candidate)
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

  const resolveChapterBodyTarget = (
    index: LongWorkspaceIndexSnapshot,
    chapterCardId: string
  ): {
    chapterTitle: string;
    file: LongWorkspaceFileReference;
    content?: string;
  } => {
    const chapterCard = index.plot.chapterCards.find(
      ({ id }) => id === chapterCardId
    );
    const chapter = index.chapters.find(
      (candidate) => candidate.chapterCardId === chapterCardId
    );
    if (!chapterCard || !chapter) {
      throw new Error("The requested chapter does not exist.");
    }
    const overlay = chapterBodyOverlay.get(chapter.body.id);
    return {
      chapterTitle: chapterCard.title,
      file: overlay?.file ?? chapter.body,
      ...(overlay ? { content: overlay.content } : {})
    };
  };

  const resolveChapterDocumentTarget = (
    index: LongWorkspaceIndexSnapshot,
    chapterCardId: string,
    document: "body" | "character_state" | "handoff"
  ): {
    chapterTitle: string;
    file: LongWorkspaceFileReference;
    content?: string;
  } => {
    if (document === "body") {
      return resolveChapterBodyTarget(index, chapterCardId);
    }
    const chapterCard = index.plot.chapterCards.find(
      ({ id }) => id === chapterCardId
    );
    const chapter = index.chapters.find(
      (candidate) => candidate.chapterCardId === chapterCardId
    );
    if (!chapterCard || !chapter) {
      throw new Error("The requested chapter does not exist.");
    }
    return {
      chapterTitle: chapterCard.title,
      file:
        document === "character_state"
          ? chapter.characterState
          : chapter.handoff
    };
  };

  const readWholeChapterBody = async (
    file: LongWorkspaceFileReference,
    expectedWorkspaceRevision: number,
    expectedProjectRevision: number,
    signal?: AbortSignal
  ): Promise<{ content: string; file: LongWorkspaceFileReference }> => {
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
            id: `long-query-${input.runId}-chapter-${++querySequence}`,
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
        throw new Error("Core returned a different chapter body.");
      }
      authoritativeFile = result.file;
      content += result.content;
      if (result.nextOffset === null) {
        return { content, file: authoritativeFile };
      }
      offset = result.nextOffset;
    }
  };

  const CONTINUITY_DOCUMENT_TITLES: Record<
    LongContinuityFileRole,
    string
  > = {
    foreshadowing_changes: "伏笔变化",
    world_reveals: "世界观揭露",
    character_current_state: "人物当前状态",
    character_history: "人物历史轨迹",
    chapter_end_state: "章末状态",
    handoff: "接续包"
  };

  const continuityOverlayKey = (
    chapterCardId: string,
    role: LongContinuityFileRole,
    characterId: string | null
  ) => `${chapterCardId}\0${role}\0${characterId ?? ""}`;

  const findContinuityOverlay = (
    chapterCardId: string,
    role: LongContinuityFileRole,
    characterId: string | null
  ) =>
    [...continuityDocumentOverlay.values()].find(
      (candidate) =>
        continuityOverlayKey(
          candidate.chapterCardId,
          candidate.role,
          candidate.characterId
        ) === continuityOverlayKey(chapterCardId, role, characterId)
    );

  const resolveContinuityFileTarget = (
    index: LongWorkspaceIndexSnapshot,
    chapterCardId: string,
    role: LongContinuityFileRole,
    characterId: string | null
  ): {
    chapterTitle: string;
    characterName: string | null;
    file: LongWorkspaceFileReference;
    overlay?: {
      content: string;
      pendingCreation: boolean;
    };
  } => {
    const chapterCard = index.plot.chapterCards.find(
      ({ id }) => id === chapterCardId
    );
    const chapter = index.chapters.find(
      (candidate) => candidate.chapterCardId === chapterCardId
    );
    if (!chapterCard || !chapter) {
      throw new Error(`Chapter ${chapterCardId} does not exist.`);
    }
    const characterRole =
      role === "character_current_state" || role === "character_history";
    if (characterRole !== (characterId !== null)) {
      throw new Error(
        "Character continuity documents require exactly one character_id."
      );
    }
    const overlay = findContinuityOverlay(
      chapterCardId,
      role,
      characterId
    );
    let file: LongWorkspaceFileReference | null = null;
    if (role === "chapter_end_state") file = chapter.characterState;
    else if (role === "handoff") file = chapter.handoff;
    else if (role === "foreshadowing_changes") {
      file = chapter.foreshadowingChanges;
    } else if (role === "world_reveals") {
      file = chapter.worldReveals;
    } else {
      const character = chapter.characterContinuity.find(
        (candidate) => candidate.characterId === characterId
      );
      file =
        role === "character_current_state"
          ? character?.currentState ?? null
          : character?.history ?? null;
    }
    file = overlay?.file ?? file;
    if (!file) {
      const label = CONTINUITY_DOCUMENT_TITLES[role];
      throw new Error(
        `${label} does not exist for this chapter. Create it before writing.`
      );
    }
    return {
      chapterTitle: chapterCard.title,
      characterName:
        characterId === null
          ? null
          : index.characters.find(({ id }) => id === characterId)?.name ??
            characterId,
      file,
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

  const continuityTargetFromParameter = (
    target: Static<typeof continuityFileTargetParameter>
  ): { role: LongContinuityFileRole; characterId: string | null } => ({
    role: target.document,
    characterId:
      "character_id" in target ? target.character_id : null
  });

  const continuityDocumentTitle = (
    chapterTitle: string,
    role: LongContinuityFileRole,
    characterName: string | null
  ) =>
    `${chapterTitle} / ${
      characterName ? `${characterName} / ` : ""
    }${CONTINUITY_DOCUMENT_TITLES[role]}`;

  if (
    (isDraftWritingAgent || isContinuityLedgerAgent) &&
    capabilities.has("query_structure") &&
    readableRoots.has("draft")
  ) {
    tools.push(
      defineTool({
        name: "list_chapters",
        label: "列出正文章节",
        description:
          "按叙事顺序列出正文阶段概览，返回 chapter_card_id、标题、正文状态与提交状态；连续性账本可据此读取正文、章末人物状态和接续包，不暴露文件和版本信息。",
        parameters: strictObject({
          page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
          const page = params.page ?? 1;
          const limit = params.limit ?? 50;
          const start = (page - 1) * limit;
          const ordered = orderedLongChapterCards(index);
          const items = ordered.slice(start, start + limit).map((card) => {
            const chapter = index.chapters.find(
              ({ chapterCardId }) => chapterCardId === card.id
            );
            if (!chapter) {
              throw new Error(`Chapter files are missing for ${card.id}.`);
            }
            const overlay = chapterBodyOverlay.get(chapter.body.id);
            return {
              chapter_card_id: card.id,
              title: card.title,
              narrative_order: card.narrativeOrder,
              body_status:
                overlay?.content.trim() || chapter.body.revision !== EMPTY_LONG_MARKDOWN_REVISION
                  ? "written"
                  : "empty",
              commit_status: chapter.commitId ? "committed" : "uncommitted",
              active: workspace.activeChapterCardId === card.id
            };
          });
          return textResult(
            JSON.stringify(
              {
                page,
                limit,
                total: ordered.length,
                items
              },
              null,
              2
            )
          );
        }
      }),
      defineTool({
        name: "search_chapters",
        label: "搜索正文章节",
        description:
          "搜索正文阶段内容；连续性账本会同时获得正文、章末人物状态和接续包命中，返回可交给 read_chapter 的 chapter_card_id、document 和少量上下文。",
        parameters: strictObject({
          query: Type.String({ minLength: 1, maxLength: 256 }),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          max_snippet_characters: Type.Optional(
            Type.Integer({ minimum: 40, maximum: 2_000 })
          )
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
          const command = LongSearchCommandEnvelopeSchema.parse(
            createEnvelope(
              "long.search",
              {
                bookId: workspace.bookId,
                query: params.query,
                scope: "draft",
                ...(params.cursor ? { cursor: params.cursor } : {}),
                limit: params.limit ?? 20,
                maxSnippetCharacters: params.max_snippet_characters ?? 320
              },
              {
                id: `long-query-${input.runId}-chapter-search-${++querySequence}`,
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
          const chapterTargetByFileId = new Map<
            string,
            {
              chapterCardId: string;
              document: "body" | "character_state" | "handoff";
            }
          >(
            index.chapters.flatMap((chapter) => [
              [chapter.body.id, { chapterCardId: chapter.chapterCardId, document: "body" as const }],
              [chapter.characterState.id, { chapterCardId: chapter.chapterCardId, document: "character_state" as const }],
              [chapter.handoff.id, { chapterCardId: chapter.chapterCardId, document: "handoff" as const }]
            ] as const)
          );
          return textResult(
            JSON.stringify(
              {
                query: result.query,
                hits: result.hits
                  .flatMap((hit) => {
                    const target = chapterTargetByFileId.get(hit.fileId);
                    if (!target) return [];
                    if (!isContinuityLedgerAgent && target.document !== "body") {
                      return [];
                    }
                    return [{
                      chapter_card_id: target.chapterCardId,
                      document: target.document,
                      title: hit.title,
                      snippet: hit.snippet
                    }];
                  }),
                next_cursor: result.nextCursor
              },
              null,
              2
            )
          );
        }
      }),
      defineTool({
        name: "read_chapter",
        label: "读取正文阶段内容",
        description:
          "按 chapter_card_id 读取正文阶段的具体内容。单章写手只可读取正文；连续性账本可用 document 读取正文、章末人物状态或接续包。",
        parameters: strictObject({
          chapter_card_id: Type.Optional(stableIdParameter("chapter")),
          document: Type.Optional(
            isContinuityLedgerAgent
              ? literalUnion(["body", "character_state", "handoff"])
              : Type.Literal("body")
          ),
          mode: Type.Optional(worldbuildingReadModeParameter)
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const chapterCardId = params.chapter_card_id ?? workspace.activeChapterCardId;
          if (!chapterCardId) {
            throw new Error("A chapter_card_id is required when no chapter is active.");
          }
          if (
            profile.id === "expert_section_writer" &&
            chapterCardId !== workspace.activeChapterCardId
          ) {
            throw new Error("The chapter writer may only read the active chapter.");
          }
          const document = params.document ?? "body";
          const target = resolveChapterDocumentTarget(
            index,
            chapterCardId,
            document
          );
          const mode = params.mode ?? "preview";
          let content: string;
          let file = target.file;
          if (target.content !== undefined) {
            content = target.content;
          } else {
            const result = await readWholeChapterBody(
              target.file,
              index.revision,
              projectRevision,
              signal
            );
            content = result.content;
            file = result.file;
          }
          if (mode === "full" && document === "body") {
            fullyReadChapterBodies.set(file.id, {
              content,
              file,
              workspaceRevision: index.revision,
              projectRevision
            });
          }
          const previewLimit = 32_768;
          return textResult(
            JSON.stringify(
              {
                chapter_card_id: chapterCardId,
                title: target.chapterTitle,
                document,
                mode,
                content:
                  mode === "full" ? content : content.slice(0, previewLimit),
                truncated: mode === "preview" && content.length > previewLimit
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
    capabilities.has("write_chapter_files") &&
    writableRoots.has("draft") &&
    profile.id === "expert_section_writer" &&
    workspace.activeChapterCardId
  ) {
    const chapterContentParameter = Type.String({
      minLength: 1,
      maxLength: 10_000_000,
      description:
        "运行时锁定的当前章完整小说正文；不要包含章节标题、相邻章节、分析过程、写作说明、工具参数、章末人物状态、交接文档或下一章接续包。"
    });
    const buildChapterProposal = async (
      toolCallId: string,
      content: string,
      summary: string,
      operation: LongChapterBodyChange["operation"],
      allowOverwriteExisting = false,
      signal?: AbortSignal
    ): Promise<AgentToolResult<LongAgentToolDetails>> => {
      const {
        index,
        projectRevision,
        activeChapterCardId,
        chapter
      } = await loadActiveChapterMutationContext(signal);
      const chapterCard = index.plot.chapterCards.find(
        ({ id }) => id === activeChapterCardId
      )!;
      const overlay = chapterBodyOverlay.get(chapter.body.id);
      const live = overlay
        ? { content: overlay.content, file: overlay.file }
        : await readWholeChapterBody(
            chapter.body,
            index.revision,
            projectRevision,
            signal
          );
      if (
        operation === "write" &&
        live.content.trim() &&
        !allowOverwriteExisting
      ) {
        return textResult(
          "未写入：当前章已有正文，整体重写需设置 allow_overwrite_existing=true。"
        );
      }
      if (operation === "edit" || live.content.trim()) {
        const evidence = fullyReadChapterBodies.get(live.file.id);
        if (!evidence) {
          return textResult(
            `未${operation === "edit" ? "编辑" : "写入"}：请先调用 read_chapter（mode=full）完整读取当前章正文。`
          );
        }
        if (
          evidence.file.revision !== live.file.revision ||
          evidence.workspaceRevision !== index.revision ||
          evidence.projectRevision !== projectRevision ||
          evidence.content !== live.content
        ) {
          throw new Error(
            "The active chapter changed after it was read. Read it in full again before writing or editing."
          );
        }
      }
      const nextRevision = nextContentRevision(live.file.revision, content);
      const timestamp = new Date().toISOString();
      const nextFile = {
        ...live.file,
        revision: nextRevision,
        updatedAt: timestamp
      };
      chapterBodyOverlay.set(chapter.body.id, {
        chapterCardId: activeChapterCardId,
        chapterTitle: chapterCard.title,
        file: nextFile,
        content
      });
      fullyReadChapterBodies.set(chapter.body.id, {
        content,
        file: nextFile,
        workspaceRevision: index.revision,
        projectRevision
      });
      const batch = LongWorkspaceOperationBatchSchema.parse({
        baseRevision: index.revision,
        updatedAt: timestamp,
        operations: [],
        documentWrites: [
          {
            proposalId: `proposal_${stableHash(
              `${workspace.bookId}:${input.runId}:${toolCallId}`
            ).slice(0, 24)}`,
            fileId: live.file.id,
            content,
            mode: "replace",
            expectedRevision: live.file.revision,
            nextRevision,
            updatedAt: timestamp,
            reason: summary
          }
        ]
      });
      const file: LongChapterBodyChange = {
        chapterCardId: activeChapterCardId,
        chapterTitle: chapterCard.title,
        fileId: live.file.id,
        filePath: live.file.path,
        operation,
        beforeText: live.content,
        afterText: content,
        beforeRevision: live.file.revision,
        nextRevision
      };
      return textResult(
        longProposalResultSummary(
          input,
          `已形成《${chapterCard.title}》正文${operation === "edit" ? "编辑" : "写入"}提案，等待客户端审阅。`
        ),
        {
          kind: "long-chapter-write-proposal",
          bookId: workspace.bookId,
          agentId: profile.id,
          batch,
          baseProjectRevision: projectRevision,
          file,
          summary
        }
      );
    };
    tools.push(
      defineTool({
        name: "write_chapter_draft",
        label: "写入当前章正文",
        description:
          "只向运行时锁定章节的独立 body.md 首次写入完整小说正文；已有正文时必须先用 read_chapter mode=full 完整读取，并明确设置 allow_overwrite_existing=true 才能整体重写。形成会话 diff 审批卡，不直接写磁盘；不编写或修改章末人物状态与交接文档。",
        parameters: strictObject({
          content: chapterContentParameter,
          allow_overwrite_existing: Type.Optional(Type.Literal(true)),
          summary: Type.String({ minLength: 1, maxLength: 1_000 })
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const summary = params.summary.trim();
          if (!summary || !params.content.trim()) {
            throw new Error("Chapter draft content and summary must be non-empty.");
          }
          return buildChapterProposal(
            toolCallId,
            params.content,
            summary,
            "write",
            params.allow_overwrite_existing === true,
            signal
          );
        }
      }),
      defineTool({
        name: "edit_chapter_draft",
        label: "编辑当前章正文",
        description:
          "只在已用 read_chapter mode=full 完整读取的当前章 body.md 上做唯一原文片段替换，形成会话 diff 审批卡；不编写或修改章末人物状态与交接文档。",
        parameters: strictObject({
          replacements: Type.Array(
            strictObject({
              original_text: Type.String({ minLength: 1, maxLength: 200_000 }),
              new_text: Type.String({ maxLength: 200_000 })
            }),
            { minItems: 1, maxItems: 100 }
          ),
          summary: Type.String({ minLength: 1, maxLength: 1_000 })
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const summary = params.summary.trim();
          if (!summary) {
            throw new Error("Chapter edit summary must be non-empty.");
          }
          const { chapter } = await loadActiveChapterMutationContext(signal);
          const target = chapterBodyOverlay.get(chapter.body.id)?.file ?? chapter.body;
          const evidence = fullyReadChapterBodies.get(target.id);
          if (!evidence || evidence.file.revision !== target.revision) {
            return textResult(
              "未编辑：请先调用 read_chapter（mode=full）完整读取当前章正文。"
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
          if (!content.trim()) {
            throw new Error("Chapter edits cannot clear the complete body.");
          }
          return buildChapterProposal(
            toolCallId,
            content,
            summary,
            "edit",
            false,
            signal
          );
        }
      })
    );
  }

  if (
    isContinuityLedgerAgent &&
    capabilities.has("query_structure") &&
    readableRoots.has("continuity_ledger")
  ) {
    tools.push(
      defineTool({
        name: "list_continuity_files",
        label: "列出连续性文件",
        description:
          "按章节列出连续性阶段留存的文本文件：章末状态、接续包、伏笔变化、可选世界观揭露，以及各人物的当前状态和历史轨迹。不暴露路径、fileId 或版本信息。",
        parameters: strictObject({
          chapter_card_id: Type.Optional(stableIdParameter("chapter")),
          page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index } = await loadIndex(signal);
          const ordered = orderedLongChapterCards(index).filter(
            (chapter) =>
              !params.chapter_card_id || chapter.id === params.chapter_card_id
          );
          if (params.chapter_card_id && ordered.length === 0) {
            throw new Error(
              `Chapter ${params.chapter_card_id} does not exist.`
            );
          }
          const page = params.page ?? 1;
          const limit = params.limit ?? 50;
          const start = (page - 1) * limit;
          const items = ordered.slice(start, start + limit).map((card) => {
            const chapter = index.chapters.find(
              ({ chapterCardId }) => chapterCardId === card.id
            );
            if (!chapter) {
              throw new Error(`Chapter files are missing for ${card.id}.`);
            }
            const describe = (
              role: LongContinuityFileRole,
              file: LongWorkspaceFileReference | null,
              characterId: string | null = null
            ) => {
              const overlay = findContinuityOverlay(
                card.id,
                role,
                characterId
              );
              const visibleFile = overlay?.file ?? file;
              return {
                document: role,
                ...(characterId ? { character_id: characterId } : {}),
                exists: visibleFile !== null,
                status:
                  visibleFile === null
                    ? "not_created"
                    : overlay
                      ? overlay.content.trim()
                        ? "written"
                        : "empty"
                      : visibleFile.revision === EMPTY_LONG_MARKDOWN_REVISION
                        ? "empty"
                        : "written"
              };
            };
            const characterIds = new Set(
              chapter.characterContinuity.map(({ characterId }) => characterId)
            );
            for (const overlay of continuityDocumentOverlay.values()) {
              if (
                overlay.chapterCardId === card.id &&
                overlay.characterId !== null
              ) {
                characterIds.add(overlay.characterId);
              }
            }
            const characterFiles = [...characterIds]
              .sort((left, right) => left.localeCompare(right))
              .flatMap((characterId) => {
                const character = chapter.characterContinuity.find(
                  (candidate) => candidate.characterId === characterId
                );
                return [
                  describe(
                    "character_current_state",
                    character?.currentState ?? null,
                    characterId
                  ),
                  describe(
                    "character_history",
                    character?.history ?? null,
                    characterId
                  )
                ];
              });
            return {
              chapter_card_id: card.id,
              title: card.title,
              narrative_order: card.narrativeOrder,
              commit_status: chapter.commitId ? "committed" : "uncommitted",
              active: workspace.activeChapterCardId === card.id,
              files: [
                describe("chapter_end_state", chapter.characterState),
                describe("handoff", chapter.handoff),
                describe(
                  "foreshadowing_changes",
                  chapter.foreshadowingChanges
                ),
                describe("world_reveals", chapter.worldReveals),
                ...characterFiles
              ]
            };
          });
          return textResult(
            JSON.stringify(
              {
                page,
                limit,
                total: ordered.length,
                items,
                next_page:
                  start + items.length < ordered.length ? page + 1 : null
              },
              null,
              2
            )
          );
        }
      }),
      defineTool({
        name: "read_continuity_file",
        label: "读取连续性文件",
        description:
          "按 chapter_card_id 和文本种类读取一份连续性文件。人物文件还需 character_id。mode=full 会建立后续覆盖或局部编辑所需的完整读取凭据。",
        parameters: strictObject({
          chapter_card_id: Type.Optional(stableIdParameter("chapter")),
          target: continuityFileTargetParameter,
          mode: Type.Optional(worldbuildingReadModeParameter)
        }),
        execute: async (_toolCallId, params, signal) => {
          const { index, projectRevision } = await loadIndex(signal);
          const chapterCardId =
            params.chapter_card_id ?? workspace.activeChapterCardId;
          if (!chapterCardId) {
            throw new Error(
              "A chapter_card_id is required when no chapter is active."
            );
          }
          const { role, characterId } = continuityTargetFromParameter(
            params.target
          );
          const target = resolveContinuityFileTarget(
            index,
            chapterCardId,
            role,
            characterId
          );
          const result = target.overlay
            ? { content: target.overlay.content, file: target.file }
            : await readWholeChapterBody(
                target.file,
                index.revision,
                projectRevision,
                signal
              );
          const mode = params.mode ?? "full";
          if (mode === "full") {
            fullyReadContinuityDocuments.set(result.file.id, {
              content: result.content,
              file: result.file,
              workspaceRevision: index.revision,
              projectRevision
            });
          }
          const previewLimit = 32_768;
          return textResult(
            JSON.stringify(
              {
                chapter_card_id: chapterCardId,
                title: continuityDocumentTitle(
                  target.chapterTitle,
                  role,
                  target.characterName
                ),
                document: role,
                ...(characterId ? { character_id: characterId } : {}),
                mode,
                content:
                  mode === "full"
                    ? result.content
                    : result.content.slice(0, previewLimit),
                truncated:
                  mode === "preview" && result.content.length > previewLimit
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
    isContinuityLedgerAgent &&
    capabilities.has("commit_ledger") &&
    writableRoots.has("continuity_ledger") &&
    workspace.activeChapterCardId
  ) {
    const continuityProposalResult = (
      batch: LongWorkspaceOperationBatch,
      projectRevision: number,
      summary: string,
      files: LongContinuityFileChange[]
    ) =>
      textResult(
        longProposalResultSummary(
          input,
          "已形成连续性文本文件提案，等待客户端审阅与冲突检查。"
        ),
        {
          kind: "long-continuity-file-proposal" as const,
          bookId: workspace.bookId,
          agentId: profile.id,
          batch,
          baseProjectRevision: projectRevision,
          summary,
          files
        }
      );

    tools.push(
      defineTool({
        name: "create_continuity_file",
        label: "创建连续性文件",
        description:
          "为当前章创建可选世界观揭露文件，或为一名涉及人物同时创建当前状态与历史轨迹两份空白文件。章末状态、接续包和伏笔变化随章卡自动存在，无需创建。创建后再用 write_continuity_file 写入文本。",
        parameters: strictObject({
          target: continuityCreateTargetParameter,
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const {
            index,
            projectRevision,
            activeChapterCardId,
            chapter
          } = await loadActiveChapterMutationContext(signal);
          const chapterCard = index.plot.chapterCards.find(
            ({ id }) => id === activeChapterCardId
          )!;
          const timestamp = new Date().toISOString();
          const changes: LongContinuityFileChange[] = [];
          let operation: LongWorkspaceOperation;
          let summary: string;

          if (params.target.document === "world_reveals") {
            if (
              chapter.worldReveals ||
              findContinuityOverlay(
                activeChapterCardId,
                "world_reveals",
                null
              )
            ) {
              throw new Error(
                "The active chapter already has a world-reveals file."
              );
            }
            const file = createEmptyLongMarkdownFileReference(
              longChapterWorldRevealsFileId(activeChapterCardId),
              longChapterContinuityFilePath(
                activeChapterCardId,
                "world-reveals.md"
              ),
              timestamp
            );
            operation = {
              type: "chapterContinuity.worldReveals.create",
              chapterCardId: activeChapterCardId,
              file
            };
            summary =
              params.summary?.trim() ||
              `创建《${chapterCard.title}》世界观揭露文件`;
            changes.push({
              chapterCardId: activeChapterCardId,
              role: "world_reveals",
              characterId: null,
              fileId: file.id,
              filePath: file.path,
              title: continuityDocumentTitle(
                chapterCard.title,
                "world_reveals",
                null
              ),
              operation: "create",
              beforeText: "",
              afterText: "",
              beforeRevision: null,
              nextRevision: file.revision
            });
            continuityDocumentOverlay.set(file.id, {
              chapterCardId: activeChapterCardId,
              chapterTitle: chapterCard.title,
              role: "world_reveals",
              characterId: null,
              characterName: null,
              file,
              content: "",
              pendingCreation: true
            });
          } else {
            if (!("character_id" in params.target)) {
              throw new Error(
                "Character continuity creation requires character_id."
              );
            }
            const characterId = params.target.character_id;
            const character = index.characters.find(
              ({ id }) => id === characterId
            );
            if (!character) {
              throw new Error(
                `Character ${characterId} does not exist.`
              );
            }
            if (
              chapter.characterContinuity.some(
                ({ characterId }) =>
                  characterId === character.id
              ) ||
              findContinuityOverlay(
                activeChapterCardId,
                "character_current_state",
                character.id
              )
            ) {
              throw new Error(
                "The active chapter already has continuity files for this character."
              );
            }
            const currentState = createEmptyLongMarkdownFileReference(
              longChapterCharacterCurrentStateFileId(
                activeChapterCardId,
                character.id
              ),
              longChapterCharacterContinuityFilePath(
                activeChapterCardId,
                character.id,
                "current-state.md"
              ),
              timestamp
            );
            const history = createEmptyLongMarkdownFileReference(
              longChapterCharacterHistoryFileId(
                activeChapterCardId,
                character.id
              ),
              longChapterCharacterContinuityFilePath(
                activeChapterCardId,
                character.id,
                "history.md"
              ),
              timestamp
            );
            operation = {
              type: "chapterContinuity.character.create",
              chapterCardId: activeChapterCardId,
              characterId: character.id,
              currentState,
              history
            };
            summary =
              params.summary?.trim() ||
              `创建《${chapterCard.title}》中${character.name}的人物连续性文件`;
            for (const [role, file] of [
              ["character_current_state", currentState],
              ["character_history", history]
            ] as const) {
              changes.push({
                chapterCardId: activeChapterCardId,
                role,
                characterId: character.id,
                fileId: file.id,
                filePath: file.path,
                title: continuityDocumentTitle(
                  chapterCard.title,
                  role,
                  character.name
                ),
                operation: "create",
                beforeText: "",
                afterText: "",
                beforeRevision: null,
                nextRevision: file.revision
              });
              continuityDocumentOverlay.set(file.id, {
                chapterCardId: activeChapterCardId,
                chapterTitle: chapterCard.title,
                role,
                characterId: character.id,
                characterName: character.name,
                file,
                content: "",
                pendingCreation: true
              });
            }
          }

          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [operation],
            documentWrites: changes.map((change, changeIndex) => ({
              proposalId: `proposal_${stableHash(
                `${workspace.bookId}:${input.runId}:${toolCallId}:create:${changeIndex}`
              ).slice(0, 24)}`,
              fileId: change.fileId,
              content: "",
              mode: "create" as const,
              expectedRevision: null,
              nextRevision: change.nextRevision,
              updatedAt: timestamp,
              reason: summary
            }))
          });
          return continuityProposalResult(
            batch,
            projectRevision,
            summary,
            changes
          );
        }
      }),
      defineTool({
        name: "write_continuity_file",
        label: "写入连续性文件",
        description:
          "向当前章的一份连续性文件写入完整文本。空文件可直接写入；已有正文必须先用 read_continuity_file mode=full 完整读取，并明确 allow_overwrite_existing=true。局部修改应使用 edit_continuity_file。",
        parameters: strictObject({
          target: continuityFileTargetParameter,
          text: Type.String({ minLength: 1, maxLength: 1_000_000 }),
          allow_overwrite_existing: Type.Optional(Type.Literal(true)),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          if (!params.text.trim()) {
            throw new Error("Continuity file text must be non-empty.");
          }
          const {
            index,
            projectRevision,
            activeChapterCardId
          } = await loadActiveChapterMutationContext(signal);
          const { role, characterId } = continuityTargetFromParameter(
            params.target
          );
          const target = resolveContinuityFileTarget(
            index,
            activeChapterCardId,
            role,
            characterId
          );
          const live = target.overlay
            ? { content: target.overlay.content, file: target.file }
            : await readWholeChapterBody(
                target.file,
                index.revision,
                projectRevision,
                signal
              );
          const evidence = fullyReadContinuityDocuments.get(live.file.id);
          if (live.content.trim() && !evidence) {
            return textResult(
              "未写入：目标已有正文，请先调用 read_continuity_file（mode=full）完整读取。"
            );
          }
          if (
            live.content.trim() &&
            params.allow_overwrite_existing !== true
          ) {
            return textResult(
              "未写入：目标已有正文；局部修改请使用 edit_continuity_file，整体重写需设置 allow_overwrite_existing=true。"
            );
          }
          if (
            evidence &&
            (evidence.file.revision !== live.file.revision ||
              evidence.workspaceRevision !== index.revision ||
              evidence.projectRevision !== projectRevision ||
              evidence.content !== live.content)
          ) {
            throw new Error(
              "Continuity document changed after it was read."
            );
          }
          const timestamp = new Date().toISOString();
          const nextRevision = nextContentRevision(
            live.file.revision,
            params.text
          );
          const summary =
            params.summary?.trim() ||
            `写入${continuityDocumentTitle(
              target.chapterTitle,
              role,
              target.characterName
            )}`;
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [],
            documentWrites: [
              {
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
              }
            ]
          });
          const nextFile = {
            ...live.file,
            revision: nextRevision,
            updatedAt: timestamp
          };
          continuityDocumentOverlay.set(live.file.id, {
            chapterCardId: activeChapterCardId,
            chapterTitle: target.chapterTitle,
            role,
            characterId,
            characterName: target.characterName,
            file: nextFile,
            content: params.text,
            pendingCreation: target.overlay?.pendingCreation ?? false
          });
          fullyReadContinuityDocuments.set(live.file.id, {
            content: params.text,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return continuityProposalResult(
            batch,
            projectRevision,
            summary,
            [
              {
                chapterCardId: activeChapterCardId,
                role,
                characterId,
                fileId: live.file.id,
                filePath: live.file.path,
                title: continuityDocumentTitle(
                  target.chapterTitle,
                  role,
                  target.characterName
                ),
                operation: "write",
                beforeText: live.content,
                afterText: params.text,
                beforeRevision: live.file.revision,
                nextRevision
              }
            ]
          );
        }
      }),
      defineTool({
        name: "edit_continuity_file",
        label: "编辑连续性文件",
        description:
          "在已用 read_continuity_file mode=full 完整读取的当前章连续性文件中按原文片段精确替换。每个 original_text 必须唯一存在。",
        parameters: strictObject({
          target: continuityFileTargetParameter,
          replacements: Type.Array(
            strictObject({
              original_text: Type.String({ minLength: 1, maxLength: 200_000 }),
              new_text: Type.String({ maxLength: 200_000 })
            }),
            { minItems: 1, maxItems: 100 }
          ),
          summary: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1_000 })
          )
        }),
        executionMode: "sequential",
        execute: async (toolCallId, params, signal) => {
          const {
            index,
            projectRevision,
            activeChapterCardId
          } = await loadActiveChapterMutationContext(signal);
          const { role, characterId } = continuityTargetFromParameter(
            params.target
          );
          const target = resolveContinuityFileTarget(
            index,
            activeChapterCardId,
            role,
            characterId
          );
          const evidence = fullyReadContinuityDocuments.get(target.file.id);
          if (
            !evidence ||
            evidence.workspaceRevision !== index.revision ||
            evidence.projectRevision !== projectRevision ||
            evidence.file.revision !== target.file.revision
          ) {
            return textResult(
              "未编辑：请先调用 read_continuity_file（mode=full）完整读取目标内容。"
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
          if (!content.trim()) {
            throw new Error("Continuity edits cannot clear the whole file.");
          }
          const timestamp = new Date().toISOString();
          const nextRevision = nextContentRevision(
            evidence.file.revision,
            content
          );
          const summary =
            params.summary?.trim() ||
            `编辑${continuityDocumentTitle(
              target.chapterTitle,
              role,
              target.characterName
            )}`;
          const batch = LongWorkspaceOperationBatchSchema.parse({
            baseRevision: index.revision,
            updatedAt: timestamp,
            operations: [],
            documentWrites: [
              {
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
              }
            ]
          });
          const nextFile = {
            ...evidence.file,
            revision: nextRevision,
            updatedAt: timestamp
          };
          continuityDocumentOverlay.set(evidence.file.id, {
            chapterCardId: activeChapterCardId,
            chapterTitle: target.chapterTitle,
            role,
            characterId,
            characterName: target.characterName,
            file: nextFile,
            content,
            pendingCreation: target.overlay?.pendingCreation ?? false
          });
          fullyReadContinuityDocuments.set(evidence.file.id, {
            content,
            file: nextFile,
            workspaceRevision: index.revision,
            projectRevision
          });
          return continuityProposalResult(
            batch,
            projectRevision,
            summary,
            [
              {
                chapterCardId: activeChapterCardId,
                role,
                characterId,
                fileId: evidence.file.id,
                filePath: evidence.file.path,
                title: continuityDocumentTitle(
                  target.chapterTitle,
                  role,
                  target.characterName
                ),
                operation: "edit",
                beforeText: evidence.content,
                afterText: content,
                beforeRevision: evidence.file.revision,
                nextRevision
              }
            ]
          );
        }
      }),
      defineTool({
        name: "propose_continuity_commit",
        label: "提议提交连续性记录",
        description:
          "在当前连续下一章的正文、章末状态、接续包、伏笔变化，以及所有已创建的世界观揭露和人物连续性文件都已写好后，形成只锁定这些文本版本的最终提交提案。",
        parameters: strictObject({
          summary: Type.String({ minLength: 1, maxLength: 1_000 })
        }),
        executionMode: "sequential",
        execute: async (_toolCallId, params, signal) => {
          const {
            index,
            projectRevision,
            activeChapterCardId,
            chapter
          } = await loadActiveChapterMutationContext(signal);
          const expectedChapter = selectNextLongChapterForDispatch(index);
          if (expectedChapter?.id !== activeChapterCardId) {
            throw new Error(
              "Only the continuous next uncommitted chapter can be submitted."
            );
          }
          const summary = params.summary.trim();
          if (!summary) {
            throw new Error("Continuity commit summary must be non-empty.");
          }
          const bodyOverlay = chapterBodyOverlay.get(chapter.body.id);
          const body = bodyOverlay
            ? { content: bodyOverlay.content, file: bodyOverlay.file }
            : await readWholeChapterBody(
                chapter.body,
                index.revision,
                projectRevision,
                signal
              );

          const targets: Array<{
            role: LongContinuityFileRole;
            characterId: string | null;
          }> = [
            { role: "chapter_end_state", characterId: null },
            { role: "handoff", characterId: null },
            { role: "foreshadowing_changes", characterId: null }
          ];
          if (
            chapter.worldReveals ||
            findContinuityOverlay(
              activeChapterCardId,
              "world_reveals",
              null
            )
          ) {
            targets.push({ role: "world_reveals", characterId: null });
          }
          const characterIds = new Set(
            chapter.characterContinuity.map(({ characterId }) => characterId)
          );
          for (const overlay of continuityDocumentOverlay.values()) {
            if (
              overlay.chapterCardId === activeChapterCardId &&
              overlay.characterId !== null
            ) {
              characterIds.add(overlay.characterId);
            }
          }
          for (const characterId of [...characterIds].sort((left, right) =>
            left.localeCompare(right)
          )) {
            targets.push(
              { role: "character_current_state", characterId },
              { role: "character_history", characterId }
            );
          }

          const continuityFiles: Array<{
            role: LongContinuityFileRole;
            characterId: string | null;
            content: string;
            file: LongWorkspaceFileReference;
          }> = [];
          for (const item of targets) {
            const target = resolveContinuityFileTarget(
              index,
              activeChapterCardId,
              item.role,
              item.characterId
            );
            const live = target.overlay
              ? { content: target.overlay.content, file: target.file }
              : await readWholeChapterBody(
                  target.file,
                  index.revision,
                  projectRevision,
                  signal
                );
            continuityFiles.push({ ...item, ...live });
          }

          const missing = [
            ...(body.content.trim() ? [] : ["正文"]),
            ...continuityFiles.flatMap((file) =>
              file.content.trim()
                ? []
                : [
                    file.characterId
                      ? `${file.characterId} / ${CONTINUITY_DOCUMENT_TITLES[file.role]}`
                      : CONTINUITY_DOCUMENT_TITLES[file.role]
                  ]
            )
          ];
          if (missing.length > 0) {
            return textResult(
              `未形成提交提案：以下文本尚为空：${missing.join("、")}。无伏笔变化时也请明确写入“无变化”。`
            );
          }

          const commitInput = LongCommitChapterInputSchema.parse({
            mode: "text_files",
            bookId: workspace.bookId,
            chapterCardId: activeChapterCardId,
            chapterFileRevisions: { body: body.file.revision },
            continuityFileRevisions: continuityFiles.map(({ file }) => ({
              fileId: file.id,
              revision: file.revision
            })),
            commitMessage: summary,
            baseWorkspaceRevision: index.revision,
            baseProjectRevision: projectRevision
          });
          return textResult(
            longProposalResultSummary(
              input,
              `已形成《${expectedChapter.title}》连续性文本提交提案（${continuityFiles.length} 份连续性文件），等待客户端审阅。`
            ),
            {
              kind: "long-ledger-commit-proposal",
              bookId: workspace.bookId,
              agentId: profile.id,
              input: commitInput,
              summary
            }
          );
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
