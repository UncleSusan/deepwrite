import type { MutationState } from "./state";
import {
  addFileDeleteIntent,
  assertBeatIsMutable,
  assertChapterIsMutable,
  assertPlacementIsMutable,
  concreteChapterIdForBeat,
  eventParticipatesInCommittedFacts,
  findBeat,
  findEntityIndex,
  markDeleted,
  markUpdated,
  operationError,
  orderedChapterIds,
  requireCascade
} from "./state";

export function deleteForeshadowingBeat(
  state: MutationState,
  beatId: string
): void {
  const { thread, beat, beatIndex } = findBeat(state.draft, beatId);
  assertBeatIsMutable(beat, "delete");
  thread.beats.splice(beatIndex, 1);
  markDeleted(state, beat.id);
  markUpdated(state, thread.id);
}

export function deleteNarrativePlacement(
  state: MutationState,
  placementId: string,
  cascade: boolean
): void {
  const placementIndex = findEntityIndex(
    state.draft.plot.narrativePlacements,
    placementId,
    "Narrative placement"
  );
  const placement = state.draft.plot.narrativePlacements[placementIndex]!;
  assertPlacementIsMutable(placement, "delete");
  const beatIds = state.draft.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter((beat) => beat.placementId === placementId)
      .map(({ id }) => id)
  );
  requireCascade(cascade, beatIds, `Narrative placement ${placementId}`);
  beatIds.forEach((beatId) => deleteForeshadowingBeat(state, beatId));
  state.draft.plot.narrativePlacements.splice(placementIndex, 1);
  markDeleted(state, placement.id);
}

export function deleteChapter(
  state: MutationState,
  chapterCardId: string,
  cascade: boolean
): void {
  assertChapterIsMutable(state.draft, chapterCardId, "delete");
  const chapterIndex = findEntityIndex(
    state.draft.plot.chapterCards,
    chapterCardId,
    "Chapter card"
  );
  const chapter = state.draft.plot.chapterCards[chapterIndex]!;
  const placementIds = state.draft.plot.narrativePlacements
    .filter((placement) => placement.chapterCardId === chapterCardId)
    .map(({ id }) => id);
  const placementIdSet = new Set(placementIds);
  const directBeatIds = state.draft.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter(
        (beat) =>
          beat.chapterCardId === chapterCardId ||
          (beat.placementId !== null && placementIdSet.has(beat.placementId))
      )
      .map(({ id }) => id)
  );
  requireCascade(
    cascade,
    [...placementIds, ...directBeatIds],
    `Chapter card ${chapterCardId}`
  );

  for (const beatId of new Set(directBeatIds)) {
    deleteForeshadowingBeat(state, beatId);
  }
  for (const placementId of placementIds) {
    deleteNarrativePlacement(state, placementId, true);
  }

  const ledgerRecord = state.draft.ledger.commits.find(
    (commit) => commit.chapterCardId === chapterCardId
  );
  if (ledgerRecord) {
    addFileDeleteIntent(
      state,
      ledgerRecord.recordFile,
      `Delete continuity record for chapter ${chapterCardId}`
    );
    state.draft.ledger.commits = state.draft.ledger.commits.filter(
      ({ id }) => id !== ledgerRecord.id
    );
    state.draft.plot.narrativePlacements.forEach((placement) => {
      if (placement.commitId !== ledgerRecord.id) return;
      placement.commitId = null;
      placement.status = "planned";
    });
    state.draft.plot.foreshadowing.forEach((thread) => {
      thread.beats.forEach((beat) => {
        if (beat.commitId !== ledgerRecord.id) return;
        beat.commitId = null;
        beat.status = "planned";
      });
    });
    state.draft.ledger.projection = {
      throughCommitId: null,
      facts: [],
      knowledge: [],
      openLoops: [],
      latestHandoff: null
    };
  }

  const fileIndex = state.draft.chapters.findIndex(
    (entry) => entry.chapterCardId === chapterCardId
  );
  if (fileIndex < 0) {
    operationError(
      "invalid_result",
      `Chapter ${chapterCardId} is missing its file index.`
    );
  }
  const files = state.draft.chapters[fileIndex]!;
  [
    files.body,
    files.card,
    files.characterState,
    files.handoff,
    files.foreshadowingChanges,
    ...(files.worldReveals ? [files.worldReveals] : []),
    ...files.characterContinuity.flatMap((character) => [
      character.currentState,
      character.history
    ])
  ].forEach((file) =>
    addFileDeleteIntent(state, file, `Delete chapter ${chapterCardId}`)
  );
  state.draft.chapters.splice(fileIndex, 1);
  state.draft.plot.chapterCards.splice(chapterIndex, 1);
  const recordedChapterIds = new Set(
    state.draft.ledger.commits.map(({ chapterCardId }) => chapterCardId)
  );
  state.draft.ledger.committedThroughChapterId = null;
  for (const orderedChapterId of orderedChapterIds(state.draft)) {
    if (!recordedChapterIds.has(orderedChapterId)) break;
    state.draft.ledger.committedThroughChapterId = orderedChapterId;
  }
  markDeleted(state, chapter.id);
}

