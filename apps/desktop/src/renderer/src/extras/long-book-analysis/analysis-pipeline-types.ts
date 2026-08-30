import type { Ref } from "vue";
import type {
  LongBookAnalysisNote,
  LongBookAnalysisPreset,
  LongBookAnalysisResult,
  LongBookAnalysisSegment
} from "@deepwrite/contracts/renderer";
import type { LongBookAnalysisRunStatus } from "./useLongBookAnalysis";

export type LongBookAnalysisPhase = "batch" | "reduce" | "final";

export interface LongBookAnalysisPipelineState {
  status: Ref<LongBookAnalysisRunStatus>;
  phase: Ref<LongBookAnalysisPhase | null>;
  completedUnits: Ref<number>;
  estimatedUnits: Ref<number>;
  error: Ref<string | null>;
  result: Ref<LongBookAnalysisResult | null>;
}

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
  sourceTitle: string;
  preset: LongBookAnalysisPreset;
  modelId: string;
  selectionStart: number;
  selectionEnd: number;
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
