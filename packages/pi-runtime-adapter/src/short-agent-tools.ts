import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import {
  SHORT_MATERIAL_KINDS,
  SHORT_SKILL_KINDS,
  SHORT_WORKSPACE_STAGE_IDS,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  isProvisionalExpertDraftSectionId,
  PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX,
  type AgentWriteApprovalMode,
  type ExpertDraftSectionSnapshot,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  LOAD_SKILL_NAME_PARAMETER,
  LOAD_SKILL_TOOL_DESCRIPTION,
  formatLoadSkillToolResult,
  resolveAttachedSkill,
  type LoadSkillCandidate
} from "./resolve-attached-skill";

export type ShortWorkspaceToolDetails =
  | { kind: "none" }
  | {
      kind: "workspace-editor-mutation";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
      text: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-expert-draft-file-mutation";
      workspaceId: string;
      stageId: "draft";
      documentId: string;
      sectionId: string;
      fileKind: "body" | "characterState";
      text: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-expert-draft-section-creation";
      workspaceId: string;
      stageId: "draft";
      sections: Array<{
        title: string;
        wordCountRequirement: string;
        provisionalSectionId: string;
      }>;
      afterSectionId?: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-stage-selection";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
    };

export interface BuildShortWorkspaceToolsInput {
  workspace: ShortWorkspaceSnapshot;
  profile: ShortWorkspaceAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  /**
   * Mutable content shared by every agent participating in the same parent run.
   * Read evidence deliberately stays outside this object and is recreated by
   * every buildShortWorkspaceTools() call.
   */
  sharedState?: ShortWorkspaceToolSharedState;
}

type ExpertSectionMap = Map<string, ExpertDraftSectionSnapshot>;

export interface ShortWorkspaceToolSharedState {
  stageBodies: Map<ShortWorkspaceStageId, string>;
  stageRevisions: Map<ShortWorkspaceStageId, string>;
  expertSections: ExpertSectionMap;
  /** Stable directory order including provisional sections created in this run. */
  expertSectionOrder: string[];
  pendingExpertSectionTitles: Set<string>;
  pendingSectionSeq: number;
  /**
   * Structural directory revision at run start. Section creation proposals keep
   * this base so Renderer same-run accept chaining stays valid.
   */
  expertDraftDirectoryBaseRevision: string;
}

/**
 * Draft tools are deliberately identical for the coordinator and the section
 * writer. Scope differences belong in the system prompt, except for the one
 * hard rule enforced here: a section writer may only write its active section.
 */
const SHORT_WORKSPACE_DRAFT_TOOLS = [
  "read_draft_sections",
  "write_draft_section",
  "replace_draft_section_text"
] as const;

export const SHORT_WORKSPACE_TOOL_MANIFEST = {
  standard: [
    "read_workspace_content",
    "search_workspace_text",
    "query_linked_material_entries",
    "load_skill",
    "write_workspace_editor",
    "replace_current_stage_text"
  ],
  plot: ["switch_storyline_stage"],
  draft: SHORT_WORKSPACE_DRAFT_TOOLS,
  coordinator: ["create_draft_sections", ...SHORT_WORKSPACE_DRAFT_TOOLS],
  sectionWriter: [...SHORT_WORKSPACE_DRAFT_TOOLS]
} as const;

/**
 * Draft bodies enter the run snapshot without truncation, so one unbounded
 * batch read can exhaust the model context. Full reads are paged instead.
 */
const DRAFT_FULL_READ_CHARACTER_BUDGET = 60_000;
const DRAFT_FULL_READ_MAX_SECTIONS = 20;
const DRAFT_PREVIEW_EXCERPT_CHARACTERS = 200;

type DraftFileKind = "body" | "characterState";

const DRAFT_FILE_PARAMETER_VALUES = ["body", "character_state"] as const;

function toDraftFileKind(value: unknown): DraftFileKind {
  return String(value ?? "body") === "character_state" ? "characterState" : "body";
}

function draftFileLabel(field: DraftFileKind): string {
  return field === "body" ? "正文" : "人物状态";
}

function textResult(
  text: string,
  details: ShortWorkspaceToolDetails = { kind: "none" }
): AgentToolResult<ShortWorkspaceToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function literalUnion<T extends string>(values: readonly T[]) {
  if (values.length === 1) {
    return Type.Literal(values[0]!);
  }
  return Type.Union(values.map((value) => Type.Literal(value)));
}

function primitiveTypeOf(value: unknown): string | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

export function sanitizeToolSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolSchemaForGemini(item));
  }
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    output[key] = sanitizeToolSchemaForGemini(child);
  }

  for (const unionKey of ["anyOf", "oneOf"]) {
    const union = output[unionKey];
    if (!Array.isArray(union) || union.length === 0) continue;
    const branches = union as Array<Record<string, unknown>>;
    if (
      branches.every(
        (branch) =>
          branch &&
          typeof branch === "object" &&
          Object.prototype.hasOwnProperty.call(branch, "const")
      )
    ) {
      const values = branches.map((branch) => branch.const);
      delete output[unionKey];
      output.enum = values;
      if (!output.type) {
        const types = [...new Set(values.map(primitiveTypeOf).filter(Boolean))];
        if (types.length === 1) output.type = types[0];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(output, "const")) {
    output.enum = [output.const];
    if (!output.type) output.type = primitiveTypeOf(output.const);
    delete output.const;
  }
  return output;
}

function defineTool<T extends ReturnType<typeof Type.Object>>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<ShortWorkspaceToolDetails>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, ShortWorkspaceToolDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: sanitizeToolSchemaForGemini(definition.parameters) as T,
    execute: definition.execute,
    ...(definition.executionMode ? { executionMode: definition.executionMode } : {})
  };
}

