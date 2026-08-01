import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  LONG_AGENT_IDS,
  LongAgentIdSchema,
  LongAgentSettingsInputSchema,
  LongAgentSettingsSchema,
  getDefaultLongAgentProfile,
  type LongAgentId,
  type LongAgentProfile,
  type LongAgentReadAccess,
  type LongAgentSettings,
  type LongAgentSettingsInput,
  type LongAgentSettingsInputAgent
} from "@deepwrite/contracts";

interface DiskLongAgentSettings extends LongAgentSettingsInput {
  version: 1;
}

/** Byte-identical retired builtins are upgraded; customized prompts stay put. */
const RETIRED_WORLDBUILDING_SYSTEM_PROMPTS: readonly string[] = [
  "你负责长篇世界观。先查询现有结构和相关正文，再提出可审阅的结构或文档变更；不得凭空覆盖未读取的设定。"
];

const RETIRED_CHARACTER_DESIGN_SYSTEM_PROMPTS: readonly string[] = [
  `你负责长篇人物设计。人物列表不是一份聚合正文：
- 每名人物都有稳定 character_id，并拥有核心档案、人物关系、当前状态、历史轨迹四份独立 Markdown 文件。
- 核心档案表达稳定身份与设计意图；当前状态和历史轨迹表达连续性事实，不能与某一章节的临时人物状态混写。

工作规则：
1. 先调用 get_long_workspace_index 确认人物 ID、分组、别名和四份文件关系，并查询相关世界观、事件与连续性记录。
2. 批量新增人物使用 create_characters；可在同一次调用中提供各自四份文件的初始内容。
3. 读取人物内容使用 read_character_document，必须同时指定 character_id 和 document。
4. 空文件或用户明确要求整体重写时使用 write_character_document；已有正文必须先完整读取，并明确允许覆盖。
5. 局部修改必须先完整读取，再使用 replace_character_text 做唯一原文片段替换。
6. 人物重命名、别名、分组、删除和排序使用 propose_long_mutation；不得把多名人物拼接到同一文件中。
7. 首次连续性提交后，人物关系、当前状态和历史轨迹由连续性账本接管；人物设计智能体只能直接修改核心档案。
8. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`,
  `你负责长篇人物设计。模型只使用人物业务标识：
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
9. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`,
  `你负责长篇人物设计。模型只使用人物业务标识：
- 每名人物以 character_id 唯一定位；人物内容按 core_profile、relationships、current_state、history 四种 document 区分。
- 其余实现细节由工具内部处理；不要索取、推断或复述。

工作规则：
1. 先调用 list_characters 获取人物列表，可用 group 筛选；需要查找已有内容时使用 search_characters。人物设计涉及世界规则、地理、组织或其他背景约束时，使用 list_worldbuilding、search_worldbuilding 和 read_worldbuilding 查询世界观正文。
2. 读取人物正文使用 read_character；必须同时指定 character_id 和 document。需要编辑前，必须以 mode=full 完整读取。世界观内容只读，不得由人物设计智能体修改。
3. 新增人物使用 create_character；一次只创建一名人物及四份空白文档，不得在创建参数中夹带初始化正文。创建后使用返回的 character_id，分别调用 write_character_file 写入需要的文档。
4. 新人物空白文档的首次正文、空正文写入或用户明确要求整体重写时使用 write_character_file；已有正文必须先以 mode=full 完整读取，并明确允许覆盖。
5. 局部修改必须先以 mode=full 完整读取，再使用 edit_character_file 做唯一原文片段替换。
6. 人物重命名、别名、分组、删除和排序使用 propose_long_mutation；人物创建不得使用该工具，必须使用 create_character。不得把多名人物拼接到同一文件中。
7. 核心档案表达稳定身份与设计意图；首次连续性提交后，人物关系、当前状态和历史轨迹由连续性账本接管，人物设计智能体只能直接修改核心档案。
8. 搜索命中和当前页面快照只用于定位与理解；修改前仍须完整读取目标文档。
9. 所有写入都只形成待审阅提案，不得声称尚未获批的内容已经落盘。`
];

const RETIRED_PLOT_DESIGN_SYSTEM_PROMPTS: readonly string[] = [
  "你负责长篇剧情结构。严格区分故事发生顺序、章节叙述顺序和读者信息进度；所有修改先形成带影响预览的结构提案。"
];

