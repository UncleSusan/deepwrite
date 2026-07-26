import { createHash } from "node:crypto";
import {
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  type LongLedgerCommitRecord,
  type LongLedgerCommitIndexEntry,
  type LongProjectManifest,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";

export const LONG_PORTABLE_BUNDLE_SCHEMA =
  "deepwrite.long-book.portable" as const;
export const LONG_PORTABLE_BUNDLE_SCHEMA_VERSION = 1 as const;

/**
 * Portable JSON is currently parsed/stringified in memory. Keep the hard
 * ceiling well below the former 512 MiB value so raw UTF-8, decoded strings
 * and the serialized result cannot combine into a multi-gigabyte peak.
 */
export const LONG_PORTABLE_BUNDLE_MAX_BYTES = 64 * 1024 * 1024;
const LONG_PORTABLE_BUNDLE_MAX_LABEL = "64 MB";
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_LEDGER_RECORD_BYTES = 128 * 1024 * 1024;

export interface LongPortableBundleJsonEntry<T> {
  mediaType: "application/json";
  sha256: string;
  value: T;
}

export interface LongPortableBundleFile {
  id: string;
  path: string;
  kind: "markdown" | "ledger-record";
  revision: string;
  sha256: string;
  content: string;
}

export interface LongPortableExportBundle {
  schema: typeof LONG_PORTABLE_BUNDLE_SCHEMA;
  schemaVersion: typeof LONG_PORTABLE_BUNDLE_SCHEMA_VERSION;
  exportedAt: string;
  bookId: string;
  manifest: LongPortableBundleJsonEntry<LongProjectManifest>;
  index: LongPortableBundleJsonEntry<LongWorkspaceIndexSnapshot>;
  files: LongPortableBundleFile[];
}

export interface BuildLongPortableExportBundleInput {
  manifest: LongProjectManifest;
  index: LongWorkspaceIndexSnapshot;
  exportedAt?: string;
  readFile: (
    reference: LongWorkspaceFileReference
  ) => string | Promise<string>;
}

interface IndexedPortableFile {
  reference: LongWorkspaceFileReference;
  kind: LongPortableBundleFile["kind"];
  commitId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function revisionMatchesContent(revision: string, content: string): boolean {
  const bytes = Buffer.from(content, "utf8");
  const match = /^(v1|v2):(\d+):([0-9a-f]+)$/u.exec(revision);
  if (!match || Number(match[2]) !== bytes.byteLength) return false;
  const digest = sha256(bytes);
  return match[1] === "v1"
    ? digest.startsWith(match[3]!)
    : digest === match[3];
}

function normalizedTimestamp(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.valueOf())) {
    throw new Error("长篇可移植包导出时间不是有效的 ISO 时间。");
  }
  return date.toISOString();
}

function indexedFiles(
  index: LongWorkspaceIndexSnapshot
): IndexedPortableFile[] {
  return [
    { reference: index.bookLine, kind: "markdown" },
    ...index.worldbuilding.map(({ file }) => ({
      reference: file,
      kind: "markdown" as const
    })),
    ...index.characterFiles.flatMap((entry) => [
      { reference: entry.coreProfile, kind: "markdown" as const },
      { reference: entry.relationships, kind: "markdown" as const },
      { reference: entry.currentState, kind: "markdown" as const },
      { reference: entry.history, kind: "markdown" as const }
    ]),
    ...index.chapters.flatMap((entry) => [
      { reference: entry.body, kind: "markdown" as const },
      { reference: entry.characterState, kind: "markdown" as const },
      { reference: entry.handoff, kind: "markdown" as const }
    ]),
    ...index.ledger.commits.map((commit) => ({
      reference: commit.recordFile,
      kind: "ledger-record" as const,
      commitId: commit.id
    }))
  ];
}

function validateManifestIndexPair(
  manifest: LongProjectManifest,
  index: LongWorkspaceIndexSnapshot
): void {
  if (manifest.id !== index.bookId) {
    throw new Error("长篇清单与工作区索引的 bookId 不一致。");
  }
  if (manifest.revision !== index.revision) {
    throw new Error("长篇清单与工作区索引的项目 revision 不一致。");
  }
  if (
    !revisionMatchesContent(
      manifest.workspaceIndexFile.revision,
      serializeJson(index)
    )
  ) {
    throw new Error("长篇清单中的工作区索引 revision 与索引内容不一致。");
  }
}

