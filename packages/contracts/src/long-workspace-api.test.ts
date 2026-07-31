import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  CreateLongBookInputSchema,
  LongReadDocumentInputSchema,
  LongReadDocumentResultSchema,
  LongSearchInputSchema,
  LongUpdateBindingsInputSchema,
  LongWorkspaceRuntimeContextSchema,
  LongWorkspaceCommandEnvelopeSchema,
  createEnvelope
} from "./index";

const runtimeNavigation = {
  schemaVersion: 1 as const,
  revision: 3,
  bookId: "longbook_api",
  updatedAt: "2026-07-26T10:00:00.000Z",
  counts: {
    worldbuildingCategories: 0,
    characters: 0,
    volumes: 1,
    arcs: 1,
    chapterCards: 1,
    storyEvents: 0,
    storyPlots: 0,
    foreshadowingThreads: 0,
    committedChapters: 0
  },
  worldbuilding: [],
  characters: [],
  volumes: [{ id: "volume_api", title: "第一卷", order: 1 }],
  arcs: [
    {
      id: "arc_api",
      volumeId: "volume_api",
      title: "主线",
      order: 1
    }
  ],
  chapterCards: [
    {
      id: "chapter_api",
      volumeId: "volume_api",
      primaryArcId: "arc_api",
      title: "第一章",
      narrativeOrder: 1
    }
  ],
  committedThroughChapterId: null
};

function runtimeContext(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    bookId: "longbook_api",
    title: "时间尽头",
    activeRoot: "draft",
    activeAgentId: "draft",
    workspaceRevision: 3,
    projectRevision: 3,
    navigation: runtimeNavigation,
    ...overrides
  };
}

