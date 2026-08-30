import type {
  LongLedgerCommitIndexEntry,
  LongLedgerCommitRecord,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";

/**
 * A v4 record keeps the stable identities of the chapter continuity files.
 * Their content remains directly editable and is intentionally not pinned.
 */
export function assertLongV4LedgerFileAudit(
  index: LongWorkspaceIndexSnapshot,
  entry: LongLedgerCommitIndexEntry,
  record: LongLedgerCommitRecord,
  _continuityFileContents?: ReadonlyMap<string, string>
): void {
  if (record.schemaVersion !== 4) return;
  const chapter = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === record.chapterCardId
  );
  if (!chapter) {
    throw new Error(
      `v4 连续性账本引用了不存在的章节：${record.chapterCardId}。`
    );
  }

  const currentReferences = [
    chapter.characterState,
    chapter.handoff,
    chapter.foreshadowingChanges,
    ...(chapter.worldReveals ? [chapter.worldReveals] : []),
    ...chapter.characterContinuity.flatMap((continuity) => [
      continuity.currentState,
      continuity.history
    ])
  ];
  const currentById = new Map(
    currentReferences.map((reference) => [reference.id, reference] as const)
  );
  const auditedById = new Map(
    record.continuityFiles.map((file) => [file.fileId, file] as const)
  );
  const requiredFileIds = [
    chapter.characterState.id,
    chapter.handoff.id,
    ...(entry.foreshadowingBeatIds.length > 0
      ? [chapter.foreshadowingChanges.id]
      : [])
  ];
  const invalid =
    auditedById.size !== record.continuityFiles.length ||
    requiredFileIds.some((fileId) => !auditedById.has(fileId)) ||
    record.continuityFiles.some((audited) => {
      const current = currentById.get(audited.fileId);
      return !current || current.path !== audited.path;
    });
  if (invalid) {
    throw new Error(`v4 连续性账本的文件清单与章节索引不一致：${record.id}。`);
  }
}
