import type {
  LongBookAnalysisChapter,
  LongBookAnalysisScopeMode
} from "@deepwrite/contracts/renderer";

export const LONG_BOOK_ANALYSIS_SCOPE_LABELS: Record<
  LongBookAnalysisScopeMode,
  string
> = {
  opening: "开篇精拆",
  sampled: "前中后抽样",
  full: "全文深度拆解"
};

function addWindow(
  selected: Set<number>,
  chapters: readonly LongBookAnalysisChapter[],
  centerIndex: number,
  radius: number
): void {
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(chapters.length, centerIndex + radius + 1);
  for (let index = start; index < end; index += 1) {
    selected.add(chapters[index]!.order);
  }
}

export function sampledChapterOrders(
  chapters: readonly LongBookAnalysisChapter[]
): number[] {
  if (chapters.length <= 50) return chapters.map(({ order }) => order);
  const selected = new Set<number>();
  addWindow(selected, chapters, 4, 5);
  addWindow(selected, chapters, Math.floor(chapters.length / 2), 5);
  addWindow(selected, chapters, chapters.length - 5, 5);

  const volumes = new Map<string, LongBookAnalysisChapter[]>();
  for (const chapter of chapters) {
    if (!chapter.volume) continue;
    const volume = volumes.get(chapter.volume) ?? [];
    volume.push(chapter);
    volumes.set(chapter.volume, volume);
  }
  for (const volume of volumes.values()) {
    if (volume.length < 2) continue;
    addWindow(selected, volume, 0, 1);
    addWindow(selected, volume, Math.floor(volume.length / 2), 1);
    addWindow(selected, volume, volume.length - 1, 1);
  }
  return [...selected].sort((left, right) => left - right);
}

export function completeAnalysisChapterOrders(input: {
  chapters: readonly LongBookAnalysisChapter[];
  scopeMode: LongBookAnalysisScopeMode;
  presetId: string;
  styleFullText: boolean;
}): number[] {
  const { chapters, scopeMode, presetId, styleFullText } = input;
  if (scopeMode === "opening") {
    return chapters.slice(0, 50).map(({ order }) => order);
  }
  if (
    scopeMode === "sampled" ||
    (scopeMode === "full" && presetId === "style" && !styleFullText)
  ) {
    return sampledChapterOrders(chapters);
  }
  return chapters.map(({ order }) => order);
}
