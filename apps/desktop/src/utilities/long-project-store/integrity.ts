import {
  LongFileIdSchema,
  LongLedgerCommitRecordSchema,
  LONG_WORKSPACE_INDEX_PATH,
  type LongLedgerCommitRecord,
  type LongProjectManifest,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  assertLongLedgerRecordMatchesIndex,
  assertLongLedgerRecordChain
} from "../long-portable-bundle";
import type { WriteClawLongImportPlan } from "../write-claw-long-import";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { loadIndexedFile } from "./cache";
import { encodeUtf8Strict, parseJson, serializeJson } from "./io";
import {
  indexedFileSlots,
  isCompatibleRolePath,
  portablePathKey
} from "./paths";
import { longRevisionMatchesBytes } from "./revisions";
import {
  LongProjectConflictError,
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MIGRATION_EVIDENCE_WORLD_ID_PREFIX,
  type IndexedFileSlot,
  type LoadedIndexedFile,
  type LoadedLongProject
} from "./types";

export function assertProjectRevisions(
  loaded: LoadedLongProject,
  expectedWorkspaceRevision: number,
  expectedProjectRevision: number
): void {
  if (expectedProjectRevision !== loaded.manifest.revision) {
    throw new LongProjectConflictError(
      "project",
      expectedProjectRevision,
      loaded.manifest.revision
    );
  }
  if (expectedWorkspaceRevision !== loaded.index.revision) {
    throw new LongProjectConflictError(
      "workspace",
      expectedWorkspaceRevision,
      loaded.index.revision
    );
  }
}

export async function assertPinnedSetIntegrity(
  loaded: LoadedLongProject
): Promise<ProjectTransactionFileOperation[]> {
  const checks = new Map<string, ProjectTransactionFileOperation>();
  const addCheck = (file: LoadedIndexedFile): void => {
    checks.set(file.reference.path, {
      action: "check",
      path: file.reference.path,
      expectedSha256: file.disk.sha256
    });
  };
  const records: LongLedgerCommitRecord[] = [];
  for (const entry of loaded.index.ledger.commits) {
    const recordFile = await loadIndexedFile(loaded, entry.recordFile.id);
    if (recordFile.kind !== "json") {
      throw new Error(`连续性账本记录文件类型无效：${entry.id}。`);
    }
    const record = LongLedgerCommitRecordSchema.parse(
      parseJson(recordFile.disk.content, `长篇连续性账本记录 ${entry.id}`)
    );
    assertLongLedgerRecordMatchesIndex(
      loaded.index,
      entry,
      record,
      recordFile.disk.content
    );
    records.push(record);
    addCheck(recordFile);
  }
  assertLongLedgerRecordChain(loaded.index, records);

  for (const chapter of loaded.index.chapters) {
    if (chapter.commitId === null) continue;
    for (const reference of [
      chapter.body,
      chapter.card,
      chapter.characterState,
      chapter.handoff,
      chapter.foreshadowingChanges,
      ...(chapter.worldReveals ? [chapter.worldReveals] : []),
      ...chapter.characterContinuity.flatMap((entry) => [
        entry.currentState,
        entry.history
      ])
    ]) {
      addCheck(await loadIndexedFile(loaded, reference.id));
    }
  }
  if (loaded.index.ledger.commits.some(({ mode }) => mode === "structured")) {
    for (const entry of loaded.index.characterFiles) {
      for (const reference of [entry.relationships]) {
        addCheck(await loadIndexedFile(loaded, reference.id));
      }
    }
  }
  return [...checks.values()];
}

export function mergeIntegrityChecks(
  checks: readonly ProjectTransactionFileOperation[],
  mutatingPaths: ReadonlySet<string>
): ProjectTransactionFileOperation[] {
  const merged = new Map<string, ProjectTransactionFileOperation>();
  for (const check of checks) {
    if (check.action !== "check" || mutatingPaths.has(check.path)) continue;
    const previous = merged.get(check.path);
    if (
      previous?.action === "check" &&
      previous.expectedSha256 !== check.expectedSha256
    ) {
      throw new Error(`长篇锁定文件在事务准备期间发生变化：${check.path}`);
    }
    merged.set(check.path, check);
  }
  return [...merged.values()];
}

export function assertMutableChapterDocument(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): void {
  const committedChapter = index.chapters.find(
    (chapter) =>
      chapter.commitId !== null &&
      (chapter.body.id === fileId ||
        chapter.card.id === fileId ||
        chapter.characterState.id === fileId ||
        chapter.handoff.id === fileId ||
        chapter.foreshadowingChanges.id === fileId ||
        chapter.worldReveals?.id === fileId ||
        chapter.characterContinuity.some(
          (entry) =>
            entry.currentState.id === fileId || entry.history.id === fileId
        ))
  );
  if (committedChapter) {
    if (
      committedChapter.body.id === fileId ||
      committedChapter.card.id === fileId
    ) {
      return;
    }
    throw new Error(
      "已提交章节仅正文和章卡支持精修；连续性资料不可直接编辑，请先回滚最后一次连续性提交。"
    );
  }
}

