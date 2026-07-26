import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
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
import {
  LongApplyOperationsInputSchema,
  LongApplyOperationsResultSchema,
  LongBookSummarySchema,
  LongCommitChapterInputSchema,
  LongCommitChapterResultSchema,
  LongListBooksResultSchema,
  LongOpenBookInputSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsInputSchema,
  LongPreviewOperationsResultSchema,
  LongReadDocumentInputSchema,
  LongReadDocumentResultSchema,
  LongRemoveBookInputSchema,
  LongRemoveBookResultSchema,
  LongRollbackLastCommitInputSchema,
  LongRollbackLastCommitResultSchema,
  LongSearchInputSchema,
  LongSearchResultSchema,
  LongUpdateBindingsInputSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteChapterInputSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentInputSchema,
  LongWriteDocumentResultSchema,
  previewLongWorkspaceOperations,
  type CreateLongBookInput,
  type LongApplyOperationsInput,
  type LongApplyOperationsResult,
  type LongBookSummary,
  type LongCommitChapterInput,
  type LongCommitChapterResult,
  type LongListBooksResult,
  type LongOpenBookInput,
  type LongOpenBookResult,
  type LongPreviewOperationsInput,
  type LongPreviewOperationsResult,
  type LongReadDocumentInput,
  type LongReadDocumentResult,
  type LongRemoveBookInput,
  type LongRemoveBookResult,
  type LongRollbackLastCommitInput,
  type LongRollbackLastCommitResult,
  type LongSearchInput,
  type LongSearchResult,
  type LongUpdateBindingsInput,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexResult,
  type LongWorkspaceRoot,
  type LongWriteChapterInput,
  type LongWriteChapterResult,
  type LongWriteDocumentInput,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";
import {
  LongProjectCatalog,
  type OpenLongProject
} from "./long-project-catalog";
import {
  LongProjectStore,
  type CreateLongBookInput as StoreCreateLongBookInput,
  type ImportedPortableLongBook,
  type ImportedWriteClawLongBook,
  type ImportWriteClawLongBookOptions,
  type LongProjectSearchResume
} from "./long-project-store";

interface IndexedSearchFile {
  file: LongWorkspaceFileReference;
  root: LongWorkspaceRoot;
  title: string;
}

const PORTABLE_EXPORT_LEASE_MARKER = ".deepwrite-export-lock.";
const PORTABLE_EXPORT_LOCK_TIMEOUT_MS = 10_000;
const PORTABLE_EXPORT_LOCK_RETRY_MS = 20;
const PORTABLE_EXPORT_LOCK_INITIALIZATION_GRACE_MS = 60_000;
const PORTABLE_EXPORT_LOCK_STALE_MS = 60_000;
const PORTABLE_EXPORT_LOCK_HEARTBEAT_MS = 5_000;

export interface LongWorkspaceServiceOptions {
  userDataPath: string;
  now?: () => string;
  onDiagnostic?: (diagnostic: LongWorkspaceServiceDiagnostic) => void;
}

export interface LongWorkspaceServiceDiagnostic {
  code: "catalog-summary-cache-update-failed";
  bookId: string;
  operation:
    | "update-bindings"
    | "write-document"
    | "write-chapter"
    | "commit-chapter"
    | "rollback-last-commit"
    | "apply-operations";
  message: string;
  occurredAt: string;
}

/**
 * Core-facing facade that composes the independent registry and physical
 * store. All public calls are keyed by bookId; raw project paths are confined
 * to create/open registration flows.
 */
export class LongWorkspaceService {
  readonly store: LongProjectStore;
  readonly catalog: LongProjectCatalog;

  private readonly now: () => string;
  private readonly onDiagnostic:
    | ((diagnostic: LongWorkspaceServiceDiagnostic) => void)
    | undefined;
  private readonly diagnostics: LongWorkspaceServiceDiagnostic[] = [];

  constructor(options: LongWorkspaceServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.onDiagnostic = options.onDiagnostic;
    this.store = new LongProjectStore(
      options.now ? { now: options.now } : {}
    );
    this.catalog = new LongProjectCatalog({
      userDataPath: options.userDataPath,
      ...(options.now ? { now: options.now } : {}),
      projects: {
        createBook: async (parentDirectory, input) => {
          return await this.store.createBook(
            parentDirectory,
            normalizeCreateInput(input)
          );
        },
        openBook: async (projectDirectory) => {
          const opened = await this.store.openBook(projectDirectory);
          return { projectDirectory, ...opened };
        },
        inspectBook: async (projectDirectory) => {
          return await this.store.inspectBookManifest(projectDirectory);
        }
      }
    });
  }

  async create(
    parentDirectory: string,
    input: CreateLongBookInput
  ): Promise<LongOpenBookResult> {
    const opened = await this.catalog.create(parentDirectory, input);
    return parseOpenResult(opened);
  }

  async importWriteClawBook(
    parentDirectory: string,
    sourcePath: string,
    options: ImportWriteClawLongBookOptions = {}
  ): Promise<ImportedWriteClawLongBook> {
    const imported = await this.store.importWriteClawBook(
      parentDirectory,
      sourcePath,
      options
    );
    const registered = await this.catalog.openAtPath(
      imported.projectDirectory
    );
    return {
      ...imported,
      projectDirectory: registered.projectDirectory,
      book: registered.book,
      summary: registered.summary
    };
  }

  async importPortableBundle(
    parentDirectory: string,
    sourcePath: string
  ): Promise<ImportedPortableLongBook> {
    const imported = await this.store.importPortableBundle(
      parentDirectory,
      sourcePath
    );
    const registered = await this.catalog.openAtPath(
      imported.projectDirectory
    );
    return {
      ...imported,
      projectDirectory: registered.projectDirectory,
      book: registered.book,
      summary: registered.summary
    };
  }

  async list(): Promise<LongListBooksResult> {
    return LongListBooksResultSchema.parse(await this.catalog.list());
  }

  async openAtPath(projectDirectory: string): Promise<LongOpenBookResult> {
    return parseOpenResult(await this.catalog.openAtPath(projectDirectory));
  }

  async open(input: LongOpenBookInput): Promise<LongOpenBookResult> {
    const parsed = LongOpenBookInputSchema.parse(input);
    return parseOpenResult(await this.catalog.open(parsed.bookId));
  }

  async updateBindings(
    input: LongUpdateBindingsInput
  ): Promise<LongOpenBookResult> {
    const parsed = LongUpdateBindingsInputSchema.parse(input);
    const opened = await this.openProject({ bookId: parsed.bookId });
    const updated = await this.store.updateBindings(
      opened.projectDirectory,
      {
        expectedProjectRevision: parsed.expectedProjectRevision,
        linkedMaterialIdsByKind: {
          character: [...(parsed.linkedMaterialIdsByKind.character ?? [])],
          gimmick: [...(parsed.linkedMaterialIdsByKind.gimmick ?? [])],
          plot: [...(parsed.linkedMaterialIdsByKind.plot ?? [])],
          draft: [...(parsed.linkedMaterialIdsByKind.draft ?? [])],
          other: [...(parsed.linkedMaterialIdsByKind.other ?? [])]
        },
        linkedSkillIdsByKind: {
          general: [...(parsed.linkedSkillIdsByKind.general ?? [])],
          plot: [...(parsed.linkedSkillIdsByKind.plot ?? [])],
          style: [...(parsed.linkedSkillIdsByKind.style ?? [])],
          other: [...(parsed.linkedSkillIdsByKind.other ?? [])]
        }
      }
    );
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      updated.summary,
      "update-bindings"
    );
    return LongOpenBookResultSchema.parse(updated);
  }

  async exportPortableBundle(bookId: string): Promise<string> {
    const opened = await this.openProject({ bookId });
    return await this.store.exportPortableBundle(opened.projectDirectory);
  }

  async exportPortableBundleToPath(
    bookId: string,
    destinationPath: string
  ): Promise<{ filePath: string; bytes: number }> {
    if (!isAbsolute(destinationPath)) {
      throw new Error("长篇可移植包导出路径必须是绝对路径。");
    }
    const opened = await this.openProject({ bookId });
    const projectDirectory = await realpath(opened.projectDirectory);
    const destination = resolve(destinationPath);
    const canonicalParent = await realpath(dirname(destination));
    const canonicalDestination = resolve(
      canonicalParent,
      basename(destination)
    );
    if (isSameOrContainedPath(projectDirectory, canonicalDestination)) {
      throw new Error(
        "长篇可移植包不能导出到源工程目录内，以免覆盖或污染项目文件。"
      );
    }

    const content = await this.store.exportPortableBundle(projectDirectory);
    await atomicWritePortableFile(destination, content);
    return {
      filePath: destination,
      bytes: Buffer.byteLength(content, "utf8")
    };
  }

  async getWorkspaceIndex(
    input: LongOpenBookInput
  ): Promise<LongWorkspaceIndexResult> {
    const opened = await this.openProject(input);
    return LongWorkspaceIndexResultSchema.parse({
      bookId: opened.book.id,
      workspaceIndex: opened.book.workspaceIndex,
      projectRevision:
        opened.book.projectRevision ?? opened.book.workspaceIndex.revision
    });
  }

  async readDocument(
    input: LongReadDocumentInput
  ): Promise<LongReadDocumentResult> {
    const parsed = LongReadDocumentInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const read = await this.store.readDocument(opened.projectDirectory, {
      fileId: parsed.fileId,
      offset: parsed.offset,
      limit: parsed.maxCharacters
    });
    const file = findWorkspaceFile(opened.book.workspaceIndex, read.fileId);
    return LongReadDocumentResultSchema.parse({
      bookId: parsed.bookId,
      file: {
        ...file,
        revision: read.revision
      },
      content: read.content,
      offset: read.offset,
      totalCharacters: read.totalCharacters,
      nextOffset: read.nextOffset,
      workspaceRevision: read.workspaceRevision,
      projectRevision: read.projectRevision
    });
  }

  async search(input: LongSearchInput): Promise<LongSearchResult> {
    const parsed = LongSearchInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const query = parsed.query.normalize("NFC");
    const candidates = searchFiles(opened.book.workspaceIndex).filter(
      (candidate) =>
        parsed.scope === "all" || candidate.root === parsed.scope
    );
    const workspaceRevision = opened.book.workspaceIndex.revision;
    const projectRevision =
      opened.book.projectRevision ?? workspaceRevision;
    const cursorContext: SearchCursorContext = {
      bookId: parsed.bookId,
      query,
      scope: parsed.scope,
      workspaceRevision,
      projectRevision
    };
    const resume = parseSearchCursor(
      parsed.cursor,
      cursorContext,
      candidates
    );
    if (candidates.length === 0) {
      return LongSearchResultSchema.parse({
        bookId: parsed.bookId,
        query,
        scope: parsed.scope,
        hits: [],
        nextCursor: null,
        workspaceRevision,
        projectRevision
      });
    }
    const searched = await this.store.search(opened.projectDirectory, {
      query,
      fileIds: candidates.map(({ file }) => file.id),
      maxResults: parsed.limit,
      contextCharacters: Math.min(
        500,
        Math.ceil(parsed.maxSnippetCharacters / 2)
      ),
      ...(resume ? { resume } : {})
    });
    const descriptorById = new Map(
      candidates.map((candidate) => [candidate.file.id, candidate])
    );
    const nextCursor = searched.nextResume
      ? formatSearchCursor(searched.nextResume, cursorContext)
      : null;
    return LongSearchResultSchema.parse({
      bookId: parsed.bookId,
      query: searched.query,
      scope: parsed.scope,
      hits: searched.matches.map((match) => {
        const descriptor = descriptorById.get(match.fileId);
        if (!descriptor) {
          throw new Error("长篇搜索返回了未授权文件。");
        }
        return {
          fileId: match.fileId,
          path: match.path,
          root: descriptor.root,
          title: descriptor.title,
          start: match.offset,
          end: match.endOffset,
          snippet: match.preview.slice(0, parsed.maxSnippetCharacters),
          revision: match.revision
        };
      }),
      nextCursor,
      workspaceRevision: searched.workspaceRevision,
      projectRevision: searched.projectRevision
    });
  }

  async writeDocument(
    input: LongWriteDocumentInput
  ): Promise<LongWriteDocumentResult> {
    const parsed = LongWriteDocumentInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const written = await this.store.writeDocument(opened.projectDirectory, {
      fileId: parsed.fileId,
      content: parsed.content,
      expectedFileRevision: parsed.baseRevision,
      expectedWorkspaceRevision: parsed.baseWorkspaceRevision,
      expectedProjectRevision: parsed.baseProjectRevision
    });
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      written.summary,
      "write-document"
    );
    const file = findWorkspaceFile(
      written.book.workspaceIndex,
      written.fileId
    );
    return LongWriteDocumentResultSchema.parse({
      bookId: parsed.bookId,
      file: {
        ...file,
        revision: written.fileRevision
      },
      workspaceRevision: written.workspaceRevision,
      projectRevision: written.projectRevision,
      summary: LongBookSummarySchema.parse(written.summary)
    });
  }

  async writeChapter(
    input: LongWriteChapterInput
  ): Promise<LongWriteChapterResult> {
    const parsed = LongWriteChapterInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const result = LongWriteChapterResultSchema.parse(
      await this.store.writeChapter(opened.projectDirectory, parsed)
    );
    await this.refreshCatalogSummaryBestEffort(
      opened.projectDirectory,
      parsed.bookId,
      "write-chapter"
    );
    return result;
  }

  async commitChapter(
    input: LongCommitChapterInput
  ): Promise<LongCommitChapterResult> {
    const parsed = LongCommitChapterInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const result = LongCommitChapterResultSchema.parse(
      await this.store.commitChapter(opened.projectDirectory, parsed)
    );
    await this.refreshCatalogSummaryBestEffort(
      opened.projectDirectory,
      parsed.bookId,
      "commit-chapter"
    );
    return result;
  }

  async rollbackLastCommit(
    input: LongRollbackLastCommitInput
  ): Promise<LongRollbackLastCommitResult> {
    const parsed = LongRollbackLastCommitInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const result = LongRollbackLastCommitResultSchema.parse(
      await this.store.rollbackLastCommit(
        opened.projectDirectory,
        parsed
      )
    );
    await this.refreshCatalogSummaryBestEffort(
      opened.projectDirectory,
      parsed.bookId,
      "rollback-last-commit"
    );
    return result;
  }

  async previewOperations(
    input: LongPreviewOperationsInput
  ): Promise<LongPreviewOperationsResult> {
    const parsed = LongPreviewOperationsInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    return LongPreviewOperationsResultSchema.parse({
      bookId: parsed.bookId,
      preview: previewLongWorkspaceOperations(
        opened.book.workspaceIndex,
        parsed.batch
      ),
      projectRevision:
        opened.book.projectRevision ?? opened.book.workspaceIndex.revision
    });
  }

  async applyOperations(
    input: LongApplyOperationsInput
  ): Promise<LongApplyOperationsResult> {
    const parsed = LongApplyOperationsInputSchema.parse(input);
    const opened = await this.openProject(parsed);
    const actualProjectRevision =
      opened.book.projectRevision ?? opened.book.workspaceIndex.revision;
    if (actualProjectRevision !== parsed.baseProjectRevision) {
      throw new Error(
        `长篇项目版本冲突：期望 ${parsed.baseProjectRevision}，实际 ${actualProjectRevision}。`
      );
    }
    const applied = await this.store.applyWorkspaceOperations(
      opened.projectDirectory,
      {
        batch: parsed.batch,
        expectedProjectRevision: parsed.baseProjectRevision
      }
    );
    await this.updateCatalogSummaryBestEffort(
      parsed.bookId,
      applied.summary,
      "apply-operations"
    );
    return LongApplyOperationsResultSchema.parse({
      bookId: parsed.bookId,
      operationResult: applied.operationResult,
      projectRevision: applied.projectRevision,
      summary: applied.summary
    });
  }

  async unregister(
    input: LongRemoveBookInput
  ): Promise<LongRemoveBookResult> {
    const parsed = LongRemoveBookInputSchema.parse(input);
    return LongRemoveBookResultSchema.parse(
      await this.catalog.unregister(parsed.bookId)
    );
  }

  async delete(input: LongRemoveBookInput): Promise<LongRemoveBookResult> {
    const parsed = LongRemoveBookInputSchema.parse(input);
    return LongRemoveBookResultSchema.parse(
      await this.catalog.delete(parsed.bookId)
    );
  }

  getDiagnostics(): readonly LongWorkspaceServiceDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  private async openProject(
    input: { bookId: string }
  ): Promise<OpenLongProject> {
    return await this.catalog.open(input.bookId);
  }

  private async updateCatalogSummaryBestEffort(
    bookId: string,
    summary: LongBookSummary,
    operation: LongWorkspaceServiceDiagnostic["operation"]
  ): Promise<void> {
    try {
      await this.catalog.updateSummary(bookId, summary);
    } catch (error: unknown) {
      this.recordCatalogDiagnostic(bookId, operation, error);
    }
  }

  private async refreshCatalogSummaryBestEffort(
    projectDirectory: string,
    bookId: string,
    operation: LongWorkspaceServiceDiagnostic["operation"]
  ): Promise<void> {
    try {
      const opened = await this.store.openBook(projectDirectory);
      await this.catalog.updateSummary(opened.book.id, opened.summary);
    } catch (error: unknown) {
      this.recordCatalogDiagnostic(bookId, operation, error);
    }
  }

  private recordCatalogDiagnostic(
    bookId: string,
    operation: LongWorkspaceServiceDiagnostic["operation"],
    error: unknown
  ): void {
    const diagnostic: LongWorkspaceServiceDiagnostic = {
      code: "catalog-summary-cache-update-failed",
      bookId,
      operation,
      message:
        error instanceof Error
          ? error.message
          : "长篇项目摘要缓存更新失败。",
      occurredAt: this.now()
    };
    this.diagnostics.push(diagnostic);
    if (this.diagnostics.length > 100) this.diagnostics.shift();
    try {
      this.onDiagnostic?.({ ...diagnostic });
    } catch {
      // Diagnostics must never turn a completed authoritative store mutation
      // into an operation failure.
    }
  }
}