export function deleteStoryPlot(
  state: MutationState,
  storyPlotId: string
): void {
  const storyPlotIndex = findEntityIndex(
    state.draft.plot.storyPlots,
    storyPlotId,
    "Story plot"
  );
  const storyPlot = state.draft.plot.storyPlots[storyPlotIndex]!;
  addFileDeleteIntent(
    state,
    storyPlot.file,
    `Delete story plot ${storyPlotId}`
  );
  state.draft.plot.storyPlots.splice(storyPlotIndex, 1);
  markDeleted(state, storyPlot.id);
}

export function deleteArc(
  state: MutationState,
  arcId: string,
  cascade: boolean
): void {
  const arcIndex = findEntityIndex(state.draft.plot.arcs, arcId, "Arc");
  const arc = state.draft.plot.arcs[arcIndex]!;
  const eventIds = state.draft.plot.storyEvents
    .filter((event) => event.arcIds.includes(arcId))
    .map(({ id }) => id);
  const storyPlotIds = state.draft.plot.storyPlots
    .filter((storyPlot) => storyPlot.arcId === arcId)
    .map(({ id }) => id);
  const directBeatIds = state.draft.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter((beat) => (beat.arcId ?? null) === arcId)
      .map(({ id }) => id)
  );
  if (
    eventIds.some((eventId) =>
      eventParticipatesInCommittedFacts(state.draft, eventId)
    )
  ) {
    operationError(
      "committed_prefix_protected",
      `Cannot delete arc ${arcId}; a committed event references it.`
    );
  }
  requireCascade(
    cascade,
    [...eventIds, ...storyPlotIds, ...directBeatIds],
    `Arc ${arcId}`
  );
  for (const beatId of new Set(directBeatIds)) {
    const stillExists = state.draft.plot.foreshadowing.some((thread) =>
      thread.beats.some((beat) => beat.id === beatId)
    );
    if (stillExists) deleteForeshadowingBeat(state, beatId);
  }
  state.draft.plot.chapterCards.forEach((chapter) => {
    if (chapter.primaryArcId !== arcId) return;
    chapter.primaryArcId = null;
    markUpdated(state, chapter.id);
  });
  storyPlotIds.forEach((storyPlotId) => deleteStoryPlot(state, storyPlotId));
  state.draft.plot.storyEvents.forEach((event) => {
    if (!event.arcIds.includes(arcId)) return;
    event.arcIds = event.arcIds.filter((candidate) => candidate !== arcId);
    markUpdated(state, event.id);
    const remainingVolumeIds = [
      ...new Set(
        event.arcIds
          .map(
            (eventArcId) =>
              state.draft.plot.arcs.find(
                (candidate) => candidate.id === eventArcId
              )?.volumeId
          )
          .filter((volumeId): volumeId is string => Boolean(volumeId))
      )
    ];
    state.draft.plot.foreshadowing.forEach((thread) => {
      thread.beats.forEach((beat) => {
        const plannedVolumeId = beat.volumeId ?? null;
        if (
          beat.eventId !== event.id ||
          plannedVolumeId === null ||
          remainingVolumeIds.includes(plannedVolumeId)
        ) {
          return;
        }
        assertBeatIsMutable(beat, "retarget after deleting its event arc");
        const concreteChapterId = concreteChapterIdForBeat(state.draft, beat);
        beat.volumeId =
          concreteChapterId === null && remainingVolumeIds.length === 1
            ? remainingVolumeIds[0]!
            : null;
        markUpdated(state, beat.id);
      });
    });
  });
  state.draft.plot.arcs.splice(
    findEntityIndex(state.draft.plot.arcs, arcId, "Arc"),
    1
  );
  markDeleted(state, arc.id);
}