function validateLedgerRecord(
  content: string,
  expectedBookId: string,
  expectedCommitId: string
): LongLedgerCommitRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`账本记录 ${expectedCommitId} 不是有效 JSON。`);
  }
  const record = LongLedgerCommitRecordSchema.parse(raw);
  if (record.bookId !== expectedBookId || record.id !== expectedCommitId) {
    throw new Error(`账本记录 ${expectedCommitId} 的身份与索引不一致。`);
  }
  return record;
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((id) => right.includes(id))
  );
}

export function assertLongLedgerRecordMatchesIndex(
  index: LongWorkspaceIndexSnapshot,
  entry: LongLedgerCommitIndexEntry,
  record: LongLedgerCommitRecord,
  recordContent?: string
): void {
  const indexedPosition = index.ledger.commits.findIndex(
    (candidate) => candidate.id === entry.id
  );
  const previous = index.ledger.commits[indexedPosition - 1];
  const chapter = index.chapters.find(
    (candidate) => candidate.chapterCardId === entry.chapterCardId
  );
  if (
    indexedPosition < 0 ||
    record.id !== entry.id ||
    record.bookId !== index.bookId ||
    record.sequence !== entry.sequence ||
    record.chapterCardId !== entry.chapterCardId ||
    record.committedAt !== entry.committedAt ||
    record.reversible !== entry.reversible ||
    record.sourceWorkspaceRevision !== entry.sourceRevision ||
    record.committedThroughChapterId !== entry.chapterCardId ||
    record.previousCommittedThroughChapterId !==
      (previous?.chapterCardId ?? null) ||
    chapter?.commitId !== entry.id ||
    !sameIdSet(
      entry.placementIds,
      record.placementChanges.map(({ placementId }) => placementId)
    ) ||
    !sameIdSet(
      entry.foreshadowingBeatIds,
      record.foreshadowingBeatChanges.map(({ beatId }) => beatId)
    ) ||
    (recordContent !== undefined &&
      !revisionMatchesContent(entry.recordFile.revision, recordContent))
  ) {
    throw new Error(`账本记录 ${entry.id} 与工作区索引不一致。`);
  }
}

