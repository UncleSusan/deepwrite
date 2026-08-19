import { StringEnum, Type, type TSchema } from "@earendil-works/pi-ai";
import {
  LONG_WORKSPACE_ROOTS,
  type LongWorkspaceRoot
} from "@deepwrite/contracts";

export const ALL_ROOTS = new Set<LongWorkspaceRoot>(LONG_WORKSPACE_ROOTS);
export const STABLE_ID_SUFFIX_PATTERN =
  "[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?";
export const CLIENT_REFERENCE_PATTERN =
  "ref:[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?";

export function strictObject<T extends Record<string, TSchema>>(
  properties: T,
  options: Record<string, unknown> = {}
) {
  return Type.Object(properties, {
    additionalProperties: false,
    ...options
  });
}

export function providerObjectUnion<T extends TSchema[]>(
  schemas: [...T]
): T[number] {
  const propertyMaps = schemas.map((schema) => {
    const properties = (schema as unknown as Record<string, unknown>)[
      "properties"
    ];
    if (!properties || typeof properties !== "object") {
      throw new Error("Provider object unions require object schemas.");
    }
    return properties as Record<string, TSchema>;
  });
  const propertyNames = new Set(propertyMaps.flatMap(Object.keys));
  const properties: Record<string, TSchema> = {};

  for (const propertyName of propertyNames) {
    const variants = propertyMaps
      .map((propertyMap) => propertyMap[propertyName])
      .filter((variant): variant is TSchema => variant !== undefined);
    const literalValues = variants.map(
      (variant) => (variant as unknown as Record<string, unknown>)["const"]
    );
    if (
      variants.length === schemas.length &&
      literalValues.every((value): value is string => typeof value === "string")
    ) {
      properties[propertyName] = StringEnum(literalValues);
      continue;
    }
    properties[propertyName] = variants[0]!;
  }

  const required = [...propertyNames].filter((propertyName) =>
    schemas.every((schema) => {
      const requiredProperties = (schema as unknown as Record<string, unknown>)[
        "required"
      ];
      return (
        Array.isArray(requiredProperties) &&
        requiredProperties.includes(propertyName)
      );
    })
  );
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  } as T[number];
}

export function stableIdParameter(prefix: string) {
  return Type.String({
    minLength: 3,
    maxLength: 160,
    pattern: `^${prefix}_${STABLE_ID_SUFFIX_PATTERN}$`
  });
}

export function entityReferenceParameter(prefix: string, description?: string) {
  return Type.Union(
    [
      stableIdParameter(prefix),
      Type.String({
        minLength: 5,
        maxLength: 84,
        pattern: `^${CLIENT_REFERENCE_PATTERN}$`
      })
    ],
    description ? { description } : {}
  );
}

