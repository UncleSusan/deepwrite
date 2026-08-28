import type { LongBookSummary } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../useLongWorkspaceProposals";
import type { LongWorkspaceRendererApi } from "../../types/longWorkspace";
import { buildLongEditUndoBatch } from "../../utils/acceptedEditDiscard";
import {
  discardAcceptedLongFileEdit,
  discardAcceptedLongOperationEdit
} from "./long";

export async function discardAcceptedLongWorkspaceProposal(
  api: LongWorkspaceRendererApi,
  item: LongWorkspaceProposalItem
): Promise<LongBookSummary> {
  const event = item.event;
  if (
    event.type === "long.worldbuilding_file_proposal" ||
    event.type === "long.character_file_proposal" ||
    event.type === "long.continuity_file_proposal"
  ) {
    const file = event.payload.files[0];
    if (!file || event.payload.files.length !== 1) {
      throw new Error("修改提案缺少唯一目标文件。");
    }
    return (await discardAcceptedLongFileEdit(api, event.payload.bookId, file))
      .summary;
  }
  if (event.type === "long.mutation_proposal") {
    const undoBatch = item.preview
      ? buildLongEditUndoBatch(event.payload.batch, item.preview)
      : undefined;
    if (!undoBatch) throw new Error("缺少结构修改前的完整快照。");
    return (
      await discardAcceptedLongOperationEdit(
        api,
        event.payload.bookId,
        undoBatch,
        item.appliedProjectRevision
      )
    ).summary;
  }
  throw new Error("该审批卡片不是可舍弃的修改。");
}
