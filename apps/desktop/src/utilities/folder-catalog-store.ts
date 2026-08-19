import { join } from "node:path";
import { CatalogSnapshotSchema } from "@deepwrite/contracts";
import type {
  Book,
  CatalogDraftRecovery,
  CatalogDraftSection,
  CatalogIndexSnapshot,
  CatalogInstallMarketplaceSkillContentResult,
  CatalogReadDocumentInput,
  CatalogReadDocumentResult,
  CatalogSnapshot,
  CreateDraftSectionInput,
  CreateDraftSectionsInput,
  CreateDraftSectionsResult,
  CreateScriptBookInput,
  CreateShortBookInput,
  DeleteDraftSectionInput,
  DeleteDraftSectionResult,
  DuplicateCatalogProjectInput,
  DuplicateCatalogProjectResult,
  MarketplaceInstallPackage,
  MaterialEntry,
  MaterialLibrary,
  MaterialLibraryGroup,
  MoveDraftSectionInput,
  MoveDraftSectionResult,
  MoveLibraryEntryInput,
  MoveLibraryEntryResult,
  MutateCharacterStructureInput,
  MutatePlotStructureInput,
  SaveDocumentResult,
  SaveLibraryEntryInput,
  ScriptBook,
  ShortBook,
  SkillEntry,
  SkillLibrary,
  SkillLibraryGroup,
  UpdateLibraryGroupInput,
  UpdateLibraryInput
} from "@deepwrite/contracts";
import type { ImportedLegacyBook } from "./legacy-book-import";
import type { ImportedLegacyLibrary } from "./legacy-library-import";
import { mutateCharacterStructure } from "./folder-catalog-store/character-structure";
import {
  createDraftSection,
  createDraftSections,
  deleteDraftSection,
  moveDraftSection,
  saveDocument
} from "./folder-catalog-store/draft-sections";
import {
  createLibrary,
  createLibraryGroup,
  createScriptBook,
  createShortBook,
  deleteProject,
  duplicateProject,
  importLegacyBook,
  importLegacyLibrary,
  openBookProject,
  openCatalogProject,
  openMaterialProject,
  openSkillProject,
  removeBook,
  unregisterProject,
  updateBook,
  updateLibrary,
  updateLibraryGroup
} from "./folder-catalog-store/lifecycle";
import {
  createLibraryEntry,
  installMarketplaceSkillContent,
  moveLibraryEntry,
  removeLibraryEntry,
  saveLibraryEntry
} from "./folder-catalog-store/library-entries";
import { mutatePlotStructure } from "./folder-catalog-store/plot-stages";
import { writeRegistry } from "./folder-catalog-store/registry";
import {
  getProjectRevision,
  indexSnapshot,
  loadDraftRecovery,
  migrateSnapshot,
  readDocument,
  saveDraftRecovery,
  snapshot,
  syncSnapshot
} from "./folder-catalog-store/snapshot";
import {
  DEFAULT_MAX_DRAFT_RECOVERY_BYTES,
  DEFAULT_MAX_MANIFEST_BYTES,
  DEFAULT_MAX_MARKDOWN_BYTES,
  DEFAULT_MAX_PROJECT_CONTENT_BYTES,
  DEFAULT_MAX_SNAPSHOT_CONTENT_BYTES,
  DRAFT_RECOVERY_FILE,
  REGISTRY_BACKUP_FILE,
  REGISTRY_FILE,
  type CreateFolderLibraryEntryInput,
  type CreateFolderLibraryGroupInput,
  type CreateFolderLibraryInput,
  type CreateScriptBookAtDirectoryInput,
  type CreateShortBookAtDirectoryInput,
  type DeleteFolderCatalogProjectInput,
  type DeleteFolderCatalogProjectResult,
  type FolderCatalogProjectDomain,
  type FolderCatalogStoreContext,
  type FolderCatalogStoreOptions,
  type FolderCatalogRegistry,
  type OpenFolderCatalogProjectResult,
  type RemoveFolderLibraryEntryInput,
  type RemoveFolderLibraryEntryResult,
  type SaveFolderDocumentInput,
  type UnregisterFolderCatalogProjectInput,
  type UnregisterFolderCatalogProjectResult,
  type UpdateFolderBookInput
} from "./folder-catalog-store/types";

