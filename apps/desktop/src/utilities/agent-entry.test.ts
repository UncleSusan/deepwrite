import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_PROFILES,
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  SystemEventEnvelopeSchema,
  createEnvelope,
  createExpertDraftDirectoryRevision,
  createShortWorkspaceContentRevision,
  type CommandResult,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type {
  AgentRunInput,
  AgentRuntimeEvent
} from "@deepwrite/pi-runtime-adapter";
import type {
  UtilityCommandHandlerContext,
  UtilityRuntimeOptions
} from "./runtime";

type AgentCommandHandler = NonNullable<UtilityRuntimeOptions["commandHandler"]>;

const captured = vi.hoisted(() => ({
  commandHandler: undefined as AgentCommandHandler | undefined,
  startInputs: [] as AgentRunInput[],
  runtimeEvents: [] as AgentRuntimeEvent[]
}));

vi.mock("./runtime", () => ({
  bootUtility: vi.fn(
    (
      _worker: string,
      options: { commandHandler?: AgentCommandHandler }
    ): void => {
      captured.commandHandler = options.commandHandler;
    }
  )
}));

vi.mock("@deepwrite/pi-runtime-adapter", () => ({
  PiAgentRuntimeAdapter: class {
    describe(): {
      provider: string;
      model: string;
      mode: "local-faux";
    } {
      return {
        provider: "deepwrite",
        model: "deepwrite-writing-faux",
        mode: "local-faux"
      };
    }

    async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
      captured.startInputs.push(input);
      for (const event of captured.runtimeEvents.splice(0)) {
        yield event;
      }
    }

    async testConnection(): Promise<never> {
      throw new Error("Not used by this test.");
    }
  }
}));

