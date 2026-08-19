import { describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LongWorkspaceIndexSnapshotSchema,
  createLongWorkspaceNavigationSnapshot,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  type LongAgentId,
  type LongAgentProfile,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceRoot,
  type LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  buildLongWorkspaceTools,
  selectLongChaptersForWritingScope,
  selectNextLongChapterForDispatch,
  type LongAgentToolDetails,
  type LongCommandExecutor
} from "./long-agent-tools";
import { toRuntimeEvents } from "./index";

const NOW = "2026-07-26T12:00:00.000Z";
const REVISION = "v1:0:00000000";
function file(id: string, path: string) {
  return { id, path, revision: REVISION, updatedAt: NOW };
}

function fixtureIndex(): LongWorkspaceIndexSnapshot {
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 7,
    bookId: "longbook_tools",
    updatedAt: NOW,
    bookLine: file(LONG_BOOK_LINE_FILE_ID, "long/plot/book-line.md"),
    worldbuilding: [
      {
        id: "world_rules",
        title: "世界规则",
        order: 1,
        format: "text",
        contentAuthority: "markdown",
        file: file(
          longWorldbuildingFileId("world_rules"),
          "long/worldbuilding/rules.md"
        )
      }
    ],
    characterOverview: file(
      LONG_CHARACTER_OVERVIEW_FILE_ID,
      LONG_CHARACTER_OVERVIEW_PATH
    ),
    characters: [
      {
        id: "character_alice",
        name: "林岚",
        group: "protagonist",
        order: 1,
        aliases: []
      }
    ],
    characterFiles: [
      {
        characterId: "character_alice",
        coreProfile: file(
          longCharacterCoreProfileFileId("character_alice"),
          "long/characters/alice/core-profile.md"
        ),
        relationships: file(
          longCharacterRelationshipsFileId("character_alice"),
          "long/characters/alice/relationships.md"
        ),
        currentState: file(
          longCharacterCurrentStateFileId("character_alice"),
          "long/characters/alice/current-state.md"
        ),
        history: file(
          longCharacterHistoryFileId("character_alice"),
          "long/characters/alice/history.md"
        )
      }
    ],
    plot: {
      volumes: [
        {
          id: "volume_one",
          title: "第一卷",
          order: 1,
          summary: ""
        }
      ],
      arcs: [
        {
          id: "arc_one",
          volumeId: "volume_one",
          title: "主线",
          order: 1,
          outline: ""
        }
      ],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          primaryArcId: "arc_one",
          title: "第一章",
          narrativeOrder: 1
        }
      ],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [
      {
        chapterCardId: "chapter_one",
        body: file(
          longChapterBodyFileId("chapter_one"),
          "long/chapters/one/body.md"
        ),
        card: file(
          longChapterCardFileId("chapter_one"),
          "long/chapters/one/card.md"
        ),
        characterState: file(
          longChapterCharacterStateFileId("chapter_one"),
          "long/chapters/one/character-state.md"
        ),
        handoff: file(
          longChapterHandoffFileId("chapter_one"),
          "long/chapters/one/handoff.md"
        ),
        commitId: null
      }
    ],
    ledger: {
      committedThroughChapterId: null,
      commits: []
    }
  });
}

function twoWrittenChaptersIndex(): LongWorkspaceIndexSnapshot {
  const index = fixtureIndex();
  index.chapters[0]!.bodyStatus = "written";
  index.plot.chapterCards.push({
    id: "chapter_two",
    volumeId: "volume_one",
    primaryArcId: "arc_one",
    title: "第二章",
    narrativeOrder: 2
  });
  index.chapters.push({
    chapterCardId: "chapter_two",
    bodyStatus: "written",
    body: file(
      longChapterBodyFileId("chapter_two"),
      "long/chapters/two/body.md"
    ),
    card: file(
      longChapterCardFileId("chapter_two"),
      "long/chapters/two/card.md"
    ),
    characterState: file(
      longChapterCharacterStateFileId("chapter_two"),
      "long/chapters/two/character-state.md"
    ),
    handoff: file(
      longChapterHandoffFileId("chapter_two"),
      "long/chapters/two/handoff.md"
    ),
    foreshadowingChanges: file(
      longChapterForeshadowingChangesFileId("chapter_two"),
      longChapterContinuityFilePath("chapter_two", "foreshadowing-changes.md")
    ),
    worldReveals: null,
    characterContinuity: [],
    commitId: null
  });
  return LongWorkspaceIndexSnapshotSchema.parse(index);
}

function fixtureWorldFile(index = fixtureIndex()) {
  const category = index.worldbuilding[0]!;
  if (category.format !== "text") {
    throw new Error("Expected the fixture worldbuilding category to be text.");
  }
  return category.file;
}

function fixtureWorldbuildingIndex(): LongWorkspaceIndexSnapshot {
  const index = fixtureIndex();
  return LongWorkspaceIndexSnapshotSchema.parse({
    ...index,
    worldbuilding: [
      ...index.worldbuilding,
      {
        id: "world_magic",
        title: "魔法体系",
        order: 2,
        format: "list",
        contentAuthority: "files",
        overview: file(
          longWorldbuildingOverviewFileId("world_magic"),
          longWorldbuildingOverviewContentPath("world_magic")
        ),
        items: [
          {
            id: "worlditem_memory",
            title: "记忆代价",
            order: 1,
            file: file(
              longWorldbuildingItemFileId("worlditem_memory"),
              longWorldbuildingItemContentPath(
                "world_magic",
                "worlditem_memory"
              )
            )
          },
          {
            id: "worlditem_blood",
            title: "血脉门槛",
            order: 2,
            file: file(
              longWorldbuildingItemFileId("worlditem_blood"),
              longWorldbuildingItemContentPath(
                "world_magic",
                "worlditem_blood"
              )
            )
          }
        ]
      }
    ]
  });
}

