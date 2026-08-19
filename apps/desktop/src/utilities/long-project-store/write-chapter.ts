import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWriteChapterInputSchema,
  type LongWriteChapterResult
} from "@deepwrite/contracts";
import { ProjectTransactionConflictError } from "../project-transaction";
import { loadIndexedFile } from "./cache";
import {
  commitLongProjectTransaction,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { firstEmptyChapter } from "./paths";
import { createLongFileRevision, longRevisionsMatchContent } from "./revisions";
import type { LongProjectStoreContext } from "./store-context";
import {
  LongProjectConflictError,
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  type StoreWriteLongChapterInput
} from "./types";

export async function writeChapter(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  rawInput: StoreWriteLongChapterInput
): Promise<LongWriteChapterResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
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
    const entry = loaded.index.chapters.find(
      (candidate) => candidate.chapterCardId === input.chapterCardId
    );
    if (!entry) {
      throw new Error("当前长篇章卡不存在。");
    }
    const nextChapter = firstEmptyChapter(loaded.index);
    if (
      entry.bodyStatus === "empty" &&
      (!nextChapter || nextChapter.id !== input.chapterCardId)
    ) {
      throw new Error("长篇首次写作不能跨过前面的空白章节。");
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
    const timestamp = ctx.timestamp();
    for (const write of writes) {
      write.file.reference.revision = createLongFileRevision(
        write.input.content
      );
      write.file.reference.updatedAt = timestamp;
    }
    entry.bodyStatus = input.body.content.trim() ? "written" : "empty";
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
    const next = await loadProject(ctx, loaded.projectDirectory);
    const nextEntry = next.index.chapters.find(
      (candidate) => candidate.chapterCardId === input.chapterCardId
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
