import { contextBridge, ipcRenderer } from "electron";
import {
  BookSchema,
  CatalogDocumentSchema,
  CatalogDraftSectionSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogLibraryEntrySchema,
  CatalogLibraryProjectDomainSchema,
  CatalogOpenProjectResultSchema,
  CatalogProjectDomainSchema,
  CatalogSnapshotSchema,
  CommandResultSchema,
  CreateLibraryEntryInputSchema,
  CreateDraftSectionInputSchema,
  CreateDraftSectionsInputSchema,
  CreateDraftSectionsResultSchema,
  CreateLibraryGroupInputSchema,
  CreateLibraryInputSchema,
  CreateScriptBookInputSchema,
  CreateShortBookInputSchema,
  DeleteCatalogProjectInputSchema,
  DeleteCatalogProjectResultSchema,
  DeleteBookInputSchema,
  DeleteBookResultSchema,
  DeleteDraftSectionInputSchema,
  DeleteDraftSectionResultSchema,
  ExportShortManuscriptInputSchema,
  ExportShortManuscriptResultSchema,
  GeneralSettingsSchema,
  GeneralSettingsSnapshotSchema,
  ImportLegacyLibraryResultSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  LearningImitationSettingsInputSchema,
  LearningImitationSettingsSchema,
  LearningImitationStageIdSchema,
  LibraryAgentDomainSchema,
  LibraryAgentSettingsInputSchema,
  LibraryAgentSettingsSchema,
  ModelConnectionTestResultSchema,
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  ModelUsageDashboardSchema,
  ModelUsageQueryInputSchema,
  CreateLongBookInputSchema,
  LongImportPortableResultSchema,
  LongImportWriteClawResultSchema,
  LongApplyOperationsInputSchema,
  LongApplyOperationsResultSchema,
  LongAgentIdSchema,
  LongAgentSettingsInputSchema,
  LongAgentSettingsSchema,
  LongAgentTeamSettingsInputSchema,
  LongAgentTeamSettingsSchema,
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
  LongUpdateBindingsInputSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteChapterInputSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentInputSchema,
  LongWriteDocumentResultSchema,
  RemoveLibraryEntryInputSchema,
  RemoveLibraryEntryResultSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionAbortCommandPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  SessionPromptCommandPayloadSchema,
  SaveDocumentInputSchema,
  SaveLibraryEntryInputSchema,
  ScriptBookSchema,
  ScriptWorkspaceAgentIdSchema,
  ShortBookSchema,
  ShortWorkspaceAgentIdSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  UnregisterCatalogProjectInputSchema,
  UnregisterCatalogProjectResultSchema,
  WorkspaceDirectorySettingsSchema,
  AppearanceSettingsSchema,
  AppearanceSettingsSnapshotSchema,
  UpdateBookInputSchema,
  UpdateLibraryGroupInputSchema,
  WorkspaceAgentSettingsInputSchema,
  WorkspaceAgentSettingsSchema,
  WorkspaceAgentTeamSettingsInputSchema,
  WorkspaceAgentTeamSettingsSchema,
  WorkspaceTypeSchema,
  createEnvelope,
  type CommandEnvelope,
  type AgentTeamSettings,
  type AgentTeamSettingsInput,
  type Book,
  type CatalogDocument,
  type CatalogDraftSection,
  type CatalogDraftRecovery,
  type CatalogLibrary,
  type CatalogLibraryGroup,
  type CatalogLibraryEntry,
  type CatalogLibraryProjectDomain,
  type CatalogOpenProjectResult,
  type CatalogProjectDomain,
  type CatalogSnapshot,
  type CreateLibraryEntryInput,
  type CreateDraftSectionInput,
  type CreateDraftSectionsInput,
  type CreateDraftSectionsResult,
  type CreateLibraryGroupInput,
  type CreateLibraryInput,
  type CreateScriptBookInput,
  type CreateShortBookInput,
  type DeepWriteApi,
  type DeleteCatalogProjectInput,
  type DeleteCatalogProjectResult,
  type DeleteBookResult,
  type DeleteDraftSectionInput,
  type DeleteDraftSectionResult,
  type ExportShortManuscriptInput,
  type ExportShortManuscriptResult,
  type GeneralSettings,
  type GeneralSettingsSnapshot,
  type ModelConnectionTestResult,
  type ImportLegacyLibraryResult,
  type LearningImitationSettings,
  type LearningImitationSettingsInput,
  type LearningImitationStageId,
  type CreateLongBookInput,
  type LongImportPortableResult,
  type LongImportWriteClawResult,
  type LongApplyOperationsInput,
  type LongApplyOperationsResult,
  type LongAgentId,
  type LongAgentSettings,
  type LongAgentSettingsInput,
  type LongAgentTeamSettings,
  type LongAgentTeamSettingsInput,
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
  type LongUpdateBindingsInput,
  type LongWorkspaceIndexResult,
  type LongWriteChapterInput,
  type LongWriteChapterResult,
  type LongWriteDocumentInput,
  type LongWriteDocumentResult,
  type LibraryAgentDomain,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type ModelUsageDashboard,
  type ModelUsageQueryInput,
  type RemoveLibraryEntryInput,
  type RemoveLibraryEntryResult,
  type SessionAbortAcceptedPayload,
  type SessionAbortCommandPayload,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload,
  type SaveDocumentInput,
  type SaveLibraryEntryInput,
  type ScriptAgentTeamSettings,
  type ScriptAgentTeamSettingsInput,
  type ScriptBook,
  type ScriptWorkspaceAgentId,
  type ScriptWorkspaceAgentSettings,
  type ScriptWorkspaceAgentSettingsInput,
  type ShortBook,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput,
  type SystemEventEnvelope,
  type SystemHealthPayload,
  type UnregisterCatalogProjectInput,
  type UnregisterCatalogProjectResult,
  type UpdateBookInput,
  type UpdateLibraryGroupInput,
  type WorkspaceDirectorySettings,
  type WorkspaceAgentSettings,
  type WorkspaceAgentSettingsInput,
  type WorkspaceAgentTeamSettings,
  type WorkspaceAgentTeamSettingsInput,
  type WorkspaceType,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot
} from "@deepwrite/contracts";

