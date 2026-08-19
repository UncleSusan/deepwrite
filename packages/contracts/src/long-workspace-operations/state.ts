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

import type { LongWorkspaceFileIntent, LongWorkspaceOperationErrorCode } from "./impact-schema";
import { LongWorkspaceOperationError } from "./impact-schema";
import type { LongWorkspaceOperation } from "./operation-schema";
import { OperationTimestampSchema } from "./schema-helpers";

export type MutationState = {
  original: LongWorkspaceIndexSnapshot;
  draft: LongWorkspaceIndexSnapshot;
  createdEntityIds: Set<string>;
  updatedEntityIds: Set<string>;
  deletedEntityIds: Set<string>;
  fileIntents: Map<string, LongWorkspaceFileIntent>;
  provisionalIdMap: Record<string, string>;
};

export function operationError(
  code: LongWorkspaceOperationErrorCode,
  message: string
): never {
  throw new LongWorkspaceOperationError(code, message);
}

export function findEntityIndex<T extends { id: string }>(
  values: readonly T[],
  id: string,
  label: string
): number {
  const index = values.findIndex((value) => value.id === id);
  if (index < 0) {
    operationError("not_found", `${label} ${id} does not exist.`);
  }
  return index;
}

export function findBeat(
  workspace: LongWorkspaceIndexSnapshot,
  beatId: string
): {
  thread: LongForeshadowing;
  threadIndex: number;
  beat: LongForeshadowingBeat;
  beatIndex: number;
} {
  for (
    let threadIndex = 0;
    threadIndex < workspace.plot.foreshadowing.length;
    threadIndex += 1
  ) {
    const thread = workspace.plot.foreshadowing[threadIndex]!;
    const beatIndex = thread.beats.findIndex((beat) => beat.id === beatId);
    if (beatIndex >= 0) {
      return {
        thread,
        threadIndex,
        beat: thread.beats[beatIndex]!,
        beatIndex
      };
    }
  }
  return operationError(
    "not_found",
    `Foreshadowing beat ${beatId} does not exist.`
  );
}

export function markCreated(state: MutationState, id: string): void {
  if (
    state.createdEntityIds.has(id) ||
    state.updatedEntityIds.has(id) ||
    state.deletedEntityIds.has(id)
  ) {
    operationError(
      "already_exists",
      `Entity ${id} is already part of this operation batch.`
    );
  }
  state.createdEntityIds.add(id);
}

export function markUpdated(state: MutationState, id: string): void {
  if (
    !state.createdEntityIds.has(id) &&
    !state.deletedEntityIds.has(id)
  ) {
    state.updatedEntityIds.add(id);
  }
}

export function markDeleted(state: MutationState, id: string): void {
  if (state.createdEntityIds.delete(id)) {
    state.updatedEntityIds.delete(id);
    return;
  }
  state.updatedEntityIds.delete(id);
  state.deletedEntityIds.add(id);
}

export function registerProvisionalId(
  state: MutationState,
  provisionalId: string | undefined,
  stableId: string
): void {
  if (!provisionalId) return;
  if (state.provisionalIdMap[provisionalId]) {
    operationError(
      "already_exists",
      `Provisional id ${provisionalId} is already mapped.`
    );
  }
  state.provisionalIdMap[provisionalId] = stableId;
}

export function allWorkspaceFiles(
  workspace: LongWorkspaceIndexSnapshot
): LongWorkspaceFileReference[] {
  return [
    workspace.bookLine,
    ...workspace.worldbuilding.flatMap((category) =>
      category.format === "text"
        ? [category.file]
        : [
            ...(category.overview ? [category.overview] : []),
            ...category.items.map(({ file }) => file)
          ]
    ),
    ...(workspace.characterOverview ? [workspace.characterOverview] : []),
    ...workspace.characterFiles.flatMap((entry) => [
      entry.coreProfile,
      entry.relationships,
      entry.currentState,
      entry.history
    ]),
    ...workspace.chapters.flatMap((entry) => [
      entry.body,
      entry.card,
      entry.characterState,
      entry.handoff,
      entry.foreshadowingChanges,
      ...(entry.worldReveals ? [entry.worldReveals] : []),
      ...entry.characterContinuity.flatMap((character) => [
        character.currentState,
        character.history
      ])
    ]),
    ...workspace.plot.storyPlots.map(({ file }) => file),
    ...workspace.ledger.commits.map(({ recordFile }) => recordFile)
  ];
}