function parseOpenResult(opened: OpenLongProject): LongOpenBookResult {
  return LongOpenBookResultSchema.parse({
    book: opened.book,
    summary: opened.summary
  });
}

function normalizeCreateInput(
  input: CreateLongBookInput
): StoreCreateLongBookInput {
  return {
    title: input.title,
    genre: input.genre,
    linkedMaterialIdsByKind: {
      character: [...(input.linkedMaterialIdsByKind?.character ?? [])],
      gimmick: [...(input.linkedMaterialIdsByKind?.gimmick ?? [])],
      plot: [...(input.linkedMaterialIdsByKind?.plot ?? [])],
      draft: [...(input.linkedMaterialIdsByKind?.draft ?? [])],
      other: [...(input.linkedMaterialIdsByKind?.other ?? [])]
    },
    linkedSkillIdsByKind: {
      general: [...(input.linkedSkillIdsByKind?.general ?? [])],
      plot: [...(input.linkedSkillIdsByKind?.plot ?? [])],
      style: [...(input.linkedSkillIdsByKind?.style ?? [])],
      other: [...(input.linkedSkillIdsByKind?.other ?? [])]
    }
  };
}

function allWorkspaceFiles(
  index: LongWorkspaceIndexResult["workspaceIndex"]
): LongWorkspaceFileReference[] {
  return [
    index.bookLine,
    ...index.worldbuilding.map(({ file }) => file),
    ...index.characterFiles.flatMap((entry) => [
      entry.coreProfile,
      entry.relationships,
      entry.currentState,
      entry.history
    ]),
    ...index.chapters.flatMap((entry) => [
      entry.body,
      entry.characterState,
      entry.handoff
    ]),
    ...index.ledger.commits.map(({ recordFile }) => recordFile)
  ];
}

