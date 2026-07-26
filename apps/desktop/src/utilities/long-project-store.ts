import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { TextDecoder } from "node:util";
import {
  LONG_BOOK_LINE_FILE_ID,
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongBookIdSchema,
  LongBookSchema,
  LongCommitChapterInputSchema,
  LongLedgerCommitRecordSchema,
  LongFileIdSchema,
  LongFileRevisionSchema,
  LongProjectManifestSchema,
  LongProjectRelativePathSchema,
  LongRollbackLastCommitInputSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  LongWriteChapterInputSchema,
  applyLongWorkspaceOperations,
  createLongBookSummary,
  deriveLongForeshadowingStatusFromCommittedBeats,
  longChapterBodyFileId,
  longChapterCharacterStateFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longWorldbuildingFileId,
  parseLongWorldbuildingMarkdownList,
  serializeLongWorldbuildingMarkdownList,
  type LongBook,
  type LongBookSummary,
  type LongCommitChapterInput,
  type LongCommitChapterResult,
  type LongFileRevision,
  type LongForeshadowing,
  type LongForeshadowingStatus,
  type LongLedgerCommitRecord,
  type LongProjectManifest,
  type LongRollbackLastCommitInput,
  type LongRollbackLastCommitResult,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperationBatch,
  type LongWorkspaceOperationResult,
  type LongWorldbuildingMarkdownList,
  type LongWriteChapterInput,
  type LongWriteChapterResult
} from "@deepwrite/contracts";
import { createId, nowIso, randomHex8 } from "@deepwrite/shared";
import {
  ProjectTransactionConflictError,
  commitProjectTransaction,
  projectTransactionContentSha256,
  recoverProjectTransaction,
  type CommitProjectTransactionInput,
  type ProjectTransactionFileOperation
} from "./project-transaction";
import {
  LONG_PORTABLE_BUNDLE_MAX_BYTES,
  assertLongLedgerRecordMatchesIndex,
  assertLongLedgerRecordChain,
  buildLongPortableExportBundle,
  parseLongPortableExportBundle,
  stringifyLongPortableExportBundle
} from "./long-portable-bundle";
import {
  readWriteClawLongImportPlan,
  type CreateWriteClawLongImportPlanOptions,
  type WriteClawLongImportPlan
} from "./write-claw-long-import";

const MANIFEST_PATH = "deepwrite.json";
const BOOK_LINE_PATH = "long/plot/book-line.md";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const MAX_LEDGER_RECORD_BYTES = 128 * 1024 * 1024;
const MAX_READ_PAGE_CHARACTERS = 256 * 1024;
const MAX_SEARCH_FILE_IDS = 1_000_000;
const MAX_SEARCH_SCANNED_FILES = 64;
const MAX_SEARCH_RESULTS = 100;
const DEFAULT_READ_PAGE_CHARACTERS = 16 * 1024;
const DEFAULT_SEARCH_RESULTS = 20;
const DEFAULT_SEARCH_CONTEXT_CHARACTERS = 80;
const MAX_SEARCH_SCANNED_CHARACTERS = 1024 * 1024;
const UNICODE_PAGE_INDEX_STRIDE = 4 * 1024;
const DOCUMENT_READ_CACHE_MAX_COST = 128 * 1024 * 1024;
const DOCUMENT_READ_CACHE_MAX_ENTRIES = 8;
const MIGRATION_EVIDENCE_WORLD_ID_PREFIX =
  "world_migration-evidence-";

const EMPTY_LINKED_MATERIALS = {
  character: [],
  gimmick: [],
  plot: [],
  draft: [],
  other: []
} as const;

const EMPTY_LINKED_SKILLS = {
  general: [],
  plot: [],
  style: [],
  other: []
} as const;

const DEFAULT_WORLD_CATEGORIES = [
  ["world_rules", "规则"],
  ["world_factions", "势力"],
  ["world_geography", "地理"],
  ["world_history", "历史"],
  ["world_terminology", "术语"],
  ["world_realms", "境界"],
  ["world_items", "物品"]
] as const;

export interface LongProjectStoreOptions {
  now?: () => string;
}

export interface CreateLongBookInput {
  id?: string;
  title: string;
  genre: string;
  linkedMaterialIdsByKind?: LongProjectManifest["linkedMaterialIdsByKind"];
  linkedSkillIdsByKind?: LongProjectManifest["linkedSkillIdsByKind"];
}

export interface CreatedLongBook {
  projectDirectory: string;
  book: LongBook;
  summary: LongBookSummary;
}

export type ImportWriteClawLongBookOptions = Omit<
  CreateWriteClawLongImportPlanOptions,
  "importedAt"
>;

export interface ImportedWriteClawLongBook extends CreatedLongBook {
  sourceKind: WriteClawLongImportPlan["sourceKind"];
  legacySchemaVersion: number;
  committedChapterPolicy:
    WriteClawLongImportPlan["committedChapterPolicy"];
  warnings: string[];
}

export interface ImportedPortableLongBook extends CreatedLongBook {
  exportedAt: string;
}

export interface OpenedLongBook {
  book: LongBook;
  summary: LongBookSummary;
}

export interface UpdateLongBookBindingsInput {
  expectedProjectRevision: number;
  linkedMaterialIdsByKind: LongProjectManifest["linkedMaterialIdsByKind"];
  linkedSkillIdsByKind: LongProjectManifest["linkedSkillIdsByKind"];
}

export interface ReadLongDocumentInput {
  fileId: string;
  offset?: number;
  limit?: number;
}

export interface ReadLongDocumentResult {
  fileId: string;
  path: string;
  revision: LongFileRevision;
  workspaceRevision: number;
  projectRevision: number;
  content: string;
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
}

export interface SearchLongProjectInput {
  query: string;
  fileIds: readonly string[];
  maxResults?: number;
  contextCharacters?: number;
  resume?: LongProjectSearchResume;
}

export interface LongProjectSearchResume {
  fileIndex: number;
  fileId: string;
  fileRevision: LongFileRevision;
  characterOffset: number;
}

export interface LongProjectSearchMatch {
  fileId: string;
  path: string;
  revision: LongFileRevision;
  offset: number;
  endOffset: number;
  line: number;
  preview: string;
}

export interface SearchLongProjectResult {
  query: string;
  workspaceRevision: number;
  projectRevision: number;
  matches: LongProjectSearchMatch[];
  nextResume: LongProjectSearchResume | null;
  truncated: boolean;
}

export interface WriteLongDocumentInput {
  fileId: string;
  content: string;
  expectedFileRevision: string;
  expectedWorkspaceRevision: number;
  expectedProjectRevision: number;
}

export interface WriteLongDocumentResult extends OpenedLongBook {
  fileId: string;
  fileRevision: LongFileRevision;
  workspaceRevision: number;
  projectRevision: number;
}

export interface ApplyLongWorkspaceOperationsInput {
  batch: LongWorkspaceOperationBatch;
  expectedProjectRevision: number;
}

export interface ApplyLongWorkspaceOperationsResult
  extends OpenedLongBook {
  operationResult: LongWorkspaceOperationResult;
  projectRevision: number;
}

export type StoreWriteLongChapterInput = Omit<
  LongWriteChapterInput,
  "bookId"
>;
export type StoreCommitLongChapterInput = Omit<
  LongCommitChapterInput,
  "bookId"
>;
export type StoreRollbackLastCommitInput = Omit<
  LongRollbackLastCommitInput,
  "bookId"
>;

export type LongProjectConflictScope =
  | "file"
  | "workspace"
  | "project"
  | "transaction";

export class LongProjectConflictError extends Error {
  constructor(
    readonly scope: LongProjectConflictScope,
    readonly expected: string | number,
    readonly actual: string | number
  ) {
    super(`长篇项目 ${scope} revision 冲突：期望 ${expected}，实际 ${actual}。`);
    this.name = "LongProjectConflictError";
  }
}

