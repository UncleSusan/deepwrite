import { describe, expect, it } from "vitest";
import type {
  LongBookSummary,
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  createLongChapterSelection,
  createLongContinuitySelection,
  reconcileLongWorkspaceSelection
} from "./longWorkspace";

function file(
  id: string,
  path: string
): LongWorkspaceFileReference {
  return {
    id,
    path,
    revision: "v1:0:00000000",
    updatedAt: "2026-07-26T12:00:00.000Z"
  } as unknown as LongWorkspaceFileReference;
}

function fixture(commitId: string | null): {
  summary: LongBookSummary;
  workspaceIndex: LongWorkspaceIndexSnapshot;
} {
  const summary = {
    id: "longbook_lifecycle",
    title: "长篇生命周期",
    navigation: {
      volumes: [{ id: "volume_one", title: "第一卷", order: 1 }],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          title: "第一章",
          narrativeOrder: 1
        }
      ],
      characters: [],
      arcs: []
    }
  } as unknown as LongBookSummary;
  const workspaceIndex = {
    plot: {
      volumes: [{ id: "volume_one", order: 1 }],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          narrativeOrder: 1
        }
      ]
    },
    ledger: {
      commits: commitId ? [{ id: commitId }] : []
    },
    chapters: [
      {
        chapterCardId: "chapter_one",
        body: file("file_chapter_body", "long/chapters/chapter_one/body.md"),
        characterState: file(
          "file_chapter_state",
          "long/chapters/chapter_one/character-state.md"
        ),
        handoff: file(
          "file_chapter_handoff",
          "long/chapters/chapter_one/handoff.md"
        ),
        commitId
      }
    ]
  } as unknown as LongWorkspaceIndexSnapshot;
  return { summary, workspaceIndex };
}

describe("long workspace chapter navigation", () => {
  it("keeps the authoring entry editable before a continuity commit", () => {
    const { summary, workspaceIndex } = fixture(null);
    const selection = createLongChapterSelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );

    expect(selection).toMatchObject({
      key: "chapter:chapter_one",
      root: "draft",
      chapterCardId: "chapter_one"
    });
    expect(selection?.files.every((entry) => !entry.readOnly)).toBe(true);
  });

  it("gives the continuity agent the chapter id with a read-only triplet", () => {
    const { summary, workspaceIndex } = fixture(null);
    const selection = createLongContinuitySelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );

    expect(selection).toMatchObject({
      key: "continuity:chapter_one",
      root: "continuity_ledger",
      chapterCardId: "chapter_one"
    });
    expect(selection?.files.map(({ role }) => role)).toEqual([
      "body",
      "character-state",
      "handoff"
    ]);
    expect(selection?.files.every((entry) => entry.readOnly)).toBe(true);
    expect(
      reconcileLongWorkspaceSelection(
        summary,
        workspaceIndex,
        selection!
      )
    ).toMatchObject({
      root: "continuity_ledger",
      chapterCardId: "chapter_one"
    });
  });

  it("locks all committed chapter files and no longer offers re-commit", () => {
    const { summary, workspaceIndex } = fixture("commit_one");
    const chapter = createLongChapterSelection(
      summary,
      workspaceIndex,
      "chapter_one"
    );

    expect(chapter?.files.every((entry) => entry.readOnly)).toBe(true);
    expect(chapter?.description).toContain("先回滚最后一次连续性提交");
    expect(
      createLongContinuitySelection(
        summary,
        workspaceIndex,
        "chapter_one"
      )
    ).toBeUndefined();
  });
});