function findWorkspaceFile(
  index: LongWorkspaceIndexResult["workspaceIndex"],
  fileId: string
): LongWorkspaceFileReference {
  const file = allWorkspaceFiles(index).find(
    (candidate) => candidate.id === fileId
  );
  if (!file) throw new Error(`长篇文件不存在：${fileId}`);
  return file;
}

function searchFiles(
  index: LongWorkspaceIndexResult["workspaceIndex"]
): IndexedSearchFile[] {
  const characterById = new Map(
    index.characters.map((character) => [character.id, character])
  );
  const chapterById = new Map(
    index.plot.chapterCards.map((chapter) => [chapter.id, chapter])
  );
  return [
    {
      file: index.bookLine,
      root: "plot_design",
      title: "全书主线"
    },
    ...index.worldbuilding.map((category) => ({
      file: category.file,
      root: "worldbuilding" as const,
      title: category.title
    })),
    ...index.characterFiles.flatMap((entry) => {
      const title =
        characterById.get(entry.characterId)?.name ?? entry.characterId;
      return [
        {
          file: entry.coreProfile,
          root: "character_design" as const,
          title: `${title} · 核心档案`
        },
        {
          file: entry.relationships,
          root: "character_design" as const,
          title: `${title} · 人物关系`
        },
        {
          file: entry.currentState,
          root: "character_design" as const,
          title: `${title} · 当前状态`
        },
        {
          file: entry.history,
          root: "character_design" as const,
          title: `${title} · 历史`
        }
      ];
    }),
    ...index.chapters.flatMap((entry) => {
      const title =
        chapterById.get(entry.chapterCardId)?.title ??
        entry.chapterCardId;
      return [
        {
          file: entry.body,
          root: "draft" as const,
          title: `${title} · 正文`
        },
        {
          file: entry.characterState,
          root: "draft" as const,
          title: `${title} · 人物状态`
        },
        {
          file: entry.handoff,
          root: "draft" as const,
          title: `${title} · 交接`
        }
      ];
    }),
    ...index.ledger.commits.map((commit) => ({
      file: commit.recordFile,
      root: "continuity_ledger" as const,
      title: `提交 ${commit.sequence} · ${commit.chapterCardId}`
    }))
  ];
}

