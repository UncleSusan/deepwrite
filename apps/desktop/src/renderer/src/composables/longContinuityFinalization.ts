import {
  LongCommitChapterInputSchema,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";

export type LongContinuityFinalizationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.ledger_commit_proposal" }
>;

function ipcSafeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function continuityFinalizationKey(
  event: LongContinuityFinalizationEvent
): string {
  return `${event.payload.bookId}\u0000${event.payload.input.chapterCardId}`;
}

export async function commitLongContinuityFinalization(
  api: LongWorkspaceRendererApi,
  event: LongContinuityFinalizationEvent
): Promise<void> {
  const parsedInput = LongCommitChapterInputSchema.parse(event.payload.input);
  await api.commitChapter(ipcSafeJson(parsedInput));
}
