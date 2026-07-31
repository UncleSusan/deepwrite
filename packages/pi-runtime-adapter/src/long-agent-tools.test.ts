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
  longChapterCharacterStateFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
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
const CHAPTER_SUMMARY = {
  timeline: "第一天完成。",
  character_states: "人物状态已核对。",
  faction_states: "势力状态无变化。",
  realm_states: "境界状态无变化。",
  foreshadowing_states: "伏笔状态已核对。",
  continuity_notes: "下一章沿用当前连续性。"
};
const CONTINUITY_FACT_ID = "fact_alice_location";
const CONTINUITY_LOOP_ID = "loop_alice_return";

function emptyLedgerV3Parameters() {
  return {
    coverage: {
      character: { status: "unchanged" as const, note: "人物状态已核验。" },
      plot: { status: "unchanged" as const, note: "剧情推进已核验。" },
      foreshadowing: { status: "unchanged" as const, note: "伏笔状态已核验。" },
      world: { status: "unchanged" as const, note: "世界规则已核验。" },
      knowledge: { status: "unchanged" as const, note: "知识边界已核验。" },
      open_loops: { status: "unchanged" as const, note: "开放环已核验。" }
    },
    fact_mutations: [],
    knowledge_mutations: [],
    open_loop_mutations: [],
    chapter_outputs: {
      character_state: "林岚的章末状态未发生变化。",
      handoff: {
        summary: "下一章沿用当前连续性。",
        must_carry: [],
        next_chapter_constraints: [],
        open_loops: []
      }
    }
  };
}