const STORY_PLOT_BODY = "城门外初遇追兵，埋下北上线索。";

function fixtureStoryPlotIndex(): LongWorkspaceIndexSnapshot {
  const index = fixtureIndex();
  return LongWorkspaceIndexSnapshotSchema.parse({
    ...index,
    plot: {
      ...index.plot,
      storyPlots: [
        {
          id: "storyplot_one",
          arcId: "arc_one",
          title: "城门初遇",
          order: 1,
          file: file(
            longStoryPlotBodyFileId("storyplot_one"),
            longStoryPlotFilePath("storyplot_one")
          )
        }
      ]
    }
  });
}

function storyPlotExecutor(index: LongWorkspaceIndexSnapshot) {
  return vi.fn<LongCommandExecutor>(async (command) => {
    if (command.type === "long.getWorkspaceIndex") {
      return indexResult(index);
    }
    if (command.type === "long.readDocument") {
      const storyPlot = index.plot.storyPlots[0]!;
      if (command.payload.fileId !== storyPlot.file.id) {
        throw new Error("Unexpected story plot file.");
      }
      return {
        status: "accepted" as const,
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: storyPlot.file,
          content: STORY_PLOT_BODY,
          offset: command.payload.offset,
          totalCharacters: Array.from(STORY_PLOT_BODY).length,
          nextOffset: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    }
    throw new Error(`Unexpected command: ${command.type}`);
  });
}

function resultText(result: { content: readonly unknown[] }): string {
  const block = result.content[0];
  if (
    !block ||
    typeof block !== "object" ||
    !((block as { type?: unknown }).type === "text") ||
    typeof (block as { text?: unknown }).text !== "string"
  ) {
    throw new Error("Expected a text tool result.");
  }
  return (block as { text: string }).text;
}

function expectNoPhysicalWorldbuildingMetadata(text: string) {
  expect(text).not.toContain("longbook_tools");
  expect(text).not.toContain("file_");
  expect(text).not.toContain("long/worldbuilding/");
  expect(text).not.toContain(REVISION);
  expect(text).not.toContain("workspaceRevision");
  expect(text).not.toContain("projectRevision");
  expect(text).not.toContain("updatedAt");
}

function committedFixtureIndex(): LongWorkspaceIndexSnapshot {
  const index = structuredClone(fixtureIndex());
  index.chapters[0]!.bodyStatus = "written";
  index.chapters[0]!.commitId = "commit_one";
  index.ledger.committedThroughChapterId = "chapter_one";
  index.ledger.commits = [
      {
        id: "commit_one",
        mode: "structured",
        sequence: 1,
      chapterCardId: "chapter_one",
      committedAt: NOW,
      reversible: true,
      sourceRevision: 6,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile: file(
        longLedgerCommitFileId("commit_one"),
        "long/ledger/commit-one.json"
      )
    }
  ];
  return LongWorkspaceIndexSnapshotSchema.parse(index);
}

function profile(id: LongAgentId): LongAgentProfile {
  return structuredClone(
    DEFAULT_LONG_AGENT_PROFILES.find((candidate) => candidate.id === id)!
  );
}

function workspace(
  agentId: LongAgentId,
  activeRoot: LongWorkspaceRoot,
  activeChapterCardId?: string
): LongWorkspaceRuntimeContext {
  const index = fixtureIndex();
  return {
    bookId: index.bookId,
    title: "工具测试",
    activeRoot,
    activeAgentId: agentId,
    ...(activeChapterCardId ? { activeChapterCardId } : {}),
    workspaceRevision: index.revision,
    projectRevision: 11,
    navigation: createLongWorkspaceNavigationSnapshot(index)
  };
}

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function indexResult(
  index: LongWorkspaceIndexSnapshot = fixtureIndex(),
  projectRevision = 11
) {
  return {
    status: "accepted" as const,
    requestId: "query-index",
    payload: {
      bookId: index.bookId,
      workspaceIndex: index,
      projectRevision
    }
  };
}

export {
  Check,
  DEFAULT_LONG_AGENT_PROFILES,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LongWorkspaceIndexSnapshotSchema,
  NOW,
  REVISION,
  STORY_PLOT_BODY,
  buildLongWorkspaceTools,
  committedFixtureIndex,
  createHash,
  createLongWorkspaceNavigationSnapshot,
  describe,
  expect,
  expectNoPhysicalWorldbuildingMetadata,
  file,
  fixtureIndex,
  fixtureStoryPlotIndex,
  fixtureWorldFile,
  fixtureWorldbuildingIndex,
  indexResult,
  it,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  profile,
  resultText,
  selectLongChaptersForWritingScope,
  selectNextLongChapterForDispatch,
  storyPlotExecutor,
  toRuntimeEvents,
  toolByName,
  twoWrittenChaptersIndex,
  vi,
  workspace,
};
export type {
  AgentTool,
  LongAgentId,
  LongAgentProfile,
  LongAgentToolDetails,
  LongCommandExecutor,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRoot,
  LongWorkspaceRuntimeContext,
};
