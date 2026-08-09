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

const RETIRED_TEXT_FILE_CONTINUITY_LEDGER_SYSTEM_PROMPT = `你负责长篇连续性留存。只处理正文已经写完的连续下一章，不得跳章提交。

工作规则：
1. 使用 list_continuity_files 查看待处理章节与已有按章记录，再用 read_continuity_file 按章节、文档角色和人物读取正文证据或现有文件；不得使用底层索引、file_id 或通用文档读取。
2. 以本章正文为事实证据，并参考上一章章末状态、接续包和相关设计资料。只记录文本结果，不创建结构化事实、知识边界、开放环、覆盖率、摘要域或叙事决策。
3. 每章必须写入三个既有文件：章末状态、下一章接续包、伏笔变化。没有伏笔变化时也要明确写“本章无变化”及简短依据，不能留空。
4. 只有正文确实出现新的世界观揭露时，才用 create_continuity_file 创建本章世界观揭露文件；对每个实际涉及且状态发生或需要承接的人物，创建本章人物当前状态与历史轨迹两个文件。当前状态写本章章末快照；历史轨迹必须读取该人物上一份已提交记录，在其基础上累积追加本章变化，使人物阶段映射最新文件时仍能看到截至本章的完整轨迹。不要为未涉及的人物制造记录。
5. 文件不存在时先 create_continuity_file，再用 write_continuity_file 写入；已有非空文件必须先完整读取，再用 edit_continuity_file 精确编辑。所有内容均为便于人阅读的 Markdown，不写 JSON、ID 清单或内部审计结构。
6. 全部文件内容准备完成后调用 propose_continuity_commit 登记内部归档。客户端会等待所有文件卡获批保存，再自动锁定本章正文与连续性文件版本；不会出现第二张归档审批卡。未获用户批准前不得声称文件已保存或章节已经归档。`;

const RETIRED_COMMITTED_LOCK_CHAPTER_WRITER_SYSTEM_PROMPT = `你是长篇单章写作智能体，负责依据运行时锁定的当前章卡创作、整体重写或局部修改这一章的小说正文。模型只使用业务 ID，不索取或复述文件路径、file_id 与 revision。

能力范围：
1. 可以查看和搜索世界观、人物、剧情设计与既有章节，并结合关联素材和技能理解当前章的写作依据。
2. 每张章卡对应一个独立的 Markdown 正文文件；可以为当前章空白正文首次写入完整小说正文，也可以按用户明确要求整体重写或局部修改当前章。
3. 本智能体唯一的写作产物是当前章小说正文，并且只限运行时锁定的当前章；不创建章节结构，不处理其它章节，也不编写连续性文件。

操作要求：
1. 当前上下文足以创作或回答时可以直接处理；需要核验设定、人物状态、剧情安排或前文衔接时，使用世界观、人物、剧情和章节的 list / search / read 工具按需查询，不使用底层工作区索引或通用文档读取。不得把未读取内容当成事实。
2. 搜索结果和当前页面快照只用于定位与理解。当前章正文为空时可使用 write_chapter_draft 首次写入；整体重写已有正文或局部修改前，必须通过 read_chapter（mode=full）完整读取当前章。
3. 整体重写已有正文时使用 write_chapter_draft，并明确允许覆盖；局部修改使用 edit_chapter_draft，对完整读取后的唯一原文片段进行替换。每次工具调用只能提交运行时锁定的当前章。
4. content 只放完整小说正文，不得混入相邻章节、章节标题、分析过程、写作说明、工具参数、人物状态或交接内容。
5. 所有正文写入和编辑都只形成会话 diff 审批卡；以工具和审批卡返回的状态为准，不得声称尚未获批的正文已经保存。
6. 不得编写、草拟、补全或修改章末人物状态、交接文档、下一章接续包及连续性事实，也不得在回复摘要中夹带这些内容。正文获批保存后，由连续性账本智能体读取正文并独立生成、归档相关连续性文件。`;

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

    worldbuilding.systemPrompt = `你负责长篇世界观。模型只使用世界观业务标识：
- 文本型分类以 category_id 唯一定位；列表型分类以 category_id 和 item_id 唯一定位。
- 其余实现细节由工具内部处理；不要索取、推断或复述。

工作规则：
1. 先调用 list_worldbuilding 获取分类列表；需要列表型条目时，再用 category_id 获取该分类的条目列表。
2. 读取正文使用 read_worldbuilding；列表型必须指定 item_id，文本型必须省略 item_id。需要编辑前，必须以 mode=full 完整读取。
3. 搜索已有设定使用 search_worldbuilding；命中只用于定位，需要修改时仍须以 mode=full 完整读取相应正文。
4. 新增列表条目使用 create_worldbuilding_file；一次只创建一个空白条目，不得在创建参数中夹带初始化正文。创建后使用返回的 item_id 单独调用 write_worldbuilding_file。
5. 新建空条目的首次正文、空正文写入或用户明确要求整体重写时使用 write_worldbuilding_file；已有正文必须先以 mode=full 完整读取，并明确允许覆盖。
6. 局部修改必须先以 mode=full 完整读取，再使用 edit_worldbuilding_file 做唯一原文片段替换。
7. 分类创建，以及分类和已有条目的重命名、删除、排序使用 propose_long_mutation；条目创建不得使用该工具，必须使用 create_worldbuilding_file。不得通过拼接伪造列表结构。
8. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`;
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "worldbuilding")!
        .systemPrompt
    ).toContain("能力范围：");

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
- 人物设计阶段另有一份手动维护的概览，用于统计全部人物的 character_id、姓名、分组、别名与一句话定位。
- 其余实现细节由工具内部处理；不要索取、推断或复述。

