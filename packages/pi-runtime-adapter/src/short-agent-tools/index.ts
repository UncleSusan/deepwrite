import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  SHORT_MATERIAL_KINDS,
  SHORT_SKILL_KINDS,
  type ScriptWorkspaceSnapshot,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import {
  buildLoadSkillTool,
  buildQueryLinkedMaterialEntriesTool
} from "./catalog-tools";
import { buildCharacterTools } from "./character-tools";
import {
  buildCreateExpertDraftSectionsTool,
  buildDeleteExpertDraftSectionTool,
  buildRenameExpertDraftSectionTool,
  buildReplaceDraftSectionTextTool,
  buildWriteDraftSectionTool
} from "./draft-tools";
import {
  buildReplaceStageTextTool,
  buildSwitchStorylineStageTool,
  buildWriteWorkspaceEditorTool
} from "./editor-tools";
import type { ShortDocumentReadCoverage } from "./paging";
import {
  buildReadDraftSectionsTool,
  buildReadWorkspaceContentTool,
  buildSearchWorkspaceTextTool
} from "./read-tools";
import {
  type BuildScriptWorkspaceToolsInput,
  type BuildShortWorkspaceToolsInput,
  type BuildWritingWorkspaceToolsInput,
  type ScriptWorkspaceToolSharedState,
  type ShortWorkspaceToolDetails,
  type ShortWorkspaceToolSharedState,
  type WritingWorkspaceSnapshot
} from "./shared";

export { SHORT_WORKSPACE_TOOL_MANIFEST } from "./manifest";
export { sanitizeToolSchemaForGemini } from "./schema";
export type {
  BuildScriptWorkspaceToolsInput,
  BuildShortWorkspaceToolsInput,
  ScriptWorkspaceToolDetails,
  ScriptWorkspaceToolSharedState,
  ShortWorkspaceToolDetails,
  ShortWorkspaceToolSharedState
} from "./shared";

/**
 * Creates the per-parent-run mutation/revision overlay. Parent and child tools
 * receive this same object, while each tool set keeps its own read evidence.
 */
function createWritingWorkspaceToolSharedState(
  workspace: WritingWorkspaceSnapshot
): ShortWorkspaceToolSharedState {
  const characterStructure = workspace.characterStructure ?? {
    format: "text" as const
  };
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
    characterItems: new Map(
      characterStructure.format === "list"
        ? characterStructure.items.map((item) => [
            item.id,
            {
              id: item.id,
              title: item.title,
              order: item.order,
              content: item.content,
              revision: item.revision
            }
          ] as const)
        : []
    ),
    characterItemOrder:
      characterStructure.format === "list"
        ? [...characterStructure.items]
            .sort((left, right) => left.order - right.order)
            .map(({ id }) => id)
        : [],
    pendingCharacterSeq: 0,
    expertSections,
    expertSectionOrder: workspace.expertDraft.sections.map((section) => section.id),
    pendingExpertSectionTitles: new Set<string>(),
    pendingSectionSeq: 0,
    expertDraftDirectoryBaseRevision: workspace.expertDraft.revision
  };
}

export function createShortWorkspaceToolSharedState(
  workspace: ShortWorkspaceSnapshot
): ShortWorkspaceToolSharedState {
  return createWritingWorkspaceToolSharedState(workspace);
}

export function createScriptWorkspaceToolSharedState(
  workspace: ScriptWorkspaceSnapshot
): ScriptWorkspaceToolSharedState {
  return createWritingWorkspaceToolSharedState(workspace);
}

function buildWritingWorkspaceTools(
  input: BuildWritingWorkspaceToolsInput
): AgentTool[] {
  const sharedState =
    input.sharedState ?? createWritingWorkspaceToolSharedState(input.workspace);
  const toolInput: BuildWritingWorkspaceToolsInput = { ...input, sharedState };
  const { stageBodies, stageRevisions, expertSections } = sharedState;
  // This is intentionally agent-local. A child reading a file must never grant
  // its parent permission to overwrite that file (or vice versa).
  const readExpertFileIds = new Set<string>();
  const readExpertFileCoverage = new Map<
    string,
    ShortDocumentReadCoverage
  >();
  let activeStageId = toolInput.workspace.activeStageId;
  const readTools = [
    buildReadWorkspaceContentTool(toolInput, stageBodies),
    buildSearchWorkspaceTextTool(toolInput, stageBodies, expertSections),
    buildQueryLinkedMaterialEntriesTool(toolInput),
    buildLoadSkillTool(toolInput),
    ...buildCharacterTools(toolInput, stageBodies, stageRevisions, sharedState),
    buildReadDraftSectionsTool(
      toolInput,
      expertSections,
      readExpertFileIds,
      readExpertFileCoverage
    )
  ];

  if (toolInput.profile.id === "expert_draft_coordinator") {
    const draftTools = [
      buildWriteDraftSectionTool(toolInput, expertSections, readExpertFileIds),
      buildReplaceDraftSectionTextTool(toolInput, expertSections, readExpertFileIds),
      buildRenameExpertDraftSectionTool(toolInput, expertSections, sharedState),
      buildDeleteExpertDraftSectionTool(toolInput, expertSections, sharedState)
    ];
    return [
      ...readTools,
      buildCreateExpertDraftSectionsTool(toolInput, sharedState),
      ...draftTools
    ];
  }

  const tools = [...readTools];
  if (toolInput.profile.id === "plot_design") {
    tools.push(
      buildSwitchStorylineStageTool(toolInput, (stageId) => {
        activeStageId = stageId;
      })
    );
  }
  if (
    toolInput.profile.id === "character_design" &&
    (toolInput.workspace.characterStructure?.format ?? "text") === "list"
  ) {
    return tools;
  }
  tools.push(
    buildWriteWorkspaceEditorTool(toolInput, stageBodies, stageRevisions, () => activeStageId),
    buildReplaceStageTextTool(toolInput, stageBodies, stageRevisions, () => activeStageId)
  );
  return tools;
}

export function buildShortWorkspaceTools(
  input: BuildShortWorkspaceToolsInput
): AgentTool[] {
  return buildWritingWorkspaceTools({
    workspaceType: "short",
    ...input
  });
}

export function buildScriptWorkspaceTools(
  input: BuildScriptWorkspaceToolsInput
): AgentTool[] {
  return buildWritingWorkspaceTools({
    workspaceType: "script",
    ...input
  });
}

export function isShortWorkspaceToolDetails(
  value: unknown
): value is ShortWorkspaceToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "none" ||
    kind === "workspace-editor-mutation" ||
    kind === "workspace-character-file-mutation" ||
    kind === "workspace-character-structure-mutation" ||
    kind === "workspace-expert-draft-file-mutation" ||
    kind === "workspace-expert-draft-section-creation" ||
    kind === "workspace-expert-draft-section-rename" ||
    kind === "workspace-expert-draft-section-deletion" ||
    kind === "workspace-stage-selection"
  );
}

export function assertKnownShortWorkspaceStage(stageId: string): ShortWorkspaceStageId {
  if (
    stageId !== "character_design" &&
    stageId !== "draft" &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(stageId)
  ) {
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
