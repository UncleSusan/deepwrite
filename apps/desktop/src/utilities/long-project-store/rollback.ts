import {
  LONG_WORKSPACE_INDEX_PATH,
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongRollbackLastCommitInputSchema,
  LongWorkspaceIndexSnapshotSchema,
  type LongLedgerCommitRecord,
  type LongRollbackLastCommitResult
} from "@deepwrite/contracts";
import { assertLongLedgerRecordMatchesIndex } from "../long-portable-bundle";
import {
  ProjectTransactionConflictError,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import { loadIndexedFile } from "./cache";
import { rollbackLongContinuityProjection } from "./continuity";
import {
  assertPinnedSetIntegrity,
  assertProjectRevisions,
  mergeIntegrityChecks
} from "./integrity";
import {
  commitLongProjectTransaction,
  parseJson,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import {
  createLongFileRevision,
  longRevisionMatchesBytes,
  longRevisionsMatchContent
} from "./revisions";
import type { LongProjectStoreContext } from "./store-context";
import {
  LongProjectConflictError,
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type StoreRollbackLastCommitInput
} from "./types";

export async function rollbackLastCommit(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  rawInput: StoreRollbackLastCommitInput
): Promise<LongRollbackLastCommitResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const input = LongRollbackLastCommitInputSchema.parse({
      ...rawInput,
      bookId: loaded.manifest.id
    });
    assertProjectRevisions(
      loaded,
      input.baseWorkspaceRevision,
      input.baseProjectRevision
    );
    const existingPinnedChecks = await assertPinnedSetIntegrity(loaded);
    const lastCommit = loaded.index.ledger.commits.at(-1);
    if (!lastCommit || lastCommit.id !== input.expectedCommitId) {
      throw new Error("只能回滚当前连续性账本中的最后一次提交。");
    }
    if (!lastCommit.reversible) {
      throw new Error("最后一次连续性提交不可回滚。");
    }
    const recordFile = await loadIndexedFile(loaded, lastCommit.recordFile.id);
    if (recordFile.kind !== "json") {
      throw new Error("连续性账本记录文件类型无效。");
    }
    const record = LongLedgerCommitRecordSchema.parse(
      parseJson(recordFile.disk.content, "长篇连续性账本记录")
    );
    assertLongLedgerRecordMatchesIndex(
      loaded.index,
      lastCommit,
      record,
      recordFile.disk.content
    );
    if (
      record.id !== lastCommit.id ||
      record.bookId !== loaded.manifest.id ||
      record.chapterCardId !== lastCommit.chapterCardId ||
      record.sequence !== lastCommit.sequence ||
      !record.reversible
    ) {
      throw new Error("连续性账本索引与可逆记录不一致。");
    }
    const chapterEntry = loaded.index.chapters.find(
      ({ chapterCardId }) => chapterCardId === lastCommit.chapterCardId
    );
    if (!chapterEntry || chapterEntry.commitId !== record.id) {
      throw new Error("最后提交的章节状态已发生变化，不能安全回滚。");
    }
    let rolledBackProjection = loaded.index.ledger.projection;
    if (record.schemaVersion === 3) {
      let previousV3Record: LongLedgerCommitRecord | null = null;
      for (
        let index = loaded.index.ledger.commits.length - 2;
        index >= 0;
        index -= 1
      ) {
        const previousEntry = loaded.index.ledger.commits[index]!;
        const previousFile = await loadIndexedFile(
          loaded,
          previousEntry.recordFile.id
        );
        const previousRecord = LongLedgerCommitRecordSchema.parse(
          parseJson(
            previousFile.disk.content,
            `长篇连续性账本记录 ${previousEntry.id}`
          )
        );
        if (previousRecord.schemaVersion === 3) {
          previousV3Record = previousRecord;
          break;
        }
      }
      rolledBackProjection = rollbackLongContinuityProjection({
        projection: loaded.index.ledger.projection,
        record,
        previousV3Record
      });
    }
    const newlyUnpinnedChecks: ProjectTransactionFileOperation[] = [];
    for (const reference of [
      chapterEntry.body,
      chapterEntry.card,
      chapterEntry.characterState,
      chapterEntry.handoff,
      chapterEntry.foreshadowingChanges,
      ...(chapterEntry.worldReveals ? [chapterEntry.worldReveals] : []),
      ...chapterEntry.characterContinuity.flatMap((entry) => [
        entry.currentState,
        entry.history
      ])
    ]) {
      const file = await loadIndexedFile(loaded, reference.id);
      newlyUnpinnedChecks.push({
        action: "check",
        path: file.reference.path,
        expectedSha256: file.disk.sha256
      });
    }
    if (
      lastCommit.mode === "structured" &&
      !loaded.index.ledger.commits
        .slice(0, -1)
        .some(({ mode }) => mode === "structured")
    ) {
      const changedFileIds = new Set(
        record.fileChanges.map(({ fileId }) => fileId)
      );
      for (const entry of loaded.index.characterFiles) {
        for (const reference of [
          entry.relationships,
          entry.currentState,
          entry.history
        ]) {
          const file = await loadIndexedFile(loaded, reference.id);
          if (!changedFileIds.has(reference.id)) {
            newlyUnpinnedChecks.push({
              action: "check",
              path: file.reference.path,
              expectedSha256: file.disk.sha256
            });
          }
        }
      }
    }

    const placementById = new Map(
      loaded.index.plot.narrativePlacements.map((placement) => [
        placement.id,
        placement
      ])
    );
    for (const change of record.placementChanges) {
      const placement = placementById.get(change.placementId);
      if (
        !placement ||
        placement.status !== change.after.status ||
        placement.commitId !== change.after.commitId
      ) {
        throw new Error("叙事落点已在提交后发生变化，不能安全回滚。");
      }
      placement.status = change.before.status;
      placement.commitId = change.before.commitId;
    }
    const beatById = new Map(
      loaded.index.plot.foreshadowing.flatMap((thread) =>
        thread.beats.map((beat) => [beat.id, beat] as const)
      )
    );
    for (const change of record.foreshadowingBeatChanges) {
      const beat = beatById.get(change.beatId);
      if (
        !beat ||
        beat.status !== change.after.status ||
        beat.commitId !== change.after.commitId
      ) {
        throw new Error("伏笔节拍已在提交后发生变化，不能安全回滚。");
      }
      beat.status = change.before.status;
      beat.commitId = change.before.commitId;
    }
    const foreshadowingById = new Map(
      loaded.index.plot.foreshadowing.map((thread) => [thread.id, thread])
    );
    for (const change of record.foreshadowingThreadChanges) {
      const thread = foreshadowingById.get(change.foreshadowingId);
      if (!thread || thread.status !== change.after) {
        throw new Error("伏笔线状态已在提交后发生变化，不能安全回滚。");
      }
      thread.status = change.before;
    }

    const timestamp = ctx.timestamp();
    const fileOperations: Array<{
      path: string;
      content: string;
      expectedSha256: string | null;
    }> = [];
    const rollbackContinuityRoles = new Map<
      string,
      {
        path: string;
        role:
          | "relationships"
          | "current-state"
          | "history"
          | "chapter-character-state"
          | "chapter-handoff";
      }
    >();
    for (const entry of loaded.index.characterFiles) {
      rollbackContinuityRoles.set(entry.relationships.id, {
        path: entry.relationships.path,
        role: "relationships"
      });
      rollbackContinuityRoles.set(entry.currentState.id, {
        path: entry.currentState.path,
        role: "current-state"
      });
      rollbackContinuityRoles.set(entry.history.id, {
        path: entry.history.path,
        role: "history"
      });
    }
    if (record.schemaVersion === 3) {
      rollbackContinuityRoles.set(chapterEntry.characterState.id, {
        path: chapterEntry.characterState.path,
        role: "chapter-character-state"
      });
      rollbackContinuityRoles.set(chapterEntry.handoff.id, {
        path: chapterEntry.handoff.path,
        role: "chapter-handoff"
      });
    }
    for (const change of record.fileChanges) {
      const continuityRole = rollbackContinuityRoles.get(change.fileId);
      if (
        !continuityRole ||
        continuityRole.path !== change.path ||
        (continuityRole.role === "history" && change.mode !== "append") ||
        (continuityRole.role !== "history" && change.mode !== "replace")
      ) {
        throw new Error("连续性账本包含越权文件变更，不能安全回滚。");
      }
      if (
        !longRevisionMatchesBytes(
          change.before.revision,
          change.before.content
        ) ||
        !longRevisionMatchesBytes(change.after.revision, change.after.content)
      ) {
        throw new Error("连续性账本文件内容与 revision 不一致。");
      }
      const file = await loadIndexedFile(loaded, change.fileId);
      if (
        file.reference.path !== change.path ||
        !longRevisionsMatchContent(
          file.disk.revision,
          change.after.revision,
          file.disk.bytes
        )
      ) {
        throw new Error("连续性资料已在提交后发生变化，不能安全回滚。");
      }
      file.reference.revision = change.before.revision;
      file.reference.updatedAt = timestamp;
      fileOperations.push({
        path: file.reference.path,
        content: change.before.content,
        expectedSha256: file.disk.sha256
      });
    }

    chapterEntry.commitId = record.previousChapterCommitId;
    loaded.index.ledger.commits.pop();
    loaded.index.ledger.committedThroughChapterId =
      record.previousCommittedThroughChapterId;
    loaded.index.ledger.projection = rolledBackProjection;
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      revision: loaded.index.revision + 1,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      revision: loaded.manifest.revision + 1,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        revision: createLongFileRevision(indexContent),
        updatedAt: timestamp
      }
    });
    const integrityChecks = mergeIntegrityChecks(
      [...existingPinnedChecks, ...newlyUnpinnedChecks],
      new Set([
        ...fileOperations.map(({ path }) => path),
        recordFile.reference.path
      ])
    );
    try {
      await commitLongProjectTransaction({
        projectRoot: loaded.projectDirectory,
        operations: [
          ...integrityChecks,
          ...fileOperations,
          {
            action: "delete",
            path: recordFile.reference.path,
            expectedSha256: recordFile.disk.sha256
          },
          {
            path: LONG_WORKSPACE_INDEX_PATH,
            content: indexContent,
            expectedSha256: loaded.indexDisk.sha256
          },
          {
            path: MANIFEST_PATH,
            content: serializeJson(nextManifest),
            expectedSha256: loaded.manifestDisk.sha256
          }
        ],
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
    } catch (error: unknown) {
      if (error instanceof ProjectTransactionConflictError) {
        throw new LongProjectConflictError(
          "transaction",
          error.expectedSha256 ?? "missing",
          error.actualSha256 ?? "missing"
        );
      }
      throw error;
    }
    const next = await loadProject(ctx, loaded.projectDirectory);
    return {
      bookId: next.manifest.id,
      rolledBackCommitId: record.id,
      committedThroughChapterId: next.index.ledger.committedThroughChapterId,
      workspaceRevision: next.index.revision,
      projectRevision: next.manifest.revision
    };
  });
}
