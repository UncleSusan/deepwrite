import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type ScriptWorkspaceSnapshot
} from "@deepwrite/contracts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  describe,
  expect,
  it,
  screenplayWorkspace,
  scriptAgentProfile
} from "./index.test-support";
import {
  buildScriptWorkspaceTools,
  createScriptWorkspaceToolSharedState
} from "./short-agent-tools";

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("script workspace tool regression", () => {
  it("uses the unified four tools in every script stage", () => {
    const { activeSectionId: _activeSectionId, ...draftWorkspace } =
      screenplayWorkspace();
    const plotWorkspace = {
      ...draftWorkspace,
      activeStageId: "plot_design",
      activeAgentId: "script"
    } satisfies ScriptWorkspaceSnapshot;
    const plotProfile = DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!;

    const plotTools = buildScriptWorkspaceTools({
      workspace: plotWorkspace,
      profile: plotProfile
    });
    expect(plotTools.map(({ name }) => name)).toEqual([
      "read",
      "create",
      "edit",
      "write",
      "query_linked_material_entries",
      "load_skill"
    ]);

    const draftTools = buildScriptWorkspaceTools({
      workspace: screenplayWorkspace(),
      profile: scriptAgentProfile()
    });
    expect(draftTools.map(({ name }) => name)).toEqual(
      plotTools.map(({ name }) => name)
    );
    expect(
      draftTools.find(({ name }) => name === "write")?.description
    ).toContain("剧本正文必须遵守");
    expect(draftTools.map(({ name }) => name)).not.toContain(
      "delete_draft_section"
    );
  });

  it("requires complete reads and explicit consent before overwriting a script body", async () => {
    const workspace = screenplayWorkspace();
    const body = workspace.expertDraft.sections[0]!.body;
    body.content = "1. 内景 客厅 - 夜\n△灯忽然熄灭。";
    body.revision = createShortWorkspaceContentRevision(body.content);
    const tools = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile()
    });
    const write = toolByName(tools, "write");
    const request = {
      kind: "draft_section",
      id: "episode-1",
      document: "body",
      content: "1. 内景 客厅 - 夜\n△应急灯亮起。",
      summary: "重写第一集。"
    };
    expect(resultText(await write.execute("blocked", request))).toContain(
      "请先用 read 完整读取"
    );
    await toolByName(tools, "read").execute("read", {
      kind: "draft_section",
      id: "episode-1",
      document: "body"
    });
    expect(resultText(await write.execute("no-consent", request))).toContain(
      "allow_overwrite_existing=true"
    );
    expect(
      (
        await write.execute("accepted", {
          ...request,
          allow_overwrite_existing: true
        })
      ).details
    ).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      sectionId: "episode-1",
      fileKind: "body"
    });
  });

  it("shares same-run proposals while isolating child read credentials", async () => {
    const workspace = screenplayWorkspace();
    const sharedState = createScriptWorkspaceToolSharedState(workspace);
    const parentTools = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState
    });
    const created = await toolByName(parentTools, "create").execute("create", {
      kind: "draft_section",
      meta: { title: "第二集" },
      summary: "创建第二集。"
    });
    const sectionId = resultText(created).match(/section_id=(.+)/u)?.[1];
    expect(sectionId).toMatch(/^pending:section:/u);
    const childTools = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState
    });
    expect(
      (
        await toolByName(childTools, "write").execute("write-created", {
          kind: "draft_section",
          id: sectionId!,
          document: "body",
          content: "1. 外景 码头 - 黎明\n△雾散开。",
          summary: "写入第二集。"
        })
      ).details
    ).toMatchObject({ sectionId });

    const existingBody = workspace.expertDraft.sections[0]!.body;
    existingBody.content = "旧正文";
    existingBody.revision = createShortWorkspaceContentRevision("旧正文");
    const isolatedState = createScriptWorkspaceToolSharedState(workspace);
    const reader = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState: isolatedState
    });
    await toolByName(reader, "read").execute("read-existing", {
      kind: "draft_section",
      id: "episode-1",
      document: "body"
    });
    const isolatedWriter = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState: isolatedState
    });
    expect(
      resultText(
        await toolByName(isolatedWriter, "write").execute("isolated", {
          kind: "draft_section",
          id: "episode-1",
          document: "body",
          content: "新正文",
          allow_overwrite_existing: true,
          summary: "重写第一集。"
        })
      )
    ).toContain("请先用 read 完整读取");
  });
});
