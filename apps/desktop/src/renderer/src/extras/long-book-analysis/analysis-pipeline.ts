import type { ShallowRef } from "vue";
import {
  LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS,
  type DeepWriteApi,
  type LongBookAnalysisNote,
  type LongBookAnalysisPreset,
  type LongBookAnalysisResult,
  type LongBookAnalysisRuntimeContext,
  type LongBookAnalysisSource,
  type ModelConfig,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";
import {
  buildAnalysisSegments,
  estimateAnalysisTokens,
  groupAnalysisNotes,
  groupAnalysisSegments,
  resolveAnalysisInputBudget,
  splitAnalysisNotesForBudget
} from "./batching";
import type { LongBookAnalysisStartInput } from "./useLongBookAnalysis";
import type {
  LongBookAnalysisJob as AnalysisJob,
  LongBookAnalysisPendingUnit as PendingUnit,
  LongBookAnalysisPipelineState
} from "./analysis-pipeline-types";
export type { LongBookAnalysisPhase } from "./analysis-pipeline-types";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function belongs(event: SystemEventEnvelope, pending: PendingUnit): boolean {
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

export class LongBookAnalysisPipeline {
  private job: AnalysisJob | null = null;
  private pending: PendingUnit | null = null;
  private stopRequested = false;
  private disposed = false;

  constructor(
    private readonly getApi: () => DeepWriteApi,
    private readonly models: ShallowRef<readonly ModelConfig[]>,
    private readonly state: LongBookAnalysisPipelineState
  ) {}

  get hasJob(): boolean {
    return this.job !== null;
  }

  get preset(): LongBookAnalysisPreset | null {
    return this.job?.preset ?? null;
  }

  reset(): void {
    if (["running", "stopping"].includes(this.state.status.value)) {
      throw new Error("分析运行中，不能修改来源或预设。");
    }
    this.job = null;
    this.state.result.value = null;
    this.state.phase.value = null;
    this.state.completedUnits.value = 0;
    this.state.estimatedUnits.value = 0;
    this.state.status.value = "idle";
    this.state.error.value = null;
  }

  start(
    source: LongBookAnalysisSource,
    preset: LongBookAnalysisPreset,
    input: LongBookAnalysisStartInput
  ): void {
    const modelId = input.modelId ?? "";
    const model = this.models.value.find((item) => item.id === modelId);
    if (!modelId || !model) throw new Error("请选择可用模型。");
    if (input.endOrder < input.startOrder) {
      throw new Error("结束章节不能早于起始章节。");
    }
    if (
      input.endOrder - input.startOrder + 1 >
      LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS
    ) {
      throw new Error("单次最多分析连续 50 章。");
    }
    const chapters = source.chapters.filter(
      (chapter) =>
        chapter.order >= input.startOrder && chapter.order <= input.endOrder
    );
    if (chapters.length !== input.endOrder - input.startOrder + 1) {
      throw new Error("选择范围与当前章节列表不一致，请重新选择。");
    }
    const inputBudget = resolveAnalysisInputBudget(model, preset.systemPrompt);
    const batches = groupAnalysisSegments(
      buildAnalysisSegments(chapters, inputBudget),
      inputBudget
    );
    this.job = {
      id: createId("long_book_analysis_job"),
      sourceTitle: source.name,
      preset,
      modelId,
      selectionStart: input.startOrder,
      selectionEnd: input.endOrder,
      inputBudget,
      batches,
      batchIndex: 0,
      notes: [],
      reductionRounds: 0
    };
    this.state.result.value = null;
    this.state.phase.value = "batch";
    this.state.completedUnits.value = 0;
    this.state.estimatedUnits.value = batches.length + 1;
    void this.run();
  }

  retry(): boolean {
    if (!this.job || !["error", "stopped"].includes(this.state.status.value)) {
      return false;
    }
    void this.run();
    return true;
  }

  async stop(): Promise<boolean> {
    if (!["running", "stopping"].includes(this.state.status.value)) {
      return false;
    }
    this.stopRequested = true;
    this.state.status.value = "stopping";
    if (this.pending?.runId) {
      await this.getApi().session.abort({
        sessionId: this.pending.sessionId,
        runId: this.pending.runId
      });
    } else if (!this.pending) {
      this.state.status.value = "stopped";
    }
    return true;
  }

  handleEvent(event: SystemEventEnvelope): void {
    const pending = this.pending;
    if (!pending || !belongs(event, pending)) return;
    if (
      event.type === "long_book_analysis.note_updated" &&
      event.payload.unitId === pending.unitId
    ) {
      pending.note = event.payload.note.text;
      return;
    }
    if (
      event.type === "long_book_analysis.result_updated" &&
      event.payload.unitId === pending.unitId
    ) {
      pending.result = event.payload.result;
      return;
    }
    if (event.type === "agent.error") {
      this.pending = null;
      pending.reject(new Error(event.payload.message));
      return;
    }
    if (event.type !== "agent.message_completed") return;
    this.pending = null;
    if (pending.phase === "final" && pending.result) {
      pending.resolve(pending.result);
    } else if (pending.phase !== "final" && pending.note) {
      pending.resolve(pending.note);
    } else {
      pending.reject(
        new Error(
          pending.phase === "final"
            ? "模型未调用 write_analysis_result，请重试当前阶段。"
            : "模型未调用 write_analysis_note，请重试当前阶段。"
        )
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopRequested = true;
    this.pending = null;
  }

  private base(unitId: string) {
    if (!this.job) throw new Error("拆书任务尚未准备。");
    return {
      jobId: this.job.id,
      unitId,
      presetId: this.job.preset.id,
      sourceTitle: this.job.sourceTitle,
      selectionStart: this.job.selectionStart,
      selectionEnd: this.job.selectionEnd
    };
  }

  private runUnit(
    context: LongBookAnalysisRuntimeContext
  ): Promise<string | LongBookAnalysisResult> {
    const currentApi = this.getApi();
    const sessionId = createId("long_book_analysis_session");
    return new Promise((resolve, reject) => {
      const unit: PendingUnit = {
        sessionId,
        unitId: context.unitId,
        phase: context.phase,
        resolve,
        reject
      };
      this.pending = unit;
      void currentApi.session
        .prompt({
          sessionId,
          message:
            context.phase === "batch"
              ? "分析当前章节批次并写入结构化中间笔记。"
              : context.phase === "reduce"
                ? "归并当前全部中间笔记并写入压缩后的结构化笔记。"
                : "根据全部归并笔记生成正式 Markdown 拆书结果。",
          modelId: this.job?.modelId,
          writeApprovalMode: "request-approval",
          workspaceContext: { longBookAnalysis: context }
        })
        .then(async (accepted) => {
          if (this.pending !== unit) return;
          unit.runId = accepted.runId;
          if (this.stopRequested) {
            await currentApi.session.abort({
              sessionId,
              runId: accepted.runId
            });
          }
        })
        .catch((cause: unknown) => {
          if (this.pending === unit) this.pending = null;
          reject(new Error(messageOf(cause, "启动拆书分析阶段失败。")));
        });
    });
  }

  private note(
    text: string,
    label: string,
    start: number,
    end: number
  ): LongBookAnalysisNote {
    return {
      id: createId("analysis_note"),
      label,
      chapterStart: start,
      chapterEnd: end,
      text
    };
  }

  private async run(): Promise<void> {
    const job = this.job;
    if (!job || this.disposed) return;
    this.state.status.value = "running";
    this.state.error.value = null;
    this.stopRequested = false;
    try {
      this.state.phase.value = "batch";
      while (job.batchIndex < job.batches.length) {
        const batch = job.batches[job.batchIndex]!;
        const text = await this.runUnit({
          ...this.base(createId("analysis_batch")),
          phase: "batch",
          segments: batch
        });
        if (typeof text !== "string") {
          throw new Error("分批阶段未返回中间笔记。");
        }
        const start = Math.min(...batch.map((item) => item.chapterOrder));
        const end = Math.max(...batch.map((item) => item.chapterOrder));
        job.notes.push(
          this.note(text, `第 ${start}-${end} 章批次笔记`, start, end)
        );
        job.batchIndex += 1;
        this.state.completedUnits.value += 1;
      }
      await this.reduce(job);
      this.state.phase.value = "final";
      this.state.estimatedUnits.value = Math.max(
        this.state.estimatedUnits.value,
        this.state.completedUnits.value + 1
      );
      const finalResult = await this.runUnit({
        ...this.base(createId("analysis_final")),
        phase: "final",
        notes: job.notes
      });
      if (typeof finalResult === "string") {
        throw new Error("最终阶段未返回拆书结果。");
      }
      this.state.result.value = finalResult;
      this.state.completedUnits.value += 1;
      this.state.status.value = "completed";
    } catch (cause: unknown) {
      if (this.stopRequested) this.state.status.value = "stopped";
      else {
        this.state.status.value = "error";
        this.state.error.value = messageOf(cause, "长篇拆书分析失败。");
      }
    } finally {
      this.pending = null;
    }
  }

  private async reduce(job: AnalysisJob): Promise<void> {
    this.state.phase.value = "reduce";
    while (
      job.notes.length > 1 ||
      job.notes.some(
        (note) => estimateAnalysisTokens(note.text) > job.inputBudget * 0.9
      )
    ) {
      if (!job.reduction) {
        const inputs = splitAnalysisNotesForBudget(job.notes, job.inputBudget);
        const groups = groupAnalysisNotes(inputs, job.inputBudget);
        if (groups.every((group) => group.length === 1)) {
          throw new Error(
            "当前模型输入预算不足以归并单条中间笔记，请更换更大上下文模型。"
          );
        }
        job.reductionRounds += 1;
        if (job.reductionRounds > 8) {
          throw new Error(
            "中间笔记连续归并后仍超过预算，请更换更大上下文模型后重试。"
          );
        }
        job.reduction = { groups, groupIndex: 0, output: [] };
        this.state.estimatedUnits.value += groups.filter(
          (group) => group.length > 1
        ).length;
      }
      const reduction = job.reduction;
      while (reduction.groupIndex < reduction.groups.length) {
        const group = reduction.groups[reduction.groupIndex]!;
        if (group.length === 1) reduction.output.push(group[0]!);
        else {
          const merged = await this.runUnit({
            ...this.base(createId("analysis_reduce")),
            phase: "reduce",
            notes: group
          });
          if (typeof merged !== "string") {
            throw new Error("归并阶段未返回中间笔记。");
          }
          const start = Math.min(...group.map((note) => note.chapterStart));
          const end = Math.max(...group.map((note) => note.chapterEnd));
          reduction.output.push(
            this.note(merged, `第 ${start}-${end} 章归并笔记`, start, end)
          );
          this.state.completedUnits.value += 1;
        }
        reduction.groupIndex += 1;
      }
      job.notes = reduction.output;
      delete job.reduction;
    }
  }
}
