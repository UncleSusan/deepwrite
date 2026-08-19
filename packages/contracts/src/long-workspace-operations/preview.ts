import { z } from "zod";
import type { LongWorkspaceIndexSnapshot } from "../long-workspace";
import { LongWorkspaceIndexSnapshotSchema } from "../long-workspace";

import { applyLongWorkspaceOperation } from "./dispatch";
import {
  LongWorkspaceImpactPreviewSchema,
  LongWorkspaceImpactSummarySchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationResultSchema,
  type LongDocumentWriteProposal,
  type LongWorkspaceEntityChange,
  type LongWorkspaceEntityKind,
  type LongWorkspaceEntitySnapshot,
  type LongWorkspaceImpactPreview,
  type LongWorkspaceImpactSummary,
  type LongWorkspaceOperationBatchInput,
  type LongWorkspaceOperationResult
} from "./impact-schema";
import type { MutationState } from "./state";
import {
  allWorkspaceFiles,
  assertCommittedFactAnchorsPreserved,
  normalizeLongWorkspaceOrders,
  operationError,
  orderedChapterIds
} from "./state";

export function applyDocumentWriteProposals(
  state: MutationState,
  proposals: readonly LongDocumentWriteProposal[]
): LongDocumentWriteProposal[] {
  const proposalIds = new Set<string>();
  const targetFileIds = new Set<string>();
  const ledgerFileIds = new Set(
    state.draft.ledger.commits.map(({ recordFile }) => recordFile.id)
  );

  for (const proposal of proposals) {
    if (proposalIds.has(proposal.proposalId)) {
      operationError(
        "invalid_document_write",
        `Duplicate document proposal id ${proposal.proposalId}.`
      );
    }
    proposalIds.add(proposal.proposalId);
    if (targetFileIds.has(proposal.fileId)) {
      operationError(
        "invalid_document_write",
        `A batch may propose only one write for file ${proposal.fileId}.`
      );
    }
    targetFileIds.add(proposal.fileId);
    if (ledgerFileIds.has(proposal.fileId)) {
      operationError(
        "committed_prefix_protected",
        `Committed ledger file ${proposal.fileId} cannot be rewritten.`
      );
    }
    const intent = state.fileIntents.get(proposal.fileId);
    if (intent?.action === "delete") {
      operationError(
        "invalid_document_write",
        `Cannot write file ${proposal.fileId} while deleting it.`
      );
    }
    const file = allWorkspaceFiles(state.draft).find(
      (candidate) => candidate.id === proposal.fileId
    );
    if (!file) {
      operationError(
        "invalid_document_write",
        `Document proposal target ${proposal.fileId} does not exist.`
      );
    }

    if (proposal.mode === "create") {
      if (intent?.action !== "create") {
        operationError(
          "invalid_document_write",
          `Create proposal ${proposal.proposalId} must target a newly created file.`
        );
      }
      file.revision = proposal.nextRevision;
      file.updatedAt = proposal.updatedAt;
      intent.file.revision = proposal.nextRevision;
      intent.file.updatedAt = proposal.updatedAt;
      continue;
    }

    if (intent?.action === "create") {
      operationError(
        "invalid_document_write",
        `New file ${proposal.fileId} requires create write mode.`
      );
    }
    if (file.revision !== proposal.expectedRevision) {
      operationError(
        "invalid_document_write",
        `Document proposal ${proposal.proposalId} has a stale expected revision.`
      );
    }
    file.revision = proposal.nextRevision;
    file.updatedAt = proposal.updatedAt;
  }

  return proposals.map((proposal) => structuredClone(proposal));
}

export function impactSummary(
  state: MutationState,
  documentWrites: readonly LongDocumentWriteProposal[]
): LongWorkspaceImpactSummary {
  const fileIntents = [...state.fileIntents.values()];
  return LongWorkspaceImpactSummarySchema.parse({
    createdEntityIds: [...state.createdEntityIds].sort(),
    updatedEntityIds: [...state.updatedEntityIds].sort(),
    deletedEntityIds: [...state.deletedEntityIds].sort(),
    createdFileIds: fileIntents
      .filter(({ action }) => action === "create")
      .map(({ file }) => file.id)
      .sort(),
    deletedFileIds: fileIntents
      .filter(({ action }) => action === "delete")
      .map(({ file }) => file.id)
      .sort(),
    documentWriteProposalIds: documentWrites
      .map(({ proposalId }) => proposalId)
      .sort()
  });
}