interface SecureTextFile {
  content: string;
  bytes: Buffer;
  sha256: string;
  revision: LongFileRevision;
  updatedAt: string;
  identity: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface UnicodePageAnchor {
  characterOffset: number;
  codeUnitOffset: number;
}

interface CachedPagedTextFile {
  disk: SecureTextFile;
  totalCharacters: number;
  anchors: UnicodePageAnchor[];
  cost: number;
}

interface LoadedPagedIndexedFile extends LoadedIndexedFile {
  paging: CachedPagedTextFile;
}

interface IndexedFileSlot {
  reference: LongWorkspaceFileReference;
  expectedPath: string;
  kind: "markdown" | "json";
}

interface IndexedFileDescriptor {
  reference: LongWorkspaceFileReference;
  kind: "markdown" | "json";
  disk: SecureTextFile | null;
}

type LoadedIndexedFile = Omit<IndexedFileDescriptor, "disk"> & {
  disk: SecureTextFile;
};

interface LoadedLongProject {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  index: LongWorkspaceIndexSnapshot;
  indexDisk: SecureTextFile;
  files: Map<string, IndexedFileDescriptor>;
  book: LongBook;
  summary: LongBookSummary;
}

interface InitialProjectFiles {
  manifest: LongProjectManifest;
  index: LongWorkspaceIndexSnapshot;
  operations: Array<{
    path: string;
    content: string;
    expectedSha256: null;
  }>;
}

async function commitLongProjectTransaction(
  input: CommitProjectTransactionInput
) {
  for (const operation of input.operations) {
    if (
      operation.action === "delete" ||
      operation.action === "check"
    ) {
      continue;
    }
    const path = operation.path.trim();
    const maxBytes =
      path === MANIFEST_PATH
        ? MAX_MANIFEST_BYTES
        : path === LONG_WORKSPACE_INDEX_PATH
          ? MAX_INDEX_BYTES
          : path.startsWith("long/ledger/") && path.endsWith(".json")
            ? MAX_LEDGER_RECORD_BYTES
            : MAX_DOCUMENT_BYTES;
    const byteLength = encodeUtf8Strict(operation.content).byteLength;
    if (byteLength > maxBytes) {
      throw new Error(
        `长篇项目文件超过 UTF-8 字节限制：${path}（${byteLength} > ${maxBytes}）。`
      );
    }
  }
  return await commitProjectTransaction({
    ...input,
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
}

export class LongProjectStore {
  private readonly now: () => string;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly documentReadCache = new Map<
    string,
    CachedPagedTextFile
  >();
  private documentReadCacheCost = 0;

  constructor(options: LongProjectStoreOptions = {}) {
    this.now = options.now ?? nowIso;
  }

  async createBook(
    parentDirectory: string,
    input: CreateLongBookInput
  ): Promise<CreatedLongBook> {
    const parent = await secureDirectory(parentDirectory, "长篇项目父目录");
    return await this.runExclusive(parent, async () => {
      const bookId = LongBookIdSchema.parse(input.id ?? createId("longbook"));
      const projectDirectory = join(parent, bookId);
      await requireMissing(projectDirectory, "长篇项目目录已存在。");

      const stagingDirectory = join(
        parent,
        `.${bookId}.staging-${randomHex8()}`
      );
      await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
      await mkdir(stagingDirectory, { mode: 0o700 });

      try {
        const initial = this.createInitialProjectFiles(bookId, input);
        await commitLongProjectTransaction({
          projectRoot: stagingDirectory,
          operations: initial.operations,
          maxFileBytes: MAX_LEDGER_RECORD_BYTES
        });
        await this.loadProject(stagingDirectory);
        await requireMissing(projectDirectory, "长篇项目目录已存在。");
        await rename(stagingDirectory, projectDirectory);
        const loaded = await this.loadProject(projectDirectory);
        return {
          projectDirectory: loaded.projectDirectory,
          book: loaded.book,
          summary: loaded.summary
        };
      } catch (error: unknown) {
        await rm(stagingDirectory, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async importWriteClawBook(
    parentDirectory: string,
    sourcePath: string,
    options: ImportWriteClawLongBookOptions = {}
  ): Promise<ImportedWriteClawLongBook> {
    const parent = await secureDirectory(parentDirectory, "长篇项目父目录");
    return await this.runExclusive(parent, async () => {
      const plan = await readWriteClawLongImportPlan(sourcePath, {
        ...options,
        importedAt: this.timestamp()
      });
      const manifest = LongProjectManifestSchema.parse(plan.manifest);
      const index = LongWorkspaceIndexSnapshotSchema.parse(plan.index);
      validateImportPlan(plan, manifest, index);

      const projectDirectory = join(parent, manifest.id);
      await requireMissing(projectDirectory, "长篇项目目录已存在。");
      const stagingDirectory = join(
        parent,
        `.${manifest.id}.staging-${randomHex8()}`
      );
      await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
      await mkdir(stagingDirectory, { mode: 0o700 });

      try {
        await commitLongProjectTransaction({
          projectRoot: stagingDirectory,
          operations: [
            ...plan.documents.map((document) => ({
              path: document.path,
              content: document.content,
              expectedSha256: null as null
            })),
            {
              path: LONG_WORKSPACE_INDEX_PATH,
              content: serializeJson(index),
              expectedSha256: null
            },
            {
              path: MANIFEST_PATH,
              content: serializeJson(manifest),
              expectedSha256: null
            }
          ],
          maxFileBytes: MAX_LEDGER_RECORD_BYTES
        });
        await this.loadProject(stagingDirectory);
        await requireMissing(projectDirectory, "长篇项目目录已存在。");
        await rename(stagingDirectory, projectDirectory);
        const loaded = await this.loadProject(projectDirectory);
        return {
          projectDirectory: loaded.projectDirectory,
          book: loaded.book,
          summary: loaded.summary,
          sourceKind: plan.sourceKind,
          legacySchemaVersion: plan.legacySchemaVersion,
          committedChapterPolicy: plan.committedChapterPolicy,
          warnings: [...plan.warnings]
        };
      } catch (error: unknown) {
        await rm(stagingDirectory, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async importPortableBundle(
    parentDirectory: string,
    sourcePath: string
  ): Promise<ImportedPortableLongBook> {
    const parent = await secureDirectory(parentDirectory, "长篇项目父目录");
    return await this.runExclusive(parent, async () => {
      const source = await readPortableBundleSource(sourcePath);
      const bundle = parseLongPortableExportBundle(source);
      const manifest = LongProjectManifestSchema.parse(bundle.manifest.value);
      const index = LongWorkspaceIndexSnapshotSchema.parse(bundle.index.value);
      const slots = indexedFileSlots(index);
      validatePortableAndCanonicalPaths(slots);

      const projectDirectory = join(parent, manifest.id);
      await requireMissing(projectDirectory, "长篇项目目录已存在。");
      const stagingDirectory = join(
        parent,
        `.${manifest.id}.staging-${randomHex8()}`
      );
      await requireMissing(stagingDirectory, "长篇项目暂存目录已存在。");
      await mkdir(stagingDirectory, { mode: 0o700 });

      try {
        await commitLongProjectTransaction({
          projectRoot: stagingDirectory,
          operations: [
            ...bundle.files.map((file) => ({
              path: file.path,
              content: file.content,
              expectedSha256: null as null
            })),
            {
              path: LONG_WORKSPACE_INDEX_PATH,
              content: serializeJson(index),
              expectedSha256: null
            },
            {
              path: MANIFEST_PATH,
              content: serializeJson(manifest),
              expectedSha256: null
            }
          ],
          maxFileBytes: MAX_LEDGER_RECORD_BYTES
        });
        await this.loadProject(stagingDirectory);
        await requireMissing(projectDirectory, "长篇项目目录已存在。");
        await rename(stagingDirectory, projectDirectory);
        const loaded = await this.loadProject(projectDirectory);
        return {
          projectDirectory: loaded.projectDirectory,
          book: loaded.book,
          summary: loaded.summary,
          exportedAt: bundle.exportedAt
        };
      } catch (error: unknown) {
        await rm(stagingDirectory, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async openBook(projectDirectory: string): Promise<OpenedLongBook> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      return { book: loaded.book, summary: loaded.summary };
    });
  }

  async inspectBookManifest(projectDirectory: string): Promise<{
    bookId: string;
    projectRevision: number;
    updatedAt: string;
  }> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await this.runExclusive(canonical, async () => {
      await recoverProjectTransaction(canonical, MAX_LEDGER_RECORD_BYTES);
      const manifestDisk = await readSecureTextFile(
        canonical,
        MANIFEST_PATH,
        MAX_MANIFEST_BYTES
      );
      const manifest = LongProjectManifestSchema.parse(
        parseJson(manifestDisk.content, "长篇项目 manifest")
      );
      return {
        bookId: manifest.id,
        projectRevision: manifest.revision,
        updatedAt: manifest.updatedAt
      };
    });
  }

  async updateBindings(
    projectDirectory: string,
    input: UpdateLongBookBindingsInput
  ): Promise<OpenedLongBook> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      if (input.expectedProjectRevision !== loaded.manifest.revision) {
        throw new LongProjectConflictError(
          "project",
          input.expectedProjectRevision,
          loaded.manifest.revision
        );
      }
      const timestamp = this.timestamp();
      const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
        ...loaded.index,
        revision: loaded.index.revision + 1,
        updatedAt: timestamp
      });
      const indexContent = serializeJson(nextIndex);
      const nextManifest = LongProjectManifestSchema.parse({
        ...loaded.manifest,
        revision: loaded.manifest.revision + 1,
        linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
        linkedSkillIdsByKind: input.linkedSkillIdsByKind,
        updatedAt: timestamp,
        workspaceIndexFile: {
          ...loaded.manifest.workspaceIndexFile,
          revision: createLongFileRevision(indexContent),
          updatedAt: timestamp
        }
      });
      try {
        await commitLongProjectTransaction({
          projectRoot: loaded.projectDirectory,
          operations: [
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
      const next = await this.loadProject(loaded.projectDirectory);
      return { book: next.book, summary: next.summary };
    });
  }

  async exportPortableBundle(
    projectDirectory: string
  ): Promise<string> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      const bundle = await buildLongPortableExportBundle({
        manifest: loaded.manifest,
        index: loaded.index,
        exportedAt: this.timestamp(),
        readFile: async (reference) => {
          const file = await loadIndexedFile(loaded, reference.id);
          if (file.reference.path !== reference.path) {
            throw new Error(
              `长篇导出文件路径与索引不一致：${reference.id}`
            );
          }
          return file.disk.content;
        }
      });
      return stringifyLongPortableExportBundle(bundle);
    });
  }

  async readDocument(
    projectDirectory: string,
    input: ReadLongDocumentInput
  ): Promise<ReadLongDocumentResult> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      const fileId = LongFileIdSchema.parse(input.fileId);
      const file = await this.loadPagedIndexedFile(loaded, fileId);
      const offset = nonnegativeInteger(input.offset ?? 0, "分页起点");
      const limit = boundedPositiveInteger(
        input.limit ?? DEFAULT_READ_PAGE_CHARACTERS,
        MAX_READ_PAGE_CHARACTERS,
        "分页长度"
      );
      const page = sliceIndexedUnicodeCodePointPage(
        file.paging,
        offset,
        limit
      );
      if (offset > page.totalCharacters) {
        throw new Error("长篇文档分页起点超过文件字符总数。");
      }
      return {
        fileId,
        path: file.reference.path,
        revision: file.disk.revision,
        workspaceRevision: loaded.index.revision,
        projectRevision: loaded.manifest.revision,
        content: page.content,
        offset,
        nextOffset: page.nextOffset,
        totalCharacters: page.totalCharacters
      };
    });
  }

  async search(
    projectDirectory: string,
    input: SearchLongProjectInput
  ): Promise<SearchLongProjectResult> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      const query = input.query.trim().normalize("NFC");
      if (!query || query.length > 256) {
        throw new Error("长篇搜索词必须包含 1 到 256 个字符。");
      }
      if (
        input.fileIds.length < 1 ||
        input.fileIds.length > MAX_SEARCH_FILE_IDS
      ) {
        throw new Error(
          `长篇搜索范围必须包含 1 到 ${MAX_SEARCH_FILE_IDS} 个文件。`
        );
      }
      const fileIds = input.fileIds.map((fileId) =>
        LongFileIdSchema.parse(fileId)
      );
      if (new Set(fileIds).size !== fileIds.length) {
        throw new Error("长篇搜索范围不能包含重复文件。");
      }
      const maxResults = boundedPositiveInteger(
        input.maxResults ?? DEFAULT_SEARCH_RESULTS,
        MAX_SEARCH_RESULTS,
        "搜索结果数"
      );
      const contextCharacters = boundedNonnegativeInteger(
        input.contextCharacters ?? DEFAULT_SEARCH_CONTEXT_CHARACTERS,
        500,
        "搜索上下文长度"
      );
      const resume = parseProjectSearchResume(input.resume, fileIds);
      const matches: LongProjectSearchMatch[] = [];
      let fileIndex = resume?.fileIndex ?? 0;
      let characterOffset = resume?.characterOffset ?? 0;
      let expectedRevision = resume?.fileRevision;
      let nextResume: LongProjectSearchResume | null = null;
      let scannedFileCount = 0;
      let scannedCharacterCount = 0;
      let lastCompletedFile: LongProjectSearchResume | null = null;

      while (
        fileIndex < fileIds.length &&
        matches.length < maxResults &&
        scannedFileCount < MAX_SEARCH_SCANNED_FILES &&
        scannedCharacterCount < MAX_SEARCH_SCANNED_CHARACTERS
      ) {
        const scannedFileIndex = fileIndex;
        const file = await this.loadPagedIndexedFile(
          loaded,
          fileIds[fileIndex]!
        );
        const scanned = await scanIndexedFileForSearch(
          file,
          query,
          characterOffset,
          maxResults - matches.length,
          contextCharacters,
          expectedRevision,
          MAX_SEARCH_SCANNED_CHARACTERS - scannedCharacterCount
        );
        scannedFileCount += 1;
        scannedCharacterCount += scanned.scannedCharacters;
        matches.push(...scanned.matches);
        if (scanned.nextMatchOffset !== null) {
          nextResume = {
            fileIndex,
            fileId: scanned.fileId,
            fileRevision: scanned.revision,
            characterOffset: scanned.nextMatchOffset
          };
          break;
        }
        lastCompletedFile = {
          fileIndex: scannedFileIndex,
          fileId: scanned.fileId,
          fileRevision: scanned.revision,
          characterOffset: scanned.characterLength
        };
        fileIndex += 1;
        characterOffset = 0;
        expectedRevision = undefined;
      }

      if (
        nextResume === null &&
        fileIndex < fileIds.length &&
        lastCompletedFile !== null
      ) {
        nextResume = lastCompletedFile;
      }

      return {
        query,
        workspaceRevision: loaded.index.revision,
        projectRevision: loaded.manifest.revision,
        matches,
        nextResume,
        truncated: nextResume !== null
      };
    });
  }

  private async loadPagedIndexedFile(
    loaded: LoadedLongProject,
    fileId: string
  ): Promise<LoadedPagedIndexedFile> {
    const descriptor = requireIndexedFileDescriptor(loaded, fileId);
    const maxBytes =
      descriptor.kind === "json"
        ? MAX_LEDGER_RECORD_BYTES
        : MAX_DOCUMENT_BYTES;
    const cacheKey = `${loaded.projectDirectory}\u0000${descriptor.reference.path}`;
    let paging = this.documentReadCache.get(cacheKey);
    if (
      paging &&
      !(await secureTextFileMetadataMatches(
        loaded.projectDirectory,
        descriptor.reference.path,
        maxBytes,
        paging.disk
      ))
    ) {
      this.removeDocumentReadCacheEntry(cacheKey, paging);
      paging = undefined;
    }
    if (!paging) {
      const disk = await readSecureTextFile(
        loaded.projectDirectory,
        descriptor.reference.path,
        maxBytes
      );
      paging = createCachedPagedTextFile(disk);
      this.insertDocumentReadCacheEntry(cacheKey, paging);
    } else {
      // Refresh LRU insertion order without cloning the potentially large
      // text or byte buffer.
      this.documentReadCache.delete(cacheKey);
      this.documentReadCache.set(cacheKey, paging);
    }
    if (
      (descriptor.kind === "json" ||
        isPinnedMarkdownFile(loaded.index, descriptor.reference.id)) &&
      !longRevisionMatchesSecureTextFile(
        descriptor.reference.revision,
        paging.disk
      )
    ) {
      throw new Error(
        `长篇已锁定文件 revision 不一致，检测到索引外修改：${descriptor.reference.path}`
      );
    }
    descriptor.reference.revision = paging.disk.revision;
    descriptor.reference.updatedAt = paging.disk.updatedAt;
    descriptor.disk = paging.disk;
    return {
      ...(descriptor as LoadedIndexedFile),
      paging
    };
  }

  private insertDocumentReadCacheEntry(
    key: string,
    entry: CachedPagedTextFile
  ): void {
    const current = this.documentReadCache.get(key);
    if (current) this.removeDocumentReadCacheEntry(key, current);
    if (entry.cost > DOCUMENT_READ_CACHE_MAX_COST) return;
    this.documentReadCache.set(key, entry);
    this.documentReadCacheCost += entry.cost;
    while (
      this.documentReadCache.size > DOCUMENT_READ_CACHE_MAX_ENTRIES ||
      this.documentReadCacheCost > DOCUMENT_READ_CACHE_MAX_COST
    ) {
      const oldest = this.documentReadCache.entries().next().value as
        | [string, CachedPagedTextFile]
        | undefined;
      if (!oldest) break;
      this.removeDocumentReadCacheEntry(oldest[0], oldest[1]);
    }
  }

  private removeDocumentReadCacheEntry(
    key: string,
    entry: CachedPagedTextFile
  ): void {
    if (this.documentReadCache.get(key) !== entry) return;
    this.documentReadCache.delete(key);
    this.documentReadCacheCost = Math.max(
      0,
      this.documentReadCacheCost - entry.cost
    );
  }

  async writeDocument(
    projectDirectory: string,
    input: WriteLongDocumentInput
  ): Promise<WriteLongDocumentResult> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      const fileId = LongFileIdSchema.parse(input.fileId);
      assertDirectlyMutableDocument(loaded.index, fileId);
      const file = await loadIndexedFile(loaded, fileId);
      if (file.kind !== "markdown") {
        throw new Error("第一阶段只允许通过 writeDocument 写入 Markdown 文件。");
      }
      if (input.expectedProjectRevision !== loaded.manifest.revision) {
        throw new LongProjectConflictError(
          "project",
          input.expectedProjectRevision,
          loaded.manifest.revision
        );
      }
      if (input.expectedWorkspaceRevision !== loaded.index.revision) {
        throw new LongProjectConflictError(
          "workspace",
          input.expectedWorkspaceRevision,
          loaded.index.revision
        );
      }
      if (
        !longRevisionsMatchContent(
          input.expectedFileRevision,
          file.disk.revision,
          file.disk.bytes
        )
      ) {
        throw new LongProjectConflictError(
          "file",
          input.expectedFileRevision,
          file.disk.revision
        );
      }
      const worldbuildingCategory = loaded.index.worldbuilding.find(
        (category) => category.file.id === fileId
      );
      if (worldbuildingCategory?.format === "list") {
        parseLongWorldbuildingMarkdownList(input.content);
      }

      const nextBytes = encodeUtf8Strict(input.content);
      if (nextBytes.byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error("长篇 Markdown 文件超过 32 MiB 限制。");
      }
      const timestamp = this.timestamp();
      const nextFileRevision = createLongFileRevision(nextBytes);
      file.reference.revision = nextFileRevision;
      file.reference.updatedAt = timestamp;

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
      const manifestContent = serializeJson(nextManifest);

      try {
        await commitLongProjectTransaction({
          projectRoot: loaded.projectDirectory,
          operations: [
            {
              path: file.reference.path,
              content: input.content,
              expectedSha256: file.disk.sha256
            },
            {
              path: LONG_WORKSPACE_INDEX_PATH,
              content: indexContent,
              expectedSha256: loaded.indexDisk.sha256
            },
            {
              path: MANIFEST_PATH,
              content: manifestContent,
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

      const next = await this.loadProject(loaded.projectDirectory);
      const written = requireIndexedFileReference(next.index, fileId);
      return {
        book: next.book,
        summary: next.summary,
        fileId,
        fileRevision: written.revision,
        workspaceRevision: next.index.revision,
        projectRevision: next.manifest.revision
      };
    });
  }

  async applyWorkspaceOperations(
    projectDirectory: string,
    input: ApplyLongWorkspaceOperationsInput
  ): Promise<ApplyLongWorkspaceOperationsResult> {
    const canonical = await secureDirectory(
      projectDirectory,
      "长篇项目目录"
    );
    const batch = LongWorkspaceOperationBatchSchema.parse(input.batch);
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      if (input.expectedProjectRevision !== loaded.manifest.revision) {
        throw new LongProjectConflictError(
          "project",
          input.expectedProjectRevision,
          loaded.manifest.revision
        );
      }
      for (const operation of batch.operations) {
        const raw = operation as unknown as Record<string, unknown>;
        const targetId =
          typeof raw.id === "string"
            ? raw.id
            : raw.category &&
                typeof raw.category === "object" &&
                "id" in raw.category &&
                typeof (raw.category as { id?: unknown }).id === "string"
              ? (raw.category as { id: string }).id
              : "";
        if (targetId.startsWith(MIGRATION_EVIDENCE_WORLD_ID_PREFIX)) {
          throw new Error("只读迁移证据不能通过长篇结构操作修改或删除。");
        }
      }
      const operationResult = applyLongWorkspaceOperations(
        loaded.index,
        batch
      );
      const nextIndex = operationResult.snapshot;
      // Canonical role paths, portable uniqueness and reserved-directory
      // boundaries are checked before any transaction is staged.
      validatePortableAndCanonicalPaths(indexedFileSlots(nextIndex));

      const proposalByFileId = new Map(
        operationResult.documentWrites.map((proposal) => [
          proposal.fileId,
          proposal
        ])
      );
      const fileOperations: ProjectTransactionFileOperation[] = [];

      for (const intent of operationResult.fileIntents) {
        if (intent.action === "delete") {
          const expectedRevision = intent.file.revision;
          const current = await loadIndexedFile(loaded, intent.file.id);
          if (current.reference.path !== intent.file.path) {
            throw new Error(
              `长篇删除文件路径与当前索引不一致：${intent.file.id}`
            );
          }
          if (
            !longRevisionsMatchContent(
              expectedRevision,
              current.disk.revision,
              current.disk.bytes
            )
          ) {
            throw new LongProjectConflictError(
              "file",
              expectedRevision,
              current.disk.revision
            );
          }
          fileOperations.push({
            action: "delete",
            path: current.reference.path,
            expectedSha256: current.disk.sha256
          });
          continue;
        }
        const proposal = proposalByFileId.get(intent.file.id);
        const worldbuildingCategory = nextIndex.worldbuilding.find(
          (category) => category.file.id === intent.file.id
        );
        const content =
          proposal?.content ??
          (worldbuildingCategory?.format === "list"
            ? serializeLongWorldbuildingMarkdownList([])
            : "");
        if (worldbuildingCategory?.format === "list") {
          parseLongWorldbuildingMarkdownList(content);
        }
        const actualRevision = createLongFileRevision(content);
        if (
          proposal &&
          !longRevisionsMatchContent(
            proposal.nextRevision,
            actualRevision,
            content
          )
        ) {
          throw new Error(
            `长篇新文件 revision 与提案内容不一致：${intent.file.id}`
          );
        }
        const nextFile = requireIndexedFileReference(
          nextIndex,
          intent.file.id
        );
        intent.file.revision = actualRevision;
        intent.file.updatedAt = nextIndex.updatedAt;
        nextFile.revision = actualRevision;
        nextFile.updatedAt = nextIndex.updatedAt;
        fileOperations.push({
          path: intent.file.path,
          content,
          expectedSha256: null
        });
      }

      for (const proposal of operationResult.documentWrites) {
        if (proposal.mode === "create") continue;
        assertDirectlyMutableDocument(loaded.index, proposal.fileId);
        const currentDescriptor = loaded.files.get(proposal.fileId);
        if (!currentDescriptor || currentDescriptor.kind !== "markdown") {
          throw new Error(
            `长篇文档提案目标不存在或不可写：${proposal.fileId}`
          );
        }
        const current = await loadIndexedFile(loaded, proposal.fileId);
        if (
          !longRevisionsMatchContent(
            proposal.expectedRevision,
            current.disk.revision,
            current.disk.bytes
          )
        ) {
          throw new LongProjectConflictError(
            "file",
            proposal.expectedRevision,
            current.disk.revision
          );
        }
        const content =
          proposal.mode === "append"
            ? `${current.disk.content}${proposal.content}`
            : proposal.content;
        const worldbuildingCategory = nextIndex.worldbuilding.find(
          (category) => category.file.id === proposal.fileId
        );
        if (worldbuildingCategory?.format === "list") {
          parseLongWorldbuildingMarkdownList(content);
        }
        const actualRevision = createLongFileRevision(content);
        if (
          !longRevisionsMatchContent(
            proposal.nextRevision,
            actualRevision,
            content
          )
        ) {
          throw new Error(
            `长篇文档 nextRevision 与提案内容不一致：${proposal.fileId}`
          );
        }
        const nextFile = requireIndexedFileReference(
          nextIndex,
          proposal.fileId
        );
        if (
          !longRevisionsMatchContent(
            nextFile.revision,
            actualRevision,
            content
          )
        ) {
          throw new Error(
            `长篇索引未包含文档提案的实际 revision：${proposal.fileId}`
          );
        }
        fileOperations.push({
          path: current.reference.path,
          content,
          expectedSha256: current.disk.sha256
        });
      }
      const previousWorldbuildingById = new Map(
        loaded.index.worldbuilding.map((category) => [category.id, category])
      );
      for (const category of nextIndex.worldbuilding) {
        const previous = previousWorldbuildingById.get(category.id);
        if (
          !previous ||
          previous.format === category.format ||
          proposalByFileId.has(category.file.id) ||
          operationResult.fileIntents.some(
            (intent) =>
              intent.action === "create" &&
              intent.file.id === category.file.id
          )
        ) {
          continue;
        }
        const currentDescriptor = loaded.files.get(category.file.id);
        if (!currentDescriptor) {
          throw new Error(
            `待转换的世界观文件不存在：${category.file.id}`
          );
        }
        const current = await loadIndexedFile(loaded, category.file.id);
        const content =
          category.format === "list"
            ? convertWorldbuildingTextToList(
                category.id,
                current.disk.content
              )
            : convertWorldbuildingListToText(current.disk.content);
        const actualRevision = createLongFileRevision(content);
        category.file.revision = actualRevision;
        category.file.updatedAt = nextIndex.updatedAt;
        fileOperations.push({
          path: current.reference.path,
          content,
          expectedSha256: current.disk.sha256
        });
      }

      const indexContent = serializeJson(nextIndex);
      const nextManifest = LongProjectManifestSchema.parse({
        ...loaded.manifest,
        revision: nextIndex.revision,
        updatedAt: nextIndex.updatedAt,
        workspaceIndexFile: {
          ...loaded.manifest.workspaceIndexFile,
          revision: createLongFileRevision(indexContent),
          updatedAt: nextIndex.updatedAt
        }
      });
      try {
        await commitLongProjectTransaction({
          projectRoot: loaded.projectDirectory,
          operations: [
            ...fileOperations,
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
      const next = await this.loadProject(loaded.projectDirectory);
      return {
        book: next.book,
        summary: next.summary,
        operationResult: {
          ...operationResult,
          snapshot: next.index
        },
        projectRevision: next.manifest.revision
      };
    });
  }

  async writeChapter(
    projectDirectory: string,
    rawInput: StoreWriteLongChapterInput
  ): Promise<LongWriteChapterResult> {
    const canonical = await secureDirectory(
      projectDirectory,
      "长篇项目目录"
    );
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      const input = LongWriteChapterInputSchema.parse({
        ...rawInput,
        bookId: loaded.manifest.id
      });
      if (input.baseProjectRevision !== loaded.manifest.revision) {
        throw new LongProjectConflictError(
          "project",
          input.baseProjectRevision,
          loaded.manifest.revision
        );
      }
      if (input.baseWorkspaceRevision !== loaded.index.revision) {
        throw new LongProjectConflictError(
          "workspace",
          input.baseWorkspaceRevision,
          loaded.index.revision
        );
      }
      const orderedChapters = orderedChapterCards(loaded.index);
      const nextChapter =
        orderedChapters[loaded.index.ledger.commits.length];
      if (!nextChapter || nextChapter.id !== input.chapterCardId) {
        throw new Error("长篇正文必须按尚未提交的连续下一章串行写作。");
      }
      const entry = loaded.index.chapters.find(
        (candidate) =>
          candidate.chapterCardId === input.chapterCardId
      );
      if (!entry || entry.commitId !== null) {
        throw new Error("当前长篇章卡不存在或已经提交。");
      }
      const [bodyFile, characterStateFile, handoffFile] = await Promise.all([
        loadIndexedFile(loaded, entry.body.id),
        loadIndexedFile(loaded, entry.characterState.id),
        loadIndexedFile(loaded, entry.handoff.id)
      ]);
      const writes = [
        {
          file: bodyFile,
          input: input.body
        },
        {
          file: characterStateFile,
          input: input.characterState
        },
        {
          file: handoffFile,
          input: input.handoff
        }
      ];
      for (const write of writes) {
        if (
          !longRevisionsMatchContent(
            write.input.baseRevision,
            write.file.disk.revision,
            write.file.disk.bytes
          )
        ) {
          throw new LongProjectConflictError(
            "file",
            write.input.baseRevision,
            write.file.disk.revision
          );
        }
      }
      const timestamp = this.timestamp();
      for (const write of writes) {
        write.file.reference.revision = createLongFileRevision(
          write.input.content
        );
        write.file.reference.updatedAt = timestamp;
      }
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
      try {
        await commitLongProjectTransaction({
          projectRoot: loaded.projectDirectory,
          operations: [
            ...writes.map((write) => ({
              path: write.file.reference.path,
              content: write.input.content,
              expectedSha256: write.file.disk.sha256
            })),
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
      const next = await this.loadProject(loaded.projectDirectory);
      const nextEntry = next.index.chapters.find(
        (candidate) =>
          candidate.chapterCardId === input.chapterCardId
      )!;
      return {
        bookId: next.manifest.id,
        chapterCardId: input.chapterCardId,
        bodyRevision: nextEntry.body.revision,
        characterStateRevision: nextEntry.characterState.revision,
        handoffRevision: nextEntry.handoff.revision,
        workspaceRevision: next.index.revision,
        projectRevision: next.manifest.revision
      };
    });
  }

  async commitChapter(
    projectDirectory: string,
    rawInput: StoreCommitLongChapterInput
  ): Promise<LongCommitChapterResult> {
    const canonical = await secureDirectory(
      projectDirectory,
      "长篇项目目录"
    );
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      const input = LongCommitChapterInputSchema.parse({
        ...rawInput,
        bookId: loaded.manifest.id
      });
      assertProjectRevisions(
        loaded,
        input.baseWorkspaceRevision,
        input.baseProjectRevision
      );
      const existingPinnedChecks =
        await assertPinnedSetIntegrity(loaded);

      const orderedChapters = orderedChapterCards(loaded.index);
      const nextChapter =
        orderedChapters[loaded.index.ledger.commits.length];
      if (!nextChapter || nextChapter.id !== input.chapterCardId) {
        throw new Error("长篇连续性提交必须覆盖尚未提交的连续下一章。");
      }
      const chapterEntry = loaded.index.chapters.find(
        ({ chapterCardId }) => chapterCardId === input.chapterCardId
      );
      if (!chapterEntry || chapterEntry.commitId !== null) {
        throw new Error("当前长篇章卡不存在或已经提交。");
      }
      const chapterFiles = await Promise.all(
        [
          chapterEntry.body,
          chapterEntry.characterState,
          chapterEntry.handoff
        ].map(
          async (reference) =>
            await loadIndexedFile(loaded, reference.id)
        )
      );
      const expectedChapterFileRevisions = [
        input.chapterFileRevisions.body,
        input.chapterFileRevisions.characterState,
        input.chapterFileRevisions.handoff
      ];
      for (const [index, chapterFile] of chapterFiles.entries()) {
        const expectedRevision = expectedChapterFileRevisions[index]!;
        if (
          !longRevisionsMatchContent(
            expectedRevision,
            chapterFile.disk.revision,
            chapterFile.disk.bytes
          )
        ) {
          throw new LongProjectConflictError(
            "file",
            expectedRevision,
            chapterFile.disk.revision
          );
        }
        if (!chapterFile.disk.content.trim()) {
          throw new Error(
            "提交章节前必须完成正文、角色状态和下一章交接摘要三份文档。"
          );
        }
      }
      const newlyPinnedChecks: ProjectTransactionFileOperation[] =
        chapterFiles.map((chapterFile) => ({
          action: "check",
          path: chapterFile.reference.path,
          expectedSha256: chapterFile.disk.sha256
        }));

      const placements = loaded.index.plot.narrativePlacements.filter(
        ({ chapterCardId }) => chapterCardId === input.chapterCardId
      );
      assertExactDecisionIds(
        "叙事落点",
        placements.map(({ id }) => id),
        Object.keys(input.placementDecisions)
      );
      const placementById = new Map(
        loaded.index.plot.narrativePlacements.map((placement) => [
          placement.id,
          placement
        ])
      );
      const beats = loaded.index.plot.foreshadowing.flatMap((thread) =>
        thread.beats.filter((beat) => {
          const placement =
            beat.placementId === null
              ? undefined
              : placementById.get(beat.placementId);
          return (
            (beat.chapterCardId ?? placement?.chapterCardId ?? null) ===
            input.chapterCardId
          );
        })
      );
      assertExactDecisionIds(
        "伏笔节拍",
        beats.map(({ id }) => id),
        Object.keys(input.foreshadowingBeatDecisions)
      );
      for (const beat of beats) {
        const beatDecision =
          input.foreshadowingBeatDecisions[beat.id]!;
        if (
          beatDecision.status !== "committed" ||
          beat.placementId === null
        ) {
          continue;
        }
        const placement = placementById.get(beat.placementId);
        if (!placement) {
          throw new Error(
            `伏笔节拍 ${beat.id} 绑定的叙事落点不存在。`
          );
        }
        if (
          input.placementDecisions[placement.id]?.status !== "committed"
        ) {
          throw new Error(
            "已提交的伏笔节拍要求其绑定叙事落点也标记为 committed。"
          );
        }
        if (beat.eventId !== placement.eventId) {
          throw new Error(
            "已提交的伏笔节拍与其绑定叙事落点必须引用同一事件。"
          );
        }
      }

      const commitId = createId("commit");
      const timestamp = this.timestamp();
      const placementChanges: LongLedgerCommitRecord["placementChanges"] =
        placements.map((placement) => {
          const decision = input.placementDecisions[placement.id]!;
          const change = {
            placementId: placement.id,
            before: {
              status: placement.status,
              commitId: placement.commitId
            },
            after: {
              status: decision.status,
              commitId
            },
            note: decision.note
          };
          placement.status = decision.status;
          placement.commitId = commitId;
          return change;
        });
      const foreshadowingBeatChanges: LongLedgerCommitRecord["foreshadowingBeatChanges"] =
        beats.map((beat) => {
          const decision = input.foreshadowingBeatDecisions[beat.id]!;
          const change = {
            beatId: beat.id,
            before: {
              status: beat.status,
              commitId: beat.commitId
            },
            after: {
              status: decision.status,
              commitId
            },
            note: decision.note
          };
          beat.status = decision.status;
          beat.commitId = commitId;
          return change;
        });
      const decidedBeatIds = new Set(beats.map(({ id }) => id));
      const foreshadowingThreadChanges: LongLedgerCommitRecord["foreshadowingThreadChanges"] =
        loaded.index.plot.foreshadowing
          .filter((thread) =>
            thread.beats.some((beat) => decidedBeatIds.has(beat.id))
          )
          .map((thread) => {
            const before = thread.status;
            const after = deriveLongForeshadowingStatus(thread);
            thread.status = after;
            return {
              foreshadowingId: thread.id,
              before,
              after
            };
          });

      const updateIds = input.fileUpdates.map(({ fileId }) => fileId);
      if (new Set(updateIds).size !== updateIds.length) {
        throw new Error("连续性提交不能重复更新同一文件。");
      }
      const chapterFileIds = new Set(
        loaded.index.chapters.flatMap((chapter) => [
          chapter.body.id,
          chapter.characterState.id,
          chapter.handoff.id
        ])
      );
      const continuityFileRoles = new Map<
        string,
        {
          characterId: string;
          role: "relationships" | "current-state" | "history";
        }
      >();
      for (const entry of loaded.index.characterFiles) {
        continuityFileRoles.set(entry.relationships.id, {
          characterId: entry.characterId,
          role: "relationships"
        });
        continuityFileRoles.set(entry.currentState.id, {
          characterId: entry.characterId,
          role: "current-state"
        });
        continuityFileRoles.set(entry.history.id, {
          characterId: entry.characterId,
          role: "history"
        });
      }
      if (loaded.index.ledger.commits.length === 0) {
        const updatedFileIds = new Set(updateIds);
        for (const entry of loaded.index.characterFiles) {
          for (const reference of [
            entry.relationships,
            entry.currentState,
            entry.history
          ]) {
            if (updatedFileIds.has(reference.id)) continue;
            const file = await loadIndexedFile(loaded, reference.id);
            newlyPinnedChecks.push({
              action: "check",
              path: file.reference.path,
              expectedSha256: file.disk.sha256
            });
          }
        }
      }
      const fileChanges: LongLedgerCommitRecord["fileChanges"] = [];
      const fileOperations: Array<{
        path: string;
        content: string;
        expectedSha256: string | null;
      }> = [];
      for (const update of input.fileUpdates) {
        const file = await loadIndexedFile(loaded, update.fileId);
        const continuityRole = continuityFileRoles.get(update.fileId);
        if (
          file.kind !== "markdown" ||
          chapterFileIds.has(update.fileId) ||
          !continuityRole
        ) {
          throw new Error(
            "连续性提交只能更新人物关系、人物当前状态或追加人物历史。"
          );
        }
        if (
          (continuityRole.role === "history" && update.mode !== "append") ||
          (continuityRole.role !== "history" && update.mode !== "replace")
        ) {
          throw new Error(
            continuityRole.role === "history"
              ? "人物历史只能由连续性账本追加，不能整体替换。"
              : "人物关系和当前状态必须提交完整替换内容。"
          );
        }
        if (update.content.trim().length === 0) {
          throw new Error("连续性资料更新不能是空内容。");
        }
        if (
          !longRevisionsMatchContent(
            update.baseRevision,
            file.disk.revision,
            file.disk.bytes
          )
        ) {
          throw new LongProjectConflictError(
            "file",
            update.baseRevision,
            file.disk.revision
          );
        }
        const afterContent =
          continuityRole.role === "history"
            ? appendLongCharacterHistoryEntry(file.disk.content, {
                chapterCardId: input.chapterCardId,
                commitId,
                committedAt: timestamp,
                content: update.content
              })
            : update.content;
        if (encodeUtf8Strict(afterContent).byteLength > MAX_DOCUMENT_BYTES) {
          throw new Error("连续性资料更新后超过 32 MiB 限制。");
        }
        const afterRevision = createLongFileRevision(afterContent);
        fileChanges.push({
          fileId: file.reference.id,
          path: file.reference.path,
          mode: update.mode,
          before: {
            revision: file.disk.revision,
            content: file.disk.content
          },
          after: {
            revision: afterRevision,
            content: afterContent
          }
        });
        file.reference.revision = afterRevision;
        file.reference.updatedAt = timestamp;
        fileOperations.push({
          path: file.reference.path,
          content: afterContent,
          expectedSha256: file.disk.sha256
        });
      }

      const record = LongLedgerCommitRecordSchema.parse({
        schemaVersion: 2,
        id: commitId,
        bookId: loaded.manifest.id,
        sequence: loaded.index.ledger.commits.length + 1,
        chapterCardId: input.chapterCardId,
        committedAt: timestamp,
        commitMessage: input.commitMessage,
        chapterSummary: input.chapterSummary,
        reversible: true,
        sourceWorkspaceRevision: loaded.index.revision,
        committedWorkspaceRevision: loaded.index.revision + 1,
        sourceProjectRevision: loaded.manifest.revision,
        committedProjectRevision: loaded.manifest.revision + 1,
        previousCommittedThroughChapterId:
          loaded.index.ledger.committedThroughChapterId,
        committedThroughChapterId: input.chapterCardId,
        previousChapterCommitId: chapterEntry.commitId,
        placementChanges,
        foreshadowingBeatChanges,
        foreshadowingThreadChanges,
        fileChanges
      });
      const recordContent = serializeJson(record);
      if (
        encodeUtf8Strict(recordContent).byteLength >
        MAX_LEDGER_RECORD_BYTES
      ) {
        throw new Error(
          "连续性账本记录超过 128 MiB；请缩短本章连续性资料更新后重试。"
        );
      }
      const recordReference: LongWorkspaceFileReference = {
        id: longLedgerCommitFileId(commitId),
        path: ledgerPath(commitId),
        revision: createLongFileRevision(recordContent),
        updatedAt: timestamp
      };
      chapterEntry.commitId = commitId;
      loaded.index.ledger.committedThroughChapterId =
        input.chapterCardId;
      loaded.index.ledger.commits.push({
        id: commitId,
        sequence: record.sequence,
        chapterCardId: input.chapterCardId,
        committedAt: timestamp,
        reversible: record.reversible,
        sourceRevision: loaded.index.revision,
        placementIds: placements.map(({ id }) => id),
        foreshadowingBeatIds: beats.map(({ id }) => id),
        recordFile: recordReference
      });

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
        [...existingPinnedChecks, ...newlyPinnedChecks],
        new Set(fileOperations.map(({ path }) => path))
      );
      try {
        await commitLongProjectTransaction({
          projectRoot: loaded.projectDirectory,
          operations: [
            ...integrityChecks,
            ...fileOperations,
            {
              path: recordReference.path,
              content: recordContent,
              expectedSha256: null
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
      const next = await this.loadProject(loaded.projectDirectory);
      return {
        record,
        workspaceRevision: next.index.revision,
        projectRevision: next.manifest.revision
      };
    });
  }

  async rollbackLastCommit(
    projectDirectory: string,
    rawInput: StoreRollbackLastCommitInput
  ): Promise<LongRollbackLastCommitResult> {
    const canonical = await secureDirectory(
      projectDirectory,
      "长篇项目目录"
    );
    return await this.runExclusive(canonical, async () => {
      const loaded = await this.loadProject(canonical);
      const input = LongRollbackLastCommitInputSchema.parse({
        ...rawInput,
        bookId: loaded.manifest.id
      });
      assertProjectRevisions(
        loaded,
        input.baseWorkspaceRevision,
        input.baseProjectRevision
      );
      const existingPinnedChecks =
        await assertPinnedSetIntegrity(loaded);
      const lastCommit = loaded.index.ledger.commits.at(-1);
      if (!lastCommit || lastCommit.id !== input.expectedCommitId) {
        throw new Error("只能回滚当前连续性账本中的最后一次提交。");
      }
      if (!lastCommit.reversible) {
        throw new Error("最后一次连续性提交不可回滚。");
      }
      const recordFile = await loadIndexedFile(
        loaded,
        lastCommit.recordFile.id
      );
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
        ({ chapterCardId }) =>
          chapterCardId === lastCommit.chapterCardId
      );
      if (!chapterEntry || chapterEntry.commitId !== record.id) {
        throw new Error("最后提交的章节状态已发生变化，不能安全回滚。");
      }
      const newlyUnpinnedChecks: ProjectTransactionFileOperation[] = [];
      for (const reference of [
        chapterEntry.body,
        chapterEntry.characterState,
        chapterEntry.handoff
      ]) {
        const file = await loadIndexedFile(loaded, reference.id);
        newlyUnpinnedChecks.push({
          action: "check",
          path: file.reference.path,
          expectedSha256: file.disk.sha256
        });
      }
      if (loaded.index.ledger.commits.length === 1) {
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
        loaded.index.plot.foreshadowing.map((thread) => [
          thread.id,
          thread
        ])
      );
      for (const change of record.foreshadowingThreadChanges) {
        const thread = foreshadowingById.get(change.foreshadowingId);
        if (!thread || thread.status !== change.after) {
          throw new Error(
            "伏笔线状态已在提交后发生变化，不能安全回滚。"
          );
        }
        thread.status = change.before;
      }

      const timestamp = this.timestamp();
      const fileOperations: Array<{
        path: string;
        content: string;
        expectedSha256: string | null;
      }> = [];
      const rollbackContinuityRoles = new Map<
        string,
        {
          path: string;
          role: "relationships" | "current-state" | "history";
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
      for (const change of record.fileChanges) {
        const continuityRole = rollbackContinuityRoles.get(change.fileId);
        if (
          !continuityRole ||
          continuityRole.path !== change.path ||
          (continuityRole.role === "history" &&
            change.mode !== "append") ||
          (continuityRole.role !== "history" &&
            change.mode !== "replace")
        ) {
          throw new Error(
            "连续性账本包含越权文件变更，不能安全回滚。"
          );
        }
        if (
          !longRevisionMatchesBytes(
            change.before.revision,
            change.before.content
          ) ||
          !longRevisionMatchesBytes(
            change.after.revision,
            change.after.content
          )
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
      const next = await this.loadProject(loaded.projectDirectory);
      return {
        bookId: next.manifest.id,
        rolledBackCommitId: record.id,
        committedThroughChapterId:
          next.index.ledger.committedThroughChapterId,
        workspaceRevision: next.index.revision,
        projectRevision: next.manifest.revision
      };
    });
  }

  private createInitialProjectFiles(
    bookId: string,
    input: CreateLongBookInput
  ): InitialProjectFiles {
    const timestamp = this.timestamp();
    const volumeId = createId("volume");
    const arcId = createId("arc");
    const chapterId = createId("chapter");
    const emptyRevision = createLongFileRevision("");
    const file = (
      id: string,
      path: string,
      content = ""
    ): LongWorkspaceFileReference => ({
      id,
      path,
      revision:
        content === "" ? emptyRevision : createLongFileRevision(content),
      updatedAt: timestamp
    });
    const emptyWorldbuildingList =
      serializeLongWorldbuildingMarkdownList([]);

    const worldbuilding = DEFAULT_WORLD_CATEGORIES.map(
      ([id, title], index) => ({
        id,
        title,
        order: index + 1,
        format: "list" as const,
        contentAuthority: "markdown" as const,
        file: file(
          longWorldbuildingFileId(id),
          worldbuildingPath(id),
          emptyWorldbuildingList
        )
      })
    );
    const chapterBody = file(
      longChapterBodyFileId(chapterId),
      chapterPath(chapterId, "body.md")
    );
    const chapterState = file(
      longChapterCharacterStateFileId(chapterId),
      chapterPath(chapterId, "character-state.md")
    );
    const chapterHandoff = file(
      longChapterHandoffFileId(chapterId),
      chapterPath(chapterId, "handoff.md")
    );

    const index = LongWorkspaceIndexSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 0,
      bookId,
      updatedAt: timestamp,
      bookLine: file(LONG_BOOK_LINE_FILE_ID, BOOK_LINE_PATH),
      worldbuilding,
      characters: [],
      characterFiles: [],
      plot: {
        volumes: [
          { id: volumeId, title: "第一卷", order: 1, summary: "" }
        ],
        arcs: [
          {
            id: arcId,
            volumeId,
            title: "第一剧情弧线",
            order: 1,
            outline: ""
          }
        ],
        chapterCards: [
          {
            id: chapterId,
            volumeId,
            primaryArcId: arcId,
            title: "第一章",
            narrativeOrder: 1,
            outline: "",
            worldConstraints: "",
            characterIds: []
          }
        ],
        storyEvents: [],
        eventConnections: [],
        narrativePlacements: [],
        foreshadowing: []
      },
      chapters: [
        {
          chapterCardId: chapterId,
          body: chapterBody,
          characterState: chapterState,
          handoff: chapterHandoff,
          commitId: null
        }
      ],
      ledger: { committedThroughChapterId: null, commits: [] }
    });
    const indexContent = serializeJson(index);
    const manifest = LongProjectManifestSchema.parse({
      schemaVersion: 1,
      revision: 0,
      kind: "deepwrite.long-book",
      id: bookId,
      title: input.title,
      bookType: "long",
      genre: input.genre,
      status: "editing",
      linkedMaterialIdsByKind:
        input.linkedMaterialIdsByKind ?? EMPTY_LINKED_MATERIALS,
      linkedSkillIdsByKind:
        input.linkedSkillIdsByKind ?? EMPTY_LINKED_SKILLS,
      createdAt: timestamp,
      updatedAt: timestamp,
      workspaceIndexFile: {
        id: LONG_WORKSPACE_INDEX_FILE_ID,
        path: LONG_WORKSPACE_INDEX_PATH,
        revision: createLongFileRevision(indexContent),
        updatedAt: timestamp
      }
    });

    return {
      manifest,
      index,
      operations: [
        {
          path: BOOK_LINE_PATH,
          content: "",
          expectedSha256: null as null
        },
        ...worldbuilding.map(({ file: worldFile }) => ({
          path: worldFile.path,
          content: emptyWorldbuildingList,
          expectedSha256: null as null
        })),
        ...[chapterBody.path, chapterState.path, chapterHandoff.path].map(
          (path) => ({
            path,
            content: "",
            expectedSha256: null as null
          })
        ),
        {
          path: LONG_WORKSPACE_INDEX_PATH,
          content: indexContent,
          expectedSha256: null
        },
        {
          path: MANIFEST_PATH,
          content: serializeJson(manifest),
          expectedSha256: null
        }
      ]
    };
  }

  private async loadProject(
    rawProjectDirectory: string
  ): Promise<LoadedLongProject> {
    let projectDirectory = await secureDirectory(
      rawProjectDirectory,
      "长篇项目目录"
    );
    await recoverProjectTransaction(
      projectDirectory,
      MAX_LEDGER_RECORD_BYTES
    );
    projectDirectory = await secureDirectory(projectDirectory, "长篇项目目录");

    const manifestDisk = await readSecureTextFile(
      projectDirectory,
      MANIFEST_PATH,
      MAX_MANIFEST_BYTES
    );
    const manifest = LongProjectManifestSchema.parse(
      parseJson(manifestDisk.content, "长篇项目 manifest")
    );
    const indexDisk = await readSecureTextFile(
      projectDirectory,
      manifest.workspaceIndexFile.path,
      MAX_INDEX_BYTES
    );
    const index = LongWorkspaceIndexSnapshotSchema.parse(
      parseJson(indexDisk.content, "长篇工作区索引")
    );

    if (
      !longRevisionsMatchContent(
        manifest.workspaceIndexFile.revision,
        indexDisk.revision,
        indexDisk.bytes
      )
    ) {
      throw new Error("长篇 manifest 中的索引 revision 与实际文件不一致。");
    }
    if (manifest.id !== index.bookId) {
      throw new Error("长篇 manifest 与工作区索引的 book id 不一致。");
    }
    if (manifest.revision !== index.revision) {
      throw new Error("长篇项目 revision 与工作区 revision 不一致。");
    }
    if (
      manifest.updatedAt !== index.updatedAt ||
      manifest.workspaceIndexFile.updatedAt !== index.updatedAt
    ) {
      throw new Error("长篇 manifest 与工作区索引的更新时间不一致。");
    }

    const slots = indexedFileSlots(index);
    validatePortableAndCanonicalPaths(slots);
    const files = new Map<string, IndexedFileDescriptor>();
    for (const slot of slots) {
      files.set(slot.reference.id, {
        reference: slot.reference,
        kind: slot.kind,
        disk: null
      });
    }

    // Opening a long-form project validates only its compact manifest and
    // workspace index. Potentially large Markdown bodies and ledger records
    // are securely read and revision-checked only when the caller requests
    // that specific file.
    const hydratedIndex = index;
    const book = LongBookSchema.parse({
      schemaVersion: hydratedIndex.schemaVersion,
      id: manifest.id,
      title: manifest.title,
      bookType: "long",
      genre: manifest.genre,
      status: manifest.status,
      linkedMaterialIdsByKind: manifest.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: manifest.linkedSkillIdsByKind,
      projectRevision: manifest.revision,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      workspaceIndex: hydratedIndex
    });
    const summary = createLongBookSummary(book);
    return {
      projectDirectory,
      manifest,
      manifestDisk,
      index: hydratedIndex,
      indexDisk,
      files,
      book,
      summary
    };
  }

  private timestamp(): string {
    const value = this.now();
    if (!Number.isFinite(Date.parse(value))) {
      throw new Error("长篇项目时间提供器返回了无效时间。");
    }
    return value;
  }

  private async runExclusive<T>(
    key: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.queues.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.queues.get(key) === tail) {
        this.queues.delete(key);
      }
    }
  }
}

export function createLongFileRevision(
  content: string | Uint8Array
): LongFileRevision {
  const bytes =
    typeof content === "string" ? encodeUtf8Strict(content) : Buffer.from(content);
  const hash = projectTransactionContentSha256(bytes);
  return `v2:${bytes.byteLength}:${hash}` as LongFileRevision;
}

function longRevisionMatchesBytes(
  revision: LongFileRevision,
  content: string | Uint8Array
): boolean {
  const bytes =
    typeof content === "string" ? encodeUtf8Strict(content) : Buffer.from(content);
  const match = /^(v1|v2):(\d+):([0-9a-f]+)$/u.exec(revision);
  if (!match || Number(match[2]) !== bytes.byteLength) return false;
  const sha256 = projectTransactionContentSha256(bytes);
  return match[1] === "v1"
    ? sha256.startsWith(match[3]!)
    : sha256 === match[3];
}

function longRevisionsMatchContent(
  left: LongFileRevision,
  right: LongFileRevision,
  content: string | Uint8Array
): boolean {
  return (
    longRevisionMatchesBytes(left, content) &&
    longRevisionMatchesBytes(right, content)
  );
}

function orderedChapterCards(index: LongWorkspaceIndexSnapshot) {
  const volumeOrder = new Map(
    index.plot.volumes.map((volume) => [volume.id, volume.order])
  );
  return [...index.plot.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder
  );
}

function assertProjectRevisions(
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

async function assertPinnedSetIntegrity(
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
      parseJson(
        recordFile.disk.content,
        `长篇连续性账本记录 ${entry.id}`
      )
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
      chapter.characterState,
      chapter.handoff
    ]) {
      addCheck(await loadIndexedFile(loaded, reference.id));
    }
  }
  if (loaded.index.ledger.commits.length > 0) {
    for (const entry of loaded.index.characterFiles) {
      for (const reference of [
        entry.relationships,
        entry.currentState,
        entry.history
      ]) {
        addCheck(await loadIndexedFile(loaded, reference.id));
      }
    }
  }
  return [...checks.values()];
}

function mergeIntegrityChecks(
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

function assertMutableChapterDocument(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): void {
  const committedChapter = index.chapters.find(
    (chapter) =>
      chapter.commitId !== null &&
      (chapter.body.id === fileId ||
        chapter.characterState.id === fileId ||
        chapter.handoff.id === fileId)
  );
  if (committedChapter) {
    throw new Error(
      "已提交章节的正文、角色状态和交接摘要不可直接编辑；请先回滚最后一次连续性提交。"
    );
  }
}

function assertDirectlyMutableDocument(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): void {
  if (
    index.worldbuilding.some(
      (category) =>
        category.id.startsWith(MIGRATION_EVIDENCE_WORLD_ID_PREFIX) &&
        category.file.id === fileId
    )
  ) {
    throw new Error("只读迁移证据不能修改。");
  }
  assertMutableChapterDocument(index, fileId);
  if (
    index.ledger.commits.length > 0 &&
    index.characterFiles.some(
      (entry) =>
        entry.relationships.id === fileId ||
        entry.currentState.id === fileId ||
        entry.history.id === fileId
    )
  ) {
    throw new Error(
      "首次连续性提交后，人物关系、当前状态和历史轨迹只能通过连续性账本更新；核心档案仍可直接编辑。"
    );
  }
}

function appendLongCharacterHistoryEntry(
  existing: string,
  entry: {
    chapterCardId: string;
    commitId: string;
    committedAt: string;
    content: string;
  }
): string {
  const separator =
    existing.length === 0
      ? ""
      : existing.endsWith("\n\n")
        ? ""
        : existing.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${existing}${separator}## 章节 ${entry.chapterCardId} · ${entry.committedAt}\n\n提交：${entry.commitId}\n\n${entry.content.trim()}\n`;
}

export function deriveLongForeshadowingStatus(
  thread: LongForeshadowing
): LongForeshadowingStatus {
  if (thread.status === "abandoned") return "abandoned";
  return deriveLongForeshadowingStatusFromCommittedBeats(thread.beats);
}

function assertExactDecisionIds(
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

function indexedFileSlots(
  index: LongWorkspaceIndexSnapshot
): IndexedFileSlot[] {
  return [
    {
      reference: index.bookLine,
      expectedPath: BOOK_LINE_PATH,
      kind: "markdown"
    },
    ...index.worldbuilding.map((category) => ({
      reference: category.file,
      expectedPath: worldbuildingPath(category.id),
      kind: "markdown" as const
    })),
    ...index.characterFiles.flatMap((entry) => [
      {
        reference: entry.coreProfile,
        expectedPath: characterPath(entry.characterId, "core-profile.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.relationships,
        expectedPath: characterPath(entry.characterId, "relationships.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.currentState,
        expectedPath: characterPath(entry.characterId, "current-state.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.history,
        expectedPath: characterPath(entry.characterId, "history.md"),
        kind: "markdown" as const
      }
    ]),
    ...index.chapters.flatMap((entry) => [
      {
        reference: entry.body,
        expectedPath: chapterPath(entry.chapterCardId, "body.md"),
        kind: "markdown" as const
      },
      {
        reference: entry.characterState,
        expectedPath: chapterPath(
          entry.chapterCardId,
          "character-state.md"
        ),
        kind: "markdown" as const
      },
      {
        reference: entry.handoff,
        expectedPath: chapterPath(entry.chapterCardId, "handoff.md"),
        kind: "markdown" as const
      }
    ]),
    ...index.ledger.commits.map((commit) => ({
      reference: commit.recordFile,
      expectedPath: ledgerPath(commit.id),
      kind: "json" as const
    }))
  ];
}

function validateImportPlan(
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
  const slotById = new Map(
    slots.map((slot) => [slot.reference.id, slot])
  );
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

function validatePortableAndCanonicalPaths(slots: IndexedFileSlot[]): void {
  const keys = new Set<string>([
    portablePathKey(MANIFEST_PATH),
    portablePathKey(LONG_WORKSPACE_INDEX_PATH)
  ]);
  for (const slot of slots) {
    if (!isCompatibleRolePath(slot)) {
      throw new Error(
        `长篇文件路径不符合其文件角色：${slot.reference.path}`
      );
    }
    const key = portablePathKey(slot.reference.path);
    if (keys.has(key)) {
      throw new Error(`长篇文件路径存在大小写或 Unicode 等价冲突：${slot.reference.path}`);
    }
    keys.add(key);
  }
}

function isCompatibleRolePath(slot: IndexedFileSlot): boolean {
  if (slot.reference.path === slot.expectedPath) return true;
  if (slot.kind === "json") return false;
  const parts = slot.reference.path.split("/");
  if (
    slot.expectedPath.startsWith("long/worldbuilding/") &&
    parts.length === 4
  ) {
    return (
      parts[0] === "long" &&
      parts[1] === "worldbuilding" &&
      Boolean(parts[2]) &&
      parts[3] === "content.md"
    );
  }
  if (
    slot.expectedPath.startsWith("long/characters/") &&
    parts.length === 4
  ) {
    return (
      parts[0] === "long" &&
      parts[1] === "characters" &&
      Boolean(parts[2]) &&
      parts[3] === basename(slot.expectedPath)
    );
  }
  if (
    slot.expectedPath.startsWith("long/chapters/") &&
    parts.length === 4
  ) {
    return (
      parts[0] === "long" &&
      parts[1] === "chapters" &&
      Boolean(parts[2]) &&
      parts[3] === basename(slot.expectedPath)
    );
  }
  return false;
}

function storageKey(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, 32);
}

function worldbuildingPath(categoryId: string): string {
  return `long/worldbuilding/${storageKey(categoryId)}/content.md`;
}

function characterPath(characterId: string, filename: string): string {
  return `long/characters/${storageKey(characterId)}/${filename}`;
}

function chapterPath(chapterId: string, filename: string): string {
  return `long/chapters/${storageKey(chapterId)}/${filename}`;
}

function ledgerPath(commitId: string): string {
  return `long/ledger/${storageKey(commitId)}.json`;
}

function portablePathKey(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

function requireIndexedFileDescriptor(
  loaded: LoadedLongProject,
  fileId: string
): IndexedFileDescriptor {
  const file = loaded.files.get(fileId);
  if (!file) {
    throw new Error(`长篇项目中不存在文件 ID：${fileId}`);
  }
  return file;
}

function isPinnedMarkdownFile(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): boolean {
  if (
    index.chapters.some(
      (chapter) =>
        chapter.commitId !== null &&
        (chapter.body.id === fileId ||
          chapter.characterState.id === fileId ||
          chapter.handoff.id === fileId)
    )
  ) {
    return true;
  }
  return (
    index.ledger.commits.length > 0 &&
    index.characterFiles.some(
      (entry) =>
        entry.relationships.id === fileId ||
        entry.currentState.id === fileId ||
        entry.history.id === fileId
    )
  );
}

async function loadIndexedFile(
  loaded: LoadedLongProject,
  fileId: string
): Promise<LoadedIndexedFile> {
  const descriptor = requireIndexedFileDescriptor(loaded, fileId);
  if (descriptor.disk) {
    return descriptor as LoadedIndexedFile;
  }
  const disk = await readSecureTextFile(
    loaded.projectDirectory,
    descriptor.reference.path,
    descriptor.kind === "json"
      ? MAX_LEDGER_RECORD_BYTES
      : MAX_DOCUMENT_BYTES
  );
  const indexedRevisionMatchesDisk = longRevisionsMatchContent(
    descriptor.reference.revision,
    disk.revision,
    disk.bytes
  );
  if (
    (descriptor.kind === "json" ||
      isPinnedMarkdownFile(loaded.index, descriptor.reference.id)) &&
    !indexedRevisionMatchesDisk
  ) {
    throw new Error(
      `长篇已锁定文件 revision 不一致，检测到索引外修改：${descriptor.reference.path}`
    );
  }
  // Markdown files intentionally tolerate external editing. The first actual
  // read hydrates the in-memory reference with the content revision that all
  // subsequent CAS writes in this operation must use.
  descriptor.reference.revision = disk.revision;
  descriptor.reference.updatedAt = disk.updatedAt;
  descriptor.disk = disk;
  return descriptor as LoadedIndexedFile;
}

interface ScannedSearchFile {
  fileId: string;
  revision: LongFileRevision;
  characterLength: number;
  scannedCharacters: number;
  matches: LongProjectSearchMatch[];
  nextMatchOffset: number | null;
}

function parseProjectSearchResume(
  raw: LongProjectSearchResume | undefined,
  fileIds: readonly string[]
): LongProjectSearchResume | undefined {
  if (raw === undefined) return undefined;
  const fileIndex = nonnegativeInteger(raw.fileIndex, "搜索游标文件位置");
  const characterOffset = nonnegativeInteger(
    raw.characterOffset,
    "搜索游标字符位置"
  );
  const fileId = LongFileIdSchema.parse(raw.fileId);
  const fileRevision = LongFileRevisionSchema.parse(raw.fileRevision);
  if (fileIndex >= fileIds.length || fileIds[fileIndex] !== fileId) {
    throw new Error("长篇搜索游标与当前文件顺序不一致。");
  }
  return { fileIndex, fileId, fileRevision, characterOffset };
}

async function scanIndexedFileForSearch(
  file: LoadedPagedIndexedFile,
  query: string,
  characterOffset: number,
  maxMatches: number,
  contextCharacters: number,
  expectedRevision: LongFileRevision | undefined,
  characterBudget: number
): Promise<ScannedSearchFile> {
  const { disk, paging } = file;
  if (
    expectedRevision !== undefined &&
    !longRevisionMatchesSecureTextFile(expectedRevision, disk)
  ) {
    throw new Error("长篇搜索游标对应的文件已发生变化，请重新搜索。");
  }
  if (characterOffset > paging.totalCharacters) {
    throw new Error("长篇搜索游标字符位置已失效，请重新搜索。");
  }

  const normalizedWindow = createNormalizedSearchWindow(
    paging,
    characterOffset,
    Math.max(1, characterBudget),
    query
  );
  const matcher = new RegExp(escapeRegularExpression(query), "giu");
  const matches: LongProjectSearchMatch[] = [];
  const seenRanges = new Set<string>();
  while (true) {
    const match = matcher.exec(normalizedWindow.normalized);
    if (!match) {
      return {
        fileId: file.reference.id,
        revision: disk.revision,
        characterLength: paging.totalCharacters,
        scannedCharacters:
          normalizedWindow.scanEndCharacterOffset - characterOffset,
        matches,
        nextMatchOffset:
          normalizedWindow.scanEndCharacterOffset < paging.totalCharacters
            ? normalizedWindow.scanEndCharacterOffset
            : null
      };
    }
    const sourceRange = normalizedWindow.directNfc
      ? {
          start: characterOffsetAtCodeUnit(
            paging,
            normalizedWindow.sourceStartCodeUnit + match.index
          ),
          end: characterOffsetAtCodeUnit(
            paging,
            normalizedWindow.sourceStartCodeUnit +
              match.index +
              match[0].length
          )
        }
      : normalizedMatchSourceRange(
          normalizedWindow.segments,
          match.index,
          match.index + match[0].length
        );
    if (
      !sourceRange ||
      sourceRange.start >= normalizedWindow.scanEndCharacterOffset
    ) {
      continue;
    }
    const rangeKey = `${sourceRange.start}:${sourceRange.end}`;
    if (seenRanges.has(rangeKey)) continue;
    if (matches.length >= maxMatches) {
      return {
        fileId: file.reference.id,
        revision: disk.revision,
        characterLength: paging.totalCharacters,
        scannedCharacters: Math.max(
          1,
          sourceRange.start - characterOffset
        ),
        matches,
        nextMatchOffset: sourceRange.start
      };
    }
    seenRanges.add(rangeKey);
    const sourceStartCodeUnit = codeUnitOffsetAtCharacter(
      paging,
      sourceRange.start
    );
    matches.push({
      fileId: file.reference.id,
      path: file.reference.path,
      revision: disk.revision,
      offset: sourceRange.start,
      endOffset: sourceRange.end,
      line: 1 + countNewlines(disk.content, 0, sourceStartCodeUnit),
      preview: sliceIndexedUnicodeCodePointRange(
        paging,
        Math.max(0, sourceRange.start - contextCharacters),
        Math.min(
          paging.totalCharacters,
          sourceRange.end + contextCharacters
        )
      )
    });
  }
}

function longRevisionMatchesSecureTextFile(
  revision: LongFileRevision,
  disk: SecureTextFile
): boolean {
  const match = /^(v1|v2):(\d+):([0-9a-f]+)$/u.exec(revision);
  if (!match || Number(match[2]) !== disk.size) return false;
  return match[1] === "v1"
    ? disk.sha256.startsWith(match[3]!)
    : disk.sha256 === match[3];
}

interface NormalizedSearchSegment {
  normalizedStart: number;
  normalizedEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

function createNormalizedSearchWindow(
  paging: CachedPagedTextFile,
  characterOffset: number,
  characterBudget: number,
  query: string
): {
  normalized: string;
  segments: NormalizedSearchSegment[];
  scanEndCharacterOffset: number;
  directNfc: boolean;
  sourceStartCodeUnit: number;
} {
  const targetScanEnd = Math.min(
    paging.totalCharacters,
    characterOffset + characterBudget
  );
  const overlap = Math.max(32, countUnicodeCodePoints(query) + 8);
  const sourceEnd = Math.min(
    paging.totalCharacters,
    targetScanEnd + overlap
  );
  const source = sliceIndexedUnicodeCodePointRange(
    paging,
    characterOffset,
    sourceEnd
  );
  const sourceStartCodeUnit = codeUnitOffsetAtCharacter(
    paging,
    characterOffset
  );
  if (source.normalize("NFC") === source) {
    return {
      normalized: source,
      segments: [],
      scanEndCharacterOffset: targetScanEnd,
      directNfc: true,
      sourceStartCodeUnit
    };
  }
  const segmenter = new Intl.Segmenter("und", {
    granularity: "grapheme"
  });
  const normalizedParts: string[] = [];
  const segments: NormalizedSearchSegment[] = [];
  let normalizedLength = 0;
  let sourceCharacterCursor = characterOffset;
  let scanEndCharacterOffset = targetScanEnd;
  for (const segment of segmenter.segment(source)) {
    const sourceCharacters = countUnicodeCodePoints(segment.segment);
    const sourceStart = sourceCharacterCursor;
    const sourceEndOffset = sourceStart + sourceCharacters;
    const normalized = segment.segment.normalize("NFC");
    normalizedParts.push(normalized);
    segments.push({
      normalizedStart: normalizedLength,
      normalizedEnd: normalizedLength + normalized.length,
      sourceStart,
      sourceEnd: sourceEndOffset
    });
    normalizedLength += normalized.length;
    sourceCharacterCursor = sourceEndOffset;
    if (
      sourceStart < targetScanEnd &&
      sourceEndOffset >= targetScanEnd
    ) {
      scanEndCharacterOffset = sourceEndOffset;
    }
  }
  return {
    normalized: normalizedParts.join(""),
    segments,
    scanEndCharacterOffset: Math.min(
      scanEndCharacterOffset,
      paging.totalCharacters
    ),
    directNfc: false,
    sourceStartCodeUnit
  };
}

function normalizedMatchSourceRange(
  segments: readonly NormalizedSearchSegment[],
  normalizedStart: number,
  normalizedEnd: number
): { start: number; end: number } | null {
  const first = segments.find(
    (segment) =>
      segment.normalizedEnd > normalizedStart &&
      segment.normalizedStart < normalizedEnd
  );
  if (!first) return null;
  let last = first;
  for (const segment of segments) {
    if (segment.normalizedStart >= normalizedEnd) break;
    if (segment.normalizedEnd > normalizedStart) last = segment;
  }
  return { start: first.sourceStart, end: last.sourceEnd };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countNewlines(text: string, start: number, end: number): number {
  let count = 0;
  let cursor = text.indexOf("\n", start);
  while (cursor >= 0 && cursor < end) {
    count += 1;
    cursor = text.indexOf("\n", cursor + 1);
  }
  return count;
}

function requireIndexedFileReference(
  index: LongWorkspaceIndexSnapshot,
  fileId: string
): LongWorkspaceFileReference {
  const file = indexedFileSlots(index).find(
    (slot) => slot.reference.id === fileId
  )?.reference;
  if (!file) {
    throw new Error(`长篇索引中不存在文件 ID：${fileId}`);
  }
  return file;
}

const WORLDBUILDING_CONVERTED_ITEM_CHARACTERS = 900_000;
const WORLDBUILDING_RESERVED_ITEM_MARKER =
  "<!-- deepwrite-world-item:";

function convertWorldbuildingListToText(content: string): string {
  const items = parseLongWorldbuildingMarkdownList(content);
  if (items.length === 0) return "";
  return `${items
    .map((item) => {
      const body = item.content.replace(/\s+$/u, "");
      return [
        `<!-- 原列表条目 ID：${item.id} -->`,
        `## ${item.title}`,
        ...(body ? ["", body] : [])
      ].join("\n");
    })
    .join("\n\n")}\n`;
}

function convertWorldbuildingTextToList(
  categoryId: string,
  content: string
): string {
  if (!content.trim()) {
    return serializeLongWorldbuildingMarkdownList([]);
  }
  if (content.includes(WORLDBUILDING_RESERVED_ITEM_MARKER)) {
    throw new Error(
      "文本中包含 DeepWrite 列表格式的保留标记；为避免改写原文，请先删除或改写该标记后再切换为列表格式。"
    );
  }
  const chunks = splitWorldbuildingText(content);
  const key = storageKey(categoryId).slice(0, 16);
  const items: LongWorldbuildingMarkdownList = chunks.map(
    (chunk, index) => ({
      id: `worlditem_converted-${key}-${index + 1}`,
      title:
        chunks.length === 1
          ? "原文本内容"
          : `原文本内容（${index + 1}/${chunks.length}）`,
      content: chunk
    })
  );
  return serializeLongWorldbuildingMarkdownList(items);
}

function splitWorldbuildingText(content: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(
      content.length,
      offset + WORLDBUILDING_CONVERTED_ITEM_CHARACTERS
    );
    if (
      end < content.length &&
      end > offset &&
      /[\uD800-\uDBFF]/u.test(content[end - 1]!)
    ) {
      end -= 1;
    }
    chunks.push(content.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} 不是有效 JSON。`);
  }
}

function encodeUtf8Strict(content: string): Buffer {
  const bytes = Buffer.from(content, "utf8");
  if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== content) {
    throw new Error("长篇文件内容包含无效 Unicode 字符。");
  }
  return bytes;
}

function createCachedPagedTextFile(
  disk: SecureTextFile
): CachedPagedTextFile {
  const anchors: UnicodePageAnchor[] = [
    { characterOffset: 0, codeUnitOffset: 0 }
  ];
  let characterOffset = 0;
  let codeUnitOffset = 0;
  while (codeUnitOffset < disk.content.length) {
    const codePoint = disk.content.codePointAt(codeUnitOffset)!;
    codeUnitOffset += codePoint > 0xffff ? 2 : 1;
    characterOffset += 1;
    if (characterOffset % UNICODE_PAGE_INDEX_STRIDE === 0) {
      anchors.push({ characterOffset, codeUnitOffset });
    }
  }
  return {
    disk,
    totalCharacters: characterOffset,
    anchors,
    // Account for both UTF-8 bytes and the UTF-16 JS string. Sparse anchors
    // add only a small fixed overhead per 4K Unicode code points.
    cost:
      disk.bytes.byteLength +
      disk.content.length * 2 +
      anchors.length * 16
  };
}

function codeUnitOffsetAtCharacter(
  paging: CachedPagedTextFile,
  targetCharacterOffset: number
): number {
  if (
    targetCharacterOffset < 0 ||
    targetCharacterOffset > paging.totalCharacters
  ) {
    throw new Error("长篇文档字符位置超过文件范围。");
  }
  let low = 0;
  let high = paging.anchors.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      paging.anchors[middle]!.characterOffset <= targetCharacterOffset
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const anchor = paging.anchors[low]!;
  let characterOffset = anchor.characterOffset;
  let codeUnitOffset = anchor.codeUnitOffset;
  while (characterOffset < targetCharacterOffset) {
    const codePoint = paging.disk.content.codePointAt(codeUnitOffset)!;
    codeUnitOffset += codePoint > 0xffff ? 2 : 1;
    characterOffset += 1;
  }
  return codeUnitOffset;
}

function characterOffsetAtCodeUnit(
  paging: CachedPagedTextFile,
  targetCodeUnitOffset: number
): number {
  if (
    targetCodeUnitOffset < 0 ||
    targetCodeUnitOffset > paging.disk.content.length
  ) {
    throw new Error("长篇文档代码单元位置超过文件范围。");
  }
  let low = 0;
  let high = paging.anchors.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (paging.anchors[middle]!.codeUnitOffset <= targetCodeUnitOffset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const anchor = paging.anchors[low]!;
  let characterOffset = anchor.characterOffset;
  let codeUnitOffset = anchor.codeUnitOffset;
  while (codeUnitOffset < targetCodeUnitOffset) {
    const codePoint = paging.disk.content.codePointAt(codeUnitOffset)!;
    codeUnitOffset += codePoint > 0xffff ? 2 : 1;
    characterOffset += 1;
  }
  if (codeUnitOffset !== targetCodeUnitOffset) {
    throw new Error("长篇文档字符位置落在代理对内部。");
  }
  return characterOffset;
}

function sliceIndexedUnicodeCodePointRange(
  paging: CachedPagedTextFile,
  startCharacterOffset: number,
  endCharacterOffset: number
): string {
  if (endCharacterOffset < startCharacterOffset) {
    throw new Error("长篇文档字符范围无效。");
  }
  const start = codeUnitOffsetAtCharacter(
    paging,
    startCharacterOffset
  );
  const end = codeUnitOffsetAtCharacter(paging, endCharacterOffset);
  return paging.disk.content.slice(start, end);
}

function sliceIndexedUnicodeCodePointPage(
  paging: CachedPagedTextFile,
  offset: number,
  limit: number
): {
  content: string;
  totalCharacters: number;
  nextOffset: number | null;
} {
  const pageEnd = Math.min(paging.totalCharacters, offset + limit);
  return {
    content: sliceIndexedUnicodeCodePointRange(paging, offset, pageEnd),
    totalCharacters: paging.totalCharacters,
    nextOffset: pageEnd < paging.totalCharacters ? pageEnd : null
  };
}

function countUnicodeCodePoints(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

async function readPortableBundleSource(sourcePath: string): Promise<string> {
  if (!isAbsolute(sourcePath)) {
    throw new Error("长篇可移植包路径必须是绝对路径。");
  }
  const resolved = resolve(sourcePath);
  const { bytes } = await readNoFollowFile(
    resolved,
    LONG_PORTABLE_BUNDLE_MAX_BYTES,
    "长篇可移植包"
  );
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("长篇可移植包不是有效 UTF-8。");
  }
}

async function readSecureTextFile(
  projectDirectory: string,
  relativePath: string,
  maxBytes: number
): Promise<SecureTextFile> {
  validateStoreFilePath(relativePath);
  const target = resolve(projectDirectory, relativePath);
  assertContained(projectDirectory, target);
  await validateParentDirectories(projectDirectory, dirname(target));
  const { bytes, info } = await readNoFollowFile(
    target,
    maxBytes,
    `长篇项目文件 ${relativePath}`,
    projectDirectory
  );
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`长篇项目文件不是有效 UTF-8：${relativePath}`);
  }
  return {
    content,
    bytes,
    sha256: projectTransactionContentSha256(bytes),
    revision: createLongFileRevision(bytes),
    updatedAt: info.mtime.toISOString(),
    identity: `${info.dev}:${info.ino}`,
    size: Number(info.size),
    mtimeMs: Number(info.mtimeMs),
    ctimeMs: Number(info.ctimeMs)
  };
}

async function secureTextFileMetadataMatches(
  projectDirectory: string,
  relativePath: string,
  maxBytes: number,
  cached: SecureTextFile
): Promise<boolean> {
  validateStoreFilePath(relativePath);
  const target = resolve(projectDirectory, relativePath);
  assertContained(projectDirectory, target);
  await validateParentDirectories(projectDirectory, dirname(target));
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      target,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT") || isNodeError(error, "ELOOP")) {
      return false;
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1 || info.size > maxBytes) {
      return false;
    }
    const canonical = await realpath(target);
    assertContained(projectDirectory, canonical);
    const pathInfo = await lstat(target);
    if (
      pathInfo.isSymbolicLink() ||
      pathInfo.dev !== info.dev ||
      pathInfo.ino !== info.ino
    ) {
      return false;
    }
    return (
      `${info.dev}:${info.ino}` === cached.identity &&
      Number(info.size) === cached.size &&
      Number(info.mtimeMs) === cached.mtimeMs &&
      Number(info.ctimeMs) === cached.ctimeMs
    );
  } finally {
    await handle.close();
  }
}

async function readNoFollowFile(
  path: string,
  maxBytes: number,
  label: string,
  containingRoot?: string
): Promise<{
  bytes: Buffer;
  info: Awaited<ReturnType<typeof lstat>>;
}> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ELOOP"
    ) {
      throw new Error(`${label}不能是符号链接。`);
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1) {
      throw new Error(`${label}必须是无硬链接的普通文件。`);
    }
    if (info.size > maxBytes) {
      throw new Error(`${label}超过大小限制。`);
    }
    const canonical = await realpath(path);
    if (containingRoot) assertContained(containingRoot, canonical);
    const pathInfo = await lstat(path);
    if (
      pathInfo.isSymbolicLink() ||
      pathInfo.dev !== info.dev ||
      pathInfo.ino !== info.ino
    ) {
      throw new Error(`${label}在读取期间发生替换。`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== info.dev ||
      after.ino !== info.ino ||
      after.size !== bytes.byteLength ||
      bytes.byteLength > maxBytes
    ) {
      throw new Error(`${label}在读取期间发生变化。`);
    }
    return { bytes, info: after };
  } finally {
    await handle.close();
  }
}

function validateStoreFilePath(path: string): void {
  if (path === MANIFEST_PATH) return;
  const parsed = LongProjectRelativePathSchema.parse(path);
  if (
    parsed !== path ||
    path.normalize("NFC") !== path ||
    !path.startsWith("long/") ||
    path.startsWith(".deepwrite/")
  ) {
    throw new Error("长篇业务文件必须使用 long/ 下的规范相对路径。");
  }
}

async function validateParentDirectories(
  projectDirectory: string,
  parent: string
): Promise<void> {
  assertContained(projectDirectory, parent);
  const offset = relative(projectDirectory, parent);
  let current = projectDirectory;
  for (const segment of offset ? offset.split(sep) : []) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("长篇项目文件父目录包含符号链接或非目录节点。");
    }
    assertContained(projectDirectory, await realpath(current));
  }
}

async function secureDirectory(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label}必须是真实目录。`);
  }
  return await realpath(resolved);
}

async function requireMissing(path: string, message: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(message);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
}

function assertContained(root: string, candidate: string): void {
  const offset = relative(root, candidate);
  if (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) &&
      offset !== ".." &&
      !isAbsolute(offset))
  ) {
    return;
  }
  throw new Error("长篇项目路径越过项目根目录。");
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}必须是非负整数。`);
  }
  return value;
}

function boundedPositiveInteger(
  value: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label}必须是 1 到 ${maximum} 的整数。`);
  }
  return value;
}

function boundedNonnegativeInteger(
  value: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label}必须是 0 到 ${maximum} 的整数。`);
  }
  return value;
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