export function assertDirectlyMutableDocument(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): void {
  if (
    index.worldbuilding.some(
      (category) =>
        category.id.startsWith(MIGRATION_EVIDENCE_WORLD_ID_PREFIX) &&
        (category.format === "text"
          ? category.file.id === fileId
          : category.overview?.id === fileId ||
            category.items.some(({ file }) => file.id === fileId))
    )
  ) {
    throw new Error("只读迁移证据不能修改。");
  }
  assertMutableChapterDocument(index, fileId);
}

export function assertExactDecisionIds(
  label: string,
  expectedIds: readonly string[],
  receivedIds: readonly string[]
): void {
  const expected = new Set(expectedIds);
  const received = new Set(receivedIds);
  if (
    expected.size !== received.size ||
    [...expected].some((id) => !received.has(id))
  ) {
    throw new Error(`${label}决策必须完整覆盖当前章节且不能包含其他章节。`);
  }
}

export function validateImportPlan(
  plan: WriteClawLongImportPlan,
  manifest: LongProjectManifest,
  index: LongWorkspaceIndexSnapshot
): void {
  if (
    manifest.id !== index.bookId ||
    manifest.revision !== index.revision ||
    manifest.updatedAt !== index.updatedAt ||
    manifest.workspaceIndexFile.updatedAt !== index.updatedAt
  ) {
    throw new Error("Write Claw 长篇导入计划的 manifest 与索引不一致。");
  }
  const indexContent = serializeJson(index);
  if (
    !longRevisionMatchesBytes(
      manifest.workspaceIndexFile.revision,
      indexContent
    )
  ) {
    throw new Error("Write Claw 长篇导入计划的索引 revision 无效。");
  }
  if (
    (plan.committedChapterPolicy === "written-uncommitted" &&
      (index.ledger.commits.length !== 0 ||
        index.ledger.committedThroughChapterId !== null ||
        index.chapters.some(({ commitId }) => commitId !== null))) ||
    (plan.committedChapterPolicy === "legacy-checkpoints" &&
      (index.ledger.commits.length === 0 ||
        index.ledger.commits.some(({ reversible }) => reversible)))
  ) {
    throw new Error("Write Claw 导入的迁移检查点策略与账本索引不一致。");
  }

  const slots = indexedFileSlots(index);
  validatePortableAndCanonicalPaths(slots);
  if (slots.some((slot) => slot.reference.path !== slot.expectedPath)) {
    throw new Error("Write Claw 导入计划必须使用稳定 ID 推导的规范文件路径。");
  }
  if (plan.documents.length !== slots.length) {
    throw new Error("Write Claw 导入计划没有完整包含全部索引文档。");
  }
  const slotById = new Map(slots.map((slot) => [slot.reference.id, slot]));
  const seenIds = new Set<string>();
  for (const document of plan.documents) {
    const fileId = LongFileIdSchema.parse(document.fileId);
    const slot = slotById.get(fileId);
    if (!slot || seenIds.has(fileId)) {
      throw new Error(`Write Claw 导入计划包含重复或索引外文件：${fileId}。`);
    }
    seenIds.add(fileId);
    const bytes = encodeUtf8Strict(document.content);
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new Error(`Write Claw 导入文档超过 32 MiB：${document.path}`);
    }
    if (
      document.kind !== slot.kind ||
      document.path !== slot.reference.path ||
      !longRevisionMatchesBytes(document.revision, bytes) ||
      !longRevisionMatchesBytes(slot.reference.revision, bytes)
    ) {
      throw new Error(`Write Claw 导入文档与索引不一致：${fileId}。`);
    }
    if (document.kind === "json") {
      const record = LongLedgerCommitRecordSchema.parse(
        parseJson(document.content, "Write Claw 迁移检查点")
      );
      const entry = index.ledger.commits.find(
        (candidate) => candidate.recordFile.id === fileId
      );
      if (!entry) {
        throw new Error(`Write Claw 迁移检查点没有索引：${fileId}。`);
      }
      assertLongLedgerRecordMatchesIndex(
        index,
        entry,
        record,
        document.content
      );
    }
  }
}

export function validatePortableAndCanonicalPaths(
  slots: IndexedFileSlot[]
): void {
  const keys = new Set<string>([
    portablePathKey(MANIFEST_PATH),
    portablePathKey(LONG_WORKSPACE_INDEX_PATH)
  ]);
  for (const slot of slots) {
    if (!isCompatibleRolePath(slot)) {
      throw new Error(`长篇文件路径不符合其文件角色：${slot.reference.path}`);
    }
    const key = portablePathKey(slot.reference.path);
    if (keys.has(key)) {
      throw new Error(
        `长篇文件路径存在大小写或 Unicode 等价冲突：${slot.reference.path}`
      );
    }
    keys.add(key);
  }
}
