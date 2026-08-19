import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS,
  type AgentWriteApprovalMode,
  type ExpertDraftSectionSnapshot,
  type ScriptWorkspaceAgentProfile,
  type ScriptWorkspaceSnapshot,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

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
      kind: "workspace-character-file-mutation";
      workspaceId: string;
      stageId: "character_design";
      documentId: string;
      itemId?: string;
      text: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-character-structure-mutation";
      workspaceId: string;
      stageId: "character_design";
      mutation:
        | { type: "createItem"; title: string; provisionalItemId: string }
        | {
            type: "updateItem";
            itemId: string;
            previousTitle: string;
            title: string;
          }
        | {
            type: "moveItem";
            itemId: string;
            direction: "up" | "down";
            title: string;
          }
        | {
            type: "deleteItem";
            itemId: string;
            title: string;
            deletedText: string;
          };
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
      kind: "workspace-expert-draft-section-rename";
      workspaceId: string;
      stageId: "draft";
      sectionId: string;
      previousTitle: string;
      title: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-expert-draft-section-deletion";
      workspaceId: string;
      stageId: "draft";
      sectionId: string;
      title: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-stage-selection";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
    };

/** Script-facing alias kept separate so its mutation protocol can diverge later. */
export type ScriptWorkspaceToolDetails = ShortWorkspaceToolDetails;

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

export interface BuildScriptWorkspaceToolsInput {
  workspace: ScriptWorkspaceSnapshot;
  profile: ScriptWorkspaceAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  /** Shared across the parent and its children during one script run. */
  sharedState?: ScriptWorkspaceToolSharedState;
}

export type WritingWorkspaceType = "short" | "script";

export interface WritingWorkspaceSnapshot {
  id: ShortWorkspaceSnapshot["id"];
  title: ShortWorkspaceSnapshot["title"];
  activeStageId: ShortWorkspaceStageId;
  activeAgentId?:
    | ShortWorkspaceSnapshot["activeAgentId"]
    | ScriptWorkspaceSnapshot["activeAgentId"];
  activeSectionId?: ShortWorkspaceSnapshot["activeSectionId"];
  expertDraft: ShortWorkspaceSnapshot["expertDraft"];
  plotStages: ShortWorkspaceSnapshot["plotStages"];
  characterStructure: ShortWorkspaceSnapshot["characterStructure"];
  stages: ShortWorkspaceSnapshot["stages"];
}

export interface WritingWorkspaceAgentProfile {
  id: ShortWorkspaceAgentProfile["id"] | ScriptWorkspaceAgentProfile["id"];
  readAccess:
    | ShortWorkspaceAgentProfile["readAccess"]
    | ScriptWorkspaceAgentProfile["readAccess"];
}

export interface BuildWritingWorkspaceToolsInput {
  workspaceType: WritingWorkspaceType;
  workspace: WritingWorkspaceSnapshot;
  profile: WritingWorkspaceAgentProfile;
  writeApprovalMode?: AgentWriteApprovalMode;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  sharedState?: ShortWorkspaceToolSharedState;
}

export type ExpertSectionMap = Map<string, ExpertDraftSectionSnapshot>;

export interface ShortWorkspaceToolSharedState {
  stageBodies: Map<ShortWorkspaceStageId, string>;
  stageRevisions: Map<ShortWorkspaceStageId, string>;
  characterItems: Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      content: string;
      revision: string;
      provisional?: boolean;
    }
  >;
  characterItemOrder: string[];
  pendingCharacterSeq: number;
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

/** Script-facing alias kept separate so its run overlay can diverge later. */
export type ScriptWorkspaceToolSharedState = ShortWorkspaceToolSharedState;

export type DraftFileKind = "body" | "characterState";

export const DRAFT_FILE_PARAMETER_VALUES = ["body", "character_state"] as const;

export function toDraftFileKind(value: unknown): DraftFileKind {
  return String(value ?? "body") === "character_state"
    ? "characterState"
    : "body";
}

export function draftFileLabel(field: DraftFileKind): string {
  return field === "body" ? "正文" : "人物状态";
}

export function textResult(
  text: string,
  details: ShortWorkspaceToolDetails = { kind: "none" }
): AgentToolResult<ShortWorkspaceToolDetails> {
  return { content: [{ type: "text", text }], details };
}

export function stageLabel(
  input: BuildWritingWorkspaceToolsInput,
  stageId: ShortWorkspaceStageId
): string {
  if (stageId === "character_design") return "人物";
  if (stageId === "draft") return "正文";
  return (
    input.workspace.plotStages.find(({ id }) => id === stageId)?.title ??
    stageId
  );
}

export function workspaceKindLabel(
  input: BuildWritingWorkspaceToolsInput
): string {
  return input.workspaceType === "script" ? "剧本" : "短篇";
}

export function workspaceTitleLabel(
  input: BuildWritingWorkspaceToolsInput
): string {
  return input.workspaceType === "script" ? "剧名" : "书名";
}

export function draftUnitLabel(input: BuildWritingWorkspaceToolsInput): string {
  return input.workspaceType === "script" ? "剧集" : "章节";
}

export function draftUnitCounter(
  input: BuildWritingWorkspaceToolsInput
): string {
  return input.workspaceType === "script" ? "集" : "章";
}

export function draftContentUnitLabel(
  input: BuildWritingWorkspaceToolsInput
): string {
  return input.workspaceType === "script" ? "剧集" : "正文章节";
}

export function storylineStageIds(
  input: BuildWritingWorkspaceToolsInput
): ShortWorkspaceStageId[] {
  const available = new Set<ShortWorkspaceStageId>(
    input.workspace.stages.map((stage) => stage.stageId)
  );
  return input.workspace.plotStages
    .map(({ id }) => id)
    .filter((stageId) => available.has(stageId));
}

export function readableStageIds(
  input: BuildWritingWorkspaceToolsInput
): ShortWorkspaceStageId[] {
  const targets = input.workspace.stages.map(({ stageId }) => stageId);
  if (!targets.includes("draft")) targets.push("draft");
  return targets;
}

export function scriptBodyToolConstraint(
  input: BuildWritingWorkspaceToolsInput
): string {
  return input.workspaceType === "script"
    ? `\n当 file=body 时，剧本正文必须遵守以下不可编辑格式约束：\n${SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS.trim()}\n` +
        "写入 body 的 text 或 replacements[].new_text 不得包含 Markdown 表格、分析标题或格式讲解。"
    : "";
}

export function lineColumnAt(
  text: string,
  index: number
): { line: number; column: number } {
  const prefix = text.slice(0, index);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function replaceText(
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
      return {
        count,
        error: `原文片段出现多次，请提供更长且唯一的上下文：${original.slice(0, 80)}`
      };
    }
    next = `${next.slice(0, first)}${replacement.new_text}${next.slice(first + original.length)}`;
    count += 1;
  }
  return { next, count };
}

export function writableStageIds(
  input: BuildWritingWorkspaceToolsInput
): ShortWorkspaceStageId[] {
  const { profile } = input;
  if (profile.id === "character_design") return ["character_design"];
  if (profile.id === "plot_design") {
    return storylineStageIds(input);
  }
  return ["draft"];
}

export function orderedExpertSections(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap
): ExpertDraftSectionSnapshot[] {
  const order =
    input.sharedState?.expertSectionOrder ??
    input.workspace.expertDraft.sections.map((section) => section.id);
  return order
    .map((sectionId) => expertSections.get(sectionId))
    .filter((section): section is ExpertDraftSectionSnapshot =>
      Boolean(section)
    );
}