function stageLabel(stageId: ShortWorkspaceStageId): string {
  const labels: Record<ShortWorkspaceStageId, string> = {
    character_design: "人物",
    plot_design: "剧情设计",
    intro_design: "导语设计",
    plot_refine: "剧情细化",
    outline: "大纲",
    draft: "正文"
  };
  return labels[stageId];
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const prefix = text.slice(0, index);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function replaceText(
  current: string,
  replacements: Array<{ original_text: string; new_text: string }>
): { next?: string; count: number; error?: string } {
  let next = current;
  let count = 0;
  for (const replacement of replacements) {
    const original = replacement.original_text;
    if (!original) {
      return { count, error: "original_text 不能为空。" };
    }
    const first = next.indexOf(original);
    if (first < 0) {
      return { count, error: `没有找到原文片段：${original.slice(0, 80)}` };
    }
    if (next.indexOf(original, first + original.length) >= 0) {
      return { count, error: `原文片段出现多次，请提供更长且唯一的上下文：${original.slice(0, 80)}` };
    }
    next = `${next.slice(0, first)}${replacement.new_text}${next.slice(first + original.length)}`;
    count += 1;
  }
  return { next, count };
}

function writableStageIds(profile: ShortWorkspaceAgentProfile): ShortWorkspaceStageId[] {
  if (profile.id === "character_design") return ["character_design"];
  if (profile.id === "plot_design") {
    return ["plot_design", "intro_design", "plot_refine"];
  }
  if (profile.id === "outline") return ["outline"];
  return ["draft"];
}

function buildReadWorkspaceContentTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>
): AgentTool {
  const allowed = input.profile.readAccess.workspace;
  return defineTool({
    name: "read_workspace_content",
    label: "读取工作区内容",
    description: `读取当前短篇某一阶段的实时快照。仅允许：${allowed
      .map((stageId) => `${stageLabel(stageId)}(${stageId})`)
      .join("、")}。每次只读取一个阶段。`,
    parameters: Type.Object({ stage_id: literalUnion(allowed) }),
    execute: async (_toolCallId, params) => {
      const stageId = String(params.stage_id) as ShortWorkspaceStageId;
      if (!allowed.includes(stageId)) {
        return textResult(`当前智能体不允许读取「${stageLabel(stageId)}」。`);
      }
      if (stageId === "draft") {
        const shared = input.sharedState;
        const orderedIds =
          shared?.expertSectionOrder ??
          input.workspace.expertDraft.sections.map((section) => section.id);
        const sections = orderedIds
          .map(
            (sectionId) =>
              shared?.expertSections.get(sectionId) ??
              input.workspace.expertDraft.sections.find(
                (section) => section.id === sectionId
              )
          )
          .filter((section): section is ExpertDraftSectionSnapshot => Boolean(section));
        const index = sections
          .map(
            (section, sectionIndex) =>
              `${sectionIndex + 1}. ${section.title}（${section.id}）` +
              `${isProvisionalExpertDraftSectionId(section.id) ? "〔本轮待创建〕" : ""}\n` +
              `   字数要求：${section.wordCountRequirement || "未设置"}\n` +
              `   正文文件：${section.body.title}（${section.body.documentId}）｜${fileSizeLabel(section.body.content)}\n` +
              `   人物状态文件：${section.characterState.title}（${section.characterState.documentId}）｜${fileSizeLabel(section.characterState.content)}`
          )
          .join("\n");
        const directoryRevision =
          shared?.expertDraftDirectoryBaseRevision ??
          input.workspace.expertDraft.revision;
        return textResult(
          `书名：《${input.workspace.title}》\n【正文目录】（draft）\n` +
          `目录版本：${directoryRevision}\n` +
          `章节数：${sections.length}\n\n${index}\n\n` +
          "这里只返回文件映射，不返回章节原文。读取原文请调用 read_draft_sections：" +
          "整篇扫描用 mode=preview，需要精读或改写的章节再用 mode=full。"
        );
      }
      const storedBody = stageBodies.get(stageId) ?? "";
      const snapshot = input.workspace.stages.find((stage) => stage.stageId === stageId);
      const truncationNote = snapshot?.truncated
        ? `\n注意：本轮只提供前 ${storedBody.length.toLocaleString("zh-CN")} 个字符，原文共 ${snapshot.originalLength?.toLocaleString("zh-CN") ?? "更多"} 个字符。`
        : "";
      return textResult(
        `书名：《${input.workspace.title}》\n【${stageLabel(stageId)}】（${stageId}）\n本轮可读字数：${storedBody.replace(/\s/g, "").length}${truncationNote}\n\n${storedBody || "该阶段当前文本为空。"}`
      );
    }
  });
}

function buildSearchWorkspaceTextTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  expertSections: ExpertSectionMap
): AgentTool {
  const allowed = input.profile.readAccess.workspace;
  return defineTool({
    name: "search_workspace_text",
    label: "搜索工作区文本",
    description:
      "在当前智能体可读的短篇阶段中按原文搜索，只返回命中位置和少量上下文；局部替换前可先用它定位准确原文。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 600 }),
      stage_id: Type.Optional(literalUnion(allowed)),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      context_chars: Type.Optional(Type.Integer({ minimum: 10, maximum: 300 }))
    }),
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? "");
      const selected = params.stage_id
        ? [String(params.stage_id) as ShortWorkspaceStageId]
        : allowed;
      const maxMatches = Math.min(50, Math.max(1, Number(params.max_matches ?? 10)));
      const contextChars = Math.min(300, Math.max(10, Number(params.context_chars ?? 60)));
      const matches: string[] = [];
      for (const stageId of selected) {
        if (!allowed.includes(stageId)) continue;
        const sources = stageId === "draft"
          ? orderedExpertSections(input, expertSections).map((section) => ({
              label: `${section.title}（${section.id}）`,
              body: section.body.content
            }))
          : [{ label: `${stageLabel(stageId)}(${stageId})`, body: stageBodies.get(stageId) ?? "" }];
        for (const source of sources) {
          let cursor = 0;
          while (matches.length < maxMatches) {
            const index = source.body.indexOf(query, cursor);
            if (index < 0) break;
            const { line, column } = lineColumnAt(source.body, index);
            const start = Math.max(0, index - contextChars);
            const end = Math.min(
              source.body.length,
              index + query.length + contextChars
            );
            matches.push(
              `${source.label} ${line}:${column} ${start > 0 ? "…" : ""}${source.body.slice(start, end)}${end < source.body.length ? "…" : ""}`
            );
            cursor = index + Math.max(1, query.length);
          }
          if (matches.length >= maxMatches) break;
        }
      }
      const truncatedLabels = selected
        .filter((stageId) =>
          input.workspace.stages.some(
            (stage) => stage.stageId === stageId && stage.truncated
          )
        )
        .map(stageLabel);
      const truncationNote = truncatedLabels.length
        ? `\n\n注意：${truncatedLabels.join("、")}仅搜索了本轮可见的前段快照，不能据此判断全文无匹配。`
        : "";
      return textResult(
        matches.length
          ? `${matches.join("\n\n")}${truncationNote}`
          : truncatedLabels.length
            ? `本轮可见快照中没有找到匹配文本。${truncationNote}`
            : "没有找到匹配文本。"
      );
    }
  });
}

function buildQueryLinkedMaterialEntriesTool(
  input: BuildShortWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.material;
  return defineTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description:
      "列出、搜索或读取本轮显式附加且位于当前智能体读取范围内的素材。未显式附加的素材不会被读取。",
    parameters: Type.Object({
      mode: Type.Union([Type.Literal("list"), Type.Literal("search"), Type.Literal("read")]),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_name: Type.Optional(Type.String({ maxLength: 240 })),
      material_kind: Type.Optional(literalUnion(allowedKinds.length ? allowedKinds : SHORT_MATERIAL_KINDS))
    }),
    execute: async (_toolCallId, params) => {
      const items = (input.attachedMaterials ?? []).filter(
        (item) => item.kind !== undefined && allowedKinds.includes(item.kind)
      );
      const kind = params.material_kind ? String(params.material_kind) : "";
      const scoped = kind ? items.filter((item) => item.kind === kind) : items;
      if (params.mode === "read") {
        const name = String(params.entry_name ?? params.query ?? "").trim();
        const found = scoped.find((item) => item.title === name);
        return textResult(
          found
            ? `【${found.title}】${found.kind ? `（${found.kind}）` : ""}\n\n${found.content}`
            : "没有找到同名的已附加素材条目。"
        );
      }
      if (params.mode === "search") {
        const query = String(params.query ?? "").trim();
        const found = scoped.filter(
          (item) => item.title.includes(query) || item.content.includes(query)
        );
        return textResult(
          found.length
            ? found
                .map((item) => `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}: ${item.content.slice(0, 220)}`)
                .join("\n")
            : "已附加素材中没有匹配条目。"
        );
      }
      return textResult(
        scoped.length
          ? scoped.map((item) => `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}`).join("\n")
          : "本轮没有附加当前智能体可读的素材。"
      );
    }
  });
}

function buildLoadSkillTool(input: BuildShortWorkspaceToolsInput): AgentTool {
  const allowedKinds = input.profile.readAccess.skill;
  return defineTool({
    name: "load_skill",
    label: "加载技能",
    description: LOAD_SKILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      name: Type.String(LOAD_SKILL_NAME_PARAMETER)
    }),
    execute: async (_toolCallId, params) => {
      const name = String(params.name ?? "");
      const attached = input.attachedSkills ?? [];
      const isReadable = (item: LoadSkillCandidate): boolean =>
        item.kind !== undefined &&
        (allowedKinds as readonly string[]).includes(item.kind);
      const result = resolveAttachedSkill(name, attached, isReadable);
      return textResult(
        formatLoadSkillToolResult(name, result, attached.filter(isReadable))
      );
    }
  });
}

function buildSwitchStorylineStageTool(
  input: BuildShortWorkspaceToolsInput,
  selectStage: (stageId: ShortWorkspaceStageId) => void
): AgentTool {
  const plotStages = ["plot_design", "intro_design", "plot_refine"] as const;
  return defineTool({
    name: "switch_storyline_stage",
    label: "切换剧情方向",
    description: "切换短篇剧情父节点下的当前子方向；只改变选中项，不写入内容。",
    parameters: Type.Object({ target_stage_id: literalUnion(plotStages) }),
    execute: async (_toolCallId, params) => {
      const stageId = String(params.target_stage_id) as (typeof plotStages)[number];
      selectStage(stageId);
      return textResult(`已切换到「${stageLabel(stageId)}」。`, {
        kind: "workspace-stage-selection",
        workspaceId: input.workspace.id,
        stageId
      });
    },
    executionMode: "sequential"
  });
}

