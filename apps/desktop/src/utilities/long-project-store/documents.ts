import {
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENTS_MD_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongFileIdSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longAgentsMdCharacterCount
} from "@deepwrite/contracts";
import {
  ProjectTransactionConflictError,
  recoverProjectTransaction
} from "../project-transaction";
import { sliceAgentsMdContent, tryReadAgentsMdFile } from "./agents-md";
import { loadIndexedFile, loadPagedIndexedFile, sliceIndexedUnicodeCodePointPage } from "./cache";
import { assertDirectlyMutableDocument } from "./integrity";
import {
  boundedPositiveInteger,
  commitLongProjectTransaction,
  nonnegativeInteger,
  parseJson,
  readSecureTextFile,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { requireIndexedFileReference, updateChapterBodyStatus } from "./paths";
import {
  createLongFileRevision,
  encodeUtf8Strict,
  longRevisionsMatchContent
} from "./revisions";
import type { LongProjectStoreContext } from "./store-context";
import {
  DEFAULT_READ_PAGE_CHARACTERS,
  LongProjectConflictError,
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_READ_PAGE_CHARACTERS,
  type OpenedLongBook,
  type ReadLongDocumentInput,
  type ReadLongDocumentResult,
  type RenameLongBookInput,
  type UpdateLongBookBindingsInput,
  type WriteLongDocumentInput,
  type WriteLongDocumentResult
} from "./types";

export async function openBook(
  ctx: LongProjectStoreContext,projectDirectory: string): Promise<OpenedLongBook> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
      const loaded = await loadProject(ctx, canonical);
      return { book: loaded.book, summary: loaded.summary };
    });
  }

export async function inspectBookManifest(
  ctx: LongProjectStoreContext,projectDirectory: string): Promise<{
    bookId: string;
    projectRevision: number;
    updatedAt: string;
  }> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
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

export async function updateBindings(
  ctx: LongProjectStoreContext,
    projectDirectory: string,
    input: UpdateLongBookBindingsInput
  ): Promise<OpenedLongBook> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
      const loaded = await loadProject(ctx, canonical);
      if (input.expectedProjectRevision !== loaded.manifest.revision) {
        throw new LongProjectConflictError(
          "project",
          input.expectedProjectRevision,
          loaded.manifest.revision
        );
      }
      const timestamp = ctx.timestamp();
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
      const next = await loadProject(ctx, loaded.projectDirectory);
      return { book: next.book, summary: next.summary };
    });
  }

export async function renameBook(
  ctx: LongProjectStoreContext,
    projectDirectory: string,
    input: RenameLongBookInput
  ): Promise<OpenedLongBook> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
      const loaded = await loadProject(ctx, canonical);
      if (input.expectedProjectRevision !== loaded.manifest.revision) {
        throw new LongProjectConflictError(
          "project",
          input.expectedProjectRevision,
          loaded.manifest.revision
        );
      }
      const timestamp = ctx.timestamp();
      const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
        ...loaded.index,
        revision: loaded.index.revision + 1,
        updatedAt: timestamp
      });
      const indexContent = serializeJson(nextIndex);
      const nextManifest = LongProjectManifestSchema.parse({
        ...loaded.manifest,
        title: input.title,
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
      return { book: next.book, summary: next.summary };
    });
  }

export async function readDocument(
  ctx: LongProjectStoreContext,
    projectDirectory: string,
    input: ReadLongDocumentInput
  ): Promise<ReadLongDocumentResult> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
      const loaded = await loadProject(ctx, canonical);
      const fileId = LongFileIdSchema.parse(input.fileId);
      const file = await loadPagedIndexedFile(ctx, loaded, fileId);
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

export async function readAgentsMd(
  ctx: LongProjectStoreContext,
    projectDirectory: string
  ): Promise<{ content: string; truncated: boolean }> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
      await loadProject(ctx, canonical);
      const existing = await tryReadAgentsMdFile(canonical);
      if (!existing) {
        const content = DEFAULT_LONG_AGENTS_MD;
        await commitLongProjectTransaction({
          projectRoot: canonical,
          operations: [
            {
              path: LONG_AGENTS_MD_PATH,
              content,
              expectedSha256: null
            }
          ],
          maxFileBytes: MAX_LEDGER_RECORD_BYTES
        });
        return { content, truncated: false };
      }
      return sliceAgentsMdContent(existing.content);
    });
  }

export async function writeAgentsMd(
  ctx: LongProjectStoreContext,
    projectDirectory: string,
    content: string
  ): Promise<void> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
      await loadProject(ctx, canonical);
      if (longAgentsMdCharacterCount(content) > LONG_AGENTS_MD_MAX_CHARACTERS) {
        throw new Error(
          `长篇上下文超过 ${LONG_AGENTS_MD_MAX_CHARACTERS} 个字符上限。`
        );
      }
      const existing = await tryReadAgentsMdFile(canonical);
      await commitLongProjectTransaction({
        projectRoot: canonical,
        operations: [
          {
            path: LONG_AGENTS_MD_PATH,
            content,
            expectedSha256: existing?.sha256 ?? null
          }
        ],
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
    });
  }

export async function writeDocument(
  ctx: LongProjectStoreContext,
    projectDirectory: string,
    input: WriteLongDocumentInput
  ): Promise<WriteLongDocumentResult> {
    const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
    return await ctx.runExclusive(canonical, async () => {
      const loaded = await loadProject(ctx, canonical);
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
      const nextBytes = encodeUtf8Strict(input.content);
      if (nextBytes.byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error("长篇 Markdown 文件超过 32 MiB 限制。");
      }
      const timestamp = ctx.timestamp();
      const nextFileRevision = createLongFileRevision(nextBytes);
      file.reference.revision = nextFileRevision;
      file.reference.updatedAt = timestamp;
      updateChapterBodyStatus(loaded.index, file.reference.id, input.content);

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

      const next = await loadProject(ctx, loaded.projectDirectory);
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