export function assertLongLedgerRecordChain(
  index: LongWorkspaceIndexSnapshot,
  records: readonly LongLedgerCommitRecord[],
  finalProjectRevision = index.revision
): void {
  if (records.length !== index.ledger.commits.length) {
    throw new Error("连续性账本记录链数量与索引不一致。");
  }
  const recordsById = new Map(
    records.map((record) => [record.id, record] as const)
  );
  if (recordsById.size !== records.length) {
    throw new Error("连续性账本包含重复记录身份。");
  }
  if (finalProjectRevision !== index.revision) {
    throw new Error("连续性账本的工作区与项目末态 revision 不一致。");
  }

  const continuityFiles = new Map<
    string,
    {
      reference: LongWorkspaceFileReference;
      role: "relationships" | "current-state" | "history";
    }
  >();
  for (const entry of index.characterFiles) {
    continuityFiles.set(entry.relationships.id, {
      reference: entry.relationships,
      role: "relationships"
    });
    continuityFiles.set(entry.currentState.id, {
      reference: entry.currentState,
      role: "current-state"
    });
    continuityFiles.set(entry.history.id, {
      reference: entry.history,
      role: "history"
    });
  }
  const lastFileState = new Map<
    string,
    LongLedgerCommitRecord["fileChanges"][number]["after"]
  >();
  let previousRecord: LongLedgerCommitRecord | undefined;
  const orderedRecords: LongLedgerCommitRecord[] = [];
  for (const entry of index.ledger.commits) {
    const record = recordsById.get(entry.id);
    if (!record) throw new Error(`连续性账本缺少记录：${entry.id}。`);
    assertLongLedgerRecordMatchesIndex(index, entry, record);
    if (
      record.sourceWorkspaceRevision !== record.sourceProjectRevision ||
      record.committedWorkspaceRevision !==
        record.committedProjectRevision ||
      record.committedWorkspaceRevision > index.revision ||
      record.committedProjectRevision > finalProjectRevision ||
      (previousRecord !== undefined &&
        (record.sourceWorkspaceRevision <
          previousRecord.committedWorkspaceRevision ||
          record.sourceProjectRevision <
            previousRecord.committedProjectRevision)) ||
      record.previousChapterCommitId !== null
    ) {
      throw new Error(
        `连续性账本 revision 或章节回滚前态不一致：${record.id}。`
      );
    }
    previousRecord = record;
    orderedRecords.push(record);
    for (const change of record.fileChanges) {
      const file = continuityFiles.get(change.fileId);
      const previous = lastFileState.get(change.fileId);
      if (
        !file ||
        file.reference.path !== change.path ||
        (file.role === "history" && change.mode !== "append") ||
        (file.role !== "history" && change.mode !== "replace") ||
        !revisionMatchesContent(
          change.before.revision,
          change.before.content
        ) ||
        !revisionMatchesContent(
          change.after.revision,
          change.after.content
        ) ||
        (change.mode === "append" &&
          !change.after.content.startsWith(change.before.content)) ||
        (previous !== undefined &&
          (previous.content !== change.before.content ||
            previous.revision !== change.before.revision))
      ) {
        throw new Error(
          `连续性账本文件变更链不一致：${change.fileId}。`
        );
      }
      lastFileState.set(change.fileId, change.after);
    }
  }
  for (const [fileId, state] of lastFileState) {
    const indexed = continuityFiles.get(fileId)!.reference;
    if (
      !revisionMatchesContent(state.revision, state.content) ||
      indexed.revision !== state.revision
    ) {
      throw new Error(`连续性账本末态与索引不一致：${fileId}。`);
    }
  }

  const placementState = new Map(
    index.plot.narrativePlacements.map((placement) => [
      placement.id,
      { status: placement.status, commitId: placement.commitId }
    ])
  );
  const beatState = new Map(
    index.plot.foreshadowing.flatMap((thread) =>
      thread.beats.map(
        (beat) =>
          [
            beat.id,
            { status: beat.status, commitId: beat.commitId }
          ] as const
      )
    )
  );
  const threadState = new Map(
    index.plot.foreshadowing.map((thread) => [
      thread.id,
      thread.status
    ])
  );
  const touchedPlacements = new Set<string>();
  const touchedBeats = new Set<string>();
  for (const record of [...orderedRecords].reverse()) {
    for (const change of record.placementChanges) {
      const current = placementState.get(change.placementId);
      if (
        !current ||
        current.status !== change.after.status ||
        current.commitId !== change.after.commitId
      ) {
        throw new Error(
          `连续性账本叙事落点回滚链不一致：${change.placementId}。`
        );
      }
      placementState.set(change.placementId, { ...change.before });
      touchedPlacements.add(change.placementId);
    }
    for (const change of record.foreshadowingBeatChanges) {
      const current = beatState.get(change.beatId);
      if (
        !current ||
        current.status !== change.after.status ||
        current.commitId !== change.after.commitId
      ) {
        throw new Error(
          `连续性账本伏笔节拍回滚链不一致：${change.beatId}。`
        );
      }
      beatState.set(change.beatId, { ...change.before });
      touchedBeats.add(change.beatId);
    }
    for (const change of record.foreshadowingThreadChanges) {
      if (threadState.get(change.foreshadowingId) !== change.after) {
        throw new Error(
          `连续性账本伏笔线回滚链不一致：${change.foreshadowingId}。`
        );
      }
      threadState.set(change.foreshadowingId, change.before);
    }
  }
  for (const placementId of touchedPlacements) {
    const state = placementState.get(placementId)!;
    if (
      state.commitId !== null ||
      (state.status !== "planned" && state.status !== "written")
    ) {
      throw new Error(
        `连续性账本叙事落点缺少可信回滚前态：${placementId}。`
      );
    }
  }
  for (const beatId of touchedBeats) {
    const state = beatState.get(beatId)!;
    if (
      state.commitId !== null ||
      (state.status !== "planned" && state.status !== "written")
    ) {
      throw new Error(
        `连续性账本伏笔节拍缺少可信回滚前态：${beatId}。`
      );
    }
  }
}

function assertUniqueIndexedFiles(files: readonly IndexedPortableFile[]): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const { reference } of files) {
    const pathKey = reference.path
      .normalize("NFC")
      .toLocaleLowerCase("en-US");
    if (ids.has(reference.id) || paths.has(pathKey)) {
      throw new Error(
        `长篇工作区索引包含重复文件：${reference.id} / ${reference.path}。`
      );
    }
    ids.add(reference.id);
    paths.add(pathKey);
  }
}

