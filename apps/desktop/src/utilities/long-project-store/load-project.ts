import {
  LongBookSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  createLongBookSummary
} from "@deepwrite/contracts";
import { recoverProjectTransaction } from "../project-transaction";
import { validatePortableAndCanonicalPaths } from "./integrity";
import { parseJson, readSecureTextFile, secureDirectory } from "./io";
import {
  migrateLegacyChapterBodyStatus,
  migrateLegacyChapterCardContent
} from "./migrations/chapter-card";
import {
  migrateLegacyChapterContinuityFiles,
  migrateLegacyStructuredContinuityFiles
} from "./migrations/continuity";
import { migrateLegacyArcOutlineToStoryPlots } from "./migrations/story-plots";
import {
  migrateLegacyCharacterOverviewStorage,
  migrateLegacyCharacterTypes,
  migrateLegacyWorldbuildingStorage
} from "./migrations/world-character";
import { indexedFileSlots } from "./paths";
import { longRevisionsMatchContent } from "./revisions";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_INDEX_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  MAX_MANIFEST_BYTES,
  type IndexedFileDescriptor,
  type LoadedLongProject
} from "./types";

export async function loadProject(
  ctx: LongProjectStoreContext,
  rawProjectDirectory: string
): Promise<LoadedLongProject> {
  let projectDirectory = await secureDirectory(
    rawProjectDirectory,
    "长篇项目目录"
  );
  await recoverProjectTransaction(projectDirectory, MAX_LEDGER_RECORD_BYTES);
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
  if (
    !longRevisionsMatchContent(
      manifest.workspaceIndexFile.revision,
      indexDisk.revision,
      indexDisk.bytes
    )
  ) {
    throw new Error("长篇 manifest 中的索引 revision 与实际文件不一致。");
  }
  const rawIndex = parseJson(indexDisk.content, "长篇工作区索引");
  if (
    await migrateLegacyCharacterTypes({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyChapterBodyStatus({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyWorldbuildingStorage({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyCharacterOverviewStorage({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyArcOutlineToStoryPlots({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyChapterCardContent({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyChapterContinuityFiles({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  if (
    await migrateLegacyStructuredContinuityFiles({
      projectDirectory,
      manifest,
      manifestDisk,
      indexDisk,
      rawIndex
    })
  ) {
    return await loadProject(ctx, projectDirectory);
  }
  const index = LongWorkspaceIndexSnapshotSchema.parse(rawIndex);
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
