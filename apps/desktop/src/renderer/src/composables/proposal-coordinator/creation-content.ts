import type { DeepWriteApi } from "@deepwrite/contracts";
import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";

type CatalogDocumentWriter = Pick<DeepWriteApi["catalog"], "saveDocument">;

interface RequestedDraftSectionContent {
  provisionalSectionId: string;
  bodyContent?: string;
  characterStateContent?: string;
}

interface CreatedDraftSectionContentTarget {
  clientSectionId: string;
  section: {
    body: { id: string; content: string };
    characterState: { id: string; content: string };
  };
}

export async function saveCreatedCharacterContent(
  catalog: CatalogDocumentWriter,
  input: {
    bookId: string;
    itemId: string;
    content: string;
    projectRevision?: number;
  }
): Promise<void> {
  if (!input.content.trim()) return;
  await catalog.saveDocument({
    bookId: input.bookId,
    documentId: input.itemId,
    content: input.content,
    baseRevision: createShortWorkspaceContentRevision(""),
    ...(input.projectRevision === undefined
      ? {}
      : { baseProjectRevision: input.projectRevision })
  });
}

async function saveCreatedDraftDocument(
  catalog: CatalogDocumentWriter,
  input: {
    bookId: string;
    documentId: string;
    currentContent: string;
    content: string | undefined;
    projectRevision: number;
    label: string;
  }
): Promise<number> {
  if (!input.content?.trim() || input.currentContent === input.content) {
    return input.projectRevision;
  }
  if (input.currentContent.trim()) {
    throw new Error(`新建章节${input.label}已有不同内容，未覆盖现有文件。`);
  }
  const saved = await catalog.saveDocument({
    bookId: input.bookId,
    documentId: input.documentId,
    content: input.content,
    baseRevision: createShortWorkspaceContentRevision(""),
    baseProjectRevision: input.projectRevision
  });
  return saved.projectRevision;
}

export async function saveCreatedDraftSectionContents(
  catalog: CatalogDocumentWriter,
  input: {
    bookId: string;
    requested: readonly RequestedDraftSectionContent[];
    created: readonly CreatedDraftSectionContentTarget[];
    projectRevision: number;
  }
): Promise<number> {
  let projectRevision = input.projectRevision;
  for (const result of input.created) {
    const requested = input.requested.find(
      (section) => section.provisionalSectionId === result.clientSectionId
    );
    projectRevision = await saveCreatedDraftDocument(catalog, {
      bookId: input.bookId,
      documentId: result.section.body.id,
      currentContent: result.section.body.content,
      content: requested?.bodyContent,
      projectRevision,
      label: "正文"
    });
    projectRevision = await saveCreatedDraftDocument(catalog, {
      bookId: input.bookId,
      documentId: result.section.characterState.id,
      currentContent: result.section.characterState.content,
      content: requested?.characterStateContent,
      projectRevision,
      label: "人物状态"
    });
  }
  return projectRevision;
}