interface WorkspaceEntityRecord {
  kind: LongWorkspaceEntityKind;
  id: string;
  value: LongWorkspaceEntitySnapshot;
  serialized: string;
}

export function workspaceEntityRecords(
  snapshot: LongWorkspaceIndexSnapshot
): Map<string, WorkspaceEntityRecord> {
  const records = new Map<string, WorkspaceEntityRecord>();
  const add = (
    kind: LongWorkspaceEntityKind,
    entity: { id: string },
    value: unknown = entity
  ): void => {
    const serialized = JSON.stringify(value);
    records.set(entity.id, {
      kind,
      id: entity.id,
      value: JSON.parse(serialized) as LongWorkspaceEntitySnapshot,
      serialized
    });
  };
  snapshot.worldbuilding.forEach((entity) =>
    add("worldbuilding-category", entity)
  );
  snapshot.worldbuilding.forEach((category) => {
    if (category.format === "list") {
      category.items.forEach((item) => add("worldbuilding-item", item));
    }
  });
  snapshot.characters.forEach((entity) => add("character", entity));
  snapshot.plot.volumes.forEach((entity) => add("volume", entity));
  snapshot.plot.arcs.forEach((entity) => add("arc", entity));
  snapshot.plot.chapterCards.forEach((entity) => add("chapter-card", entity));
  snapshot.plot.storyEvents.forEach((entity) => add("story-event", entity));
  snapshot.plot.storyPlots.forEach((entity) => add("story-plot", entity));
  snapshot.plot.eventConnections.forEach((entity) =>
    add("event-connection", entity)
  );
  snapshot.plot.narrativePlacements.forEach((entity) =>
    add("narrative-placement", entity)
  );
  snapshot.plot.foreshadowing.forEach((thread) => {
    add("foreshadowing-thread", thread, {
      ...thread,
      beats: thread.beats.map(({ id }) => id)
    });
    thread.beats.forEach((beat) => add("foreshadowing-beat", beat));
  });
  return records;
}

export function workspaceEntityChanges(
  before: LongWorkspaceIndexSnapshot,
  after: LongWorkspaceIndexSnapshot
): LongWorkspaceEntityChange[] {
  const beforeRecords = workspaceEntityRecords(before);
  const afterRecords = workspaceEntityRecords(after);
  const ids = new Set([...beforeRecords.keys(), ...afterRecords.keys()]);
  const changes: LongWorkspaceEntityChange[] = [];
  for (const id of ids) {
    const previous = beforeRecords.get(id);
    const next = afterRecords.get(id);
    if (!previous && next) {
      changes.push({
        kind: next.kind,
        id: next.id,
        action: "create",
        before: null,
        after: next.value
      });
    } else if (previous && !next) {
      changes.push({
        kind: previous.kind,
        id: previous.id,
        action: "delete",
        before: previous.value,
        after: null
      });
    } else if (previous && next && previous.serialized !== next.serialized) {
      if (previous.kind !== next.kind) {
        operationError(
          "invalid_result",
          `Entity ${id} changed kind from ${previous.kind} to ${next.kind}.`
        );
      }
      changes.push({
        kind: previous.kind,
        id: previous.id,
        action: "update",
        before: previous.value,
        after: next.value
      });
    }
  }
  return changes.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  );
}

/**
 * Normalization can renumber siblings after a delete, move or insert. Derive
 * the final entity impact from the authoritative before/after snapshots so
 * the approval preview includes every implicit order change and omits
 * no-op updates that a mutation handler happened to mark manually.
 */
export function reconcileEntityImpact(state: MutationState): void {
  const before = workspaceEntityRecords(state.original);
  const after = workspaceEntityRecords(state.draft);
  state.createdEntityIds = new Set(
    [...after.keys()].filter((id) => !before.has(id))
  );
  state.deletedEntityIds = new Set(
    [...before.keys()].filter((id) => !after.has(id))
  );
  state.updatedEntityIds = new Set(
    [...after.entries()]
      .filter(
        ([id, value]) =>
          before.has(id) && before.get(id)?.serialized !== value.serialized
      )
      .map(([id]) => id)
  );
}

