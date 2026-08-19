export const SHORT_DOCUMENT_PAGE_DEFAULT_CHARACTERS = 32_768;
export const SHORT_DOCUMENT_PAGE_MAX_CHARACTERS = 256 * 1024;

export interface ShortDocumentPage {
  content: string;
  offset: number;
  returnedCharacters: number;
  totalCharacters: number;
  nextOffset: number | null;
}

export interface ShortDocumentReadCoverage {
  contiguousEnd: number;
  totalCharacters: number;
}

export function readShortDocumentPage(
  content: string,
  requestedOffset: number,
  requestedMaximum: number
): ShortDocumentPage {
  const offset = Math.max(0, Math.trunc(requestedOffset));
  const maximum = Math.min(
    SHORT_DOCUMENT_PAGE_MAX_CHARACTERS,
    Math.max(1, Math.trunc(requestedMaximum))
  );
  const page: string[] = [];
  let totalCharacters = 0;
  let returnedCharacters = 0;
  for (const character of content) {
    if (totalCharacters >= offset && returnedCharacters < maximum) {
      page.push(character);
      returnedCharacters += 1;
    }
    totalCharacters += 1;
  }
  const boundedOffset = Math.min(offset, totalCharacters);
  const endOffset = boundedOffset + returnedCharacters;
  return {
    content: page.join(""),
    offset: boundedOffset,
    returnedCharacters,
    totalCharacters,
    nextOffset: endOffset < totalCharacters ? endOffset : null
  };
}

export function recordShortDocumentPage(
  coverage: Map<string, ShortDocumentReadCoverage>,
  documentId: string,
  page: ShortDocumentPage
): boolean {
  const previous = coverage.get(documentId);
  const contiguousEnd =
    page.offset <= (previous?.contiguousEnd ?? 0)
      ? Math.max(
          previous?.contiguousEnd ?? 0,
          page.offset + page.returnedCharacters
        )
      : (previous?.contiguousEnd ?? 0);
  coverage.set(documentId, {
    contiguousEnd,
    totalCharacters: page.totalCharacters
  });
  return contiguousEnd >= page.totalCharacters;
}

export function renderShortDocumentPageMetadata(
  page: ShortDocumentPage
): string {
  return [
    `offset: ${page.offset}`,
    `本页字符数: ${page.returnedCharacters}`,
    `总字符数: ${page.totalCharacters}`,
    `next_offset: ${page.nextOffset ?? "null"}`
  ].join("\n");
}