export const clientReferenceParameter = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$"
  })
);
export const titleParameter = Type.String({ minLength: 1, maxLength: 256 });
export const explicitTrueParameter = Type.Unsafe<true>({
  type: "boolean",
  enum: [true]
});
export const worldbuildingCategoryIdParameter = stableIdParameter("world");
export const worldbuildingItemIdParameter = stableIdParameter("worlditem");
export const worldbuildingReadModeParameter = StringEnum([
  "preview",
  "full"
] as const);
export const plotItemKindParameter = StringEnum([
  "book_line",
  "volume",
  "arc",
  "story_plot",
  "chapter",
  "event",
  "connection",
  "placement",
  "foreshadowing"
] as const);
export const textParameter = Type.String({ maxLength: 200_000 });
export const shortTextParameter = Type.String({ maxLength: 4_000 });
export const aliasesParameter = Type.Array(
  Type.String({ minLength: 1, maxLength: 120 }),
  {
    maxItems: 64,
    uniqueItems: true
  }
);
export const characterTypeIdParameter = Type.Union([
  StringEnum([
    "protagonist",
    "major_supporting",
    "minor_supporting",
    "passerby"
  ] as const),
  stableIdParameter("chartype")
]);
export const characterDocumentParameter = StringEnum([
  "core_profile",
  "relationships",
  "current_state",
  "history"
] as const);
export const continuityFileTargetParameter = Type.Union([
  strictObject({
    document: StringEnum([
      "foreshadowing_changes",
      "world_reveals",
      "chapter_end_state",
      "handoff"
    ] as const)
  }),
  strictObject({
    document: StringEnum([
      "character_current_state",
      "character_history"
    ] as const),
    character_id: stableIdParameter("character")
  })
]);
export const continuityCreateTargetParameter = Type.Union([
  strictObject({ document: StringEnum(["world_reveals"] as const) }),
  strictObject({
    document: StringEnum(["character"] as const),
    character_id: stableIdParameter("character")
  })
]);
export const storyTimeModeParameter = StringEnum([
  "exact",
  "relative",
  "sequence",
  "unknown"
] as const);
export const connectionTypeParameter = StringEnum([
  "before",
  "same_time",
  "overlaps",
  "causes",
  "enables",
  "conceals"
] as const);
export const narrativeModeParameter = StringEnum([
  "scene",
  "flashback",
  "retelling",
  "clue",
  "misdirection",
  "reveal",
  "dream",
  "prophecy"
] as const);
export const disclosureParameter = StringEnum([
  "hint",
  "partial",
  "full",
  "false"
] as const);
export const beatTypeParameter = StringEnum([
  "source",
  "plant",
  "reinforce",
  "misdirect",
  "partial_reveal",
  "reveal",
  "payoff",
  "aftermath"
] as const);
export const foreshadowingSpanParameter = StringEnum(
  ["local", "within_volume", "cross_volume"] as const,
  {
    description:
      "伏笔计划跨度：local 为局部剧情点，within_volume 为卷内，cross_volume 为跨卷。"
  }
);
export const foreshadowingHiddenTruthParameter = Type.String({
  maxLength: 200_000,
  description: "作者掌握但暂不向读者公开的伏笔真相。"
});
export function nullableEntityReferenceParameter(
  prefix: string,
  description: string
) {
  return Type.Union([entityReferenceParameter(prefix), Type.Null()], {
    description
  });
}

export function patchParameter<T extends Record<string, TSchema>>(
  properties: T
) {
  return strictObject(properties, { minProperties: 1 });
}