export function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`
    )
    .join("; ");
}

export function simulateLongWorkspaceOperations(
  snapshotInput: LongWorkspaceIndexSnapshot,
  batchInput: LongWorkspaceOperationBatchInput
): LongWorkspaceOperationResult {
  const original = LongWorkspaceIndexSnapshotSchema.parse(snapshotInput);
  const batch = LongWorkspaceOperationBatchSchema.parse(batchInput);
  if (batch.baseRevision !== original.revision) {
    operationError(
      "revision_conflict",
      `Expected long workspace revision ${original.revision}, received ${batch.baseRevision}.`
    );
  }

  const state: MutationState = {
    original: structuredClone(original),
    draft: structuredClone(original),
    createdEntityIds: new Set(),
    updatedEntityIds: new Set(),
    deletedEntityIds: new Set(),
    fileIntents: new Map(),
    provisionalIdMap: {}
  };
  normalizeLongWorkspaceOrders(state.draft);

  for (const operation of batch.operations) {
    applyLongWorkspaceOperation(state, operation);
    normalizeLongWorkspaceOrders(state.draft);
  }

  const documentWrites = applyDocumentWriteProposals(
    state,
    batch.documentWrites
  );
  normalizeLongWorkspaceOrders(state.draft);
  assertCommittedFactAnchorsPreserved(state);
  const recordedChapterIds = new Set(
    state.draft.ledger.commits.map(({ chapterCardId }) => chapterCardId)
  );
  state.draft.ledger.committedThroughChapterId = null;
  for (const chapterCardId of orderedChapterIds(state.draft)) {
    if (!recordedChapterIds.has(chapterCardId)) break;
    state.draft.ledger.committedThroughChapterId = chapterCardId;
  }
  state.draft.revision = original.revision + 1;
  state.draft.updatedAt = batch.updatedAt;

  const parsedSnapshot = LongWorkspaceIndexSnapshotSchema.safeParse(
    state.draft
  );
  if (!parsedSnapshot.success) {
    operationError(
      "invalid_result",
      `Long workspace operations produced an invalid index: ${formatSchemaIssues(parsedSnapshot.error)}`
    );
  }
  state.draft = parsedSnapshot.data;
  reconcileEntityImpact(state);
  const entityChanges = workspaceEntityChanges(
    state.original,
    parsedSnapshot.data
  );

  const fileIntents = [...state.fileIntents.values()].sort((left, right) =>
    left.file.id.localeCompare(right.file.id)
  );
  return LongWorkspaceOperationResultSchema.parse({
    baseRevision: original.revision,
    resultRevision: parsedSnapshot.data.revision,
    impact: impactSummary(state, documentWrites),
    entityChanges,
    fileIntents,
    documentWrites,
    provisionalIdMap: state.provisionalIdMap,
    snapshot: parsedSnapshot.data
  });
}

export function impactSummariesMatch(
  expected: LongWorkspaceImpactSummary,
  actual: LongWorkspaceImpactSummary
): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/**
 * Computes a deterministic structure/file-impact preview without mutating the
 * caller's snapshot or writing any files.
 */
export function previewLongWorkspaceOperations(
  snapshot: LongWorkspaceIndexSnapshot,
  batch: LongWorkspaceOperationBatchInput
): LongWorkspaceImpactPreview {
  const result = simulateLongWorkspaceOperations(snapshot, batch);
  return LongWorkspaceImpactPreviewSchema.parse({
    baseRevision: result.baseRevision,
    resultRevision: result.resultRevision,
    impact: result.impact,
    entityChanges: result.entityChanges,
    fileIntents: result.fileIntents,
    documentWrites: result.documentWrites,
    provisionalIdMap: result.provisionalIdMap
  });
}

/**
 * Applies a long-form structure batch to an in-memory clone. Cascading
 * deletion requires a caller-supplied exact impact summary produced by the
 * preview function. The returned file intents and document proposals still
 * require an external transactional executor; this function never writes disk.
 */
export function applyLongWorkspaceOperations(
  snapshot: LongWorkspaceIndexSnapshot,
  batchInput: LongWorkspaceOperationBatchInput
): LongWorkspaceOperationResult {
  const batch = LongWorkspaceOperationBatchSchema.parse(batchInput);
  const result = simulateLongWorkspaceOperations(snapshot, batch);
  const cascadeRequested = batch.operations.some(
    (operation) => "cascade" in operation && operation.cascade
  );
  if (cascadeRequested && batch.expectedImpact === undefined) {
    operationError(
      "cascade_impact_mismatch",
      "Cascading operations require an exact expectedImpact from preview."
    );
  }
  if (
    batch.expectedImpact !== undefined &&
    !impactSummariesMatch(batch.expectedImpact, result.impact)
  ) {
    operationError(
      "cascade_impact_mismatch",
      "Operation impact no longer matches the caller-approved preview."
    );
  }
  return result;
}