const RETIRED_EXPERT_SECTION_WRITER_SYSTEM_PROMPTS: readonly string[] = [
  "你是长篇单章写手。每次只处理当前章卡，只负责写出可供核验的正文证据；必须依据查询到的设定与已提交连续性，不得自行确定章末状态、接续包或宣称提交账本。",
  `你是长篇单章写手。每次只处理运行时锁定的当前章卡，模型只使用业务 ID，不索取或复述文件路径、file_id 与 revision。

工作规则：
1. 使用世界观、人物和剧情各自的 list / search / read 工具查询写作依据；使用 list_chapters、search_chapters、read_chapter 查询正文，不使用底层工作区索引或通用文档读取。
2. 每张章卡对应一个独立的 Markdown 正文文件，章节结构及空白正文文件由剧情设计的 create_plot_design 创建，创建时不得初始化正文。当前章正文为空时使用 write_chapter_draft 首次写入；已有正文的整体重写必须先 read_chapter mode=full，并使用 write_chapter_draft 且明确允许覆盖；局部修改必须先完整读取，再使用 edit_chapter_draft 做唯一原文片段替换。每次工具调用只能提交运行时锁定的当前章；content 只放完整小说正文，不得混入相邻章节、章节标题、分析过程、写作说明或参数。
3. 搜索命中和当前页面快照只用于定位与理解，写入或编辑前必须通过 read_chapter mode=full 建立完整读取依据。
4. 所有正文创建、写入和编辑都形成与世界观、人物、剧情相同的会话 diff 审批卡；不得声称尚未获批的正文已经保存。
5. 只负责正文；章末人物状态、下一章接续包和连续性事实由账本智能体核验生成，不得自行写入或宣称已提交。`
];

const RETIRED_CONTINUITY_LEDGER_SYSTEM_PROMPTS: readonly string[] = [
  `你负责长篇连续性账本。只处理正文已经写完的连续下一章，不得跳章提交。

工作规则：
1. 世界观、人物、剧情、正文和既有连续性账本分别使用各阶段的 list / search / read 工具查询；先看列表与概览，再按业务 ID 读取核验所需的具体内容。不得使用底层工作区索引、file_id 或通用文档读取。
2. 以本章正文为唯一事实证据，结合上一章章末状态与接续包，逐域核对人物、关系、世界、剧情、伏笔、知识边界和开放环。
3. 使用同组的 set_long_ledger_* 工具逐项暂存核验结果或变更；每次调用只处理一个事实、知识边界、开放环、人物文件、核验域、摘要章节、叙事落点或伏笔触点。
4. 新事实和新开放环省略 ID，由工具生成并返回稳定 fact_id / loop_id；后续知识边界、开放环和接续包必须使用工具返回的 ID，不得传 null 或自行猜测。
5. 六个 coverage 域和六个 chapter summary 章节必须分别逐项设置；叙事落点与伏笔触点也必须逐项判定。
6. 逐项准备完毕后，最后单独调用 propose_long_ledger_commit，生成本章唯一的一张原子提交提案。暂存和最终提案都不直接写磁盘，不得声称尚未获批的账本已经提交。`
];

const RETIRED_EXPERT_SECTION_WRITER_SHORTCUTS = [
  "写当前章",
  "续写当前章",
  "检查本章连续性"
] as const;

function usesRetiredExpertSectionWriterShortcuts(
  shortcuts: readonly string[]
): boolean {
  return RETIRED_EXPERT_SECTION_WRITER_SHORTCUTS.every(
    (shortcut, index) => shortcuts[index] === shortcut
  );
}

function cloneReadAccess(access: LongAgentReadAccess): LongAgentReadAccess {
  return {
    workspaceRoots: [...access.workspaceRoots],
    materialKinds: [...access.materialKinds],
    skillKinds: [...access.skillKinds]
  };
}

function cloneInputAgent(
  agent: LongAgentSettingsInputAgent
): LongAgentSettingsInputAgent {
  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    welcomeShortcuts: [
      agent.welcomeShortcuts[0],
      agent.welcomeShortcuts[1],
      agent.welcomeShortcuts[2]
    ],
    readAccess: cloneReadAccess(agent.readAccess)
  };
}

function cloneProfile(profile: LongAgentProfile): LongAgentProfile {
  return {
    ...profile,
    welcomeShortcuts: [
      profile.welcomeShortcuts[0],
      profile.welcomeShortcuts[1],
      profile.welcomeShortcuts[2]
    ],
    readAccess: cloneReadAccess(profile.readAccess),
    writeAccess: {
      workspaceRoots: [...profile.writeAccess.workspaceRoots],
      capabilities: [...profile.writeAccess.capabilities]
    }
  };
}

function defaultsAsInput(): LongAgentSettingsInput {
  return {
    workspaceType: "long",
    agents: DEFAULT_LONG_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      welcomeShortcuts: [
        profile.welcomeShortcuts[0],
        profile.welcomeShortcuts[1],
        profile.welcomeShortcuts[2]
      ],
      readAccess: cloneReadAccess(profile.readAccess)
    }))
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

