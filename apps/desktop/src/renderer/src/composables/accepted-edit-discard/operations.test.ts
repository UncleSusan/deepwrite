import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import type { LongWorkspaceRendererApi } from "../../types/longWorkspace";
import { AcceptedEditDiscardConflictError } from "../../utils/acceptedEditDiscard";
import type { ProposalCoordinatorContext } from "../proposal-coordinator/types";
import { discardAcceptedLongFileEdit } from "./long";
import { discardAcceptedCatalogTextEdit } from "./short";

function acceptedProposal(): AgentEditProposal {
  return {
    id: "proposal-1",
    runId: "run-1",
    workspaceId: "book-1",
    stageId: "draft",
    documentId: "document-1",
    title: "第一章",
    summary: "修改正文",
    status: "accepted",
    baseRevision: createShortWorkspaceContentRevision("修改前"),
    proposedRevision: createShortWorkspaceContentRevision("修改后"),
    toolCallIds: ["tool-1"],
    additions: 1,
    deletions: 1,
    hunks: [],
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
    discardSnapshot: {
      beforeText: "修改前",
      beforeTitle: "第一章"
    }
  };
}

function shortContext(options: { dirty?: boolean; content?: string } = {}) {
  const applyAcceptedDocumentLocally = vi.fn();
  const context = {
    api: () => undefined,
    editor: {
      documents: ref([
        {
          id: "document-1",
          title: "第一章",
          content: options.content ?? "修改后"
        }
      ]),
      drafts: ref(
        options.dirty
          ? {
              "document-1": {
                title: "第一章",
                content: "本地未保存编辑",
                dirty: true
              }
            }
          : {}
      )
    },
    catalog: {
      applyAcceptedDocumentLocally
    }
  } as unknown as ProposalCoordinatorContext;
  return { context, applyAcceptedDocumentLocally };
}

function longApi(options: { content?: string; revision?: string } = {}) {
  const readDocument = vi.fn(async () => ({
    bookId: "long-book-1",
    file: {
      id: "long-file-1",
      revision: options.revision ?? "revision-after"
    },
    workspaceRevision: 7,
    projectRevision: 11,
    offset: 0,
    content: options.content ?? "修改后",
    nextOffset: null
  }));
  const writeDocument = vi.fn(async () => ({
    summary: { id: "long-book-1" }
  }));
  return {
    api: { readDocument, writeDocument } as unknown as LongWorkspaceRendererApi,
    readDocument,
    writeDocument
  };
}

describe("accepted edit discard operations", () => {
  it("restores the short document snapshot when the accepted content is current", async () => {
    const { context, applyAcceptedDocumentLocally } = shortContext();

    await discardAcceptedCatalogTextEdit(context, acceptedProposal());

    expect(applyAcceptedDocumentLocally).toHaveBeenCalledWith(
      { id: "document-1", title: "第一章", content: "修改前" },
      undefined,
      undefined
    );
  });

  it("does not overwrite later or unsaved short-document edits", async () => {
    const later = shortContext({ content: "后续修改" });
    const dirty = shortContext({ dirty: true });

    await expect(
      discardAcceptedCatalogTextEdit(later.context, acceptedProposal())
    ).rejects.toBeInstanceOf(AcceptedEditDiscardConflictError);
    await expect(
      discardAcceptedCatalogTextEdit(dirty.context, acceptedProposal())
    ).rejects.toBeInstanceOf(AcceptedEditDiscardConflictError);
    expect(later.applyAcceptedDocumentLocally).not.toHaveBeenCalled();
    expect(dirty.applyAcceptedDocumentLocally).not.toHaveBeenCalled();
  });

  it("restores a long document only when its accepted revision is still current", async () => {
    const { api, writeDocument } = longApi();

    await discardAcceptedLongFileEdit(api, "long-book-1", {
      fileId: "long-file-1",
      operation: "edit",
      beforeText: "修改前",
      afterText: "修改后",
      nextRevision: "revision-after"
    });

    expect(writeDocument).toHaveBeenCalledWith({
      bookId: "long-book-1",
      fileId: "long-file-1",
      content: "修改前",
      baseRevision: "revision-after",
      baseWorkspaceRevision: 7,
      baseProjectRevision: 11
    });
  });

  it("rejects long creation and later document revisions without writing", async () => {
    const later = longApi({ revision: "revision-later" });
    const creation = longApi();

    await expect(
      discardAcceptedLongFileEdit(later.api, "long-book-1", {
        fileId: "long-file-1",
        operation: "edit",
        beforeText: "修改前",
        afterText: "修改后",
        nextRevision: "revision-after"
      })
    ).rejects.toBeInstanceOf(AcceptedEditDiscardConflictError);
    await expect(
      discardAcceptedLongFileEdit(creation.api, "long-book-1", {
        fileId: "long-file-1",
        operation: "create",
        beforeText: "",
        afterText: "修改后",
        nextRevision: "revision-after"
      })
    ).rejects.toBeInstanceOf(AcceptedEditDiscardConflictError);
    expect(later.writeDocument).not.toHaveBeenCalled();
    expect(creation.writeDocument).not.toHaveBeenCalled();
  });
});
