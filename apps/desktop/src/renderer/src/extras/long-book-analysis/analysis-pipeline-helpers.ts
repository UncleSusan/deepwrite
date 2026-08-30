import type {
  LongBookAnalysisNote,
  SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import type { LongBookAnalysisPendingUnit } from "./analysis-pipeline-types";

export function analysisErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

export function analysisEventBelongsToUnit(
  event: SystemEventEnvelope,
  pending: LongBookAnalysisPendingUnit
): boolean {
  if (
    !("sessionId" in event.payload) ||
    event.payload.sessionId !== pending.sessionId
  ) {
    return false;
  }
  return (
    !pending.runId ||
    !("runId" in event.payload) ||
    event.payload.runId === pending.runId
  );
}

export function createAnalysisNote(
  text: string,
  label: string,
  chapterStart: number,
  chapterEnd: number
): LongBookAnalysisNote {
  return {
    id: createId("analysis_note"),
    label,
    chapterStart,
    chapterEnd,
    text
  };
}
