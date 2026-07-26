import { z } from "zod";
import {
  DraftSectionIdSchema,
  DraftSectionTitleSchema,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS
} from "./expert-draft";

export const SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS =
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS;

export const CREATIVE_WORKSPACE_TYPES = ["short", "script"] as const;
export const WorkspaceTypeSchema = z.enum(CREATIVE_WORKSPACE_TYPES);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;
export const CreativeWorkspaceTypeSchema = WorkspaceTypeSchema;
export type CreativeWorkspaceType = WorkspaceType;

export const SCRIPT_WORKSPACE_STAGE_IDS = [
  "character_design",
  "plot_design",
  "plot_refine",
  "outline",
  "draft"
] as const;

/** Physical script text stages. `draft` is a virtual episode directory route. */
export const SCRIPT_WORKSPACE_TEXT_STAGE_IDS = [
  "character_design",
  "plot_design",
  "plot_refine",
  "outline"
] as const;

export const ScriptWorkspaceStageIdSchema = z.enum(
  SCRIPT_WORKSPACE_STAGE_IDS
);
export type ScriptWorkspaceStageId = z.infer<
  typeof ScriptWorkspaceStageIdSchema
>;
export const ScriptWorkspaceTextStageIdSchema = z.enum(
  SCRIPT_WORKSPACE_TEXT_STAGE_IDS
);
export type ScriptWorkspaceTextStageId = z.infer<
  typeof ScriptWorkspaceTextStageIdSchema
>;

export const SCRIPT_WORKSPACE_AGENT_IDS = [
  "character_design",
  "plot_design",
  "outline",
  "expert_draft_coordinator",
  "expert_section_writer"
] as const;

export const ScriptWorkspaceAgentIdSchema = z.enum(
  SCRIPT_WORKSPACE_AGENT_IDS
);
export type ScriptWorkspaceAgentId = z.infer<
  typeof ScriptWorkspaceAgentIdSchema
>;

export const SCRIPT_WORKSPACE_STAGE_TO_AGENT_ID = {
  character_design: "character_design",
  plot_design: "plot_design",
  plot_refine: "plot_design",
  outline: "outline",
  draft: "expert_draft_coordinator"
} as const satisfies Record<ScriptWorkspaceStageId, ScriptWorkspaceAgentId>;

export function resolveScriptWorkspaceAgentIdForStage(
  stageId: ScriptWorkspaceStageId
): ScriptWorkspaceAgentId {
  return SCRIPT_WORKSPACE_STAGE_TO_AGENT_ID[stageId];
}

export const SCRIPT_MATERIAL_KINDS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
] as const;
export const ScriptMaterialKindSchema = z.enum(SCRIPT_MATERIAL_KINDS);
export type ScriptMaterialKind = z.infer<typeof ScriptMaterialKindSchema>;

export const SCRIPT_SKILL_KINDS = ["general", "plot", "style", "other"] as const;
export const ScriptSkillKindSchema = z.enum(SCRIPT_SKILL_KINDS);
export type ScriptSkillKind = z.infer<typeof ScriptSkillKindSchema>;

/** Hard constraints appended to every script-body writing prompt. */
export const SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS = `剧本正文必须严格遵守以下格式：
- 场景标题使用“序号. 内景/外景 地点 - 时间”；每次更换地点或时间都必须新开场次。
- 动作和画面描述独立成行并以“△”开头，只写镜头能够呈现的内容。
- 对白先写角色名；表演提示放在角色名后的括号中。
- OS 表示画面内人物的内心声音；VO 表示人物不在画面内，或来自电话、广播等外部声音。
- 闪回、梦境等时空转换必须使用清晰且成对的开始/结束标记。
- 通过 write_draft_section 或 replace_draft_section_text 写入 body 时，不得使用 Markdown 表格、分析标题或格式讲解，只能写可直接进入成稿的剧本正文。
`;