function parseDiskSettings(raw: unknown): LongAgentSettingsInput {
  if (raw === undefined) return defaultsAsInput();
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    raw.version !== 1
  ) {
    throw new Error("长篇智能体配置版本无效，已停止加载以避免覆盖原文件。");
  }
  const { version: _version, ...settings } = raw as DiskLongAgentSettings;
  const parsed = LongAgentSettingsInputSchema.safeParse(settings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `长篇智能体配置内容无效，已停止加载以避免覆盖原文件${
        issue ? `：${issue.path.join(".") || "root"} ${issue.message}` : "。"
      }`
    );
  }
  return {
    workspaceType: "long",
    agents: parsed.data.agents.map((agent) => {
      const cloned = cloneInputAgent(agent);
      const builtin = getDefaultLongAgentProfile(agent.id);
      if (
        (agent.id === "worldbuilding" &&
          RETIRED_WORLDBUILDING_SYSTEM_PROMPTS.includes(agent.systemPrompt)) ||
        (agent.id === "character_design" &&
          RETIRED_CHARACTER_DESIGN_SYSTEM_PROMPTS.includes(
            agent.systemPrompt
          )) ||
        (agent.id === "plot_design" &&
          RETIRED_PLOT_DESIGN_SYSTEM_PROMPTS.includes(agent.systemPrompt)) ||
        (agent.id === "expert_section_writer" &&
          RETIRED_EXPERT_SECTION_WRITER_SYSTEM_PROMPTS.includes(
            agent.systemPrompt
          )) ||
        (agent.id === "continuity_ledger" &&
          RETIRED_CONTINUITY_LEDGER_SYSTEM_PROMPTS.includes(
            agent.systemPrompt
          ))
      ) {
        cloned.systemPrompt = builtin.systemPrompt;
      }
      if (
        agent.id === "expert_section_writer" &&
        usesRetiredExpertSectionWriterShortcuts(agent.welcomeShortcuts)
      ) {
        cloned.welcomeShortcuts = [
          builtin.welcomeShortcuts[0],
          builtin.welcomeShortcuts[1],
          builtin.welcomeShortcuts[2]
        ];
      }
      return cloned;
    })
  };
}

export class LongAgentConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(
      userDataPath,
      "config",
      "long-workspace-agents.json"
    );
  }

  async list(): Promise<LongAgentSettings> {
    await this.writeChain;
    return this.toPublicSettings(await this.readInput());
  }

  async save(rawInput: LongAgentSettingsInput): Promise<LongAgentSettings> {
    const input = LongAgentSettingsInputSchema.parse(rawInput);
    let saved: LongAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const normalized: LongAgentSettingsInput = {
        workspaceType: "long",
        agents: input.agents.map(cloneInputAgent)
      };
      await this.writeInput(normalized);
      saved = this.toPublicSettings(normalized);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async reset(rawAgentId?: LongAgentId): Promise<LongAgentSettings> {
    const agentId = rawAgentId
      ? LongAgentIdSchema.parse(rawAgentId)
      : undefined;
    let saved: LongAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const next = agentId ? await this.readInput() : defaultsAsInput();
      if (agentId) {
        const builtin = getDefaultLongAgentProfile(agentId);
        const replacement: LongAgentSettingsInputAgent = {
          id: builtin.id,
          systemPrompt: builtin.systemPrompt,
          welcomeShortcuts: [
            builtin.welcomeShortcuts[0],
            builtin.welcomeShortcuts[1],
            builtin.welcomeShortcuts[2]
          ],
          readAccess: cloneReadAccess(builtin.readAccess)
        };
        const index = next.agents.findIndex((agent) => agent.id === agentId);
        if (index < 0) {
          throw new Error(`长篇智能体配置缺少角色：${agentId}`);
        }
        next.agents[index] = replacement;
      }
      const validated = LongAgentSettingsInputSchema.parse(next);
      await this.writeInput(validated);
      saved = this.toPublicSettings(validated);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async resolve(rawAgentId: LongAgentId): Promise<LongAgentProfile> {
    const agentId = LongAgentIdSchema.parse(rawAgentId);
    const settings = await this.list();
    const profile = settings.agents.find((agent) => agent.id === agentId);
    return profile
      ? cloneProfile(profile)
      : cloneProfile(getDefaultLongAgentProfile(agentId));
  }

  private trackWrite(operation: Promise<unknown>): void {
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
  }

  private async readInput(): Promise<LongAgentSettingsInput> {
    return parseDiskSettings(await readJson(this.settingsPath));
  }

  private async writeInput(input: LongAgentSettingsInput): Promise<void> {
    const disk: DiskLongAgentSettings = {
      version: 1,
      workspaceType: "long",
      agents: input.agents.map(cloneInputAgent)
    };
    await atomicWriteJson(this.settingsPath, disk);
  }

  private toPublicSettings(
    input: LongAgentSettingsInput
  ): LongAgentSettings {
    const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
    return LongAgentSettingsSchema.parse({
      workspaceType: "long",
      agents: LONG_AGENT_IDS.map((id) => {
        const builtin = getDefaultLongAgentProfile(id);
        const override = byId.get(id);
        if (!override) return builtin;
        return {
          ...builtin,
          systemPrompt: override.systemPrompt,
          welcomeShortcuts: [
            override.welcomeShortcuts[0],
            override.welcomeShortcuts[1],
            override.welcomeShortcuts[2]
          ],
          readAccess: cloneReadAccess(override.readAccess),
          writeAccess: {
            workspaceRoots: [...builtin.writeAccess.workspaceRoots],
            capabilities: [...builtin.writeAccess.capabilities]
          }
        };
      })
    });
  }
}
