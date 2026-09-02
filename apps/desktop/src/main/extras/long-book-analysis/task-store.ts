import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import {
  LongBookAnalysisTaskCatalogSchema,
  LongBookAnalysisTaskIdSchema,
  LongBookAnalysisTaskSnapshotSchema,
  type LongBookAnalysisTaskCatalog,
  type LongBookAnalysisTaskSnapshot
} from "@deepwrite/contracts";

export const LONG_BOOK_ANALYSIS_TASK_DIRECTORY = "long-book-analysis-tasks";
const MAX_TASK_BYTES = 256 * 1024 * 1024;

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function recoverInterruptedTask(
  task: LongBookAnalysisTaskSnapshot
): LongBookAnalysisTaskSnapshot {
  if (task.status !== "running" && task.status !== "stopping") return task;
  return {
    ...task,
    status: "stopped",
    ...(task.activePresetId ? { activePresetId: task.activePresetId } : {}),
    items: task.items.map((item) =>
      item.status === "running" ? { ...item, status: "stopped" } : item
    )
  };
}

export class LongBookAnalysisTaskStore {
  private readonly directory: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(workspaceDirectory: string) {
    this.directory = join(
      workspaceDirectory,
      LONG_BOOK_ANALYSIS_TASK_DIRECTORY
    );
  }

  async list(): Promise<LongBookAnalysisTaskCatalog> {
    await this.writeChain;
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) return { tasks: [] };
      throw error;
    }
    const tasks: LongBookAnalysisTaskSnapshot[] = [];
    for (const entry of entries) {
      if (
        tasks.length >= 20 ||
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !entry.name.endsWith(".json")
      ) {
        continue;
      }
      try {
        const path = join(this.directory, entry.name);
        const stats = await lstat(path);
        if (
          !stats.isFile() ||
          stats.isSymbolicLink() ||
          stats.size > MAX_TASK_BYTES
        ) {
          continue;
        }
        const parsed = LongBookAnalysisTaskSnapshotSchema.parse(
          JSON.parse(await readFile(path, "utf8"))
        );
        if (`${parsed.id}.json` === entry.name) {
          tasks.push(recoverInterruptedTask(parsed));
        }
      } catch {
        // A damaged task must not hide other resumable work.
      }
    }
    tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return LongBookAnalysisTaskCatalogSchema.parse({ tasks });
  }

  async save(
    rawTask: LongBookAnalysisTaskSnapshot
  ): Promise<LongBookAnalysisTaskSnapshot> {
    const task = LongBookAnalysisTaskSnapshotSchema.parse(rawTask);
    await this.enqueue(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const target = join(this.directory, `${task.id}.json`);
      const temporary = join(
        this.directory,
        `.tmp-${task.id}-${process.pid}-${Date.now()}`
      );
      await writeFile(temporary, `${JSON.stringify(task)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporary, target);
    });
    return task;
  }

  async delete(rawTaskId: string): Promise<void> {
    const taskId = LongBookAnalysisTaskIdSchema.parse(rawTaskId);
    await this.enqueue(() =>
      rm(join(this.directory, `${taskId}.json`), { force: true })
    );
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.writeChain.then(operation);
    this.writeChain = pending.catch(() => undefined);
    await pending;
  }
}