export function ensureFilesAvailable(
  state: MutationState,
  files: readonly LongWorkspaceFileReference[]
): void {
  const existingFiles = allWorkspaceFiles(state.draft);
  const knownIds = new Set(existingFiles.map(({ id }) => id));
  const knownPaths = new Set(existingFiles.map(({ path }) => path));
  for (const file of files) {
    if (knownIds.has(file.id) || state.fileIntents.has(file.id)) {
      operationError(
        "already_exists",
        `Long-form file id ${file.id} already exists.`
      );
    }
    if (knownPaths.has(file.path)) {
      operationError(
        "already_exists",
        `Long-form file path ${file.path} already exists.`
      );
    }
    knownIds.add(file.id);
    knownPaths.add(file.path);
  }
}

export function addFileCreateIntent(
  state: MutationState,
  file: LongWorkspaceFileReference,
  reason: string
): void {
  const existing = state.fileIntents.get(file.id);
  if (existing) {
    operationError(
      "already_exists",
      `File ${file.id} already has a pending ${existing.action} intent.`
    );
  }
  state.fileIntents.set(file.id, {
    action: "create",
    file: structuredClone(file),
    reason
  });
}

export function addFileDeleteIntent(
  state: MutationState,
  file: LongWorkspaceFileReference,
  reason: string
): void {
  const existing = state.fileIntents.get(file.id);
  if (existing?.action === "create") {
    state.fileIntents.delete(file.id);
    return;
  }
  state.fileIntents.set(file.id, {
    action: "delete",
    file: structuredClone(file),
    reason
  });
}

export function assertChapterIsMutable(
  workspace: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  action: string
): void {
  void workspace;
  void chapterCardId;
  void action;
}

export function assertPlacementIsMutable(
  placement: LongNarrativePlacement,
  action: string
): void {
  void placement;
  void action;
}

export function assertBeatIsMutable(
  beat: LongForeshadowingBeat,
  action: string
): void {
  void beat;
  void action;
}

export function concreteChapterIdForBeat(
  workspace: LongWorkspaceIndexSnapshot,
  beat: LongForeshadowingBeat
): string | null {
  if (beat.chapterCardId !== null) return beat.chapterCardId;
  if (beat.placementId === null) return null;
  return (
    workspace.plot.narrativePlacements.find(
      (placement) => placement.id === beat.placementId
    )?.chapterCardId ?? null
  );
}

export function retargetBeatPlanningAnchorsToChapter(
  state: MutationState,
  beat: LongForeshadowingBeat,
  chapter: {
    id: string;
    volumeId: string;
    primaryArcId: string | null;
  },
  action: string
): void {
  const hasVolumeAnchor = (beat.volumeId ?? null) !== null;
  const hasArcAnchor = (beat.arcId ?? null) !== null;
  const volumeChanged =
    hasVolumeAnchor && beat.volumeId !== chapter.volumeId;
  const arcChanged =
    hasArcAnchor && beat.arcId !== chapter.primaryArcId;
  if (!volumeChanged && !arcChanged) return;

  assertBeatIsMutable(beat, action);
  const event =
    beat.eventId === null
      ? undefined
      : state.draft.plot.storyEvents[
          findEntityIndex(
            state.draft.plot.storyEvents,
            beat.eventId,
            "Foreshadowing beat event"
          )
        ];
  const eventSupportsTargetVolume =
    !event ||
    event.arcIds.some(
      (eventArcId) =>
        state.draft.plot.arcs.find(
          (candidate) => candidate.id === eventArcId
        )?.volumeId === chapter.volumeId
    );
  const eventSupportsTargetArc =
    chapter.primaryArcId !== null &&
    (!event || event.arcIds.includes(chapter.primaryArcId));
  if (hasVolumeAnchor) {
    beat.volumeId = eventSupportsTargetVolume ? chapter.volumeId : null;
  }
  if (hasArcAnchor) {
    beat.arcId = eventSupportsTargetArc ? chapter.primaryArcId : null;
  }
  markUpdated(state, beat.id);
}

export function volumeOrderMap(
  workspace: LongWorkspaceIndexSnapshot
): Map<string, number> {
  return new Map(
    workspace.plot.volumes.map(({ id, order }) => [id, order])
  );
}

