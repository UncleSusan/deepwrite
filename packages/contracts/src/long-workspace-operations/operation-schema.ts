import { z } from "zod";
import {
  LongArcIdSchema,
  LongArcSchema,
  LongChapterCardIdSchema,
  LongChapterCardSchema,
  LongChapterCharacterContinuityFileIndexEntrySchema,
  LongChapterFileIndexEntrySchema,
  LongCharacterFileIndexEntrySchema,
  LongCharacterGroupSchema,
  LongCharacterIdSchema,
  LongCharacterSchema,
  LongCharacterTypeIdSchema,
  LongCharacterTypeSchema,
  LongEventConnectionIdSchema,
  LongEventConnectionSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingBeatSchema,
  LongForeshadowingIdSchema,
  LongForeshadowingSchema,
  LongMarkdownFileReferenceSchema,
  LongNarrativePlacementIdSchema,
  LongNarrativePlacementSchema,
  LongStoryEventIdSchema,
  LongStoryEventSchema,
  LongStoryPlotIdSchema,
  LongStoryPlotSchema,
  LongVolumeIdSchema,
  LongVolumeSchema,
  LongWorldbuildingCategoryIdSchema,
  LongWorldbuildingCategorySchema,
  LongWorldbuildingItemIdSchema,
  LongWorldbuildingItemSchema
} from "../long-workspace";

import {
  ArcUpdatePatchSchema,
  ChapterCardUpdatePatchSchema,
  CharacterTypeUpdatePatchSchema,
  CharacterUpdatePatchSchema,
  DeleteControlShape,
  EventConnectionUpdatePatchSchema,
  FeatureSettingsUpdatePatchSchema,
  ForeshadowingBeatUpdatePatchSchema,
  ForeshadowingUpdatePatchSchema,
  NarrativePlacementUpdatePatchSchema,
  OperationTitleSchema,
  OptionalProvisionalIdShape,
  StoryEventUpdatePatchSchema,
  VolumeUpdatePatchSchema,
  WorldbuildingUpdatePatchSchema,
  nonEmptyPatch,
  uniqueIdArray
} from "./schema-helpers";

export {
  LongProvisionalIdSchema,
  type LongProvisionalId
} from "./schema-helpers";

