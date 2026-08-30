import {
  LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS,
  LongBookAnalysisChapterSchema,
  type LongBookAnalysisChapter
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";

function normalize(
  chapters: readonly LongBookAnalysisChapter[]
): LongBookAnalysisChapter[] {
  return chapters.map((chapter, index) =>
    LongBookAnalysisChapterSchema.parse({
      ...chapter,
      order: index + 1,
      charCount: chapter.text.replace(/\s/gu, "").length || chapter.text.length
    })
  );
}

export function renameAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  title: string
): LongBookAnalysisChapter[] {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error("章节标题不能为空。");
  return normalize(
    chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, title: nextTitle } : chapter
    )
  );
}

export function moveAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  targetIndex: number
): LongBookAnalysisChapter[] {
  const fromIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (fromIndex < 0) throw new Error("未找到要移动的章节。");
  const boundedTarget = Math.max(0, Math.min(chapters.length - 1, targetIndex));
  const next = chapters.slice();
  const [chapter] = next.splice(fromIndex, 1);
  if (!chapter) throw new Error("未找到要移动的章节。");
  next.splice(boundedTarget, 0, chapter);
  return normalize(next);
}

export function splitAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  cursor: number,
  secondTitle?: string
): LongBookAnalysisChapter[] {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  const chapter = chapters[index];
  if (!chapter) throw new Error("未找到要拆分的章节。");
  const left = chapter.text.slice(0, cursor).trim();
  const right = chapter.text.slice(cursor).trim();
  if (!left || !right) throw new Error("请把光标放在章节正文中间再拆分。");
  const next = chapters.slice();
  next.splice(
    index,
    1,
    { ...chapter, text: left, charCount: left.replace(/\s/gu, "").length },
    {
      ...chapter,
      id: createId("analysis_chapter"),
      title: secondTitle?.trim() || `${chapter.title}（续）`,
      text: right,
      charCount: right.replace(/\s/gu, "").length
    }
  );
  return normalize(next);
}

export function mergeAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  direction: "previous" | "next"
): LongBookAnalysisChapter[] {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  const adjacentIndex = direction === "previous" ? index - 1 : index + 1;
  const chapter = chapters[index];
  const adjacent = chapters[adjacentIndex];
  if (!chapter || !adjacent) throw new Error("当前章节没有可合并的相邻章节。");
  const first = direction === "previous" ? adjacent : chapter;
  const second = direction === "previous" ? chapter : adjacent;
  const text = `${first.text.trim()}\n\n${second.text.trim()}`;
  if (text.length > LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS) {
    throw new Error("合并后的章节超过 10,000,000 字符限制。");
  }
  const next = chapters.slice();
  next.splice(Math.min(index, adjacentIndex), 2, {
    ...first,
    text,
    charCount: text.replace(/\s/gu, "").length
  });
  return normalize(next);
}
