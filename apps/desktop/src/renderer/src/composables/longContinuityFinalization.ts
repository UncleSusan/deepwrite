import {
  LongCommitChapterInputSchema,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";

export type LongContinuityFinalizationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.ledger_commit_proposal" }
>;

function ipcSafeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function continuityFinalizationKey(
  event: LongContinuityFinalizationEvent
): string {
  return `${event.payload.bookId}\u0000${event.payload.input.chapterCardId}`;
}

export async function commitLongContinuityFinalization(
  api: LongWorkspaceRendererApi,
  event: LongContinuityFinalizationEvent
): Promise<void> {
  const parsedInput = LongCommitChapterInputSchema.parse(event.payload.input);
  if (parsedInput.mode !== "text_files") {
    await api.commitChapter(ipcSafeJson(parsedInput));
    return;
  }
  const latest = await api.getWorkspaceIndex({
    bookId: event.payload.bookId
  });
  const chapter = latest.workspaceIndex.chapters.find(
    ({ chapterCardId }) => chapterCardId === parsedInput.chapterCardId
  );
  if (!chapter || chapter.commitId !== null) {
    throw new Error("待归档章节已不存在或已经完成连续性归档。");
  }
  if (chapter.body.revision !== parsedInput.chapterFileRevisions.body) {
    throw new Error("章节正文已更新，请重新执行连续性核对。");
  }
  const currentContinuityFiles = [
    chapter.characterState,
    chapter.handoff,
    ...(Object.keys(parsedInput.foreshadowingBeatDecisions).length > 0
      ? [chapter.foreshadowingChanges]
      : []),
    ...(chapter.worldReveals ? [chapter.worldReveals] : []),
    ...chapter.characterContinuity.flatMap((continuity) => [
      continuity.currentState,
      continuity.history
    ])
  ];
  const proposedRevisions = new Map(
    parsedInput.continuityFileRevisions.map(
      ({ fileId, revision }) => [fileId, revision] as const
    )
  );
  if (
    proposedRevisions.size !== currentContinuityFiles.length ||
    currentContinuityFiles.some(
      ({ id, revision }) => proposedRevisions.get(id) !== revision
    )
  ) {
    throw new Error("本章连续性文件尚未全部保存，或已在核对后更新。");
  }
  await api.commitChapter(
    ipcSafeJson(
      LongCommitChapterInputSchema.parse({
        ...parsedInput,
        baseWorkspaceRevision: latest.workspaceIndex.revision,
        baseProjectRevision: latest.projectRevision
      })
    )
  );
}
