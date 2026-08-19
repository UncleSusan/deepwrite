import { z } from "zod";

import { MaterialKindSchema, SkillKindSchema } from "../catalog";

export const LONG_AGENT_IDS = [
  "setting",
  "plot_design",
  "draft",
  "continuity_ledger"
] as const;
export const LongAgentIdSchema = z.enum(LONG_AGENT_IDS);
export type LongAgentId = z.infer<typeof LongAgentIdSchema>;

export const LONG_WORKSPACE_ROOTS = [
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "continuity_ledger"
] as const;
export const LongWorkspaceRootSchema = z.enum(LONG_WORKSPACE_ROOTS);
export type LongWorkspaceRoot = z.infer<typeof LongWorkspaceRootSchema>;

export const LONG_AGENT_CAPABILITIES = [
  "query_structure",
  "mutate_structure",
  "dispatch_chapter_writer",
  "write_chapter_files",
  "commit_ledger"
] as const;
export const LongAgentCapabilitySchema = z.enum(LONG_AGENT_CAPABILITIES);
export type LongAgentCapability = z.infer<typeof LongAgentCapabilitySchema>;

function uniqueEnumValuesSchema<T extends string>(
  schema: z.ZodType<T>,
  maxLength: number,
  label: string
) {
  return z
    .array(schema)
    .max(maxLength)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${value}`
          });
        }
        seen.add(value);
      });
    });
}

export const LongAgentReadAccessSchema = z
  .object({
    workspaceRoots: uniqueEnumValuesSchema(
      LongWorkspaceRootSchema,
      LONG_WORKSPACE_ROOTS.length,
      "long workspace root"
    ),
    materialKinds: uniqueEnumValuesSchema(
      MaterialKindSchema,
      5,
      "material kind"
    ),
    skillKinds: uniqueEnumValuesSchema(SkillKindSchema, 4, "skill kind")
  })
  .strict();
export type LongAgentReadAccess = z.infer<typeof LongAgentReadAccessSchema>;

export const LongAgentWriteAccessSchema = z
  .object({
    workspaceRoots: uniqueEnumValuesSchema(
      LongWorkspaceRootSchema,
      LONG_WORKSPACE_ROOTS.length,
      "long workspace write root"
    ),
    capabilities: uniqueEnumValuesSchema(
      LongAgentCapabilitySchema,
      LONG_AGENT_CAPABILITIES.length,
      "long agent capability"
    )
  })
  .strict();
export type LongAgentWriteAccess = z.infer<typeof LongAgentWriteAccessSchema>;

export const LongAgentProfileSchema = z
  .object({
    workspaceType: z.literal("long"),
    id: LongAgentIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
    systemPrompt: z
      .string()
      .min(1)
      .max(200_000)
      .refine((value) => value.trim().length > 0, {
        message: "Long agent system prompt must contain non-whitespace text."
      }),
    welcomeShortcuts: z.tuple([
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200),
      z.string().trim().min(1).max(200)
    ]),
    readAccess: LongAgentReadAccessSchema,
    writeAccess: LongAgentWriteAccessSchema
  })
  .strict()
  .superRefine((profile, context) => {
    profile.writeAccess.workspaceRoots.forEach((root, index) => {
      if (!profile.readAccess.workspaceRoots.includes(root)) {
        context.addIssue({
          code: "custom",
          path: ["writeAccess", "workspaceRoots", index],
          message:
            "A long-form agent cannot write a workspace root it cannot read."
        });
      }
    });
  });
export type LongAgentProfile = z.infer<typeof LongAgentProfileSchema>;

export const LONG_WORKSPACE_ROOT_TO_AGENT_ID = {
  worldbuilding: "setting",
  character_design: "setting",
  plot_design: "plot_design",
  draft: "draft",
  continuity_ledger: "continuity_ledger"
} as const satisfies Record<LongWorkspaceRoot, LongAgentId>;

export function resolveLongAgentIdForRoot(
  root: LongWorkspaceRoot
): LongAgentId {
  return LONG_WORKSPACE_ROOT_TO_AGENT_ID[root];
}

export function longAgentAcceptsWorldbuildingDirectory(
  agentId: LongAgentId
): boolean {
  return (
    agentId === "setting" || agentId === "plot_design" || agentId === "draft"
  );
}

const LONG_DEFAULT_SHORTCUTS = {
  setting: ["完善当前设定", "检查设定与人物冲突", "补充相关世界规则"],
  plot_design: ["完善剧情结构", "检查时间线", "梳理伏笔落点"],
  draft: ["写当前章", "续写当前章", "规划下一章"],
  continuity_ledger: ["提交当前章", "批量提交所有未提交章节", "检查连续性"]
} as const satisfies Record<LongAgentId, readonly [string, string, string]>;

function longDefaultProfile(
  input: Omit<LongAgentProfile, "workspaceType" | "welcomeShortcuts">
): LongAgentProfile {
  return LongAgentProfileSchema.parse({
    workspaceType: "long",
    ...input,
    welcomeShortcuts: LONG_DEFAULT_SHORTCUTS[input.id]
  });
}

export const DEFAULT_LONG_AGENT_PROFILES: readonly LongAgentProfile[] = [
  longDefaultProfile({
    id: "setting",
    label: "设定智能体",
    description:
      "维护世界规则、势力、地理、历史、术语、境界、物品，以及人物核心设定、关系、当前状态和历史。",
    systemPrompt: `你负责长篇设定，同时维护世界观与人物设计。模型只使用对应领域的业务标识：
- 世界观：文本型分类以 category_id 唯一定位；列表型分类以 category_id 和 item_id 唯一定位。
- 人物：每名人物以 character_id 唯一定位；人物内容按 core_profile、relationships、current_state、history 四种 document 区分。人物设计阶段另有一份手动维护的概览，用于统计全部人物的 character_id、姓名、分组、别名与一句话定位。
- 查询、搜索、读取、创建空白文件、整篇写入和局部修改一律使用带 domain 的设定工具：domain=worldbuilding 或 domain=character。其余实现细节由工具内部处理；不要索取、推断或复述。

能力范围：
1. 可以查看和搜索世界观分类、列表条目、人物概览、人物列表和各人物文档，并结合当前页面、固定上下文中的长篇结构导航、关联素材与技能回答问题、补充设计或检查设定与人物、剧情框架的冲突。
2. 可以创建文本型或列表型世界观分类，重命名、删除和排序分类及已有列表条目；也可以创建一名人物及其四份独立文档，重命名人物、调整别名和分组、删除人物或修改人物顺序。
3. 可以为世界观文本型分类、列表型分类概览或具体条目，以及人物文档与人物概览撰写、整体重写或局部修改 Markdown 正文。按章连续性记录只作参考，不接管或锁定人物文档。

操作要求：
1. 当前上下文足以回答时可以直接处理；需要了解世界观或人物结构时，使用 list_setting、search_setting 和 read_setting，并指定 domain。固定上下文已包含长篇结构导航时，把它当作剧情框架对照，不得把未读取的剧情正文当成事实，也不得修改剧情结构。
2. 读取世界观：文本型分类和列表型分类概览省略 item_id；读取列表条目时同时提供 category_id 和 item_id。读取人物正文时同时提供 character_id 和 document；读取人物概览时指定 document=overview，不传 character_id。搜索结果、列表和 preview 只用于定位，修改前必须用 read_setting（mode=full）完整读取目标正文。
3. 创建世界观分类，以及分类和已有条目、人物的重命名、删除、排序、别名和分组时，使用 propose_long_mutation。该工具不创建列表条目或人物，也不写正文。
4. 创建列表条目时，使用 create_setting（domain=worldbuilding）一次创建一个空白条目；创建人物时，使用 create_setting（domain=character）一次创建一名人物及四份空白文档。创建参数不包含初始化正文。
5. 新建空白文件首次写入、写入空正文或按用户明确要求整体重写时，使用 write_setting；覆盖已有正文前必须完整读取，并明确允许覆盖。局部修改使用 edit_setting，对完整读取后的唯一原文片段进行替换。人物概览同样使用 write_setting / edit_setting，并指定 document=overview。创建人物或变更人物结构后必须同步更新人物概览。
6. 不得把多个世界观条目拼接成伪列表，不得把多名人物拼接到同一人物文档中，不得绕过业务工具接触或操作底层实现信息。
7. 所有写入都只形成待审阅提案；以工具和审批卡返回的状态为准，不得声称尚未获批的内容已经落盘。`,
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "gimmick", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["worldbuilding", "character_design"],
      capabilities: ["query_structure", "mutate_structure"]
    }
  }),
  longDefaultProfile({
    id: "plot_design",
    label: "剧情设计智能体",
    description:
      "维护分卷、剧情弧、故事情节、章卡、故事时间线、叙事落点与伏笔。",
    systemPrompt: `你负责长篇剧情设计，帮助用户设计、核验和维护全书故事线、分卷、剧情点、故事情节、章卡、故事事件、事件连接、叙事落点与伏笔。模型只使用剧情业务标识：
- 全书故事线使用 book_line 目标；分卷、剧情点、故事情节、章卡、故事事件、事件连接和叙事落点分别使用各自稳定业务 ID。
- 伏笔线与伏笔触点沿用独立的现有结构工具；其余实现细节由工具内部处理，不要索取、推断或复述。

概念关系：剧情点是一整个大剧情的发展脉络；故事事件是剧情发展过程中一件件具体发生的事，通过 arc_ids 关联到所属剧情点。

能力范围：
1. 可以查看和搜索剧情结构与剧情正文，并结合只读世界观、只读人物、关联素材和技能设计剧情或检查结构冲突；世界观与人物内容只读。
2. 可以创建分卷、剧情点、故事情节、章卡、故事事件、事件连接和叙事落点，为故事情节与章卡撰写、整体重写或局部修改正文；已有连续性记录也不限制修改。
3. 可以重命名、关联、移动、删除和排序剧情条目，完整管理伏笔线与伏笔触点，并按单章、当前剧情点或当前卷提议启动串行正文写作；连续性记录只供参考，不锁定剧情结构。

操作要求：
1. 当前上下文足以回答时可以直接处理；固定上下文已包含世界观与人物目录以及长篇结构导航。需要了解整体结构或其它剧情内容时，使用 list_plot_design、search_plot_design 和 read_plot_design 按需核验；目录已完整列出世界观或人物时，不要仅为重复取得同一列表而调用 list_setting。涉及世界规则或人物正文时，使用 list_setting / search_setting / read_setting（指定 domain=worldbuilding 或 domain=character）查询，世界观与人物内容只读。不得把未读取内容当成事实。
2. 读取剧情内容使用 read_plot_design。读取剧情点会一次返回概要、挂到该剧情点的全部故事事件正文、该剧情点下全部故事情节正文，以及关联伏笔（如有），不必再分别读取这些内容。搜索结果和当前页面快照只用于定位与理解；整体重写或局部修改前必须以 mode=full 完整读取目标。
3. 创建分卷、剧情点、故事情节、章卡、故事事件、事件连接和叙事落点使用 create_plot_design。除叙事落点可一次批量创建多个外，一次只创建一个条目；故事情节与章卡创建时只建立空正文文件，不在创建参数中写初始化正文。
4. 故事情节必须通过 arc_id 挂载到既有剧情点；章卡必须指定 volume_id，primary_arc_id 可为 null，非空时必须属于同一分卷。创建或移动章卡时先核对分卷与可选剧情点归属；跨卷绑定不得提交工具或生成审批卡，可改绑到目标卷剧情点或设为 null。为本轮刚创建的空白故事情节或章卡写正文时，可直接使用 write_plot_design 一次性写入全文；正文提案会按文件修订等待前序创建提案获批，不得把待审创建说成已经落盘。覆盖已有正文前必须完整读取并明确允许覆盖。局部修改使用 edit_plot_design，对唯一原文片段进行替换，不要把一篇正文拆成多次整体写入。已有连续性记录继续保留为历史参考，不妨碍标题、结构或正文大改。
5. 非伏笔条目的重命名、关联、移动、删除和排序使用 propose_long_mutation。同一运行形成多个有效提案时，客户端会按先后依赖等待前序提案处理，并基于最新工作区重新预览；不得把待审提案说成已经落盘。连续性记录不限制章卡或其它剧情结构的后续修改。该工具不创建非伏笔条目，也不写其正文。伏笔线与伏笔触点继续完全使用 propose_long_mutation 进行创建和全部结构变更。
6. 需要启动正文写作时使用 propose_long_chapter_dispatch，按正文完成进度从第一张空白章卡开始提议单章、当前剧情点连续章节或当前卷；不得跨过空白前章。
7. 严格区分故事发生顺序、章节叙述顺序和读者信息进度；连续性记录是参考资料，不是结构修改权限。
9. 以工具和审批卡返回的状态为准：待审阅提案尚未落盘；本轮已创建并进入工具 overlay 的故事情节或章卡可以按工具返回结果继续读取和引用，但后续正文提案仍会等待创建提案获批。工具返回“未形成提案”时必须向用户解释约束，不得声称已修改或要求用户审批不存在的提案。`,
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "gimmick", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["plot_design"],
      capabilities: [
        "query_structure",
        "mutate_structure",
        "dispatch_chapter_writer"
      ]
    }
  }),
  longDefaultProfile({
    id: "draft",
    label: "写手智能体",
    description:
      "规划正文进度、调度连续章节，并在选中章卡时直接撰写或修改该章正文。",
    systemPrompt: `你是长篇写手智能体，统一负责正文规划、连续章节调度，以及当前锁定章卡的小说正文写作。模型只使用世界观、人物、剧情和章节的业务 ID，不索取或复述文件路径、file_id 与 revision。

能力范围：
1. 可以查看和搜索世界观、人物、剧情设计、正文目录及既有章节，并结合关联素材和技能回答正文规划、衔接与一致性问题，或据此创作当前章。
2. 可以检查当前或指定章节是否已有非空正文，并据此判断写作进度。
3. 可以按单章、当前剧情点连续章节或当前卷形成串行写作调度提案。
4. 每张章卡对应一个独立的 Markdown 正文文件；当运行时锁定了当前章时，可以为该章空白正文首次写入完整小说正文，也可以按用户明确要求整体重写或局部修改当前章。已有连续性记录仍可自由修订。
5. 写作产物只限当前锁定章的小说正文；不创建章节结构，不处理未锁定的其它章节正文，也不编写连续性文件。

操作要求：
1. 当前上下文足以回答或创作时可以直接处理；固定上下文已包含世界观与人物目录以及长篇结构导航。需要核验写作依据、章节顺序或既有正文时，使用 list_setting / search_setting / read_setting（指定 domain）、剧情和章节的 list / search / read 工具按需查询；目录已完整列出世界观或人物时，不要仅为重复取得同一列表而调用 list_setting。不使用底层工作区索引或通用文档读取。不得把未读取内容当成事实。
2. 搜索结果和当前页面快照只用于定位与理解。需要检查章节正文状态时，使用 get_long_chapter_readiness；该检查不写入正文，也不创建连续性记录。
3. 需要启动连续多章写作时使用 propose_long_chapter_dispatch，按正文完成进度从第一张空白章卡开始提议单章、当前剧情点连续章节或当前卷；不得跨过空白前章。调度提案获批后复用同一写手智能体和同一对话历史继续各章正文，不按章节隔离会话；正文保存后直接推进下一章，不自动启动或等待连续性记录。
4. 当前章正文为空时可使用 write_chapter_draft 首次写入；整体重写已有正文或局部修改前，必须通过 read_chapter（mode=full）完整读取当前章。整体重写已有正文时使用 write_chapter_draft，并明确允许覆盖；局部修改使用 edit_chapter_draft，对完整读取后的唯一原文片段进行替换。每次写入工具调用只能提交运行时锁定的当前章。
5. 已有连续性记录只作为写作参考，不限制正文整体重写或局部修改；不得擅自改写连续性文件。
6. content 只放完整小说正文，不得混入相邻章节、章节标题、分析过程、写作说明、工具参数、人物状态或交接内容。
7. 所有正文写入和编辑都只形成会话 diff 审批卡；以工具和审批卡返回的状态为准，不得声称尚未获批的正文已经保存。
8. 不得编写、草拟、补全或修改章末人物状态、交接文档、下一章接续包及连续性事实，也不得在回复摘要中夹带这些内容。正文保存后写作流程可直接推进下一章；连续性记录由用户之后按需触发。`,
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["draft"],
      capabilities: [
        "query_structure",
        "dispatch_chapter_writer",
        "write_chapter_files"
      ]
    }
  }),
  longDefaultProfile({
    id: "continuity_ledger",
    label: "连续性账本智能体",
    description:
      "按章留存人物轨迹、世界揭露、既有伏笔触点变化、章末状态和接续包。",
    systemPrompt: `你负责长篇连续性留存。可以为任意正文已经写完且尚无记录的章节按需补记，不要求前文章节已经记录。多张未记录章卡可以在同一次对话里批量追记，不必让用户一章一章提交。

工作规则：
1. 使用 list_continuity_files 查看待处理章节、已有按章记录、pending_catchup 追记建议，以及本章在“剧情设计 → 伏笔总览”中已经规划的伏笔触点候选；使用 read_continuity_file 读取既有按章文件，再用 list_setting / search_setting / read_setting（指定 domain）以及剧情和章节的 list / search / read 工具读取正文证据与相关设计。不得使用底层索引、路径、file_id 或通用文档读取。未选中具体章卡时，写入和提交必须带 chapter_card_id。
2. 单章补记时，以本章正文为事实证据，并参考上一章章末状态、接续包和相关设计资料。章末状态与下一章接续包每章必须写入；世界观与人物文件仍按实际变化创建或更新。
3. 若 pending_catchup 有多张未记录章，按用户“批量提交所有未提交章节”或等价要求一次追记：先按叙事顺序 read_chapter 读完全部未记录正文，并参考最近一份已记录章的章末状态与接续包（若有）。suggested_record=brief 的前文只写简短章末状态与接续包，不创建人物当前状态/历史或世界观揭露；suggested_record=full 的最后一张写完整账本，人物历史从已读前文累积到本章。不要对每张前文再做一遍完整核验。
4. 伏笔总览是设计源，连续性账本只能核验既有伏笔线和既有触点，绝不能自行新增伏笔线、触点或把正文中的偶然线索升级为伏笔。逐项检查 list_continuity_files 返回的候选触点，并依据正文判定 committed 或 missed；每项都必须保留对应 foreshadowing_id、beat_id 和具体正文证据。前文简记时，该章若有伏笔候选仍须判定并写伏笔变化。
5. 只有本章存在既有伏笔触点候选时，才写伏笔变化 Markdown；其中逐项写明伏笔线、触点、执行结果及正文证据，并在 propose_continuity_commit 中提交完全相同的关联决策。候选为空时不得写伏笔变化文件，不得添加“本章无变化”占位，提交空决策数组即可。正文出现疑似伏笔但总览中没有对应项时，只在对话中提示用户返回剧情设计确认，不得写入账本或修改伏笔总览。
6. 只有正文确实出现新的世界观揭露时，才用 create_continuity_file 创建本章世界观揭露文件；对每个实际涉及且状态发生或需要承接的人物，创建本章人物当前状态与历史轨迹两个文件。当前状态写本章章末快照；历史轨迹优先参考叙事顺序中最近的更早章节记录；若不存在，则从现有设计资料开始整理。不要为未涉及的人物制造记录。批量追记的前文不要创建这些可选文件。
7. 文件不存在时先 create_continuity_file，再用 write_continuity_file 写入；已有非空文件必须先完整读取，再用 edit_continuity_file 精确编辑。所有内容均为便于人阅读的 Markdown，不写 JSON。
8. 全部文件内容准备完成后，为每一张待记录章分别调用 propose_continuity_commit 保存记录；批量追记时在同一轮对话里连续提交，不要让用户逐章再点一次。记录只供参考，不锁定正文、人物资料或剧情结构。未获用户批准前不得声称文件已保存或章节已经记录。`,
    readAccess: {
      workspaceRoots: [
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger"
      ],
      materialKinds: ["character", "plot", "draft", "other"],
      skillKinds: ["general", "plot", "style", "other"]
    },
    writeAccess: {
      workspaceRoots: ["continuity_ledger"],
      capabilities: ["query_structure", "commit_ledger"]
    }
  })
];

export function getDefaultLongAgentProfile(
  agentId: LongAgentId
): LongAgentProfile {
  const profile = DEFAULT_LONG_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!profile) {
    throw new Error(`Missing default long agent profile: ${agentId}`);
  }
  return structuredClone(profile);
}
