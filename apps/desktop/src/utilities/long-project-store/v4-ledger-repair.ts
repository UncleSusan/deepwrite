import {
  LONG_WORKSPACE_INDEX_PATH,
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  type LongLedgerCommitRecord,
  type LongWorkspaceFileReference
} from "@deepwrite/contracts";
import { randomHex8 } from "@deepwrite/shared";
import {
  assertLongLedgerRecordChain,
  assertLongLedgerRecordMatchesIndex
} from "../long-portable-bundle";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { loadIndexedFile } from "./cache";
import { commitLongProjectTransaction, parseJson, serializeJson } from "./io";
import { createLongFileRevision } from "./revisions";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type LoadedLongProject
} from "./types";

interface LoadedLedgerRecord {
  record: LongLedgerCommitRecord;
  content: string;
  path: string;
  sha256: string;
}

export interface LongV4LedgerOverwriteResult {
  repairedRecordIds: string[];
  backupPaths: string[];
  workspaceRevision: number;
  projectRevision: number;
}

function currentContinuityReferences(
  loaded: LoadedLongProject,
  chapterCardId: string
): LongWorkspaceFileReference[] {
  const chapter = loaded.index.chapters.find(
    (candidate) => candidate.chapterCardId === chapterCardId
  );
  if (!chapter) {
    throw new Error(`当前索引中不存在账本对应章节：${chapterCardId}。`);
  }
  return [
    chapter.characterState,
    chapter.handoff,
    chapter.foreshadowingChanges,
    ...(chapter.worldReveals ? [chapter.worldReveals] : []),
    ...chapter.characterContinuity.flatMap((continuity) => [
      continuity.currentState,
      continuity.history
    ])
  ];
}

/**
 * Replaces historical v4 file-audit metadata with the chapter files currently
 * referenced by the workspace index. The original JSON records are retained
 * as unindexed recovery copies; chapter content and commit identities are not
 * deleted or rewritten.
 */
export async function overwriteLongV4LedgerAuditsFromCurrent(
  loaded: LoadedLongProject,
  failedRecordId: string,
  timestamp: string
): Promise<LongV4LedgerOverwriteResult> {
  const loadedRecords: LoadedLedgerRecord[] = [];
  for (const entry of loaded.index.ledger.commits) {
    const file = await loadIndexedFile(loaded, entry.recordFile.id);
    if (file.kind !== "json") {
      throw new Error(`连续性账本记录文件类型无效：${entry.id}。`);
    }
    const record = LongLedgerCommitRecordSchema.parse(
      parseJson(file.disk.content, `长篇连续性账本记录 ${entry.id}`)
    );
    assertLongLedgerRecordMatchesIndex(
      loaded.index,
      entry,
      record,
      file.disk.content
    );
    loadedRecords.push({
      record,
      content: file.disk.content,
      path: file.reference.path,
      sha256: file.disk.sha256
    });
  }

  const failedRecord = loadedRecords.find(
    ({ record }) => record.id === failedRecordId
  )?.record;
  if (failedRecord?.schemaVersion !== 4) {
    throw new Error(`没有找到可覆盖的 v4 账本记录：${failedRecordId}。`);
  }

  const auditsByRecordId = new Map<
    string,
    LongLedgerCommitRecord["continuityFiles"]
  >();
  const continuityFileContents = new Map<string, string>();
  const continuityChecks = new Map<string, ProjectTransactionFileOperation>();
  for (const { record } of loadedRecords) {
    if (record.schemaVersion !== 4) continue;
    const files = await Promise.all(
      currentContinuityReferences(loaded, record.chapterCardId).map(
        async (reference) => await loadIndexedFile(loaded, reference.id)
      )
    );
    const audit = files.map((file) => {
      continuityFileContents.set(file.reference.id, file.disk.content);
      continuityChecks.set(file.reference.path, {
        action: "check",
        path: file.reference.path,
        expectedSha256: file.disk.sha256
      });
      return {
        fileId: file.reference.id,
        path: file.reference.path,
        revision: file.disk.revision
      };
    });
    auditsByRecordId.set(record.id, audit);
  }

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse(loaded.index);
  const repairedRecordIds: string[] = [];
  const backupPaths: string[] = [];
  const finalRecords: LongLedgerCommitRecord[] = [];
  const finalRecordContents = new Map<string, string>();
  const recordOperations: ProjectTransactionFileOperation[] = [];

  for (const loadedRecord of loadedRecords) {
    const { record } = loadedRecord;
    if (record.schemaVersion !== 4) {
      finalRecords.push(record);
      finalRecordContents.set(record.id, loadedRecord.content);
      recordOperations.push({
        action: "check",
        path: loadedRecord.path,
        expectedSha256: loadedRecord.sha256
      });
      continue;
    }

    const nextRecord = LongLedgerCommitRecordSchema.parse({
      ...record,
      continuityFiles: auditsByRecordId.get(record.id)
    });
    const nextContent = serializeJson(nextRecord);
    finalRecords.push(nextRecord);
    finalRecordContents.set(record.id, nextContent);
    if (nextContent === loadedRecord.content) {
      recordOperations.push({
        action: "check",
        path: loadedRecord.path,
        expectedSha256: loadedRecord.sha256
      });
      continue;
    }

    const nextEntry = nextIndex.ledger.commits.find(
      (entry) => entry.id === record.id
    );
    if (!nextEntry) {
      throw new Error(`当前索引缺少账本记录：${record.id}。`);
    }
    nextEntry.recordFile.revision = createLongFileRevision(nextContent);
    nextEntry.recordFile.updatedAt = timestamp;
    const backupPath = `long/ledger/recovery/${record.id}.${randomHex8()}.before-current-overwrite.json`;
    repairedRecordIds.push(record.id);
    backupPaths.push(backupPath);
    recordOperations.push(
      {
        path: backupPath,
        content: loadedRecord.content,
        expectedSha256: null
      },
      {
        path: loadedRecord.path,
        content: nextContent,
        expectedSha256: loadedRecord.sha256
      }
    );
  }

  if (!repairedRecordIds.includes(failedRecordId)) {
    throw new Error(`当前文件未能生成 ${failedRecordId} 的新账本清单。`);
  }

  nextIndex.revision = loaded.index.revision + 1;
  nextIndex.updatedAt = timestamp;
  const validatedIndex = LongWorkspaceIndexSnapshotSchema.parse(nextIndex);
  for (const entry of validatedIndex.ledger.commits) {
    const record = finalRecords.find((candidate) => candidate.id === entry.id)!;
    assertLongLedgerRecordMatchesIndex(
      validatedIndex,
      entry,
      record,
      finalRecordContents.get(record.id)
    );
  }
  assertLongLedgerRecordChain(
    validatedIndex,
    finalRecords,
    validatedIndex.revision,
    continuityFileContents
  );

  const indexContent = serializeJson(validatedIndex);
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
  await commitLongProjectTransaction({
    projectRoot: loaded.projectDirectory,
    operations: [
      ...continuityChecks.values(),
      ...recordOperations,
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

  return {
    repairedRecordIds,
    backupPaths,
    workspaceRevision: validatedIndex.revision,
    projectRevision: nextManifest.revision
  };
}
