import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  isProvisionalExpertDraftSectionId,
  PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX,
  type ExpertDraftSectionSnapshot
} from "@deepwrite/contracts";
import { defineTool, literalUnion } from "./schema";
import {
  DRAFT_FILE_PARAMETER_VALUES,
  draftContentUnitLabel,
  draftFileLabel,
  draftUnitCounter,
  draftUnitLabel,
  orderedExpertSections,
  replaceText,
  scriptBodyToolConstraint,
  textResult,
  toDraftFileKind,
  type BuildWritingWorkspaceToolsInput,
  type ExpertSectionMap,
  type ShortWorkspaceToolDetails,
  type ShortWorkspaceToolSharedState
} from "./shared";

function expertDraftFileMutationResult(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  sectionId: string,
  fileKind: "body" | "characterState",
  text: string,
  summary: string
): AgentToolResult<ShortWorkspaceToolDetails> {
  const section = expertSections.get(sectionId);
  const file = section?.[fileKind];
  if (!section || !file) {
    return textResult(
      `未写入：没有找到${draftContentUnitLabel(input)} ${sectionId} 的目标文件。`
    );
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
  const resultSummary =
    input.writeApprovalMode === "auto-approve"
      ? summary.replace(
          "，等待用户审阅。",
          "，将立即提交自动保存队列；以审批卡的落盘状态为准。"
        )
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

function activeExpertSectionId(
  input: BuildWritingWorkspaceToolsInput
): string | undefined {
  return input.workspace.activeSectionId;
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

/**
 * Resolves the write target shared by both draft agents. The short draft
 * coordinator may receive an active section as its default target while still
 * retaining cross-section authority.
 */
function resolveDraftWriteTarget(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  rawSectionId: unknown
): { sectionId: string } | { error: string } {
  const requested = String(rawSectionId ?? "").trim();
  const active = activeExpertSectionId(input);
  const sectionId = requested || active || "";
  if (!sectionId) {
    return {
      error: `未修改：当前没有选中${draftUnitLabel(input)}，请在参数中给出 section_id。`
    };
  }
  if (!expertSections.has(sectionId)) {
    return {
      error: `未修改：没有找到${draftContentUnitLabel(input)} ${sectionId}。`
    };
  }
  return { sectionId };
}

function draftTargetParameters() {
  return {
    section_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    file: Type.Optional(literalUnion(DRAFT_FILE_PARAMETER_VALUES))
  };
}

export function buildRenameExpertDraftSectionTool(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  sharedState: ShortWorkspaceToolSharedState
): AgentTool {
  return defineTool({
    name: "rename_draft_section",
    label: `修改${draftUnitLabel(input)}名称`,
    description:
      `修改已有${draftContentUnitLabel(input)}的目录名称；同步更新正文文件标题与人物状态文件标题，不改正文内容、不删除、不调序。` +
      `变更形成待审阅提案，由客户端按本轮审批模式处理。`,
    parameters: Type.Object({
      section_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      title: Type.String({ minLength: 1, maxLength: 240 })
    }),
    execute: async (_toolCallId, params) => {
      const target = resolveDraftWriteTarget(
        input,
        expertSections,
        params.section_id
      );
      if ("error" in target) {
        return textResult(target.error.replace(/^未修改：/u, "未改名："));
      }
      const section = expertSections.get(target.sectionId);
      if (!section) {
        return textResult(
          `未改名：没有找到${draftContentUnitLabel(input)} ${target.sectionId}。`
        );
      }
      if (isProvisionalExpertDraftSectionId(section.id)) {
        return textResult(
          `未改名：${draftUnitLabel(input)}「${section.title}」尚在本轮待创建，请在创建审批通过后再改名，或在创建时直接使用目标标题。`
        );
      }
      const title = String(params.title ?? "").trim();
      if (!title) {
        return textResult(`未改名：${draftUnitLabel(input)}标题不能为空。`);
      }
      if (title === section.title) {
        return textResult(`未改名：「${section.title}」的标题没有变化。`);
      }
      const conflicting = orderedExpertSections(input, expertSections).find(
        (candidate) => candidate.id !== section.id && candidate.title === title
      );
      if (conflicting) {
        return textResult(
          `未改名：正文目录已存在同名${draftUnitLabel(input)}「${title}」。`
        );
      }
      if (sharedState.pendingExpertSectionTitles.has(title)) {
        return textResult(
          `未改名：本轮待创建目录中已有同名${draftUnitLabel(input)}「${title}」。`
        );
      }

      const previousTitle = section.title;
      expertSections.set(section.id, {
        ...section,
        title,
        body: {
          ...section.body,
          title
        },
        characterState: {
          ...section.characterState,
          title: `${title} · 人物状态`
        }
      });

      const summary = `已生成将${draftUnitLabel(input)}「${previousTitle}」改名为「${title}」的变更，等待用户审阅。`;
      const resultSummary =
        input.writeApprovalMode === "auto-approve"
          ? summary.replace(
              "，等待用户审阅。",
              "，将立即提交自动保存队列；以审批卡的落盘状态为准。"
            )
          : summary;
      return textResult(resultSummary, {
        kind: "workspace-expert-draft-section-rename",
        workspaceId: input.workspace.id,
        stageId: "draft",
        sectionId: section.id,
        previousTitle,
        title,
        baseRevision: sharedState.expertDraftDirectoryBaseRevision,
        summary: resultSummary
      });
    },
    executionMode: "sequential"
  });
}

export function buildDeleteExpertDraftSectionTool(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  sharedState: ShortWorkspaceToolSharedState
): AgentTool {
  return defineTool({
    name: "delete_draft_section",
    label: `删除${draftUnitLabel(input)}`,
    description:
      `删除已有${draftContentUnitLabel(input)}及其正文文件、人物状态文件；正文至少保留一个${draftUnitLabel(input)}，不改名、不调序。` +
      `变更形成待审阅提案，由客户端按本轮审批模式处理。`,
    parameters: Type.Object({
      section_id: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
    }),
    execute: async (_toolCallId, params) => {
      const target = resolveDraftWriteTarget(
        input,
        expertSections,
        params.section_id
      );
      if ("error" in target) {
        return textResult(target.error.replace(/^未修改：/u, "未删除："));
      }
      const section = expertSections.get(target.sectionId);
      if (!section) {
        return textResult(
          `未删除：没有找到${draftContentUnitLabel(input)} ${target.sectionId}。`
        );
      }
      if (isProvisionalExpertDraftSectionId(section.id)) {
        return textResult(
          `未删除：${draftUnitLabel(input)}「${section.title}」尚在本轮待创建，请拒绝对应创建审批，或待创建落盘后再删除。`
        );
      }
      if (sharedState.expertSectionOrder.length <= 1) {
        return textResult(
          `未删除：正文至少需要保留一个${draftUnitLabel(input)}。`
        );
      }

      const title = section.title;
      expertSections.delete(section.id);
      const orderIndex = sharedState.expertSectionOrder.indexOf(section.id);
      if (orderIndex >= 0) {
        sharedState.expertSectionOrder.splice(orderIndex, 1);
      }

      const summary = `已生成删除${draftUnitLabel(input)}「${title}」及其正文与人物状态文件的变更，等待用户审阅。`;
      const resultSummary =
        input.writeApprovalMode === "auto-approve"
          ? summary.replace(
              "，等待用户审阅。",
              "，将立即提交自动保存队列；以审批卡的落盘状态为准。"
            )
          : summary;
      return textResult(resultSummary, {
        kind: "workspace-expert-draft-section-deletion",
        workspaceId: input.workspace.id,
        stageId: "draft",
        sectionId: section.id,
        title,
        baseRevision: sharedState.expertDraftDirectoryBaseRevision,
        summary: resultSummary
      });
    },
    executionMode: "sequential"
  });
}

export function buildCreateExpertDraftSectionsTool(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState
): AgentTool {
  return defineTool({
    name: "create_draft_sections",
    label: `创建${draftUnitLabel(input)}文件`,
    description:
      `一次创建一个或多个空白${draftContentUnitLabel(input)}；每${draftUnitCounter(input)}会生成独立的正文文件和人物状态文件，并返回可在同一轮继续写入的 section_id。` +
      `只新增结构，不写正文、不删除或覆盖已有${draftUnitLabel(input)}。`,
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
        return textResult(`未创建：${draftUnitLabel(input)}标题不能为空。`);
      }

      const duplicateTitles = sections
        .map((section) => section.title)
        .filter((title, index, titles) => titles.indexOf(title) !== index);
      if (duplicateTitles.length > 0) {
        return textResult(
          `未创建：本次参数中包含重复${draftUnitLabel(input)}标题：${[...new Set(duplicateTitles)].join("、")}。`
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
          `未创建：正文目录已存在同名${draftUnitLabel(input)}：${conflicts.join("、")}。初始化时请只提交尚未存在的${draftUnitLabel(input)}。`
        );
      }

      const currentCount = sharedState.expertSectionOrder.length;
      if (currentCount + sections.length > 100) {
        return textResult(
          `未创建：正文最多支持 100 个${draftUnitLabel(input)}，当前已有或待创建 ${currentCount} 个，本次请求 ${sections.length} 个。`
        );
      }

      const afterSectionId = String(params.after_section_id ?? "").trim();
      if (afterSectionId && !sharedState.expertSections.has(afterSectionId)) {
        return textResult(
          `未创建：找不到插入位置${draftUnitLabel(input)} ${afterSectionId}。`
        );
      }

      let insertAt = sharedState.expertSectionOrder.length;
      if (afterSectionId) {
        const afterIndex =
          sharedState.expertSectionOrder.indexOf(afterSectionId);
        if (afterIndex < 0) {
          return textResult(
            `未创建：找不到插入位置${draftUnitLabel(input)} ${afterSectionId}。`
          );
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
        sharedState.expertSectionOrder.splice(
          insertAt + offset,
          0,
          provisionalSectionId
        );
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
      const summary = `已生成创建 ${createdSections.length} 个空白${draftUnitLabel(input)}文件的变更，等待用户审阅。`;
      const resultSummary =
        input.writeApprovalMode === "auto-approve"
          ? summary.replace(
              "，等待用户审阅。",
              "，将立即提交自动保存队列；以审批卡的落盘状态为准。"
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

export function buildWriteDraftSectionTool(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  readExpertFileIds: Set<string>
): AgentTool {
  return defineTool({
    name: "write_draft_section",
    label: input.workspaceType === "script" ? "写入剧集正文" : "写入正文章节",
    description:
      `把完整内容写入指定${draftUnitLabel(input)}的正文或人物状态文件。file 默认 body；section_id 省略时写入当前选中${draftUnitLabel(input)}。` +
      `已有内容时必须先用 read_draft_sections（mode=full）读完该文件，并明确设置 allow_overwrite_existing=true 才能整${draftUnitCounter(input)}覆盖。` +
      scriptBodyToolConstraint(input),
    parameters: Type.Object({
      ...draftTargetParameters(),
      text: Type.String({ minLength: 1, maxLength: 200_000 }),
      allow_overwrite_existing: Type.Optional(Type.Boolean())
    }),
    execute: async (_toolCallId, params) => {
      const target = resolveDraftWriteTarget(
        input,
        expertSections,
        params.section_id
      );
      if ("error" in target)
        return textResult(target.error.replace("未修改：", "未写入："));
      const field = toDraftFileKind(params.file);
      const section = expertSections.get(target.sectionId)!;
      const file = section[field];
      const label = draftFileLabel(field);
      if (file.content.trim() && !readExpertFileIds.has(file.documentId)) {
        return textResult(
          `未写入：请先读取「${section.title}」的完整${label}文件（read_draft_sections，mode=full），再执行整${draftUnitCounter(input)}覆盖。`
        );
      }
      if (file.content.trim() && params.allow_overwrite_existing !== true) {
        return textResult(
          `「${section.title}」的${label}已有内容；局部修改请使用 replace_draft_section_text，整${draftUnitCounter(input)}重写需明确设置 allow_overwrite_existing=true。`
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

export function buildReplaceDraftSectionTextTool(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  readExpertFileIds: Set<string>
): AgentTool {
  return defineTool({
    name: "replace_draft_section_text",
    label:
      input.workspaceType === "script"
        ? "替换剧集正文文本"
        : "替换正文章节文本",
    description:
      `在指定${draftUnitLabel(input)}的正文或人物状态文件中按原文片段精确替换。file 默认 body；section_id 省略时修改当前选中${draftUnitLabel(input)}。` +
      "每个 original_text 必须在该文件中唯一存在。" +
      scriptBodyToolConstraint(input),
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
      const target = resolveDraftWriteTarget(
        input,
        expertSections,
        params.section_id
      );
      if ("error" in target)
        return textResult(target.error.replace("未修改：", "未替换："));
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
