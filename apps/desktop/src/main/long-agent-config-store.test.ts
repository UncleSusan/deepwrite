import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_SETTINGS,
  type LongAgentSettingsInput
} from "@deepwrite/contracts";
import { LongAgentConfigStore } from "./long-agent-config-store";

async function createStore(): Promise<{
  root: string;
  store: LongAgentConfigStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-long-agent-store-"));
  return { root, store: new LongAgentConfigStore(root) };
}

function editableDefaults(): LongAgentSettingsInput {
  return {
    workspaceType: "long",
    agents: DEFAULT_LONG_AGENT_SETTINGS.agents.map((agent) => ({
      id: agent.id,
      systemPrompt: agent.systemPrompt,
      welcomeShortcuts: [
        agent.welcomeShortcuts[0],
        agent.welcomeShortcuts[1],
        agent.welcomeShortcuts[2]
      ],
      readAccess: {
        workspaceRoots: [...agent.readAccess.workspaceRoots],
        materialKinds: [...agent.readAccess.materialKinds],
        skillKinds: [...agent.readAccess.skillKinds]
      }
    }))
  };
}

const RETIRED_CONTINUITY_LEDGER_SYSTEM_PROMPT = `你负责长篇连续性账本。只处理正文已经写完的连续下一章，不得跳章提交。

工作规则：
1. 世界观、人物、剧情、正文和既有连续性账本分别使用各阶段的 list / search / read 工具查询；先看列表与概览，再按业务 ID 读取核验所需的具体内容。不得使用底层工作区索引、file_id 或通用文档读取。
2. 以本章正文为唯一事实证据，结合上一章章末状态与接续包，逐域核对人物、关系、世界、剧情、伏笔、知识边界和开放环。
3. 使用同组的 set_long_ledger_* 工具逐项暂存核验结果或变更；每次调用只处理一个事实、知识边界、开放环、人物文件、核验域、摘要章节、叙事落点或伏笔触点。
4. 新事实和新开放环省略 ID，由工具生成并返回稳定 fact_id / loop_id；后续知识边界、开放环和接续包必须使用工具返回的 ID，不得传 null 或自行猜测。
5. 六个 coverage 域和六个 chapter summary 章节必须分别逐项设置；叙事落点与伏笔触点也必须逐项判定。
6. 逐项准备完毕后，最后单独调用 propose_long_ledger_commit，生成本章唯一的一张原子提交提案。暂存和最终提案都不直接写磁盘，不得声称尚未获批的账本已经提交。`;

