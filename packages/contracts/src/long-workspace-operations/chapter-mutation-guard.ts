import type { LongWorkspaceIndexSnapshot } from "../long-workspace";

export interface LongChapterMutationViolation {
  code: "not_found" | "committed_prefix_protected";
  message: string;
}

export function chapterMutationViolation(
  workspace: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  action: string
): LongChapterMutationViolation | null {
  const chapter = workspace.chapters.find(
    (entry) => entry.chapterCardId === chapterCardId
  );
  if (!chapter) {
    return {
      code: "not_found",
      message: `Chapter ${chapterCardId} does not exist.`
    };
  }
  if (chapter.commitId !== null) {
    return {
      code: "committed_prefix_protected",
      message: `Chapter ${chapterCardId} has already been committed and cannot ${action}.`
    };
  }
  return null;
}