interface SearchCursorContext {
  bookId: string;
  query: string;
  scope: LongSearchInput["scope"];
  workspaceRevision: number;
  projectRevision: number;
}

interface SearchCursorPayload extends LongProjectSearchResume {
  v: 2;
  bookId: string;
  querySha256: string;
  scope: LongSearchInput["scope"];
  workspaceRevision: number;
  projectRevision: number;
}

const SEARCH_CURSOR_KEYS = new Set([
  "v",
  "bookId",
  "querySha256",
  "scope",
  "workspaceRevision",
  "projectRevision",
  "fileIndex",
  "fileId",
  "fileRevision",
  "characterOffset"
]);

function querySha256(query: string): string {
  return createHash("sha256").update(query, "utf8").digest("hex");
}

function invalidSearchCursor(): never {
  throw new Error("长篇搜索游标无效或已失效，请重新搜索。");
}

function parseSearchCursor(
  value: string | undefined,
  context: SearchCursorContext,
  candidates: readonly IndexedSearchFile[]
): LongProjectSearchResume | undefined {
  if (value === undefined) return undefined;
  if (!value.startsWith("v2.")) invalidSearchCursor();
  const token = value.slice(3);
  if (!token || !/^[A-Za-z0-9_-]+$/u.test(token)) invalidSearchCursor();
  let payload: unknown;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token) invalidSearchCursor();
    payload = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    invalidSearchCursor();
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    invalidSearchCursor();
  }
  const cursor = payload as Record<string, unknown>;
  if (
    Object.keys(cursor).length !== SEARCH_CURSOR_KEYS.size ||
    Object.keys(cursor).some((key) => !SEARCH_CURSOR_KEYS.has(key)) ||
    cursor.v !== 2 ||
    typeof cursor.bookId !== "string" ||
    typeof cursor.querySha256 !== "string" ||
    typeof cursor.scope !== "string" ||
    typeof cursor.workspaceRevision !== "number" ||
    typeof cursor.projectRevision !== "number" ||
    typeof cursor.fileIndex !== "number" ||
    typeof cursor.fileId !== "string" ||
    typeof cursor.fileRevision !== "string" ||
    typeof cursor.characterOffset !== "number"
  ) {
    invalidSearchCursor();
  }
  const parsed = cursor as unknown as SearchCursorPayload;
  if (
    parsed.bookId !== context.bookId ||
    parsed.querySha256 !== querySha256(context.query) ||
    parsed.scope !== context.scope ||
    parsed.workspaceRevision !== context.workspaceRevision ||
    parsed.projectRevision !== context.projectRevision ||
    !Number.isSafeInteger(parsed.fileIndex) ||
    parsed.fileIndex < 0 ||
    !Number.isSafeInteger(parsed.characterOffset) ||
    parsed.characterOffset < 0 ||
    !Number.isSafeInteger(parsed.workspaceRevision) ||
    parsed.workspaceRevision < 0 ||
    !Number.isSafeInteger(parsed.projectRevision) ||
    parsed.projectRevision < 0 ||
    !/^(?:v1:\d+:[0-9a-f]{8}|v2:\d+:[0-9a-f]{64})$/u.test(
      parsed.fileRevision
    ) ||
    candidates[parsed.fileIndex]?.file.id !== parsed.fileId
  ) {
    invalidSearchCursor();
  }
  return {
    fileIndex: parsed.fileIndex,
    fileId: parsed.fileId,
    fileRevision: parsed.fileRevision,
    characterOffset: parsed.characterOffset
  };
}