export const DEFAULT_SCRIPT_CHARACTER_DESIGN_SYSTEM_PROMPT = `你是 DeepWrite 的剧本人物设计智能体。

你的职责是创建、补全、诊断和修改可供剧情、大纲与剧集正文直接执行的人物设计。你不负责代写剧情大纲或剧本正文。

工作流程：
1. 判断用户是在新建人物、补全人物，还是修改已有设定。
2. 修改已有内容前，先调用 read_workspace_content 读取人物阶段；需要核对剧情约束时，再读取当前允许访问的剧情内容。
3. 用户点名技能，或某项人物设计方法明显适用时，调用 load_skill；需要人物素材时，调用 query_linked_material_entries，先检索再读取条目全文。
4. 形成可直接用于场面调度、人物行动和对白的人物稿，并使用工具写回人物编辑器。

人物设计至少关注：
- 身份、处境、核心欲望、恐惧、缺陷、秘密与底线。
- 可被镜头和表演呈现的行为习惯、语言特征与辨识度。
- 人物之间的利益、情感、误解、控制与变化空间。
- 人物弧的起点、关键转变、代价和最终状态。
- 人物在不同阶段的知情范围、关系状态与行动逻辑。

工具规则：
- 目标编辑框为空，或用户明确要求整体重写时，使用 write_workspace_editor。
- 已有内容只需局部修改、补充或润色时，先读取原文，再使用 replace_current_stage_text。
- 写入编辑器的只能是正式人物设定，不要写分析过程、操作说明或聊天回复。
- 不要凭空推翻已经确认的剧情事实；发现冲突时先指出冲突并给出最小改动方案。
`;

export const DEFAULT_SCRIPT_PLOT_DESIGN_SYSTEM_PROMPT = `你是 DeepWrite 的剧本剧情智能体，负责剧情设计和剧情细化。剧本工作区没有导语设计阶段，不得创建或要求写入导语内容。

两个内容槽位的边界：
- 剧情设计（plot_design）：核心命题、人物目标、主要冲突、因果链、关键转折、真实时间线和结局兑现。
- 剧情细化（plot_refine）：供大纲和剧集正文直接执行的场景链、节拍、信息投放、人物选择、情绪推进、伏笔与回收。

工作流程：
1. 先确认用户本次处理剧情设计还是剧情细化；需要跨方向时，明确每一部分的目标。
2. 调用 read_workspace_content 读取人物设计、当前目标槽位和与任务有关的已有剧情，避免重复设计或制造矛盾。
3. 用户点名技能或需要特定剧情方法时调用 load_skill；需要素材时调用 query_linked_material_entries，先检索再读取原文。
4. 检查因果是否成立、冲突是否递进、转折是否由人物选择触发、伏笔是否可回收、结局是否兑现前文承诺。
5. 使用工具把成品写入正确的剧情槽位。

创作标准：
- 每个重要情节点都要说明触发原因、人物选择、直接后果和后续压力。
- 区分故事真实时间线与观众看到的信息顺序。
- 剧情细化要具体到可拆分场次和剧集，但不要直接写成剧本正文。
- 尊重已确认的人设、分类和记忆要求；题材方法来自用户、技能和素材，不套用固定题材模板。

工具规则：
- 切换剧情子方向时先调用 switch_storyline_stage，或在写入工具中明确 target_stage_id。
- 空白槽位或用户明确要求整体重写时使用 write_workspace_editor。
- 局部修改已有内容时先读取原文，再使用 replace_current_stage_text。
- 写入编辑器的只能是正式剧情内容，不要混入分析过程或工具说明。
`;

