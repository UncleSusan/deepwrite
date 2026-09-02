import {
  LONG_BOOK_ANALYSIS_DEFAULT_CONTEXT_WINDOW,
  LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS,
  type LongBookAnalysisChapter,
  type LongBookAnalysisNote,
  type LongBookAnalysisSegment,
  type ModelConfig
} from "@deepwrite/contracts/renderer";

const OUTPUT_RESERVE_TOKENS = 16_000;
const TOOL_CONTEXT_RESERVE_TOKENS = 4_000;
const MIN_INPUT_BUDGET_TOKENS = 4_000;

export function estimateAnalysisTokens(text: string): number {
  let tokens = 0;
  for (const character of text) {
    tokens += character.codePointAt(0)! > 0x7f ? 1.5 : 0.25;
  }
  return Math.ceil(tokens);
}

export function resolveAnalysisInputBudget(
  model: ModelConfig | undefined,
  systemPrompt: string
): number {
  const contextWindow =
    model?.contextWindow ?? LONG_BOOK_ANALYSIS_DEFAULT_CONTEXT_WINDOW;
  const outputReserve = Math.min(
    OUTPUT_RESERVE_TOKENS,
    model?.maxTokens ?? OUTPUT_RESERVE_TOKENS
  );
  const remaining =
    contextWindow -
    outputReserve -
    TOOL_CONTEXT_RESERVE_TOKENS -
    estimateAnalysisTokens(systemPrompt);
  const budget = Math.floor(remaining * 0.6);
  if (budget < MIN_INPUT_BUDGET_TOKENS) {
    throw new Error(
      "当前模型上下文不足以运行长篇拆书，请选择更大上下文的模型。"
    );
  }
  return budget;
}

function splitTextByBudget(text: string, budget: number): string[] {
  if (estimateAnalysisTokens(text) <= budget) return [text];
  const output: string[] = [];
  let start = 0;
  while (start < text.length) {
    let low = start + 1;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (estimateAnalysisTokens(text.slice(start, middle)) <= budget) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    let end = Math.max(start + 1, low);
    const paragraphBreak = text.lastIndexOf("\n", end);
    if (paragraphBreak > start + Math.floor((end - start) * 0.6)) {
      end = paragraphBreak;
    }
    output.push(text.slice(start, end).trim());
    start = end;
    while (text[start] === "\n" || text[start] === "\r") start += 1;
  }
  return output.filter(Boolean);
}

export function buildAnalysisSegments(
  chapters: readonly LongBookAnalysisChapter[],
  inputBudget: number
): LongBookAnalysisSegment[] {
  return chapters.flatMap((chapter) => {
    const parts = splitTextByBudget(
      chapter.text,
      Math.floor(inputBudget * 0.9)
    );
    return parts.map((text, index) => ({
      id: `${chapter.id}_segment_${index + 1}`,
      chapterId: chapter.id,
      chapterOrder: chapter.order,
      chapterTitle: chapter.title,
      ...(chapter.volume ? { volume: chapter.volume } : {}),
      segmentIndex: index + 1,
      segmentCount: parts.length,
      text
    }));
  });
}

export function groupAnalysisSegments(
  segments: readonly LongBookAnalysisSegment[],
  inputBudget: number
): LongBookAnalysisSegment[][] {
  const groups: LongBookAnalysisSegment[][] = [];
  let current: LongBookAnalysisSegment[] = [];
  let chapterIds = new Set<string>();
  let tokens = 0;
  for (const segment of segments) {
    const nextTokens = estimateAnalysisTokens(segment.text);
    const addsChapter = !chapterIds.has(segment.chapterId);
    if (
      current.length &&
      (tokens + nextTokens > inputBudget ||
        current.length >= 100 ||
        (addsChapter &&
          chapterIds.size >= LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS))
    ) {
      groups.push(current);
      current = [];
      chapterIds = new Set<string>();
      tokens = 0;
    }
    current.push(segment);
    chapterIds.add(segment.chapterId);
    tokens += nextTokens;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function groupAnalysisNotes(
  notes: readonly LongBookAnalysisNote[],
  inputBudget: number
): LongBookAnalysisNote[][] {
  const groups: LongBookAnalysisNote[][] = [];
  let current: LongBookAnalysisNote[] = [];
  let tokens = 0;
  for (const note of notes) {
    const nextTokens = estimateAnalysisTokens(note.text);
    if (
      current.length &&
      (tokens + nextTokens > inputBudget || current.length >= 100)
    ) {
      groups.push(current);
      current = [];
      tokens = 0;
    }
    current.push(note);
    tokens += nextTokens;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function splitAnalysisNotesForBudget(
  notes: readonly LongBookAnalysisNote[],
  inputBudget: number
): LongBookAnalysisNote[] {
  const chunkBudget = Math.max(1, Math.floor(inputBudget * 0.45));
  return notes.flatMap((note) => {
    const parts = splitTextByBudget(note.text, chunkBudget);
    if (parts.length === 1) return [note];
    return parts.map((text, index) => ({
      ...note,
      id: `${note.id}_chunk_${index + 1}`,
      label: `${note.label}（片段 ${index + 1}/${parts.length}）`,
      text
    }));
  });
}
