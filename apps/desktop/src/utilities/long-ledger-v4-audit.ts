import { createHash } from "node:crypto";
import type {
  LongLedgerCommitIndexEntry,
  LongLedgerCommitRecord,
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";

export class LongV4LedgerFileAuditError extends Error {
  constructor(
    readonly recordId: string,
    readonly canOverwriteFromCurrent: boolean,
    message: string
  ) {
    super(message);
    this.name = "LongV4LedgerFileAuditError";
  }
}

function revisionMatchesContent(revision: string, content: string): boolean {
  const bytes = Buffer.from(content, "utf8");
  const match = /^(v1|v2):(\d+):([0-9a-f]+)$/u.exec(revision);
  if (!match || Number(match[2]) !== bytes.byteLength) return false;
  const digest = createHash("sha256").update(bytes).digest("hex");
  return match[1] === "v1" ? digest.startsWith(match[3]!) : digest === match[3];
}

function revisionsAuditSameContent(
  auditedRevision: string,
  current: LongWorkspaceFileReference,
  contents: ReadonlyMap<string, string> | undefined
): boolean {
  if (auditedRevision === current.revision) return true;
  const content = contents?.get(current.id);
  return (
    content !== undefined &&
    revisionMatchesContent(auditedRevision, content) &&
    revisionMatchesContent(current.revision, content)
  );
}

/**
 * A v4 record audits the chapter files that existed when that record was
 * created. Optional continuity files added later by older clients are not
 * retroactively part of that historical audit, but every audited file must
 * still resolve to the same stable id and content.
 */
export function assertLongV4LedgerFileAudit(
  index: LongWorkspaceIndexSnapshot,
  entry: LongLedgerCommitIndexEntry,
  record: LongLedgerCommitRecord,
  continuityFileContents?: ReadonlyMap<string, string>
): void {
  if (record.schemaVersion !== 4) return;
  const chapter = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === record.chapterCardId
  );
  if (!chapter) {
    throw new LongV4LedgerFileAuditError(
      record.id,
      false,
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
      return (
        !current ||
        !revisionsAuditSameContent(
          audited.revision,
          current,
          continuityFileContents
        )
      );
    });
  if (invalid) {
    throw new LongV4LedgerFileAuditError(
      record.id,
      true,
      `v4 连续性账本的文件清单与章节索引不一致：${record.id}。`
    );
  }
}
