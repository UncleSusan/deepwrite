import type { Ref } from "vue";
import type {
  LongBookAnalysisNote,
  LongBookAnalysisPipelineCheckpoint,
  LongBookAnalysisPreset,
  LongBookAnalysisResult,
  LongBookAnalysisSegment,
  ThinkingLevel
} from "@deepwrite/contracts/renderer";
import type {
  LongBookAnalysisProcessEntry,
  LongBookAnalysisProcessState
} from "./analysis-process";

export type LongBookAnalysisPhase = "batch" | "reduce" | "final";
export type LongBookAnalysisRunStatus =
  "idle" | "running" | "stopping" | "stopped" | "error" | "completed";

export interface LongBookAnalysisPipelineState extends LongBookAnalysisProcessState {
  status: Ref<LongBookAnalysisRunStatus>;
  phase: Ref<LongBookAnalysisPhase | null>;
  completedUnits: Ref<number>;
  estimatedUnits: Ref<number>;
  error: Ref<string | null>;
  result: Ref<LongBookAnalysisResult | null>;
}

export type { LongBookAnalysisProcessEntry };

export interface LongBookAnalysisPendingUnit {
  sessionId: string;
  unitId: string;
  phase: LongBookAnalysisPhase;
  runId?: string;
  note?: string;
  result?: LongBookAnalysisResult;
  resolve(value: string | LongBookAnalysisResult): void;
  reject(error: Error): void;
}

export interface LongBookAnalysisJob {
  id: string;
  sourceId: string;
  sourceTitle: string;
  preset: LongBookAnalysisPreset;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  temperature?: number;
  libraryId: string;
  selectionStart: number;
  selectionEnd: number;
  selectedChapterOrders: number[];
  inputBudget: number;
  batches: LongBookAnalysisSegment[][];
  batchIndex: number;
  notes: LongBookAnalysisNote[];
  reductionRounds: number;
  reduction?: {
    groups: LongBookAnalysisNote[][];
    groupIndex: number;
    output: LongBookAnalysisNote[];
  };
}

export interface LongBookAnalysisPipelineOptions {
  onCheckpoint?(
    checkpoint: LongBookAnalysisPipelineCheckpoint
  ): Promise<void> | void;
}
