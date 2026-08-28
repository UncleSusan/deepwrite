import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import type { ProposalCoordinatorContext } from "../proposal-coordinator/types";
import { captureWorkspaceDocumentBaselines } from "../../utils/catalogSaveReconciliation";
import { draftCharacterStateTitle } from "../../utils/draftFileTitles";
import { AcceptedEditDiscardConflictError } from "../../utils/acceptedEditDiscard";

type Context = ProposalCoordinatorContext;

function requireCurrentAcceptedDocument(
  context: Context,
  proposal: AgentEditProposal
) {
  const document = context.editor.documents.value.find(
    (candidate) => candidate.id === proposal.documentId
  );
  const snapshot = proposal.discardSnapshot;
  if (!document || snapshot?.beforeText === undefined) {
    throw new Error("缺少修改前的完整内容，无法安全舍弃本次修改。");
  }
  const draft = context.editor.drafts.value[document.id];
  if (draft?.dirty) {
    throw new AcceptedEditDiscardConflictError(
      "目标文件有未保存编辑，未舍弃本次修改。请先处理当前草稿。"
    );
  }
  if (
    createShortWorkspaceContentRevision(document.content) !==
      proposal.proposedRevision ||
    document.title !== proposal.title
  ) {
    throw new AcceptedEditDiscardConflictError(
      "目标文件已有后续修改，未覆盖最新内容；本次修改没有被舍弃。"
    );
  }
  return { document, snapshot };
}

export async function discardAcceptedCatalogTextEdit(
  context: Context,
  proposal: AgentEditProposal
): Promise<void> {
  const api = context.api();
  const { document, snapshot } = requireCurrentAcceptedDocument(
    context,
    proposal
  );
  const title = snapshot.beforeTitle ?? document.title;
  const content = snapshot.beforeText!;
  if (
    proposal.libraryTarget?.operation === "edit-overview" &&
    document.catalogLibraryField === "overview" &&
    document.libraryId &&
    (document.domain === "material" || document.domain === "skill")
  ) {
    if (!api) throw new Error("桌面文件服务当前不可用。");
    const library = context.catalog.findCatalogLibrary(
      document.domain,
      document.libraryId
    );
    if (!library) throw new Error("目标资料库已不存在。");
    const updated = await api.catalog.updateLibrary({
      domain: document.domain,
      libraryId: document.libraryId,
      overview: content,
      ...(library.projectRevision === undefined
        ? {}
        : { baseProjectRevision: library.projectRevision })
    });
    await context.catalog.applyUpdatedLibrary(document.domain, updated);
    context.catalog.applyAcceptedDocumentLocally(
      { id: document.id, title: document.title, content: updated.overview },
      updated.projectRevision,
      undefined
    );
    return;
  }
  if (
    proposal.libraryTarget?.operation === "edit" &&
    document.catalogEntryId &&
    document.libraryId &&
    (document.domain === "material" || document.domain === "skill")
  ) {
    if (!api) throw new Error("桌面文件服务当前不可用。");
    const library = context.catalog.findCatalogLibrary(
      document.domain,
      document.libraryId
    );
    if (!library) throw new Error("目标资料库已不存在。");
    const saved = await api.catalog.saveLibraryEntry({
      domain: document.domain,
      libraryId: document.libraryId,
      entryId: document.catalogEntryId,
      title,
      content,
      baseRevision: createShortWorkspaceContentRevision(document.content),
      ...(library.projectRevision === undefined
        ? {}
        : { baseProjectRevision: library.projectRevision })
    });
    const projectRevision =
      library.projectRevision === undefined
        ? undefined
        : library.projectRevision + 1;
    const synchronizedRevision = await context.catalog.applySavedLibraryEntry(
      document.domain,
      document.libraryId,
      saved,
      projectRevision
    );
    context.catalog.applyAcceptedDocumentLocally(
      { id: document.id, title: saved.title, content: saved.body },
      synchronizedRevision,
      undefined
    );
    return;
  }
  if (document.workspaceId && document.catalogDocumentId) {
    if (!api) throw new Error("桌面文件服务当前不可用。");
    const book = context.catalog.catalogBook(document.workspaceId);
    if (!book) throw new Error("目标作品已不存在。");
    const expectedDocuments = captureWorkspaceDocumentBaselines(
      context.editor.documents.value,
      document.workspaceId
    );
    const saved = await api.catalog.saveDocument({
      bookId: document.workspaceId,
      documentId: document.catalogDocumentId,
      title,
      content,
      baseRevision: createShortWorkspaceContentRevision(document.content),
      ...(book.projectRevision === undefined
        ? {}
        : { baseProjectRevision: book.projectRevision })
    });
    context.catalog.applyAcceptedDocumentLocally(
      { id: document.id, title: saved.title, content: saved.content },
      saved.projectRevision,
      undefined
    );
    await context.catalog.refreshBookAfterSave(
      document.workspaceId,
      expectedDocuments,
      saved.projectRevision
    );
    return;
  }
  context.catalog.applyAcceptedDocumentLocally(
    { id: document.id, title, content },
    undefined,
    undefined
  );
}