describe("Agent Utility prompt forwarding", () => {
  beforeEach(() => {
    captured.startInputs.length = 0;
    captured.runtimeEvents.length = 0;
  });

  it("forwards scriptAgentProfile from the command payload into streamPrompt", async () => {
    await import("./agent-entry");

    const scriptAgentProfile =
      DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES.find(
        (profile) => profile.id === "character_design"
      )!;
    const emptyRevision = createShortWorkspaceContentRevision("");
    const characterContent = "人物设定快照";
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-script-forwarding",
          message: "请检查人物设定",
          scriptAgentProfile,
          workspaceContext: {
            activeResource: {
              id: "script-1:character_design",
              domain: "creation",
              title: "人物设计",
              path: ["测试剧本", "人物设计"],
              source: "live-editor",
              content: characterContent
            },
            scriptWorkspace: {
              id: "script-1",
              title: "测试剧本",
              categories: ["悬疑"],
              activeStageId: "character_design",
              activeAgentId: "character_design",
              expertDraft: {
                id: "draft",
                title: "剧集",
                revision: createExpertDraftDirectoryRevision([
                  {
                    id: "episode-1",
                    title: "第一集",
                    wordCountRequirement: ""
                  }
                ]),
                sections: [
                  {
                    id: "episode-1",
                    title: "第一集",
                    wordCountRequirement: "",
                    body: {
                      documentId: "draft-section:episode-1:body",
                      title: "第一集",
                      content: "",
                      revision: emptyRevision
                    },
                    characterState: {
                      documentId:
                        "draft-section:episode-1:character-state",
                      title: "第一集 · 人物状态",
                      content: "",
                      revision: emptyRevision
                    }
                  }
                ]
              },
              stages: [
                {
                  stageId: "character_design",
                  title: "人物设计",
                  content: characterContent,
                  revision:
                    createShortWorkspaceContentRevision(characterContent)
                },
                {
                  stageId: "plot_design",
                  title: "剧情设计",
                  content: "",
                  revision: emptyRevision
                },
                {
                  stageId: "plot_refine",
                  title: "剧情细化",
                  content: "",
                  revision: emptyRevision
                },
                {
                  stageId: "outline",
                  title: "大纲",
                  content: "",
                  revision: emptyRevision
                }
              ]
            }
          }
        },
        {
          id: "command-script-forwarding",
          context: {
            correlationId: "correlation-script-forwarding",
            sessionId: "session-script-forwarding",
            resourceId: "script-1:character_design"
          }
        }
      )
    );
    const emittedEvents: SystemEventEnvelope[] = [];

    const handler = captured.commandHandler;
    expect(handler).toBeTypeOf("function");
    const result = (await handler!(
      command,
      (event) => emittedEvents.push(event)
    )) as CommandResult;

    expect(result).toMatchObject({
      status: "accepted",
      requestId: "command-script-forwarding",
      payload: {
        sessionId: "session-script-forwarding"
      }
    });
    await vi.waitFor(() => {
      expect(captured.startInputs).toHaveLength(1);
    });
    expect(captured.startInputs[0]).toMatchObject({
      sessionId: "session-script-forwarding",
      prompt: "请检查人物设定",
      scriptAgentProfile,
      workspaceContext: {
        scriptWorkspace: {
          id: "script-1",
          activeAgentId: "character_design"
        }
      }
    });
    expect(captured.startInputs[0]?.agentProfile).toBeUndefined();
    expect(emittedEvents).toEqual([]);
  });

  it("forwards the isolated longAgentProfile and navigation context", async () => {
    await import("./agent-entry");
    const longAgentProfile = DEFAULT_LONG_AGENT_PROFILES.find(
      (profile) => profile.id === "worldbuilding"
    )!;
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-long-forwarding",
          message: "检查世界规则",
          longAgentProfile,
          workspaceContext: {
            longWorkspace: {
              bookId: "longbook_forwarding",
              title: "长篇测试",
              activeRoot: "worldbuilding",
              activeAgentId: "worldbuilding",
              workspaceRevision: 0,
              projectRevision: 0,
              navigation: {
                schemaVersion: 1,
                revision: 0,
                bookId: "longbook_forwarding",
                updatedAt: "2026-07-26T10:00:00.000Z",
                counts: {
                  worldbuildingCategories: 0,
                  characters: 0,
                  volumes: 1,
                  arcs: 0,
                  chapterCards: 0,
                  storyEvents: 0,
                  foreshadowingThreads: 0,
                  committedChapters: 0
                },
                worldbuilding: [],
                characters: [],
                volumes: [
                  { id: "volume_default", title: "第一卷", order: 1 }
                ],
                arcs: [],
                chapterCards: [],
                committedThroughChapterId: null
              }
            }
          }
        },
        {
          id: "command-long-forwarding",
          context: {
            correlationId: "correlation-long-forwarding",
            sessionId: "session-long-forwarding"
          }
        }
      )
    );

    const requestInternalCommand = vi.fn<
      UtilityCommandHandlerContext["requestInternalCommand"]
    >(async (_target, internalCommand) => ({
      status: "accepted",
      requestId: internalCommand.id,
      payload: { forwarded: true }
    }));
    const utilityContext: UtilityCommandHandlerContext = {
      worker: "agent",
      requestId: command.id,
      requestInternalCommand
    };
    const result = await captured.commandHandler!(
      command,
      () => undefined,
      utilityContext
    );
    expect(result.status).toBe("accepted");
    await vi.waitFor(() => expect(captured.startInputs).toHaveLength(1));
    expect(captured.startInputs[0]).toMatchObject({
      longAgentProfile: { id: "worldbuilding" },
      workspaceContext: {
        longWorkspace: {
          bookId: "longbook_forwarding",
          activeRoot: "worldbuilding"
        }
      }
    });
    expect(captured.startInputs[0]?.agentProfile).toBeUndefined();
    expect(captured.startInputs[0]?.scriptAgentProfile).toBeUndefined();
    expect(captured.startInputs[0]?.longCommandExecutor).toBeTypeOf("function");

    const queryCommand = LongGetWorkspaceIndexCommandEnvelopeSchema.parse(
      createEnvelope(
        "long.getWorkspaceIndex",
        { bookId: "longbook_forwarding" },
        {
          id: "query-long-forwarding",
          context: {
            correlationId: "correlation-long-forwarding",
            sessionId: "session-long-forwarding",
            runId: "run-long-forwarding",
            resourceId: "longbook_forwarding"
          }
        }
      )
    );
    const querySignal = new AbortController();
    await expect(
      captured.startInputs[0]!.longCommandExecutor!(
        queryCommand,
        querySignal.signal
      )
    ).resolves.toMatchObject({
      status: "accepted",
      requestId: "query-long-forwarding"
    });
    expect(requestInternalCommand).toHaveBeenCalledWith(
      "core",
      queryCommand,
      { timeoutMs: 60_000 }
    );

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      captured.startInputs[0]!.longCommandExecutor!(
        queryCommand,
        aborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requestInternalCommand).toHaveBeenCalledTimes(1);
  });

  it("maps all long proposal runtime events to validated system envelopes", async () => {
    await import("./agent-entry");
    const eventBase = {
      runId: "run-long-proposals",
      sessionId: "session-long-proposals"
    };
    const payloadBase = {
      toolCallId: "tool-long-proposal",
      bookId: "longbook_proposals",
      summary: "等待审阅。",
      runtime: {
        provider: "deepwrite",
        model: "proposal-test",
        mode: "local-faux" as const
      }
    };
    captured.runtimeEvents.push(
      {
        ...eventBase,
        type: "long.mutation_proposal",
        payload: {
          ...payloadBase,
          agentId: "worldbuilding",
          batch: {
            baseRevision: 2,
            updatedAt: "2026-07-26T12:00:00.000Z",
            operations: [
              {
                type: "worldbuilding.update",
                id: "world_rules",
                patch: { title: "硬规则" }
              }
            ],
            documentWrites: []
          },
          baseProjectRevision: 3
        }
      },
      {
        ...eventBase,
        type: "long.chapter_dispatch_proposal",
        payload: {
          ...payloadBase,
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
          workspaceRevision: 2,
          projectRevision: 3
        }
      },
      {
        ...eventBase,
        type: "long.chapter_write_proposal",
        payload: {
          ...payloadBase,
          agentId: "expert_section_writer",
          input: {
            bookId: "longbook_proposals",
            chapterCardId: "chapter_one",
            body: { content: "正文", baseRevision: "v1:0:00000000" },
            characterState: {
              content: "人物状态",
              baseRevision: "v1:0:00000000"
            },
            handoff: {
              content: "下一章交接",
              baseRevision: "v1:0:00000000"
            },
            baseWorkspaceRevision: 2,
            baseProjectRevision: 3
          }
        }
      },
      {
        ...eventBase,
        type: "long.ledger_commit_proposal",
        payload: {
          ...payloadBase,
          agentId: "continuity_ledger",
          input: {
            bookId: "longbook_proposals",
            chapterCardId: "chapter_one",
            chapterFileRevisions: {
              body: "v1:0:00000000",
              characterState: "v1:0:00000000",
              handoff: "v1:0:00000000"
            },
            commitMessage: "提交第一章连续性",
            chapterSummary: {
              timeline: "第一天。",
              characterStates: "人物状态已核对。",
              factionStates: "势力状态无变化。",
              realmStates: "境界状态无变化。",
              foreshadowingStates: "伏笔状态已核对。",
              continuityNotes: "下一章继续。"
            },
            placementDecisions: {},
            foreshadowingBeatDecisions: {},
            fileUpdates: [],
            baseWorkspaceRevision: 2,
            baseProjectRevision: 3
          }
        }
      }
    );
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId: "session-long-proposals",
          message: "生成三类长篇提案"
        },
        {
          id: "command-long-proposals",
          context: {
            correlationId: "correlation-long-proposals",
            sessionId: "session-long-proposals"
          }
        }
      )
    );
    const emitted: SystemEventEnvelope[] = [];

    await expect(
      captured.commandHandler!(command, (event) => emitted.push(event))
    ).resolves.toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(emitted).toHaveLength(4));

    expect(
      emitted.map((event) => SystemEventEnvelopeSchema.parse(event).type)
    ).toEqual([
      "long.mutation_proposal",
      "long.chapter_dispatch_proposal",
      "long.chapter_write_proposal",
      "long.ledger_commit_proposal"
    ]);
    expect(emitted[0]).toMatchObject({
      type: "long.mutation_proposal",
      payload: {
        sessionId: "session-long-proposals",
        runId: "run-long-proposals",
        bookId: "longbook_proposals",
        baseProjectRevision: 3
      }
    });
  });
});
