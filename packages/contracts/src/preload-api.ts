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
  UnregisterCatalogProjectInput,
  UnregisterCatalogProjectResult,
  UpdateBookInput,
  UpdateLibraryGroupInput
} from "./catalog";

export interface DeepWriteApi {
  system: {
    health(): Promise<SystemHealthPayload>;
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
    updateLibraryGroup(input: UpdateLibraryGroupInput): Promise<CatalogLibraryGroup>;
    deleteBook(bookId: string): Promise<DeleteBookResult>;
    saveDocument(input: SaveDocumentInput): Promise<CatalogDocument>;
    createDraftSection(input: CreateDraftSectionInput): Promise<CatalogDraftSection>;
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
  session: {
    prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload>;
    abort(payload: SessionAbortCommandPayload): Promise<SessionAbortAcceptedPayload>;
  };
  models: {
    list(): Promise<ModelSettings>;
    save(settings: ModelSettingsInput): Promise<ModelSettings>;
    test(model: ModelConfigInput): Promise<ModelConnectionTestResult>;
  };
  workspaceAgents: {
    list(workspaceType: WorkspaceType): Promise<WorkspaceAgentSettings>;
    save(settings: WorkspaceAgentSettingsInput): Promise<WorkspaceAgentSettings>;
    reset(
      workspaceType: WorkspaceType,
      agentId?: WorkspaceAgentId
    ): Promise<WorkspaceAgentSettings>;
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
  manuscript: {
    exportShort(
      input: ExportShortManuscriptInput
    ): Promise<ExportShortManuscriptResult>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