export {
  CATALOG_PROJECT_DOMAINS,
  FolderBookProjectManifestSchema,
  FolderCatalogConflictError,
  FolderCatalogProjectManifestSchema,
  FolderCurrentBookProjectManifestSchema,
  FolderLegacyBookProjectManifestSchema,
  FolderMaterialGroupProjectManifestSchema,
  FolderMaterialProjectManifestSchema,
  FolderSkillGroupProjectManifestSchema,
  FolderSkillProjectManifestSchema
} from "./folder-catalog-store/types";
export type {
  CreateFolderLibraryEntryInput,
  CreateFolderLibraryGroupInput,
  CreateFolderLibraryInput,
  CreateScriptBookAtDirectoryInput,
  CreateShortBookAtDirectoryInput,
  DeleteFolderCatalogProjectInput,
  DeleteFolderCatalogProjectResult,
  FolderBookProjectManifest,
  FolderCatalogLibraryDomain,
  FolderCatalogProjectDomain,
  FolderCatalogProjectManifest,
  FolderCatalogResource,
  FolderCatalogStoreOptions,
  FolderCatalogUnregisterDomain,
  FolderCurrentBookProjectManifest,
  FolderLegacyBookProjectManifest,
  FolderMaterialProjectManifest,
  FolderSkillProjectManifest,
  OpenFolderCatalogProjectResult,
  RemoveFolderLibraryEntryInput,
  RemoveFolderLibraryEntryResult,
  SaveFolderDocumentInput,
  UnregisterFolderCatalogProjectInput,
  UnregisterFolderCatalogProjectResult,
  UpdateFolderBookInput
} from "./folder-catalog-store/types";
export { assertLegacyBookMigrationSourcesUnchanged } from "./folder-catalog-store/migrations";

function positiveByteLimit(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`${label} byte limit must be a positive safe integer.`);
  }
  return limit;
}

export class FolderCatalogStore implements FolderCatalogStoreContext {
  readonly registryPath: string;
  readonly registryBackupPath: string;
  readonly projectsRoot: string;
  readonly draftRecoveryPath: string;
  readonly defaultProjectParents: Readonly<
    Record<FolderCatalogProjectDomain, string>
  >;
  readonly initialSnapshot: CatalogSnapshot | undefined;
  readonly now: () => string;
  readonly maxManifestBytes: number;
  readonly maxMarkdownBytes: number;
  readonly maxProjectContentBytes: number;
  readonly maxSnapshotContentBytes: number;
  readonly maxDraftRecoveryBytes: number;
  writeChain: Promise<void> = Promise.resolve();

  constructor(options: FolderCatalogStoreOptions) {
    const userDataPath = options.userDataPath.trim();
    if (!userDataPath) {
      throw new Error("FolderCatalogStore requires a user data path.");
    }
    this.registryPath = join(userDataPath, REGISTRY_FILE);
    this.registryBackupPath = join(userDataPath, REGISTRY_BACKUP_FILE);
    this.draftRecoveryPath = join(userDataPath, DRAFT_RECOVERY_FILE);
    this.projectsRoot = join(userDataPath, "catalog-projects");
    this.defaultProjectParents = {
      book: join(this.projectsRoot, "books"),
      "material-library": join(this.projectsRoot, "materials"),
      "material-group": join(this.projectsRoot, "material-groups"),
      "skill-library": join(this.projectsRoot, "skills"),
      "skill-group": join(this.projectsRoot, "skill-groups")
    };
    this.initialSnapshot = options.initialSnapshot
      ? CatalogSnapshotSchema.parse(structuredClone(options.initialSnapshot))
      : undefined;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxManifestBytes = positiveByteLimit(options.maxManifestBytes, DEFAULT_MAX_MANIFEST_BYTES, "manifest");
    this.maxMarkdownBytes = positiveByteLimit(options.maxMarkdownBytes, DEFAULT_MAX_MARKDOWN_BYTES, "Markdown");
    this.maxProjectContentBytes = positiveByteLimit(options.maxProjectContentBytes, DEFAULT_MAX_PROJECT_CONTENT_BYTES, "project content");
    this.maxSnapshotContentBytes = positiveByteLimit(options.maxSnapshotContentBytes, DEFAULT_MAX_SNAPSHOT_CONTENT_BYTES, "snapshot content");
    this.maxDraftRecoveryBytes = positiveByteLimit(options.maxDraftRecoveryBytes, DEFAULT_MAX_DRAFT_RECOVERY_BYTES, "draft recovery");
  }