export function deleteVolume(
  state: MutationState,
  volumeId: string,
  cascade: boolean
): void {
  const volumeIndex = findEntityIndex(
    state.draft.plot.volumes,
    volumeId,
    "Volume"
  );
  const volume = state.draft.plot.volumes[volumeIndex]!;
  const chapterIds = state.draft.plot.chapterCards
    .filter((chapter) => chapter.volumeId === volumeId)
    .map(({ id }) => id);
  const arcIds = state.draft.plot.arcs
    .filter((arc) => arc.volumeId === volumeId)
    .map(({ id }) => id);
  const directBeatIds = state.draft.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter((beat) => (beat.volumeId ?? null) === volumeId)
      .map(({ id }) => id)
  );
  requireCascade(
    cascade,
    [...arcIds, ...chapterIds, ...directBeatIds],
    `Volume ${volumeId}`
  );
  for (const beatId of new Set(directBeatIds)) {
    const stillExists = state.draft.plot.foreshadowing.some((thread) =>
      thread.beats.some((beat) => beat.id === beatId)
    );
    if (stillExists) deleteForeshadowingBeat(state, beatId);
  }
  chapterIds.forEach((chapterId) => deleteChapter(state, chapterId, true));
  arcIds.forEach((arcId) => deleteArc(state, arcId, true));
  state.draft.plot.volumes.splice(
    findEntityIndex(state.draft.plot.volumes, volumeId, "Volume"),
    1
  );
  markDeleted(state, volume.id);
}

export function deleteStoryEvent(
  state: MutationState,
  eventId: string,
  cascade: boolean
): void {
  const eventIndex = findEntityIndex(
    state.draft.plot.storyEvents,
    eventId,
    "Story event"
  );
  const event = state.draft.plot.storyEvents[eventIndex]!;
  const connectionIds = state.draft.plot.eventConnections
    .filter(
      (connection) =>
        connection.sourceEventId === eventId ||
        connection.targetEventId === eventId
    )
    .map(({ id }) => id);
  const placementIds = state.draft.plot.narrativePlacements
    .filter((placement) => placement.eventId === eventId)
    .map(({ id }) => id);
  const placementIdSet = new Set(placementIds);
  const beatIds = state.draft.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter(
        (beat) =>
          beat.eventId === eventId ||
          (beat.placementId !== null && placementIdSet.has(beat.placementId))
      )
      .map(({ id }) => id)
  );
  const truthThreadIds = state.draft.plot.foreshadowing
    .filter((thread) => thread.truthEventId === eventId)
    .map(({ id }) => id);
  const committedPlacement = state.draft.plot.narrativePlacements.find(
    (placement) => placement.eventId === eventId && placement.commitId !== null
  );
  const committedBeat = state.draft.plot.foreshadowing
    .flatMap(({ beats }) => beats)
    .find((beat) => beat.eventId === eventId && beat.commitId !== null);
  if (committedPlacement || committedBeat) {
    operationError(
      "committed_prefix_protected",
      `Cannot delete event ${eventId}; it participates in committed facts.`
    );
  }
  requireCascade(
    cascade,
    [...connectionIds, ...placementIds, ...beatIds, ...truthThreadIds],
    `Story event ${eventId}`
  );

  placementIds.forEach((placementId) =>
    deleteNarrativePlacement(state, placementId, true)
  );
  for (const beatId of new Set(beatIds)) {
    const stillExists = state.draft.plot.foreshadowing.some((thread) =>
      thread.beats.some((beat) => beat.id === beatId)
    );
    if (stillExists) deleteForeshadowingBeat(state, beatId);
  }
  connectionIds.forEach((connectionId) => {
    const index = findEntityIndex(
      state.draft.plot.eventConnections,
      connectionId,
      "Event connection"
    );
    state.draft.plot.eventConnections.splice(index, 1);
    markDeleted(state, connectionId);
  });
  state.draft.plot.foreshadowing.forEach((thread) => {
    if (thread.truthEventId !== eventId) return;
    thread.truthEventId = null;
    markUpdated(state, thread.id);
  });
  state.draft.plot.storyEvents.splice(eventIndex, 1);
  markDeleted(state, event.id);
}