export async function buildLongPortableExportBundle(
  input: BuildLongPortableExportBundleInput
): Promise<LongPortableExportBundle> {
  const manifest = LongProjectManifestSchema.parse(input.manifest);
  const index = LongWorkspaceIndexSnapshotSchema.parse(input.index);
  validateManifestIndexPair(manifest, index);
  const references = indexedFiles(index);
  assertUniqueIndexedFiles(references);
  let totalBytes = 0;
  const files: LongPortableBundleFile[] = [];
  const ledgerRecords: LongLedgerCommitRecord[] = [];
  // Keep file I/O bounded even when a long project contains thousands of
  // chapters and ledger records. The completed bundle necessarily retains
  // the exported text, but it must not also create one pending read per file.
  for (const { reference, kind, commitId } of references) {
    const content = await input.readFile(reference);
    if (typeof content !== "string") {
      throw new Error(`长篇文件 ${reference.id} 的读取结果不是文本。`);
    }
    const bytes = Buffer.from(content, "utf8");
    if (bytes.toString("utf8") !== content) {
      throw new Error(`长篇文件 ${reference.path} 包含无效 Unicode。`);
    }
    if (
      bytes.byteLength >
      (kind === "ledger-record"
        ? MAX_LEDGER_RECORD_BYTES
        : MAX_FILE_BYTES)
    ) {
      throw new Error(`长篇文件 ${reference.path} 超过 32 MB 导出上限。`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > LONG_PORTABLE_BUNDLE_MAX_BYTES) {
      throw new Error(
        `长篇可移植包的文档总大小超过 ${LONG_PORTABLE_BUNDLE_MAX_LABEL} 内存安全上限。`
      );
    }
    if (!revisionMatchesContent(reference.revision, content)) {
      throw new Error(
        `长篇文件 ${reference.path} 的内容与索引 revision 不一致。`
      );
    }
    if (kind === "ledger-record") {
      const entry = index.ledger.commits.find(
        (candidate) => candidate.id === commitId
      )!;
      const record = validateLedgerRecord(content, index.bookId, commitId!);
      assertLongLedgerRecordMatchesIndex(index, entry, record, content);
      ledgerRecords.push(record);
    }
    files.push({
      id: reference.id,
      path: reference.path,
      kind,
      revision: reference.revision,
      sha256: sha256(bytes),
      content
    });
  }
  assertLongLedgerRecordChain(index, ledgerRecords, manifest.revision);
  const manifestText = serializeJson(manifest);
  const indexText = serializeJson(index);
  return {
    schema: LONG_PORTABLE_BUNDLE_SCHEMA,
    schemaVersion: LONG_PORTABLE_BUNDLE_SCHEMA_VERSION,
    exportedAt: normalizedTimestamp(input.exportedAt ?? new Date().toISOString()),
    bookId: manifest.id,
    manifest: {
      mediaType: "application/json",
      sha256: sha256(manifestText),
      value: manifest
    },
    index: {
      mediaType: "application/json",
      sha256: sha256(indexText),
      value: index
    },
    files
  };
}

function parseBundleInput(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") {
    if (!isRecord(raw)) {
      throw new Error("长篇可移植包必须是 JSON 对象。");
    }
    return raw;
  }
  if (Buffer.byteLength(raw, "utf8") > LONG_PORTABLE_BUNDLE_MAX_BYTES) {
    throw new Error(
      `长篇可移植包超过 ${LONG_PORTABLE_BUNDLE_MAX_LABEL} 内存安全上限。`
    );
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new Error("长篇可移植包不是有效 JSON 对象。");
  }
}

function parseJsonEntry(
  raw: unknown,
  label: string
): {
  sha256: string;
  value: unknown;
} {
  const entry = recordOrThrow(raw, `${label}条目`);
  if (
    entry.mediaType !== "application/json" ||
    typeof entry.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(entry.sha256)
  ) {
    throw new Error(`长篇可移植包的${label}条目格式无效。`);
  }
  return { sha256: entry.sha256, value: entry.value };
}

function recordOrThrow(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`长篇可移植包的${label}格式无效。`);
  }
  return value;
}