function completeLedgerV3Parameters(characterId: string) {
  return {
    coverage: {
      character: { status: "changed" as const, note: "林岚抵达北门。" },
      plot: { status: "changed" as const, note: "第一章推进到北门会合。" },
      foreshadowing: { status: "unchanged" as const, note: "本章未触发旧伏笔。" },
      world: { status: "unchanged" as const, note: "本章未揭露新世界规则。" },
      knowledge: { status: "changed" as const, note: "读者已知林岚抵达北门。" },
      open_loops: { status: "changed" as const, note: "林岚能否安全返回仍待解决。" }
    },
    fact_mutations: [
      {
        fact_id: CONTINUITY_FACT_ID,
        domain: "character" as const,
        subject_id: characterId,
        field: "location",
        value: "北门",
        evidence: "正文写明林岚在日落前抵达北门。"
      }
    ],
    knowledge_mutations: [
      {
        fact_id: CONTINUITY_FACT_ID,
        audience_type: "reader" as const,
        audience_id: null,
        level: "knows" as const,
        evidence: "正文直接呈现林岚抵达北门。"
      }
    ],
    open_loop_mutations: [
      {
        loop_id: CONTINUITY_LOOP_ID,
        kind: "character" as const,
        status: "open" as const,
        detail: "林岚能否在追兵封锁前安全返回。",
        subject_id: characterId,
        fact_id: CONTINUITY_FACT_ID,
        evidence: "章末出现追兵封锁北门。"
      }
    ],
    chapter_outputs: {
      character_state: "林岚已抵达北门，体力下降，并暴露在追兵视野中。",
      handoff: {
        summary: "下一章从林岚被困北门继续。",
        must_carry: ["林岚位于北门。"],
        next_chapter_constraints: ["追兵已经封锁北门。"],
        open_loops: [CONTINUITY_LOOP_ID]
      }
    }
  };
}

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
          narrativeOrder: 1,
          outline: "",
          worldConstraints: "",
          characterIds: ["character_alice"]
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
  index.chapters[0]!.commitId = "commit_one";
  index.ledger.committedThroughChapterId = "chapter_one";
  index.ledger.commits = [
    {
      id: "commit_one",
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

describe("long workspace agent tools", () => {
  it("assembles exact query and proposal tools by long capability only", () => {
    const worldNames = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-world",
      runId: "run-world"
    }).map((tool) => tool.name);
    const characterNames = buildLongWorkspaceTools({
      workspace: workspace("character_design", "character_design"),
      profile: profile("character_design"),
      sessionId: "session-character",
      runId: "run-character"
    }).map((tool) => tool.name);
    const writerNames = buildLongWorkspaceTools({
      workspace: workspace("expert_section_writer", "draft", "chapter_one"),
      profile: profile("expert_section_writer"),
      sessionId: "session-writer",
      runId: "run-writer"
    }).map((tool) => tool.name);
    const ledgerNames = buildLongWorkspaceTools({
      workspace: workspace("continuity_ledger", "continuity_ledger", "chapter_one"),
      profile: profile("continuity_ledger"),
      sessionId: "session-ledger",
      runId: "run-ledger"
    }).map((tool) => tool.name);
    const ledgerReadOnlyNames = buildLongWorkspaceTools({
      workspace: workspace("continuity_ledger", "continuity_ledger"),
      profile: profile("continuity_ledger"),
      sessionId: "session-ledger-read-only",
      runId: "run-ledger-read-only"
    }).map((tool) => tool.name);
    const draftNames = buildLongWorkspaceTools({
      workspace: workspace("draft", "draft"),
      profile: profile("draft"),
      sessionId: "session-draft",
      runId: "run-draft"
    }).map((tool) => tool.name);
    const plotNames = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-plot",
      runId: "run-plot"
    }).map((tool) => tool.name);
    const forgedDraftProfile = profile("draft");
    forgedDraftProfile.writeAccess.capabilities.push(
      "write_chapter_files"
    );
    const forgedDraftNames = buildLongWorkspaceTools({
      workspace: workspace("draft", "draft", "chapter_one"),
      profile: forgedDraftProfile,
      sessionId: "session-forged-draft",
      runId: "run-forged-draft"
    }).map((tool) => tool.name);
    const rootlessLedgerProfile = profile("continuity_ledger");
    rootlessLedgerProfile.writeAccess.workspaceRoots =
      rootlessLedgerProfile.writeAccess.workspaceRoots.filter(
        (root) => root !== "continuity_ledger"
      );
    const rootlessLedgerNames = buildLongWorkspaceTools({
      workspace: workspace(
        "continuity_ledger",
        "continuity_ledger",
        "chapter_one"
      ),
      profile: rootlessLedgerProfile,
      sessionId: "session-rootless-ledger",
      runId: "run-rootless-ledger"
    }).map((tool) => tool.name);

    expect(worldNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "list_worldbuilding",
      "search_worldbuilding",
      "read_worldbuilding",
      "create_worldbuilding_file",
      "write_worldbuilding_file",
      "edit_worldbuilding_file",
      "propose_long_mutation"
    ]);
    expect(worldNames).not.toEqual(
      expect.arrayContaining([
        "get_long_workspace_index",
        "read_long_document",
        "search_long_workspace"
      ])
    );
    expect(characterNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "get_long_chapter_readiness",
      "list_worldbuilding",
      "search_worldbuilding",
      "read_worldbuilding",
      "list_characters",
      "read_character_overview",
      "search_characters",
      "read_character",
      "create_character",
      "write_character_file",
      "edit_character_file",
      "write_character_overview",
      "edit_character_overview",
      "propose_long_mutation"
    ]);
    expect(characterNames).not.toEqual(
      expect.arrayContaining([
        "get_long_workspace_index",
        "read_long_document",
        "search_long_workspace",
        "create_worldbuilding_file",
        "write_worldbuilding_file",
        "edit_worldbuilding_file"
      ])
    );
    const characterMutationSchema = JSON.stringify(
      toolByName(
        buildLongWorkspaceTools({
          workspace: workspace("character_design", "character_design"),
          profile: profile("character_design"),
          sessionId: "session-character-schema",
          runId: "run-character-schema"
        }),
        "propose_long_mutation"
      ).parameters
    );
    expect(characterMutationSchema).toContain('"character.update"');
    expect(characterMutationSchema).not.toContain('"character.create"');
    expect(characterMutationSchema).not.toContain('"worldbuilding.create"');
    expect(characterMutationSchema).not.toContain('"document_updates"');
    expect(writerNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "get_long_workspace_index",
      "read_long_document",
      "search_long_workspace",
      "get_long_chapter_readiness",
      "propose_long_chapter_write"
    ]);
    expect(ledgerNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "get_long_workspace_index",
      "read_long_document",
      "search_long_workspace",
      "get_long_chapter_readiness",
      "propose_long_ledger_commit"
    ]);
    expect(ledgerReadOnlyNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "get_long_workspace_index",
      "read_long_document",
      "search_long_workspace",
      "get_long_chapter_readiness"
    ]);
    expect(draftNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "get_long_workspace_index",
      "read_long_document",
      "search_long_workspace",
      "get_long_chapter_readiness",
      "propose_long_chapter_dispatch"
    ]);
    expect(plotNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "get_long_chapter_readiness",
      "list_worldbuilding",
      "search_worldbuilding",
      "read_worldbuilding",
      "list_characters",
      "read_character_overview",
      "search_characters",
      "read_character",
      "list_plot_design",
      "search_plot_design",
      "read_plot_design",
      "create_plot_design",
      "write_plot_design",
      "edit_plot_design",
      "propose_long_mutation",
      "propose_long_chapter_dispatch"
    ]);
    const plotTools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-plot-schema",
      runId: "run-plot-schema"
    });
    const plotMutationSchema = JSON.stringify(
      toolByName(plotTools, "propose_long_mutation").parameters
    );
    expect(plotMutationSchema).toContain('"foreshadowing.create"');
    expect(plotMutationSchema).toContain('"foreshadowingBeat.create"');
    expect(plotMutationSchema).toContain('"volume.update"');
    expect(plotMutationSchema).not.toContain('"volume.create"');
    expect(plotMutationSchema).not.toContain('"arc.create"');
    expect(plotMutationSchema).not.toContain('"chapter.create"');
    expect(plotMutationSchema).not.toContain('"event.create"');
    expect(plotMutationSchema).not.toContain('"connection.create"');
    expect(plotMutationSchema).not.toContain('"placement.create"');
    expect(plotMutationSchema).not.toContain('"document_updates"');
    expect(
      [...worldNames, ...characterNames, ...writerNames, ...ledgerNames]
    ).not.toContain("write_workspace_editor");
    expect(forgedDraftNames).not.toContain(
      "propose_long_chapter_write"
    );
    expect(rootlessLedgerNames).not.toContain(
      "propose_long_ledger_commit"
    );
  });

  it("loads only long-bound resources allowed by the active long profile", async () => {
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-resources",
      runId: "run-resources",
      attachedMaterials: [
        {
          id: "material-plot",
          title: "潮汐设定",
          source: "attached-material",
          kind: "plot",
          content: "逆潮每十年出现一次。"
        },
        {
          id: "material-draft",
          title: "正文样章",
          source: "attached-material",
          kind: "draft",
          content: "世界观智能体不应读取这段。"
        }
      ],
      attachedSkills: [
        {
          id: "skill-general",
          title: "规则一致性",
          source: "attached-skill",
          kind: "general",
          content: "先检查规则是否自洽。"
        }
      ]
    });
    const listed = await toolByName(
      tools,
      "query_linked_material_entries"
    ).execute("list-materials", { mode: "list" });
    expect(listed.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("潮汐设定")
    });
    expect(JSON.stringify(listed.content)).not.toContain("正文样章");

    const skill = await toolByName(tools, "load_skill").execute(
      "load-skill",
      { name: "规则一致性" }
    );
    expect(skill.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("先检查规则是否自洽")
    });
  });

  it("uses business-level plot tools for non-foreshadowing content", async () => {
    const index = fixtureIndex();
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-plot-business-tools",
      runId: "run-plot-business-tools",
      executor
    });

    const listed = await toolByName(tools, "list_plot_design").execute(
      "list-arcs",
      { kind: "arc", volume_id: "volume_one" }
    );
    const listedText = listed.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(listedText).toContain('"arc_id":"arc_one"');
    expect(listedText).not.toContain("fileId");

    await toolByName(tools, "read_plot_design").execute("read-arc", {
      target: { kind: "arc", arc_id: "arc_one" },
      mode: "full"
    });
    const edit = await toolByName(tools, "edit_plot_design").execute(
      "edit-arc",
      {
        item: {
          kind: "arc",
          arc_id: "arc_one",
          patch: { outline: "更新后的剧情点故事情节" }
        },
        summary: "细化剧情点"
      }
    );
    expect(edit.details).toMatchObject({
      kind: "long-mutation-proposal",
      summary: "细化剧情点",
      batch: {
        operations: [
          {
            type: "arc.update",
            id: "arc_one",
            patch: { outline: "更新后的剧情点故事情节" }
          }
        ]
      }
    });

    const create = await toolByName(tools, "create_plot_design").execute(
      "create-arc",
      {
        item: {
          kind: "arc",
          volume_id: "volume_one",
          title: "新的剧情点",
          summary: "概要",
          outline: "故事情节"
        }
      }
    );
    expect(create.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "arc.create",
            arc: {
              id: expect.stringMatching(/^arc_[0-9a-f]{24}$/u),
              volumeId: "volume_one",
              title: "新的剧情点",
              outline: "故事情节"
            }
          }
        ]
      }
    });
  });

  it("lists worldbuilding through semantic ids and rejects physical-id parameters", async () => {
    const index = fixtureWorldbuildingIndex();
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type === "long.readDocument") {
        const category = index.worldbuilding.find(
          ({ id }) => id === "world_magic"
        );
        if (!category || category.format !== "list" || !category.overview) {
          throw new Error("Expected a list category overview.");
        }
        const overviewContent = "记忆代价：施法会消耗施法者的记忆。";
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: category.overview,
            content: overviewContent,
            offset: command.payload.offset,
            totalCharacters: Array.from(overviewContent).length,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-world-list",
      runId: "run-world-list",
      executor
    });
    const list = toolByName(tools, "list_worldbuilding");
    const read = toolByName(tools, "read_worldbuilding");
    const search = toolByName(tools, "search_worldbuilding");
    const write = toolByName(tools, "write_worldbuilding_file");

    for (const tool of [list, read, search, write]) {
      const parameterSchema = JSON.stringify(tool.parameters);
      for (const forbidden of [
        "file_id",
        "fileId",
        "book_id",
        "bookId",
        "path",
        "revision",
        "cursor"
      ]) {
        expect(parameterSchema).not.toContain(`\"${forbidden}\"`);
      }
    }
    expect(JSON.stringify(list.parameters)).toContain('"page"');
    expect(JSON.stringify(list.parameters)).toContain('"limit"');
    expect(JSON.stringify(search.parameters)).toContain('"page"');
    expect(JSON.stringify(search.parameters)).toContain('"limit"');
    expect(Check(list.parameters, { page: 1, limit: 1 })).toBe(true);
    expect(Check(list.parameters, { page: 0 })).toBe(false);
    expect(Check(list.parameters, {
      category_id: "world_rules",
      file_id: "file_world_rules:content"
    })).toBe(false);
    expect(Check(search.parameters, { query: "记忆", limit: 101 })).toBe(
      false
    );
    expect(Check(read.parameters, {
      category_id: "world_rules",
      mode: "preview"
    })).toBe(true);
    expect(Check(read.parameters, {
      category_id: "world_rules",
      file_id: "file_world_rules:content"
    })).toBe(false);
    expect(Check(read.parameters, {
      category_id: "file_world_rules:content",
      mode: "preview"
    })).toBe(false);
    expect(Check(read.parameters, {
      category_id: "world_magic",
      item_id: "file_worlditem_memory:content",
      mode: "full"
    })).toBe(false);
    expect(Check(write.parameters, {
      category_id: "file_world_rules:content",
      text: "不应接受文件 ID"
    })).toBe(false);

    const categoryPageOne = JSON.parse(resultText(
      await list.execute("list-world-categories-one", { page: 1, limit: 1 })
    ));
    expect(categoryPageOne).toEqual({
      categories: [{
        category_id: "world_rules",
        title: "世界规则",
        format: "text"
      }],
      next_page: 2
    });
    expectNoPhysicalWorldbuildingMetadata(JSON.stringify(categoryPageOne));

    const categoryPageTwo = JSON.parse(resultText(
      await list.execute("list-world-categories-two", { page: 2, limit: 1 })
    ));
    expect(categoryPageTwo).toEqual({
      categories: [{
        category_id: "world_magic",
        title: "魔法体系",
        format: "list",
        item_count: 2
      }],
      next_page: null
    });
    expectNoPhysicalWorldbuildingMetadata(JSON.stringify(categoryPageTwo));

    const itemPageOne = JSON.parse(resultText(
      await list.execute("list-world-items-one", {
        category_id: "world_magic",
        page: 1,
        limit: 1
      })
    ));
    expect(itemPageOne).toEqual({
      category: {
        category_id: "world_magic",
        title: "魔法体系",
        format: "list"
      },
      overview: "记忆代价：施法会消耗施法者的记忆。",
      items: [{ item_id: "worlditem_memory", title: "记忆代价" }],
      next_page: 2
    });
    expectNoPhysicalWorldbuildingMetadata(JSON.stringify(itemPageOne));

    const itemPageTwo = JSON.parse(resultText(
      await list.execute("list-world-items-two", {
        category_id: "world_magic",
        page: 2,
        limit: 1
      })
    ));
    expect(itemPageTwo).toEqual({
      category: {
        category_id: "world_magic",
        title: "魔法体系",
        format: "list"
      },
      overview: "记忆代价：施法会消耗施法者的记忆。",
      items: [{ item_id: "worlditem_blood", title: "血脉门槛" }],
      next_page: null
    });
    expectNoPhysicalWorldbuildingMetadata(JSON.stringify(itemPageTwo));
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("reads worldbuilding through internal file mappings without leaking them", async () => {
    const index = fixtureWorldbuildingIndex();
    const category = index.worldbuilding.find(
      ({ id }) => id === "world_magic"
    );
    if (!category || category.format !== "list") {
      throw new Error("Expected the fixture magic category to be a list.");
    }
    const item = category.items[0]!;
    const replacementSource = "每次施法都会遗忘一段记忆。";
    const middleMarker = "WORLD_BUILDING_MIDDLE_SENTINEL";
    const content = `${"开篇".repeat(130)}${replacementSource}${middleMarker}${"收束".repeat(130)}`;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const isOverview = command.payload.fileId === category.overview?.id;
      expect([item.file.id, category.overview?.id]).toContain(
        command.payload.fileId
      );
      const resultContent = isOverview
        ? "记忆代价：施法会消耗施法者的记忆。"
        : content;
      const resultFile = isOverview ? category.overview! : item.file;
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: resultFile,
          content: resultContent,
          offset: command.payload.offset,
          totalCharacters: Array.from(resultContent).length,
          nextOffset: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-world-read",
      runId: "run-world-read",
      executor
    });
    const read = toolByName(tools, "read_worldbuilding");
    const edit = toolByName(tools, "edit_worldbuilding_file");

    const preview = await read.execute("preview-world-item", {
      category_id: category.id,
      item_id: item.id,
      mode: "preview"
    });
    const previewText = resultText(preview);
    expect(previewText).toContain("【魔法体系 / 记忆代价】");
    expect(previewText).toContain("预览（不建立整体覆盖凭据）");
    expect(previewText).not.toContain(middleMarker);
    expectNoPhysicalWorldbuildingMetadata(previewText);

    const blockedEdit = await edit.execute("edit-after-preview", {
      category_id: category.id,
      item_id: item.id,
      replacements: [{
        original_text: replacementSource,
        new_text: "每次施法都会遗忘一段珍贵记忆。"
      }]
    });
    expect(resultText(blockedEdit)).toContain(
      "read_worldbuilding（mode=full）"
    );

    const full = await read.execute("full-world-item", {
      category_id: category.id,
      item_id: item.id,
      mode: "full"
    });
    const fullText = resultText(full);
    expect(fullText).toContain(middleMarker);
    expect(fullText).toContain(replacementSource);
    expectNoPhysicalWorldbuildingMetadata(fullText);

    const edited = await edit.execute("edit-after-full", {
      category_id: category.id,
      item_id: item.id,
      replacements: [{
        original_text: replacementSource,
        new_text: "每次施法都会遗忘一段珍贵记忆。"
      }]
    });
    expect(edited.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      files: [{
        categoryId: category.id,
        itemId: item.id,
        operation: "edit",
        afterText: expect.stringContaining("珍贵记忆")
      }]
    });
    await expect(
      read.execute("text-category-with-item", {
        category_id: "world_rules",
        item_id: item.id,
        mode: "full"
      })
    ).rejects.toThrow(/do not have items/u);
    const overview = await read.execute("list-category-without-item", {
      category_id: category.id,
      mode: "full"
    });
    expect(resultText(overview)).toContain("【魔法体系 / 概览】");
    expect(resultText(overview)).toContain(
      "记忆代价：施法会消耗施法者的记忆。"
    );
  });

  it("maps Core worldbuilding search hits back to category and item ids", async () => {
    const index = fixtureWorldbuildingIndex();
    const textCategory = index.worldbuilding.find(
      ({ id }) => id === "world_rules"
    );
    const listCategory = index.worldbuilding.find(
      ({ id }) => id === "world_magic"
    );
    if (
      !textCategory ||
      textCategory.format !== "text" ||
      !listCategory ||
      listCategory.format !== "list"
    ) {
      throw new Error("Expected both worldbuilding fixture categories.");
    }
    const item = listCategory.items[0]!;
    let returnUnknownFile = false;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type !== "long.search") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      expect(command.payload.bookId).toBe(index.bookId);
      expect(command.payload.scope).toBe("worldbuilding");
      expect(command.payload.limit).toBe(2);
      expect(command.payload).not.toHaveProperty("path");
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          query: command.payload.query,
          scope: "worldbuilding",
          hits: returnUnknownFile
            ? [{
                fileId: "file_worlditem_unknown:content",
                path: "long/worldbuilding/world_magic/items/worlditem_unknown.md",
                root: "worldbuilding",
                title: "不应映射的文件",
                start: 0,
                end: 2,
                snippet: "未知命中",
                revision: REVISION
              }]
            : [
                {
                  fileId: textCategory.file.id,
                  path: textCategory.file.path,
                  root: "worldbuilding",
                  title: "Core 内部标题",
                  start: 0,
                  end: 2,
                  snippet: "规则命中",
                  revision: textCategory.file.revision
                },
                {
                  fileId: item.file.id,
                  path: item.file.path,
                  root: "worldbuilding",
                  title: "Core 内部条目标题",
                  start: 3,
                  end: 5,
                  snippet: "记忆命中",
                  revision: item.file.revision
                }
              ],
          nextCursor: "core-private-page-token",
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-world-search",
      runId: "run-world-search",
      executor
    });
    const search = toolByName(tools, "search_worldbuilding");

    const result = JSON.parse(resultText(
      await search.execute("search-world", { query: "记忆", page: 1, limit: 2 })
    ));
    expect(result).toEqual({
      hits: [
        {
          category_id: "world_rules",
          title: "世界规则",
          snippet: "规则命中"
        },
        {
          category_id: "world_magic",
          item_id: "worlditem_memory",
          title: "记忆代价",
          snippet: "记忆命中"
        }
      ],
      next_page: 2
    });
    const resultTextValue = JSON.stringify(result);
    expect(resultTextValue).not.toContain("core-private-page-token");
    expectNoPhysicalWorldbuildingMetadata(resultTextValue);

    const filtered = JSON.parse(resultText(
      await search.execute("search-world-category", {
        query: "记忆",
        category_id: "world_magic",
        page: 1,
        limit: 2
      })
    ));
    expect(filtered.hits).toEqual([{
      category_id: "world_magic",
      item_id: "worlditem_memory",
      title: "记忆代价",
      snippet: "记忆命中"
    }]);
    expectNoPhysicalWorldbuildingMetadata(JSON.stringify(filtered));

    returnUnknownFile = true;
    await expect(
      search.execute("search-world-unknown-file", {
        query: "未知",
        page: 1,
        limit: 2
      })
    ).rejects.toThrow(/unknown worldbuilding document/u);
  });

  it("selects the continuous next chapter by volume and in-volume narrative order", () => {
    const index = {
      plot: {
        volumes: [
          { id: "volume_two", order: 2 },
          { id: "volume_one", order: 1 }
        ],
        chapterCards: [
          {
            id: "chapter_volume_two",
            volumeId: "volume_two",
            narrativeOrder: 1
          },
          {
            id: "chapter_one_second",
            volumeId: "volume_one",
            narrativeOrder: 2
          },
          {
            id: "chapter_one_first",
            volumeId: "volume_one",
            narrativeOrder: 1
          }
        ]
      },
      ledger: {
        commits: [{ chapterCardId: "chapter_one_first" }]
      }
    } as unknown as LongWorkspaceIndexSnapshot;

    expect(selectNextLongChapterForDispatch(index)).toMatchObject({
      id: "chapter_one_second"
    });
    index.ledger.commits.push(
      { chapterCardId: "chapter_one_second" } as never,
      { chapterCardId: "chapter_volume_two" } as never
    );
    expect(selectNextLongChapterForDispatch(index)).toBeUndefined();
  });

  it("selects chapter, contiguous arc, or current volume without allowing book scope", () => {
    const index = {
      plot: {
        volumes: [
          { id: "volume_two", order: 2 },
          { id: "volume_one", order: 1 }
        ],
        chapterCards: [
          {
            id: "chapter_four",
            volumeId: "volume_one",
            primaryArcId: "arc_one",
            narrativeOrder: 4
          },
          {
            id: "chapter_five",
            volumeId: "volume_two",
            primaryArcId: "arc_three",
            narrativeOrder: 1
          },
          {
            id: "chapter_two",
            volumeId: "volume_one",
            primaryArcId: "arc_one",
            narrativeOrder: 2
          },
          {
            id: "chapter_three",
            volumeId: "volume_one",
            primaryArcId: "arc_two",
            narrativeOrder: 3
          },
          {
            id: "chapter_one",
            volumeId: "volume_one",
            primaryArcId: "arc_one",
            narrativeOrder: 1
          }
        ]
      },
      ledger: { commits: [] }
    } as unknown as LongWorkspaceIndexSnapshot;

    expect(
      selectLongChaptersForWritingScope(index, { scope: "chapter" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_one"]);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "arc" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_one", "chapter_two"]);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "volume" }).map(
        ({ id }) => id
      )
    ).toEqual([
      "chapter_one",
      "chapter_two",
      "chapter_three",
      "chapter_four"
    ]);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "book" as never
      })
    ).toThrow(/whole-book/u);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "chapter",
        arcId: "arc_one"
      })
    ).toThrow(/selector.*another scope/u);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "arc",
        volumeId: "volume_one"
      })
    ).toThrow(/selector.*another scope/u);
    expect(() =>
      selectLongChaptersForWritingScope(index, {
        scope: "volume",
        chapterCardId: "chapter_one"
      })
    ).toThrow(/selector.*another scope/u);

    index.ledger.commits.push({} as never, {} as never);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "arc" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_three"]);
  });

  it("derives chapter readiness from body content only", async () => {
    const index = fixtureIndex();
    const entry = index.chapters[0]!;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") return indexResult();
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      expect(command.payload.fileId).toBe(entry.body.id);
      const content = "已有正文";
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: entry.body,
          content,
          offset: 0,
          totalCharacters: Array.from(content).length,
          nextOffset: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace(
        "expert_section_writer",
        "draft",
        "chapter_one"
      ),
      profile: profile("expert_section_writer"),
      sessionId: "session-readiness",
      runId: "run-readiness",
      executor
    });
    const result = await toolByName(
      tools,
      "get_long_chapter_readiness"
    ).execute("readiness", {});
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining('"status": "ready_to_commit"')
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('"missingFiles": []')
    });
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("forms a dispatch proposal from one index query and stops cleanly when complete", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult();
      }
      if (command.type === "long.readDocument") {
        const index = fixtureIndex();
        const entry = index.chapters[0]!;
        const requested = entry.body;
        if (requested.id !== command.payload.fileId) {
          throw new Error("Unexpected chapter file.");
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: requested,
            content: "",
            offset: 0,
            totalCharacters: 0,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("draft", "draft"),
      profile: profile("draft"),
      sessionId: "session-dispatch",
      runId: "run-dispatch",
      executor
    });
    const proposal = await toolByName(
      tools,
      "propose_long_chapter_dispatch"
    ).execute("dispatch-next", { summary: "调度连续下一章" });

    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[0]?.[0].type).toBe("long.getWorkspaceIndex");
    expect(proposal.details).toMatchObject({
      kind: "long-chapter-dispatch-proposal",
      bookId: "longbook_tools",
      agentId: "draft",
      scope: "chapter",
      chapterCardId: "chapter_one",
      title: "第一章",
      chapters: [
        {
          chapterCardId: "chapter_one",
          title: "第一章",
          status: "empty",
          missingFiles: ["body"]
        }
      ],
      workspaceRevision: 7,
      projectRevision: 11,
      summary: "调度连续下一章"
    });
    expect(
      toRuntimeEvents(
        {
          type: "tool_execution_end",
          toolCallId: "dispatch-next",
          toolName: "propose_long_chapter_dispatch",
          result: proposal,
          isError: false
        },
        {
          runId: "run-dispatch",
          sessionId: "session-dispatch",
          prompt: "调度下一章"
        },
        {
          provider: "deepwrite",
          model: "test",
          mode: "local-faux"
        },
        "message-dispatch"
      )
    ).toMatchObject([
      { type: "agent.tool_completed" },
      {
        type: "long.chapter_dispatch_proposal",
        payload: {
          scope: "chapter",
          chapterCardId: "chapter_one",
          title: "第一章",
          chapters: [
            expect.objectContaining({
              chapterCardId: "chapter_one",
              status: "empty"
            })
          ],
          workspaceRevision: 7,
          projectRevision: 11
        }
      }
    ]);

    const completeExecutor = vi.fn<LongCommandExecutor>(
      async (command) => ({
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: "longbook_tools",
          workspaceIndex: committedFixtureIndex(),
          projectRevision: 12
        }
      })
    );
    const completeTools = buildLongWorkspaceTools({
      workspace: workspace("draft", "draft"),
      profile: profile("draft"),
      sessionId: "session-complete",
      runId: "run-complete",
      executor: completeExecutor
    });
    const complete = await toolByName(
      completeTools,
      "propose_long_chapter_dispatch"
    ).execute("dispatch-complete", {});
    expect(complete.details).toEqual({ kind: "none" });
    expect(complete.content).toEqual([
      {
        type: "text",
        text: "全部章卡均已连续提交，没有可调度的下一章。"
      }
    ]);
    expect(
      toRuntimeEvents(
        {
          type: "tool_execution_end",
          toolCallId: "dispatch-complete",
          toolName: "propose_long_chapter_dispatch",
          result: complete,
          isError: false
        },
        {
          runId: "run-complete",
          sessionId: "session-complete",
          prompt: "继续"
        },
        {
          provider: "deepwrite",
          model: "test",
          mode: "local-faux"
        },
        "message-complete"
      ).map((event) => event.type)
    ).toEqual(["agent.tool_completed"]);
  });

  it("locks Core queries to the active book, read roots and AbortSignal", async () => {
    const index = fixtureIndex();
    const characterFile = index.characterFiles[0]!.coreProfile;
    const seenSignals: Array<AbortSignal | undefined> = [];
    const executor = vi.fn<LongCommandExecutor>(async (command, signal) => {
      seenSignals.push(signal);
      if (command.type === "long.getWorkspaceIndex") return indexResult(index);
      if (command.type === "long.readDocument") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: characterFile,
            content: "人物档案正文",
            offset: 0,
            totalCharacters: 6,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          query: command.payload.query,
          scope: command.payload.scope,
          hits: [],
          nextCursor: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const characterProfile = profile("character_design");
    characterProfile.readAccess.workspaceRoots = ["character_design"];
    const tools = buildLongWorkspaceTools({
      workspace: workspace("character_design", "character_design"),
      profile: characterProfile,
      sessionId: "session-query",
      runId: "run-query",
      executor
    });
    const controller = new AbortController();
    await toolByName(tools, "read_character").execute(
      "read-character",
      {
        character_id: "character_alice",
        document: "core_profile",
        mode: "full"
      },
      controller.signal
    );
    await toolByName(tools, "search_characters").execute(
      "search-character",
      { query: "人物" },
      controller.signal
    );

    expect(executor).toHaveBeenCalledTimes(3);
    expect(executor.mock.calls.map(([command]) => command.type)).toEqual([
      "long.getWorkspaceIndex",
      "long.readDocument",
      "long.search"
    ]);
    expect(
      executor.mock.calls.every(
        ([command]) =>
          command.payload.bookId === index.bookId &&
          !("path" in command.payload)
      )
    ).toBe(true);
    expect(seenSignals.every((signal) => signal === controller.signal)).toBe(true);

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      toolByName(tools, "search_characters").execute(
        "search-aborted",
        { query: "人物" },
        aborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executor).toHaveBeenCalledTimes(3);
  });

  it("uses unique command ids for concurrent document reads in one run", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(123);
    try {
      const index = fixtureIndex();
      const characterFile = index.characterFiles[0]!.coreProfile;
      const executor = vi.fn<LongCommandExecutor>(async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return indexResult(index);
        }
        if (command.type !== "long.readDocument") {
          throw new Error(`Unexpected command: ${command.type}`);
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: characterFile,
            content: "人物档案正文",
            offset: command.payload.offset,
            totalCharacters: 6,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      });
      const tools = buildLongWorkspaceTools({
        workspace: workspace("character_design", "character_design"),
        profile: profile("character_design"),
        sessionId: "session-concurrent-query",
        runId: "run-concurrent-query",
        executor
      });
      const readTool = toolByName(tools, "read_character");

      await Promise.all([
        readTool.execute("read-character-one", {
          character_id: "character_alice",
          document: "core_profile",
          mode: "full"
        }),
        readTool.execute("read-character-two", {
          character_id: "character_alice",
          document: "core_profile",
          mode: "full"
        })
      ]);

      const readCommandIds = executor.mock.calls
        .map(([command]) => command)
        .filter((command) => command.type === "long.readDocument")
        .map(({ id }) => id);
      expect(readCommandIds).toHaveLength(2);
      expect(new Set(readCommandIds).size).toBe(2);
    } finally {
      now.mockRestore();
    }
  });

  it("rejects a Core worldbuilding response that changes the internally mapped file", async () => {
    const index = fixtureIndex();
    const worldFile = fixtureWorldFile(index);
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: {
            ...worldFile,
            path: "long/worldbuilding/other/content.md"
          },
          content: "错误文件",
          offset: command.payload.offset,
          totalCharacters: 4,
          nextOffset: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-wrong-file",
      runId: "run-wrong-file",
      executor
    });

    await expect(
      toolByName(tools, "read_worldbuilding").execute(
        "read-wrong-file",
        { category_id: "world_rules", mode: "full" }
      )
    ).rejects.toThrow(/different worldbuilding document/u);
  });

  it("builds typed mutation batches from the latest index without invoking a write command", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type !== "long.getWorkspaceIndex") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      return indexResult();
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-mutation",
      runId: "run-mutation",
      executor
    });
    const proposal = await toolByName(tools, "propose_long_mutation").execute(
      "mutation-1",
      {
        operations: [
          {
            type: "worldbuilding.update",
            id: "world_rules",
            patch: { title: "世界硬规则" }
          }
        ],
        summary: "更新世界规则标题"
      }
    );

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[0].type).toBe(
      "long.getWorkspaceIndex"
    );
    expect(proposal.details).toMatchObject({
      kind: "long-mutation-proposal",
      bookId: "longbook_tools",
      agentId: "worldbuilding",
      baseProjectRevision: 11,
      summary: "更新世界规则标题",
      batch: {
        baseRevision: 7,
        operations: [
          {
            type: "worldbuilding.update",
            id: "world_rules",
            patch: { title: "世界硬规则" }
          }
        ],
        documentWrites: []
      }
    });
    const parameterSchema = JSON.stringify(
      toolByName(tools, "propose_long_mutation").parameters
    );
    expect(parameterSchema).not.toMatch(
      /"batch"|"baseRevision"|"updatedAt"|"fileId"|"file_id"|"path"|"nextRevision"|"expectedRevision"/u
    );
    expect(parameterSchema).toContain('"worldbuilding.create"');
    expect(parameterSchema).not.toContain('"worldbuildingItem.create"');
    expect(parameterSchema).not.toContain('"document_updates"');
    expect(parameterSchema).not.toContain('"character.create"');
    expect(parameterSchema).not.toContain('"chapter.create"');
    expect(tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "list_worldbuilding",
        "search_worldbuilding",
        "read_worldbuilding",
        "create_worldbuilding_file",
        "write_worldbuilding_file",
        "edit_worldbuilding_file"
      ])
    );

    const createProposal = await toolByName(
      tools,
      "propose_long_mutation"
    ).execute("mutation-create", {
      operations: [
        {
          type: "worldbuilding.create",
          client_ref: "weather",
          title: "气候",
          format: "text"
        }
      ],
      summary: "新增气候设定"
    });
    expect(createProposal.details).toMatchObject({
      kind: "long-mutation-proposal"
    });
    if (createProposal.details?.kind !== "long-mutation-proposal") {
      throw new Error("Expected a mutation proposal.");
    }
    const createdCategory = createProposal.details.batch.operations[0];
    expect(createdCategory).toMatchObject({
      type: "worldbuilding.create",
      category: {
        id: expect.stringMatching(/^world_[0-9a-f]{24}$/u),
        title: "气候",
        order: 2,
        format: "text",
        contentAuthority: "markdown",
        file: {
          revision:
            "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        }
      }
    });
    if (createdCategory.type !== "worldbuilding.create") {
      throw new Error("Expected a worldbuilding create operation.");
    }
    expect(createdCategory.category.file.id).toBe(
      longWorldbuildingFileId(createdCategory.category.id)
    );
    expect(createdCategory.category.file.path).toBe(
      `long/worldbuilding/${createdCategory.category.id}/content.md`
    );

    await expect(
      toolByName(tools, "propose_long_mutation").execute("mutation-bad", {
        operations: [
          {
            type: "character.update",
            id: "character_alice",
            patch: { name: "越权修改" }
          }
        ],
        summary: "越权"
      })
    ).rejects.toThrow(/outside the agent's write roots/u);
    await expect(
      toolByName(tools, "propose_long_mutation").execute(
        "mutation-empty-summary",
        {
          operations: [],
          summary: "   "
        }
      )
    ).rejects.toThrow(/non-whitespace text/u);
  });

  it("creates exactly one empty worldbuilding file and returns its stable item id", async () => {
    const index = fixtureIndex();
    index.worldbuilding = [{
      id: "world_rules",
      title: "世界规则",
      order: 1,
      format: "list",
      contentAuthority: "files",
      items: []
    }];
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-world-items",
      runId: "run-world-items",
      executor
    });
    const createParameters = JSON.stringify(
      toolByName(tools, "create_worldbuilding_file").parameters
    );
    expect(createParameters).toContain('"title"');
    expect(createParameters).not.toContain('"items"');
    expect(createParameters).not.toContain('"content"');

    const proposal = await toolByName(
      tools,
      "create_worldbuilding_file"
    ).execute("create-world-items", {
      category_id: "world_rules",
      title: "记忆代价"
    });

    expect(proposal.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      batch: {
        operations: [{
          type: "worldbuildingItem.create",
          categoryId: "world_rules",
          item: {
            id: expect.stringMatching(/^worlditem_[0-9a-f]{24}$/u),
            title: "记忆代价",
            file: {
              path: expect.stringContaining("/items/")
            }
          }
        }],
        documentWrites: []
      },
      files: [{
        categoryId: "world_rules",
        itemId: expect.stringMatching(/^worlditem_[0-9a-f]{24}$/u),
        title: "记忆代价",
        operation: "create",
        beforeText: "",
        afterText: "",
        beforeRevision: null,
        filePath: expect.stringContaining("/items/")
      }]
    });
    if (
      proposal.details?.kind !== "long-worldbuilding-file-proposal"
    ) {
      throw new Error("Expected a worldbuilding file creation proposal.");
    }
    const createdItemId = proposal.details.files[0]!.itemId!;
    const write = await toolByName(
      tools,
      "write_worldbuilding_file"
    ).execute("write-created-world-file", {
      category_id: "world_rules",
      item_id: createdItemId,
      text: "每次施法都会遗忘一段记忆。"
    });
    expect(write.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      batch: {
        operations: [],
        documentWrites: [{
          mode: "replace",
          content: "每次施法都会遗忘一段记忆。"
        }]
      },
      files: [{
        itemId: createdItemId,
        operation: "write",
        beforeText: "",
        afterText: "每次施法都会遗忘一段记忆。"
      }]
    });
  });

  it("returns independent long worldbuilding file proposals for full writes and edits", async () => {
    const index = fixtureIndex();
    const category = index.worldbuilding[0]!;
    if (category.format !== "text") {
      throw new Error("Expected a text worldbuilding category.");
    }
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type === "long.readDocument") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: category.file,
            content: "旧规则。",
            offset: command.payload.offset,
            totalCharacters: 4,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-world-files",
      runId: "run-world-files",
      executor
    });

    await toolByName(tools, "read_worldbuilding").execute(
      "read-world-file",
      { category_id: category.id, mode: "full" }
    );
    const write = await toolByName(
      tools,
      "write_worldbuilding_file"
    ).execute("write-world-file", {
      category_id: category.id,
      text: "完整新规则。",
      allow_overwrite_existing: true
    });
    expect(write.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      files: [{
        categoryId: category.id,
        fileId: category.file.id,
        filePath: category.file.path,
        title: category.title,
        operation: "write",
        beforeText: "旧规则。",
        afterText: "完整新规则。",
        beforeRevision: category.file.revision
      }]
    });

    const edit = await toolByName(
      tools,
      "edit_worldbuilding_file"
    ).execute("edit-world-file", {
      category_id: category.id,
      replacements: [{
        original_text: "完整新规则",
        new_text: "精炼新规则"
      }]
    });
    expect(edit.details).toMatchObject({
      kind: "long-worldbuilding-file-proposal",
      files: [{
        operation: "edit",
        beforeText: "完整新规则。",
        afterText: "精炼新规则。"
      }]
    });
  });

  it("creates one empty character and then writes its independent files", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult();
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("character_design", "character_design"),
      profile: profile("character_design"),
      sessionId: "session-character-items",
      runId: "run-character-items",
      executor
    });

    const proposal = await toolByName(
      tools,
      "create_character"
    ).execute("create-character", {
      name: "沈砚",
      group: "major_supporting",
      aliases: ["阿砚"]
    });

    expect(proposal.details).toMatchObject({
      kind: "long-character-file-proposal",
      batch: {
        operations: [{
          type: "character.create",
          character: {
            id: expect.stringMatching(/^character_[0-9a-f]{24}$/u),
            name: "沈砚",
            group: "major_supporting",
            aliases: ["阿砚"]
          },
          files: {
            coreProfile: {
              path: expect.stringMatching(
                /^long\/characters\/character_[0-9a-f]{24}\/core-profile\.md$/u
              )
            },
            relationships: {
              path: expect.stringMatching(
                /^long\/characters\/character_[0-9a-f]{24}\/relationships\.md$/u
              )
            },
            currentState: {
              path: expect.stringMatching(
                /^long\/characters\/character_[0-9a-f]{24}\/current-state\.md$/u
              )
            },
            history: {
              path: expect.stringMatching(
                /^long\/characters\/character_[0-9a-f]{24}\/history\.md$/u
              )
            }
          }
        }],
        documentWrites: []
      },
      files: expect.arrayContaining([
        expect.objectContaining({
          document: "core_profile",
          operation: "create",
          beforeRevision: null
        }),
        expect.objectContaining({
          document: "relationships",
          operation: "create",
          beforeRevision: null
        })
      ])
    });
    expect(proposal.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("character_id=character_")
    });
    if (proposal.details?.kind !== "long-character-file-proposal") {
      throw new Error("Expected a character file proposal.");
    }
    const characterId = proposal.details.files[0]!.characterId;
    const write = await toolByName(tools, "write_character_file").execute(
      "write-created-character",
      {
        character_id: characterId,
        document: "core_profile",
        text: "沈砚是负责追查旧案的年轻捕快。"
      }
    );
    expect(write.details).toMatchObject({
      kind: "long-character-file-proposal",
      files: [{
        characterId,
        document: "core_profile",
        operation: "write",
        beforeText: "",
        afterText: "沈砚是负责追查旧案的年轻捕快。"
      }]
    });
  });

  it("requires a full character-document read before safe replacement", async () => {
    const index = fixtureIndex();
    const coreProfile = index.characterFiles[0]!.coreProfile;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type === "long.readDocument") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: coreProfile,
            content: "林岚害怕深水。",
            offset: command.payload.offset,
            totalCharacters: 7,
            nextOffset: null,
            workspaceRevision: index.revision,
            projectRevision: 11
          }
        };
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("character_design", "character_design"),
      profile: profile("character_design"),
      sessionId: "session-character-document",
      runId: "run-character-document",
      executor
    });

    const beforeRead = await toolByName(
      tools,
      "edit_character_file"
    ).execute("replace-before-read", {
      character_id: "character_alice",
      document: "core_profile",
      replacements: [{
        original_text: "害怕深水",
        new_text: "擅长潜水"
      }]
    });
    expect(beforeRead.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("请先调用 read_character")
    });

    await toolByName(tools, "read_character").execute(
      "read-character",
      {
        character_id: "character_alice",
        document: "core_profile",
        mode: "full"
      }
    );
    const proposal = await toolByName(
      tools,
      "edit_character_file"
    ).execute("replace-after-read", {
      character_id: "character_alice",
      document: "core_profile",
      replacements: [{
        original_text: "害怕深水",
        new_text: "擅长潜水"
      }]
    });
    expect(proposal.details).toMatchObject({
      kind: "long-character-file-proposal",
      batch: {
        operations: [],
        documentWrites: [{
          fileId: coreProfile.id,
          expectedRevision: coreProfile.revision,
          content: "林岚擅长潜水。"
        }]
      }
    });
  });

  it("keeps ledger-owned character continuity files out of direct character writes", async () => {
    const index = committedFixtureIndex();
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: {
        ...workspace("character_design", "character_design"),
        workspaceRevision: index.revision,
        navigation: createLongWorkspaceNavigationSnapshot(index)
      },
      profile: profile("character_design"),
      sessionId: "session-character-ledger-owned",
      runId: "run-character-ledger-owned",
      executor
    });

    await expect(
      toolByName(tools, "write_character_file").execute(
        "write-ledger-owned-state",
        {
          character_id: "character_alice",
          document: "current_state",
          text: "试图绕过连续性账本。"
        }
      )
    ).rejects.toThrow(/ledger-owned/u);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("pins a mutation proposal to the Core index revision instead of stale session metadata", async () => {
    const latest = fixtureIndex();
    latest.revision = 9;
    const executor = vi.fn<LongCommandExecutor>(async (command) => ({
      status: "accepted",
      requestId: command.id,
      payload: {
        bookId: latest.bookId,
        workspaceIndex: latest,
        projectRevision: 17
      }
    }));
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-latest-revision",
      runId: "run-latest-revision",
      executor
    });
    const proposal = await toolByName(
      tools,
      "propose_long_mutation"
    ).execute("latest-revision", {
      operations: [
        {
          type: "worldbuilding.update",
          id: "world_rules",
          patch: { title: "最新规则" }
        }
      ],
      summary: "基于最新索引"
    });

    expect(proposal.details).toMatchObject({
      kind: "long-mutation-proposal",
      baseProjectRevision: 17,
      batch: { baseRevision: 9 }
    });
  });

  it("creates character files and chapter triplets with runtime-owned ids and empty content revisions", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type !== "long.getWorkspaceIndex") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      return indexResult();
    });
    const characterTools = buildLongWorkspaceTools({
      workspace: workspace("character_design", "character_design"),
      profile: profile("character_design"),
      sessionId: "session-character-create",
      runId: "run-character-create",
      executor
    });
    const characterProposal = await toolByName(
      characterTools,
      "propose_long_mutation"
    ).execute("create-character", {
      operations: [
        {
          type: "character.create",
          name: "沈砚",
          group: "major_supporting",
          aliases: ["阿砚"]
        }
      ],
      summary: "创建人物"
    });
    expect(characterProposal.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "character.create",
            character: {
              id: expect.stringMatching(/^character_[0-9a-f]{24}$/u),
              name: "沈砚",
              group: "major_supporting",
              order: 1,
              aliases: ["阿砚"]
            },
            files: {
              coreProfile: {
                revision:
                  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              },
              relationships: {
                revision:
                  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              },
              currentState: {
                revision:
                  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              },
              history: {
                revision:
                  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              }
            }
          }
        ]
      }
    });

    const plotProfile = profile("plot_design");
    expect(plotProfile.writeAccess.workspaceRoots).toEqual([
      "plot_design"
    ]);
    const plotTools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: plotProfile,
      sessionId: "session-chapter-create",
      runId: "run-chapter-create",
      executor
    });
    const chapterProposal = await toolByName(
      plotTools,
      "propose_long_mutation"
    ).execute("create-chapter", {
      operations: [
        {
          type: "chapter.create",
          volumeId: "volume_one",
          primaryArcId: "arc_one",
          title: "第二章",
          characterIds: ["character_alice"]
        }
      ],
      summary: "创建章卡"
    });
    expect(chapterProposal.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "chapter.create",
            chapterCard: {
              id: expect.stringMatching(/^chapter_[0-9a-f]{24}$/u),
              volumeId: "volume_one",
              primaryArcId: "arc_one",
              narrativeOrder: 2,
              title: "第二章"
            },
            files: {
              body: {
                revision:
                  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              },
              characterState: {
                revision:
                  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              },
              handoff: {
                revision:
                  "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
              },
              commitId: null
            }
          }
        ],
        documentWrites: []
      }
    });
  });

  it("translates foreshadowing thread and beat planning fields while preserving legacy calls", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type !== "long.getWorkspaceIndex") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      return indexResult();
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-foreshadowing-planning",
      runId: "run-foreshadowing-planning",
      executor
    });
    const mutationTool = toolByName(tools, "propose_long_mutation");
    const parameterSchema = JSON.stringify(mutationTool.parameters);
    expect(parameterSchema).toContain('"hiddenTruth"');
    expect(parameterSchema).toContain('"plannedSpan"');
    expect(parameterSchema).toContain('"volumeId"');
    expect(parameterSchema).toContain('"arcId"');
    expect(parameterSchema).toContain("卷级计划锚点");
    expect(parameterSchema).toContain("剧情点计划锚点");
    expect(
      Check(mutationTool.parameters, {
        operations: [
          {
            type: "foreshadowing.create",
            client_ref: "legacy-thread",
            title: "旧式伏笔调用"
          },
          {
            type: "foreshadowingBeat.create",
            threadId: "ref:legacy-thread",
            beatType: "plant",
            plannedScope: "第一卷"
          }
        ],
        summary: "旧调用仍可使用"
      })
    ).toBe(true);

    const proposal = await mutationTool.execute(
      "foreshadowing-planning",
      {
        operations: [
          {
            type: "volume.create",
            client_ref: "second-volume",
            title: "第二卷"
          },
          {
            type: "arc.create",
            client_ref: "second-plot-point",
            volumeId: "ref:second-volume",
            title: "身份疑云"
          },
          {
            type: "foreshadowing.create",
            client_ref: "identity-thread",
            title: "失踪者身份",
            coreQuestion: "失踪者究竟是谁？",
            hiddenTruth: "失踪者一直以管家的身份留在宅邸。",
            plannedSpan: "within_volume"
          },
          {
            type: "foreshadowingBeat.create",
            client_ref: "identity-touch",
            threadId: "ref:identity-thread",
            beatType: "plant",
            volumeId: "ref:second-volume",
            arcId: "ref:second-plot-point",
            note: "先让旧照片露出半张侧脸。"
          },
          {
            type: "foreshadowing.update",
            id: "ref:identity-thread",
            patch: {
              hiddenTruth: "失踪者就是冒名顶替的现任管家。",
              plannedSpan: "cross_volume"
            }
          },
          {
            type: "foreshadowingBeat.update",
            id: "ref:identity-touch",
            patch: {
              volumeId: null,
              arcId: "ref:second-plot-point",
              note: "触点已细化到第一剧情点。"
            }
          }
        ],
        summary: "创建并细化伏笔线与触点"
      }
    );

    expect(proposal.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "volume.create",
            volume: {
              id: expect.stringMatching(/^volume_[0-9a-f]{24}$/u),
              title: "第二卷"
            }
          },
          {
            type: "arc.create",
            arc: {
              id: expect.stringMatching(/^arc_[0-9a-f]{24}$/u),
              volumeId: expect.stringMatching(/^volume_[0-9a-f]{24}$/u),
              title: "身份疑云"
            }
          },
          {
            type: "foreshadowing.create",
            thread: {
              id: expect.stringMatching(/^foreshadow_[0-9a-f]{24}$/u),
              title: "失踪者身份",
              coreQuestion: "失踪者究竟是谁？",
              hiddenTruth: "失踪者一直以管家的身份留在宅邸。",
              plannedSpan: "within_volume",
              beats: []
            }
          },
          {
            type: "foreshadowingBeat.create",
            threadId: expect.stringMatching(/^foreshadow_[0-9a-f]{24}$/u),
            beat: {
              id: expect.stringMatching(/^beat_[0-9a-f]{24}$/u),
              type: "plant",
              volumeId: expect.stringMatching(/^volume_[0-9a-f]{24}$/u),
              arcId: expect.stringMatching(/^arc_[0-9a-f]{24}$/u),
              note: "先让旧照片露出半张侧脸。"
            }
          },
          {
            type: "foreshadowing.update",
            id: expect.stringMatching(/^foreshadow_[0-9a-f]{24}$/u),
            patch: {
              hiddenTruth: "失踪者就是冒名顶替的现任管家。",
              plannedSpan: "cross_volume"
            }
          },
          {
            type: "foreshadowingBeat.update",
            id: expect.stringMatching(/^beat_[0-9a-f]{24}$/u),
            patch: {
              volumeId: null,
              arcId: expect.stringMatching(/^arc_[0-9a-f]{24}$/u),
              note: "触点已细化到第一剧情点。"
            }
          }
        ]
      }
    });
    if (proposal.details?.kind !== "long-mutation-proposal") {
      throw new Error("Expected a long mutation proposal.");
    }
    const operations = proposal.details.batch.operations;
    const createdVolume = operations[0];
    const createdArc = operations[1];
    const createdThread = operations[2];
    const createdBeat = operations[3];
    const updatedThread = operations[4];
    const updatedBeat = operations[5];
    if (
      createdVolume?.type !== "volume.create" ||
      createdArc?.type !== "arc.create" ||
      createdThread?.type !== "foreshadowing.create" ||
      createdBeat?.type !== "foreshadowingBeat.create" ||
      updatedThread?.type !== "foreshadowing.update" ||
      updatedBeat?.type !== "foreshadowingBeat.update"
    ) {
      throw new Error("Expected translated foreshadowing operations.");
    }
    expect(createdArc.arc.volumeId).toBe(createdVolume.volume.id);
    expect(createdBeat.threadId).toBe(createdThread.thread.id);
    expect(createdBeat.beat.volumeId).toBe(createdVolume.volume.id);
    expect(createdBeat.beat.arcId).toBe(createdArc.arc.id);
    expect(updatedThread.id).toBe(createdThread.thread.id);
    expect(updatedBeat.id).toBe(createdBeat.beat.id);
    expect(updatedBeat.patch.arcId).toBe(createdArc.arc.id);
  });

  it("computes document revisions from logical targets and rejects the generic draft-write bypass", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult();
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const index = fixtureIndex();
      const worldFile = fixtureWorldFile(index);
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: {
            ...worldFile,
            revision: "v1:2:77777777"
          },
          content: "旧",
          offset: 0,
          totalCharacters: 1,
          nextOffset: null,
          workspaceRevision: index.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-document-replace",
      runId: "run-document-replace",
      executor
    });
    const content = "潮汐规则只允许在月蚀时逆转。";
    const proposal = await toolByName(
      tools,
      "propose_long_mutation"
    ).execute("replace-world-document", {
      operations: [
        {
          type: "worldbuilding.update",
          id: "world_rules",
          patch: { title: "潮汐规则" }
        }
      ],
      document_updates: [
        {
          target: {
            kind: "worldbuilding",
            categoryId: "world_rules"
          },
          content,
          reason: "同步完整规则正文"
        }
      ],
      summary: "更新规则标题与正文"
    });
    const expectedHash = createHash("sha256")
      .update(content, "utf8")
      .digest("hex");
    expect(proposal.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        documentWrites: [
          {
            fileId: longWorldbuildingFileId("world_rules"),
            content,
            mode: "replace",
            expectedRevision: "v1:2:77777777",
            nextRevision: `v2:${Buffer.byteLength(content, "utf8")}:${expectedHash}`,
            reason: "同步完整规则正文"
          }
        ]
      }
    });

    const plotTools = buildLongWorkspaceTools({
      workspace: workspace("plot_design", "plot_design"),
      profile: profile("plot_design"),
      sessionId: "session-no-draft-bypass",
      runId: "run-no-draft-bypass",
      executor
    });
    expect(
      JSON.stringify(
        toolByName(plotTools, "propose_long_mutation").parameters
      )
    ).not.toContain('"kind":"draft"');
    await expect(
      toolByName(plotTools, "propose_long_mutation").execute(
        "draft-bypass",
        {
          operations: [
            {
              type: "chapter.update",
              id: "chapter_one",
              patch: { title: "第一章（修订章卡）" }
            }
          ],
          document_updates: [
            {
              target: {
                kind: "draft",
                chapterCardId: "chapter_one",
                role: "body"
              },
              content: "试图绕过三件套工具",
              reason: "越权"
            }
          ],
          summary: "越权"
        } as never
      )
    ).rejects.toThrow(/not valid generic mutation targets/u);
  });

  it("locks chapter writes to the active chapter and accepts body content only", async () => {
    const latest = fixtureIndex();
    latest.chapters[0]!.body.revision = "v1:4:11111111";
    latest.chapters[0]!.characterState.revision = "v1:5:22222222";
    latest.chapters[0]!.handoff.revision = "v1:6:33333333";
    const chapter = latest.chapters[0]!;
    const liveRevisions = new Map([
      [chapter.body.id, "v1:7:44444444"],
      [chapter.characterState.id, "v1:8:55555555"],
      [chapter.handoff.id, "v1:9:66666666"]
    ]);
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const requested = [
        chapter.body,
        chapter.characterState,
        chapter.handoff
      ].find(({ id }) => id === command.payload.fileId)!;
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: {
            ...requested,
            revision: liveRevisions.get(requested.id)!
          },
          content: "x",
          offset: 0,
          totalCharacters: 1,
          nextOffset: null,
          workspaceRevision: latest.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("expert_section_writer", "draft", "chapter_one"),
      profile: profile("expert_section_writer"),
      sessionId: "session-chapter",
      runId: "run-chapter",
      writeApprovalMode: "auto-approve",
      executor
    });
    const writeInput = {
      body: { content: "正文" },
      summary: "完成第一章"
    };
    const result = await toolByName(
      tools,
      "propose_long_chapter_write"
    ).execute("chapter-write", writeInput);

    expect(executor).toHaveBeenCalledTimes(4);
    expect(executor.mock.calls[0]?.[0].type).toBe("long.getWorkspaceIndex");
    expect(result.details).toMatchObject({
      kind: "long-chapter-write-proposal",
      bookId: "longbook_tools",
      input: {
        bookId: "longbook_tools",
        chapterCardId: "chapter_one",
        body: { content: "正文", baseRevision: "v1:7:44444444" },
        characterState: {
          content: "",
          baseRevision: "v1:8:55555555"
        },
        handoff: {
          content: "",
          baseRevision: "v1:9:66666666"
        },
        baseWorkspaceRevision: 7,
        baseProjectRevision: 11
      }
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("正文证据提案")
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("连续性入账时生成")
    });
    const tool = toolByName(tools, "propose_long_chapter_write");
    const parameters = JSON.stringify(tool.parameters);
    expect(parameters).not.toMatch(
      /bookId|book_id|chapter_card_id|character_state|handoff|path|revision/u
    );
    expect(Check(tool.parameters, writeInput)).toBe(true);
    expect(
      Check(tool.parameters, {
        body: { content: "正文", base_revision: REVISION },
        summary: "旧参数"
      })
    ).toBe(false);
    await expect(
      tool.execute("chapter-write-empty", {
        ...writeInput,
        body: { content: "   " }
      })
    ).rejects.toThrow(/non-empty body/u);
    await expect(
      tool.execute("chapter-write-empty-summary", {
        ...writeInput,
        summary: "   "
      })
    ).rejects.toThrow(/summary must contain non-whitespace text/u);
  });

  it("forms a complete v3 ledger proposal and rejects invalid continuity references", async () => {
    const latest = fixtureIndex();
    latest.characterFiles[0]!.currentState.revision = "v1:9:44444444";
    latest.characterFiles[0]!.history.revision = "v1:11:66666666";
    const chapter = latest.chapters[0]!;
    const liveRevisions = new Map([
      [chapter.body.id, "v1:4:11111111"],
      [chapter.characterState.id, "v1:5:22222222"],
      [chapter.handoff.id, "v1:6:33333333"],
      [
        latest.characterFiles[0]!.currentState.id,
        "v1:10:55555555"
      ],
      [
        latest.characterFiles[0]!.history.id,
        "v1:12:77777777"
      ]
    ]);
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const requested = [
        chapter.body,
        chapter.characterState,
        chapter.handoff,
        latest.characterFiles[0]!.currentState,
        latest.characterFiles[0]!.history
      ].find(({ id }) => id === command.payload.fileId)!;
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: {
            ...requested,
            revision: liveRevisions.get(requested.id)!
          },
          content: "x",
          offset: 0,
          totalCharacters: 1,
          nextOffset: null,
          workspaceRevision: latest.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("continuity_ledger", "continuity_ledger", "chapter_one"),
      profile: profile("continuity_ledger"),
      sessionId: "session-ledger",
      runId: "run-ledger",
      executor
    });
    const currentState = latest.characterFiles[0]!.currentState.id;
    const history = latest.characterFiles[0]!.history.id;
    const characterId = latest.characterFiles[0]!.characterId;
    const completeParameters = completeLedgerV3Parameters(characterId);
    const result = await toolByName(
      tools,
      "propose_long_ledger_commit"
    ).execute("ledger-commit", {
      ...completeParameters,
      placement_decisions: {},
      foreshadowing_beat_decisions: {},
      file_updates: [
        {
          character_id: characterId,
          document: "current_state",
          content: "第一章后的状态",
          mode: "replace"
        },
        {
          character_id: characterId,
          document: "history",
          content: "第一章：林岚抵达北门。",
          mode: "append"
        }
      ],
      chapter_summary: CHAPTER_SUMMARY,
      summary: "核对并提交第一章连续性"
    });

    expect(executor).toHaveBeenCalledTimes(6);
    expect(executor.mock.calls[0]?.[0].type).toBe("long.getWorkspaceIndex");
    expect(
      executor.mock.calls.slice(1).map(([command]) => command.type)
    ).toEqual([
      "long.readDocument",
      "long.readDocument",
      "long.readDocument",
      "long.readDocument",
      "long.readDocument"
    ]);
    expect(result.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      bookId: "longbook_tools",
      input: {
        bookId: "longbook_tools",
        chapterCardId: "chapter_one",
        chapterFileRevisions: {
          body: "v1:4:11111111",
          characterState: "v1:5:22222222",
          handoff: "v1:6:33333333"
        },
        fileUpdates: [
          {
            fileId: currentState,
            content: "第一章后的状态",
            baseRevision: "v1:10:55555555",
            mode: "replace"
          },
          {
            fileId: history,
            content: "第一章：林岚抵达北门。",
            baseRevision: "v1:12:77777777",
            mode: "append"
          }
        ],
        coverage: {
          character: completeParameters.coverage.character,
          plot: completeParameters.coverage.plot,
          foreshadowing: completeParameters.coverage.foreshadowing,
          world: completeParameters.coverage.world,
          knowledge: completeParameters.coverage.knowledge,
          openLoops: completeParameters.coverage.open_loops
        },
        factMutations: [
          {
            factId: CONTINUITY_FACT_ID,
            domain: "character",
            subjectId: characterId,
            field: "location",
            value: "北门",
            evidence: "正文写明林岚在日落前抵达北门。"
          }
        ],
        knowledgeMutations: [
          {
            factId: CONTINUITY_FACT_ID,
            audienceType: "reader",
            audienceId: null,
            level: "knows",
            evidence: "正文直接呈现林岚抵达北门。"
          }
        ],
        openLoopMutations: [
          {
            loopId: CONTINUITY_LOOP_ID,
            kind: "character",
            status: "open",
            detail: "林岚能否在追兵封锁前安全返回。",
            subjectId: characterId,
            factId: CONTINUITY_FACT_ID,
            evidence: "章末出现追兵封锁北门。"
          }
        ],
        chapterOutputs: {
          characterState: completeParameters.chapter_outputs.character_state,
          handoff: {
            summary: completeParameters.chapter_outputs.handoff.summary,
            mustCarry: completeParameters.chapter_outputs.handoff.must_carry,
            nextChapterConstraints:
              completeParameters.chapter_outputs.handoff.next_chapter_constraints,
            openLoops: completeParameters.chapter_outputs.handoff.open_loops
          }
        },
        baseWorkspaceRevision: 7,
        baseProjectRevision: 11,
        commitMessage: "核对并提交第一章连续性",
        chapterSummary: {
          timeline: CHAPTER_SUMMARY.timeline,
          characterStates: CHAPTER_SUMMARY.character_states,
          factionStates: CHAPTER_SUMMARY.faction_states,
          realmStates: CHAPTER_SUMMARY.realm_states,
          foreshadowingStates: CHAPTER_SUMMARY.foreshadowing_states,
          continuityNotes: CHAPTER_SUMMARY.continuity_notes
        }
      }
    });

    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-unknown-knowledge-fact",
        {
          ...emptyLedgerV3Parameters(),
          knowledge_mutations: [
            {
              fact_id: "fact_missing",
              audience_type: "reader",
              audience_id: null,
              level: "knows",
              evidence: "错误引用测试。"
            }
          ],
          chapter_summary: CHAPTER_SUMMARY,
          summary: "拒绝未知知识事实"
        }
      )
    ).rejects.toThrow(/existing or newly proposed continuity fact/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-unknown-handoff-loop",
        {
          ...emptyLedgerV3Parameters(),
          chapter_outputs: {
            character_state: "章末状态已核验。",
            handoff: {
              summary: "下一章接续。",
              must_carry: [],
              next_chapter_constraints: [],
              open_loops: ["loop_missing"]
            }
          },
          chapter_summary: CHAPTER_SUMMARY,
          summary: "拒绝未知开放环"
        }
      )
    ).rejects.toThrow(/handoff references must resolve/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-unknown-world-subject",
        {
          ...emptyLedgerV3Parameters(),
          fact_mutations: [
            {
              fact_id: "fact_missing_world_rule",
              domain: "world",
              subject_id: "world_missing",
              field: "rule",
              value: "不存在的世界规则。",
              evidence: "错误引用测试。"
            }
          ],
          chapter_summary: CHAPTER_SUMMARY,
          summary: "拒绝孤立世界事实"
        }
      )
    ).rejects.toThrow(/existing worldbuilding category/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-unmaterialized-relationship",
        {
          ...emptyLedgerV3Parameters(),
          fact_mutations: [
            {
              fact_id: "fact_alice_relationship",
              domain: "relationship",
              subject_id: characterId,
              field: "trust",
              value: "不再信任同伴。",
              evidence: "正文中林岚拒绝向同伴交出信物。"
            }
          ],
          chapter_summary: CHAPTER_SUMMARY,
          summary: "拒绝未映射的人物关系事实"
        }
      )
    ).rejects.toThrow(/both relationships and history/u);

    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute("ledger-bad", {
        ...emptyLedgerV3Parameters(),
        file_updates: [
          {
            character_id: characterId,
            document: "current_state",
            content: "错误追加",
            mode: "append"
          }
        ],
        chapter_summary: CHAPTER_SUMMARY,
        summary: "越权"
      })
    ).rejects.toThrow(/outside the agent's write roots/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-unknown-character",
        {
          ...emptyLedgerV3Parameters(),
          file_updates: [
            {
              character_id: "character_missing",
              document: "relationships",
              content: "未知人物",
              mode: "replace"
            }
          ],
          chapter_summary: CHAPTER_SUMMARY,
          summary: "未知人物"
        }
      )
    ).rejects.toThrow(/unknown character/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-empty-summary",
        {
          ...emptyLedgerV3Parameters(),
          chapter_summary: {
            ...CHAPTER_SUMMARY,
            continuity_notes: "   "
          },
          summary: "摘要缺失"
        }
      )
    ).rejects.toThrow(/all six non-empty/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-duplicate-update",
        {
          ...emptyLedgerV3Parameters(),
          file_updates: [
            {
              character_id: characterId,
              document: "current_state",
              content: "状态一",
              mode: "replace"
            },
            {
              character_id: characterId,
              document: "current_state",
              content: "状态二",
              mode: "replace"
            }
          ],
          chapter_summary: CHAPTER_SUMMARY,
          summary: "重复更新"
        }
      )
    ).rejects.toThrow(/same character document twice/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-empty-update",
        {
          ...emptyLedgerV3Parameters(),
          file_updates: [
            {
              character_id: characterId,
              document: "current_state",
              content: "   ",
              mode: "replace"
            }
          ],
          chapter_summary: CHAPTER_SUMMARY,
          summary: "空更新"
        }
      )
    ).rejects.toThrow(/non-empty content/u);
    await expect(
      toolByName(tools, "propose_long_ledger_commit").execute(
        "ledger-empty-proposal-summary",
        {
          ...emptyLedgerV3Parameters(),
          chapter_summary: CHAPTER_SUMMARY,
          summary: "   "
        }
      )
    ).rejects.toThrow(/summary must contain non-whitespace text/u);
    expect(
      executor.mock.calls.every(
        ([command]) =>
          command.type === "long.getWorkspaceIndex" ||
          command.type === "long.readDocument"
      )
    ).toBe(true);
    const tool = toolByName(tools, "propose_long_ledger_commit");
    expect(JSON.stringify(tool.parameters)).not.toMatch(/file_id|revision/u);
    const requiredV3Keys = [
      "coverage",
      "fact_mutations",
      "knowledge_mutations",
      "open_loop_mutations",
      "chapter_outputs"
    ] as const;
    for (const key of requiredV3Keys) {
      const missingRequired = structuredClone({
        ...emptyLedgerV3Parameters(),
        chapter_summary: CHAPTER_SUMMARY,
        summary: "缺少 v3 必填参数"
      }) as Record<string, unknown>;
      delete missingRequired[key];
      expect(Check(tool.parameters, missingRequired)).toBe(false);
    }
    expect(
      Check(tool.parameters, {
        ...emptyLedgerV3Parameters(),
        file_updates: [
          {
            character_id: characterId,
            document: "current_state",
            content: "有效参数",
            mode: "replace"
          }
        ],
        chapter_summary: CHAPTER_SUMMARY,
        summary: "有效参数"
      })
    ).toBe(true);
    expect(
      Check(tool.parameters, {
        ...emptyLedgerV3Parameters(),
        file_updates: [
          {
            character_id: characterId,
            document: "current_state",
            file_id: currentState,
            content: "旧参数",
            mode: "replace"
          }
        ],
        chapter_summary: CHAPTER_SUMMARY,
        summary: "旧参数"
      })
    ).toBe(false);
    expect(
      Check(tool.parameters, {
        ...emptyLedgerV3Parameters(),
        file_updates: [
          {
            character_id: characterId,
            document: "current_state",
            content: "旧参数",
            base_revision: REVISION,
            mode: "replace"
          }
        ],
        chapter_summary: CHAPTER_SUMMARY,
        summary: "旧参数"
      })
    ).toBe(false);
  });

  it("rejects chapter mutations against stale, mismatched, or committed workspace context", async () => {
    const writeInput = {
      body: { content: "正文" },
      summary: "完成第一章"
    };
    const staleWorkspace = workspace(
      "expert_section_writer",
      "draft",
      "chapter_one"
    );
    staleWorkspace.projectRevision = 10;
    const staleTools = buildLongWorkspaceTools({
      workspace: staleWorkspace,
      profile: profile("expert_section_writer"),
      sessionId: "session-stale-chapter",
      runId: "run-stale-chapter",
      executor: vi.fn<LongCommandExecutor>(async () => indexResult())
    });
    await expect(
      toolByName(staleTools, "propose_long_chapter_write").execute(
        "stale-chapter",
        writeInput
      )
    ).rejects.toThrow(/context no longer matches/u);

    const mismatchedWorkspace = workspace(
      "expert_section_writer",
      "draft",
      "chapter_one"
    );
    mismatchedWorkspace.navigation.chapterCards[0]!.title = "过期章名";
    const mismatchedTools = buildLongWorkspaceTools({
      workspace: mismatchedWorkspace,
      profile: profile("expert_section_writer"),
      sessionId: "session-mismatched-chapter",
      runId: "run-mismatched-chapter",
      executor: vi.fn<LongCommandExecutor>(async () => indexResult())
    });
    await expect(
      toolByName(mismatchedTools, "propose_long_chapter_write").execute(
        "mismatched-chapter",
        writeInput
      )
    ).rejects.toThrow(/active chapter no longer matches/u);

    const otherBookIndex = fixtureIndex();
    otherBookIndex.bookId = "longbook_other";
    const otherBookTools = buildLongWorkspaceTools({
      workspace: workspace(
        "expert_section_writer",
        "draft",
        "chapter_one"
      ),
      profile: profile("expert_section_writer"),
      sessionId: "session-other-book",
      runId: "run-other-book",
      executor: vi.fn<LongCommandExecutor>(async () =>
        indexResult(otherBookIndex)
      )
    });
    await expect(
      toolByName(otherBookTools, "propose_long_chapter_write").execute(
        "other-book",
        writeInput
      )
    ).rejects.toThrow(/another book/u);

    const committedIndex = committedFixtureIndex();
    const committedWorkspace = workspace(
      "continuity_ledger",
      "continuity_ledger",
      "chapter_one"
    );
    committedWorkspace.navigation =
      createLongWorkspaceNavigationSnapshot(committedIndex);
    const committedTools = buildLongWorkspaceTools({
      workspace: committedWorkspace,
      profile: profile("continuity_ledger"),
      sessionId: "session-committed-chapter",
      runId: "run-committed-chapter",
      executor: vi.fn<LongCommandExecutor>(async () =>
        indexResult(committedIndex)
      )
    });
    await expect(
      toolByName(committedTools, "propose_long_ledger_commit").execute(
        "committed-chapter",
        {
          ...emptyLedgerV3Parameters(),
          chapter_summary: CHAPTER_SUMMARY,
          summary: "重复提交"
        }
      )
    ).rejects.toThrow(/already committed/u);
  });

  it("maps proposal details to independent long runtime events", () => {
    const batch = {
      baseRevision: 7,
      updatedAt: NOW,
      operations: [
        {
          type: "worldbuilding.update" as const,
          id: "world_rules",
          patch: { title: "新规则" }
        }
      ],
      documentWrites: []
    };
    const details: LongAgentToolDetails = {
      kind: "long-mutation-proposal",
      bookId: "longbook_tools",
      agentId: "worldbuilding",
      batch,
      baseProjectRevision: 11,
      summary: "更新规则"
    };
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "tool-long",
        toolName: "propose_long_mutation",
        result: {
          content: [{ type: "text", text: "已形成提案" }],
          details
        },
        isError: false
      },
      {
        runId: "run-long",
        sessionId: "session-long",
        prompt: "更新规则"
      },
      {
        provider: "deepwrite",
        model: "test",
        mode: "local-faux"
      },
      "message-long"
    );

    expect(events.map((event) => event.type)).toEqual([
      "agent.tool_completed",
      "long.mutation_proposal"
    ]);
    expect(events[1]).toMatchObject({
      type: "long.mutation_proposal",
      payload: {
        toolCallId: "tool-long",
        bookId: "longbook_tools",
        batch,
        baseProjectRevision: 11
      }
    });
  });
});
