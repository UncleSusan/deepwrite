import { describe, expect, it, vi } from "vitest";
import type {
  LongReadDocumentInput,
  LongReadDocumentResult
} from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { buildLongCharacterFocusSnapshot } from "./longCharacterAgentContext";

const UPDATED_AT = "2026-07-30T10:00:00.000Z";

function file(id: string, path: string) {
  return {
    id,
    path,
    revision: "v1:3:1234abcd",
    updatedAt: UPDATED_AT
  };
}

function page(
  input: LongReadDocumentInput,
  content: string
): LongReadDocumentResult {
  const visible = Array.from(content)
    .slice(0, input.maxCharacters)
    .join("");
  return {
    bookId: input.bookId,
    file: file(input.fileId, `long/test/${input.fileId}.md`),
    content: visible,
    offset: input.offset,
    totalCharacters: Array.from(content).length,
    nextOffset: null,
    workspaceRevision: 3,
    projectRevision: 5
  };
}

function selection(): LongWorkspaceSelection {
  const core = file(
    "file_character_lan:core-profile",
    "long/characters/character_lan/core-profile.md"
  );
  const relationships = file(
    "file_character_lan:relationships",
    "long/characters/character_lan/relationships.md"
  );
  return {
    key: "character-group:protagonist",
    root: "character_design",
    characterGroup: "protagonist",
    characterId: "character_lan",
    title: "林岚",
    breadcrumbs: ["雾港", "人物设计", "主角", "林岚"],
    files: [
      { role: "core-profile", label: "核心档案", file: core },
      { role: "relationships", label: "人物关系", file: relationships }
    ],
    preferredRole: "core-profile"
  };
}

describe("long character agent context", () => {
  it("captures a secondary document together with the core profile", async () => {
    const current = selection();
    const relationshipFile = current.files[1]!.file;
    const readDocument = vi.fn(
      async (input: LongReadDocumentInput): Promise<LongReadDocumentResult> =>
        page(
          input,
          input.fileId === relationshipFile.id
            ? "与沈砚暂时合作。"
            : "雾港巡夜人，害怕深水。"
        )
    );

    const result = await buildLongCharacterFocusSnapshot({
      bookId: "longbook_focus",
      selection: current,
      activeFileId: relationshipFile.id,
      readDocument
    });

    expect(result).toEqual({
      characterName: "林岚",
      group: "protagonist",
      currentDocument: {
        kind: "relationships",
        title: "人物关系",
        text: { content: "与沈砚暂时合作。" }
      },
      coreProfile: { content: "雾港巡夜人，害怕深水。" }
    });
    expect(readDocument.mock.calls.map(([input]) => input.maxCharacters)).toEqual(
      expect.arrayContaining([12_000, 8_000])
    );
  });

  it("does not duplicate the core profile when it is active", async () => {
    const current = selection();
    const coreFile = current.files[0]!.file;
    const readDocument = vi.fn(
      async (input: LongReadDocumentInput): Promise<LongReadDocumentResult> =>
        page(input, "雾港巡夜人。")
    );

    const result = await buildLongCharacterFocusSnapshot({
      bookId: "longbook_focus",
      selection: current,
      activeFileId: coreFile.id,
      readDocument
    });

    expect(result).toMatchObject({
      currentDocument: {
        kind: "core_profile",
        text: { content: "雾港巡夜人。" }
      }
    });
    expect(result).not.toHaveProperty("coreProfile");
    expect(readDocument).toHaveBeenCalledTimes(1);
  });
});