export const DEFAULT_SCRIPT_OUTLINE_SYSTEM_PROMPT = `你是 DeepWrite 的剧本大纲智能体，负责把已经存在的人物和剧情内容梳理成可直接指导分集剧本写作的完整大纲。

开始任何大纲任务前，必须分别调用 read_workspace_content 检查以下阶段，存在的内容全部读取，不得只凭聊天摘要：
1. 人物设计（character_design）
2. 剧情设计（plot_design）
3. 剧情细化（plot_refine）
4. 当前大纲（outline）

工作模式：
- 整理大纲：保留前置阶段已经确认的人物、因果、时间线、关键情节和结局，不得遗漏重要内容；发现冲突时明确标注并采用最小改动方案。
- 创作大纲：在已有内容基础上补足缺口；用户点名技能或需要特定大纲方法时，调用 load_skill 后再组织。
- 前置内容为空时可以说明缺口，但不要声称已经读到不存在的设定。

大纲成品必须包含：
- 全剧定位、主线目标、核心冲突、时间线与结局。
- 剧集总数、顺序，以及每集的标题和预估篇幅。
- 每集的场次规划、出场人物、地点、时间、起始状态、详细剧情、关键选择、冲突或转折、信息投放和结尾钩子。
- 剧集之间的承接关系、人物状态变化、伏笔埋设与回收位置。

工具规则：
- 目标编辑框为空，或用户明确要求整体重做时，使用 write_workspace_editor 写入完整大纲。
- 已有大纲只需局部调整时，先读取原文，再使用 replace_current_stage_text。
- 写入编辑器的只能是最终大纲，不要写分析过程、读取记录或操作说明。
`;

export const DEFAULT_SCRIPT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT = `你是 DeepWrite 的剧本正文专家编写智能体，站在全剧角度处理剧集目录初始化、全文审阅、格式整理和跨集修订。正文是一个虚拟剧集目录，每一集的正文和人物状态是两个独立文件，不存在可覆盖的合并正文文件。

工作流程：
1. 用户要求初始化正文、按大纲创建剧集或批量创建空白剧集时，先调用 read_workspace_content（stage_id=outline）读取完整大纲，再调用 read_workspace_content（stage_id=draft）核对现有目录。
2. 根据大纲一次调用 create_draft_sections，批量提交所有尚未存在的剧集标题和字数要求；该工具只创建空白正文文件和空白人物状态文件。
3. 处理全剧正文时，先调用 read_draft_sections（mode=preview）扫描相关剧集，再对真正需要处理的剧集调用 read_draft_sections（mode=full）。
4. 只处理某一集时，直接对该 section_id 调用 read_draft_sections（mode=full）。
5. 局部修改使用 replace_draft_section_text；只有剧集为空或用户明确要求整集重写时，才使用 write_draft_section。

读取与初始化规则：
- 工具返回“本次未读取”时，必须继续分批读完再下结论；preview 不算完整读取。
- 改动会影响后续连续性时，一并读取相关剧集的 character_state，并在修改正文后同步更新受影响的人物状态。
- 大纲为空且用户没有明确给出剧集清单时，不得猜测剧集结构。
- 批量初始化必须在一次 create_draft_sections 调用中提交全部待创建剧集，不得拆成多次单集调用。
- 初始化只新增空白剧集文件，不删除、不改名、不排序、不覆盖已有剧集。

写回规则：
- 每次写入或替换都必须显式指定稳定 section_id；file 参数决定写正文还是人物状态，默认是 body。
- 同一轮内先创建再写文时，必须使用创建结果给出的 section_id。
- 写入的只能是正式剧本正文或正式人物状态，不要混入分析过程、操作说明或工具记录。
- 需要技能时调用 load_skill；只有当前读取范围允许素材且确有必要时，才查询关联素材。

${SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS}`;

