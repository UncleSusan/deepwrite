export {
  LongProjectConflictError,
  type ApplyLongWorkspaceOperationsInput,
  type ApplyLongWorkspaceOperationsResult,
  type CreateLongBookInput,
  type CreatedLongBook,
  type ImportContinuationLongBookInput,
  type ImportWriteClawLongBookOptions,
  type ImportedContinuationLongBook,
  type ImportedPortableLongBook,
  type ImportedWriteClawLongBook,
  type LongProjectConflictScope,
  type LongProjectSearchMatch,
  type LongProjectSearchResume,
  type LongProjectStoreOptions,
  type OpenedLongBook,
  type ReadLongDocumentInput,
  type ReadLongDocumentResult,
  type RenameLongBookInput,
  type SearchLongProjectInput,
  type SearchLongProjectResult,
  type StoreCommitLongChapterInput,
  type StoreRollbackLastCommitInput,
  type StoreWriteLongChapterInput,
  type UpdateLongBookBindingsInput,
  type WriteLongDocumentInput,
  type WriteLongDocumentResult
} from "./long-project-store/types";
export { createLongFileRevision } from "./long-project-store/revisions";
export { deriveLongForeshadowingStatus } from "./long-project-store/continuity";

import { commitChapter } from "./long-project-store/commit-chapter";
import {
  inspectBookManifest,
  openBook,
  readAgentsMd,
  readDocument,
  renameBook,
  updateBindings,
  writeAgentsMd,
  writeDocument
} from "./long-project-store/documents";
import {
  importContinuationBook,
  importPortableBundle,
  importWriteClawBook,
  previewContinuationImport
} from "./long-project-store/imports";
import { createBook, duplicateBook } from "./long-project-store/lifecycle";
import {
  applyWorkspaceOperations,
  previewWorkspaceOperations
} from "./long-project-store/operations";
import { rollbackLastCommit } from "./long-project-store/rollback";
import { search } from "./long-project-store/search-api";
import {
  createLongProjectStoreContext,
  type LongProjectStoreContext
} from "./long-project-store/store-context";
import type {
  ApplyLongWorkspaceOperationsInput,
  ApplyLongWorkspaceOperationsResult,
  CreateLongBookInput,
  CreatedLongBook,
  ImportContinuationLongBookInput,
  ImportWriteClawLongBookOptions,
  ImportedContinuationLongBook,
  ImportedPortableLongBook,
  ImportedWriteClawLongBook,
  LongProjectStoreOptions,
  OpenedLongBook,
  ReadLongDocumentInput,
  ReadLongDocumentResult,
  RenameLongBookInput,
  SearchLongProjectInput,
  SearchLongProjectResult,
  StoreCommitLongChapterInput,
  StoreRollbackLastCommitInput,
  StoreWriteLongChapterInput,
  UpdateLongBookBindingsInput,
  WriteLongDocumentInput,
  WriteLongDocumentResult
} from "./long-project-store/types";
import { writeChapter } from "./long-project-store/write-chapter";
import type { LongCommitChapterResult, LongRollbackLastCommitResult, LongWorkspaceImpactPreview, LongWorkspaceOperationBatch, LongWriteChapterResult } from "@deepwrite/contracts";

export class LongProjectStore {
  private readonly ctx: LongProjectStoreContext;

  constructor(options: LongProjectStoreOptions = {}) {
    this.ctx = createLongProjectStoreContext(options);
  }

  async createBook(
    parentDirectory: string,
    input: CreateLongBookInput
  ): Promise<CreatedLongBook> {
    return createBook(this.ctx, parentDirectory, input);
  }

  async duplicateBook(
    parentDirectory: string,
    sourceProjectDirectory: string,
    title: string
  ): Promise<CreatedLongBook> {
    return duplicateBook(this.ctx, parentDirectory, sourceProjectDirectory, title);
  }

  async importWriteClawBook(
    parentDirectory: string,
    sourcePath: string,
    options: ImportWriteClawLongBookOptions = {}
  ): Promise<ImportedWriteClawLongBook> {
    return importWriteClawBook(this.ctx, parentDirectory, sourcePath, options);
  }

  async previewContinuationImport(sourcePath: string) {
    return previewContinuationImport(this.ctx, sourcePath);
  }

  async importContinuationBook(
    parentDirectory: string,
    input: ImportContinuationLongBookInput
  ): Promise<ImportedContinuationLongBook> {
    return importContinuationBook(this.ctx, parentDirectory, input);
  }

  async importPortableBundle(
    parentDirectory: string,
    sourcePath: string
  ): Promise<ImportedPortableLongBook> {
    return importPortableBundle(this.ctx, parentDirectory, sourcePath);
  }

  async openBook(projectDirectory: string): Promise<OpenedLongBook> {
    return openBook(this.ctx, projectDirectory);
  }

  async inspectBookManifest(projectDirectory: string): Promise<{
    bookId: string;
    projectRevision: number;
    updatedAt: string;
  }> {
    return inspectBookManifest(this.ctx, projectDirectory);
  }

  async updateBindings(
    projectDirectory: string,
    input: UpdateLongBookBindingsInput
  ): Promise<OpenedLongBook> {
    return updateBindings(this.ctx, projectDirectory, input);
  }

  async renameBook(
    projectDirectory: string,
    input: RenameLongBookInput
  ): Promise<OpenedLongBook> {
    return renameBook(this.ctx, projectDirectory, input);
  }

  async readDocument(
    projectDirectory: string,
    input: ReadLongDocumentInput
  ): Promise<ReadLongDocumentResult> {
    return readDocument(this.ctx, projectDirectory, input);
  }

  async readAgentsMd(
    projectDirectory: string
  ): Promise<{ content: string; truncated: boolean }> {
    return readAgentsMd(this.ctx, projectDirectory);
  }

  async writeAgentsMd(
    projectDirectory: string,
    content: string
  ): Promise<void> {
    return writeAgentsMd(this.ctx, projectDirectory, content);
  }

  async search(
    projectDirectory: string,
    input: SearchLongProjectInput
  ): Promise<SearchLongProjectResult> {
    return search(this.ctx, projectDirectory, input);
  }

  async writeDocument(
    projectDirectory: string,
    input: WriteLongDocumentInput
  ): Promise<WriteLongDocumentResult> {
    return writeDocument(this.ctx, projectDirectory, input);
  }

  async previewWorkspaceOperations(
    projectDirectory: string,
    batchInput: LongWorkspaceOperationBatch
  ): Promise<LongWorkspaceImpactPreview> {
    return previewWorkspaceOperations(this.ctx, projectDirectory, batchInput);
  }

  async applyWorkspaceOperations(
    projectDirectory: string,
    input: ApplyLongWorkspaceOperationsInput
  ): Promise<ApplyLongWorkspaceOperationsResult> {
    return applyWorkspaceOperations(this.ctx, projectDirectory, input);
  }

  async writeChapter(
    projectDirectory: string,
    rawInput: StoreWriteLongChapterInput
  ): Promise<LongWriteChapterResult> {
    return writeChapter(this.ctx, projectDirectory, rawInput);
  }

  async commitChapter(
    projectDirectory: string,
    rawInput: StoreCommitLongChapterInput
  ): Promise<LongCommitChapterResult> {
    return commitChapter(this.ctx, projectDirectory, rawInput);
  }

  async rollbackLastCommit(
    projectDirectory: string,
    rawInput: StoreRollbackLastCommitInput
  ): Promise<LongRollbackLastCommitResult> {
    return rollbackLastCommit(this.ctx, projectDirectory, rawInput);
  }
}