  async writeRegistry(registry: FolderCatalogRegistry): Promise<void> {
    return writeRegistry(this, registry);
  }

  async snapshot(): Promise<CatalogSnapshot> { return snapshot(this); }
  async indexSnapshot(): Promise<CatalogIndexSnapshot> { return indexSnapshot(this); }
  async readDocument(rawInput: CatalogReadDocumentInput): Promise<CatalogReadDocumentResult> { return readDocument(this, rawInput); }
  async loadDraftRecovery(): Promise<CatalogDraftRecovery> { return loadDraftRecovery(this); }
  async saveDraftRecovery(rawDrafts: CatalogDraftRecovery): Promise<void> { return saveDraftRecovery(this, rawDrafts); }
  async migrateSnapshot(rawSnapshot: CatalogSnapshot): Promise<CatalogSnapshot> { return migrateSnapshot(this, rawSnapshot); }
  async syncSnapshot(rawSnapshot: CatalogSnapshot): Promise<CatalogSnapshot> { return syncSnapshot(this, rawSnapshot); }
  async createShortBook(rawInput: CreateShortBookInput, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<ShortBook>>;
  async createShortBook(rawInput: CreateShortBookAtDirectoryInput): Promise<OpenFolderCatalogProjectResult<ShortBook>>;
  async createShortBook(rawInput: CreateShortBookInput | CreateShortBookAtDirectoryInput, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<ShortBook>> { return createShortBook(this, rawInput, parentDirectory); }
  async createScriptBook(rawInput: CreateScriptBookInput, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<ScriptBook>>;
  async createScriptBook(rawInput: CreateScriptBookAtDirectoryInput): Promise<OpenFolderCatalogProjectResult<ScriptBook>>;
  async createScriptBook(rawInput: CreateScriptBookInput | CreateScriptBookAtDirectoryInput, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<ScriptBook>> { return createScriptBook(this, rawInput, parentDirectory); }
  async createLibrary(rawInput: CreateFolderLibraryInput & { domain: "material" }): Promise<OpenFolderCatalogProjectResult<MaterialLibrary>>;
  async createLibrary(rawInput: CreateFolderLibraryInput & { domain: "skill" }): Promise<OpenFolderCatalogProjectResult<SkillLibrary>>;
  async createLibrary(rawInput: CreateFolderLibraryInput): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>>;
  async createLibrary(rawInput: CreateFolderLibraryInput): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>> { return createLibrary(this, rawInput); }
  async updateLibrary(rawInput: UpdateLibraryInput): Promise<MaterialLibrary | SkillLibrary> { return updateLibrary(this, rawInput); }
  async createLibraryGroup(rawInput: CreateFolderLibraryGroupInput): Promise<OpenFolderCatalogProjectResult<MaterialLibraryGroup | SkillLibraryGroup>> { return createLibraryGroup(this, rawInput); }
  async importLegacyBook(input: ImportedLegacyBook, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<ShortBook>> { return importLegacyBook(this, input, parentDirectory); }
  async importLegacyLibrary(input: Extract<ImportedLegacyLibrary, { domain: "material" }>, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<MaterialLibrary>>;
  async importLegacyLibrary(input: Extract<ImportedLegacyLibrary, { domain: "skill" }>, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<SkillLibrary>>;
  async importLegacyLibrary(input: ImportedLegacyLibrary, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>>;
  async importLegacyLibrary(input: ImportedLegacyLibrary, parentDirectory?: string): Promise<OpenFolderCatalogProjectResult<MaterialLibrary | SkillLibrary>> { return importLegacyLibrary(this, input, parentDirectory); }
  async openCatalogProject(projectDirectory: string, expectedDomain?: FolderCatalogProjectDomain, register = true): Promise<OpenFolderCatalogProjectResult> { return openCatalogProject(this, projectDirectory, expectedDomain, register); }
  async openBookProject(projectDirectory: string, register = true): Promise<OpenFolderCatalogProjectResult<Book>> { return openBookProject(this, projectDirectory, register); }
  async openMaterialProject(projectDirectory: string, register = true): Promise<OpenFolderCatalogProjectResult<MaterialLibrary>> { return openMaterialProject(this, projectDirectory, register); }
  async openSkillProject(projectDirectory: string, register = true): Promise<OpenFolderCatalogProjectResult<SkillLibrary>> { return openSkillProject(this, projectDirectory, register); }
  async updateBook(rawInput: UpdateFolderBookInput): Promise<Book> { return updateBook(this, rawInput); }
  async mutatePlotStructure(rawInput: MutatePlotStructureInput): Promise<Book> { return mutatePlotStructure(this, rawInput); }
  async mutateCharacterStructure(rawInput: MutateCharacterStructureInput): Promise<Book> { return mutateCharacterStructure(this, rawInput); }
  async updateLibraryGroup(rawInput: UpdateLibraryGroupInput): Promise<MaterialLibraryGroup | SkillLibraryGroup> { return updateLibraryGroup(this, rawInput); }
  async saveDocument(rawInput: SaveFolderDocumentInput): Promise<SaveDocumentResult> { return saveDocument(this, rawInput); }
  async createDraftSection(rawInput: CreateDraftSectionInput): Promise<CatalogDraftSection> { return createDraftSection(this, rawInput); }
  async createDraftSections(rawInput: CreateDraftSectionsInput): Promise<CreateDraftSectionsResult> { return createDraftSections(this, rawInput); }
  async deleteDraftSection(rawInput: DeleteDraftSectionInput): Promise<DeleteDraftSectionResult> { return deleteDraftSection(this, rawInput); }
  async moveDraftSection(rawInput: MoveDraftSectionInput): Promise<MoveDraftSectionResult> { return moveDraftSection(this, rawInput); }
  async saveLibraryEntry(rawInput: SaveLibraryEntryInput): Promise<MaterialEntry | SkillEntry> { return saveLibraryEntry(this, rawInput); }
  async createLibraryEntry(rawInput: CreateFolderLibraryEntryInput & { domain: "material" }): Promise<MaterialEntry>;
  async createLibraryEntry(rawInput: CreateFolderLibraryEntryInput & { domain: "skill" }): Promise<SkillEntry>;
  async createLibraryEntry(rawInput: CreateFolderLibraryEntryInput): Promise<MaterialEntry | SkillEntry>;
  async createLibraryEntry(rawInput: CreateFolderLibraryEntryInput): Promise<MaterialEntry | SkillEntry> { return createLibraryEntry(this, rawInput); }
  async moveLibraryEntry(rawInput: MoveLibraryEntryInput): Promise<MoveLibraryEntryResult> { return moveLibraryEntry(this, rawInput); }
  async removeLibraryEntry(rawInput: RemoveFolderLibraryEntryInput): Promise<RemoveFolderLibraryEntryResult> { return removeLibraryEntry(this, rawInput); }
  async unregisterProject(rawInput: UnregisterFolderCatalogProjectInput): Promise<UnregisterFolderCatalogProjectResult> { return unregisterProject(this, rawInput); }
  async deleteProject(rawInput: DeleteFolderCatalogProjectInput): Promise<DeleteFolderCatalogProjectResult> { return deleteProject(this, rawInput); }
  async duplicateProject(rawInput: DuplicateCatalogProjectInput): Promise<DuplicateCatalogProjectResult> { return duplicateProject(this, rawInput); }
  async installMarketplaceSkillContent(rawInput: MarketplaceInstallPackage): Promise<CatalogInstallMarketplaceSkillContentResult> { return installMarketplaceSkillContent(this, rawInput); }
  async removeBook(bookId: string): Promise<{ bookId: string; deleted: boolean }> { return removeBook(this, bookId); }
  async getProjectRevision(id: string, domain: FolderCatalogProjectDomain): Promise<number> { return getProjectRevision(this, id, domain); }
}