function editorMutationResult(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  stageId: ShortWorkspaceStageId,
  text: string,
  summary: string
): AgentToolResult<ShortWorkspaceToolDetails> {
  const baseRevision = stageRevisions.get(stageId);
  if (!baseRevision) {
    return textResult(`未写入：缺少「${stageLabel(stageId)}」的基础版本标识。`);
  }
  stageBodies.set(stageId, text);
  stageRevisions.set(stageId, createShortWorkspaceContentRevision(text));
  const resultSummary = input.writeApprovalMode === "auto-approve"
    ? summary.replace("，等待用户审阅。", "，将在本轮完成后自动批准并保存。")
    : summary;
  return textResult(resultSummary, {
    kind: "workspace-editor-mutation",
    workspaceId: input.workspace.id,
    stageId,
    text,
    baseRevision,
    summary: resultSummary
  });
}

function expertDraftFileMutationResult(
  input: BuildShortWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  sectionId: string,
  fileKind: "body" | "characterState",
  text: string,
  summary: string
): AgentToolResult<ShortWorkspaceToolDetails> {
  const section = expertSections.get(sectionId);
  const file = section?.[fileKind];
  if (!section || !file) {
    return textResult(`未写入：没有找到正文小节 ${sectionId} 的目标文件。`);
  }
  const baseRevision = file.revision;
  expertSections.set(sectionId, {
    ...section,
    [fileKind]: {
      ...file,
      content: text,
      revision: createShortWorkspaceContentRevision(text)
    }
  });
  const resultSummary = input.writeApprovalMode === "auto-approve"
    ? summary.replace("，等待用户审阅。", "，将在本轮完成后自动批准并保存。")
    : summary;
  return textResult(resultSummary, {
    kind: "workspace-expert-draft-file-mutation",
    workspaceId: input.workspace.id,
    stageId: "draft",
    documentId: file.documentId,
    sectionId,
    fileKind,
    text,
    baseRevision,
    summary: resultSummary
  });
}

function buildWriteWorkspaceEditorTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  currentStage: () => ShortWorkspaceStageId
): AgentTool {
  const allowedTargets: ShortWorkspaceStageId[] = writableStageIds(input.profile).filter(
    (stageId) => stageId !== "draft"
  );
  return defineTool({
    name: "write_workspace_editor",
    label: "写入当前文本编辑框",
    description:
      "覆盖目标阶段全文。仅用于空白阶段或用户明确要求整体重写；局部修改必须使用 replace_current_stage_text。",
    parameters: Type.Object({
      target_stage_id: Type.Optional(literalUnion(allowedTargets)),
      text: Type.String({ minLength: 1, maxLength: 200_000 }),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      mode: Type.Literal("replace")
    }),
    execute: async (_toolCallId, params) => {
      const fallback = allowedTargets.includes(currentStage())
        ? currentStage()
        : allowedTargets[0]!;
      const stageId = params.target_stage_id
        ? (String(params.target_stage_id) as ShortWorkspaceStageId)
        : fallback;
      const snapshot = input.workspace.stages.find(
        (stage) => stage.stageId === stageId
      );
      if (snapshot?.truncated) {
        return textResult(
          `未写入：「${stageLabel(stageId)}」超过本轮安全快照上限，无法在看不到全文尾部时覆盖阶段内容。`
        );
      }
      const current = stageBodies.get(stageId) ?? "";
      if (current.trim() && params.allow_overwrite_existing !== true) {
        return textResult(
          `「${stageLabel(stageId)}」已有内容。局部修改请使用 replace_current_stage_text；整体重写需明确设置 allow_overwrite_existing=true。`
        );
      }
      const text = String(params.text ?? "").trim();
      if (!text) return textResult("未写入：文本为空。");
      return editorMutationResult(
        input,
        stageBodies,
        stageRevisions,
        stageId,
        text,
        `已生成覆盖「${stageLabel(stageId)}」的文本变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

function buildReplaceStageTextTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  currentStage: () => ShortWorkspaceStageId,
  options: { name?: string; label?: string } = {}
): AgentTool {
  const allowedTargets = writableStageIds(input.profile);
  return defineTool({
    name: options.name ?? "replace_current_stage_text",
    label: options.label ?? "替换当前阶段文本",
    description:
      "按原文片段精确替换当前智能体可写阶段的内容。每个 original_text 必须在目标文本中唯一存在。",
    parameters: Type.Object({
      target_stage_id: Type.Optional(literalUnion(allowedTargets)),
      replacements: Type.Array(
        Type.Object({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }),
        { minItems: 1, maxItems: 20 }
      )
    }),
    execute: async (_toolCallId, params) => {
      const fallback = allowedTargets.includes(currentStage())
        ? currentStage()
        : allowedTargets[0]!;
      const stageId = params.target_stage_id
        ? (String(params.target_stage_id) as ShortWorkspaceStageId)
        : fallback;
      const snapshot = input.workspace.stages.find(
        (stage) => stage.stageId === stageId
      );
      if (snapshot?.truncated) {
        return textResult(
          `未替换：「${stageLabel(stageId)}」超过本轮安全快照上限，无法在看不到全文尾部时执行局部替换。请缩小文稿或等待后续持久化编辑接口。`
        );
      }
      const replacements = params.replacements as Array<{
        original_text: string;
        new_text: string;
      }>;
      const result = replaceText(stageBodies.get(stageId) ?? "", replacements);
      if (result.error || result.next === undefined) {
        return textResult(`未替换：${result.error ?? "未知错误"}`);
      }
      return editorMutationResult(
        input,
        stageBodies,
        stageRevisions,
        stageId,
        result.next,
        `已生成「${stageLabel(stageId)}」的 ${result.count} 处文本变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

function activeExpertSectionId(
  input: BuildShortWorkspaceToolsInput
): string | undefined {
  return input.workspace.activeAgentId === "expert_section_writer"
    ? input.workspace.activeSectionId
    : undefined;
}

/**
 * Creates the per-parent-run mutation/revision overlay. Parent and child tools
 * receive this same object, while each tool set keeps its own read evidence.
 */
export function createShortWorkspaceToolSharedState(
  workspace: ShortWorkspaceSnapshot
): ShortWorkspaceToolSharedState {
  const expertSections = new Map(
    workspace.expertDraft.sections.map((section) => [
      section.id,
      {
        ...section,
        body: { ...section.body },
        characterState: { ...section.characterState }
      }
    ] as const)
  );
  return {
    stageBodies: new Map<ShortWorkspaceStageId, string>(
      workspace.stages.map((stage) => [stage.stageId, stage.content])
    ),
    stageRevisions: new Map<ShortWorkspaceStageId, string>(
      workspace.stages.map((stage) => [stage.stageId, stage.revision])
    ),
    expertSections,
    expertSectionOrder: workspace.expertDraft.sections.map((section) => section.id),
    pendingExpertSectionTitles: new Set<string>(),
    pendingSectionSeq: 0,
    expertDraftDirectoryBaseRevision: workspace.expertDraft.revision
  };
}

function nextProvisionalSectionId(
  sharedState: ShortWorkspaceToolSharedState
): string {
  sharedState.pendingSectionSeq += 1;
  return `${PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX}${sharedState.pendingSectionSeq}`;
}

function createBlankProvisionalSection(
  sectionId: string,
  title: string,
  wordCountRequirement: string
): ExpertDraftSectionSnapshot {
  const emptyRevision = createShortWorkspaceContentRevision("");
  return {
    id: sectionId,
    title,
    wordCountRequirement,
    body: {
      documentId: catalogDraftBodyDocumentId(sectionId),
      title,
      content: "",
      revision: emptyRevision
    },
    characterState: {
      documentId: catalogDraftCharacterStateDocumentId(sectionId),
      title: `${title} · 人物状态`,
      content: "",
      revision: emptyRevision
    }
  };
}

function orderedExpertSections(
  input: BuildShortWorkspaceToolsInput,
  expertSections: ExpertSectionMap
): ExpertDraftSectionSnapshot[] {
  const order =
    input.sharedState?.expertSectionOrder ??
    input.workspace.expertDraft.sections.map((section) => section.id);
  return order
    .map((sectionId) => expertSections.get(sectionId))
    .filter((section): section is ExpertDraftSectionSnapshot => Boolean(section));
}

function buildCreateExpertDraftSectionsTool(
  input: BuildShortWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState
): AgentTool {
  return defineTool({
    name: "create_draft_sections",
    label: "创建章节文件",
    description:
      "一次创建一个或多个空白正文章节；每章会生成独立的正文文件和人物状态文件，并返回可在同一轮继续写入的 section_id。只新增结构，不写正文、不删除或覆盖已有章节。",
    parameters: Type.Object({
      sections: Type.Array(
        Type.Object({
          title: Type.String({ minLength: 1, maxLength: 240 }),
          word_count_requirement: Type.Optional(
            Type.String({ maxLength: 1_000 })
          )
        }),
        { minItems: 1, maxItems: 100 }
      ),
      after_section_id: Type.Optional(
        Type.String({ minLength: 1, maxLength: 120 })
      )
    }),
    execute: async (_toolCallId, params) => {
      const requested = params.sections as Array<{
        title: string;
        word_count_requirement?: string;
      }>;
      const sections = requested.map((section) => ({
        title: String(section.title ?? "").trim(),
        wordCountRequirement: String(
          section.word_count_requirement ?? ""
        ).trim()
      }));
      if (sections.some((section) => !section.title)) {
        return textResult("未创建：章节标题不能为空。");
      }

      const duplicateTitles = sections
        .map((section) => section.title)
        .filter((title, index, titles) => titles.indexOf(title) !== index);
      if (duplicateTitles.length > 0) {
        return textResult(
          `未创建：本次参数中包含重复章节标题：${[...new Set(duplicateTitles)].join("、")}。`
        );
      }

      const existingTitles = new Set([
        ...orderedExpertSections(input, sharedState.expertSections).map(
          (section) => section.title
        ),
        ...sharedState.pendingExpertSectionTitles
      ]);
      const conflicts = sections
        .map((section) => section.title)
        .filter((title) => existingTitles.has(title));
      if (conflicts.length > 0) {
        return textResult(
          `未创建：正文目录已存在同名章节：${conflicts.join("、")}。初始化时请只提交尚未存在的章节。`
        );
      }

      const currentCount = sharedState.expertSectionOrder.length;
      if (currentCount + sections.length > 100) {
        return textResult(
          `未创建：正文最多支持 100 个章节，当前已有或待创建 ${currentCount} 个，本次请求 ${sections.length} 个。`
        );
      }

      const afterSectionId = String(params.after_section_id ?? "").trim();
      if (afterSectionId && !sharedState.expertSections.has(afterSectionId)) {
        return textResult(`未创建：找不到插入位置章节 ${afterSectionId}。`);
      }

      let insertAt = sharedState.expertSectionOrder.length;
      if (afterSectionId) {
        const afterIndex = sharedState.expertSectionOrder.indexOf(afterSectionId);
        if (afterIndex < 0) {
          return textResult(`未创建：找不到插入位置章节 ${afterSectionId}。`);
        }
        insertAt = afterIndex + 1;
      }

      const createdSections: Array<{
        title: string;
        wordCountRequirement: string;
        provisionalSectionId: string;
      }> = [];
      for (const [offset, section] of sections.entries()) {
        const provisionalSectionId = nextProvisionalSectionId(sharedState);
        const snapshot = createBlankProvisionalSection(
          provisionalSectionId,
          section.title,
          section.wordCountRequirement
        );
        sharedState.expertSections.set(provisionalSectionId, snapshot);
        sharedState.expertSectionOrder.splice(insertAt + offset, 0, provisionalSectionId);
        sharedState.pendingExpertSectionTitles.add(section.title);
        createdSections.push({
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          provisionalSectionId
        });
      }

      const idLines = createdSections
        .map(
          (section, index) =>
            `${index + 1}. ${section.title} → section_id=${section.provisionalSectionId}`
        )
        .join("\n");
      const summary = `已生成创建 ${createdSections.length} 个空白章节文件的变更，等待用户审阅。`;
      const resultSummary =
        input.writeApprovalMode === "auto-approve"
          ? summary.replace(
              "，等待用户审阅。",
              "，将在本轮完成后自动批准并保存。"
            )
          : summary;
      return textResult(
        `${resultSummary}\n${idLines}\n同一轮内可立即使用上述 section_id 读取或写入正文。`,
        {
          kind: "workspace-expert-draft-section-creation",
          workspaceId: input.workspace.id,
          stageId: "draft",
          sections: createdSections,
          ...(afterSectionId ? { afterSectionId } : {}),
          baseRevision: sharedState.expertDraftDirectoryBaseRevision,
          summary: resultSummary
        }
      );
    },
    executionMode: "sequential"
  });
}

function fileSizeLabel(content: string): string {
  return content.length ? `${content.length.toLocaleString("zh-CN")} 字符` : "空";
}

function previewExcerpt(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= DRAFT_PREVIEW_EXCERPT_CHARACTERS * 2) return compact;
  return (
    `${compact.slice(0, DRAFT_PREVIEW_EXCERPT_CHARACTERS)}` +
    `……〔中间省略 ${(compact.length - DRAFT_PREVIEW_EXCERPT_CHARACTERS * 2).toLocaleString("zh-CN")} 字符〕……` +
    `${compact.slice(-DRAFT_PREVIEW_EXCERPT_CHARACTERS)}`
  );
}

function renderDraftSectionPreview(
  section: ExpertDraftSectionSnapshot,
  index: number,
  fields: readonly DraftFileKind[]
): string {
  const lines = [
    `${index + 1}. 【${section.title}】 section_id: ${section.id}`,
    `   字数要求: ${section.wordCountRequirement || "未设置"}`
  ];
  for (const field of fields) {
    const file = section[field];
    lines.push(`   ${draftFileLabel(field)}（${file.documentId}）：${fileSizeLabel(file.content)}`);
    if (file.content.trim()) {
      lines.push(`   摘录：${previewExcerpt(file.content)}`);
    }
  }
  return lines.join("\n");
}

function renderDraftSectionFull(
  section: ExpertDraftSectionSnapshot,
  index: number,
  fields: readonly DraftFileKind[],
  characterLimitPerFile?: number
): { text: string; fullyReadDocumentIds: string[] } {
  const fullyReadDocumentIds: string[] = [];
  const blocks = fields.map((field) => {
    const file = section[field];
    const truncated =
      characterLimitPerFile !== undefined &&
      file.content.length > characterLimitPerFile;
    if (!truncated) fullyReadDocumentIds.push(file.documentId);
    const content = truncated
      ? file.content.slice(0, characterLimitPerFile)
      : file.content;
    return [
      `${draftFileLabel(field)}文件: ${file.title}（${file.documentId}）`,
      `${draftFileLabel(field)}版本: ${file.revision}`,
      "",
      content || `（${draftFileLabel(field)}为空）`,
      ...(truncated
        ? [
            "",
            `（该${draftFileLabel(field)}共 ${fileSizeLabel(file.content)}，本次只返回了开头部分；未完整读取的文件不能整节覆盖。）`
          ]
        : [])
    ].join("\n");
  });
  return {
    text: [
      `===== ${index + 1}. ${section.title} =====`,
      `section_id: ${section.id}`,
      `字数要求: ${section.wordCountRequirement || "未设置"}`,
      "",
      blocks.join("\n\n")
    ].join("\n"),
    fullyReadDocumentIds
  };
}

function buildReadDraftSectionsTool(
  input: BuildShortWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  readExpertFileIds: Set<string>
): AgentTool {
  return defineTool({
    name: "read_draft_sections",
    label: "读取正文章节",
    description:
      "按 section_id 批量读取正文章节文件，按目录顺序返回。" +
      "mode=preview 只返回标题、字数和首尾摘录，用于整篇扫描定位；" +
      `mode=full 返回完整原文，单次最多 ${DRAFT_FULL_READ_MAX_SECTIONS} 章且合计不超过 ${DRAFT_FULL_READ_CHARACTER_BUDGET.toLocaleString("zh-CN")} 个字符，超出的章节需要再次调用分批读取。` +
      "只有被 mode=full 完整读取的文件才获得整章覆盖权限。",
    parameters: Type.Object({
      section_ids: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
        minItems: 1,
        maxItems: 100
      }),
      include: Type.Optional(
        Type.Array(literalUnion(DRAFT_FILE_PARAMETER_VALUES), {
          minItems: 1,
          maxItems: DRAFT_FILE_PARAMETER_VALUES.length
        })
      ),
      mode: Type.Optional(literalUnion(["full", "preview"] as const))
    }),
    execute: async (_toolCallId, params) => {
      const requested = (params.section_ids as string[])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      const requestedIds = new Set(requested);
      const includeValues = Array.isArray(params.include) && params.include.length
        ? (params.include as string[]).map((value) => String(value))
        : ["body"];
      const fields = DRAFT_FILE_PARAMETER_VALUES.filter((value) =>
        includeValues.includes(value)
      ).map(toDraftFileKind);
      if (fields.length === 0) fields.push("body");

      const targets = orderedExpertSections(input, expertSections).filter((section) =>
        requestedIds.has(section.id)
      );
      const missing = requested.filter(
        (sectionId) => !targets.some((section) => section.id === sectionId)
      );
      if (targets.length === 0) {
        return textResult(
          `没有找到这些正文章节：${missing.join("、")}。当前目录：${orderedExpertSections(
            input,
            expertSections
          )
            .map((section) => `${section.title}（${section.id}）`)
            .join("、")}`
        );
      }

      const directoryRevision =
        input.sharedState?.expertDraftDirectoryBaseRevision ??
        input.workspace.expertDraft.revision;
      const header = [
        `书名：《${input.workspace.title}》`,
        `正文目录版本：${directoryRevision}`
      ];
      const missingNote = missing.length
        ? [`\n没有找到这些 section_id：${missing.join("、")}。`]
        : [];

      if (String(params.mode ?? "full") === "preview") {
        const previews = targets.map((section, index) =>
          renderDraftSectionPreview(section, index, fields)
        );
        return textResult(
          [
            ...header,
            `预览 ${targets.length} 章（${fields.map(draftFileLabel).join("、")}）。预览不算完整读取，改写前仍需对目标章节使用 mode=full。`,
            "",
            previews.join("\n\n"),
            ...missingNote
          ].join("\n")
        );
      }

      const rendered: string[] = [];
      let usedCharacters = 0;
      let cutoffIndex = targets.length;
      for (const [index, section] of targets.entries()) {
        const cost = fields.reduce(
          (total, field) => total + section[field].content.length,
          0
        );
        const first = index === 0;
        if (
          !first &&
          (rendered.length >= DRAFT_FULL_READ_MAX_SECTIONS ||
            usedCharacters + cost > DRAFT_FULL_READ_CHARACTER_BUDGET)
        ) {
          cutoffIndex = index;
          break;
        }
        const oversizedAlone = first && cost > DRAFT_FULL_READ_CHARACTER_BUDGET;
        const block = renderDraftSectionFull(
          section,
          index,
          fields,
          oversizedAlone
            ? Math.floor(DRAFT_FULL_READ_CHARACTER_BUDGET / fields.length)
            : undefined
        );
        block.fullyReadDocumentIds.forEach((documentId) => {
          readExpertFileIds.add(documentId);
        });
        rendered.push(block.text);
        usedCharacters += cost;
      }

      const skipped = targets.slice(cutoffIndex);
      const skippedNote = skipped.length
        ? [
            `\n本次未读取 ${skipped.length} 章（已达单次读取上限）：${skipped
              .map((section) => `${section.title}（${section.id}）`)
              .join("、")}。请再次调用 read_draft_sections 继续分批读取。`
          ]
        : [];
      return textResult(
        [
          ...header,
          `已完整读取 ${rendered.length} 章的${fields.map(draftFileLabel).join("和")}，合计约 ${usedCharacters.toLocaleString("zh-CN")} 字符。`,
          "",
          rendered.join("\n\n"),
          ...skippedNote,
          ...missingNote
        ].join("\n")
      );
    }
  });
}

/**
 * Resolves the write target shared by both draft agents. The section writer is
 * pinned to its active section because the Renderer diff/accept flow is bound
 * to the section the user selected.
 */
function resolveDraftWriteTarget(
  input: BuildShortWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  rawSectionId: unknown
): { sectionId: string } | { error: string } {
  const requested = String(rawSectionId ?? "").trim();
  const active = activeExpertSectionId(input);
  const sectionId = requested || active || "";
  if (!sectionId) {
    return {
      error: "未修改：当前没有选中章节，请在参数中给出 section_id。"
    };
  }
  if (input.profile.id === "expert_section_writer") {
    if (!active) return { error: "未修改：当前没有选中可写的章节。" };
    if (sectionId !== active) {
      return {
        error:
          `未修改：分节写手只能修改当前章节（${active}），不能写入 ${sectionId}。` +
          "跨章节修改请交给正文专家编写智能体。"
      };
    }
  }
  if (!expertSections.has(sectionId)) {
    return { error: `未修改：没有找到正文章节 ${sectionId}。` };
  }
  return { sectionId };
}

function draftTargetParameters() {
  return {
    section_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    file: Type.Optional(literalUnion(DRAFT_FILE_PARAMETER_VALUES))
  };
}

function buildWriteDraftSectionTool(
  input: BuildShortWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  readExpertFileIds: Set<string>
): AgentTool {
  return defineTool({
    name: "write_draft_section",
    label: "写入正文章节",
    description:
      "把完整内容写入指定章节的正文或人物状态文件。file 默认 body；section_id 省略时写入当前选中章节。" +
      "已有内容时必须先用 read_draft_sections（mode=full）读完该文件，并明确设置 allow_overwrite_existing=true 才能整章覆盖。",
    parameters: Type.Object({
      ...draftTargetParameters(),
      text: Type.String({ minLength: 1, maxLength: 200_000 }),
      allow_overwrite_existing: Type.Optional(Type.Boolean())
    }),
    execute: async (_toolCallId, params) => {
      const target = resolveDraftWriteTarget(input, expertSections, params.section_id);
      if ("error" in target) return textResult(target.error.replace("未修改：", "未写入："));
      const field = toDraftFileKind(params.file);
      const section = expertSections.get(target.sectionId)!;
      const file = section[field];
      const label = draftFileLabel(field);
      if (file.content.trim() && !readExpertFileIds.has(file.documentId)) {
        return textResult(
          `未写入：请先读取「${section.title}」的完整${label}文件（read_draft_sections，mode=full），再执行整章覆盖。`
        );
      }
      if (file.content.trim() && params.allow_overwrite_existing !== true) {
        return textResult(
          `「${section.title}」的${label}已有内容；局部修改请使用 replace_draft_section_text，整章重写需明确设置 allow_overwrite_existing=true。`
        );
      }
      const text = String(params.text ?? "").trim();
      if (!text) return textResult("未写入：文本为空。");
      return expertDraftFileMutationResult(
        input,
        expertSections,
        target.sectionId,
        field,
        text,
        `已生成「${section.title}」的${label}变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

function buildReplaceDraftSectionTextTool(
  input: BuildShortWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  readExpertFileIds: Set<string>
): AgentTool {
  return defineTool({
    name: "replace_draft_section_text",
    label: "替换正文章节文本",
    description:
      "在指定章节的正文或人物状态文件中按原文片段精确替换。file 默认 body；section_id 省略时修改当前选中章节。" +
      "每个 original_text 必须在该文件中唯一存在。",
    parameters: Type.Object({
      ...draftTargetParameters(),
      replacements: Type.Array(
        Type.Object({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }),
        { minItems: 1, maxItems: 20 }
      )
    }),
    execute: async (_toolCallId, params) => {
      const target = resolveDraftWriteTarget(input, expertSections, params.section_id);
      if ("error" in target) return textResult(target.error.replace("未修改：", "未替换："));
      const field = toDraftFileKind(params.file);
      const section = expertSections.get(target.sectionId)!;
      const file = section[field];
      const label = draftFileLabel(field);
      if (file.content.trim() && !readExpertFileIds.has(file.documentId)) {
        return textResult(
          `未替换：请先读取「${section.title}」的完整${label}文件（read_draft_sections，mode=full）。`
        );
      }
      const replacements = params.replacements as Array<{
        original_text: string;
        new_text: string;
      }>;
      const result = replaceText(file.content, replacements);
      if (result.error || result.next === undefined) {
        return textResult(`未替换：${result.error ?? "未知错误"}`);
      }
      return expertDraftFileMutationResult(
        input,
        expertSections,
        target.sectionId,
        field,
        result.next,
        `已生成「${section.title}」${label}的 ${result.count} 处文本变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

export function buildShortWorkspaceTools(
  input: BuildShortWorkspaceToolsInput
): AgentTool[] {
  const sharedState = input.sharedState ?? createShortWorkspaceToolSharedState(input.workspace);
  const toolInput: BuildShortWorkspaceToolsInput = { ...input, sharedState };
  const { stageBodies, stageRevisions, expertSections } = sharedState;
  // This is intentionally agent-local. A child reading a file must never grant
  // its parent permission to overwrite that file (or vice versa).
  const readExpertFileIds = new Set<string>();
  let activeStageId = toolInput.workspace.activeStageId;
  const readTools = [
    buildReadWorkspaceContentTool(toolInput, stageBodies),
    buildSearchWorkspaceTextTool(toolInput, stageBodies, expertSections),
    buildQueryLinkedMaterialEntriesTool(toolInput),
    buildLoadSkillTool(toolInput)
  ];

  if (
    toolInput.profile.id === "expert_draft_coordinator" ||
    toolInput.profile.id === "expert_section_writer"
  ) {
    const draftTools = [
      buildReadDraftSectionsTool(toolInput, expertSections, readExpertFileIds),
      buildWriteDraftSectionTool(toolInput, expertSections, readExpertFileIds),
      buildReplaceDraftSectionTextTool(toolInput, expertSections, readExpertFileIds)
    ];
    return toolInput.profile.id === "expert_draft_coordinator"
      ? [
          ...readTools,
          buildCreateExpertDraftSectionsTool(toolInput, sharedState),
          ...draftTools
        ]
      : [...readTools, ...draftTools];
  }

  const tools = [...readTools];
  if (toolInput.profile.id === "plot_design") {
    tools.push(
      buildSwitchStorylineStageTool(toolInput, (stageId) => {
        activeStageId = stageId;
      })
    );
  }
  tools.push(
    buildWriteWorkspaceEditorTool(toolInput, stageBodies, stageRevisions, () => activeStageId),
    buildReplaceStageTextTool(toolInput, stageBodies, stageRevisions, () => activeStageId)
  );
  return tools;
}

export function isShortWorkspaceToolDetails(
  value: unknown
): value is ShortWorkspaceToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "none" ||
    kind === "workspace-editor-mutation" ||
    kind === "workspace-expert-draft-file-mutation" ||
    kind === "workspace-expert-draft-section-creation" ||
    kind === "workspace-stage-selection"
  );
}

export function assertKnownShortWorkspaceStage(stageId: string): ShortWorkspaceStageId {
  if (!SHORT_WORKSPACE_STAGE_IDS.includes(stageId as ShortWorkspaceStageId)) {
    throw new Error(`Unknown short workspace stage: ${stageId}`);
  }
  return stageId as ShortWorkspaceStageId;
}

export function isKnownShortMaterialKind(kind: string): boolean {
  return SHORT_MATERIAL_KINDS.includes(kind as (typeof SHORT_MATERIAL_KINDS)[number]);
}

export function isKnownShortSkillKind(kind: string): boolean {
  return SHORT_SKILL_KINDS.includes(kind as (typeof SHORT_SKILL_KINDS)[number]);
}