export function deleteCharacter(
  state: MutationState,
  characterId: string,
  cascade: boolean
): void {
  const characterIndex = findEntityIndex(
    state.draft.characters,
    characterId,
    "Character"
  );
  const character = state.draft.characters[characterIndex]!;
  const eventRefs = state.draft.plot.storyEvents
    .filter((event) => event.characterIds.includes(characterId))
    .map(({ id }) => id);
  const continuityRefs = state.draft.chapters.flatMap((chapter) =>
    chapter.characterContinuity
      .filter((entry) => entry.characterId === characterId)
      .map((entry) => ({ chapter, entry }))
  );
  requireCascade(
    cascade,
    [
      ...eventRefs,
      ...continuityRefs.map(({ chapter }) => chapter.chapterCardId)
    ],
    `Character ${characterId}`
  );
  state.draft.plot.storyEvents.forEach((event) => {
    if (!event.characterIds.includes(characterId)) return;
    event.characterIds = event.characterIds.filter(
      (candidate) => candidate !== characterId
    );
    markUpdated(state, event.id);
  });
  for (const { chapter, entry } of continuityRefs) {
    [entry.currentState, entry.history].forEach((file) =>
      addFileDeleteIntent(
        state,
        file,
        `Delete uncommitted chapter continuity for character ${characterId}`
      )
    );
    chapter.characterContinuity = chapter.characterContinuity.filter(
      (candidate) => candidate.characterId !== characterId
    );
    markUpdated(state, chapter.chapterCardId);
  }

  const fileIndex = state.draft.characterFiles.findIndex(
    (entry) => entry.characterId === characterId
  );
  if (fileIndex < 0) {
    operationError(
      "invalid_result",
      `Character ${characterId} is missing its file index.`
    );
  }
  const files = state.draft.characterFiles[fileIndex]!;
  [
    files.coreProfile,
    files.relationships,
    files.currentState,
    files.history
  ].forEach((file) =>
    addFileDeleteIntent(state, file, `Delete character ${characterId}`)
  );
  state.draft.characterFiles.splice(fileIndex, 1);
  state.draft.characters.splice(characterIndex, 1);
  markDeleted(state, character.id);
}

export function deleteForeshadowingThread(
  state: MutationState,
  threadId: string,
  cascade: boolean
): void {
  const threadIndex = findEntityIndex(
    state.draft.plot.foreshadowing,
    threadId,
    "Foreshadowing thread"
  );
  const thread = state.draft.plot.foreshadowing[threadIndex]!;
  if (thread.beats.some((beat) => beat.commitId !== null)) {
    operationError(
      "committed_prefix_protected",
      `Cannot delete foreshadowing thread ${threadId} with committed beats.`
    );
  }
  requireCascade(
    cascade,
    thread.beats.map(({ id }) => id),
    `Foreshadowing thread ${threadId}`
  );
  [...thread.beats].forEach((beat) => deleteForeshadowingBeat(state, beat.id));
  state.draft.plot.foreshadowing.splice(threadIndex, 1);
  markDeleted(state, thread.id);
}
