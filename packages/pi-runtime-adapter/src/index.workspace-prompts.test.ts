import type {
  AgentTool,
  LongWorkspaceRuntimeContext,
  ScriptWorkspaceSnapshot,
  ShortWorkspaceSnapshot
} from "./index.test-support";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  PiAgentRuntimeAdapter,
  SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS,
  buildEffectiveSystemPrompt,
  buildRuntimeUserPrompt,
  createShortWorkspaceContentRevision,
  describe,
  expect,
  it,
  normalChatContext,
  screenplayWorkspace,
  scriptAgentProfile
} from "./index.test-support";

describe("DeepWrite Pi runtime adapter: workspace-prompts", () => {
  it("isolates chat-assistant prompts, tools and cached history from workspace agents", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const sessionId = "session_shared_chat_boundary";

    for (const [runId, prompt] of [
      ["run_chat_1", "你好，只聊聊天"],
      ["run_chat_2", "继续刚才的话题"]
    ] as const) {
      for await (const _event of runtime.start({
        runId,
        sessionId,
        prompt,
        mode: "chat-assistant",
        chatAssistantRuntimeContext: normalChatContext(),
        thinkingLevel: "off"
      })) {
        // Consume the isolated chat turn before inspecting the cache.
      }
    }

    for await (const _event of runtime.start({
      runId: "run_workspace_same_session",
      sessionId,
      prompt: "分析当前内容",
      thinkingLevel: "off",
      workspaceContext: {
        activeResource: {
          id: "workspace_resource",
          domain: "creation",
          title: "工作区文稿",
          path: ["工作区文稿"],
          source: "live-editor",
          content: "这段内容不能进入聊天助手。"
        }
      }
    })) {
      // Consume a workspace turn with the same session id.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          {
            state: {
              systemPrompt: string;
              tools: Array<{ name: string }>;
              messages: Array<{ role?: string; content?: unknown }>;
            };
          }
        >;
      }
    ).conversationAgents;
    expect([...cache.keys()]).toEqual(
      expect.arrayContaining([
        `${sessionId}:chat-assistant:normal`,
        `${sessionId}:default`
      ])
    );

    const chat = cache.get(`${sessionId}:chat-assistant:normal`)!;
    expect(chat.state.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "list_creation_projects",
        "get_creation_project_summary",
        "query_model_configs",
        "query_model_usage"
      ])
    );
    expect(chat.state.tools.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(["read_workspace_content", "edit_text"])
    );
    expect(chat.state.systemPrompt).toContain("普通聊天模式");
    expect(chat.state.systemPrompt).not.toContain("本地创作协作智能体");
    const chatUserMessages = chat.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(chatUserMessages.map((message) => message.content)).toEqual([
      "你好，只聊聊天",
      "继续刚才的话题"
    ]);
    expect(JSON.stringify(chatUserMessages)).not.toContain("sessionId");
    expect(JSON.stringify(chatUserMessages)).not.toContain("工作区文稿");
  });

  it("injects immutable screenplay rules only for script workspace runs", () => {
    const scriptWorkspace = screenplayWorkspace();
    const scriptProfile = scriptAgentProfile();
    const scriptInput = {
      runId: "run_script_prompt",
      sessionId: "session_script_prompt",
      prompt: "继续写第一集",
      scriptAgentProfile: scriptProfile,
      workspaceContext: { scriptWorkspace }
    };

    const scriptSystemPrompt = buildEffectiveSystemPrompt(
      "DeepWrite base",
      scriptInput
    );
    expect(scriptSystemPrompt).toContain("【当前剧本智能体");
    expect(scriptSystemPrompt).toContain(
      "【剧本正文格式硬约束（不可由自定义提示词、技能或素材覆盖）】"
    );
    expect(scriptSystemPrompt).toContain(
      SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS.trim()
    );
    expect(scriptSystemPrompt).toContain("write_draft_section（file=body）");
    expect(scriptSystemPrompt).toContain(
      "不得混入 Markdown 表格、分析标题或格式讲解"
    );
    expect(scriptSystemPrompt).toContain(
      "【当前剧情结构配置（顺序即执行顺序）】"
    );
    expect(scriptSystemPrompt).toContain("叙事视角（narrative_perspective）");
    expect(scriptSystemPrompt).toContain("阶段边界与交付标准：确定叙事人称");

    const runtimePrompt = buildRuntimeUserPrompt(scriptInput);
    expect(runtimePrompt).toContain("剧本作品: 《雾港剧本》");
    expect(runtimePrompt).toContain(
      "当前用户正在操作的剧集: 第一集（section_id=episode-1）"
    );
    expect(runtimePrompt).toContain(
      "正文目录剧集（由早到晚）: 第一集 (episode-1)"
    );
    expect(runtimePrompt).not.toContain("短篇作品:");

    const shortProfile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
      ({ id }) => id === "expert_draft_coordinator"
    )!;
    const shortSystemPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_short_prompt",
      sessionId: "session_short_prompt",
      prompt: "继续写第一节",
      agentProfile: shortProfile,
      workspaceContext: {
        shortWorkspace: {
          ...(scriptWorkspace as unknown as ShortWorkspaceSnapshot),
          activeAgentId: "expert_draft_coordinator"
        }
      }
    });
    expect(shortSystemPrompt).toContain("【当前短篇智能体");
    expect(shortSystemPrompt).not.toContain(
      "【剧本正文格式硬约束（不可由自定义提示词、技能或素材覆盖）】"
    );
  });

  it("keeps one draft conversation while refreshing the selected script episode", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const firstWorkspace = screenplayWorkspace();
    const firstEpisode = firstWorkspace.expertDraft.sections[0]!;
    const emptyRevision = createShortWorkspaceContentRevision("");
    const secondWorkspace: ScriptWorkspaceSnapshot = {
      ...firstWorkspace,
      activeSectionId: "episode-2",
      expertDraft: {
        ...firstWorkspace.expertDraft,
        revision: createShortWorkspaceContentRevision("episode-1\nepisode-2"),
        sections: [
          firstEpisode,
          {
            id: "episode-2",
            title: "第二集",
            wordCountRequirement: "15 分钟",
            body: {
              documentId: "draft:episode-2:body",
              title: "第二集",
              content: "",
              revision: emptyRevision
            },
            characterState: {
              documentId: "draft:episode-2:state",
              title: "第二集 · 人物状态",
              content: "",
              revision: emptyRevision
            }
          }
        ]
      }
    };
    const profile = scriptAgentProfile();
    const sessionId = "session_script_shared_draft";

    for await (const _event of runtime.start({
      runId: "run_script_episode_1",
      sessionId,
      prompt: "先写第一集",
      thinkingLevel: "off",
      scriptAgentProfile: profile,
      workspaceContext: { scriptWorkspace: firstWorkspace }
    })) {
      // Consume the first turn before changing the UI focus.
    }
    for await (const _event of runtime.start({
      runId: "run_script_episode_2",
      sessionId,
      prompt: "再写第二集",
      thinkingLevel: "off",
      scriptAgentProfile: profile,
      workspaceContext: { scriptWorkspace: secondWorkspace }
    })) {
      // Consume the follow-up turn so the same cached agent is refreshed.
    }

    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          {
            state: {
              systemPrompt: string;
              messages: Array<{ role?: string; content?: unknown }>;
              tools: AgentTool[];
            };
          }
        >;
      }
    ).conversationAgents;
    expect(cache).toHaveLength(1);
    const agent = cache.get(`${sessionId}:script:expert_draft_coordinator`);
    expect(
      agent?.state.messages.filter((message) => message.role === "user")
    ).toHaveLength(2);
    expect(agent?.state.systemPrompt).toContain(
      "【当前用户正在操作的剧集】\n标题：第二集"
    );
    expect(agent?.state.systemPrompt).not.toContain(
      "【当前用户正在操作的剧集】\n标题：第一集"
    );

    const write = agent?.state.tools.find(
      (candidate) => candidate.name === "write_draft_section"
    );
    if (!write) throw new Error("Missing refreshed draft write tool.");
    const result = await write.execute("write-focused-episode", {
      text: "第二集正式正文。"
    });
    expect(result.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      documentId: "draft:episode-2:body",
      sectionId: "episode-2",
      fileKind: "body"
    });
  });

  it("reminds draft agents to read character items in list mode", () => {
    const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
      ({ id }) => id === "expert_draft_coordinator"
    )!;
    const shortWorkspace = {
      ...(screenplayWorkspace() as unknown as ShortWorkspaceSnapshot),
      activeAgentId: "expert_draft_coordinator" as const,
      characterStructure: {
        format: "list" as const,
        items: [
          {
            id: "character-linmo",
            title: "林默",
            order: 1,
            content: "雾港巡夜人。",
            revision: createShortWorkspaceContentRevision("雾港巡夜人。")
          }
        ]
      }
    };
    const systemPrompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_draft_character_list",
      sessionId: "session_draft_character_list",
      prompt: "写当前章节",
      agentProfile: profile,
      workspaceContext: { shortWorkspace }
    });

    expect(systemPrompt).toContain("当前人物结构为条目样式");
    expect(systemPrompt).toContain("read_character（指定 item_id）");
    expect(systemPrompt).toContain("不得只读概览");
    expect(systemPrompt).toContain("list_characters");
  });

  it("describes realtime serialized persistence for auto-approved long proposals", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "plot_design"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_prompt",
      title: "雾港长篇",
      activeRoot: "plot_design",
      activeAgentId: profile.id,
      workspaceRevision: 3,
      projectRevision: 5,
      navigation: {
        schemaVersion: 1,
        revision: 3,
        bookId: "longbook_prompt",
        updatedAt: "2026-07-26T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const prompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_long_prompt",
      sessionId: "session_long_prompt",
      prompt: "调整结构",
      writeApprovalMode: "auto-approve",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(prompt).toContain("立即加入按书籍串行的后台队列");
    expect(prompt).toContain("影响预览");
    expect(prompt).toContain("自动完成");
    expect(prompt).not.toContain("本轮完成后");
  });

  it("keeps the long chapter-writer runtime boundary limited to novel body", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "draft"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_writer_prompt",
      title: "雾港长篇",
      activeRoot: "draft",
      activeAgentId: profile.id,
      activeChapterCardId: "chapter_writer_prompt",
      workspaceRevision: 3,
      projectRevision: 5,
      navigation: {
        schemaVersion: 1,
        revision: 3,
        bookId: "longbook_writer_prompt",
        updatedAt: "2026-08-02T10:00:00.000Z",
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
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_writer_prompt", title: "第一卷", order: 1 }],
        arcs: [
          {
            id: "arc_writer_prompt",
            volumeId: "volume_writer_prompt",
            title: "主线",
            order: 1
          }
        ],
        chapterCards: [
          {
            id: "chapter_writer_prompt",
            volumeId: "volume_writer_prompt",
            primaryArcId: "arc_writer_prompt",
            title: "第一章",
            narrativeOrder: 1,
            bodyStatus: "empty"
          }
        ],
        committedThroughChapterId: null
      }
    };

    const prompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_writer_prompt",
      sessionId: "session_writer_prompt",
      prompt: "写第一章",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(prompt).toContain("只允许为上下文锁定的当前章形成小说正文提案");
    expect(prompt).toContain("不得生成或修改人物状态、handoff、接续包");
    expect(prompt).toContain(
      "世界观、人物目录与长篇结构导航已写入本轮固定上下文"
    );
    expect(prompt).not.toContain("按稳定实体 ID 和 fileId 查询");
    expect(prompt).not.toContain("必须同时形成正文、人物状态和 handoff");
  });

  it("lets the continuity ledger write any unrecorded chapter and catch up in one pass", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "continuity_ledger"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_ledger_prompt",
      title: "雾港长篇",
      activeRoot: "continuity_ledger",
      activeAgentId: profile.id,
      workspaceRevision: 3,
      projectRevision: 5,
      navigation: {
        schemaVersion: 1,
        revision: 3,
        bookId: "longbook_ledger_prompt",
        updatedAt: "2026-08-16T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_ledger_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };

    const prompt = buildEffectiveSystemPrompt("DeepWrite base", {
      runId: "run_ledger_prompt",
      sessionId: "session_ledger_prompt",
      prompt: "批量提交所有未提交章节",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(prompt).toContain("可对任意已有正文、尚未记录的章卡写入");
    expect(prompt).toContain("未选中章卡时必须带 chapter_card_id");
    expect(prompt).toContain("pending_catchup");
    expect(prompt).toContain("前文 brief 只写简短章末状态与接续包");
    expect(prompt).toContain("最后一张 full 写完整账本");
    expect(prompt).toContain("批量提交所有未提交章节");
  });

  it("keeps worldbuilding prompts on business ids and hides file controls", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "setting"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_world_prompt",
      title: "雾港长篇",
      activeRoot: "worldbuilding",
      activeAgentId: profile.id,
      activeFileId: "file_world_rules:content",
      activeFileRevision: "v1:0:00000000",
      workspaceRevision: 3,
      projectRevision: 5,
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          },
          {
            categoryId: "world_factions",
            title: "势力",
            order: 2,
            format: "list",
            itemCount: 2,
            items: [
              {
                itemId: "worlditem_watchers",
                title: "守夜人",
                order: 1
              },
              {
                itemId: "worlditem_harbor",
                title: "港务会",
                order: 2
              }
            ],
            omittedItemCount: 0
          }
        ],
        omittedCategoryCount: 0
      },
      worldbuildingFocus: {
        categoryTitle: "世界规则",
        format: "text",
        currentStage: {
          kind: "text",
          title: "世界规则",
          text: { content: "雾潮期间禁止点燃蓝焰。" }
        }
      },
      navigation: {
        schemaVersion: 1,
        revision: 3,
        bookId: "longbook_world_prompt",
        updatedAt: "2026-07-26T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 1,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [
          {
            id: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          }
        ],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_world_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const input = {
      runId: "run_world_prompt",
      sessionId: "session_world_prompt",
      prompt: "核对世界规则",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    };

    const systemPrompt = buildEffectiveSystemPrompt("DeepWrite base", input);
    expect(systemPrompt).toContain("category_id");
    expect(systemPrompt).toContain("item_id");
    expect(systemPrompt).toContain("list_setting");
    expect(systemPrompt).not.toContain("fileId");
    expect(systemPrompt).not.toContain("file_id");
    expect(systemPrompt).not.toContain("bookId");
    expect(systemPrompt).not.toContain(" / worldbuilding");
    expect(systemPrompt).toContain("长篇结构导航已写入固定上下文");
    expect(systemPrompt).toContain("不得修改剧情结构");

    const userPrompt = buildRuntimeUserPrompt(input);
    expect(userPrompt).toContain("长篇作品: 《雾港长篇》");
    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
    );
    expect(userPrompt).toContain("【当前阶段信息与要求】");
    expect(userPrompt.indexOf("【世界观条目列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf("【人物设计列表（发送时快照）】")
    );
    expect(userPrompt.indexOf("【人物设计列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
      )
    );
    expect(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
      )
    ).toBeLessThan(userPrompt.indexOf("【当前阶段信息与要求】"));
    expect(userPrompt).toContain(
      "全书共 1 卷、0 个剧情点、0 张章卡、0 条故事情节、0 个故事事件、0 条伏笔线"
    );
    expect(userPrompt).toContain(
      "- 第 1 卷「第一卷」(volume_world_prompt): 暂无剧情点"
    );
    expect(userPrompt).not.toContain("当前剧情工作区");
    expect(userPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(userPrompt).toContain(
      "势力（category_id=world_factions；类型=条目列表；共 2 项）"
    );
    expect(userPrompt).toContain(
      "守夜人（item_id=worlditem_watchers；顺序=1）"
    );
    expect(userPrompt).toContain("主角（type_id=protagonist；共 0 人）");
    expect(userPrompt).toContain("当前智能体: 设定智能体");
    expect(userPrompt).toContain(
      "当前用户所处的世界观阶段: 文本型分类「世界规则」（category_id=world_rules）"
    );
    expect(userPrompt).toContain(
      "当前阶段简要信息: 仅定位当前页面，正文未注入；需要时调用 read_setting（domain=worldbuilding, category_id=world_rules）读取。"
    );
    expect(userPrompt).not.toContain("雾潮期间禁止点燃蓝焰。");
    expect(userPrompt).not.toContain("当前阶段信息:");
    expect(userPrompt).not.toContain("当前分类概览");
    expect(userPrompt).not.toContain("另一侧人物");
    expect(userPrompt).not.toContain("当前根节点:");
    expect(userPrompt).not.toContain("(worldbuilding)");
    expect(userPrompt).not.toContain("longbook_world_prompt");
    expect(userPrompt).not.toContain("file_world_rules:content");
    expect(userPrompt).not.toContain("v1:0:00000000");
    expect(userPrompt).not.toContain("session_world_prompt");
    expect(userPrompt).not.toContain("run_world_prompt");

    const listPrompt = buildRuntimeUserPrompt({
      ...input,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          worldbuildingFocus: {
            categoryTitle: "势力",
            format: "list",
            currentStage: {
              kind: "item",
              title: "守夜人",
              text: { content: "守夜人负责执行宵禁。" }
            },
            overview: { content: "各势力争夺港务权。" }
          }
        }
      }
    });
    expect(listPrompt).toContain(
      "当前用户所处的世界观阶段: 列表型分类「势力」 / 条目「守夜人」（category_id=world_factions；item_id=worlditem_watchers）"
    );
    expect(listPrompt).toContain(
      "当前阶段简要信息: 仅定位当前页面，正文未注入；需要时调用 read_setting（domain=worldbuilding, category_id=world_factions, item_id=worlditem_watchers）读取。"
    );
    expect(listPrompt).not.toContain("守夜人负责执行宵禁。");
    expect(listPrompt).not.toContain("各势力争夺港务权。");
    expect(listPrompt).not.toContain("当前分类概览");
  });

  it("keeps character prompts on business ids and injects a brief focused stage", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "setting"
    )!;
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_character_prompt",
      title: "雾港长篇",
      activeRoot: "character_design",
      activeAgentId: profile.id,
      activeFileId: "file_character_lan:relationships",
      activeFileRevision: "v1:0:00000000",
      workspaceRevision: 3,
      projectRevision: 5,
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          }
        ],
        omittedCategoryCount: 0
      },
      characterFocus: {
        characterName: "林岚",
        group: "chartype_viewpoint",
        currentDocument: {
          kind: "relationships",
          title: "人物关系",
          text: { content: "与沈砚暂时合作。" }
        },
        coreProfile: { content: "雾港巡夜人，害怕深水。" }
      },
      navigation: {
        schemaVersion: 1,
        revision: 3,
        bookId: "longbook_character_prompt",
        updatedAt: "2026-07-26T10:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 1,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [
          { id: "chartype_viewpoint", title: "视角人物", order: 1 }
        ],
        characters: [
          {
            id: "character_lan",
            name: "林岚",
            group: "chartype_viewpoint",
            order: 1
          }
        ],
        volumes: [{ id: "volume_character_prompt", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const input = {
      runId: "run_character_prompt",
      sessionId: "session_character_prompt",
      prompt: "完善人物关系",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    };

    const systemPrompt = buildEffectiveSystemPrompt("DeepWrite base", input);
    expect(systemPrompt).toContain("list_setting");
    expect(systemPrompt).toContain("read_setting");
    expect(systemPrompt).not.toContain("fileId");
    expect(systemPrompt).not.toContain("file_id");
    expect(systemPrompt).not.toContain("bookId");

    const userPrompt = buildRuntimeUserPrompt(input);
    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
    );
    expect(userPrompt).toContain("【当前阶段信息与要求】");
    expect(userPrompt.indexOf("【人物设计列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
      )
    );
    expect(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
      )
    ).toBeLessThan(userPrompt.indexOf("【当前阶段信息与要求】"));
    expect(userPrompt).toContain(
      "全书共 1 卷、0 个剧情点、0 张章卡、0 条故事情节、0 个故事事件、0 条伏笔线"
    );
    expect(userPrompt).not.toContain("当前剧情工作区");
    expect(userPrompt).toContain(
      "视角人物（type_id=chartype_viewpoint；共 1 人）"
    );
    expect(userPrompt).toContain("林岚（character_id=character_lan；顺序=1）");
    expect(userPrompt).toContain(
      "当前用户所处的人物阶段: 「林岚」 / 人物关系（character_id=character_lan；document=relationships；type_id=chartype_viewpoint）"
    );
    expect(userPrompt).toContain(
      "当前阶段简要信息: 仅定位当前人物文档，正文未注入；需要时调用 read_setting（domain=character, character_id=character_lan, document=relationships）读取。"
    );
    expect(userPrompt).not.toContain("与沈砚暂时合作。");
    expect(userPrompt).not.toContain("雾港巡夜人，害怕深水。");
    expect(userPrompt).not.toContain("人物核心档案:");
    expect(userPrompt).not.toContain("【人物类型目录");
    expect(userPrompt).not.toContain("另一侧世界观");
    expect(userPrompt).not.toContain("当前根节点:");
    expect(userPrompt).not.toContain("longbook_character_prompt");
    expect(userPrompt).not.toContain("file_character_lan:relationships");
    expect(userPrompt).not.toContain("session_character_prompt");
    expect(userPrompt).not.toContain("run_character_prompt");
  });

  it("caps the setting-agent character directory at 50 people per type", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "setting"
    )!;
    const extras = Array.from({ length: 52 }, (_, index) => ({
      id: `character_extra_${String(index + 1).padStart(2, "0")}`,
      name: `配角${index + 1}`,
      group: "supporting",
      order: index + 1
    }));
    const userPrompt = buildRuntimeUserPrompt({
      runId: "run_character_directory_cap",
      sessionId: "session_character_directory_cap",
      prompt: "补充配角",
      longAgentProfile: profile,
      workspaceContext: {
        longWorkspace: {
          bookId: "longbook_character_directory",
          title: "雾港长篇",
          activeRoot: "worldbuilding",
          activeAgentId: profile.id,
          workspaceRevision: 3,
          projectRevision: 5,
          worldbuildingDirectory: {
            categories: [
              {
                categoryId: "world_rules",
                title: "世界规则",
                order: 1,
                format: "text"
              }
            ],
            omittedCategoryCount: 0
          },
          navigation: {
            schemaVersion: 1,
            revision: 3,
            bookId: "longbook_character_directory",
            updatedAt: "2026-07-26T10:00:00.000Z",
            counts: {
              worldbuildingCategories: 0,
              characters: extras.length,
              volumes: 1,
              arcs: 0,
              chapterCards: 0,
              storyEvents: 0,
              storyPlots: 0,
              foreshadowingThreads: 0,
              committedChapters: 0
            },
            worldbuilding: [],
            characterTypes: [{ id: "supporting", title: "配角", order: 1 }],
            characters: extras,
            volumes: [
              { id: "volume_character_directory", title: "第一卷", order: 1 }
            ],
            arcs: [],
            chapterCards: [],
            committedThroughChapterId: null
          }
        }
      }
    });

    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain("配角（type_id=supporting；共 52 人）");
    expect(userPrompt).toContain(
      "配角1（character_id=character_extra_01；顺序=1）"
    );
    expect(userPrompt).toContain(
      "配角50（character_id=character_extra_50；顺序=50）"
    );
    expect(userPrompt).not.toContain("character_extra_51");
    expect(userPrompt).not.toContain("配角51");
    expect(userPrompt).toContain(
      "另有 2 人未进入固定上下文，需要时调用 list_setting（domain=character, type_id=supporting）查询。"
    );
  });

  it("keeps the active empty chapter inside a capped chapter-card directory", () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "draft"
    )!;
    const chapterCards = Array.from({ length: 60 }, (_, index) => ({
      id: `chapter_window_${String(index + 1).padStart(2, "0")}`,
      volumeId: "volume_window",
      primaryArcId: "arc_window",
      title: `第${index + 1}章`,
      narrativeOrder: index + 1,
      bodyStatus: index < 59 ? ("written" as const) : ("empty" as const)
    }));
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_chapter_window",
      title: "章卡窗口测试",
      activeRoot: "draft",
      activeAgentId: profile.id,
      activeChapterCardId: "chapter_window_60",
      workspaceRevision: 1,
      projectRevision: 1,
      navigation: {
        schemaVersion: 1,
        revision: 1,
        bookId: "longbook_chapter_window",
        updatedAt: "2026-08-19T00:00:00.000Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 1,
          chapterCards: chapterCards.length,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
        characters: [],
        volumes: [{ id: "volume_window", title: "第一卷", order: 1 }],
        arcs: [
          {
            id: "arc_window",
            volumeId: "volume_window",
            title: "主线",
            order: 1
          }
        ],
        chapterCards,
        committedThroughChapterId: null
      }
    };

    const userPrompt = buildRuntimeUserPrompt({
      runId: "run_chapter_window",
      sessionId: "session_chapter_window",
      prompt: "写当前章",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    });

    expect(userPrompt).toContain("正文进度：已写 59 章，空白 1 章。");
    expect(userPrompt).toContain(
      "60. 「第60章」(chapter_window_60)；分卷=第 1 卷「第一卷」(volume_window)；卷内顺序=60；主剧情点=「主线」(arc_window)；正文=空白；当前章=是"
    );
    expect(userPrompt).toContain(
      "目录窗口：展示第 11-60 张；之前省略 10 张，之后省略 0 张。需要完整目录时调用 list_chapters 分页查询。"
    );
    expect(userPrompt).not.toContain("「第1章」(chapter_window_01)");
  });

  it("injects plot structure navigation and refreshes the plot position on every turn", async () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "plot_design"
    )!;
    const navigation = {
      schemaVersion: 1 as const,
      revision: 3,
      bookId: "longbook_plot_prompt",
      updatedAt: "2026-07-26T10:00:00.000Z",
      counts: {
        worldbuildingCategories: 1,
        characters: 1,
        volumes: 2,
        arcs: 3,
        chapterCards: 1,
        storyEvents: 0,
        storyPlots: 2,
        foreshadowingThreads: 1,
        committedChapters: 1
      },
      worldbuilding: [
        {
          id: "world_rules",
          title: "世界规则",
          order: 1,
          format: "text" as const
        }
      ],
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characters: [
        {
          id: "character_lan",
          name: "林岚",
          group: "protagonist",
          order: 1
        }
      ],
      volumes: [
        { id: "volume_plot_a", title: "起势", order: 1 },
        { id: "volume_plot_b", title: "转折", order: 2 }
      ],
      arcs: [
        {
          id: "arc_plot_main",
          volumeId: "volume_plot_a",
          title: "主线",
          order: 1
        },
        {
          id: "arc_plot_hidden",
          volumeId: "volume_plot_a",
          title: "暗线",
          order: 2
        },
        {
          id: "arc_plot_turn",
          volumeId: "volume_plot_b",
          title: "反击",
          order: 1
        }
      ],
      chapterCards: [
        {
          id: "chapter_plot_one",
          volumeId: "volume_plot_a",
          primaryArcId: "arc_plot_main",
          title: "第一章",
          narrativeOrder: 1,
          bodyStatus: "written" as const
        }
      ],
      committedThroughChapterId: "chapter_plot_one"
    };
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_plot_prompt",
      title: "雾港长篇",
      activeRoot: "plot_design",
      activeAgentId: profile.id,
      activeFileId: "file_long-book-line",
      activeFileRevision:
        "v2:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      workspaceRevision: 3,
      projectRevision: 5,
      agentsMd: "# 长篇上下文\n\n## 剧情点阶段\n维护结构。",
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          },
          {
            categoryId: "world_factions",
            title: "势力",
            order: 2,
            format: "list",
            itemCount: 1,
            items: [
              {
                itemId: "worlditem_watchers",
                title: "守夜人",
                order: 1
              }
            ],
            omittedItemCount: 0
          }
        ],
        omittedCategoryCount: 0
      },
      navigation,
      plotFocus: {
        section: "plot_point",
        volumeId: "volume_plot_a",
        volumeTitle: "起势",
        arcId: "arc_plot_main",
        arcTitle: "主线"
      }
    };
    const input = {
      runId: "run_plot_prompt",
      sessionId: "session_plot_prompt",
      prompt: "梳理这一卷的节奏",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace }
    };

    const userPrompt = buildRuntimeUserPrompt(input);
    const systemPrompt = buildEffectiveSystemPrompt("DeepWrite base", input);
    expect(systemPrompt).toContain("连续性记录只提供按章参考");
    expect(systemPrompt).toContain("不锁定章卡、故事情节或伏笔结构");
    expect(systemPrompt).toContain("type=foreshadowing.create");
    expect(systemPrompt).toContain("type=foreshadowingBeat.create");
    expect(systemPrompt).toContain("不得改写成 snake_case");
    expect(systemPrompt).toContain("删除章卡时客户端会在危险确认后级联清理");
    expect(systemPrompt).toContain("剧情点关联可为 null");
    expect(systemPrompt).toContain("非空时必须与章卡属于同一分卷");
    expect(systemPrompt).toContain("移动或删除剧情点只解除章卡的弱关联");
    expect(systemPrompt).toContain("全书故事线用 book_line");
    expect(systemPrompt).toContain("世界观与人物目录已写入本轮固定上下文");
    expect(systemPrompt).toContain(
      "不得把设定正文或 fileId 写入本轮固定上下文"
    );
    expect(systemPrompt).not.toContain("按稳定实体 ID 和 fileId 查询");
    expect(userPrompt).toContain(
      "全书共 2 卷、3 个剧情点、1 张章卡、2 条故事情节、0 个故事事件、1 条伏笔线"
    );
    expect(userPrompt).toContain(
      "连续性记录：1 章；最高连续记录位置为「第一章」(chapter_plot_one)"
    );
    expect(userPrompt).toContain("记录只作参考，不锁定正文或结构");
    expect(userPrompt).toContain("【章卡目录（由早到晚；共 1 张）】");
    expect(userPrompt).toContain(
      "1. 「第一章」(chapter_plot_one)；分卷=第 1 卷「起势」(volume_plot_a)；卷内顺序=1；主剧情点=「主线」(arc_plot_main)；正文=已写"
    );
    expect(userPrompt).toContain(
      "- 第 1 卷「起势」(volume_plot_a): 「主线」(arc_plot_main)、「暗线」(arc_plot_hidden)"
    );
    expect(userPrompt).toContain(
      "- 第 2 卷「转折」(volume_plot_b): 「反击」(arc_plot_turn)"
    );
    expect(userPrompt).toContain(
      "当前剧情工作区: 剧情点「主线」(arc_plot_main)，所属分卷「起势」(volume_plot_a)"
    );
    expect(userPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(userPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(userPrompt).toContain(
      "守夜人（item_id=worlditem_watchers；顺序=1）"
    );
    expect(userPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(userPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
    );
    expect(userPrompt).not.toContain("【当前阶段信息与要求】");
    expect(userPrompt.indexOf("【人物设计列表（发送时快照）】")).toBeLessThan(
      userPrompt.indexOf(
        "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
      )
    );
    expect(userPrompt).toContain("主角（type_id=protagonist；共 1 人）");
    expect(userPrompt).toContain("林岚（character_id=character_lan；顺序=1）");
    expect(userPrompt).not.toContain("session_plot_prompt");
    expect(userPrompt).not.toContain("run_plot_prompt");
    expect(userPrompt).not.toContain("当前根节点:");
    expect(userPrompt).not.toContain("当前文件:");
    expect(userPrompt).not.toContain("file_long-book-line");
    expect(userPrompt).not.toContain("当前用户所处的世界观阶段");
    expect(userPrompt).not.toContain("当前用户所处的人物阶段");

    const chapterCardPrompt = buildRuntimeUserPrompt({
      ...input,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          activeChapterCardId: "chapter_plot_one",
          plotFocus: {
            section: "chapter_card",
            volumeId: "volume_plot_a",
            volumeTitle: "起势",
            chapterCardId: "chapter_plot_one",
            chapterCardTitle: "第一章"
          }
        }
      }
    });
    expect(chapterCardPrompt).toContain(
      "当前剧情工作区: 章卡「第一章」(chapter_plot_one)，所属分卷「起势」(volume_plot_a)"
    );

    const bookLinePrompt = buildRuntimeUserPrompt({
      ...input,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          plotFocus: { section: "book_line" }
        }
      }
    });
    expect(bookLinePrompt).toContain("当前剧情工作区: 全书故事线");
    expect(bookLinePrompt).not.toContain("当前文件:");
    expect(bookLinePrompt).not.toContain("file_long-book-line");

    const draftProfile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "draft"
    )!;
    const draftPrompt = buildRuntimeUserPrompt({
      ...input,
      longAgentProfile: draftProfile,
      workspaceContext: {
        longWorkspace: {
          ...longWorkspace,
          activeRoot: "draft",
          activeAgentId: "draft",
          plotFocus: undefined
        }
      }
    });
    expect(draftPrompt).toContain("【世界观条目列表（发送时快照）】");
    expect(draftPrompt).toContain("【人物设计列表（发送时快照）】");
    expect(draftPrompt).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
    );
    expect(draftPrompt).toContain(
      "世界规则（category_id=world_rules；类型=文本）"
    );
    expect(draftPrompt).toContain("林岚（character_id=character_lan；顺序=1）");
    expect(draftPrompt).not.toContain("当前剧情工作区");
    expect(draftPrompt).not.toContain("session_plot_prompt");
    expect(draftPrompt).not.toContain("run_plot_prompt");
    expect(draftPrompt).not.toContain("当前根节点:");
    expect(draftPrompt).not.toContain("当前文件:");

    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    const turnContexts: LongWorkspaceRuntimeContext[] = [
      {
        ...longWorkspace,
        plotFocus: { section: "book_line" }
      },
      {
        ...longWorkspace,
        workspaceRevision: 4,
        projectRevision: 6,
        navigation: {
          ...navigation,
          revision: 4,
          updatedAt: "2026-07-26T10:01:00.000Z"
        },
        plotFocus: {
          section: "plot_point",
          volumeId: "volume_plot_a",
          volumeTitle: "起势",
          arcId: "arc_plot_hidden",
          arcTitle: "暗线"
        }
      },
      {
        ...longWorkspace,
        workspaceRevision: 5,
        projectRevision: 7,
        activeChapterCardId: "chapter_plot_one",
        navigation: {
          ...navigation,
          revision: 5,
          updatedAt: "2026-07-26T10:02:00.000Z"
        },
        plotFocus: {
          section: "chapter_card",
          volumeId: "volume_plot_a",
          volumeTitle: "起势",
          chapterCardId: "chapter_plot_one",
          chapterCardTitle: "第一章"
        }
      }
    ];
    for (const [turnIndex, context] of turnContexts.entries()) {
      for await (const _event of runtime.start({
        runId: `run_plot_turn_${turnIndex}`,
        sessionId: "session_plot_turns",
        prompt: `剧情请求 ${turnIndex + 1}`,
        thinkingLevel: "off",
        longAgentProfile: profile,
        workspaceContext: { longWorkspace: context }
      })) {
        // Consume every turn before inspecting the cached model transcript.
      }
    }
    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get(
      "session_plot_turns:long:plot_design:longbook_plot_prompt"
    );
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(userMessages).toHaveLength(3);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "当前剧情工作区: 全书故事线"
    );
    expect(String(userMessages?.[0]?.content)).not.toContain(
      "session_plot_turns"
    );
    expect(String(userMessages?.[0]?.content)).not.toContain("当前文件:");
    expect(String(userMessages?.[0]?.content)).not.toContain(
      "file_long-book-line"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【世界观条目列表（发送时快照）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【人物设计列表（发送时快照）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【本轮剧情工作区上下文】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【长篇结构导航（本轮发送时快照；条目正文与最新修订请通过工具读取）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【长篇上下文（AGENTS.md）】"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain(
      "【世界观条目列表"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("【人物设计列表");
    expect(String(userMessages?.[1]?.content)).toContain(
      "结构版本 4；项目版本 6"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "当前剧情工作区: 剧情点「暗线」(arc_plot_hidden)"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("当前文件:");
    expect(String(userMessages?.[1]?.content)).not.toContain(
      "file_long-book-line"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("当前根节点:");
    expect(String(userMessages?.[2]?.content)).toContain(
      "当前章卡: chapter_plot_one"
    );
    expect(String(userMessages?.[2]?.content)).toContain(
      "当前剧情工作区: 章卡「第一章」(chapter_plot_one)"
    );
    expect(String(userMessages?.[2]?.content)).not.toContain("当前文件:");
  });

  it("injects design directories for the chapter writer and refreshes plot navigation later", async () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "draft"
    )!;
    const navigation = {
      schemaVersion: 1 as const,
      revision: 3,
      bookId: "longbook_draft_prompt",
      updatedAt: "2026-07-26T10:00:00.000Z",
      counts: {
        worldbuildingCategories: 1,
        characters: 1,
        volumes: 1,
        arcs: 1,
        chapterCards: 1,
        storyEvents: 0,
        storyPlots: 0,
        foreshadowingThreads: 0,
        committedChapters: 0
      },
      worldbuilding: [
        {
          id: "world_rules",
          title: "世界规则",
          order: 1,
          format: "text" as const
        }
      ],
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characters: [
        {
          id: "character_lan",
          name: "林岚",
          group: "protagonist",
          order: 1
        }
      ],
      volumes: [{ id: "volume_draft_a", title: "起势", order: 1 }],
      arcs: [
        {
          id: "arc_draft_main",
          volumeId: "volume_draft_a",
          title: "主线",
          order: 1
        }
      ],
      chapterCards: [
        {
          id: "chapter_draft_one",
          volumeId: "volume_draft_a",
          primaryArcId: "arc_draft_main",
          title: "第一章",
          narrativeOrder: 1,
          bodyStatus: "empty" as const
        }
      ],
      committedThroughChapterId: null
    };
    const longWorkspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_draft_prompt",
      title: "雾港长篇",
      activeRoot: "draft",
      activeAgentId: profile.id,
      activeChapterCardId: "chapter_draft_one",
      workspaceRevision: 3,
      projectRevision: 5,
      agentsMd: "# 长篇上下文\n\n## 正文阶段\n按章写作。",
      worldbuildingDirectory: {
        categories: [
          {
            categoryId: "world_rules",
            title: "世界规则",
            order: 1,
            format: "text"
          }
        ],
        omittedCategoryCount: 0
      },
      navigation
    };
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    for (const [turnIndex, context] of [
      longWorkspace,
      {
        ...longWorkspace,
        workspaceRevision: 4,
        projectRevision: 6,
        navigation: {
          ...navigation,
          revision: 4,
          updatedAt: "2026-07-26T10:01:00.000Z"
        }
      }
    ].entries()) {
      for await (const _event of runtime.start({
        runId: `run_draft_turn_${turnIndex}`,
        sessionId: "session_draft_turns",
        prompt: `写手请求 ${turnIndex + 1}`,
        thinkingLevel: "off",
        longAgentProfile: profile,
        workspaceContext: { longWorkspace: context }
      })) {
        // Consume every turn before inspecting the cached model transcript.
      }
    }
    const cache = (
      runtime as unknown as {
        conversationAgents: Map<
          string,
          { state: { messages: Array<{ role?: string; content?: unknown }> } }
        >;
      }
    ).conversationAgents;
    const agent = cache.get(
      "session_draft_turns:long:draft:longbook_draft_prompt"
    );
    const userMessages = agent?.state.messages.filter(
      (message) => message.role === "user"
    );
    expect(userMessages).toHaveLength(2);
    expect(String(userMessages?.[0]?.content)).toContain(
      "【本次智能体会话固定上下文】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【世界观条目列表（发送时快照）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【人物设计列表（发送时快照）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【长篇结构导航（发送时快照；条目正文与最新修订请通过工具读取）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "正文进度：已写 0 章，空白 1 章。"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "【章卡目录（由早到晚；共 1 张）】"
    );
    expect(String(userMessages?.[0]?.content)).toContain(
      "1. 「第一章」(chapter_draft_one)；分卷=第 1 卷「起势」(volume_draft_a)；卷内顺序=1；主剧情点=「主线」(arc_draft_main)；正文=空白；当前章=是"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【本轮写手工作区上下文】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "【长篇结构导航（本轮发送时快照；条目正文与最新修订请通过工具读取）】"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "结构版本 4；项目版本 6"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "当前章卡: chapter_draft_one"
    );
    expect(String(userMessages?.[1]?.content)).toContain(
      "1. 「第一章」(chapter_draft_one)；分卷=第 1 卷「起势」(volume_draft_a)；卷内顺序=1；主剧情点=「主线」(arc_draft_main)；正文=空白；当前章=是"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain(
      "【世界观条目列表"
    );
    expect(String(userMessages?.[1]?.content)).not.toContain("【人物设计列表");
    expect(String(userMessages?.[1]?.content)).not.toContain("当前剧情工作区");
  });
});