function formatSearchCursor(
  resume: LongProjectSearchResume,
  context: SearchCursorContext
): string {
  const payload: SearchCursorPayload = {
    v: 2,
    bookId: context.bookId,
    querySha256: querySha256(context.query),
    scope: context.scope,
    workspaceRevision: context.workspaceRevision,
    projectRevision: context.projectRevision,
    fileIndex: resume.fileIndex,
    fileId: resume.fileId,
    fileRevision: resume.fileRevision,
    characterOffset: resume.characterOffset
  };
  const cursor = `v2.${Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString("base64url")}`;
  if (cursor.length > 2_048) {
    throw new Error("长篇搜索游标超过安全长度。");
  }
  return cursor;
}

function isSameOrContainedPath(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return (
    offset === "" ||
    (!offset.startsWith(`..${sep}`) &&
      offset !== ".." &&
      !isAbsolute(offset))
  );
}

export async function atomicWritePortableFile(
  destination: string,
  content: string,
  options: PortableAtomicWriteOptions = {}
): Promise<void> {
  const release = await acquirePortableExportLock(destination);
  let primaryError: unknown;
  try {
    await atomicWritePortableFileLocked(destination, content, options);
    await options.injectFault?.("before-lock-release");
  } catch (error: unknown) {
    primaryError = error;
  }
  try {
    await release();
  } catch (releaseError: unknown) {
    if (primaryError !== undefined) {
      throw new AggregateError(
        [primaryError, releaseError],
        "长篇可移植包导出失败，且导出锁释放也失败。"
      );
    }
    throw releaseError;
  }
  if (primaryError !== undefined) throw primaryError;
}