import { createId } from "@deepwrite/shared";

function browserId(prefix: string): string {
  return createId(prefix);
}

async function invokeCommand<TPayload>(command: CommandEnvelope): Promise<TPayload> {
  const expectedRequestId = command.id;
  const result = CommandResultSchema.parse(
    await ipcRenderer.invoke(IPC_COMMAND_CHANNEL, command)
  );
  if (result.requestId !== expectedRequestId) {
    // Prefer the real rejection reason when main returned requestId "unknown"
    // (or another mismatched id) for an invalid/untrusted command.
    if (result.status === "rejected") {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    throw new Error(
      `IPC result requestId does not match command id. expected=${expectedRequestId} actual=${result.requestId}`
    );
  }
  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.payload as TPayload;
}

async function getHealth(): Promise<SystemHealthPayload> {
  const id = browserId("cmd_health");
  return SystemHealthPayloadSchema.parse(
    await invokeCommand<SystemHealthPayload>(
      createEnvelope("system.health", {}, { id, correlationId: id })
    )
  );
}

async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const id = browserId("cmd_catalog_snapshot");
  return CatalogSnapshotSchema.parse(
    await invokeCommand<CatalogSnapshot>(
      createEnvelope("catalog.snapshot", {}, { id, correlationId: id })
    )
  );
}

async function loadDraftRecovery(): Promise<CatalogDraftRecovery> {
  const id = browserId("cmd_catalog_load_draft_recovery");
  return CatalogDraftRecoverySchema.parse(
    await invokeCommand<CatalogDraftRecovery>(
      createEnvelope("catalog.loadDraftRecovery", {}, { id, correlationId: id })
    )
  );
}

async function saveDraftRecovery(
  rawDrafts: CatalogDraftRecovery
): Promise<void> {
  const drafts = CatalogDraftRecoverySchema.parse(rawDrafts);
  const id = browserId("cmd_catalog_save_draft_recovery");
  CatalogDraftRecoverySaveResultSchema.parse(
    await invokeCommand(
      createEnvelope(
        "catalog.saveDraftRecovery",
        { drafts },
        { id, correlationId: id }
      )
    )
  );
}

