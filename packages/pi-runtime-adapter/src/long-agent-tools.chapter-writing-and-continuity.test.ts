import type {
  LongAgentToolDetails,
  LongCommandExecutor,
  LongWorkspaceRuntimeContext
} from "./long-agent-tools.test-support";
import {
  NOW,
  buildLongWorkspaceTools,
  committedFixtureIndex,
  createLongWorkspaceNavigationSnapshot,
  describe,
  expect,
  file,
  fixtureIndex,
  indexResult,
  it,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  profile,
  resultText,
  toRuntimeEvents,
  toolByName,
  twoWrittenChaptersIndex,
  vi,
  workspace
} from "./long-agent-tools.test-support";

describe("long workspace agent tools: chapter-writing-and-continuity", () => {
  it("lets the chapter writer read any chapter body while writes stay active-only", async () => {
    const latest = fixtureIndex();
    const first = latest.chapters[0]!;
    latest.plot.chapterCards.push({
      id: "chapter_two",
      volumeId: "volume_one",
      primaryArcId: "arc_one",
      title: "第二章",
      narrativeOrder: 2
    });
    latest.chapters.push({
      ...first,
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
      )
    });
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const chapter = latest.chapters.find(
        ({ body }) => body.id === command.payload.fileId
      )!;
      const content =
        chapter.chapterCardId === "chapter_one" ? "第一章正文" : "第二章正文";
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: chapter.body,
          content,
          offset: 0,
          totalCharacters: content.length,
          nextOffset: null,
          workspaceRevision: latest.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace("draft", "draft", "chapter_two"),
      profile: profile("draft"),
      sessionId: "session-read-any-chapter",
      runId: "run-read-any-chapter",
      executor
    });
    const read = toolByName(tools, "read_chapter");

    const firstText = resultText(
      await read.execute("read-first", {
        chapter_card_id: "chapter_one",
        mode: "full"
      })
    );
    expect(() => JSON.parse(firstText)).toThrow();
    expect(firstText).not.toContain('"chapter_card_id"');
    expect(firstText).toBe(
      [
        "完整内容：",
        "",
        "第一章",
        "chapter_card_id=chapter_one",
        "document=body",
        "mode=full",
        "",
        "正文",
        "第一章正文"
      ].join("\n")
    );
    const secondText = resultText(
      await read.execute("read-second", {
        chapter_card_id: "chapter_two",
        mode: "full"
      })
    );
    expect(secondText).toContain("chapter_card_id=chapter_two");
    expect(secondText).toContain("第二章正文");
    expect(toolByName(tools, "write_chapter_draft").description).toContain(
      "运行时锁定章节"
    );
  });

  it("allows the chapter writer to refine a committed chapter body", async () => {
    const latest = committedFixtureIndex();
    const chapter = latest.chapters[0]!;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: chapter.body,
          content: "旧正文措辞",
          offset: 0,
          totalCharacters: 5,
          nextOffset: null,
          workspaceRevision: latest.revision,
          projectRevision: 11
        }
      };
    });
    const committedWorkspace = workspace("draft", "draft", "chapter_one");
    committedWorkspace.navigation =
      createLongWorkspaceNavigationSnapshot(latest);
    const tools = buildLongWorkspaceTools({
      workspace: committedWorkspace,
      profile: profile("draft"),
      sessionId: "session-refine-committed-chapter",
      runId: "run-refine-committed-chapter",
      executor
    });

    await toolByName(tools, "read_chapter").execute("read-committed", {
      mode: "full"
    });
    const result = await toolByName(tools, "edit_chapter_draft").execute(
      "refine-committed",
      {
        replacements: [
          { original_text: "旧正文措辞", new_text: "精修后的正文措辞" }
        ],
        summary: "精修已提交正文措辞"
      }
    );

    expect(result.details).toMatchObject({
      kind: "long-chapter-write-proposal",
      file: {
        chapterCardId: "chapter_one",
        operation: "edit",
        beforeText: "旧正文措辞",
        afterText: "精修后的正文措辞"
      }
    });
    expect(toolByName(tools, "edit_chapter_draft").description).toContain(
      "不限制局部或大幅修改"
    );
  });

  it("creates, writes, edits, and commits chapter continuity text files", async () => {
    const latest = fixtureIndex();
    const chapter = latest.chapters[0]!;
    chapter.bodyStatus = "written";
    latest.plot.foreshadowing.push({
      id: "foreshadow_seal",
      title: "蜡封来源",
      coreQuestion: "蜡封来自谁？",
      truthEventId: null,
      expectedReaderEffect: "让读者注意蜡封图案。",
      status: "planned",
      beats: [
        {
          id: "beat_seal_plant",
          type: "plant",
          order: 1,
          eventId: null,
          placementId: null,
          chapterCardId: "chapter_one",
          plannedScope: "",
          note: "正文首次呈现蜡封。",
          status: "planned",
          commitId: null
        }
      ]
    });
    const fileContents = new Map([
      [chapter.body.id, "第一章正文。"],
      [chapter.characterState.id, "章末状态：林岚抵达北门。"],
      [chapter.handoff.id, "接续包：追兵即将封锁北门。"],
      [chapter.foreshadowingChanges.id, "无变化。"]
    ]);
    const indexedFiles = [
      chapter.body,
      chapter.characterState,
      chapter.handoff,
      chapter.foreshadowingChanges
    ];
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const requested = indexedFiles.find(
        ({ id }) => id === command.payload.fileId
      );
      if (!requested) {
        throw new Error(`Unknown test file: ${command.payload.fileId}`);
      }
      const content = fileContents.get(requested.id) ?? "";
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: requested,
          content,
          offset: 0,
          totalCharacters: content.length,
          nextOffset: null,
          workspaceRevision: latest.revision,
          projectRevision: 11
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace(
        "continuity_ledger",
        "continuity_ledger",
        "chapter_one"
      ),
      profile: profile("continuity_ledger"),
      sessionId: "session-continuity-files",
      runId: "run-continuity-files",
      executor
    });

    const list = await toolByName(tools, "list_continuity_files").execute(
      "list-continuity",
      { chapter_card_id: "chapter_one" }
    );
    expect(resultText(list)).toContain("foreshadowing_changes");
    expect(resultText(list)).toContain("foreshadow_seal");
    expect(resultText(list)).toContain("beat_seal_plant");
    expect(resultText(list)).toContain("not_created");

    await toolByName(tools, "read_continuity_file").execute(
      "read-foreshadowing",
      {
        domain: "character",
        target: { document: "foreshadowing_changes" },
        mode: "full"
      }
    );
    const edit = await toolByName(tools, "edit_continuity_file").execute(
      "edit-foreshadowing",
      {
        domain: "character",
        target: { document: "foreshadowing_changes" },
        replacements: [
          { original_text: "无变化。", new_text: "蜡封伏笔已种下。" }
        ]
      }
    );
    expect(edit.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      files: [
        {
          role: "foreshadowing_changes",
          operation: "edit",
          beforeText: "无变化。",
          afterText: "蜡封伏笔已种下。"
        }
      ]
    });

    const characterId = latest.characters[0]!.id;
    const createCharacter = await toolByName(
      tools,
      "create_continuity_file"
    ).execute("create-character-continuity", {
      domain: "character",
      target: { document: "character", character_id: characterId }
    });
    expect(createCharacter.details).toMatchObject({
      kind: "long-continuity-file-proposal",
      batch: {
        operations: [
          { type: "chapterContinuity.character.create", characterId }
        ],
        documentWrites: [
          { mode: "create", expectedRevision: null },
          { mode: "create", expectedRevision: null }
        ]
      },
      files: [
        { role: "character_current_state", operation: "create" },
        { role: "character_history", operation: "create" }
      ]
    });

    for (const [document, text] of [
      ["character_current_state", "当前状态：林岚抵达北门。"],
      ["character_history", "第一章：林岚在追兵前抵达北门。"]
    ] as const) {
      const write = await toolByName(tools, "write_continuity_file").execute(
        `write-${document}`,
        {
          target: { document, character_id: characterId },
          text
        }
      );
      expect(write.details).toMatchObject({
        kind: "long-continuity-file-proposal",
        files: [{ role: document, operation: "write", afterText: text }]
      });
    }

    await toolByName(tools, "create_continuity_file").execute(
      "create-world-reveals",
      { domain: "character", target: { document: "world_reveals" } }
    );
    await toolByName(tools, "write_continuity_file").execute(
      "write-world-reveals",
      {
        domain: "character",
        target: { document: "world_reveals" },
        text: "本章揭露北门蜡封可感知灵力。"
      }
    );

    const commitTool = toolByName(tools, "propose_continuity_commit");
    await expect(
      commitTool.execute("reject-missing-touchpoint-decision", {
        summary: "不应遗漏伏笔触点决策",
        foreshadowing_touchpoint_decisions: []
      })
    ).rejects.toThrow(/必须完整覆盖/u);
    await expect(
      commitTool.execute("reject-wrong-foreshadowing-link", {
        summary: "不应关联错误伏笔线",
        foreshadowing_touchpoint_decisions: [
          {
            foreshadowing_id: "foreshadow_other",
            beat_id: "beat_seal_plant",
            status: "committed",
            evidence: "正文明确写出信封上的蜡封图案。"
          }
        ]
      })
    ).rejects.toThrow(/不属于伏笔线/u);
    const commit = await commitTool.execute("commit-continuity", {
      summary: "留存第一章连续性记录",
      foreshadowing_touchpoint_decisions: [
        {
          foreshadowing_id: "foreshadow_seal",
          beat_id: "beat_seal_plant",
          status: "committed",
          evidence: "正文明确写出信封上的蜡封图案。"
        }
      ]
    });
    expect(commit.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: {
        mode: "text_files",
        bookId: "longbook_tools",
        chapterCardId: "chapter_one",
        chapterFileRevisions: { body: chapter.body.revision },
        foreshadowingBeatDecisions: {
          beat_seal_plant: {
            status: "committed",
            note: "正文明确写出信封上的蜡封图案。"
          }
        },
        commitMessage: "留存第一章连续性记录",
        baseWorkspaceRevision: 7,
        baseProjectRevision: 11
      }
    });
    if (
      !commit.details ||
      commit.details.kind !== "long-ledger-commit-proposal" ||
      commit.details.input.mode !== "text_files"
    ) {
      throw new Error("Expected a text-file continuity commit proposal.");
    }
    expect(commit.details.input.continuityFileRevisions).toHaveLength(6);
    expect(JSON.stringify(commitTool.parameters)).not.toMatch(
      /file_id|revision|fact_mutations|open_loop/u
    );
    expect(tools.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([
        "set_long_ledger_fact_mutation",
        "propose_long_ledger_commit"
      ])
    );

    const deleteTool = toolByName(tools, "delete_continuity_file");
    const deleteWorld = await deleteTool.execute("delete-world-reveals", {
      domain: "character",
      target: { document: "world_reveals" }
    });
    expect(deleteWorld.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "chapterContinuity.worldReveals.delete",
            chapterCardId: "chapter_one"
          }
        ],
        documentWrites: []
      }
    });
    const deleteCharacter = await deleteTool.execute(
      "delete-character-continuity",
      {
        domain: "character",
        target: {
          document: "character",
          character_id: characterId
        }
      }
    );
    expect(deleteCharacter.details).toMatchObject({
      kind: "long-mutation-proposal",
      batch: {
        operations: [
          {
            type: "chapterContinuity.character.delete",
            chapterCardId: "chapter_one",
            characterId
          }
        ],
        documentWrites: []
      }
    });
    expect(JSON.stringify(deleteTool.parameters)).not.toMatch(
      /body|chapter_end_state|handoff|foreshadowing_changes/u
    );
    expect(deleteTool.description).toMatch(/误创建|不再适用/u);
    const commitAfterOptionalDeletes = await commitTool.execute(
      "commit-after-optional-deletes",
      {
        summary: "删除误建文件后留存第一章连续性记录",
        foreshadowing_touchpoint_decisions: [
          {
            foreshadowing_id: "foreshadow_seal",
            beat_id: "beat_seal_plant",
            status: "missed",
            evidence: "正文未出现计划中的蜡封图案。"
          }
        ]
      }
    );
    if (
      !commitAfterOptionalDeletes.details ||
      commitAfterOptionalDeletes.details.kind !==
        "long-ledger-commit-proposal" ||
      commitAfterOptionalDeletes.details.input.mode !== "text_files"
    ) {
      throw new Error("Expected a text-file continuity commit proposal.");
    }
    expect(
      commitAfterOptionalDeletes.details.input.continuityFileRevisions
    ).toHaveLength(3);
    expect(
      commitAfterOptionalDeletes.details.input.foreshadowingBeatDecisions
    ).toEqual({
      beat_seal_plant: {
        status: "missed",
        note: "正文未出现计划中的蜡封图案。"
      }
    });
  });

  it("lists catch-up hints and writes unrecorded chapters without an active selection", async () => {
    const latest = twoWrittenChaptersIndex();
    const first = latest.chapters[0]!;
    const second = latest.chapters[1]!;
    const fileContents = new Map([
      [first.body.id, "第一章正文。"],
      [first.characterState.id, ""],
      [first.handoff.id, ""],
      [second.body.id, "第二章正文。"],
      [second.characterState.id, ""],
      [second.handoff.id, ""]
    ]);
    const indexedFiles = [
      first.body,
      first.characterState,
      first.handoff,
      second.body,
      second.characterState,
      second.handoff
    ];
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const requested = indexedFiles.find(
        ({ id }) => id === command.payload.fileId
      );
      if (!requested) {
        throw new Error(`Unknown test file: ${command.payload.fileId}`);
      }
      const content = fileContents.get(requested.id) ?? "";
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: requested,
          content,
          offset: 0,
          totalCharacters: content.length,
          nextOffset: null,
          workspaceRevision: latest.revision,
          projectRevision: 11
        }
      };
    });
    const bookLevelWorkspace: LongWorkspaceRuntimeContext = {
      bookId: latest.bookId,
      title: "工具测试",
      activeRoot: "continuity_ledger",
      activeAgentId: "continuity_ledger",
      workspaceRevision: latest.revision,
      projectRevision: 11,
      navigation: createLongWorkspaceNavigationSnapshot(latest)
    };
    const tools = buildLongWorkspaceTools({
      workspace: bookLevelWorkspace,
      profile: profile("continuity_ledger"),
      sessionId: "session-continuity-catchup",
      runId: "run-continuity-catchup",
      executor
    });
    expect(tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "write_continuity_file",
        "propose_continuity_commit"
      ])
    );

    const listed = JSON.parse(
      resultText(
        await toolByName(tools, "list_continuity_files").execute(
          "list-catchup",
          {}
        )
      )
    ) as {
      pending_catchup: Array<{
        chapter_card_id: string;
        suggested_record: string;
      }>;
    };
    expect(listed.pending_catchup).toEqual([
      {
        chapter_card_id: "chapter_one",
        title: "第一章",
        suggested_record: "brief"
      },
      {
        chapter_card_id: "chapter_two",
        title: "第二章",
        suggested_record: "full"
      }
    ]);

    await expect(
      toolByName(tools, "write_continuity_file").execute("missing-chapter", {
        target: { document: "chapter_end_state" },
        text: "缺少章卡。"
      })
    ).rejects.toThrow(/chapter_card_id/u);

    await toolByName(tools, "write_continuity_file").execute(
      "write-first-state",
      {
        chapter_card_id: "chapter_one",
        target: { document: "chapter_end_state" },
        text: "简短章末：林岚离开北门。"
      }
    );
    await toolByName(tools, "write_continuity_file").execute(
      "write-first-handoff",
      {
        chapter_card_id: "chapter_one",
        target: { document: "handoff" },
        text: "简短接续：追兵未至。"
      }
    );
    const firstCommit = await toolByName(
      tools,
      "propose_continuity_commit"
    ).execute("commit-first", {
      chapter_card_id: "chapter_one",
      summary: "简记第一章",
      foreshadowing_touchpoint_decisions: []
    });
    expect(firstCommit.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: {
        chapterCardId: "chapter_one",
        continuityFileRevisions: expect.arrayContaining([
          expect.objectContaining({ fileId: first.characterState.id }),
          expect.objectContaining({ fileId: first.handoff.id })
        ])
      }
    });
    if (
      !firstCommit.details ||
      firstCommit.details.kind !== "long-ledger-commit-proposal" ||
      firstCommit.details.input.mode !== "text_files"
    ) {
      throw new Error("Expected a brief first-chapter continuity commit.");
    }
    expect(firstCommit.details.input.continuityFileRevisions).toHaveLength(2);

    await toolByName(tools, "write_continuity_file").execute(
      "write-second-state",
      {
        chapter_card_id: "chapter_two",
        target: { document: "chapter_end_state" },
        text: "完整章末：林岚在北门与追兵对峙，旧伤复发。"
      }
    );
    await toolByName(tools, "write_continuity_file").execute(
      "write-second-handoff",
      {
        chapter_card_id: "chapter_two",
        target: { document: "handoff" },
        text: "完整接续：下一章从封锁后的北门巷战开始。"
      }
    );
    const secondCommit = await toolByName(
      tools,
      "propose_continuity_commit"
    ).execute("commit-second", {
      chapter_card_id: "chapter_two",
      summary: "完整记录第二章",
      foreshadowing_touchpoint_decisions: []
    });
    expect(secondCommit.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: {
        chapterCardId: "chapter_two"
      }
    });
  });

  it("registers continuity finalization after unrelated file approvals advance global revisions", async () => {
    const latest = fixtureIndex();
    const chapter = latest.chapters[0]!;
    chapter.bodyStatus = "written";
    const fileContents = new Map([
      [chapter.body.id, "第一章正文。"],
      [chapter.characterState.id, "章末状态：林岚抵达北门。"],
      [chapter.handoff.id, "接续包：追兵即将封锁北门。"],
      [chapter.foreshadowingChanges.id, ""]
    ]);
    const indexedFiles = [
      chapter.body,
      chapter.characterState,
      chapter.handoff,
      chapter.foreshadowingChanges
    ];
    let liveWorkspaceRevision = latest.revision;
    let liveProjectRevision = 11;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const requested = indexedFiles.find(
        ({ id }) => id === command.payload.fileId
      );
      if (!requested) {
        throw new Error(`Unknown test file: ${command.payload.fileId}`);
      }
      const content = fileContents.get(requested.id) ?? "";
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: requested,
          content,
          offset: 0,
          totalCharacters: content.length,
          nextOffset: null,
          workspaceRevision: liveWorkspaceRevision,
          projectRevision: liveProjectRevision
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace(
        "continuity_ledger",
        "continuity_ledger",
        "chapter_one"
      ),
      profile: profile("continuity_ledger"),
      sessionId: "session-continuity-rebased-read",
      runId: "run-continuity-rebased-read",
      executor
    });

    const list = await toolByName(tools, "list_continuity_files").execute(
      "list-no-foreshadowing",
      {
        chapter_card_id: "chapter_one"
      }
    );
    expect(resultText(list)).not.toContain("foreshadowing_changes");
    expect(resultText(list)).toContain(
      '"foreshadowing_touchpoint_candidates": []'
    );
    await expect(
      toolByName(tools, "write_continuity_file").execute(
        "reject-unmodeled-foreshadowing",
        {
          domain: "character",
          target: { document: "foreshadowing_changes" },
          text: "不应创建的伏笔记录。"
        }
      )
    ).rejects.toThrow(/没有关联伏笔总览中的既有触点/u);

    await toolByName(tools, "read_chapter").execute("read-body", {
      mode: "full"
    });
    liveWorkspaceRevision += 3;
    liveProjectRevision += 3;

    const commit = await toolByName(tools, "propose_continuity_commit").execute(
      "commit-after-file-approvals",
      {
        summary: "连续性文件获批后归档第一章",
        foreshadowing_touchpoint_decisions: []
      }
    );

    expect(commit.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: {
        chapterFileRevisions: { body: chapter.body.revision },
        continuityFileRevisions: expect.not.arrayContaining([
          expect.objectContaining({ fileId: chapter.foreshadowingChanges.id })
        ]),
        foreshadowingBeatDecisions: {},
        baseWorkspaceRevision: latest.revision,
        baseProjectRevision: 11
      }
    });
  });

  it("still rejects continuity finalization when the chapter file itself changed", async () => {
    const latest = fixtureIndex();
    const chapter = latest.chapters[0]!;
    chapter.bodyStatus = "written";
    const changedBody = {
      ...chapter.body,
      revision: `v2:15:${"a".repeat(64)}`
    };
    let bodyChanged = false;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(latest);
      }
      if (command.type !== "long.readDocument") {
        throw new Error(`Unexpected command: ${command.type}`);
      }
      const isBody = command.payload.fileId === chapter.body.id;
      const content = isBody
        ? bodyChanged
          ? "正文已在外部更新。"
          : "初始正文。"
        : "已有连续性内容。";
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: latest.bookId,
          file: isBody
            ? bodyChanged
              ? changedBody
              : chapter.body
            : [
                chapter.characterState,
                chapter.handoff,
                chapter.foreshadowingChanges
              ].find(({ id }) => id === command.payload.fileId)!,
          content,
          offset: 0,
          totalCharacters: content.length,
          nextOffset: null,
          workspaceRevision: latest.revision + 1,
          projectRevision: 12
        }
      };
    });
    const tools = buildLongWorkspaceTools({
      workspace: workspace(
        "continuity_ledger",
        "continuity_ledger",
        "chapter_one"
      ),
      profile: profile("continuity_ledger"),
      sessionId: "session-continuity-changed-body",
      runId: "run-continuity-changed-body",
      executor
    });

    await toolByName(tools, "read_chapter").execute("read-initial-body", {
      mode: "full"
    });
    bodyChanged = true;

    await expect(
      toolByName(tools, "propose_continuity_commit").execute(
        "commit-changed-body",
        {
          summary: "不应归档已变化的正文",
          foreshadowing_touchpoint_decisions: []
        }
      )
    ).rejects.toThrow(/changed after continuity analysis/u);
  });

  it("rejects chapter mutations against stale, mismatched, or committed workspace context", async () => {
    const writeInput = {
      content: "正文",
      summary: "完成第一章"
    };
    const staleWorkspace = workspace("draft", "draft", "chapter_one");
    staleWorkspace.projectRevision = 10;
    const staleTools = buildLongWorkspaceTools({
      workspace: staleWorkspace,
      profile: profile("draft"),
      sessionId: "session-stale-chapter",
      runId: "run-stale-chapter",
      executor: vi.fn<LongCommandExecutor>(async () => indexResult())
    });
    await expect(
      toolByName(staleTools, "write_chapter_draft").execute(
        "stale-chapter",
        writeInput
      )
    ).rejects.toThrow(/context no longer matches/u);

    const mismatchedWorkspace = workspace("draft", "draft", "chapter_one");
    mismatchedWorkspace.navigation.chapterCards[0]!.title = "过期章名";
    const mismatchedTools = buildLongWorkspaceTools({
      workspace: mismatchedWorkspace,
      profile: profile("draft"),
      sessionId: "session-mismatched-chapter",
      runId: "run-mismatched-chapter",
      executor: vi.fn<LongCommandExecutor>(async () => indexResult())
    });
    await expect(
      toolByName(mismatchedTools, "write_chapter_draft").execute(
        "mismatched-chapter",
        writeInput
      )
    ).rejects.toThrow(/target chapter no longer matches/u);

    const otherBookIndex = fixtureIndex();
    otherBookIndex.bookId = "longbook_other";
    const otherBookTools = buildLongWorkspaceTools({
      workspace: workspace("draft", "draft", "chapter_one"),
      profile: profile("draft"),
      sessionId: "session-other-book",
      runId: "run-other-book",
      executor: vi.fn<LongCommandExecutor>(async () =>
        indexResult(otherBookIndex)
      )
    });
    await expect(
      toolByName(otherBookTools, "write_chapter_draft").execute(
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
      toolByName(committedTools, "write_continuity_file").execute(
        "committed-chapter",
        {
          domain: "character",
          target: { document: "foreshadowing_changes" },
          text: "重复提交"
        }
      )
    ).rejects.toThrow(/already committed/u);
    await expect(
      toolByName(committedTools, "delete_continuity_file").execute(
        "delete-from-committed-chapter",
        { domain: "character", target: { document: "world_reveals" } }
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
      agentId: "setting",
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
