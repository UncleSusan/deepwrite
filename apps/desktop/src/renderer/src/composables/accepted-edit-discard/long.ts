import {
  LONG_DOCUMENT_PAGE_MAX_CHARACTERS,
  LongWorkspaceOperationBatchSchema,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { LongWorkspaceRendererApi } from "../../types/longWorkspace";
import { AcceptedEditDiscardConflictError } from "../../utils/acceptedEditDiscard";

export interface AcceptedLongFileEdit {
  fileId: string;
  operation: "create" | "write" | "edit";
  beforeText: string;
  afterText: string;
  nextRevision: string;
}

async function readCompleteLongDocument(
  api: LongWorkspaceRendererApi,
  bookId: string,
  fileId: string
) {
  let offset = 0;
  let content = "";
  let firstPage: Awaited<ReturnType<typeof api.readDocument>> | undefined;
  for (;;) {
    const page = await api.readDocument({
      bookId,
      fileId,
      offset,
      maxCharacters: LONG_DOCUMENT_PAGE_MAX_CHARACTERS
    });
    firstPage ??= page;
    if (
      page.bookId !== firstPage.bookId ||
      page.file.id !== firstPage.file.id ||
      page.file.revision !== firstPage.file.revision ||
      page.workspaceRevision !== firstPage.workspaceRevision ||
      page.projectRevision !== firstPage.projectRevision ||
      page.offset !== offset
    ) {
      throw new AcceptedEditDiscardConflictError(
        "目标文件在读取期间发生了变化，未舍弃本次修改。"
      );
    }
    content += page.content;
    if (page.nextOffset === null) return { page: firstPage, content };
    offset = page.nextOffset;
  }
}

export async function discardAcceptedLongFileEdit(
  api: LongWorkspaceRendererApi,
  bookId: string,
  edit: AcceptedLongFileEdit
) {
  if (edit.operation === "create") {
    throw new AcceptedEditDiscardConflictError("创建提案不能舍弃为旧内容。");
  }
  const current = await readCompleteLongDocument(api, bookId, edit.fileId);
  if (
    current.page.file.revision !== edit.nextRevision ||
    current.content !== edit.afterText
  ) {
    throw new AcceptedEditDiscardConflictError(
      "目标文件已有后续修改，未覆盖最新内容；本次修改没有被舍弃。"
    );
  }
  return api.writeDocument({
    bookId,
    fileId: edit.fileId,
    content: edit.beforeText,
    baseRevision: current.page.file.revision,
    baseWorkspaceRevision: current.page.workspaceRevision,
    baseProjectRevision: current.page.projectRevision
  });
}

export async function discardAcceptedLongOperationEdit(
  api: LongWorkspaceRendererApi,
  bookId: string,
  undoBatch: LongWorkspaceOperationBatch,
  appliedProjectRevision: number | undefined
) {
  const latest = await api.getWorkspaceIndex({ bookId });
  if (
    appliedProjectRevision === undefined ||
    latest.projectRevision !== appliedProjectRevision
  ) {
    throw new AcceptedEditDiscardConflictError(
      "剧情结构已有后续修改，未覆盖最新结构；本次修改没有被舍弃。"
    );
  }
  const batch = LongWorkspaceOperationBatchSchema.parse({
    ...undoBatch,
    baseRevision: latest.workspaceIndex.revision,
    updatedAt: new Date().toISOString()
  });
  const preview = await api.previewOperations({ bookId, batch });
  if (preview.projectRevision !== latest.projectRevision) {
    throw new AcceptedEditDiscardConflictError(
      "剧情结构在校验期间发生了变化，未舍弃本次修改。"
    );
  }
  return api.applyOperations({
    bookId,
    batch: LongWorkspaceOperationBatchSchema.parse({
      ...batch,
      expectedImpact: preview.preview.impact
    }),
    baseProjectRevision: latest.projectRevision
  });
}
