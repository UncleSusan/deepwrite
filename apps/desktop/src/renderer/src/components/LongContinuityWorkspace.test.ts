import { describe, expect, it } from "vitest";
import source from "./LongContinuityWorkspace.vue?raw";

describe("LongContinuityWorkspace", () => {
  it("provides the five continuity-ledger views from one projection", () => {
    for (const view of [
      '"inbox"',
      '"snapshot"',
      '"execution"',
      '"knowledge"',
      '"history"'
    ]) {
      expect(source).toContain(view);
    }
    for (const label of [
      "待核验入账",
      "当前事实快照",
      "剧情与伏笔",
      "信息揭露与知识",
      "章节流水与接续"
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("projection.value.facts");
    expect(source).toContain("projection.value.knowledge");
    expect(source).toContain("projection.value.openLoops");
    expect(source).toContain("projection.value.latestHandoff");
    expect(source).toContain("projection.value.throughCommitId");
    expect(source).toContain("factById");
    expect(source).toContain("audienceType");
    expect(source).toContain("knowledgeLevelLabel");
  });

  it("accepts chapter evidence and a full record without becoming an editor", () => {
    for (const prop of [
      "bookId: string",
      "snapshot: LongWorkspaceIndexSnapshot",
      "view?: LongContinuityWorkspaceView",
      "activeChapterId?: string",
      "evidenceContent?: string | null",
      "currentRecord?: LongLedgerCommitRecord | null"
    ]) {
      expect(source).toContain(prop);
    }
    expect(source).toContain("正文是唯一事实证据");
    expect(source).toContain("人物当前状态与历史");
    expect(source).toContain("知识揭露与下一章接续");
    const evidenceStart = source.indexOf("const evidenceRows = computed");
    const evidenceEnd = source.indexOf("const evidenceReady", evidenceStart);
    const evidenceProjection = source.slice(evidenceStart, evidenceEnd);
    expect(evidenceProjection).toContain('id: "body"');
    expect(evidenceProjection).not.toContain('id: "characterState"');
    expect(evidenceProjection).not.toContain('id: "handoff"');
    expect(source).toContain("currentRecord.fileChanges");
    expect(source).not.toContain("<textarea");
    expect(source).not.toContain('contenteditable="true"');
  });

  it("keeps current state traceable to chapter commits and forwards navigation", () => {
    expect(source).toContain("selectCommit: [commitId: string]");
    expect(source).toContain('emit("selectCommit", commitId)');
    expect(source).toContain("chapterLabel(commit.chapterCardId)");
    expect(source).toContain("commit.placementIds.length");
    expect(source).toContain("commit.foreshadowingBeatIds.length");
    expect(source).toContain("<LongContinuityProjectionPanel");
  });

  it("uses themed button tabs instead of native selects or layout-shifting feedback", () => {
    expect(source).not.toContain("<select");
    expect(source).not.toContain('class="error');
    expect(source).not.toContain('class="warning');
    expect(source).toContain('class="continuity-view-tabs"');
    expect(source).toContain("var(--surface-hover)");
    expect(source).toContain("var(--surface-selected)");
  });

  it("uses the shared visual tokens and container-based compact layouts", () => {
    for (const token of [
      "--surface-main",
      "--surface-raised",
      "--surface-muted",
      "--surface-hover",
      "--surface-selected",
      "--theme-line",
      "--theme-line-soft",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--accent",
      "--accent-soft"
    ]) {
      expect(source).toContain(`var(${token})`);
    }
    expect(source).toContain("container: continuity-workspace / inline-size");
    expect(source).toContain(
      "@container continuity-workspace (max-width: 52rem)"
    );
    expect(source).toContain(
      "@container continuity-workspace (max-width: 34rem)"
    );
  });
});