async function createShortBook(
  rawInput: CreateShortBookInput
): Promise<ShortBook | null> {
  const input = CreateShortBookInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_book");
  return ShortBookSchema.nullable().parse(
    await invokeCommand<ShortBook | null>(
      createEnvelope("catalog.createShortBook", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function createScriptBook(
  rawInput: CreateScriptBookInput
): Promise<ScriptBook | null> {
  const input = CreateScriptBookInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_script_book");
  return ScriptBookSchema.nullable().parse(
    await invokeCommand<ScriptBook | null>(
      createEnvelope("catalog.createScriptBook", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function listLongBooks(): Promise<LongListBooksResult> {
  const id = browserId("cmd_long_list");
  return LongListBooksResultSchema.parse(
    await invokeCommand<LongListBooksResult>(
      createEnvelope("long.list", {}, { id, correlationId: id })
    )
  );
}

async function createLongBook(
  rawInput: CreateLongBookInput
): Promise<LongOpenBookResult | null> {
  const input = CreateLongBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_create");
  return LongOpenBookResultSchema.nullable().parse(
    await invokeCommand<LongOpenBookResult | null>(
      createEnvelope("long.createBook", input, { id, correlationId: id })
    )
  );
}

async function updateLongBookBindings(
  rawInput: LongUpdateBindingsInput
): Promise<LongOpenBookResult> {
  const input = LongUpdateBindingsInputSchema.parse(rawInput);
  const id = browserId("cmd_long_update_bindings");
  return LongOpenBookResultSchema.parse(
    await invokeCommand<LongOpenBookResult>(
      createEnvelope("long.updateBindings", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function importWriteClawLongBook(): Promise<LongImportWriteClawResult | null> {
  const id = browserId("cmd_long_import_write_claw");
  return LongImportWriteClawResultSchema.nullable().parse(
    await invokeCommand<LongImportWriteClawResult | null>(
      createEnvelope("long.importWriteClaw", {}, { id, correlationId: id })
    )
  );
}

async function importPortableLongBook(): Promise<LongImportPortableResult | null> {
  const id = browserId("cmd_long_import_portable");
  return LongImportPortableResultSchema.nullable().parse(
    await invokeCommand<LongImportPortableResult | null>(
      createEnvelope("long.importPortable", {}, { id, correlationId: id })
    )
  );
}

async function openLongBook(
  rawInput: LongOpenBookInput
): Promise<LongOpenBookResult> {
  const input = LongOpenBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_open");
  return LongOpenBookResultSchema.parse(
    await invokeCommand<LongOpenBookResult>(
      createEnvelope("long.open", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function openExistingLongBook(): Promise<LongOpenBookResult | null> {
  const id = browserId("cmd_long_open_existing");
  return LongOpenBookResultSchema.nullable().parse(
    await invokeCommand<LongOpenBookResult | null>(
      createEnvelope("long.openExisting", {}, { id, correlationId: id })
    )
  );
}

async function getLongWorkspaceIndex(
  rawInput: LongOpenBookInput
): Promise<LongWorkspaceIndexResult> {
  const input = LongOpenBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_index");
  return LongWorkspaceIndexResultSchema.parse(
    await invokeCommand<LongWorkspaceIndexResult>(
      createEnvelope("long.getWorkspaceIndex", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function readLongDocument(
  rawInput: LongReadDocumentInput
): Promise<LongReadDocumentResult> {
  const input = LongReadDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_long_read");
  return LongReadDocumentResultSchema.parse(
    await invokeCommand<LongReadDocumentResult>(
      createEnvelope("long.readDocument", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function writeLongDocument(
  rawInput: LongWriteDocumentInput
): Promise<LongWriteDocumentResult> {
  const input = LongWriteDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_long_write");
  return LongWriteDocumentResultSchema.parse(
    await invokeCommand<LongWriteDocumentResult>(
      createEnvelope("long.writeDocument", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function previewLongOperations(
  rawInput: LongPreviewOperationsInput
): Promise<LongPreviewOperationsResult> {
  const input = LongPreviewOperationsInputSchema.parse(rawInput);
  const id = browserId("cmd_long_preview_operations");
  return LongPreviewOperationsResultSchema.parse(
    await invokeCommand<LongPreviewOperationsResult>(
      createEnvelope("long.previewOperations", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function applyLongOperations(
  rawInput: LongApplyOperationsInput
): Promise<LongApplyOperationsResult> {
  const input = LongApplyOperationsInputSchema.parse(rawInput);
  const id = browserId("cmd_long_apply_operations");
  return LongApplyOperationsResultSchema.parse(
    await invokeCommand<LongApplyOperationsResult>(
      createEnvelope("long.applyOperations", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function writeLongChapter(
  rawInput: LongWriteChapterInput
): Promise<LongWriteChapterResult> {
  const input = LongWriteChapterInputSchema.parse(rawInput);
  const id = browserId("cmd_long_write_chapter");
  return LongWriteChapterResultSchema.parse(
    await invokeCommand<LongWriteChapterResult>(
      createEnvelope("long.writeChapter", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function commitLongChapter(
  rawInput: LongCommitChapterInput
): Promise<LongCommitChapterResult> {
  const input = LongCommitChapterInputSchema.parse(rawInput);
  const id = browserId("cmd_long_commit_chapter");
  return LongCommitChapterResultSchema.parse(
    await invokeCommand<LongCommitChapterResult>(
      createEnvelope("long.commitChapter", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function rollbackLongCommit(
  rawInput: LongRollbackLastCommitInput
): Promise<LongRollbackLastCommitResult> {
  const input = LongRollbackLastCommitInputSchema.parse(rawInput);
  const id = browserId("cmd_long_rollback");
  return LongRollbackLastCommitResultSchema.parse(
    await invokeCommand<LongRollbackLastCommitResult>(
      createEnvelope("long.rollbackLastCommit", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function unregisterLongBook(
  rawInput: LongRemoveBookInput
): Promise<LongRemoveBookResult> {
  const input = LongRemoveBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_unregister");
  return LongRemoveBookResultSchema.parse(
    await invokeCommand<LongRemoveBookResult>(
      createEnvelope("long.unregister", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function deleteLongBook(
  rawInput: LongRemoveBookInput
): Promise<LongRemoveBookResult> {
  const input = LongRemoveBookInputSchema.parse(rawInput);
  const id = browserId("cmd_long_delete");
  return LongRemoveBookResultSchema.parse(
    await invokeCommand<LongRemoveBookResult>(
      createEnvelope("long.delete", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function createLibrary(
  rawInput: CreateLibraryInput
): Promise<CatalogLibrary | null> {
  const input = CreateLibraryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_library");
  return CatalogLibrarySchema.nullable().parse(
    await invokeCommand<CatalogLibrary | null>(
      createEnvelope("catalog.createLibrary", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function createLibraryGroup(
  rawInput: CreateLibraryGroupInput
): Promise<CatalogLibraryGroup | null> {
  const input = CreateLibraryGroupInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_library_group");
  return CatalogLibraryGroupSchema.nullable().parse(
    await invokeCommand<CatalogLibraryGroup | null>(
      createEnvelope("catalog.createLibraryGroup", input, {
        id,
        correlationId: id
      })
    )
  );
}

async function openProject(
  rawDomain: CatalogProjectDomain
): Promise<CatalogOpenProjectResult | null> {
  const domain = CatalogProjectDomainSchema.parse(rawDomain);
  const id = browserId("cmd_catalog_open_project");
  return CatalogOpenProjectResultSchema.nullable().parse(
    await invokeCommand<CatalogOpenProjectResult | null>(
      createEnvelope("catalog.openProject", { domain }, {
        id,
        correlationId: id
      })
    )
  );
}

async function importLegacyBook(): Promise<ShortBook | null> {
  const id = browserId("cmd_catalog_import_legacy_book");
  return ShortBookSchema.nullable().parse(
    await invokeCommand<ShortBook | null>(
      createEnvelope("catalog.importLegacyBook", {}, { id, correlationId: id })
    )
  );
}

async function importLegacyLibrary(
  rawDomain: CatalogLibraryProjectDomain
): Promise<ImportLegacyLibraryResult | null> {
  const domain = CatalogLibraryProjectDomainSchema.parse(rawDomain);
  const id = browserId("cmd_catalog_import_legacy_library");
  return ImportLegacyLibraryResultSchema.nullable().parse(
    await invokeCommand<ImportLegacyLibraryResult | null>(
      createEnvelope(
        "catalog.importLegacyLibrary",
        { domain },
        { id, correlationId: id }
      )
    )
  );
}

async function updateBook(rawInput: UpdateBookInput): Promise<Book> {
  const input = UpdateBookInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_update_book");
  return BookSchema.parse(
    await invokeCommand<Book>(
      createEnvelope("catalog.updateBook", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function updateLibraryGroup(
  rawInput: UpdateLibraryGroupInput
): Promise<CatalogLibraryGroup> {
  const input = UpdateLibraryGroupInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_update_library_group");
  return CatalogLibraryGroupSchema.parse(
    await invokeCommand<CatalogLibraryGroup>(
      createEnvelope("catalog.updateLibraryGroup", input, {
        id,
        correlationId: id,
        context: { resourceId: input.groupId }
      })
    )
  );
}

async function deleteBook(bookId: string): Promise<DeleteBookResult> {
  const input = DeleteBookInputSchema.parse({ bookId });
  const id = browserId("cmd_catalog_delete_book");
  return DeleteBookResultSchema.parse(
    await invokeCommand<DeleteBookResult>(
      createEnvelope("catalog.deleteBook", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function saveDocument(
  rawInput: SaveDocumentInput
): Promise<CatalogDocument> {
  const input = SaveDocumentInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_save_document");
  return CatalogDocumentSchema.parse(
    await invokeCommand<CatalogDocument>(
      createEnvelope("catalog.saveDocument", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function createDraftSection(
  rawInput: CreateDraftSectionInput
): Promise<CatalogDraftSection> {
  const input = CreateDraftSectionInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_draft_section");
  return CatalogDraftSectionSchema.parse(
    await invokeCommand<CatalogDraftSection>(
      createEnvelope("catalog.createDraftSection", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function createDraftSections(
  rawInput: CreateDraftSectionsInput
): Promise<CreateDraftSectionsResult> {
  const input = CreateDraftSectionsInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_draft_sections");
  return CreateDraftSectionsResultSchema.parse(
    await invokeCommand<CreateDraftSectionsResult>(
      createEnvelope("catalog.createDraftSections", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function deleteDraftSection(
  rawInput: DeleteDraftSectionInput
): Promise<DeleteDraftSectionResult> {
  const input = DeleteDraftSectionInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_delete_draft_section");
  return DeleteDraftSectionResultSchema.parse(
    await invokeCommand<DeleteDraftSectionResult>(
      createEnvelope("catalog.deleteDraftSection", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

async function saveLibraryEntry(
  rawInput: SaveLibraryEntryInput
): Promise<CatalogLibraryEntry> {
  const input = SaveLibraryEntryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_save_library_entry");
  return CatalogLibraryEntrySchema.parse(
    await invokeCommand<CatalogLibraryEntry>(
      createEnvelope("catalog.saveLibraryEntry", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function createLibraryEntry(
  rawInput: CreateLibraryEntryInput
): Promise<CatalogLibraryEntry> {
  const input = CreateLibraryEntryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_create_library_entry");
  return CatalogLibraryEntrySchema.parse(
    await invokeCommand<CatalogLibraryEntry>(
      createEnvelope("catalog.createLibraryEntry", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function removeLibraryEntry(
  rawInput: RemoveLibraryEntryInput
): Promise<RemoveLibraryEntryResult> {
  const input = RemoveLibraryEntryInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_remove_library_entry");
  return RemoveLibraryEntryResultSchema.parse(
    await invokeCommand<RemoveLibraryEntryResult>(
      createEnvelope("catalog.removeLibraryEntry", input, {
        id,
        correlationId: id,
        context: { resourceId: input.libraryId }
      })
    )
  );
}

async function unregisterProject(
  rawInput: UnregisterCatalogProjectInput
): Promise<UnregisterCatalogProjectResult> {
  const input = UnregisterCatalogProjectInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_unregister_project");
  return UnregisterCatalogProjectResultSchema.parse(
    await invokeCommand<UnregisterCatalogProjectResult>(
      createEnvelope("catalog.unregisterProject", input, {
        id,
        correlationId: id,
        context: { resourceId: input.projectId }
      })
    )
  );
}

async function deleteProject(
  rawInput: DeleteCatalogProjectInput
): Promise<DeleteCatalogProjectResult> {
  const input = DeleteCatalogProjectInputSchema.parse(rawInput);
  const id = browserId("cmd_catalog_delete_project");
  return DeleteCatalogProjectResultSchema.parse(
    await invokeCommand<DeleteCatalogProjectResult>(
      createEnvelope("catalog.deleteProject", input, {
        id,
        correlationId: id,
        context: { resourceId: input.projectId }
      })
    )
  );
}

async function prompt(
  rawPayload: SessionPromptCommandPayload
): Promise<SessionPromptAcceptedPayload> {
  const payload = SessionPromptCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_prompt");
  const resourceId = payload.workspaceContext?.activeResource?.id;
  const accepted = SessionPromptAcceptedPayloadSchema.parse(
    await invokeCommand<SessionPromptAcceptedPayload>(
      createEnvelope("session.prompt", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          ...(resourceId ? { resourceId } : {})
        }
      })
    )
  );
  if (accepted.sessionId !== payload.sessionId) {
    throw new Error("Agent acceptance sessionId does not match the prompt request.");
  }
  return accepted;
}

async function abort(
  rawPayload: SessionAbortCommandPayload
): Promise<SessionAbortAcceptedPayload> {
  const payload = SessionAbortCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_abort");
  return SessionAbortAcceptedPayloadSchema.parse(
    await invokeCommand<SessionAbortAcceptedPayload>(
      createEnvelope("session.abort", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          runId: payload.runId
        }
      })
    )
  );
}

async function listModels(): Promise<ModelSettings> {
  const id = browserId("cmd_models_list");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.list", {}, { id, correlationId: id })
    )
  );
}

async function saveModels(rawSettings: ModelSettingsInput): Promise<ModelSettings> {
  const settings = ModelSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_models_save");
  return ModelSettingsSchema.parse(
    await invokeCommand<ModelSettings>(
      createEnvelope("models.save", settings, { id, correlationId: id })
    )
  );
}

async function testModel(rawModel: ModelConfigInput): Promise<ModelConnectionTestResult> {
  const model = ModelConfigInputSchema.parse(rawModel);
  const id = browserId("cmd_models_test");
  return ModelConnectionTestResultSchema.parse(
    await invokeCommand<ModelConnectionTestResult>(
      createEnvelope("models.test", { model }, { id, correlationId: id })
    )
  );
}

async function queryModelUsage(
  rawInput: ModelUsageQueryInput = {}
): Promise<ModelUsageDashboard> {
  const input = ModelUsageQueryInputSchema.parse(rawInput);
  const id = browserId("cmd_model_usage_query");
  return ModelUsageDashboardSchema.parse(
    await invokeCommand<ModelUsageDashboard>(
      createEnvelope("modelUsage.query", input, { id, correlationId: id })
    )
  );
}

async function listWorkspaceAgents(
  workspaceType: "short"
): Promise<ShortWorkspaceAgentSettings>;
async function listWorkspaceAgents(
  workspaceType: "script"
): Promise<ScriptWorkspaceAgentSettings>;
async function listWorkspaceAgents(
  rawWorkspaceType: WorkspaceType
): Promise<WorkspaceAgentSettings>;
async function listWorkspaceAgents(
  rawWorkspaceType: WorkspaceType
): Promise<WorkspaceAgentSettings> {
  const workspaceType = WorkspaceTypeSchema.parse(rawWorkspaceType);
  const id = browserId("cmd_workspace_agents_list");
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope(
        "workspaceAgents.list",
        { workspaceType },
        { id, correlationId: id }
      )
    )
  );
}

async function listLongAgents(): Promise<LongAgentSettings> {
  const id = browserId("cmd_long_agents_list");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope("longAgents.list", {}, { id, correlationId: id })
    )
  );
}

async function saveLongAgents(
  rawSettings: LongAgentSettingsInput
): Promise<LongAgentSettings> {
  const settings = LongAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_long_agents_save");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope("longAgents.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function resetLongAgents(
  rawAgentId?: LongAgentId
): Promise<LongAgentSettings> {
  const agentId = rawAgentId
    ? LongAgentIdSchema.parse(rawAgentId)
    : undefined;
  const id = browserId("cmd_long_agents_reset");
  return LongAgentSettingsSchema.parse(
    await invokeCommand<LongAgentSettings>(
      createEnvelope(
        "longAgents.reset",
        { ...(agentId ? { agentId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function listLongAgentTeams(): Promise<LongAgentTeamSettings> {
  const id = browserId("cmd_long_agent_teams_list");
  return LongAgentTeamSettingsSchema.parse(
    await invokeCommand<LongAgentTeamSettings>(
      createEnvelope("longAgentTeams.list", {}, {
        id,
        correlationId: id
      })
    )
  );
}

async function saveLongAgentTeams(
  rawSettings: LongAgentTeamSettingsInput
): Promise<LongAgentTeamSettings> {
  const settings = LongAgentTeamSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_long_agent_teams_save");
  return LongAgentTeamSettingsSchema.parse(
    await invokeCommand<LongAgentTeamSettings>(
      createEnvelope("longAgentTeams.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function listAgentTeams(
  workspaceType: "short"
): Promise<AgentTeamSettings>;
async function listAgentTeams(
  workspaceType: "script"
): Promise<ScriptAgentTeamSettings>;
async function listAgentTeams(
  rawWorkspaceType: WorkspaceType
): Promise<WorkspaceAgentTeamSettings>;
async function listAgentTeams(
  rawWorkspaceType: WorkspaceType
): Promise<WorkspaceAgentTeamSettings> {
  const workspaceType = WorkspaceTypeSchema.parse(rawWorkspaceType);
  const id = browserId("cmd_agent_teams_list");
  return WorkspaceAgentTeamSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentTeamSettings>(
      createEnvelope(
        "agentTeams.list",
        { workspaceType },
        { id, correlationId: id }
      )
    )
  );
}

async function saveAgentTeams(
  rawSettings: AgentTeamSettingsInput
): Promise<AgentTeamSettings>;
async function saveAgentTeams(
  rawSettings: ScriptAgentTeamSettingsInput
): Promise<ScriptAgentTeamSettings>;
async function saveAgentTeams(
  rawSettings: WorkspaceAgentTeamSettingsInput
): Promise<WorkspaceAgentTeamSettings>;
async function saveAgentTeams(
  rawSettings: WorkspaceAgentTeamSettingsInput
): Promise<WorkspaceAgentTeamSettings> {
  const settings = WorkspaceAgentTeamSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_agent_teams_save");
  return WorkspaceAgentTeamSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentTeamSettings>(
      createEnvelope("agentTeams.save", settings, { id, correlationId: id })
    )
  );
}

async function saveWorkspaceAgents(
  rawSettings: ShortWorkspaceAgentSettingsInput
): Promise<ShortWorkspaceAgentSettings>;
async function saveWorkspaceAgents(
  rawSettings: ScriptWorkspaceAgentSettingsInput
): Promise<ScriptWorkspaceAgentSettings>;
async function saveWorkspaceAgents(
  rawSettings: WorkspaceAgentSettingsInput
): Promise<WorkspaceAgentSettings>;
async function saveWorkspaceAgents(
  rawSettings: WorkspaceAgentSettingsInput
): Promise<WorkspaceAgentSettings> {
  const settings = WorkspaceAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_workspace_agents_save");
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope("workspaceAgents.save", settings, { id, correlationId: id })
    )
  );
}

async function resetWorkspaceAgents(
  workspaceType: "short",
  rawAgentId?: ShortWorkspaceAgentId
): Promise<ShortWorkspaceAgentSettings>;
async function resetWorkspaceAgents(
  workspaceType: "script",
  rawAgentId?: ScriptWorkspaceAgentId
): Promise<ScriptWorkspaceAgentSettings>;
async function resetWorkspaceAgents(
  rawWorkspaceType: WorkspaceType,
  rawAgentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
): Promise<WorkspaceAgentSettings>;
async function resetWorkspaceAgents(
  rawWorkspaceType: WorkspaceType,
  rawAgentId?: ShortWorkspaceAgentId | ScriptWorkspaceAgentId
): Promise<WorkspaceAgentSettings> {
  const workspaceType = WorkspaceTypeSchema.parse(rawWorkspaceType);
  const agentId = rawAgentId
    ? workspaceType === "script"
      ? ScriptWorkspaceAgentIdSchema.parse(rawAgentId)
      : ShortWorkspaceAgentIdSchema.parse(rawAgentId)
    : undefined;
  const id = browserId("cmd_workspace_agents_reset");
  return WorkspaceAgentSettingsSchema.parse(
    await invokeCommand<WorkspaceAgentSettings>(
      createEnvelope(
        "workspaceAgents.reset",
        { workspaceType, ...(agentId ? { agentId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function listLibraryAgents(): Promise<LibraryAgentSettings> {
  const id = browserId("cmd_library_agents_list");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope("libraryAgents.list", {}, { id, correlationId: id })
    )
  );
}

async function saveLibraryAgents(
  rawSettings: LibraryAgentSettingsInput
): Promise<LibraryAgentSettings> {
  const settings = LibraryAgentSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_library_agents_save");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope("libraryAgents.save", settings, { id, correlationId: id })
    )
  );
}

async function resetLibraryAgents(
  rawDomain?: LibraryAgentDomain
): Promise<LibraryAgentSettings> {
  const domain = rawDomain
    ? LibraryAgentDomainSchema.parse(rawDomain)
    : undefined;
  const id = browserId("cmd_library_agents_reset");
  return LibraryAgentSettingsSchema.parse(
    await invokeCommand<LibraryAgentSettings>(
      createEnvelope(
        "libraryAgents.reset",
        { ...(domain ? { domain } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function listLearningImitationSettings(): Promise<LearningImitationSettings> {
  const id = browserId("cmd_learning_imitation_settings_list");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope("learningImitationSettings.list", {}, { id, correlationId: id })
    )
  );
}

async function saveLearningImitationSettings(
  rawSettings: LearningImitationSettingsInput
): Promise<LearningImitationSettings> {
  const settings = LearningImitationSettingsInputSchema.parse(rawSettings);
  const id = browserId("cmd_learning_imitation_settings_save");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope("learningImitationSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function resetLearningImitationSettings(
  rawStageId?: LearningImitationStageId
): Promise<LearningImitationSettings> {
  const stageId = rawStageId
    ? LearningImitationStageIdSchema.parse(rawStageId)
    : undefined;
  const id = browserId("cmd_learning_imitation_settings_reset");
  return LearningImitationSettingsSchema.parse(
    await invokeCommand<LearningImitationSettings>(
      createEnvelope(
        "learningImitationSettings.reset",
        { ...(stageId ? { stageId } : {}) },
        { id, correlationId: id }
      )
    )
  );
}

async function listWorkspaceDirectory(): Promise<WorkspaceDirectorySettings> {
  const id = browserId("cmd_workspace_directory_list");
  return WorkspaceDirectorySettingsSchema.parse(
    await invokeCommand<WorkspaceDirectorySettings>(
      createEnvelope("workspaceDirectory.list", {}, { id, correlationId: id })
    )
  );
}

async function chooseWorkspaceDirectory(): Promise<WorkspaceDirectorySettings | null> {
  const id = browserId("cmd_workspace_directory_choose");
  return WorkspaceDirectorySettingsSchema.nullable().parse(
    await invokeCommand<WorkspaceDirectorySettings | null>(
      createEnvelope("workspaceDirectory.choose", {}, { id, correlationId: id })
    )
  );
}

async function listAppearance(): Promise<AppearanceSettingsSnapshot> {
  const id = browserId("cmd_appearance_list");
  return AppearanceSettingsSnapshotSchema.parse(
    await invokeCommand<AppearanceSettingsSnapshot>(
      createEnvelope("appearance.list", {}, { id, correlationId: id })
    )
  );
}

async function saveAppearance(
  rawSettings: AppearanceSettings
): Promise<AppearanceSettingsSnapshot> {
  const settings = AppearanceSettingsSchema.parse(rawSettings);
  const id = browserId("cmd_appearance_save");
  return AppearanceSettingsSnapshotSchema.parse(
    await invokeCommand<AppearanceSettingsSnapshot>(
      createEnvelope("appearance.save", settings, { id, correlationId: id })
    )
  );
}

async function listGeneralSettings(): Promise<GeneralSettingsSnapshot> {
  const id = browserId("cmd_general_settings_list");
  return GeneralSettingsSnapshotSchema.parse(
    await invokeCommand<GeneralSettingsSnapshot>(
      createEnvelope("generalSettings.list", {}, { id, correlationId: id })
    )
  );
}

async function saveGeneralSettings(
  rawSettings: GeneralSettings
): Promise<GeneralSettingsSnapshot> {
  const settings = GeneralSettingsSchema.parse(rawSettings);
  const id = browserId("cmd_general_settings_save");
  return GeneralSettingsSnapshotSchema.parse(
    await invokeCommand<GeneralSettingsSnapshot>(
      createEnvelope("generalSettings.save", settings, {
        id,
        correlationId: id
      })
    )
  );
}

async function exportShortManuscript(
  rawInput: ExportShortManuscriptInput
): Promise<ExportShortManuscriptResult> {
  const input = ExportShortManuscriptInputSchema.parse(rawInput);
  const id = browserId("cmd_manuscript_export_short");
  return ExportShortManuscriptResultSchema.parse(
    await invokeCommand<ExportShortManuscriptResult>(
      createEnvelope("manuscript.exportShort", input, {
        id,
        correlationId: id
      })
    )
  );
}

const api: DeepWriteApi = {
  system: {
    health: getHealth
  },
  catalog: {
    snapshot: getCatalogSnapshot,
    loadDraftRecovery,
    saveDraftRecovery,
    createShortBook,
    createScriptBook,
    createLibrary,
    createLibraryGroup,
    openProject,
    importLegacyBook,
    importLegacyLibrary,
    updateBook,
    updateLibraryGroup,
    deleteBook,
    saveDocument,
    createDraftSection,
    createDraftSections,
    deleteDraftSection,
    saveLibraryEntry,
    createLibraryEntry,
    removeLibraryEntry,
    unregisterProject,
    deleteProject
  },
  long: {
    list: listLongBooks,
    create: createLongBook,
    updateBindings: updateLongBookBindings,
    importWriteClaw: importWriteClawLongBook,
    importPortable: importPortableLongBook,
    open: openLongBook,
    openExisting: openExistingLongBook,
    getWorkspaceIndex: getLongWorkspaceIndex,
    readDocument: readLongDocument,
    writeDocument: writeLongDocument,
    previewOperations: previewLongOperations,
    applyOperations: applyLongOperations,
    writeChapter: writeLongChapter,
    commitChapter: commitLongChapter,
    rollbackLastCommit: rollbackLongCommit,
    unregister: unregisterLongBook,
    delete: deleteLongBook
  },
  session: {
    prompt,
    abort
  },
  models: {
    list: listModels,
    save: saveModels,
    test: testModel
  },
  modelUsage: {
    query: queryModelUsage
  },
  workspaceAgents: {
    list: listWorkspaceAgents,
    save: saveWorkspaceAgents,
    reset: resetWorkspaceAgents
  },
  longAgents: {
    list: listLongAgents,
    save: saveLongAgents,
    reset: resetLongAgents
  },
  longAgentTeams: {
    list: listLongAgentTeams,
    save: saveLongAgentTeams
  },
  agentTeams: {
    list: listAgentTeams,
    save: saveAgentTeams
  },
  libraryAgents: {
    list: listLibraryAgents,
    save: saveLibraryAgents,
    reset: resetLibraryAgents
  },
  learningImitationSettings: {
    list: listLearningImitationSettings,
    save: saveLearningImitationSettings,
    reset: resetLearningImitationSettings
  },
  workspaceDirectory: {
    list: listWorkspaceDirectory,
    choose: chooseWorkspaceDirectory
  },
  appearance: {
    list: listAppearance,
    save: saveAppearance
  },
  generalSettings: {
    list: listGeneralSettings,
    save: saveGeneralSettings
  },
  manuscript: {
    exportShort: exportShortManuscript
  },
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown): void => {
        const parsed = SystemEventEnvelopeSchema.safeParse(rawEvent);
        if (!parsed.success) {
          console.warn("DeepWrite discarded an invalid desktop event.");
          return;
        }
        listener(parsed.data as SystemEventEnvelope);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    }
  }
};

contextBridge.exposeInMainWorld("deepwrite", api);
