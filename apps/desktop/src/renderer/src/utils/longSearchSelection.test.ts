import type {
  LongBookSummary,
  LongSearchHit,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { resolveLongSearchHitSelection } from "./longSearchSelection";

function hit(fileId: string): LongSearchHit {
  return {
    fileId,
    path: `draft/${fileId}.md`,
    root: "draft",
    title: fileId,
    snippet: "命中内容",
    start: 0,
    end: 4
  } as LongSearchHit;
}

function fixture() {
  const summary = {
    id: "book-1",
    title: "潮汐之城",
    navigation: {
      characters: [{ id: "character-1", name: "林岚" }],
      chapterCards: []
    }
  } as unknown as LongBookSummary;
  const index = {
    bookLine: { id: "book-line" },
    worldbuilding: [],
    characterFiles: [
      {
        characterId: "character-1",
        coreProfile: { id: "character-core" },
        relationships: { id: "character-relationships" },
        currentState: { id: "character-state" },
        history: { id: "character-history" }
      }
    ],
    chapters: [],
    ledger: {
      commits: [
        {
          id: "commit-1",
          recordFile: { id: "commit-record" }
        }
      ]
    }
  } as unknown as LongWorkspaceIndexSnapshot;
  return { summary, index };
}

describe("long search hit selection", () => {
  it("opens the exact character file tab and preserves continuity locks", () => {
    const { summary, index } = fixture();
    const selection = resolveLongSearchHitSelection(
      summary,
      index,
      hit("character-state")
    );

    expect(selection).toMatchObject({
      key: "character:character-1",
      preferredRole: "current-state"
    });
    expect(
      selection?.files.find(({ role }) => role === "current-state")?.readOnly
    ).toBe(true);
    expect(
      selection?.files.find(({ role }) => role === "core-profile")?.readOnly
    ).toBeUndefined();
  });

  it("does not route an unknown or stale file to another document", () => {
    const { summary, index } = fixture();
    expect(
      resolveLongSearchHitSelection(summary, index, hit("missing-file"))
    ).toBeUndefined();
  });
});
