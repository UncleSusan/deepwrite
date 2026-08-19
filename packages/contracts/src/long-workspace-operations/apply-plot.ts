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

export function applyPlotOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "event.create": {
      assertNewEntityId(
        workspace.plot.storyEvents,
        operation.event.id,
        "Story event"
      );
      workspace.plot.storyEvents.push(structuredClone(operation.event));
      markCreated(state, operation.event.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.event.id
      );
      break;
    }
    case "event.update": {
      if (eventParticipatesInCommittedFacts(workspace, operation.id)) {
        operationError(
          "committed_prefix_protected",
          `Cannot update committed story event ${operation.id}.`
        );
      }
      const event =
        workspace.plot.storyEvents[
          findEntityIndex(
            workspace.plot.storyEvents,
            operation.id,
            "Story event"
          )
        ]!;
      Object.assign(event, operation.patch);
      if (operation.patch.arcIds !== undefined) {
        const eventVolumeIds = [
          ...new Set(
            event.arcIds
              .map(
                (eventArcId) =>
                  workspace.plot.arcs.find(
                    (candidate) => candidate.id === eventArcId
                  )?.volumeId
              )
              .filter((volumeId): volumeId is string => Boolean(volumeId))
          )
        ];
        workspace.plot.foreshadowing.forEach((thread) => {
          thread.beats.forEach((beat) => {
            if (beat.eventId !== event.id) return;
            const plannedArcId = beat.arcId ?? null;
            const plannedVolumeId = beat.volumeId ?? null;
            const arcNeedsRetarget =
              plannedArcId !== null &&
              !event.arcIds.includes(plannedArcId);
            const volumeNeedsRetarget =
              plannedVolumeId !== null &&
              !eventVolumeIds.includes(plannedVolumeId);
            if (!arcNeedsRetarget && !volumeNeedsRetarget) return;

            assertBeatIsMutable(beat, "retarget with its event");
            const concreteChapterId = concreteChapterIdForBeat(
              workspace,
              beat
            );
            const concreteChapter =
              concreteChapterId === null
                ? undefined
                : workspace.plot.chapterCards.find(
                    (chapter) => chapter.id === concreteChapterId
                  );
            if (arcNeedsRetarget) {
              beat.arcId =
                concreteChapter &&
                concreteChapter.primaryArcId !== null &&
                event.arcIds.includes(concreteChapter.primaryArcId)
                  ? concreteChapter.primaryArcId
                  : !concreteChapter && event.arcIds.length === 1
                    ? event.arcIds[0]!
                    : null;
            }
            if (volumeNeedsRetarget) {
              beat.volumeId =
                concreteChapter &&
                eventVolumeIds.includes(concreteChapter.volumeId)
                  ? concreteChapter.volumeId
                  : !concreteChapter && eventVolumeIds.length === 1
                    ? eventVolumeIds[0]!
                    : null;
            }
            markUpdated(state, beat.id);
          });
        });
      }
      markUpdated(state, event.id);
      break;
    }
    case "event.delete": {
      deleteStoryEvent(state, operation.id, operation.cascade);
      break;
    }
    case "event.reorder": {
      assertExactOrder(
        workspace.plot.storyEvents.map(({ id }) => id),
        operation.orderedIds,
        "Story event"
      );
      const nextOrderById = new Map(
        operation.orderedIds.map((id: string, index: number) => [id, index + 1])
      );
      workspace.plot.storyEvents.forEach((event) => {
        const nextOrder = nextOrderById.get(event.id)!;
        if (
          nextOrder !== event.storyOrder &&
          eventParticipatesInCommittedFacts(workspace, event.id)
        ) {
          operationError(
            "committed_prefix_protected",
            `Cannot reorder committed story event ${event.id}.`
          );
        }
      });
      updateOrdersById(
        workspace.plot.storyEvents,
        operation.orderedIds,
        (event, order) => {
          event.storyOrder = order;
        },
        state
      );
      break;
    }

    case "storyPlot.create": {
      findEntityIndex(
        workspace.plot.arcs,
        operation.storyPlot.arcId,
        "Arc"
      );
      assertNewEntityId(
        workspace.plot.storyPlots,
        operation.storyPlot.id,
        "Story plot"
      );
      ensureFilesAvailable(state, [operation.storyPlot.file]);
      workspace.plot.storyPlots.push(structuredClone(operation.storyPlot));
      addFileCreateIntent(
        state,
        operation.storyPlot.file,
        `Create story plot ${operation.storyPlot.id}`
      );
      markCreated(state, operation.storyPlot.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.storyPlot.id
      );
      break;
    }
    case "storyPlot.update": {
      const storyPlot =
        workspace.plot.storyPlots[
          findEntityIndex(
            workspace.plot.storyPlots,
            operation.id,
            "Story plot"
          )
        ]!;
      Object.assign(storyPlot, operation.patch);
      markUpdated(state, storyPlot.id);
      break;
    }
    case "storyPlot.delete": {
      deleteStoryPlot(state, operation.id);
      break;
    }
    case "storyPlot.reorder": {
      findEntityIndex(workspace.plot.arcs, operation.arcId, "Arc");
      const target = workspace.plot.storyPlots.filter(
        (storyPlot) => storyPlot.arcId === operation.arcId
      );
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Story plots in ${operation.arcId}`
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

    case "connection.create": {
      assertNewEntityId(
        workspace.plot.eventConnections,
        operation.connection.id,
        "Event connection"
      );
      workspace.plot.eventConnections.push(
        structuredClone(operation.connection)
      );
      markCreated(state, operation.connection.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.connection.id
      );
      break;
    }
    case "connection.update": {
      const connection =
        workspace.plot.eventConnections[
          findEntityIndex(
            workspace.plot.eventConnections,
            operation.id,
            "Event connection"
          )
        ]!;
      if (
        eventParticipatesInCommittedFacts(
          workspace,
          connection.sourceEventId
        ) ||
        eventParticipatesInCommittedFacts(
          workspace,
          connection.targetEventId
        )
      ) {
        operationError(
          "committed_prefix_protected",
          `Cannot update connection ${connection.id} between committed events.`
        );
      }
      Object.assign(connection, operation.patch);
      markUpdated(state, connection.id);
      break;
    }
    case "connection.delete": {
      const index = findEntityIndex(
        workspace.plot.eventConnections,
        operation.id,
        "Event connection"
      );
      const connection = workspace.plot.eventConnections[index]!;
      if (
        eventParticipatesInCommittedFacts(
          workspace,
          connection.sourceEventId
        ) ||
        eventParticipatesInCommittedFacts(
          workspace,
          connection.targetEventId
        )
      ) {
        operationError(
          "committed_prefix_protected",
          `Cannot delete connection ${connection.id} between committed events.`
        );
      }
      workspace.plot.eventConnections.splice(index, 1);
      markDeleted(state, connection.id);
      break;
    }

    case "placement.create": {
      assertNewEntityId(
        workspace.plot.narrativePlacements,
        operation.placement.id,
        "Narrative placement"
      );
      if (
        operation.placement.status !== "planned" ||
        operation.placement.commitId !== null
      ) {
        operationError(
          "committed_prefix_protected",
          "New narrative placements must start in planned state."
        );
      }
      workspace.plot.narrativePlacements.push(
        structuredClone(operation.placement)
      );
      markCreated(state, operation.placement.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.placement.id
      );
      break;
    }
    case "placement.update": {
      const placement =
        workspace.plot.narrativePlacements[
          findEntityIndex(
            workspace.plot.narrativePlacements,
            operation.id,
            "Narrative placement"
          )
        ]!;
      assertPlacementIsMutable(placement, "update");
      Object.assign(placement, operation.patch);
      markUpdated(state, placement.id);
      break;
    }
    case "placement.delete": {
      deleteNarrativePlacement(
        state,
        operation.id,
        operation.cascade
      );
      break;
    }
    case "placement.move": {
      const placement =
        workspace.plot.narrativePlacements[
          findEntityIndex(
            workspace.plot.narrativePlacements,
            operation.id,
            "Narrative placement"
          )
        ]!;
      assertPlacementIsMutable(placement, "move");
      assertChapterIsMutable(
        workspace,
        operation.toChapterCardId,
        "receive a moved placement"
      );
      const targetChapter =
        workspace.plot.chapterCards[
          findEntityIndex(
            workspace.plot.chapterCards,
            operation.toChapterCardId,
            "Target chapter"
          )
        ]!;
      placement.chapterCardId = operation.toChapterCardId;
      workspace.plot.foreshadowing.forEach((thread) => {
        thread.beats.forEach((beat) => {
          if (beat.placementId !== placement.id) return;
          if (beat.chapterCardId !== null) {
            assertBeatIsMutable(beat, "move with its placement");
            beat.chapterCardId = operation.toChapterCardId;
            markUpdated(state, beat.id);
          }
          retargetBeatPlanningAnchorsToChapter(
            state,
            beat,
            targetChapter,
            "move with its placement"
          );
        });
      });
      const target = workspace.plot.narrativePlacements
        .filter(
          ({ chapterCardId }) =>
            chapterCardId === operation.toChapterCardId
        )
        .sort(
          (left, right) => left.orderInChapter - right.orderInChapter
        );
      const orderedIds = insertBeforeId(
        target.map(({ id }) => id),
        placement.id,
        operation.beforePlacementId,
        "Placement move"
      );
      updateOrdersById(
        target,
        orderedIds,
        (value, order) => {
          value.orderInChapter = order;
        },
        state
      );
      markUpdated(state, placement.id);
      break;
    }
    case "placement.reorder": {
      const target = workspace.plot.narrativePlacements
        .filter(
          ({ chapterCardId }) =>
            chapterCardId === operation.chapterCardId
        )
        .sort(
          (left, right) => left.orderInChapter - right.orderInChapter
        );
      target.forEach((placement) =>
        assertPlacementIsMutable(placement, "reorder")
      );
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Placements in ${operation.chapterCardId}`
      );
      updateOrdersById(
        target,
        operation.orderedIds,
        (value, order) => {
          value.orderInChapter = order;
        },
        state
      );
      break;
    }
    default:
      break;
  }
}