async function atomicWritePortableFileLocked(
  destination: string,
  content: string,
  options: PortableAtomicWriteOptions
): Promise<void> {
  await recoverPortableAtomicWrite(destination);
  const previousSha256 = await safePortableFileDigest(destination);
  const nonce = randomBytes(4).toString("hex");
  const temporary = `${destination}.${process.pid}.${nonce}.tmp`;
  const journalPath = portableJournalPath(destination);
  const newSha256 = createHash("sha256")
    .update(content, "utf8")
    .digest("hex");
  let journalDurable = false;
  const handle = await open(
    temporary,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await options.injectFault?.("after-temp-sync");
    await writePortableJournal(journalPath, {
      schema: "deepwrite.portable-export-journal",
      schemaVersion: 1,
      destination,
      temporary,
      previousSha256,
      newSha256
    });
    journalDurable = true;
    await options.injectFault?.("after-journal-sync");
    if (
      (await safePortableFileDigest(destination)) !== previousSha256
    ) {
      await rm(temporary, { force: true });
      await rm(journalPath, { force: false });
      await fsyncPortableDirectory(dirname(destination));
      journalDurable = false;
      throw new Error(
        "长篇可移植包导出目标已被其他进程更新，拒绝覆盖。"
      );
    }
    await rename(temporary, destination);
    await options.injectFault?.("after-destination-rename");
    await fsyncPortableDirectory(dirname(destination));
    await options.injectFault?.("after-directory-sync");
    await rm(journalPath, { force: false });
    await fsyncPortableDirectory(dirname(destination));
  } catch (error: unknown) {
    if (!journalDurable) {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export type PortableAtomicWriteFaultPoint =
  | "after-temp-sync"
  | "after-journal-sync"
  | "after-destination-rename"
  | "after-directory-sync"
  | "before-lock-release";

export interface PortableAtomicWriteOptions {
  injectFault?: (
    point: PortableAtomicWriteFaultPoint
  ) => void | Promise<void>;
}

interface PortableWriteJournal {
  schema: "deepwrite.portable-export-journal";
  schemaVersion: 1;
  destination: string;
  temporary: string;
  previousSha256: string | null;
  newSha256: string;
}

interface PortableExportLockOwner {
  pid: number;
  nonce: string;
  acquiredAt: string;
}

interface PortableExportLockSnapshot {
  identity: string;
  mtimeMs: number;
  initialized: boolean;
  owner?: PortableExportLockOwner;
}

function portableJournalPath(destination: string): string {
  return `${destination}.deepwrite-export-journal`;
}

function portableExportLeasePrefix(destination: string): string {
  return `${basename(destination)}${PORTABLE_EXPORT_LEASE_MARKER}`;
}

async function acquirePortableExportLock(
  destination: string
): Promise<() => Promise<void>> {
  const parent = dirname(destination);
  const deadline = Date.now() + PORTABLE_EXPORT_LOCK_TIMEOUT_MS;

  for (;;) {
    const nonce = randomBytes(8).toString("hex");
    const owner: PortableExportLockOwner = {
      pid: process.pid,
      nonce,
      acquiredAt: new Date().toISOString()
    };
    const leasePath = join(
      parent,
      `${portableExportLeasePrefix(destination)}${process.pid}.${nonce}`
    );
    const release = await createPortableExportLease(
      leasePath,
      parent,
      owner
    );
    await portableExportLockDelay(PORTABLE_EXPORT_LOCK_RETRY_MS);
    let blocked: boolean;
    try {
      blocked = await hasCompetingPortableExportLease(
        destination,
        leasePath
      );
    } catch (error: unknown) {
      try {
        await release();
      } catch (releaseError: unknown) {
        throw new AggregateError(
          [error, releaseError],
          "检查长篇可移植包导出锁失败，且本次租约释放也失败。"
        );
      }
      throw error;
    }
    if (!blocked) return release;
    await release();
    if (Date.now() >= deadline) {
      throw new Error(
        "等待长篇可移植包导出锁超时，请确认没有其他实例正在导出到同一文件。"
      );
    }
    const jitter = randomBytes(1)[0]! % PORTABLE_EXPORT_LOCK_RETRY_MS;
    await portableExportLockDelay(
      PORTABLE_EXPORT_LOCK_RETRY_MS + jitter
    );
  }
}

async function createPortableExportLease(
  leasePath: string,
  parent: string,
  owner: PortableExportLockOwner
): Promise<() => Promise<void>> {
  const content = `${JSON.stringify(owner)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let acquiredIdentity: string | undefined;
  try {
    handle = await open(
      leasePath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    const details = await handle.stat();
    acquiredIdentity = `${details.dev}:${details.ino}`;
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
    await fsyncPortableDirectory(parent);
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    if (acquiredIdentity) {
      await removePortableExportLeaseByIdentity(
        leasePath,
        acquiredIdentity
      ).catch(() => undefined);
    }
    throw error;
  }
  if (!acquiredIdentity) {
    await handle?.close().catch(() => undefined);
    throw new Error("长篇可移植包导出锁没有可验证的文件身份。");
  }
  if (!handle) {
    throw new Error("长篇可移植包导出锁文件句柄已意外关闭。");
  }
  const identity = acquiredIdentity;
  const leaseHandle = handle;
  let heartbeatFailure: unknown;
  let heartbeatWork = Promise.resolve();
  const heartbeatTimer = setInterval(() => {
    heartbeatWork = heartbeatWork
      .then(async () => {
        const current = await readPortableExportLock(leasePath);
        if (
          !current ||
          current.identity !== identity ||
          current.owner?.pid !== owner.pid ||
          current.owner?.nonce !== owner.nonce
        ) {
          throw new Error(
            "长篇可移植包导出锁所有者发生变化，无法继续续租。"
          );
        }
        const now = new Date();
        await leaseHandle.utimes(now, now);
      })
      .catch((error: unknown) => {
        heartbeatFailure ??= error;
      });
  }, PORTABLE_EXPORT_LOCK_HEARTBEAT_MS);
  heartbeatTimer.unref();

  return async () => {
    clearInterval(heartbeatTimer);
    await heartbeatWork;
    await leaseHandle.close();
    let releaseFailure: unknown;
    try {
      const current = await readPortableExportLock(leasePath);
      if (
        !current ||
        current.identity !== identity ||
        current.owner?.pid !== process.pid ||
        current.owner?.nonce !== owner.nonce
      ) {
        throw new Error(
          "长篇可移植包导出锁所有者发生变化，拒绝释放其他进程的锁。"
        );
      }
      await removePortableExportLeaseByIdentity(leasePath, identity);
      await fsyncPortableDirectory(parent);
    } catch (error: unknown) {
      releaseFailure = error;
    }
    if (heartbeatFailure !== undefined && releaseFailure !== undefined) {
      throw new AggregateError(
        [heartbeatFailure, releaseFailure],
        "长篇可移植包导出锁续租和释放均失败。"
      );
    }
    if (heartbeatFailure !== undefined) throw heartbeatFailure;
    if (releaseFailure !== undefined) throw releaseFailure;
  };
}

async function hasCompetingPortableExportLease(
  destination: string,
  ownLeasePath: string
): Promise<boolean> {
  const parent = dirname(destination);
  const prefix = portableExportLeasePrefix(destination);
  const leases = (await readdir(parent)).flatMap((name) => {
    const parsed = parsePortableExportLeaseName(prefix, name);
    return parsed ? [{ name, ...parsed }] : [];
  });
  let cleaned = false;
  for (const { name, pid, nonce } of leases) {
    const leasePath = join(parent, name);
    if (leasePath === ownLeasePath) continue;
    const snapshot = await readPortableExportLock(leasePath);
    if (!snapshot) continue;
    if (snapshot.owner) {
      const matchesFileName =
        snapshot.owner.pid === pid && snapshot.owner.nonce === nonce;
      const fresh =
        Date.now() - snapshot.mtimeMs < PORTABLE_EXPORT_LOCK_STALE_MS;
      if (
        matchesFileName &&
        fresh &&
        isPortableExportProcessAlive(snapshot.owner.pid)
      ) {
        if (cleaned) await fsyncPortableDirectory(parent);
        return true;
      }
      await removePortableExportLeaseByIdentity(
        leasePath,
        snapshot.identity,
        true
      );
      cleaned = true;
      continue;
    }
    if (
      !snapshot.initialized &&
      Date.now() - snapshot.mtimeMs <
      PORTABLE_EXPORT_LOCK_INITIALIZATION_GRACE_MS
    ) {
      if (cleaned) await fsyncPortableDirectory(parent);
      return true;
    }
    await removePortableExportLeaseByIdentity(
      leasePath,
      snapshot.identity,
      true
    );
    cleaned = true;
  }
  if (cleaned) await fsyncPortableDirectory(parent);
  return false;
}

function parsePortableExportLeaseName(
  prefix: string,
  name: string
): { pid: number; nonce: string } | undefined {
  if (!name.startsWith(prefix)) return undefined;
  const match = /^([1-9]\d*)\.([0-9a-f]{16})$/u.exec(
    name.slice(prefix.length)
  );
  if (!match) return undefined;
  const pid = Number(match[1]);
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    pid > 2_147_483_647
  ) {
    return undefined;
  }
  return { pid, nonce: match[2]! };
}

async function removePortableExportLeaseByIdentity(
  leasePath: string,
  expectedIdentity: string,
  allowMissing = false
): Promise<void> {
  const latest = await lstat(leasePath).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  if (!latest) {
    if (allowMissing) return;
    throw new Error("长篇可移植包导出锁在释放前已丢失。");
  }
  if (
    latest.isSymbolicLink() ||
    !latest.isFile() ||
    latest.nlink !== 1 ||
    `${latest.dev}:${latest.ino}` !== expectedIdentity
  ) {
    throw new Error(
      "长篇可移植包导出锁在释放前发生替换，拒绝删除替代锁。"
    );
  }
  await rm(leasePath, { force: false });
}

async function readPortableExportLock(
  path: string
): Promise<PortableExportLockSnapshot | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.nlink !== 1 ||
      details.size > 16 * 1024
    ) {
      throw new Error("长篇可移植包导出锁不是安全的普通文件。");
    }
    const text = await handle.readFile({ encoding: "utf8" });
    const owner = parsePortableExportLockOwner(text);
    return {
      identity: `${details.dev}:${details.ino}`,
      mtimeMs: details.mtimeMs,
      initialized: text.trim().length > 0,
      ...(owner ? { owner } : {})
    };
  } catch (error: unknown) {
    if (isMissingPathError(error)) return undefined;
    if (isNodeErrorCode(error, "ELOOP")) {
      throw new Error("长篇可移植包导出锁不能是符号链接。");
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parsePortableExportLockOwner(
  text: string
): PortableExportLockOwner | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const owner = value as Partial<PortableExportLockOwner>;
  if (
    !Number.isSafeInteger(owner.pid) ||
    (owner.pid ?? 0) <= 0 ||
    (owner.pid ?? 0) > 2_147_483_647 ||
    typeof owner.nonce !== "string" ||
    !/^[0-9a-f]{16}$/u.test(owner.nonce) ||
    typeof owner.acquiredAt !== "string" ||
    !Number.isFinite(Date.parse(owner.acquiredAt))
  ) {
    return undefined;
  }
  return owner as PortableExportLockOwner;
}

function isPortableExportProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isNodeErrorCode(error, "EPERM");
  }
}

async function portableExportLockDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === code
  );
}

async function writePortableJournal(
  path: string,
  journal: PortableWriteJournal
): Promise<void> {
  const content = `${JSON.stringify(journal)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let createdByThisCall = false;
  try {
    handle = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    createdByThisCall = true;
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsyncPortableDirectory(dirname(path));
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    if (createdByThisCall) {
      await rm(path, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

async function recoverPortableAtomicWrite(
  destination: string
): Promise<void> {
  const journalPath = portableJournalPath(destination);
  const journalText = await readOptionalPortableFile(
    journalPath,
    16 * 1024
  );
  if (journalText === undefined) return;
  let raw: unknown;
  try {
    raw = JSON.parse(journalText) as unknown;
  } catch {
    throw new Error("长篇可移植包导出恢复日志已损坏。");
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    throw new Error("长篇可移植包导出恢复日志格式无效。");
  }
  const journal = raw as Partial<PortableWriteJournal>;
  const parent = dirname(destination);
  if (
    journal.schema !== "deepwrite.portable-export-journal" ||
    journal.schemaVersion !== 1 ||
    journal.destination !== destination ||
    typeof journal.temporary !== "string" ||
    dirname(journal.temporary) !== parent ||
    !basename(journal.temporary).startsWith(
      `${basename(destination)}.`
    ) ||
    !basename(journal.temporary).endsWith(".tmp") ||
    (journal.previousSha256 !== null &&
      (typeof journal.previousSha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(journal.previousSha256))) ||
    typeof journal.newSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(journal.newSha256)
  ) {
    throw new Error("长篇可移植包导出恢复日志与目标不一致。");
  }

  const destinationSha256 = await safePortableFileDigest(destination);
  const temporarySha256 = await safePortableFileDigest(
    journal.temporary
  );
  if (destinationSha256 === journal.newSha256) {
    await rm(journal.temporary, { force: true });
  } else if (
    destinationSha256 === journal.previousSha256 &&
    temporarySha256 === journal.newSha256
  ) {
    await rename(journal.temporary, destination);
    await fsyncPortableDirectory(parent);
  } else {
    throw new Error(
      "长篇可移植包导出恢复状态冲突，已保留现场以避免覆盖文件。"
    );
  }
  await rm(journalPath, { force: false });
  await fsyncPortableDirectory(parent);
}

async function safePortableFileDigest(
  path: string
): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.nlink !== 1 ||
      details.size > 128 * 1024 * 1024
    ) {
      throw new Error("长篇可移植包导出目标必须是安全的普通文件。");
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < details.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, details.size - position),
        position
      );
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position !== details.size) {
      throw new Error("长篇可移植包导出目标读取不完整。");
    }
    return digest.digest("hex");
  } catch (error: unknown) {
    if (isMissingPathError(error)) return null;
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ELOOP"
    ) {
      throw new Error("长篇可移植包导出目标不能是符号链接。");
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readOptionalPortableFile(
  path: string,
  maximumBytes: number
): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.nlink !== 1 ||
      details.size > maximumBytes
    ) {
      throw new Error("长篇可移植包导出恢复日志不是安全文件。");
    }
    return await handle.readFile({ encoding: "utf8" });
  } catch (error: unknown) {
    if (isMissingPathError(error)) return undefined;
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ELOOP"
    ) {
      throw new Error("长篇可移植包导出恢复日志不能是符号链接。");
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function fsyncPortableDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch (error: unknown) {
    if (!isUnsupportedDirectorySyncError(error)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPERM" ||
      error.code === "EISDIR" ||
      error.code === "EINVAL" ||
      error.code === "ENOTSUP")
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