async function discardDraftSectionRename(
  context: Context,
  proposal: AgentEditProposal
): Promise<void> {
  const target = proposal.draftSectionRenameTarget!;
  const api = context.api();
  const book = context.catalog.catalogBook(proposal.workspaceId);
  const document = context.editor.liveDocuments.value.find(
    (candidate) =>
      candidate.workspaceId === proposal.workspaceId &&
      candidate.expertSectionId === target.sectionId &&
      candidate.draftFileKind === "body" &&
      candidate.catalogDocumentId
  );
  if (!api || !book || !document?.catalogDocumentId) {
    throw new Error("目标章节已不可用，无法舍弃本次改名。");
  }
  if (document.title !== target.title) {
    throw new AcceptedEditDiscardConflictError(
      "章节名称已有后续修改，未舍弃本次改名。"
    );
  }
  const expectedDocuments = captureWorkspaceDocumentBaselines(
    context.editor.documents.value,
    proposal.workspaceId
  );
  const saved = await api.catalog.saveDocument({
    bookId: proposal.workspaceId,
    documentId: document.catalogDocumentId,
    title: target.previousTitle,
    content: document.content,
    baseRevision: createShortWorkspaceContentRevision(document.content),
    ...(book.projectRevision === undefined
      ? {}
      : { baseProjectRevision: book.projectRevision })
  });
  context.catalog.applyAcceptedDocumentLocally(
    { id: document.id, title: saved.title, content: saved.content },
    saved.projectRevision,
    undefined
  );
  await context.catalog.refreshBookAfterSave(
    proposal.workspaceId,
    expectedDocuments,
    saved.projectRevision
  );
  const drafts = context.editor.drafts.value;
  const bodyDraft = drafts[document.id];
  const stateDocument = context.editor.liveDocuments.value.find(
    (candidate) =>
      candidate.workspaceId === proposal.workspaceId &&
      candidate.expertSectionId === target.sectionId &&
      candidate.draftFileKind === "character-state"
  );
  context.editor.drafts.value = {
    ...drafts,
    ...(bodyDraft
      ? { [document.id]: { ...bodyDraft, title: target.previousTitle } }
      : {}),
    ...(stateDocument && drafts[stateDocument.id]
      ? {
          [stateDocument.id]: {
            ...drafts[stateDocument.id]!,
            title: draftCharacterStateTitle(target.previousTitle)
          }
        }
      : {})
  };
}

async function discardCharacterStructureEdit(
  context: Context,
  proposal: AgentEditProposal
): Promise<void> {
  const target = proposal.characterStructureTarget!;
  const api = context.api();
  const book = context.catalog.catalogBook(proposal.workspaceId);
  if (!api || !book || book.characterStructure.format !== "list") {
    throw new Error("人物结构已不可用，无法舍弃本次修改。");
  }
  const mutation = target.mutation;
  if (mutation.type === "updateItem") {
    const item = book.characterStructure.items.find(
      ({ id }) => id === mutation.itemId
    );
    const beforeTitle = proposal.discardSnapshot?.beforeTitle;
    if (
      !item ||
      item.title !== mutation.title ||
      beforeTitle === undefined ||
      book.projectRevision === undefined
    ) {
      throw new AcceptedEditDiscardConflictError(
        "人物名称已有后续修改，未舍弃本次修改。"
      );
    }
    await api.catalog.mutateCharacterStructure({
      bookId: proposal.workspaceId,
      baseProjectRevision: book.projectRevision,
      mutation: {
        type: "updateItem",
        itemId: mutation.itemId,
        title: beforeTitle
      }
    });
  } else if (mutation.type === "moveItem") {
    if (
      proposal.discardSnapshot?.appliedProjectRevision === undefined ||
      book.projectRevision !== proposal.discardSnapshot.appliedProjectRevision
    ) {
      throw new AcceptedEditDiscardConflictError(
        "人物顺序已有后续修改，未舍弃本次移动。"
      );
    }
    await api.catalog.mutateCharacterStructure({
      bookId: proposal.workspaceId,
      baseProjectRevision: book.projectRevision,
      mutation: {
        type: "moveItem",
        itemId: mutation.itemId,
        direction: mutation.direction === "up" ? "down" : "up"
      }
    });
  } else {
    throw new Error("这不是可舍弃的修改提案。");
  }
  await context.catalog.loadSnapshot();
}

async function discardPlotStructureEdit(
  context: Context,
  proposal: AgentEditProposal
): Promise<void> {
  const target = proposal.plotStructureTarget!;
  const mutation = target.mutation;
  const api = context.api();
  const book = context.catalog.catalogBook(proposal.workspaceId);
  const beforeTitle = proposal.discardSnapshot?.beforeTitle;
  const beforeDescription = proposal.discardSnapshot?.beforeDescription;
  if (
    mutation.type !== "update" ||
    !api ||
    !book ||
    book.projectRevision === undefined
  ) {
    throw new Error("剧情结构已不可用，无法舍弃本次修改。");
  }
  const current = book.plotStages.find(({ id }) => id === mutation.stageId);
  if (
    !current ||
    current.title !== mutation.title ||
    current.description !== mutation.description ||
    beforeTitle === undefined ||
    beforeDescription === undefined
  ) {
    throw new AcceptedEditDiscardConflictError(
      "剧情结构已有后续修改，未舍弃本次修改。"
    );
  }
  await api.catalog.mutatePlotStructure({
    bookId: proposal.workspaceId,
    baseProjectRevision: book.projectRevision,
    mutation: {
      type: "update",
      stageId: mutation.stageId,
      title: beforeTitle,
      description: beforeDescription
    }
  });
  await context.catalog.loadSnapshot();
}

export async function discardAcceptedShortStructureEdit(
  context: Context,
  proposal: AgentEditProposal
): Promise<boolean> {
  if (proposal.draftSectionRenameTarget) {
    await discardDraftSectionRename(context, proposal);
    return true;
  }
  if (proposal.characterStructureTarget) {
    await discardCharacterStructureEdit(context, proposal);
    return true;
  }
  if (proposal.plotStructureTarget) {
    await discardPlotStructureEdit(context, proposal);
    return true;
  }
  return false;
}