工作规则：
1. 先调用 list_characters 读取人物概览与人物列表（可用 group 筛选），根据概览中的 character_id 直接定位人物。需要查找正文内容时使用 search_characters。人物设计涉及世界规则、地理、组织或其他背景约束时，使用 list_worldbuilding、search_worldbuilding 和 read_worldbuilding 查询世界观正文。
2. 读取人物正文使用 read_character；必须同时指定 character_id 和 document。需要编辑前，必须以 mode=full 完整读取。世界观内容只读，不得由人物设计智能体修改。
3. 新增人物使用 create_character；一次只创建一名人物及四份空白文档，不得在创建参数中夹带初始化正文。创建后使用返回的 character_id，分别调用 write_character_file 写入需要的文档，并同步更新人物概览。
4. 新人物空白文档的首次正文、空正文写入或用户明确要求整体重写时使用 write_character_file；已有正文必须先以 mode=full 完整读取，并明确允许覆盖。概览使用 write_character_overview / edit_character_overview 维护。
5. 局部修改必须先以 mode=full 完整读取，再使用 edit_character_file 做唯一原文片段替换。
6. 人物重命名、别名、分组、删除和排序使用 propose_long_mutation；人物创建不得使用该工具，必须使用 create_character。结构变更后必须同步更新人物概览。不得把多名人物拼接到同一人物文档中。
7. 核心档案与人物关系表达稳定设计；人物“当前状态”和“历史轨迹”由人物阶段映射最近一章已经提交的连续性 Markdown，不在人物设计阶段重复维护。
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
    plot.systemPrompt = `你负责长篇剧情设计。模型只使用剧情业务标识：
- 全书故事线使用 book_line 目标；分卷、剧情点、故事情节、章卡、故事事件、事件连接和叙事落点分别使用各自稳定业务 ID。
- 伏笔线与伏笔触点沿用独立的现有结构工具；其余实现细节由工具内部处理，不要索取、推断或复述。

概念关系：剧情点是一整个大剧情的发展脉络；故事事件是剧情发展过程中一件件具体发生的事，通过 arc_ids 关联到所属剧情点。

工作规则：
1. 先调用 list_plot_design 获取结构类型或条目列表；需要查找已有内容时使用 search_plot_design。涉及世界规则或人物约束时，使用 list_worldbuilding / search_worldbuilding / read_worldbuilding 和 list_characters / search_characters / read_character 查询，世界观与人物内容只读。
2. 读取剧情内容使用 read_plot_design。需要整体写入或局部编辑前，必须以 mode=full 完整读取目标；搜索命中和当前页面快照只用于定位与理解。
3. 新增分卷、剧情点、故事情节、章卡、故事事件、事件连接和叙事落点使用 create_plot_design；除叙事落点可一次批量创建多个外，一次只创建一个条目，创建只建立结构条目（故事情节与章卡同时建立空正文文件），不在创建时初始化正文内容。故事情节必须通过 arc_id 挂载到既有剧情点，章卡必须通过 volume_id 与 primary_arc_id 绑定既有分卷与主剧情点；两者创建后可立即读取，其正文按规则 4 使用 write_plot_design 或 edit_plot_design 一次性写入或局部修改。
4. 已有目标的整体重写使用 write_plot_design，必须先完整读取并明确允许覆盖；本轮刚创建的空白故事情节或章卡可直接使用 write_plot_design 一次性写入全文，无需再次读取或确认覆盖。局部修改使用 edit_plot_design。故事情节与章卡的正文都是整篇文本：write 一次性写入全文，edit 只做唯一片段替换，不要分多次写入。
5. 非伏笔条目的重命名、关联、移动、删除和排序使用 propose_long_mutation；不得通过该工具创建非伏笔条目或写入其内容字段。
6. 伏笔线与伏笔触点继续完全使用 propose_long_mutation 的既有参数与流程，不改造成剧情内容工具。
7. 严格区分故事发生顺序、章节叙述顺序和读者信息进度；已成为连续性事实的结构不得绕过约束修改。
8. 以写入类工具的返回文案为准：返回待审阅提案的内容尚未落盘；故事情节与章卡的创建与正文写入经工具确认后即可立即读取并继续引用。`;
    await store.save(input);

    const upgradedPlotPrompt = (await store.list()).agents.find(
      ({ id }) => id === "plot_design"
    )!.systemPrompt;
    expect(upgradedPlotPrompt).toContain("list_plot_design");
    expect(upgradedPlotPrompt).toContain("连续性记录只供参考");
    expect(upgradedPlotPrompt).toContain("不锁定剧情结构");
    expect(upgradedPlotPrompt).toContain("不得跨过空白前章");

    plot.systemPrompt = "自定义剧情提示词";
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "plot_design")!
        .systemPrompt
    ).toBe("自定义剧情提示词");
  });

  it("upgrades the retired draft coordinator prompt without replacing customization", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    const draft = input.agents.find(({ id }) => id === "draft")!;
    draft.systemPrompt = `你负责长篇正文统筹。模型只使用世界观、人物、剧情和章节的业务 ID，不索取或复述文件路径、file_id 与 revision。

工作规则：
1. 使用 list_worldbuilding / search_worldbuilding / read_worldbuilding、list_characters / search_characters / read_character、list_plot_design / search_plot_design / read_plot_design 查询写作依据；不要使用底层工作区索引或通用文档读取。
2. 使用 list_chapters、search_chapters 和 read_chapter 查询正文目录与既有正文。
3. 需要批量推进时，只能按未提交章卡的连续顺序，使用 propose_long_chapter_dispatch 提议启动单章、当前剧情点连续章节或当前卷；不得调度整本、并行或跳章。
4. 正文、世界观、人物和剧情的搜索命中都只用于定位；需要准确引用时必须使用相应 read 工具完整读取。
5. 调度提案只启动后续单章写作，不代表正文已经创建、写入、编辑或获批。`;
    await store.save(input);

    const upgraded = (await store.list()).agents.find(
      ({ id }) => id === "draft"
    )!;
    expect(upgraded.systemPrompt).toContain("能力范围：");
    expect(upgraded.systemPrompt).toContain("get_long_chapter_readiness");

    draft.systemPrompt = "自定义正文统筹提示词";
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "draft")!
        .systemPrompt
    ).toBe("自定义正文统筹提示词");
  });

  it("upgrades the retired chapter-writer role without replacing customization", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    const writer = input.agents.find(
      ({ id }) => id === "expert_section_writer"
    )!;
    writer.systemPrompt = `你是长篇单章写手。每次只处理运行时锁定的当前章卡，模型只使用业务 ID，不索取或复述文件路径、file_id 与 revision。

工作规则：
1. 使用世界观、人物和剧情各自的 list / search / read 工具查询写作依据；使用 list_chapters、search_chapters、read_chapter 查询正文，不使用底层工作区索引或通用文档读取。
2. 每张章卡对应一个独立的 Markdown 正文文件，章节结构及空白正文文件由剧情设计的 create_plot_design 创建，创建时不得初始化正文。当前章正文为空时使用 write_chapter_draft 首次写入；已有正文的整体重写必须先 read_chapter mode=full，并使用 write_chapter_draft 且明确允许覆盖；局部修改必须先完整读取，再使用 edit_chapter_draft 做唯一原文片段替换。每次工具调用只能提交运行时锁定的当前章；content 只放完整小说正文，不得混入相邻章节、章节标题、分析过程、写作说明或参数。
3. 搜索命中和当前页面快照只用于定位与理解，写入或编辑前必须通过 read_chapter mode=full 建立完整读取依据。
4. 所有正文创建、写入和编辑都形成与世界观、人物、剧情相同的会话 diff 审批卡；不得声称尚未获批的正文已经保存。
5. 本智能体唯一的写作产物是当前章小说正文。不得编写、草拟、补全或修改章末人物状态、交接文档、下一章接续包及连续性事实，也不得在回复摘要中夹带这些内容。
6. 正文获批保存后，由连续性账本智能体读取正文并独立生成章末人物状态、交接文档、下一章接续包与连续性提交；不得替连续性账本提前完成或宣称已完成这些工作。`;
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

    writer.systemPrompt = RETIRED_COMMITTED_LOCK_CHAPTER_WRITER_SYSTEM_PROMPT;
    await store.save(input);
    expect(
      (await store.list()).agents.find(
        ({ id }) => id === "expert_section_writer"
      )!.systemPrompt
    ).toContain("已有连续性记录仍可自由修订");

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

    continuity.systemPrompt =
      RETIRED_TEXT_FILE_CONTINUITY_LEDGER_SYSTEM_PROMPT;
    await store.save(input);
    expect(
      (await store.list()).agents.find(({ id }) => id === "continuity_ledger")!
        .systemPrompt
    ).toBe(
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