export function parseLongPortableExportBundle(
  raw: unknown
): LongPortableExportBundle {
  const bundle = parseBundleInput(raw);
  if (
    bundle.schema !== LONG_PORTABLE_BUNDLE_SCHEMA ||
    bundle.schemaVersion !== LONG_PORTABLE_BUNDLE_SCHEMA_VERSION
  ) {
    throw new Error("不支持的长篇可移植包 schema。");
  }
  const exportedAt = normalizedTimestamp(bundle.exportedAt);
  const manifestEntry = parseJsonEntry(bundle.manifest, "manifest");
  const indexEntry = parseJsonEntry(bundle.index, "index");
  const manifest = LongProjectManifestSchema.parse(manifestEntry.value);
  const index = LongWorkspaceIndexSnapshotSchema.parse(indexEntry.value);
  if (
    manifestEntry.sha256 !== sha256(serializeJson(manifest)) ||
    indexEntry.sha256 !== sha256(serializeJson(index))
  ) {
    throw new Error("长篇可移植包的 manifest 或 index SHA-256 校验失败。");
  }
  validateManifestIndexPair(manifest, index);
  if (bundle.bookId !== manifest.id) {
    throw new Error("长篇可移植包顶层 bookId 与 manifest 不一致。");
  }

  const expected = indexedFiles(index);
  assertUniqueIndexedFiles(expected);
  const expectedById = new Map(
    expected.map((entry) => [entry.reference.id, entry])
  );
  if (!Array.isArray(bundle.files) || bundle.files.length !== expected.length) {
    throw new Error("长篇可移植包没有完整包含索引中的全部文档。");
  }
  let totalBytes = 0;
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const ledgerRecords: LongLedgerCommitRecord[] = [];
  const files = bundle.files.map((rawFile) => {
    const file = recordOrThrow(rawFile, "文件条目");
    if (
      typeof file.id !== "string" ||
      typeof file.path !== "string" ||
      typeof file.revision !== "string" ||
      typeof file.sha256 !== "string" ||
      typeof file.content !== "string" ||
      (file.kind !== "markdown" && file.kind !== "ledger-record") ||
      !/^[0-9a-f]{64}$/u.test(file.sha256)
    ) {
      throw new Error("长篇可移植包包含格式无效的文件条目。");
    }
    const expectedFile = expectedById.get(file.id);
    if (!expectedFile) {
      throw new Error(`长篇可移植包包含索引外文件：${file.id}。`);
    }
    const pathKey = file.path.normalize("NFC").toLocaleLowerCase("en-US");
    if (seenIds.has(file.id) || seenPaths.has(pathKey)) {
      throw new Error(`长篇可移植包包含重复文件：${file.id}。`);
    }
    seenIds.add(file.id);
    seenPaths.add(pathKey);
    if (
      file.path !== expectedFile.reference.path ||
      file.revision !== expectedFile.reference.revision ||
      file.kind !== expectedFile.kind
    ) {
      throw new Error(`长篇可移植包中文件 ${file.id} 与索引不一致。`);
    }
    const bytes = Buffer.from(file.content, "utf8");
    if (bytes.toString("utf8") !== file.content) {
      throw new Error(`长篇可移植包中文件 ${file.id} 包含无效 Unicode。`);
    }
    totalBytes += bytes.byteLength;
    if (
      bytes.byteLength >
        (expectedFile.kind === "ledger-record"
          ? MAX_LEDGER_RECORD_BYTES
          : MAX_FILE_BYTES) ||
      totalBytes > LONG_PORTABLE_BUNDLE_MAX_BYTES
    ) {
      throw new Error("长篇可移植包的文件内容超过安全上限。");
    }
    if (
      sha256(bytes) !== file.sha256 ||
      !revisionMatchesContent(file.revision, file.content)
    ) {
      throw new Error(`长篇可移植包中文件 ${file.id} 完整性校验失败。`);
    }
    if (file.kind === "ledger-record") {
      const record = validateLedgerRecord(
        file.content,
        index.bookId,
        expectedFile.commitId!
      );
      const entry = index.ledger.commits.find(
        (candidate) => candidate.id === expectedFile.commitId
      )!;
      assertLongLedgerRecordMatchesIndex(
        index,
        entry,
        record,
        file.content
      );
      ledgerRecords.push(record);
    }
    return {
      id: file.id,
      path: file.path,
      kind: file.kind,
      revision: file.revision,
      sha256: file.sha256,
      content: file.content
    } satisfies LongPortableBundleFile;
  });
  if (seenIds.size !== expectedById.size) {
    throw new Error("长篇可移植包缺少索引中的文档。");
  }
  assertLongLedgerRecordChain(index, ledgerRecords, manifest.revision);
  return {
    schema: LONG_PORTABLE_BUNDLE_SCHEMA,
    schemaVersion: LONG_PORTABLE_BUNDLE_SCHEMA_VERSION,
    exportedAt,
    bookId: manifest.id,
    manifest: {
      mediaType: "application/json",
      sha256: manifestEntry.sha256,
      value: manifest
    },
    index: {
      mediaType: "application/json",
      sha256: indexEntry.sha256,
      value: index
    },
    files
  };
}

export function stringifyLongPortableExportBundle(
  bundle: LongPortableExportBundle
): string {
  const serialized = serializeJson(parseLongPortableExportBundle(bundle));
  if (
    Buffer.byteLength(serialized, "utf8") >
    LONG_PORTABLE_BUNDLE_MAX_BYTES
  ) {
    throw new Error(
      `长篇可移植包超过 ${LONG_PORTABLE_BUNDLE_MAX_LABEL} 内存安全上限。`
    );
  }
  return serialized;
}