describe("long workspace API contracts", () => {
  it("binds privileged long agents to their root and an existing chapter", () => {
    expect(
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeAgentId: "expert_section_writer",
          activeChapterCardId: "chapter_api"
        })
      )
    ).toMatchObject({
      activeRoot: "draft",
      activeAgentId: "expert_section_writer",
      activeChapterCardId: "chapter_api"
    });
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeRoot: "worldbuilding",
          activeAgentId: "continuity_ledger",
          activeChapterCardId: "chapter_api"
        })
      )
    ).toThrow(/agent.*root/iu);
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeAgentId: "expert_section_writer"
        })
      )
    ).toThrow(/active chapter/iu);
    const ledgerRootContext = LongWorkspaceRuntimeContextSchema.parse(
      runtimeContext({
        activeRoot: "continuity_ledger",
        activeAgentId: "continuity_ledger"
      })
    );
    expect(ledgerRootContext).toMatchObject({
      activeRoot: "continuity_ledger",
      activeAgentId: "continuity_ledger"
    });
    expect(ledgerRootContext).not.toHaveProperty("activeChapterCardId");
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeRoot: "continuity_ledger",
          activeAgentId: "continuity_ledger",
          activeChapterCardId: "chapter_missing"
        })
      )
    ).toThrow(/exist.*navigation/iu);
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          workspaceRevision: 4
        })
      )
    ).toThrow(/navigation revision/iu);
  });

  it("bounds worldbuilding focus and keeps it exclusive to the worldbuilding agent", () => {
    const focus = {
      categoryTitle: "势力",
      format: "list",
      currentStage: {
        kind: "item",
        title: "守夜人",
        text: { content: "负责维持雾港宵禁。" }
      },
      overview: { content: "各势力争夺港务权。" }
    };
    expect(
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeRoot: "worldbuilding",
          activeAgentId: "worldbuilding",
          activeFileId: "file_faction_watch:content",
          activeFileRevision: "v1:3:1234abcd",
          worldbuildingFocus: focus
        })
      )
    ).toMatchObject({ worldbuildingFocus: focus });
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({ worldbuildingFocus: focus })
      )
    ).toThrow(/worldbuilding agent/iu);
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeRoot: "worldbuilding",
          activeAgentId: "worldbuilding",
          activeFileId: "file_faction_watch:content",
          activeFileRevision: "v1:3:1234abcd",
          worldbuildingFocus: {
            ...focus,
            overview: undefined
          }
        })
      )
    ).toThrow(/overview/iu);
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeRoot: "worldbuilding",
          activeAgentId: "worldbuilding",
          activeFileId: "file_world_rules:content",
          activeFileRevision: "v1:3:1234abcd",
          worldbuildingFocus: {
            categoryTitle: "世界规则",
            format: "text",
            currentStage: {
              kind: "text",
              title: "世界规则",
              text: { content: "界".repeat(20_001) }
            }
          }
        })
      )
    ).toThrow(/maximum character count/iu);
  });

  it("bounds character focus and keeps it exclusive to the character-design agent", () => {
    const focus = {
      characterName: "林岚",
      group: "protagonist",
      currentDocument: {
        kind: "relationships",
        title: "人物关系",
        text: { content: "与沈砚暂时合作。" }
      },
      overview: { content: "- character_id=`character_lan` 林岚" },
      coreProfile: { content: "雾港巡夜人。" }
    };
    expect(
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeRoot: "character_design",
          activeAgentId: "character_design",
          activeFileId: "file_character_lan:relationships",
          activeFileRevision: "v1:3:1234abcd",
          characterFocus: focus
        })
      )
    ).toMatchObject({ characterFocus: focus });
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({ characterFocus: focus })
      )
    ).toThrow(/character-design agent/iu);
    expect(() =>
      LongWorkspaceRuntimeContextSchema.parse(
        runtimeContext({
          activeRoot: "character_design",
          activeAgentId: "character_design",
          activeFileId: "file_character_lan:relationships",
          activeFileRevision: "v1:3:1234abcd",
          characterFocus: { ...focus, coreProfile: undefined }
        })
      )
    ).toThrow(/core profile/iu);
  });

  it("applies bounded defaults to paged reads and searches", () => {
    expect(
      LongReadDocumentInputSchema.parse({
        bookId: "longbook_api",
        fileId: "file_chapter_api:body"
      })
    ).toMatchObject({ offset: 0, maxCharacters: 32_768 });

    expect(
      LongSearchInputSchema.parse({
        bookId: "longbook_api",
        query: "失踪的来信"
      })
    ).toMatchObject({
      scope: "all",
      limit: 20,
      maxSnippetCharacters: 320
    });
  });

  it("bounds long-form binding arrays without changing shared catalog schemas", () => {
    const oversized = Array.from(
      { length: 1_001 },
      (_, index) => `material-${index}`
    );
    expect(() =>
      CreateLongBookInputSchema.parse({
        title: "时间尽头",
        genre: "科幻",
        linkedMaterialIdsByKind: { plot: oversized }
      })
    ).toThrow(/1,?000 ids per kind/iu);
    expect(() =>
      LongUpdateBindingsInputSchema.parse({
        bookId: "longbook_api",
        expectedProjectRevision: 3,
        linkedMaterialIdsByKind: { plot: oversized },
        linkedSkillIdsByKind: {}
      })
    ).toThrow(/1,?000 ids per kind/iu);
  });

  it("rejects an inconsistent document page cursor", () => {
    expect(() =>
      LongReadDocumentResultSchema.parse({
        bookId: "longbook_api",
        file: {
          id: "file_chapter_api:body",
          path: "long/chapters/api/body.md",
          revision: "v1:3:1234abcd",
          updatedAt: "2026-07-26T10:00:00.000Z"
        },
        content: "abcd",
        offset: 10,
        totalCharacters: 20,
        nextOffset: 15,
        workspaceRevision: 2,
        projectRevision: 2
      })
    ).toThrow();
  });

  it("counts paged document cursors by Unicode code point", () => {
    expect(
      LongReadDocumentResultSchema.parse({
        bookId: "longbook_api",
        file: {
          id: "file_chapter_api:body",
          path: "long/chapters/api/body.md",
          revision: "v1:5:1234abcd",
          updatedAt: "2026-07-26T10:00:00.000Z"
        },
        content: "甲😀",
        offset: 0,
        totalCharacters: 3,
        nextOffset: 2,
        workspaceRevision: 2,
        projectRevision: 2
      })
    ).toMatchObject({ nextOffset: 2 });
  });

  it("registers public and internal long commands in the system protocol", () => {
    const create = createEnvelope(
      "long.createBook",
      { title: "时间尽头", genre: "科幻" },
      { id: "cmd_long_create" }
    );
    const read = createEnvelope(
      "long.readDocument",
      {
        bookId: "longbook_api",
        fileId: "file_chapter_api:body",
        offset: 0,
        maxCharacters: 1_024
      },
      { id: "cmd_long_read", context: { runId: "run_api" } }
    );
    const migrate = createEnvelope(
      "long.importWriteClawAtPath",
      {
        parentDirectory: "/projects",
        sourcePath: "/imports/legacy.zip"
      },
      { id: "cmd_long_import" }
    );
    const importPortable = createEnvelope(
      "long.importPortableAtPath",
      {
        parentDirectory: "/projects",
        sourcePath: "/imports/time.deepwrite-long.json"
      },
      { id: "cmd_long_import_portable" }
    );
    const updateBindings = createEnvelope(
      "long.updateBindings",
      {
        bookId: "longbook_api",
        expectedProjectRevision: 3,
        linkedMaterialIdsByKind: { plot: ["material-long"] },
        linkedSkillIdsByKind: { style: ["skill-long"] }
      },
      { id: "cmd_long_update_bindings" }
    );

    expect(LongWorkspaceCommandEnvelopeSchema.parse(create).type).toBe(
      "long.createBook"
    );
    expect(CommandEnvelopeSchema.parse(create).type).toBe("long.createBook");
    expect(CommandEnvelopeSchema.parse(read).context.runId).toBe("run_api");
    expect(CommandEnvelopeSchema.parse(migrate).type).toBe(
      "long.importWriteClawAtPath"
    );
    expect(CommandEnvelopeSchema.parse(importPortable).type).toBe(
      "long.importPortableAtPath"
    );
    expect(CommandEnvelopeSchema.parse(updateBindings).type).toBe(
      "long.updateBindings"
    );
  });
});