describe("LongAgentConfigStore", () => {
  it("returns six independent defaults without creating a file", async () => {
    const { store } = await createStore();
    const settings = await store.list();
    expect(settings.workspaceType).toBe("long");
    expect(settings.agents.map(({ id }) => id)).toEqual(
      DEFAULT_LONG_AGENT_SETTINGS.agents.map(({ id }) => id)
    );
  });

  it("persists only configurable fields and resolves the runtime profile", async () => {
    const { root, store } = await createStore();
    const input = editableDefaults();
    const agent = input.agents.find(({ id }) => id === "character_design")!;
    agent.systemPrompt = "自定义长篇人物提示词";
    agent.welcomeShortcuts[1] = "追踪本章人物状态";
    agent.readAccess.materialKinds = ["character"];

    const saved = await store.save(input);
    const resolved = await store.resolve("character_design");
    const disk = JSON.parse(
      await readFile(
        join(root, "config", "long-workspace-agents.json"),
        "utf8"
      )
    ) as Record<string, unknown>;

    expect(saved.agents).toHaveLength(6);
    expect(resolved.systemPrompt).toBe("自定义长篇人物提示词");
    expect(resolved.readAccess.materialKinds).toEqual(["character"]);
    expect(resolved.writeAccess).toEqual(
      DEFAULT_LONG_AGENT_SETTINGS.agents.find(
        ({ id }) => id === "character_design"
      )!.writeAccess
    );
    expect(JSON.stringify(disk)).not.toContain("writeAccess");
    expect(JSON.stringify(disk)).not.toContain("capabilities");
  });

  it("resets one role without changing the other five roles", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    input.agents.find(({ id }) => id === "worldbuilding")!.systemPrompt =
      "custom:world";
    input.agents.find(({ id }) => id === "plot_design")!.systemPrompt =
      "custom:plot";
    await store.save(input);

    const reset = await store.reset("worldbuilding");
    expect(
      reset.agents.find(({ id }) => id === "worldbuilding")!.systemPrompt
    ).toBe(
      DEFAULT_LONG_AGENT_SETTINGS.agents.find(
        ({ id }) => id === "worldbuilding"
      )!.systemPrompt
    );
    expect(
      reset.agents.find(({ id }) => id === "plot_design")!.systemPrompt
    ).toBe("custom:plot");
  });

  it("upgrades only the retired worldbuilding builtin prompt", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    const worldbuilding = input.agents.find(
      ({ id }) => id === "worldbuilding"
    )!;
    worldbuilding.systemPrompt =
      "你负责长篇世界观。先查询现有结构和相关正文，再提出可审阅的结构或文档变更；不得凭空覆盖未读取的设定。";
    await store.save(input);

    expect(
      (await store.list()).agents.find(({ id }) => id === "worldbuilding")!
        .systemPrompt
    ).toBe(
      DEFAULT_LONG_AGENT_SETTINGS.agents.find(
        ({ id }) => id === "worldbuilding"
      )!.systemPrompt
    );

    worldbuilding.systemPrompt = "自定义世界观提示词";
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "worldbuilding")!
        .systemPrompt
    ).toBe("自定义世界观提示词");
  });

  it("upgrades the retired character builtin prompt without replacing customization", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    const character = input.agents.find(
      ({ id }) => id === "character_design"
    )!;
    character.systemPrompt = `你负责长篇人物设计。模型只使用人物业务标识：
- 每名人物以 character_id 唯一定位；人物内容按 core_profile、relationships、current_state、history 四种 document 区分。
- 其余实现细节由工具内部处理；不要索取、推断或复述。

工作规则：
1. 先调用 list_characters 获取人物列表，可用 group 筛选；需要查找已有内容时使用 search_characters。
2. 读取正文使用 read_character；必须同时指定 character_id 和 document。需要编辑前，必须以 mode=full 完整读取。
3. 新增人物使用 create_character；一次只创建一名人物及四份空白文档，不得在创建参数中夹带初始化正文。创建后使用返回的 character_id，分别调用 write_character_file 写入需要的文档。
4. 新人物空白文档的首次正文、空正文写入或用户明确要求整体重写时使用 write_character_file；已有正文必须先以 mode=full 完整读取，并明确允许覆盖。
5. 局部修改必须先以 mode=full 完整读取，再使用 edit_character_file 做唯一原文片段替换。
6. 人物重命名、别名、分组、删除和排序使用 propose_long_mutation；人物创建不得使用该工具，必须使用 create_character。不得把多名人物拼接到同一文件中。
7. 核心档案表达稳定身份与设计意图；首次连续性提交后，人物关系、当前状态和历史轨迹由连续性账本接管，人物设计智能体只能直接修改核心档案。
8. 搜索命中和当前页面快照只用于定位与理解；修改前仍须完整读取目标文档。
9. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`;
    await store.save(input);

    expect(
      (await store.list()).agents.find(({ id }) => id === "character_design")!
        .systemPrompt
    ).toContain("list_worldbuilding");

    character.systemPrompt = "自定义人物提示词";
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "character_design")!
        .systemPrompt
    ).toBe("自定义人物提示词");
  });

  it("upgrades the retired plot builtin prompt without replacing customization", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    const plot = input.agents.find(({ id }) => id === "plot_design")!;
    plot.systemPrompt =
      "你负责长篇剧情结构。严格区分故事发生顺序、章节叙述顺序和读者信息进度；所有修改先形成带影响预览的结构提案。";
    await store.save(input);

    expect(
      (await store.list()).agents.find(({ id }) => id === "plot_design")!
        .systemPrompt
    ).toContain("list_plot_design");

    plot.systemPrompt = "自定义剧情提示词";
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "plot_design")!
        .systemPrompt
    ).toBe("自定义剧情提示词");
  });

  it("upgrades the retired chapter-writer role without replacing customization", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    const writer = input.agents.find(
      ({ id }) => id === "expert_section_writer"
    )!;
    writer.systemPrompt =
      "你是长篇单章写手。每次只处理当前章卡，只负责写出可供核验的正文证据；必须依据查询到的设定与已提交连续性，不得自行确定章末状态、接续包或宣称提交账本。";
    writer.welcomeShortcuts = [
      "写当前章",
      "续写当前章",
      "检查本章连续性"
    ];
    await store.save(input);

    const upgraded = (await store.list()).agents.find(
      ({ id }) => id === "expert_section_writer"
    )!;
    expect(upgraded.systemPrompt).toContain(
      "本智能体唯一的写作产物是当前章小说正文"
    );
    expect(upgraded.systemPrompt).toContain(
      "不得编写、草拟、补全或修改章末人物状态、交接文档"
    );
    expect(upgraded.welcomeShortcuts).toEqual([
      "写当前章",
      "续写当前章",
      "检查本章正文"
    ]);

    writer.systemPrompt = "自定义单章提示词";
    writer.welcomeShortcuts = ["自定义一", "自定义二", "自定义三"];
    await store.save(input);
    const customized = (await store.list()).agents.find(
      ({ id }) => id === "expert_section_writer"
    )!;
    expect(customized.systemPrompt).toBe("自定义单章提示词");
    expect(customized.welcomeShortcuts).toEqual([
      "自定义一",
      "自定义二",
      "自定义三"
    ]);
  });

  it("upgrades only the byte-identical retired continuity-ledger builtin", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    const continuity = input.agents.find(
      ({ id }) => id === "continuity_ledger"
    )!;
    continuity.systemPrompt = RETIRED_CONTINUITY_LEDGER_SYSTEM_PROMPT;
    await store.save(input);

    const upgraded = (await store.list()).agents.find(
      ({ id }) => id === "continuity_ledger"
    )!;
    expect(upgraded.systemPrompt).toBe(
      DEFAULT_LONG_AGENT_SETTINGS.agents.find(
        ({ id }) => id === "continuity_ledger"
      )!.systemPrompt
    );

    const customizedPrompt =
      `${RETIRED_CONTINUITY_LEDGER_SYSTEM_PROMPT}\n\n` +
      "自定义补充：保留本地核验步骤。";
    continuity.systemPrompt = customizedPrompt;
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "continuity_ledger")!
        .systemPrompt
    ).toBe(customizedPrompt);
  });

  it("does not silently overwrite a malformed settings file", async () => {
    const { root, store } = await createStore();
    const path = join(root, "config", "long-workspace-agents.json");
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(path, "{broken", "utf8");

    await expect(store.list()).rejects.toThrow();
  });
});