export const LONG_MUTATION_OPERATION_PARAMETER = Type.Union([
  strictObject({
    type: StringEnum(["worldbuilding.create"] as const),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    format: Type.Optional(StringEnum(["list", "text"] as const))
  }),
  strictObject({
    type: StringEnum(["worldbuilding.update"] as const),
    id: entityReferenceParameter("world"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      format: Type.Optional(StringEnum(["list", "text"] as const))
    })
  }),
  strictObject({
    type: StringEnum(["worldbuilding.delete"] as const),
    id: entityReferenceParameter("world"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["worldbuilding.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("world"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: StringEnum(["worldbuildingItem.create"] as const),
    client_ref: clientReferenceParameter,
    categoryId: entityReferenceParameter("world"),
    title: titleParameter
  }),
  strictObject({
    type: StringEnum(["worldbuildingItem.update"] as const),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
    })
  }),
  strictObject({
    type: StringEnum(["worldbuildingItem.delete"] as const),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["worldbuildingItem.reorder"] as const),
    categoryId: entityReferenceParameter("world"),
    orderedIds: Type.Array(entityReferenceParameter("worlditem"), {
      maxItems: 10_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["character.create"] as const),
    client_ref: clientReferenceParameter,
    name: titleParameter,
    type_id: characterTypeIdParameter,
    aliases: Type.Optional(aliasesParameter)
  }),
  strictObject({
    type: StringEnum(["character.update"] as const),
    id: entityReferenceParameter("character"),
    patch: patchParameter({
      name: Type.Optional(titleParameter),
      aliases: Type.Optional(aliasesParameter)
    })
  }),
  strictObject({
    type: StringEnum(["character.delete"] as const),
    id: entityReferenceParameter("character"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["character.move"] as const),
    id: entityReferenceParameter("character"),
    to_type_id: characterTypeIdParameter,
    beforeCharacterId: Type.Optional(entityReferenceParameter("character"))
  }),
  strictObject({
    type: StringEnum(["character.reorder"] as const),
    type_id: characterTypeIdParameter,
    orderedIds: Type.Array(entityReferenceParameter("character"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["volume.create"] as const),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    summary: Type.Optional(textParameter)
  }),
  strictObject({
    type: StringEnum(["volume.update"] as const),
    id: entityReferenceParameter("volume"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      summary: Type.Optional(textParameter)
    })
  }),
  strictObject({
    type: StringEnum(["volume.delete"] as const),
    id: entityReferenceParameter("volume"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["volume.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("volume"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["arc.create"] as const),
    client_ref: clientReferenceParameter,
    volumeId: entityReferenceParameter("volume"),
    title: titleParameter,
    summary: Type.Optional(textParameter),
    outline: Type.Optional(textParameter)
  }),
  strictObject({
    type: StringEnum(["arc.update"] as const),
    id: entityReferenceParameter("arc"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      outline: Type.Optional(textParameter)
    })
  }),
  strictObject({
    type: StringEnum(["arc.delete"] as const),
    id: entityReferenceParameter("arc"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["arc.move"] as const),
    id: entityReferenceParameter("arc"),
    toVolumeId: entityReferenceParameter("volume"),
    beforeArcId: Type.Optional(entityReferenceParameter("arc"))
  }),
  strictObject({
    type: StringEnum(["arc.reorder"] as const),
    volumeId: entityReferenceParameter("volume"),
    orderedIds: Type.Array(entityReferenceParameter("arc"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["chapter.create"] as const),
    client_ref: clientReferenceParameter,
    volumeId: entityReferenceParameter("volume"),
    primaryArcId: Type.Union([entityReferenceParameter("arc"), Type.Null()]),
    title: titleParameter
  }),
  strictObject({
    type: StringEnum(["chapter.update"] as const),
    id: entityReferenceParameter("chapter"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
    })
  }),
  strictObject({
    type: StringEnum(["chapter.delete"] as const),
    id: entityReferenceParameter("chapter"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["chapter.move"] as const),
    id: entityReferenceParameter("chapter"),
    toVolumeId: entityReferenceParameter(
      "volume",
      "章卡移动后的目标分卷；toPrimaryArcId 非空时必须属于该分卷。"
    ),
    toPrimaryArcId: Type.Union([
      entityReferenceParameter(
        "arc",
        "章卡移动后绑定的剧情点；非空时必须属于 toVolumeId。"
      ),
      Type.Null()
    ]),
    beforeChapterCardId: Type.Optional(entityReferenceParameter("chapter"))
  }),
  strictObject({
    type: StringEnum(["chapter.reorder"] as const),
    volumeId: entityReferenceParameter("volume"),
    orderedIds: Type.Array(entityReferenceParameter("chapter"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["event.create"] as const),
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
    type: StringEnum(["event.update"] as const),
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
    type: StringEnum(["event.delete"] as const),
    id: entityReferenceParameter("event"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["event.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("event"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["storyPlot.create"] as const),
    client_ref: clientReferenceParameter,
    arcId: entityReferenceParameter("arc"),
    title: titleParameter
  }),
  strictObject({
    type: StringEnum(["storyPlot.update"] as const),
    id: entityReferenceParameter("storyplot"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
    })
  }),
  strictObject({
    type: StringEnum(["storyPlot.delete"] as const),
    id: entityReferenceParameter("storyplot"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["storyPlot.reorder"] as const),
    arcId: entityReferenceParameter("arc"),
    orderedIds: Type.Array(entityReferenceParameter("storyplot"), {
      maxItems: 100_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["connection.create"] as const),
    client_ref: clientReferenceParameter,
    sourceEventId: entityReferenceParameter("event"),
    targetEventId: entityReferenceParameter("event"),
    connectionType: connectionTypeParameter,
    note: Type.Optional(shortTextParameter)
  }),
  strictObject({
    type: StringEnum(["connection.update"] as const),
    id: entityReferenceParameter("connection"),
    patch: patchParameter({
      sourceEventId: Type.Optional(entityReferenceParameter("event")),
      targetEventId: Type.Optional(entityReferenceParameter("event")),
      connectionType: Type.Optional(connectionTypeParameter),
      note: Type.Optional(shortTextParameter)
    })
  }),
  strictObject({
    type: StringEnum(["connection.delete"] as const),
    id: entityReferenceParameter("connection"),
    cascade: Type.Boolean()
  }),

  strictObject({
    type: StringEnum(["placement.create"] as const),
    client_ref: clientReferenceParameter,
    eventId: entityReferenceParameter("event"),
    chapterCardId: entityReferenceParameter("chapter"),
    mode: narrativeModeParameter,
    disclosure: disclosureParameter,
    writingPrompt: Type.Optional(shortTextParameter)
  }),
  strictObject({
    type: StringEnum(["placement.update"] as const),
    id: entityReferenceParameter("placement"),
    patch: patchParameter({
      eventId: Type.Optional(entityReferenceParameter("event")),
      mode: Type.Optional(narrativeModeParameter),
      disclosure: Type.Optional(disclosureParameter),
      writingPrompt: Type.Optional(shortTextParameter)
    })
  }),
  strictObject({
    type: StringEnum(["placement.delete"] as const),
    id: entityReferenceParameter("placement"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["placement.move"] as const),
    id: entityReferenceParameter("placement"),
    toChapterCardId: entityReferenceParameter("chapter"),
    beforePlacementId: Type.Optional(entityReferenceParameter("placement"))
  }),
  strictObject({
    type: StringEnum(["placement.reorder"] as const),
    chapterCardId: entityReferenceParameter("chapter"),
    orderedIds: Type.Array(entityReferenceParameter("placement"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["foreshadowing.create"] as const),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    coreQuestion: Type.Optional(textParameter),
    hiddenTruth: Type.Optional(foreshadowingHiddenTruthParameter),
    plannedSpan: Type.Optional(foreshadowingSpanParameter),
    truthEventId: Type.Optional(
      Type.Union([entityReferenceParameter("event"), Type.Null()])
    ),
    expectedReaderEffect: Type.Optional(textParameter),
    status: Type.Optional(StringEnum(["planned"] as const))
  }),
  strictObject({
    type: StringEnum(["foreshadowing.update"] as const),
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
      status: Type.Optional(StringEnum(["planned", "abandoned"] as const))
    })
  }),
  strictObject({
    type: StringEnum(["foreshadowing.delete"] as const),
    id: entityReferenceParameter("foreshadow"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["foreshadowing.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("foreshadow"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),

  strictObject({
    type: StringEnum(["foreshadowingBeat.create"] as const),
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
    type: StringEnum(["foreshadowingBeat.update"] as const),
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
    type: StringEnum(["foreshadowingBeat.delete"] as const),
    id: entityReferenceParameter("beat"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["foreshadowingBeat.move"] as const),
    id: entityReferenceParameter("beat"),
    toThreadId: entityReferenceParameter("foreshadow"),
    beforeBeatId: Type.Optional(entityReferenceParameter("beat"))
  }),
  strictObject({
    type: StringEnum(["foreshadowingBeat.reorder"] as const),
    threadId: entityReferenceParameter("foreshadow"),
    orderedIds: Type.Array(entityReferenceParameter("beat"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  })
]);

export const LONG_DOCUMENT_UPDATE_PARAMETER = Type.Union([
  strictObject({
    target: strictObject({ kind: StringEnum(["book_line"] as const) }),
    content: Type.String({ maxLength: 10_000_000 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 })
  }),
  strictObject({
    target: strictObject({
      kind: StringEnum(["worldbuilding"] as const),
      categoryId: entityReferenceParameter("world"),
      itemId: Type.Optional(entityReferenceParameter("worlditem"))
    }),
    content: Type.String({ maxLength: 10_000_000 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 })
  }),
  strictObject({
    target: strictObject({
      kind: StringEnum(["character"] as const),
      characterId: entityReferenceParameter("character"),
      role: StringEnum([
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

export const LONG_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_MUTATION_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  document_updates: Type.Optional(
    Type.Array(LONG_DOCUMENT_UPDATE_PARAMETER, { maxItems: 10_000 })
  ),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

export const LONG_WORLDBUILDING_STRUCTURE_OPERATION_PARAMETER = Type.Union([
  strictObject({
    type: StringEnum(["worldbuilding.create"] as const),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    format: Type.Optional(StringEnum(["list", "text"] as const))
  }),
  strictObject({
    type: StringEnum(["worldbuilding.update"] as const),
    id: entityReferenceParameter("world"),
    patch: patchParameter({
      title: Type.Optional(titleParameter),
      format: Type.Optional(StringEnum(["list", "text"] as const))
    })
  }),
  strictObject({
    type: StringEnum(["worldbuilding.delete"] as const),
    id: entityReferenceParameter("world"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["worldbuilding.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("world"), {
      maxItems: 400_000,
      uniqueItems: true
    })
  }),
  strictObject({
    type: StringEnum(["worldbuildingItem.update"] as const),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    patch: patchParameter({
      title: Type.Optional(titleParameter)
    })
  }),
  strictObject({
    type: StringEnum(["worldbuildingItem.delete"] as const),
    categoryId: entityReferenceParameter("world"),
    id: entityReferenceParameter("worlditem"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["worldbuildingItem.reorder"] as const),
    categoryId: entityReferenceParameter("world"),
    orderedIds: Type.Array(entityReferenceParameter("worlditem"), {
      maxItems: 10_000,
      uniqueItems: true
    })
  })
]);

export const LONG_WORLDBUILDING_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_WORLDBUILDING_STRUCTURE_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

export const LONG_CHARACTER_STRUCTURE_OPERATION_PARAMETER = Type.Union([
  strictObject({
    type: StringEnum(["character.update"] as const),
    id: entityReferenceParameter("character"),
    patch: patchParameter({
      name: Type.Optional(titleParameter),
      aliases: Type.Optional(aliasesParameter)
    })
  }),
  strictObject({
    type: StringEnum(["character.delete"] as const),
    id: entityReferenceParameter("character"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["character.move"] as const),
    id: entityReferenceParameter("character"),
    to_type_id: characterTypeIdParameter,
    beforeCharacterId: Type.Optional(entityReferenceParameter("character"))
  }),
  strictObject({
    type: StringEnum(["character.reorder"] as const),
    type_id: characterTypeIdParameter,
    orderedIds: Type.Array(entityReferenceParameter("character"), {
      maxItems: 100_000,
      uniqueItems: true
    })
  })
]);

export const LONG_CHARACTER_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_CHARACTER_STRUCTURE_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

export const LONG_SETTING_STRUCTURE_OPERATION_PARAMETER = Type.Union([
  LONG_WORLDBUILDING_STRUCTURE_OPERATION_PARAMETER,
  LONG_CHARACTER_STRUCTURE_OPERATION_PARAMETER
]);

export const LONG_SETTING_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_SETTING_STRUCTURE_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

export const settingCharacterDocumentParameter = StringEnum([
  "overview",
  "core_profile",
  "relationships",
  "current_state",
  "history"
] as const);

export const LONG_PLOT_STRUCTURE_OPERATION_PARAMETER = Type.Union([
  strictObject({
    type: StringEnum(["volume.update"] as const),
    id: entityReferenceParameter("volume"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: StringEnum(["volume.delete"] as const),
    id: entityReferenceParameter("volume"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["volume.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("volume"), {
      maxItems: 10_000,
      uniqueItems: true,
      description:
        "必须按最终顺序完整列出当前全部分卷 ID，不能遗漏或附加其它 ID。"
    })
  }),
  strictObject({
    type: StringEnum(["arc.update"] as const),
    id: entityReferenceParameter("arc"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: StringEnum(["arc.delete"] as const),
    id: entityReferenceParameter("arc"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["arc.move"] as const),
    id: entityReferenceParameter("arc"),
    toVolumeId: entityReferenceParameter("volume"),
    beforeArcId: Type.Optional(
      entityReferenceParameter(
        "arc",
        "可选插入位置；必须是移动后目标分卷内的剧情点。"
      )
    )
  }),
  strictObject({
    type: StringEnum(["arc.reorder"] as const),
    volumeId: entityReferenceParameter("volume"),
    orderedIds: Type.Array(entityReferenceParameter("arc"), {
      maxItems: 100_000,
      uniqueItems: true,
      description: "必须按最终顺序完整列出 volumeId 分卷内当前全部剧情点 ID。"
    })
  }),
  strictObject({
    type: StringEnum(["chapter.update"] as const),
    id: entityReferenceParameter("chapter"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: StringEnum(["chapter.delete"] as const),
    id: entityReferenceParameter("chapter"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["chapter.move"] as const),
    id: entityReferenceParameter("chapter"),
    toVolumeId: entityReferenceParameter(
      "volume",
      "章卡移动后的目标分卷；toPrimaryArcId 非空时必须属于该分卷。"
    ),
    toPrimaryArcId: Type.Union([
      entityReferenceParameter(
        "arc",
        "章卡移动后关联的剧情点；非空时必须属于 toVolumeId。"
      ),
      Type.Null()
    ]),
    beforeChapterCardId: Type.Optional(
      entityReferenceParameter(
        "chapter",
        "可选插入位置；必须是移动后目标分卷内且位于未提交后缀的章卡。"
      )
    )
  }),
  strictObject({
    type: StringEnum(["chapter.reorder"] as const),
    volumeId: entityReferenceParameter("volume"),
    orderedIds: Type.Array(entityReferenceParameter("chapter"), {
      maxItems: 100_000,
      uniqueItems: true,
      description:
        "必须按最终顺序完整列出 volumeId 分卷内当前全部章卡 ID，并保持已提交前缀不变。"
    })
  }),
  strictObject({
    type: StringEnum(["event.update"] as const),
    id: entityReferenceParameter("event"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: StringEnum(["event.delete"] as const),
    id: entityReferenceParameter("event"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["event.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("event"), {
      maxItems: 200_000,
      uniqueItems: true,
      description:
        "必须按最终故事发生顺序完整列出当前全部故事事件 ID；已进入提交事实的事件不能改变位置。"
    })
  }),
  strictObject({
    type: StringEnum(["storyPlot.update"] as const),
    id: entityReferenceParameter("storyplot"),
    patch: patchParameter({ title: Type.Optional(titleParameter) })
  }),
  strictObject({
    type: StringEnum(["storyPlot.delete"] as const),
    id: entityReferenceParameter("storyplot"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["storyPlot.reorder"] as const),
    arcId: entityReferenceParameter("arc"),
    orderedIds: Type.Array(entityReferenceParameter("storyplot"), {
      maxItems: 100_000,
      uniqueItems: true,
      description: "必须按最终顺序完整列出 arcId 剧情点下当前全部故事情节 ID。"
    })
  }),
  strictObject({
    type: StringEnum(["connection.update"] as const),
    id: entityReferenceParameter("connection"),
    patch: patchParameter({
      sourceEventId: Type.Optional(entityReferenceParameter("event")),
      targetEventId: Type.Optional(entityReferenceParameter("event")),
      connectionType: Type.Optional(connectionTypeParameter)
    })
  }),
  strictObject({
    type: StringEnum(["connection.delete"] as const),
    id: entityReferenceParameter("connection"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["placement.update"] as const),
    id: entityReferenceParameter("placement"),
    patch: patchParameter({
      eventId: Type.Optional(entityReferenceParameter("event")),
      mode: Type.Optional(narrativeModeParameter),
      disclosure: Type.Optional(disclosureParameter)
    })
  }),
  strictObject({
    type: StringEnum(["placement.delete"] as const),
    id: entityReferenceParameter("placement"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["placement.move"] as const),
    id: entityReferenceParameter("placement"),
    toChapterCardId: entityReferenceParameter("chapter"),
    beforePlacementId: Type.Optional(
      entityReferenceParameter(
        "placement",
        "可选插入位置；必须是目标章卡内的叙事落点。"
      )
    )
  }),
  strictObject({
    type: StringEnum(["placement.reorder"] as const),
    chapterCardId: entityReferenceParameter("chapter"),
    orderedIds: Type.Array(entityReferenceParameter("placement"), {
      maxItems: 400_000,
      uniqueItems: true,
      description:
        "必须按最终顺序完整列出 chapterCardId 章卡内当前全部叙事落点 ID。"
    })
  }),
  strictObject({
    type: StringEnum(["foreshadowing.create"] as const),
    client_ref: clientReferenceParameter,
    title: titleParameter,
    coreQuestion: Type.Optional(textParameter),
    hiddenTruth: Type.Optional(foreshadowingHiddenTruthParameter),
    plannedSpan: Type.Optional(foreshadowingSpanParameter),
    truthEventId: Type.Optional(
      Type.Union([entityReferenceParameter("event"), Type.Null()])
    ),
    expectedReaderEffect: Type.Optional(textParameter),
    status: Type.Optional(StringEnum(["planned"] as const))
  }),
  strictObject({
    type: StringEnum(["foreshadowing.update"] as const),
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
      status: Type.Optional(StringEnum(["planned", "abandoned"] as const))
    })
  }),
  strictObject({
    type: StringEnum(["foreshadowing.delete"] as const),
    id: entityReferenceParameter("foreshadow"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["foreshadowing.reorder"] as const),
    orderedIds: Type.Array(entityReferenceParameter("foreshadow"), {
      maxItems: 100_000,
      uniqueItems: true,
      description: "必须按最终顺序完整列出当前全部伏笔线 ID。"
    })
  }),
  strictObject({
    type: StringEnum(["foreshadowingBeat.create"] as const),
    client_ref: clientReferenceParameter,
    threadId: entityReferenceParameter("foreshadow"),
    beatType: beatTypeParameter,
    volumeId: Type.Optional(
      nullableEntityReferenceParameter(
        "volume",
        "卷级计划锚点；传 null 可清空。"
      )
    ),
    arcId: Type.Optional(
      nullableEntityReferenceParameter(
        "arc",
        "剧情点计划锚点；传 null 可清空。"
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
    type: StringEnum(["foreshadowingBeat.update"] as const),
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
          "更新剧情点计划锚点；传 null 可清空。"
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
    type: StringEnum(["foreshadowingBeat.delete"] as const),
    id: entityReferenceParameter("beat"),
    cascade: Type.Boolean()
  }),
  strictObject({
    type: StringEnum(["foreshadowingBeat.move"] as const),
    id: entityReferenceParameter("beat"),
    toThreadId: entityReferenceParameter("foreshadow"),
    beforeBeatId: Type.Optional(
      entityReferenceParameter(
        "beat",
        "可选插入位置；必须是目标伏笔线内的触点。"
      )
    )
  }),
  strictObject({
    type: StringEnum(["foreshadowingBeat.reorder"] as const),
    threadId: entityReferenceParameter("foreshadow"),
    orderedIds: Type.Array(entityReferenceParameter("beat"), {
      maxItems: 10_000,
      uniqueItems: true,
      description: "必须按最终顺序完整列出 threadId 伏笔线内当前全部触点 ID。"
    })
  })
]);

export const LONG_PLOT_MUTATION_PARAMETERS = strictObject({
  operations: Type.Array(LONG_PLOT_STRUCTURE_OPERATION_PARAMETER, {
    minItems: 1,
    maxItems: 10_000
  }),
  summary: Type.String({ minLength: 1, maxLength: 1_000 })
});

export const LONG_PLOT_CREATE_PARAMETERS = strictObject({
  item: Type.Union([
    strictObject({
      kind: StringEnum(["volume"] as const),
      title: titleParameter,
      summary: Type.Optional(textParameter)
    }),
    strictObject({
      kind: StringEnum(["arc"] as const),
      volume_id: entityReferenceParameter("volume"),
      title: titleParameter,
      summary: Type.Optional(textParameter),
      outline: Type.Optional(textParameter)
    }),
    strictObject({
      kind: StringEnum(["story_plot"] as const),
      arc_id: entityReferenceParameter("arc"),
      title: titleParameter
    }),
    strictObject({
      kind: StringEnum(["chapter"] as const),
      volume_id: entityReferenceParameter(
        "volume",
        "章卡所属分卷；primary_arc_id 非空时必须属于该分卷。"
      ),
      primary_arc_id: Type.Union([
        entityReferenceParameter(
          "arc",
          "章卡关联的剧情点；非空时必须属于 volume_id。"
        ),
        Type.Null()
      ]),
      title: titleParameter
    }),
    strictObject({
      kind: StringEnum(["event"] as const),
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
      kind: StringEnum(["connection"] as const),
      source_event_id: entityReferenceParameter("event"),
      target_event_id: entityReferenceParameter("event"),
      connection_type: connectionTypeParameter,
      note: Type.Optional(shortTextParameter)
    }),
    strictObject({
      kind: StringEnum(["placement"] as const),
      event_id: entityReferenceParameter("event"),
      chapter_card_id: entityReferenceParameter("chapter"),
      mode: narrativeModeParameter,
      disclosure: disclosureParameter,
      writing_prompt: Type.Optional(shortTextParameter)
    }),
    strictObject({
      kind: StringEnum(["placements"] as const),
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

export const LONG_PLOT_ITEM_TARGET_PARAMETER = Type.Union([
  strictObject({ kind: StringEnum(["book_line"] as const) }),
  strictObject({
    kind: StringEnum(["volume"] as const),
    volume_id: stableIdParameter("volume")
  }),
  strictObject({
    kind: StringEnum(["arc"] as const),
    arc_id: stableIdParameter("arc")
  }),
  strictObject({
    kind: StringEnum(["story_plot"] as const),
    story_plot_id: stableIdParameter("storyplot")
  }),
  strictObject({
    kind: StringEnum(["chapter"] as const),
    chapter_card_id: stableIdParameter("chapter")
  }),
  strictObject({
    kind: StringEnum(["event"] as const),
    event_id: stableIdParameter("event")
  }),
  strictObject({
    kind: StringEnum(["connection"] as const),
    connection_id: stableIdParameter("connection")
  }),
  strictObject({
    kind: StringEnum(["placement"] as const),
    placement_id: stableIdParameter("placement")
  }),
  strictObject({
    kind: StringEnum(["foreshadowing"] as const),
    foreshadowing_id: stableIdParameter("foreshadow")
  })
]);

export const LONG_PLOT_WRITE_PARAMETERS = strictObject({
  item: Type.Union([
    strictObject({
      kind: StringEnum(["book_line"] as const),
      text: Type.String({ minLength: 1, maxLength: 1_000_000 })
    }),
    strictObject({
      kind: StringEnum(["volume"] as const),
      volume_id: stableIdParameter("volume"),
      summary: textParameter
    }),
    strictObject({
      kind: StringEnum(["arc"] as const),
      arc_id: stableIdParameter("arc"),
      summary: textParameter,
      outline: textParameter
    }),
    strictObject({
      kind: StringEnum(["story_plot"] as const),
      story_plot_id: stableIdParameter("storyplot"),
      text: Type.String({ minLength: 1, maxLength: 1_000_000 })
    }),
    strictObject({
      kind: StringEnum(["chapter"] as const),
      chapter_card_id: stableIdParameter("chapter"),
      text: Type.String({ minLength: 1, maxLength: 1_000_000 })
    }),
    strictObject({
      kind: StringEnum(["event"] as const),
      event_id: stableIdParameter("event"),
      summary: textParameter,
      time_mode: storyTimeModeParameter,
      time_label: Type.String({ maxLength: 1_000 }),
      time_value: Type.Optional(Type.String({ maxLength: 1_000 })),
      location: Type.String({ maxLength: 1_000 }),
      arc_ids: Type.Array(entityReferenceParameter("arc"), {
        maxItems: 1_024,
        uniqueItems: true
      }),
      character_ids: Type.Array(entityReferenceParameter("character"), {
        maxItems: 1_024,
        uniqueItems: true
      })
    }),
    strictObject({
      kind: StringEnum(["connection"] as const),
      connection_id: stableIdParameter("connection"),
      note: shortTextParameter
    }),
    strictObject({
      kind: StringEnum(["placement"] as const),
      placement_id: stableIdParameter("placement"),
      writing_prompt: shortTextParameter
    })
  ]),
  allow_overwrite_existing: Type.Optional(Type.Boolean()),
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 }))
});

export const LONG_PLOT_EDIT_PARAMETERS = strictObject({
  item: Type.Union([
    strictObject({
      kind: StringEnum(["book_line"] as const),
      replacements: Type.Array(
        strictObject({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }),
        { minItems: 1, maxItems: 20 }
      )
    }),
    strictObject({
      kind: StringEnum(["volume"] as const),
      volume_id: stableIdParameter("volume"),
      patch: patchParameter({ summary: Type.Optional(textParameter) })
    }),
    strictObject({
      kind: StringEnum(["arc"] as const),
      arc_id: stableIdParameter("arc"),
      patch: patchParameter({
        summary: Type.Optional(textParameter),
        outline: Type.Optional(textParameter)
      })
    }),
    strictObject({
      kind: StringEnum(["story_plot"] as const),
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
      kind: StringEnum(["chapter"] as const),
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
      kind: StringEnum(["event"] as const),
      event_id: stableIdParameter("event"),
      patch: patchParameter({
        summary: Type.Optional(textParameter),
        time_mode: Type.Optional(storyTimeModeParameter),
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
      })
    }),
    strictObject({
      kind: StringEnum(["connection"] as const),
      connection_id: stableIdParameter("connection"),
      patch: patchParameter({ note: Type.Optional(shortTextParameter) })
    }),
    strictObject({
      kind: StringEnum(["placement"] as const),
      placement_id: stableIdParameter("placement"),
      patch: patchParameter({
        writing_prompt: Type.Optional(shortTextParameter)
      })
    })
  ]),
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 }))
});
