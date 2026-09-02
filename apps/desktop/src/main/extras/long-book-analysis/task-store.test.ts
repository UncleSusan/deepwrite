import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS,
  LongBookAnalysisTaskSnapshotSchema,
  type LongBookAnalysisTaskSnapshot
} from "@deepwrite/contracts";
import { LongBookAnalysisTaskStore } from "./task-store";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "deepwrite-analysis-task-store-"));
  temporaryDirectories.push(path);
  return path;
}

function task(): LongBookAnalysisTaskSnapshot {
  const now = "2026-09-01T08:00:00.000Z";
  return LongBookAnalysisTaskSnapshotSchema.parse({
    version: 1,
    id: "long_book_analysis_task_1234",
    sourceId: "long_book_analysis_source_1234",
    sourceTitle: "测试长篇",
    scopeMode: "full",
    styleFullText: false,
    modelId: "model-1",
    thinkingLevel: "high",
    status: "running",
    activePresetId: "plot-structure",
    items: LONG_BOOK_ANALYSIS_COMPLETE_PRESET_IDS.map((presetId, index) => ({
      presetId,
      presetName: presetId,
      scopeMode: presetId === "style" ? "sampled" : "full",
      chapterOrders: [1, 2, 3],
      status: index === 0 ? "running" : "pending",
      completedUnits: 0,
      estimatedUnits: 2,
      targetLibraryId: ""
    })),
    createdAt: now,
    updatedAt: now
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("LongBookAnalysisTaskStore", () => {
  it("persists task snapshots and recovers interrupted running work", async () => {
    const store = new LongBookAnalysisTaskStore(await temporaryDirectory());
    await store.save(task());
    const [saved] = (await store.list()).tasks;
    expect(saved?.status).toBe("stopped");
    expect(saved?.items[0]?.status).toBe("stopped");
    expect(
      saved?.items.slice(1).every(({ status }) => status === "pending")
    ).toBe(true);
  });

  it("deletes only the requested task snapshot", async () => {
    const store = new LongBookAnalysisTaskStore(await temporaryDirectory());
    await store.save(task());
    await store.delete("long_book_analysis_task_1234");
    await expect(store.list()).resolves.toEqual({ tasks: [] });
    await expect(store.delete("../../outside")).rejects.toThrow();
  });
});