export const LongWorkspaceOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("featureSettings.update"),
      patch: FeatureSettingsUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.create"),
      category: LongWorldbuildingCategorySchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.update"),
      id: LongWorldbuildingCategoryIdSchema,
      patch: WorldbuildingUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.delete"),
      id: LongWorldbuildingCategoryIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.reorder"),
      orderedIds: uniqueIdArray(
        LongWorldbuildingCategoryIdSchema,
        "worldbuilding reorder id"
      )
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.create"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      item: LongWorldbuildingItemSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.update"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      id: LongWorldbuildingItemIdSchema,
      patch: nonEmptyPatch({
        title: OperationTitleSchema.optional()
      })
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.delete"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      id: LongWorldbuildingItemIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.reorder"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      orderedIds: uniqueIdArray(
        LongWorldbuildingItemIdSchema,
        "worldbuilding item reorder id"
      )
    })
    .strict(),

  z
    .object({
      type: z.literal("characterType.create"),
      characterType: LongCharacterTypeSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("characterType.update"),
      id: LongCharacterTypeIdSchema,
      patch: CharacterTypeUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("characterType.delete"),
      id: LongCharacterTypeIdSchema,
      moveCharactersToTypeId: LongCharacterTypeIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("characterType.reorder"),
      orderedIds: uniqueIdArray(
        LongCharacterTypeIdSchema,
        "character type reorder id"
      )
    })
    .strict(),

  z
    .object({
      type: z.literal("character.create"),
      character: LongCharacterSchema,
      files: LongCharacterFileIndexEntrySchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("character.update"),
      id: LongCharacterIdSchema,
      patch: CharacterUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("character.delete"),
      id: LongCharacterIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("character.move"),
      id: LongCharacterIdSchema,
      toGroup: LongCharacterGroupSchema,
      beforeCharacterId: LongCharacterIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("character.reorder"),
      group: LongCharacterGroupSchema,
      orderedIds: uniqueIdArray(LongCharacterIdSchema, "character reorder id")
    })
    .strict(),

  z
    .object({
      type: z.literal("volume.create"),
      volume: LongVolumeSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("volume.update"),
      id: LongVolumeIdSchema,
      patch: VolumeUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("volume.delete"),
      id: LongVolumeIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("volume.reorder"),
      orderedIds: uniqueIdArray(LongVolumeIdSchema, "volume reorder id")
    })
    .strict(),

  z
    .object({
      type: z.literal("arc.create"),
      arc: LongArcSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("arc.update"),
      id: LongArcIdSchema,
      patch: ArcUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("arc.delete"),
      id: LongArcIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("arc.move"),
      id: LongArcIdSchema,
      toVolumeId: LongVolumeIdSchema,
      beforeArcId: LongArcIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("arc.reorder"),
      volumeId: LongVolumeIdSchema,
      orderedIds: uniqueIdArray(LongArcIdSchema, "arc reorder id")
    })
    .strict(),

  z
    .object({
      type: z.literal("chapter.create"),
      chapterCard: LongChapterCardSchema,
      files: LongChapterFileIndexEntrySchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("chapter.update"),
      id: LongChapterCardIdSchema,
      patch: ChapterCardUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("chapter.delete"),
      id: LongChapterCardIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("chapter.move"),
      id: LongChapterCardIdSchema,
      toVolumeId: LongVolumeIdSchema,
      toPrimaryArcId: LongArcIdSchema.nullable(),
      beforeChapterCardId: LongChapterCardIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("chapter.reorder"),
      volumeId: LongVolumeIdSchema,
      orderedIds: uniqueIdArray(LongChapterCardIdSchema, "chapter reorder id")
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.worldReveals.create"),
      chapterCardId: LongChapterCardIdSchema,
      file: LongMarkdownFileReferenceSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.worldReveals.delete"),
      chapterCardId: LongChapterCardIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.character.create"),
      chapterCardId: LongChapterCardIdSchema,
      characterId: LongCharacterIdSchema,
      currentState:
        LongChapterCharacterContinuityFileIndexEntrySchema.shape.currentState,
      history: LongChapterCharacterContinuityFileIndexEntrySchema.shape.history
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.character.delete"),
      chapterCardId: LongChapterCardIdSchema,
      characterId: LongCharacterIdSchema
    })
    .strict(),

  z
    .object({
      type: z.literal("event.create"),
      event: LongStoryEventSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("event.update"),
      id: LongStoryEventIdSchema,
      patch: StoryEventUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("event.delete"),
      id: LongStoryEventIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("event.reorder"),
      orderedIds: uniqueIdArray(LongStoryEventIdSchema, "event reorder id")
    })
    .strict(),

  z
    .object({
      type: z.literal("storyPlot.create"),
      storyPlot: LongStoryPlotSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("storyPlot.update"),
      id: LongStoryPlotIdSchema,
      patch: nonEmptyPatch({
        title: OperationTitleSchema.optional()
      })
    })
    .strict(),
  z
    .object({
      type: z.literal("storyPlot.delete"),
      id: LongStoryPlotIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("storyPlot.reorder"),
      arcId: LongArcIdSchema,
      orderedIds: uniqueIdArray(LongStoryPlotIdSchema, "story-plot reorder id")
    })
    .strict(),

  z
    .object({
      type: z.literal("connection.create"),
      connection: LongEventConnectionSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.update"),
      id: LongEventConnectionIdSchema,
      patch: EventConnectionUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.delete"),
      id: LongEventConnectionIdSchema,
      ...DeleteControlShape
    })
    .strict(),

  z
    .object({
      type: z.literal("placement.create"),
      placement: LongNarrativePlacementSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.update"),
      id: LongNarrativePlacementIdSchema,
      patch: NarrativePlacementUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.delete"),
      id: LongNarrativePlacementIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.move"),
      id: LongNarrativePlacementIdSchema,
      toChapterCardId: LongChapterCardIdSchema,
      beforePlacementId: LongNarrativePlacementIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.reorder"),
      chapterCardId: LongChapterCardIdSchema,
      orderedIds: uniqueIdArray(
        LongNarrativePlacementIdSchema,
        "placement reorder id"
      )
    })
    .strict(),

  z
    .object({
      type: z.literal("foreshadowing.create"),
      thread: LongForeshadowingSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowing.update"),
      id: LongForeshadowingIdSchema,
      patch: ForeshadowingUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowing.delete"),
      id: LongForeshadowingIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowing.reorder"),
      orderedIds: uniqueIdArray(
        LongForeshadowingIdSchema,
        "foreshadowing reorder id"
      )
    })
    .strict(),

  z
    .object({
      type: z.literal("foreshadowingBeat.create"),
      threadId: LongForeshadowingIdSchema,
      beat: LongForeshadowingBeatSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.update"),
      id: LongForeshadowingBeatIdSchema,
      patch: ForeshadowingBeatUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.delete"),
      id: LongForeshadowingBeatIdSchema,
      ...DeleteControlShape
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.move"),
      id: LongForeshadowingBeatIdSchema,
      toThreadId: LongForeshadowingIdSchema,
      beforeBeatId: LongForeshadowingBeatIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.reorder"),
      threadId: LongForeshadowingIdSchema,
      orderedIds: uniqueIdArray(
        LongForeshadowingBeatIdSchema,
        "foreshadowing-beat reorder id"
      )
    })
    .strict()
]);
export type LongWorkspaceOperation = z.infer<
  typeof LongWorkspaceOperationSchema
>;
