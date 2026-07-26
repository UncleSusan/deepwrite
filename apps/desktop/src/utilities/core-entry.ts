import {
  CatalogDocumentSchema,
  CatalogDraftSectionSchema,
  CreateDraftSectionsResultSchema,
  CatalogDraftRecoverySaveResultSchema,
  CatalogDraftRecoverySchema,
  CatalogLibrarySchema,
  CatalogLibraryGroupSchema,
  CatalogLibraryEntrySchema,
  CatalogOpenProjectResultSchema,
  CatalogSnapshotSchema,
  BookSchema,
  DeleteCatalogProjectResultSchema,
  DeleteBookResultSchema,
  DeleteDraftSectionResultSchema,
  RemoveLibraryEntryResultSchema,
  ScriptBookSchema,
  ShortBookSchema,
  LongApplyOperationsResultSchema,
  LongCommitChapterResultSchema,
  LongImportPortableResultSchema,
  LongImportWriteClawResultSchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsResultSchema,
  LongReadDocumentResultSchema,
  LongRemoveBookResultSchema,
  LongRollbackLastCommitResultSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentResultSchema,
  UnregisterCatalogProjectResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { existsSync } from "node:fs";
import { CatalogStore } from "./catalog-store";
import {
  FolderCatalogConflictError,
  FolderCatalogStore
} from "./folder-catalog-store";
import { readLegacyBookArchive } from "./legacy-book-import";
import { readLegacyLibraryArchive } from "./legacy-library-import";
import { bootUtility } from "./runtime";
import { LongProjectConflictError } from "./long-project-store";
import { LongWorkspaceService } from "./long-workspace-service";

const userDataPath = process.env.DEEPWRITE_USER_DATA_PATH?.trim();
if (!userDataPath) {
  throw new Error("Core Utility requires DEEPWRITE_USER_DATA_PATH.");
}
const resolvedUserDataPath = userDataPath;

function legacyDataRootsFromEnvironment(): string[] {
  const encodedRoots = process.env.DEEPWRITE_LEGACY_DATA_ROOTS?.trim();
  if (encodedRoots) {
    try {
      const parsed = JSON.parse(encodedRoots) as unknown;
      if (Array.isArray(parsed)) {
        const roots = parsed.filter(
          (value): value is string => typeof value === "string" && value.trim() !== ""
        );
        if (roots.length > 0) {
          return roots;
        }
      }
    } catch {
      // Fall back to the single-root environment variable for older launchers.
    }
  }
  const legacyDataRoot = process.env.DEEPWRITE_LEGACY_DATA_ROOT?.trim();
  return legacyDataRoot ? [legacyDataRoot] : [];
}

const legacyDataRoots = legacyDataRootsFromEnvironment();
const legacyCatalogStore = new CatalogStore({
  userDataPath: resolvedUserDataPath,
  ...(legacyDataRoots.length > 0 ? { legacyDataRoots } : {})
});
let catalogStoreInitialization: Promise<FolderCatalogStore> | undefined;
const draftRecoveryStore = new FolderCatalogStore({
  userDataPath: resolvedUserDataPath
});
const longWorkspaceService = new LongWorkspaceService({
  userDataPath: resolvedUserDataPath
});

async function requireCatalogStore(): Promise<FolderCatalogStore> {
  if (!catalogStoreInitialization) {
    const initialization = (async () => {
      const existingFolderStore = new FolderCatalogStore({
        userDataPath: resolvedUserDataPath
      });
      if (existsSync(existingFolderStore.registryPath)) {
        await existingFolderStore.snapshot();
        return existingFolderStore;
      }
      const legacySnapshot = await legacyCatalogStore.snapshot();
      const folderStore = new FolderCatalogStore({
        userDataPath: resolvedUserDataPath,
        initialSnapshot: legacySnapshot
      });
      await folderStore.snapshot();
      return folderStore;
    })();
    catalogStoreInitialization = initialization.catch((error: unknown) => {
      catalogStoreInitialization = undefined;
      throw error;
    });
  }
  return await catalogStoreInitialization;
}

async function handleCatalogCommand(
  command: CommandEnvelope
): Promise<CommandResult> {
  try {
    if (command.type === "long.list") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongListBooksResultSchema.parse(
          await longWorkspaceService.list()
        )
      };
    }
    if (command.type === "long.createBookAtPath") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.create(
            command.payload.parentDirectory,
            command.payload.input
          )
        )
      };
    }
    if (command.type === "long.importWriteClawAtPath") {
      const imported = await longWorkspaceService.importWriteClawBook(
        command.payload.parentDirectory,
        command.payload.sourcePath
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongImportWriteClawResultSchema.parse({
          book: imported.book,
          summary: imported.summary,
          sourceKind: imported.sourceKind,
          legacySchemaVersion: imported.legacySchemaVersion,
          committedChapterPolicy: imported.committedChapterPolicy,
          warnings: imported.warnings
        })
      };
    }
    if (command.type === "long.importPortableAtPath") {
      const imported = await longWorkspaceService.importPortableBundle(
        command.payload.parentDirectory,
        command.payload.sourcePath
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongImportPortableResultSchema.parse({
          book: imported.book,
          summary: imported.summary,
          exportedAt: imported.exportedAt
        })
      };
    }
    if (command.type === "long.openAtPath") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.openAtPath(
            command.payload.projectDirectory
          )
        )
      };
    }
    if (command.type === "long.open") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.open(command.payload)
        )
      };
    }
    if (command.type === "long.updateBindings") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongOpenBookResultSchema.parse(
          await longWorkspaceService.updateBindings(command.payload)
        )
      };
    }
    if (command.type === "long.getWorkspaceIndex") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongWorkspaceIndexResultSchema.parse(
          await longWorkspaceService.getWorkspaceIndex(command.payload)
        )
      };
    }
    if (command.type === "long.readDocument") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongReadDocumentResultSchema.parse(
          await longWorkspaceService.readDocument(command.payload)
        )
      };
    }
    if (command.type === "long.search") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongSearchResultSchema.parse(
          await longWorkspaceService.search(command.payload)
        )
      };
    }
    if (command.type === "long.writeDocument") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongWriteDocumentResultSchema.parse(
          await longWorkspaceService.writeDocument(command.payload)
        )
      };
    }
    if (command.type === "long.previewOperations") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongPreviewOperationsResultSchema.parse(
          await longWorkspaceService.previewOperations(command.payload)
        )
      };
    }
    if (command.type === "long.applyOperations") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongApplyOperationsResultSchema.parse(
          await longWorkspaceService.applyOperations(command.payload)
        )
      };
    }
    if (command.type === "long.writeChapter") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongWriteChapterResultSchema.parse(
          await longWorkspaceService.writeChapter(command.payload)
        )
      };
    }
    if (command.type === "long.commitChapter") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongCommitChapterResultSchema.parse(
          await longWorkspaceService.commitChapter(command.payload)
        )
      };
    }
    if (command.type === "long.rollbackLastCommit") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongRollbackLastCommitResultSchema.parse(
          await longWorkspaceService.rollbackLastCommit(command.payload)
        )
      };
    }
    if (command.type === "long.unregister") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongRemoveBookResultSchema.parse(
          await longWorkspaceService.unregister(command.payload)
        )
      };
    }
    if (command.type === "long.delete") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: LongRemoveBookResultSchema.parse(
          await longWorkspaceService.delete(command.payload)
        )
      };
    }
    if (command.type === "catalog.loadDraftRecovery") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogDraftRecoverySchema.parse(
          await draftRecoveryStore.loadDraftRecovery()
        )
      };
    }
    if (command.type === "catalog.saveDraftRecovery") {
      await draftRecoveryStore.saveDraftRecovery(command.payload.drafts);
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogDraftRecoverySaveResultSchema.parse({ saved: true })
      };
    }
    const catalogStore = await requireCatalogStore();
    if (command.type === "catalog.snapshot") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogSnapshotSchema.parse(await catalogStore.snapshot())
      };
    }
    if (command.type === "catalog.createShortBook") {
      const created = await catalogStore.createShortBook(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: ShortBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createScriptBook") {
      const created = await catalogStore.createScriptBook(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: ScriptBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createShortBookAtPath") {
      const created = await catalogStore.createShortBook(
        command.payload.input,
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: ShortBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createScriptBookAtPath") {
      const created = await catalogStore.createScriptBook(
        command.payload.input,
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: ScriptBookSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.importLegacyBookAtPath") {
      const imported = await catalogStore.importLegacyBook(
        await readLegacyBookArchive(command.payload.archivePath),
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: ShortBookSchema.parse(imported.resource)
      };
    }
    if (command.type === "catalog.importLegacyLibraryAtPath") {
      const imported = await catalogStore.importLegacyLibrary(
        await readLegacyLibraryArchive(
          command.payload.archivePath,
          command.payload.domain
        ),
        command.payload.parentDirectory
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibrarySchema.parse(imported.resource)
      };
    }
    if (command.type === "catalog.createLibraryAtPath") {
      const created = await catalogStore.createLibrary(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibrarySchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createLibraryGroup") {
      const created = await catalogStore.createLibraryGroup(command.payload);
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryGroupSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.createLibraryGroupAtPath") {
      const created = await catalogStore.createLibraryGroup({
        ...command.payload.input,
        parentDirectory: command.payload.parentDirectory
      });
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryGroupSchema.parse(created.resource)
      };
    }
    if (command.type === "catalog.openProjectAtPath") {
      const opened =
        command.payload.domain === "book"
          ? await catalogStore.openBookProject(command.payload.projectDirectory)
          : command.payload.domain === "material"
            ? await catalogStore.openMaterialProject(command.payload.projectDirectory)
            : await catalogStore.openSkillProject(command.payload.projectDirectory);
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogOpenProjectResultSchema.parse({
          domain: command.payload.domain,
          id: opened.resource.id,
          title: opened.resource.title
        })
      };
    }
    if (command.type === "catalog.updateBook") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: BookSchema.parse(await catalogStore.updateBook(command.payload))
      };
    }
    if (command.type === "catalog.updateLibraryGroup") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryGroupSchema.parse(
          await catalogStore.updateLibraryGroup(command.payload)
        )
      };
    }
    if (command.type === "catalog.deleteBook") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: DeleteBookResultSchema.parse(
          await catalogStore.removeBook(command.payload.bookId)
        )
      };
    }
    if (command.type === "catalog.saveDocument") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogDocumentSchema.parse(
          await catalogStore.saveDocument(command.payload)
        )
      };
    }
    if (command.type === "catalog.createDraftSection") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogDraftSectionSchema.parse(
          await catalogStore.createDraftSection(command.payload)
        )
      };
    }
    if (command.type === "catalog.createDraftSections") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CreateDraftSectionsResultSchema.parse(
          await catalogStore.createDraftSections(command.payload)
        )
      };
    }
    if (command.type === "catalog.deleteDraftSection") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: DeleteDraftSectionResultSchema.parse(
          await catalogStore.deleteDraftSection(command.payload)
        )
      };
    }
    if (command.type === "catalog.saveLibraryEntry") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryEntrySchema.parse(
          await catalogStore.saveLibraryEntry(command.payload)
        )
      };
    }
    if (command.type === "catalog.createLibraryEntry") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: CatalogLibraryEntrySchema.parse(
          await catalogStore.createLibraryEntry(command.payload)
        )
      };
    }
    if (command.type === "catalog.removeLibraryEntry") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: RemoveLibraryEntryResultSchema.parse(
          await catalogStore.removeLibraryEntry(command.payload)
        )
      };
    }
    if (command.type === "catalog.unregisterProject") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: UnregisterCatalogProjectResultSchema.parse(
          await catalogStore.unregisterProject(command.payload)
        )
      };
    }
    if (command.type === "catalog.deleteProject") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: DeleteCatalogProjectResultSchema.parse(
          await catalogStore.deleteProject(command.payload)
        )
      };
    }
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "core.unsupported_command",
        message: `Core Utility does not handle ${command.type}.`
      }
    };
  } catch (error: unknown) {
    if (error instanceof LongProjectConflictError) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "long.conflict",
          message: error.message,
          details: {
            scope: error.scope,
            expectedRevision: error.expected,
            actualRevision: error.actual
          }
        }
      };
    }
    if (error instanceof FolderCatalogConflictError) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "catalog.conflict",
          message: error.message,
          details: {
            expectedRevision: error.expectedRevision,
            actualRevision: error.actualRevision
          }
        }
      };
    }
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "catalog.command_failed",
        message: error instanceof Error ? error.message : "目录操作失败。",
        details: {
          kind: error instanceof Error ? error.name : "unknown"
        }
      }
    };
  }
}

bootUtility("core", {
  mode: "catalog-store",
  commandHandler: handleCatalogCommand
});
