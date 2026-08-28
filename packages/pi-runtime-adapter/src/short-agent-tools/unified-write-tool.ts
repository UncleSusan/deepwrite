import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { defineTool } from "./schema";
import {
  scriptBodyToolConstraint,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  explicitTrueParameter,
  stableWritingIdParameter,
  writingContentParameter,
  writingDocumentParameter,
  writingKindParameter,
  writingSummaryParameter
} from "./tool-parameters";
import { formShortContentProposal } from "./unified-proposal";
import {
  hasCurrentReadEvidence,
  type ShortUnifiedReadState
} from "./unified-read-tool";
import {
  assertWritableTarget,
  resolveShortUnifiedTarget
} from "./unified-target";
import {
  confirmCrossStageMutation,
  crossStageMutationPolicyText,
  crossStageMutationCancelled
} from "./user-input";

export function buildShortUnifiedWriteTool(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState
): AgentTool {
  return defineTool({
    name: "write",
    label: `整篇写入${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description:
      `向一个已有对象写入完整正文；可跨人物、剧情、正文阶段定位。${crossStageMutationPolicyText(input)}kind=draft_section 必须同时给出 document=body 或 character_state。已有非空正文必须先用 read 完整读取，并显式设置 allow_overwrite_existing=true；局部修改请使用 edit。` +
      scriptBodyToolConstraint(input),
    parameters: Type.Object(
      {
        kind: writingKindParameter,
        id: stableWritingIdParameter,
        document: Type.Optional(writingDocumentParameter),
        content: writingContentParameter,
        allow_overwrite_existing: Type.Optional(explicitTrueParameter),
        summary: writingSummaryParameter
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      if (params.kind === "draft_section" && !params.document) {
        throw new Error(
          "写入 draft_section 必须指定 document=body 或 character_state。"
        );
      }
      const target = resolveShortUnifiedTarget(input, sharedState, {
        kind: params.kind,
        id: String(params.id),
        ...(params.document ? { document: params.document } : {})
      });
      assertWritableTarget(input, target);
      const decision = await confirmCrossStageMutation(input, {
        toolCallId,
        targetStageId: target.stageId,
        targetTitle: target.title,
        operationLabel: "写入",
        ...(signal ? { signal } : {})
      });
      if (decision === "cancel") {
        return crossStageMutationCancelled(input, target.stageId);
      }
      if (target.content.trim() && !hasCurrentReadEvidence(readState, target)) {
        return textResult(`未写入：请先用 read 完整读取「${target.title}」。`);
      }
      if (target.content.trim() && params.allow_overwrite_existing !== true) {
        return textResult(
          "未写入：目标已有正文，整篇覆盖需设置 allow_overwrite_existing=true。"
        );
      }
      const content = String(params.content);
      if (!content.trim()) return textResult("未写入：content 不能为空。");
      return formShortContentProposal(
        input,
        sharedState,
        readState,
        target,
        content,
        String(params.summary)
      );
    }
  });
}
