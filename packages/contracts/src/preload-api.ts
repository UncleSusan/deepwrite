import type {
  SessionAbortAcceptedPayload,
  SessionAbortCommandPayload,
  SessionPromptAcceptedPayload,
  SessionPromptCommandPayload
} from "./session";
import type {
  ModelConnectionTestResult,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput
} from "./models";
import type { ModelUsageDashboard, ModelUsageQueryInput } from "./model-usage";
import type { SystemEventEnvelope, SystemHealthPayload } from "./system";
import type {
  WorkspaceAgentId,
  WorkspaceAgentSettings,
  WorkspaceAgentSettingsInput
} from "./workspace";
import type {
  WorkspaceAgentTeamSettings,
  WorkspaceAgentTeamSettingsInput
} from "./agent-team";
import type { WorkspaceType } from "./script-workspace";
import type { WorkspaceDirectorySettings } from "./workspace-directory";
import type {
  AppearanceSettings,
  AppearanceSettingsSnapshot
} from "./appearance";
import type {
  GeneralSettings,
  GeneralSettingsSnapshot
} from "./general-settings";
import type {
  ExportShortManuscriptInput,
  ExportShortManuscriptResult
} from "./short-manuscript-export";
import type {
  LearningImitationSettings,
  LearningImitationSettingsInput,
  LearningImitationStageId
} from "./learning-imitation";
import type {
  LibraryAgentDomain,
  LibraryAgentSettings,
  LibraryAgentSettingsInput
} from "./library-agent";
import type {
  CatalogDocument,
  CatalogDraftSection,
  CatalogDraftRecovery,
  CatalogLibrary,
  CatalogLibraryGroup,
  CatalogLibraryEntry,
  CatalogOpenProjectResult,
  CatalogProjectDomain,
  CatalogSnapshot,
  CatalogLibraryProjectDomain,
  CreateLibraryEntryInput,
  CreateDraftSectionInput,
  CreateDraftSectionsInput,
  CreateDraftSectionsResult,
  CreateLibraryGroupInput,
  CreateLibraryInput,
  CreateScriptBookInput,
  CreateShortBookInput,
  DeleteCatalogProjectInput,
  DeleteCatalogProjectResult,
  DeleteBookResult,
  DeleteDraftSectionInput,
  DeleteDraftSectionResult,
  RemoveLibraryEntryInput,
  RemoveLibraryEntryResult,
  SaveDocumentInput,
  SaveLibraryEntryInput,
  ScriptBook,
  ShortBook,
  Book,
  ImportLegacyLibraryResult,
  MutateCharacterStructureInput,
  MutatePlotStructureInput,
  UnregisterCatalogProjectInput,
  UnregisterCatalogProjectResult,
  UpdateBookInput,
  UpdateLibraryGroupInput
} from "./catalog";
import type {
  CreateLongBookInput,
  LongImportPortableResult,
  LongImportWriteClawResult,
  LongApplyOperationsInput,
  LongApplyOperationsResult,
  LongListBooksResult,
  LongOpenBookInput,
  LongOpenBookResult,
  LongPreviewOperationsInput,
  LongPreviewOperationsResult,
  LongReadDocumentInput,
  LongReadDocumentResult,
  LongRemoveBookInput,
  LongRemoveBookResult,
  LongUpdateBindingsInput,
  LongWorkspaceIndexResult,
  LongWriteDocumentInput,
  LongWriteDocumentResult
} from "./long-workspace-api";
import type {
  LongCommitChapterInput,
  LongCommitChapterResult,
  LongRollbackLastCommitInput,
  LongRollbackLastCommitResult,
  LongWriteChapterInput,
  LongWriteChapterResult
} from "./long-ledger";
import type {
  LongAgentSettings,
  LongAgentSettingsInput
} from "./long-agent-settings";
import type {
  LongAgentTeamSettings,
  LongAgentTeamSettingsInput
} from "./long-agent-team";
import type { LongAgentId } from "./long-workspace";
import type { UpdateState } from "./update";
import type { AppAlertSnapshot } from "./app-alert";