export const DEFAULT_SCRIPT_EXPERT_SECTION_WRITER_SYSTEM_PROMPT = `你是 DeepWrite 的剧本分集写手智能体，是实际创作剧本正文的主要智能体。你的工具和剧本正文专家编写智能体一致，区别只在职责：你一次只完成当前选中的这一集，不改动其它剧集。

写作前必须完成：
1. 调用 read_workspace_content 读取大纲；读取范围允许时，可补充读取剧情细化。
2. 调用 read_workspace_content（stage_id=draft）确认当前剧集在目录中的位置和相邻剧集 id。
3. 调用 read_draft_sections（mode=full）读取当前剧集，以及紧邻的前 2 到 3 个已有正文的剧集；读取紧邻上一集时，include 必须包含 character_state。
4. 只有用户明确要求跨集呼应或必须核对前文伏笔时，才扩大读取范围，并优先用 mode=preview 扫描。
5. 用户点名技能或写作方法时调用 load_skill；确需参考剧本素材时，调用 query_linked_material_entries 检索并读取相关条目。

写作标准：
- 严格执行当前剧集在大纲中的任务、承接点和篇幅要求。
- 延续前文的时间、空间、人物关系、信息知情范围、物品位置、伤势和情绪，不重复已经完成的情节。
- 让冲突通过可被镜头呈现的人物行动、表演和对白推进，避免用小说化总结代替场面。
- 保持题材、风格和节奏一致；用户本轮要求优先于一般写作习惯。
- 剧集结尾应完成本集任务，并为下一集留下明确承接点或观看动力。

写回规则：
- 写入工具省略 section_id 时默认作用于当前选中剧集；你只能修改当前剧集。
- 当前正文为空时，调用 write_draft_section（file=body）写入完整剧本；已有内容只需局部修改时使用 replace_draft_section_text。
- 当前人物状态为空时调用 write_draft_section（file=character_state）；已有状态只需修改时用 replace_draft_section_text（file=character_state）。
- 人物状态应记录本集结束时的处境、关系、情绪、已知与隐瞒信息、关键物品、未解决冲突和下一集接续点。
- 没有完成正文与人物状态的必要写回工具调用，本集不算完成。

${SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS}`;

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_SYSTEM_PROMPTS: Record<
  ScriptWorkspaceAgentId,
  string
> = {
  character_design: DEFAULT_SCRIPT_CHARACTER_DESIGN_SYSTEM_PROMPT,
  plot_design: DEFAULT_SCRIPT_PLOT_DESIGN_SYSTEM_PROMPT,
  outline: DEFAULT_SCRIPT_OUTLINE_SYSTEM_PROMPT,
  expert_draft_coordinator: DEFAULT_SCRIPT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT,
  expert_section_writer: DEFAULT_SCRIPT_EXPERT_SECTION_WRITER_SYSTEM_PROMPT
};

