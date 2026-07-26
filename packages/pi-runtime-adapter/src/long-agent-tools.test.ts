import { describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  LONG_BOOK_LINE_FILE_ID,
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

    expect(worldNames).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "get_long_workspace_index",
      "read_long_document",
      "search_long_workspace",
      "propose_long_mutation"
    ]);
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
      "get_long_workspace_index",
      "read_long_document",
      "search_long_workspace",
      "get_long_chapter_readiness",
      "propose_long_mutation",
      "propose_long_chapter_dispatch"
    ]);
    expect([...worldNames, ...writerNames, ...ledgerNames]).not.toContain(
      "write_workspace_editor"
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

    index.ledger.commits.push({} as never, {} as never);
    expect(
      selectLongChaptersForWritingScope(index, { scope: "arc" }).map(
        ({ id }) => id
      )
    ).toEqual(["chapter_three"]);
  });

  it("reports partial chapter readiness with the exact missing triplet files", async () => {
    const index = fixtureIndex();
    const entry = index.chapters[0]!;
    const contentByFileId = new Map([
      [entry.body.id, "已有正文"],
      [entry.characterState.id, ""],
      [entry.handoff.id, "已有交接"]
    ]);
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") return indexResult();
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const requested = [
        entry.body,
        entry.characterState,
        entry.handoff
      ].find(({ id }) => id === command.payload.fileId)!;
      const content = contentByFileId.get(requested.id) ?? "";
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: requested,
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
      text: expect.stringContaining('"status": "partial"')
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('"character_state"')
    });
  });

  it("forms a dispatch proposal from one index query and stops cleanly when complete", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult();
      }
      if (command.type === "long.readDocument") {
        const index = fixtureIndex();
        const entry = index.chapters[0]!;
        const requested = [
          entry.body,
          entry.characterState,
          entry.handoff
        ].find(({ id }) => id === command.payload.fileId);
        if (!requested) throw new Error("Unexpected chapter file.");
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

    expect(executor).toHaveBeenCalledTimes(4);
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
          missingFiles: ["body", "character_state", "handoff"]
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
    const seenSignals: Array<AbortSignal | undefined> = [];
    const executor = vi.fn<LongCommandExecutor>(async (command, signal) => {
      seenSignals.push(signal);
      if (command.type === "long.getWorkspaceIndex") return indexResult();
      if (command.type === "long.readDocument") {
        const worldFile = fixtureIndex().worldbuilding[0]!.file;
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: "longbook_tools",
            file: worldFile,
            content: "世界规则正文",
            offset: 0,
            totalCharacters: 6,
            nextOffset: null,
            workspaceRevision: 7,
            projectRevision: 11
          }
        };
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: "longbook_tools",
          query: command.payload.query,
          scope: command.payload.scope,
          hits: [],
          nextCursor: null,
          workspaceRevision: 7,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("worldbuilding", "worldbuilding"),
      profile: profile("worldbuilding"),
      sessionId: "session-query",
      runId: "run-query",
      executor
    });
    const controller = new AbortController();
    const worldFileId = fixtureIndex().worldbuilding[0]!.file.id;
    await toolByName(tools, "read_long_document").execute(
      "read-world",
      { file_id: worldFileId },
      controller.signal
    );
    await toolByName(tools, "search_long_workspace").execute(
      "search-world",
      { query: "规则", scope: "worldbuilding" },
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
          command.payload.bookId === "longbook_tools" &&
          !("path" in command.payload)
      )
    ).toBe(true);
    expect(seenSignals.every((signal) => signal === controller.signal)).toBe(true);

    const draftFileId = fixtureIndex().chapters[0]!.body.id;
    await expect(
      toolByName(tools, "read_long_document").execute("read-draft", {
        file_id: draftFileId
      })
    ).rejects.toThrow(/outside this agent's read roots/u);
    await expect(
      toolByName(tools, "search_long_workspace").execute("search-draft", {
        query: "正文",
        scope: "draft"
      } as never)
    ).rejects.toThrow(/not authorized/u);

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      toolByName(tools, "search_long_workspace").execute(
        "search-aborted",
        { query: "规则", scope: "worldbuilding" },
        aborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executor).toHaveBeenCalledTimes(3);
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
    expect(parameterSchema).toContain('"character.create"');
    expect(parameterSchema).toContain('"chapter.create"');

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

  it("computes document revisions from logical targets and rejects the generic draft-write bypass", async () => {
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult();
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const index = fixtureIndex();
      const worldFile = index.worldbuilding[0]!.file;
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

  it("locks chapter writes to the active chapter and emits a three-file proposal only", async () => {
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
      executor
    });
    const writeInput = {
      body: { content: "正文" },
      character_state: { content: "人物状态" },
      handoff: { content: "下一章交接" },
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
          content: "人物状态",
          baseRevision: "v1:8:55555555"
        },
        handoff: {
          content: "下一章交接",
          baseRevision: "v1:9:66666666"
        },
        baseWorkspaceRevision: 7,
        baseProjectRevision: 11
      }
    });
    const tool = toolByName(tools, "propose_long_chapter_write");
    const parameters = JSON.stringify(tool.parameters);
    expect(parameters).not.toMatch(
      /bookId|book_id|chapter_card_id|path|revision/u
    );
    expect(Check(tool.parameters, writeInput)).toBe(true);
    expect(
      Check(tool.parameters, {
        body: { content: "正文", base_revision: REVISION },
        character_state: { content: "人物状态", base_revision: REVISION },
        handoff: { content: "下一章交接", base_revision: REVISION },
        summary: "旧参数"
      })
    ).toBe(false);
  });

  it("validates ledger file roots via a query and never sends a mutation command", async () => {
    const latest = fixtureIndex();
    latest.characterFiles[0]!.currentState.revision = "v1:9:44444444";
    const chapter = latest.chapters[0]!;
    const liveRevisions = new Map([
      [chapter.body.id, "v1:4:11111111"],
      [chapter.characterState.id, "v1:5:22222222"],
      [chapter.handoff.id, "v1:6:33333333"],
      [
        latest.characterFiles[0]!.currentState.id,
        "v1:10:55555555"
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
        latest.characterFiles[0]!.currentState
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
    const characterId = latest.characterFiles[0]!.characterId;
    const result = await toolByName(
      tools,
      "propose_long_ledger_commit"
    ).execute("ledger-commit", {
      placement_decisions: {},
      foreshadowing_beat_decisions: {},
      file_updates: [
        {
          character_id: characterId,
          document: "current_state",
          content: "第一章后的状态",
          mode: "replace"
        }
      ],
      chapter_summary: CHAPTER_SUMMARY,
      summary: "核对并提交第一章连续性"
    });

    expect(executor).toHaveBeenCalledTimes(5);
    expect(executor.mock.calls[0]?.[0].type).toBe("long.getWorkspaceIndex");
    expect(
      executor.mock.calls.slice(1).map(([command]) => command.type)
    ).toEqual([
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
          }
        ],
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
      toolByName(tools, "propose_long_ledger_commit").execute("ledger-bad", {
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
          chapter_summary: {
            ...CHAPTER_SUMMARY,
            continuity_notes: "   "
          },
          summary: "摘要缺失"
        }
      )
    ).rejects.toThrow(/all six non-empty/u);
    expect(
      executor.mock.calls.every(
        ([command]) =>
          command.type === "long.getWorkspaceIndex" ||
          command.type === "long.readDocument"
      )
    ).toBe(true);
    const tool = toolByName(tools, "propose_long_ledger_commit");
    expect(JSON.stringify(tool.parameters)).not.toMatch(/file_id|revision/u);
    expect(
      Check(tool.parameters, {
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
      character_state: { content: "人物状态" },
      handoff: { content: "下一章交接" },
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