export interface DeepWriteApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  updates: {
    getState(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): Promise<void>;
    subscribe(listener: (state: UpdateState) => void): () => void;
  };
  appAlerts: {
    get(): Promise<AppAlertSnapshot>;
    acknowledgeDesktop(revision: string): Promise<void>;
  };
  catalog: {
    snapshot(): Promise<CatalogSnapshot>;
    loadDraftRecovery(): Promise<CatalogDraftRecovery>;
    saveDraftRecovery(drafts: CatalogDraftRecovery): Promise<void>;
    createShortBook(input: CreateShortBookInput): Promise<ShortBook | null>;
    createScriptBook(input: CreateScriptBookInput): Promise<ScriptBook | null>;
    createLibrary(input: CreateLibraryInput): Promise<CatalogLibrary | null>;
    createLibraryGroup(input: CreateLibraryGroupInput): Promise<CatalogLibraryGroup | null>;
    openProject(domain: CatalogProjectDomain): Promise<CatalogOpenProjectResult | null>;
    importLegacyBook(): Promise<ShortBook | null>;
    importLegacyLibrary(
      domain: CatalogLibraryProjectDomain
    ): Promise<ImportLegacyLibraryResult | null>;
    updateBook(input: UpdateBookInput): Promise<Book>;
    mutateCharacterStructure(input: MutateCharacterStructureInput): Promise<Book>;
    mutatePlotStructure(input: MutatePlotStructureInput): Promise<Book>;
    updateLibraryGroup(input: UpdateLibraryGroupInput): Promise<CatalogLibraryGroup>;
    deleteBook(bookId: string): Promise<DeleteBookResult>;
    saveDocument(input: SaveDocumentInput): Promise<CatalogDocument>;
    createDraftSection(input: CreateDraftSectionInput): Promise<CatalogDraftSection>;
    createDraftSections(
      input: CreateDraftSectionsInput
    ): Promise<CreateDraftSectionsResult>;
    deleteDraftSection(
      input: DeleteDraftSectionInput
    ): Promise<DeleteDraftSectionResult>;
    saveLibraryEntry(input: SaveLibraryEntryInput): Promise<CatalogLibraryEntry>;
    createLibraryEntry(input: CreateLibraryEntryInput): Promise<CatalogLibraryEntry>;
    removeLibraryEntry(input: RemoveLibraryEntryInput): Promise<RemoveLibraryEntryResult>;
    unregisterProject(
      input: UnregisterCatalogProjectInput
    ): Promise<UnregisterCatalogProjectResult>;
    deleteProject(
      input: DeleteCatalogProjectInput
    ): Promise<DeleteCatalogProjectResult>;
  };
  long: {
    list(): Promise<LongListBooksResult>;
    create(input: CreateLongBookInput): Promise<LongOpenBookResult | null>;
    importWriteClaw(): Promise<LongImportWriteClawResult | null>;
    importPortable(): Promise<LongImportPortableResult | null>;
    open(input: LongOpenBookInput): Promise<LongOpenBookResult>;
    updateBindings(
      input: LongUpdateBindingsInput
    ): Promise<LongOpenBookResult>;
    openExisting(): Promise<LongOpenBookResult | null>;
    getWorkspaceIndex(
      input: LongOpenBookInput
    ): Promise<LongWorkspaceIndexResult>;
    readDocument(
      input: LongReadDocumentInput
    ): Promise<LongReadDocumentResult>;
    writeDocument(
      input: LongWriteDocumentInput
    ): Promise<LongWriteDocumentResult>;
    previewOperations(
      input: LongPreviewOperationsInput
    ): Promise<LongPreviewOperationsResult>;
    applyOperations(
      input: LongApplyOperationsInput
    ): Promise<LongApplyOperationsResult>;
    writeChapter(
      input: LongWriteChapterInput
    ): Promise<LongWriteChapterResult>;
    commitChapter(
      input: LongCommitChapterInput
    ): Promise<LongCommitChapterResult>;
    rollbackLastCommit(
      input: LongRollbackLastCommitInput
    ): Promise<LongRollbackLastCommitResult>;
    unregister(input: LongRemoveBookInput): Promise<LongRemoveBookResult>;
    delete(input: LongRemoveBookInput): Promise<LongRemoveBookResult>;
  };
  session: {
    prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload>;
    abort(payload: SessionAbortCommandPayload): Promise<SessionAbortAcceptedPayload>;
  };
  models: {
    list(): Promise<ModelSettings>;
    refreshFree(): Promise<ModelSettings>;
    refreshOfficial(): Promise<ModelSettings>;
    saveOfficialToken(apiKey: string): Promise<ModelSettings>;
    clearOfficialToken(): Promise<ModelSettings>;
    save(settings: ModelSettingsInput): Promise<ModelSettings>;
    test(model: ModelConfigInput): Promise<ModelConnectionTestResult>;
  };
  modelUsage: {
    query(input?: ModelUsageQueryInput): Promise<ModelUsageDashboard>;
  };
  workspaceAgents: {
    list(workspaceType: WorkspaceType): Promise<WorkspaceAgentSettings>;
    save(settings: WorkspaceAgentSettingsInput): Promise<WorkspaceAgentSettings>;
    reset(
      workspaceType: WorkspaceType,
      agentId?: WorkspaceAgentId
    ): Promise<WorkspaceAgentSettings>;
  };
  longAgents: {
    list(): Promise<LongAgentSettings>;
    save(settings: LongAgentSettingsInput): Promise<LongAgentSettings>;
    reset(agentId?: LongAgentId): Promise<LongAgentSettings>;
  };
  longAgentTeams: {
    list(): Promise<LongAgentTeamSettings>;
    save(
      settings: LongAgentTeamSettingsInput
    ): Promise<LongAgentTeamSettings>;
  };
  agentTeams: {
    list(workspaceType: WorkspaceType): Promise<WorkspaceAgentTeamSettings>;
    save(
      settings: WorkspaceAgentTeamSettingsInput
    ): Promise<WorkspaceAgentTeamSettings>;
  };
  libraryAgents: {
    list(): Promise<LibraryAgentSettings>;
    save(settings: LibraryAgentSettingsInput): Promise<LibraryAgentSettings>;
    reset(domain?: LibraryAgentDomain): Promise<LibraryAgentSettings>;
  };
  learningImitationSettings: {
    list(): Promise<LearningImitationSettings>;
    save(settings: LearningImitationSettingsInput): Promise<LearningImitationSettings>;
    reset(stageId?: LearningImitationStageId): Promise<LearningImitationSettings>;
  };
  workspaceDirectory: {
    list(): Promise<WorkspaceDirectorySettings>;
    choose(): Promise<WorkspaceDirectorySettings | null>;
  };
  appearance: {
    list(): Promise<AppearanceSettingsSnapshot>;
    save(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;
  };
  generalSettings: {
    list(): Promise<GeneralSettingsSnapshot>;
    save(settings: GeneralSettings): Promise<GeneralSettingsSnapshot>;
  };
  manuscript: {
    exportShort(
      input: ExportShortManuscriptInput
    ): Promise<ExportShortManuscriptResult>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