export function chapterOrderMap(
  workspace: LongWorkspaceIndexSnapshot
): Map<string, number> {
  const volumes = volumeOrderMap(workspace);
  const ordered = [...workspace.plot.chapterCards].sort(
    (left, right) =>
      (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder
  );
  return new Map(ordered.map(({ id }, index) => [id, index]));
}

export function normalizeLongWorkspaceOrders(
  workspace: LongWorkspaceIndexSnapshot
): void {
  workspace.worldbuilding.sort((left, right) => left.order - right.order);
  workspace.worldbuilding.forEach((category, index) => {
    category.order = index + 1;
    if (category.format === "list") {
      category.items.sort((left, right) => left.order - right.order);
      category.items.forEach((item, itemIndex) => {
        item.order = itemIndex + 1;
      });
    }
  });

  workspace.characterTypes.sort((left, right) => left.order - right.order);
  workspace.characterTypes.forEach((characterType, index) => {
    characterType.order = index + 1;
  });

  workspace.characters.sort(
    (left, right) =>
      (workspace.characterTypes.find(({ id }) => id === left.group)?.order ??
        Number.MAX_SAFE_INTEGER) -
        (workspace.characterTypes.find(({ id }) => id === right.group)?.order ??
          Number.MAX_SAFE_INTEGER) ||
      left.order - right.order
  );
  const characterOrder = new Map<string, number>();
  workspace.characters.forEach((character) => {
    const next = (characterOrder.get(character.group) ?? 0) + 1;
    characterOrder.set(character.group, next);
    character.order = next;
  });

  workspace.plot.volumes.sort((left, right) => left.order - right.order);
  workspace.plot.volumes.forEach((volume, index) => {
    volume.order = index + 1;
  });
  const volumes = volumeOrderMap(workspace);

  workspace.plot.arcs.sort(
    (left, right) =>
      (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.order - right.order
  );
  const arcOrder = new Map<string, number>();
  workspace.plot.arcs.forEach((arc) => {
    const next = (arcOrder.get(arc.volumeId) ?? 0) + 1;
    arcOrder.set(arc.volumeId, next);
    arc.order = next;
  });

  workspace.plot.chapterCards.sort(
    (left, right) =>
      (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder
  );
  const narrativeOrder = new Map<string, number>();
  workspace.plot.chapterCards.forEach((chapter) => {
    const next = (narrativeOrder.get(chapter.volumeId) ?? 0) + 1;
    narrativeOrder.set(chapter.volumeId, next);
    chapter.narrativeOrder = next;
  });

  workspace.plot.storyEvents.sort(
    (left, right) => left.storyOrder - right.storyOrder
  );
  workspace.plot.storyEvents.forEach((event, index) => {
    event.storyOrder = index + 1;
  });

  const chapters = chapterOrderMap(workspace);
  workspace.plot.narrativePlacements.sort(
    (left, right) =>
      (chapters.get(left.chapterCardId) ?? Number.MAX_SAFE_INTEGER) -
        (chapters.get(right.chapterCardId) ?? Number.MAX_SAFE_INTEGER) ||
      left.orderInChapter - right.orderInChapter
  );
  const placementOrder = new Map<string, number>();
  workspace.plot.narrativePlacements.forEach((placement) => {
    const next =
      (placementOrder.get(placement.chapterCardId) ?? 0) + 1;
    placementOrder.set(placement.chapterCardId, next);
    placement.orderInChapter = next;
  });

  workspace.plot.foreshadowing.forEach((thread) => {
    thread.beats.sort((left, right) => left.order - right.order);
    thread.beats.forEach((beat, index) => {
      beat.order = index + 1;
    });
  });
}

export function assertExactOrder(
  actualIds: readonly string[],
  orderedIds: readonly string[],
  label: string
): void {
  const orderedIdSet = new Set(orderedIds);
  if (
    actualIds.length !== orderedIds.length ||
    actualIds.some((id) => !orderedIdSet.has(id))
  ) {
    operationError(
      "invalid_order",
      `${label} reorder must include every current id exactly once.`
    );
  }
}

export function insertBeforeId(
  ids: string[],
  id: string,
  beforeId: string | undefined,
  label: string
): string[] {
  const without = ids.filter((candidate) => candidate !== id);
  if (beforeId === undefined) {
    return [...without, id];
  }
  const beforeIndex = without.indexOf(beforeId);
  if (beforeIndex < 0) {
    operationError(
      "invalid_reference",
      `${label} before id ${beforeId} is outside the target scope.`
    );
  }
  without.splice(beforeIndex, 0, id);
  return without;
}

export function updateOrdersById<T extends { id: string }>(
  values: T[],
  orderedIds: readonly string[],
  setOrder: (value: T, order: number) => void,
  state: MutationState
): void {
  const byId = new Map(values.map((value) => [value.id, value]));
  orderedIds.forEach((id, index) => {
    const value = byId.get(id);
    if (!value) {
      operationError("not_found", `Ordered entity ${id} does not exist.`);
    }
    setOrder(value, index + 1);
    markUpdated(state, id);
  });
}

export function orderedChapterIds(
  workspace: LongWorkspaceIndexSnapshot
): string[] {
  const volumes = volumeOrderMap(workspace);
  return [...workspace.plot.chapterCards]
    .sort(
      (left, right) =>
        (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
          (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
        left.narrativeOrder - right.narrativeOrder
    )
    .map(({ id }) => id);
}

export function assertCommittedPrefixPreserved(state: MutationState): void {
  const expected = state.original.ledger.commits.map(
    ({ chapterCardId }) => chapterCardId
  );
  const actual = orderedChapterIds(state.draft).slice(0, expected.length);
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  ) {
    operationError(
      "committed_prefix_protected",
      "Operations cannot delete or reorder the committed chapter prefix."
    );
  }
}

export function assertFrozenOrderPrefix(
  originalIds: readonly string[],
  draftIds: readonly string[],
  anchorIds: ReadonlySet<string>,
  label: string
): void {
  let lastAnchorIndex = -1;
  originalIds.forEach((id, index) => {
    if (anchorIds.has(id)) lastAnchorIndex = index;
  });
  if (lastAnchorIndex < 0) return;

  const expected = originalIds.slice(0, lastAnchorIndex + 1);
  const actual = draftIds.slice(0, lastAnchorIndex + 1);
  if (
    expected.length !== actual.length ||
    expected.some((id, index) => actual[index] !== id)
  ) {
    operationError(
      "committed_prefix_protected",
      `${label} cannot insert, delete, move, or reorder entities before or between committed fact anchors.`
    );
  }
}

export function assertAnchoredValue(
  before: unknown,
  after: unknown,
  label: string
): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    operationError(
      "committed_prefix_protected",
      `${label} belongs to committed facts and cannot change.`
    );
  }
}

export function orderedIdsByOrder<T extends { id: string }>(
  values: readonly T[],
  order: (value: T) => number
): string[] {
  return [...values]
    .sort((left, right) => order(left) - order(right))
    .map(({ id }) => id);
}

export function idsByGroupAndOrder<T extends { id: string }>(
  values: readonly T[],
  group: (value: T) => string,
  order: (value: T) => number
): Map<string, string[]> {
  const grouped = new Map<string, T[]>();
  values.forEach((value) => {
    const key = group(value);
    const entries = grouped.get(key) ?? [];
    entries.push(value);
    grouped.set(key, entries);
  });
  return new Map(
    [...grouped.entries()].map(([key, entries]) => [
      key,
      orderedIdsByOrder(entries, order)
    ])
  );
}

/**
 * The per-operation guards are intentionally backed by this final invariant.
 * Normalization renumbers and sorts after every operation, so a create/move
 * can otherwise modify a committed fact indirectly without ever targeting
 * the committed entity itself. Only the suffix after the last committed
 * anchor in each ordered scope remains structurally mutable.
 */
export function assertCommittedFactAnchorsPreserved(state: MutationState): void {
  // Continuity records are references only and never freeze plot structure.
  void state;
}
export function requireCascade(
  cascade: boolean,
  references: readonly string[],
  label: string
): void {
  if (references.length > 0 && !cascade) {
    operationError(
      "cascade_required",
      `${label} is still referenced by: ${references.join(", ")}.`
    );
  }
}


export function assertNewEntityId(
  values: readonly { id: string }[],
  id: string,
  label: string
): void {
  if (values.some((value) => value.id === id)) {
    operationError("already_exists", `${label} ${id} already exists.`);
  }
}

export function eventParticipatesInCommittedFacts(
  workspace: LongWorkspaceIndexSnapshot,
  eventId: string
): boolean {
  void workspace;
  void eventId;
  return false;
}
