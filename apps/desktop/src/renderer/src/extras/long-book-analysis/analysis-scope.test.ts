import { describe, expect, it } from "vitest";
import type { LongBookAnalysisChapter } from "@deepwrite/contracts/renderer";
import {
  completeAnalysisChapterOrders,
  sampledChapterOrders
} from "./analysis-scope";

const chapters: LongBookAnalysisChapter[] = Array.from(
  { length: 120 },
  (_, index) => ({
    id: `chapter-${index + 1}`,
    order: index + 1,
    title: `第 ${index + 1} 章`,
    volume: `第 ${Math.floor(index / 40) + 1} 卷`,
    sourceName: `${index + 1}.txt`,
    text: `正文 ${index + 1}`,
    charCount: 5
  })
);

describe("complete long-book analysis scope", () => {
  it("supports opening, sampled, and full scopes", () => {
    expect(
      completeAnalysisChapterOrders({
        chapters,
        scopeMode: "opening",
        presetId: "plot-structure",
        styleFullText: false
      })
    ).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    const sampled = sampledChapterOrders(chapters);
    expect(sampled).toContain(1);
    expect(sampled).toContain(60);
    expect(sampled).toContain(120);
    expect(sampled.length).toBeLessThan(chapters.length);
  });

  it("uses sampled style and full text for the other default pipelines", () => {
    const input = { chapters, scopeMode: "full" as const };
    expect(
      completeAnalysisChapterOrders({
        ...input,
        presetId: "plot-structure",
        styleFullText: false
      })
    ).toHaveLength(120);
    expect(
      completeAnalysisChapterOrders({
        ...input,
        presetId: "style",
        styleFullText: false
      }).length
    ).toBeLessThan(120);
    expect(
      completeAnalysisChapterOrders({
        ...input,
        presetId: "style",
        styleFullText: true
      })
    ).toHaveLength(120);
  });
});
