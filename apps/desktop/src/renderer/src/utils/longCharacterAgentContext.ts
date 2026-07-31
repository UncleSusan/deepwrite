import {
  LONG_CHARACTER_CORE_FOCUS_MAX_CHARACTERS,
  LONG_CHARACTER_FOCUS_MAX_CHARACTERS,
  type LongBookId,
  type LongCharacterFocusSnapshot,
  type LongFileId,
  type LongReadDocumentInput,
  type LongReadDocumentResult
} from "@deepwrite/contracts";
import type {
  LongWorkspaceFileRole,
  LongWorkspaceSelection
} from "../types/longWorkspace";

type ReadLongDocument = (
  input: LongReadDocumentInput
) => Promise<LongReadDocumentResult>;

const CHARACTER_DOCUMENTS: Partial<
  Record<
    LongWorkspaceFileRole,
    {
      kind: LongCharacterFocusSnapshot["currentDocument"]["kind"];
      title: string;
    }
  >
> = {
  "core-profile": { kind: "core_profile", title: "核心档案" },
  relationships: { kind: "relationships", title: "人物关系" },
  "current-state": { kind: "current_state", title: "当前状态" },
  history: { kind: "history", title: "历史轨迹" }
};

function snapshotText(
  page: LongReadDocumentResult,
  maximum: number
): LongCharacterFocusSnapshot["currentDocument"]["text"] {
  const characters = Array.from(page.content).slice(0, maximum);
  const content = characters.join("");
  return page.totalCharacters > characters.length
    ? { content, truncated: true, originalLength: page.totalCharacters }
    : { content };
}

async function readFocusText(
  readDocument: ReadLongDocument,
  bookId: LongBookId,
  fileId: LongFileId,
  maximum: number
): Promise<LongCharacterFocusSnapshot["currentDocument"]["text"]> {
  const page = await readDocument({
    bookId,
    fileId,
    offset: 0,
    maxCharacters: maximum
  });
  if (
    page.bookId !== bookId ||
    page.file.id !== fileId ||
    page.offset !== 0
  ) {
    throw new Error("长篇人物阶段读取结果与当前选择不一致。");
  }
  return snapshotText(page, maximum);
}

export async function buildLongCharacterFocusSnapshot(input: {
  bookId: LongBookId;
  selection: LongWorkspaceSelection | null;
  activeFileId: LongFileId | null;
  readDocument: ReadLongDocument;
}): Promise<LongCharacterFocusSnapshot | undefined> {
  const { bookId, selection, activeFileId, readDocument } = input;
  if (
    selection?.root !== "character_design" ||
    !selection.characterId ||
    !selection.characterGroup ||
    !activeFileId
  ) {
    return undefined;
  }
  const active = selection.files.find(({ file }) => file.id === activeFileId);
  if (!active) return undefined;
  const document = CHARACTER_DOCUMENTS[active.role];
  if (!document) return undefined;

  const coreProfile = selection.files.find(
    ({ role }) => role === "core-profile"
  );
  const isCoreProfile = document.kind === "core_profile";
  if (!isCoreProfile && !coreProfile) return undefined;
  const currentMaximum = isCoreProfile
    ? LONG_CHARACTER_FOCUS_MAX_CHARACTERS
    : LONG_CHARACTER_FOCUS_MAX_CHARACTERS -
      LONG_CHARACTER_CORE_FOCUS_MAX_CHARACTERS;
  const [currentText, coreText] = await Promise.all([
    readFocusText(readDocument, bookId, activeFileId, currentMaximum),
    !isCoreProfile && coreProfile
      ? readFocusText(
          readDocument,
          bookId,
          coreProfile.file.id,
          LONG_CHARACTER_CORE_FOCUS_MAX_CHARACTERS
        )
      : Promise.resolve(undefined)
  ]);
  return {
    characterName: selection.title,
    group: selection.characterGroup,
    currentDocument: {
      kind: document.kind,
      title: document.title,
      text: currentText
    },
    ...(coreText ? { coreProfile: coreText } : {})
  };
}