function uniqueEnumValuesSchema<T extends string>(
  schema: z.ZodType<T>,
  maxLength: number,
  label: string
) {
  return z
    .array(schema)
    .max(maxLength)
    .superRefine((values, context) => {
      values.forEach((value, index) => {
        if (values.indexOf(value) !== index) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${value}`
          });
        }
      });
    });
}

const UniqueScriptWorkspaceStageIdsSchema = uniqueEnumValuesSchema(
  ScriptWorkspaceStageIdSchema,
  SCRIPT_WORKSPACE_STAGE_IDS.length,
  "workspace stage id"
);
const UniqueScriptMaterialKindsSchema = uniqueEnumValuesSchema(
  ScriptMaterialKindSchema,
  SCRIPT_MATERIAL_KINDS.length,
  "material kind"
);
const UniqueScriptSkillKindsSchema = uniqueEnumValuesSchema(
  ScriptSkillKindSchema,
  SCRIPT_SKILL_KINDS.length,
  "skill kind"
);

export const ScriptAgentReadAccessSchema = z.object({
  workspace: UniqueScriptWorkspaceStageIdsSchema,
  material: UniqueScriptMaterialKindsSchema,
  skill: UniqueScriptSkillKindsSchema
});
export type ScriptAgentReadAccess = z.infer<typeof ScriptAgentReadAccessSchema>;

export const DEFAULT_SCRIPT_AGENT_READ_ACCESS: Record<
  ScriptWorkspaceAgentId,
  ScriptAgentReadAccess
> = {
  character_design: {
    workspace: ["character_design", "plot_design", "plot_refine"],
    material: ["character"],
    skill: ["general", "plot", "other"]
  },
  plot_design: {
    workspace: ["character_design", "plot_design", "plot_refine"],
    material: ["gimmick", "character", "plot"],
    skill: ["general", "plot", "other"]
  },
  outline: {
    workspace: ["plot_design", "plot_refine", "outline", "character_design"],
    material: [],
    skill: ["general", "other"]
  },
  expert_draft_coordinator: {
    workspace: ["outline", "draft", "character_design"],
    material: [],
    skill: ["general", "other"]
  },
  expert_section_writer: {
    workspace: ["outline", "draft", "character_design"],
    material: ["draft"],
    skill: ["style", "general"]
  }
};

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_READ_ACCESS =
  DEFAULT_SCRIPT_AGENT_READ_ACCESS;

const ScriptSystemPromptSchema = z
  .string()
  .min(1)
  .max(200_000)
  .refine((value) => value.trim().length > 0, {
    message: "System prompt must contain non-whitespace text."
  });

export const ScriptWorkspaceStageSnapshotSchema = z
  .object({
    stageId: ScriptWorkspaceTextStageIdSchema,
    title: z.string().trim().min(1).max(240),
    content: z.string().max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS)
      .optional()
  })
  .superRefine((value, context) => {
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= value.content.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "A truncated stage must report an originalLength larger than content."
      });
    }
  });
export type ScriptWorkspaceStageSnapshot = z.infer<
  typeof ScriptWorkspaceStageSnapshotSchema
>;

const ScriptExpertDraftFileSnapshotSchema = z.object({
  documentId: z.string().trim().min(1).max(4_096),
  title: z.string().trim().min(1).max(256),
  content: z.string().max(SCRIPT_WORKSPACE_FILE_MAX_CHARACTERS),
  revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/)
});

const ScriptExpertDraftSectionSnapshotSchema = z
  .object({
    id: DraftSectionIdSchema,
    title: DraftSectionTitleSchema,
    wordCountRequirement: z.string().max(1_000),
    body: ScriptExpertDraftFileSnapshotSchema,
    characterState: ScriptExpertDraftFileSnapshotSchema
  })
  .superRefine((value, context) => {
    if (value.body.documentId === value.characterState.documentId) {
      context.addIssue({
        code: "custom",
        path: ["characterState", "documentId"],
        message: "Script body and character state must use distinct files."
      });
    }
  });

const ScriptExpertDraftDirectorySnapshotSchema = z
  .object({
    id: z.literal("draft"),
    title: z.string().trim().min(1).max(240),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    sections: z.array(ScriptExpertDraftSectionSnapshotSchema).min(1).max(100)
  })
  .superRefine((value, context) => {
    const sectionIds = value.sections.map((section) => section.id);
    sectionIds.forEach((sectionId, index) => {
      if (sectionIds.indexOf(sectionId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `Duplicate script episode id: ${sectionId}`
        });
      }
    });
    const documentIds = value.sections.flatMap((section) => [
      section.body.documentId,
      section.characterState.documentId
    ]);
    documentIds.forEach((documentId, index) => {
      if (documentIds.indexOf(documentId) !== index) {
        context.addIssue({
          code: "custom",
          path: [
            "sections",
            Math.floor(index / 2),
            index % 2 === 0 ? "body" : "characterState",
            "documentId"
          ],
          message: `Duplicate script document id: ${documentId}`
        });
      }
    });
  });

export const ScriptWorkspaceSnapshotSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(240),
    categories: z.array(z.string().trim().min(1).max(120)).max(16),
    activeStageId: ScriptWorkspaceStageIdSchema,
    activeAgentId: ScriptWorkspaceAgentIdSchema.optional(),
    activeSectionId: z.string().trim().min(1).max(120).optional(),
    expertDraft: ScriptExpertDraftDirectorySnapshotSchema,
    stages: z
      .array(ScriptWorkspaceStageSnapshotSchema)
      .length(SCRIPT_WORKSPACE_TEXT_STAGE_IDS.length)
  })
  .superRefine((value, context) => {
    const stageIds = value.stages.map((stage) => stage.stageId);
    stageIds.forEach((stageId, index) => {
      if (stageIds.indexOf(stageId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["stages", index, "stageId"],
          message: `Duplicate script workspace stage snapshot: ${stageId}`
        });
      }
    });
    if (value.activeStageId !== "draft" && !stageIds.includes(value.activeStageId)) {
      context.addIssue({
        code: "custom",
        path: ["activeStageId"],
        message: "Active stage must be present in the script workspace snapshot."
      });
    }

    if (value.activeStageId !== "draft") {
      const defaultAgentId = resolveScriptWorkspaceAgentIdForStage(
        value.activeStageId
      );
      if (
        value.activeAgentId !== undefined &&
        value.activeAgentId !== defaultAgentId
      ) {
        context.addIssue({
          code: "custom",
          path: ["activeAgentId"],
          message: `Stage ${value.activeStageId} must use its default agent ${defaultAgentId}.`
        });
      }
      if (value.activeSectionId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activeSectionId"],
          message: "Only the script section writer may target an episode."
        });
      }
      return;
    }

    if (value.activeAgentId === undefined) {
      if (value.activeSectionId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activeSectionId"],
          message: "An episode target requires the script section writer."
        });
      }
      return;
    }
    if (value.activeAgentId === "expert_draft_coordinator") {
      if (value.activeSectionId !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activeSectionId"],
          message: "The script coordinator cannot target an individual episode."
        });
      }
      return;
    }
    if (value.activeAgentId !== "expert_section_writer") {
      context.addIssue({
        code: "custom",
        path: ["activeAgentId"],
        message: "The script draft stage must use a script writing agent."
      });
      return;
    }
    if (value.activeSectionId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["activeSectionId"],
        message: "The script section writer requires an active episode id."
      });
      return;
    }
    if (
      !value.expertDraft.sections.some(
        (section) => section.id === value.activeSectionId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeSectionId"],
        message: `Unknown script episode: ${value.activeSectionId}`
      });
    }
  });
export type ScriptWorkspaceSnapshot = z.infer<
  typeof ScriptWorkspaceSnapshotSchema
>;

export const SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH = 120;
export const ScriptAgentWelcomeShortcutsSchema = z.tuple([
  z.string().trim().min(1).max(SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH),
  z.string().trim().min(1).max(SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH),
  z.string().trim().min(1).max(SCRIPT_AGENT_WELCOME_SHORTCUT_MAX_LENGTH)
]);
export type ScriptAgentWelcomeShortcuts = z.infer<
  typeof ScriptAgentWelcomeShortcutsSchema
>;

export const DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS = {
  character_design: [
    "帮我从零创建一组剧本人物",
    "检查当前人设是否适合镜头呈现",
    "完善人物关系和人物弧光"
  ],
  plot_design: [
    "根据当前人设设计一条主线剧情",
    "检查剧情因果和转折是否成立",
    "把当前剧情细化成可拆场的节拍"
  ],
  outline: [
    "根据现有人物和剧情生成分集大纲",
    "检查当前大纲是否有逻辑漏洞",
    "把大纲拆成剧集与场次"
  ],
  expert_draft_coordinator: [
    "根据大纲初始化剧集目录",
    "审阅全剧的连续性和格式",
    "帮我跨集修订当前剧本"
  ],
  expert_section_writer: [
    "按照大纲写当前剧集",
    "续写当前剧集并衔接前文",
    "重写当前剧集，增强冲突和画面感"
  ]
} as const satisfies Record<ScriptWorkspaceAgentId, ScriptAgentWelcomeShortcuts>;

export const ScriptWorkspaceAgentProfileSchema = z.object({
  id: ScriptWorkspaceAgentIdSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  systemPrompt: ScriptSystemPromptSchema,
  welcomeShortcuts: ScriptAgentWelcomeShortcutsSchema,
  readAccess: ScriptAgentReadAccessSchema
});
export type ScriptWorkspaceAgentProfile = z.infer<
  typeof ScriptWorkspaceAgentProfileSchema
>;

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES: readonly ScriptWorkspaceAgentProfile[] = [
  {
    id: "character_design",
    label: "剧本人物",
    description: "创建、补全和修改可供场面调度、行动与对白直接使用的人物设计。",
    systemPrompt: DEFAULT_SCRIPT_CHARACTER_DESIGN_SYSTEM_PROMPT,
    welcomeShortcuts: [...DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS.character_design],
    readAccess: DEFAULT_SCRIPT_AGENT_READ_ACCESS.character_design
  },
  {
    id: "plot_design",
    label: "剧本剧情",
    description: "负责剧情设计与剧情细化，不包含导语设计。",
    systemPrompt: DEFAULT_SCRIPT_PLOT_DESIGN_SYSTEM_PROMPT,
    welcomeShortcuts: [...DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS.plot_design],
    readAccess: DEFAULT_SCRIPT_AGENT_READ_ACCESS.plot_design
  },
  {
    id: "outline",
    label: "分集大纲",
    description: "将人物与剧情内容整理成可直接指导分集剧本写作的大纲。",
    systemPrompt: DEFAULT_SCRIPT_OUTLINE_SYSTEM_PROMPT,
    welcomeShortcuts: [...DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS.outline],
    readAccess: DEFAULT_SCRIPT_AGENT_READ_ACCESS.outline
  },
  {
    id: "expert_draft_coordinator",
    label: "剧本正文专家",
    description: "管理剧集结构、审阅连续性并处理跨集修订。",
    systemPrompt: DEFAULT_SCRIPT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT,
    welcomeShortcuts: [
      ...DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS.expert_draft_coordinator
    ],
    readAccess: DEFAULT_SCRIPT_AGENT_READ_ACCESS.expert_draft_coordinator
  },
  {
    id: "expert_section_writer",
    label: "剧本分集写手",
    description: "按大纲、连续人物状态和剧本格式完成单集正文。",
    systemPrompt: DEFAULT_SCRIPT_EXPERT_SECTION_WRITER_SYSTEM_PROMPT,
    welcomeShortcuts: [
      ...DEFAULT_SCRIPT_AGENT_WELCOME_SHORTCUTS.expert_section_writer
    ],
    readAccess: DEFAULT_SCRIPT_AGENT_READ_ACCESS.expert_section_writer
  }
];

function validateCompleteScriptAgentSet(
  agents: readonly { id: ScriptWorkspaceAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = agents.map((agent) => agent.id);
  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) {
      context.addIssue({
        code: "custom",
        path: ["agents", index, "id"],
        message: `Duplicate script workspace agent profile: ${id}`
      });
    }
  });
}

export const ScriptWorkspaceAgentSettingsSchema = z
  .object({
    workspaceType: z.literal("script"),
    agents: z
      .array(ScriptWorkspaceAgentProfileSchema)
      .length(SCRIPT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteScriptAgentSet(value.agents, context)
  );
export type ScriptWorkspaceAgentSettings = z.infer<
  typeof ScriptWorkspaceAgentSettingsSchema
>;

export const ScriptWorkspaceAgentSettingsInputAgentSchema = z.object({
  id: ScriptWorkspaceAgentIdSchema,
  systemPrompt: ScriptSystemPromptSchema,
  welcomeShortcuts: ScriptAgentWelcomeShortcutsSchema,
  readAccess: ScriptAgentReadAccessSchema
});
export type ScriptWorkspaceAgentSettingsInputAgent = z.infer<
  typeof ScriptWorkspaceAgentSettingsInputAgentSchema
>;

export const ScriptWorkspaceAgentSettingsInputSchema = z
  .object({
    workspaceType: z.literal("script"),
    agents: z
      .array(ScriptWorkspaceAgentSettingsInputAgentSchema)
      .length(SCRIPT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteScriptAgentSet(value.agents, context)
  );
export type ScriptWorkspaceAgentSettingsInput = z.infer<
  typeof ScriptWorkspaceAgentSettingsInputSchema
>;

export const DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS: ScriptWorkspaceAgentSettings = {
  workspaceType: "script",
  agents: [...DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES]
};
