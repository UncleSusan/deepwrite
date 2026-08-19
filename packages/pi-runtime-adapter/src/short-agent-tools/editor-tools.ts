import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  createShortWorkspaceContentRevision,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import { defineTool, literalUnion } from "./schema";
import {
  replaceText,
  stageLabel,
  storylineStageIds,
  textResult,
  workspaceKindLabel,
  writableStageIds,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolDetails
} from "./shared";

export function buildSwitchStorylineStageTool(
  input: BuildWritingWorkspaceToolsInput,
  selectStage: (stageId: ShortWorkspaceStageId) => void
): AgentTool {
  const plotStages = storylineStageIds(input);
  return defineTool({
    name: "switch_storyline_stage",
    label: "切换剧情方向",
    description: `切换${workspaceKindLabel(input)}剧情父节点下的当前子方向；只改变选中项，不写入内容。`,
    parameters: Type.Object({ target_stage_id: literalUnion(plotStages) }),
    execute: async (_toolCallId, params) => {
      const stageId = String(
        params.target_stage_id
      ) as (typeof plotStages)[number];
      if (!plotStages.includes(stageId)) {
        return textResult(
          `当前${workspaceKindLabel(input)}没有剧情方向「${stageId}」。`
        );
      }
      selectStage(stageId);
      return textResult(`已切换到「${stageLabel(input, stageId)}」。`, {
        kind: "workspace-stage-selection",
        workspaceId: input.workspace.id,
        stageId
      });
    },
    executionMode: "sequential"
  });
}

function editorMutationResult(
  input: BuildWritingWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  stageId: ShortWorkspaceStageId,
  text: string,
  summary: string
): AgentToolResult<ShortWorkspaceToolDetails> {
  const baseRevision = stageRevisions.get(stageId);
  if (!baseRevision) {
    return textResult(
      `未写入：缺少「${stageLabel(input, stageId)}」的基础版本标识。`
    );
  }
  stageBodies.set(stageId, text);
  stageRevisions.set(stageId, createShortWorkspaceContentRevision(text));
  const resultSummary =
    input.writeApprovalMode === "auto-approve"
      ? summary.replace(
          "，等待用户审阅。",
          "，将立即提交自动保存队列；以审批卡的落盘状态为准。"
        )
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

export function buildWriteWorkspaceEditorTool(
  input: BuildWritingWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  currentStage: () => ShortWorkspaceStageId
): AgentTool {
  const allowedTargets: ShortWorkspaceStageId[] = writableStageIds(
    input
  ).filter((stageId) => stageId !== "draft");
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
          `未写入：「${stageLabel(input, stageId)}」超过本轮安全快照上限，无法在看不到全文尾部时覆盖阶段内容。`
        );
      }
      const current = stageBodies.get(stageId) ?? "";
      if (current.trim() && params.allow_overwrite_existing !== true) {
        return textResult(
          `「${stageLabel(input, stageId)}」已有内容。局部修改请使用 replace_current_stage_text；整体重写需明确设置 allow_overwrite_existing=true。`
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
        `已生成覆盖「${stageLabel(input, stageId)}」的文本变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}

export function buildReplaceStageTextTool(
  input: BuildWritingWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  currentStage: () => ShortWorkspaceStageId,
  options: { name?: string; label?: string } = {}
): AgentTool {
  const allowedTargets = writableStageIds(input);
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
          `未替换：「${stageLabel(input, stageId)}」超过本轮安全快照上限，无法在看不到全文尾部时执行局部替换。请缩小文稿或等待后续持久化编辑接口。`
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
        `已生成「${stageLabel(input, stageId)}」的 ${result.count} 处文本变更，等待用户审阅。`
      );
    },
    executionMode: "sequential"
  });
}
