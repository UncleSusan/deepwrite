import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";
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
  LongFileIdSchema,
  LongFileRevisionSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingBeatSchema,
  LongForeshadowingIdSchema,
  LongForeshadowingSchema,
  LongMarkdownFileReferenceSchema,
  LongNarrativePlacementIdSchema,
  LongNarrativePlacementSchema,
  LongProjectRelativePathSchema,
  LongStableIdSchema,
  LongStoryEventIdSchema,
  LongStoryEventSchema,
  LongStoryPlotIdSchema,
  LongStoryPlotSchema,
  LongVolumeIdSchema,
  LongVolumeSchema,
  LongWorldbuildingItemLayoutSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorldbuildingCategoryIdSchema,
  LongWorldbuildingCategorySchema,
  LongWorldbuildingItemIdSchema,
  LongWorldbuildingItemSchema,
  createEmptyLongMarkdownFileReference,
  deriveLongForeshadowingStatusFromCommittedBeats,
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId
} from "../long-workspace";
import type {
  LongForeshadowing,
  LongForeshadowingBeat,
  LongNarrativePlacement,
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "../long-workspace";

import {
  addFileCreateIntent,
  addFileDeleteIntent,
  allWorkspaceFiles,
  assertAnchoredValue,
  assertBeatIsMutable,
  assertChapterIsMutable,
  assertExactOrder,
  assertFrozenOrderPrefix,
  assertNewEntityId,
  assertPlacementIsMutable,
  chapterOrderMap,
  concreteChapterIdForBeat,
  ensureFilesAvailable,
  eventParticipatesInCommittedFacts,
  findBeat,
  findEntityIndex,
  idsByGroupAndOrder,
  insertBeforeId,
  markCreated,
  markDeleted,
  markUpdated,
  normalizeLongWorkspaceOrders,
  operationError,
  orderedIdsByOrder,
  registerProvisionalId,
  retargetBeatPlanningAnchorsToChapter,
  updateOrdersById,
  volumeOrderMap
} from "./state";
import {
  deleteArc,
  deleteChapter,
  deleteCharacter,
  deleteForeshadowingBeat,
  deleteForeshadowingThread,
  deleteNarrativePlacement,
  deleteStoryEvent,
  deleteStoryPlot,
  deleteVolume
} from "./cascade";

export function applyVolumeChapterOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "volume.create": {
      assertNewEntityId(
        workspace.plot.volumes,
        operation.volume.id,
        "Volume"
      );
      workspace.plot.volumes.push(structuredClone(operation.volume));
      markCreated(state, operation.volume.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.volume.id
      );
      break;
    }
    case "volume.update": {
      const volume =
        workspace.plot.volumes[
          findEntityIndex(
            workspace.plot.volumes,
            operation.id,
            "Volume"
          )
        ]!;
      Object.assign(volume, operation.patch);
      markUpdated(state, volume.id);
      break;
    }
    case "volume.delete": {
      deleteVolume(state, operation.id, operation.cascade);
      break;
    }
    case "volume.reorder": {
      assertExactOrder(
        workspace.plot.volumes.map(({ id }) => id),
        operation.orderedIds,
        "Volume"
      );
      updateOrdersById(
        workspace.plot.volumes,
        operation.orderedIds,
        (volume, order) => {
          volume.order = order;
        },
        state
      );
      break;
    }

    case "arc.create": {
      assertNewEntityId(workspace.plot.arcs, operation.arc.id, "Arc");
      workspace.plot.arcs.push(structuredClone(operation.arc));
      markCreated(state, operation.arc.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.arc.id
      );
      break;
    }
    case "arc.update": {
      const arc =
        workspace.plot.arcs[
          findEntityIndex(workspace.plot.arcs, operation.id, "Arc")
        ]!;
      Object.assign(arc, operation.patch);
      markUpdated(state, arc.id);
      break;
    }
    case "arc.delete": {
      deleteArc(state, operation.id, operation.cascade);
      break;
    }
    case "arc.move": {
      findEntityIndex(
        workspace.plot.volumes,
        operation.toVolumeId,
        "Target volume"
      );
      const arc =
        workspace.plot.arcs[
          findEntityIndex(workspace.plot.arcs, operation.id, "Arc")
        ]!;
      const sourceVolumeId = arc.volumeId;
      const linkedChapters = workspace.plot.chapterCards.filter(
        (chapter) => chapter.primaryArcId === arc.id
      );
      if (
        workspace.plot.storyEvents.some(
          (event) =>
            event.arcIds.includes(arc.id) &&
            eventParticipatesInCommittedFacts(workspace, event.id)
        )
      ) {
        operationError(
          "committed_prefix_protected",
          `Cannot move arc ${arc.id}; a committed event references it.`
        );
      }
      arc.volumeId = operation.toVolumeId;
      if (sourceVolumeId !== operation.toVolumeId) {
        linkedChapters.forEach((chapter) => {
          chapter.primaryArcId = null;
          markUpdated(state, chapter.id);
        });
        workspace.plot.foreshadowing.forEach((thread) => {
          thread.beats.forEach((beat) => {
            const followsMovedArc = (beat.arcId ?? null) === arc.id;
            const anchoredEvent =
              beat.eventId === null
                ? undefined
                : workspace.plot.storyEvents.find(
                    (event) => event.id === beat.eventId
                  );
            const followsMovedEvent =
              anchoredEvent?.arcIds.includes(arc.id) === true &&
              beat.volumeId === sourceVolumeId &&
              !anchoredEvent.arcIds.some((eventArcId) => {
                const eventArc = workspace.plot.arcs.find(
                  (candidate) => candidate.id === eventArcId
                );
                return eventArc?.volumeId === sourceVolumeId;
              });
            if (
              (!followsMovedArc && !followsMovedEvent) ||
              (beat.volumeId ?? null) === null
            ) {
              return;
            }
            assertBeatIsMutable(beat, "move with its planning arc");
            const concreteChapterId = concreteChapterIdForBeat(
              workspace,
              beat
            );
            beat.volumeId =
              followsMovedEvent && concreteChapterId !== null
                ? null
                : followsMovedArc && concreteChapterId !== null
                  ? null
                  : operation.toVolumeId;
            markUpdated(state, beat.id);
          });
        });
      }
      const target = workspace.plot.arcs
        .filter(({ volumeId }) => volumeId === operation.toVolumeId)
        .sort((left, right) => left.order - right.order);
      const orderedIds = insertBeforeId(
        target.map(({ id }) => id),
        arc.id,
        operation.beforeArcId,
        "Arc move"
      );
      updateOrdersById(
        target,
        orderedIds,
        (value, order) => {
          value.order = order;
        },
        state
      );
      markUpdated(state, arc.id);
      break;
    }
    case "arc.reorder": {
      const target = workspace.plot.arcs
        .filter(({ volumeId }) => volumeId === operation.volumeId)
        .sort((left, right) => left.order - right.order);
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Arcs in ${operation.volumeId}`
      );
      updateOrdersById(
        target,
        operation.orderedIds,
        (value, order) => {
          value.order = order;
        },
        state
      );
      break;
    }

    case "chapter.create": {
      assertNewEntityId(
        workspace.plot.chapterCards,
        operation.chapterCard.id,
        "Chapter card"
      );
      if (
        operation.files.chapterCardId !== operation.chapterCard.id ||
        operation.files.commitId !== null
      ) {
        operationError(
          "invalid_reference",
          "New chapter files must reference the created uncommitted chapter."
        );
      }
      const files = [
        operation.files.body,
        operation.files.card,
        operation.files.characterState,
        operation.files.handoff,
        operation.files.foreshadowingChanges,
        ...(operation.files.worldReveals
          ? [operation.files.worldReveals]
          : []),
        ...operation.files.characterContinuity.flatMap((character) => [
          character.currentState,
          character.history
        ])
      ];
      ensureFilesAvailable(state, files);
      workspace.plot.chapterCards.push(
        structuredClone(operation.chapterCard)
      );
      workspace.chapters.push(structuredClone(operation.files));
      files.forEach((file) =>
        addFileCreateIntent(
          state,
          file,
          `Create chapter ${operation.chapterCard.id}`
        )
      );
      markCreated(state, operation.chapterCard.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.chapterCard.id
      );
      break;
    }
    case "chapter.update": {
      const chapter =
        workspace.plot.chapterCards[
          findEntityIndex(
            workspace.plot.chapterCards,
            operation.id,
            "Chapter card"
          )
        ]!;
      Object.assign(chapter, operation.patch);
      markUpdated(state, chapter.id);
      break;
    }
    case "chapter.delete": {
      deleteChapter(state, operation.id, operation.cascade);
      break;
    }
    case "chapter.move": {
      assertChapterIsMutable(workspace, operation.id, "move");
      findEntityIndex(
        workspace.plot.volumes,
        operation.toVolumeId,
        "Target volume"
      );
      if (operation.toPrimaryArcId !== null) {
        const targetArc =
          workspace.plot.arcs[
            findEntityIndex(
              workspace.plot.arcs,
              operation.toPrimaryArcId,
              "Target primary arc"
            )
          ]!;
        if (targetArc.volumeId !== operation.toVolumeId) {
          operationError(
            "invalid_reference",
            "Target chapter volume and primary arc must match."
          );
        }
      }
      const chapter =
        workspace.plot.chapterCards[
          findEntityIndex(
            workspace.plot.chapterCards,
            operation.id,
            "Chapter card"
          )
        ]!;
      chapter.volumeId = operation.toVolumeId;
      chapter.primaryArcId = operation.toPrimaryArcId;
      workspace.plot.foreshadowing.forEach((thread) => {
        thread.beats.forEach((beat) => {
          if (concreteChapterIdForBeat(workspace, beat) !== chapter.id) {
            return;
          }
          retargetBeatPlanningAnchorsToChapter(
            state,
            beat,
            chapter,
            "move with its concrete chapter"
          );
        });
      });
      const target = workspace.plot.chapterCards
        .filter(({ volumeId }) => volumeId === operation.toVolumeId)
        .sort(
          (left, right) =>
            left.narrativeOrder - right.narrativeOrder
        );
      const orderedIds = insertBeforeId(
        target.map(({ id }) => id),
        chapter.id,
        operation.beforeChapterCardId,
        "Chapter move"
      );
      updateOrdersById(
        target,
        orderedIds,
        (value, order) => {
          value.narrativeOrder = order;
        },
        state
      );
      markUpdated(state, chapter.id);
      break;
    }
    case "chapter.reorder": {
      const target = workspace.plot.chapterCards
        .filter(({ volumeId }) => volumeId === operation.volumeId)
        .sort(
          (left, right) =>
            left.narrativeOrder - right.narrativeOrder
        );
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Chapters in ${operation.volumeId}`
      );
      updateOrdersById(
        target,
        operation.orderedIds,
        (value, order) => {
          value.narrativeOrder = order;
        },
        state
      );
      break;
    }
    case "chapterContinuity.worldReveals.create": {
      assertChapterIsMutable(
        workspace,
        operation.chapterCardId,
        "create world-reveals continuity for"
      );
      const chapterFiles = workspace.chapters[
        findEntityIndex(
          workspace.chapters.map((entry) => ({
            ...entry,
            id: entry.chapterCardId
          })),
          operation.chapterCardId,
          "Chapter file index"
        )
      ]!;
      if (chapterFiles.worldReveals) {
        operationError(
          "already_exists",
          `Chapter ${operation.chapterCardId} already has a world-reveals file.`
        );
      }
      ensureFilesAvailable(state, [operation.file]);
      chapterFiles.worldReveals = structuredClone(operation.file);
      addFileCreateIntent(
        state,
        operation.file,
        `Create world reveals for chapter ${operation.chapterCardId}`
      );
      break;
    }
    case "chapterContinuity.worldReveals.delete": {
      assertChapterIsMutable(
        workspace,
        operation.chapterCardId,
        "delete world-reveals continuity from"
      );
      const chapterFiles = workspace.chapters[
        findEntityIndex(
          workspace.chapters.map((entry) => ({
            ...entry,
            id: entry.chapterCardId
          })),
          operation.chapterCardId,
          "Chapter file index"
        )
      ]!;
      if (!chapterFiles.worldReveals) {
        operationError(
          "not_found",
          `Chapter ${operation.chapterCardId} does not have a world-reveals file.`
        );
      }
      addFileDeleteIntent(
        state,
        chapterFiles.worldReveals,
        `Delete world reveals from chapter ${operation.chapterCardId}`
      );
      chapterFiles.worldReveals = null;
      break;
    }
    case "chapterContinuity.character.create": {
      assertChapterIsMutable(
        workspace,
        operation.chapterCardId,
        "create character continuity for"
      );
      findEntityIndex(
        workspace.characters,
        operation.characterId,
        "Character"
      );
      const chapterFiles = workspace.chapters[
        findEntityIndex(
          workspace.chapters.map((entry) => ({
            ...entry,
            id: entry.chapterCardId
          })),
          operation.chapterCardId,
          "Chapter file index"
        )
      ]!;
      if (
        chapterFiles.characterContinuity.some(
          ({ characterId }) => characterId === operation.characterId
        )
      ) {
        operationError(
          "already_exists",
          `Chapter ${operation.chapterCardId} already tracks character ${operation.characterId}.`
        );
      }
      const files = [operation.currentState, operation.history];
      ensureFilesAvailable(state, files);
      chapterFiles.characterContinuity.push({
        characterId: operation.characterId,
        currentState: structuredClone(operation.currentState),
        history: structuredClone(operation.history)
      });
      files.forEach((file) =>
        addFileCreateIntent(
          state,
          file,
          `Create character continuity for ${operation.characterId} in chapter ${operation.chapterCardId}`
        )
      );
      break;
    }
    case "chapterContinuity.character.delete": {
      assertChapterIsMutable(
        workspace,
        operation.chapterCardId,
        "delete character continuity from"
      );
      const chapterFiles = workspace.chapters[
        findEntityIndex(
          workspace.chapters.map((entry) => ({
            ...entry,
            id: entry.chapterCardId
          })),
          operation.chapterCardId,
          "Chapter file index"
        )
      ]!;
      const continuityIndex = chapterFiles.characterContinuity.findIndex(
        ({ characterId }) => characterId === operation.characterId
      );
      if (continuityIndex < 0) {
        operationError(
          "not_found",
          `Chapter ${operation.chapterCardId} does not track character ${operation.characterId}.`
        );
      }
      const [continuity] = chapterFiles.characterContinuity.splice(
        continuityIndex,
        1
      );
      [continuity!.currentState, continuity!.history].forEach((file) =>
        addFileDeleteIntent(
          state,
          file,
          `Delete character continuity for ${operation.characterId} from chapter ${operation.chapterCardId}`
        )
      );
      break;
    }
    default:
      break;
  }
}
