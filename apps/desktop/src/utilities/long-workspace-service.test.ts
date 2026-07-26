import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEmptyLongMarkdownFileReference,
  longWorldbuildingContentPath,
  longWorldbuildingFileId
} from "@deepwrite/contracts";
import {
  LongWorkspaceService,
  atomicWritePortableFile
} from "./long-workspace-service";

describe("LongWorkspaceService", () => {
  it("updates long bindings independently from the short/script Catalog", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-bindings-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "资源清单",
      genre: "科幻"
    });
    const updated = await service.updateBindings({
      bookId: created.book.id,
      expectedProjectRevision: created.summary.projectRevision,
      linkedMaterialIdsByKind: {
        plot: ["material-long-plot", "missing-material"]
      },
      linkedSkillIdsByKind: {
        style: ["skill-long-style"]
      }
    });

    expect(updated.summary.linkedMaterialIdsByKind.plot).toEqual([
      "material-long-plot",
      "missing-material"
    ]);
    expect(updated.summary.linkedSkillIdsByKind.style).toEqual([
      "skill-long-style"
    ]);
    expect((await service.list()).books[0]).toMatchObject({
      id: created.book.id,
      linkedMaterialIdsByKind: {
        plot: ["material-long-plot", "missing-material"]
      }
    });
  });

  it("creates, lists, opens, pages, searches and CAS-writes by book id", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-service-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "雨夜来信",
      genre: "悬疑"
    });
    expect((await service.list()).books[0]?.id).toBe(created.book.id);
    const opened = await service.open({ bookId: created.book.id });
    const chapter = opened.book.workspaceIndex.chapters[0]!;

    const initial = await service.readDocument({
      bookId: opened.book.id,
      fileId: chapter.body.id,
      offset: 0,
      maxCharacters: 32
    });
    const written = await service.writeDocument({
      bookId: opened.book.id,
      fileId: chapter.body.id,
      content: "她在雨夜收到一封无法烧毁的来信。",
      baseRevision: initial.file.revision,
      baseWorkspaceRevision: initial.workspaceRevision,
      baseProjectRevision: initial.projectRevision
    });
    expect(written.projectRevision).toBe(1);
    expect(
      (
        await service.search({
          bookId: opened.book.id,
          query: "来信",
          scope: "draft",
          limit: 20,
          maxSnippetCharacters: 100
        })
      ).hits[0]
    ).toMatchObject({
      fileId: chapter.body.id,
      root: "draft"
    });
  });

  it("keeps a successful store write successful when summary cache refresh fails", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-cache-failure-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "缓存降级",
      genre: "悬疑"
    });
    const chapter = created.book.workspaceIndex.chapters[0]!;
    const initial = await service.readDocument({
      bookId: created.book.id,
      fileId: chapter.body.id,
      offset: 0,
      maxCharacters: 100
    });
    service.catalog.updateSummary = async () => {
      throw new Error("simulated cache outage");
    };

    const written = await service.writeDocument({
      bookId: created.book.id,
      fileId: chapter.body.id,
      content: "权威工程写入成功，目录摘要暂时失败。",
      baseRevision: initial.file.revision,
      baseWorkspaceRevision: initial.workspaceRevision,
      baseProjectRevision: initial.projectRevision
    });

    expect(written.projectRevision).toBe(1);
    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: chapter.body.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      content: "权威工程写入成功，目录摘要暂时失败。"
    });
    expect(service.getDiagnostics()).toEqual([
      expect.objectContaining({
        code: "catalog-summary-cache-update-failed",
        bookId: created.book.id,
        operation: "write-document",
        message: "simulated cache outage"
      })
    ]);
  });

  it("recovers durable portable export replacement at journal and rename fault boundaries", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-recovery-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    await writeFile(destination, "旧版本", "utf8");

    await expect(
      atomicWritePortableFile(destination, "新版本", {
        injectFault(point) {
          if (point === "after-journal-sync") {
            throw new Error("fault after journal");
          }
        }
      })
    ).rejects.toThrow("fault after journal");
    expect(await readFile(destination, "utf8")).toBe("旧版本");

    await atomicWritePortableFile(destination, "新版本");
    expect(await readFile(destination, "utf8")).toBe("新版本");

    await expect(
      atomicWritePortableFile(destination, "更新版本", {
        injectFault(point) {
          if (point === "after-destination-rename") {
            throw new Error("fault after rename");
          }
        }
      })
    ).rejects.toThrow("fault after rename");
    expect(await readFile(destination, "utf8")).toBe("更新版本");

    await atomicWritePortableFile(destination, "更新版本");
    expect(await readFile(destination, "utf8")).toBe("更新版本");
    expect(
      (await readdir(root)).filter(
        (name) =>
          name.includes(".tmp") ||
          name.endsWith(".deepwrite-export-journal") ||
          name.includes(".deepwrite-export-lock.")
      )
    ).toEqual([]);
  });

  it("does not delete another writer's journal when exclusive journal creation loses the race", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-journal-race-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    const journal = `${destination}.deepwrite-export-journal`;
    await writeFile(destination, "旧版本", "utf8");

    await expect(
      atomicWritePortableFile(destination, "本次版本", {
        async injectFault(point) {
          if (point === "after-temp-sync") {
            await writeFile(journal, "另一进程的有效日志", {
              encoding: "utf8",
              flag: "wx"
            });
          }
        }
      })
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(journal, "utf8")).toBe("另一进程的有效日志");
    expect(await readFile(destination, "utf8")).toBe("旧版本");
  });

  it("uses destination content as a CAS guard before portable replacement", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-cas-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    await writeFile(destination, "最初版本", "utf8");

    await expect(
      atomicWritePortableFile(destination, "导出版本", {
        async injectFault(point) {
          if (point === "after-journal-sync") {
            await writeFile(destination, "外部进程的新版本", "utf8");
          }
        }
      })
    ).rejects.toThrow(/其他进程更新/u);

    expect(await readFile(destination, "utf8")).toBe("外部进程的新版本");
    expect(
      (await readdir(root)).filter(
        (name) =>
          name.includes(".tmp") ||
          name.endsWith(".deepwrite-export-journal")
      )
    ).toEqual([]);
  });

  it("serializes concurrent portable writers instead of recovering an active writer", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-lock-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    await writeFile(destination, "最初版本", "utf8");

    let signalFirstJournal!: () => void;
    const firstJournalReady = new Promise<void>((resolveReady) => {
      signalFirstJournal = resolveReady;
    });
    let releaseFirstWriter!: () => void;
    const firstWriterGate = new Promise<void>((resolveGate) => {
      releaseFirstWriter = resolveGate;
    });
    const first = atomicWritePortableFile(destination, "进程甲版本", {
      async injectFault(point) {
        if (point === "after-journal-sync") {
          signalFirstJournal();
          await firstWriterGate;
        }
      }
    });
    await firstJournalReady;

    let secondSettled = false;
    const second = atomicWritePortableFile(
      destination,
      "进程乙版本"
    ).finally(() => {
      secondSettled = true;
    });
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 80);
    });
    expect(secondSettled).toBe(false);
    expect(await readFile(destination, "utf8")).toBe("最初版本");

    releaseFirstWriter();
    await first;
    await second;
    expect(await readFile(destination, "utf8")).toBe("进程乙版本");
    expect(
      (await readdir(root)).filter(
        (name) =>
          name.includes(".tmp") ||
          name.endsWith(".deepwrite-export-journal") ||
          name.includes(".deepwrite-export-lock.")
      )
    ).toEqual([]);
  });

  it("does not unlink a replacement export lock with copied owner content", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-lock-aba-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    await writeFile(destination, "最初版本", "utf8");
    let replacement = "";
    let replacementPath = "";

    await expect(
      atomicWritePortableFile(destination, "本次版本", {
        async injectFault(point) {
          if (point !== "before-lock-release") return;
          const leaseName = (await readdir(root)).find((name) =>
            name.includes(".deepwrite-export-lock.")
          );
          if (!leaseName) throw new Error("测试未找到导出锁租约。");
          replacementPath = join(root, leaseName);
          replacement = await readFile(replacementPath, "utf8");
          await rm(replacementPath);
          await writeFile(replacementPath, replacement, {
            encoding: "utf8",
            flag: "wx"
          });
        }
      })
    ).rejects.toThrow(/锁所有者发生变化/u);

    expect(await readFile(destination, "utf8")).toBe("本次版本");
    expect(await readFile(replacementPath, "utf8")).toBe(replacement);
    await rm(replacementPath);
  });

  it("cleans an invalid exact lease without touching similar unrelated files", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-lock-pid-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    const forgedLease =
      `${destination}.deepwrite-export-lock.` +
      `${process.pid}.0123456789abcdef`;
    const unrelated = `${destination}.deepwrite-export-lock.notes`;
    await writeFile(destination, "最初版本", "utf8");
    await writeFile(
      forgedLease,
      `${JSON.stringify({
        pid: Number.MAX_SAFE_INTEGER,
        nonce: "0123456789abcdef",
        acquiredAt: new Date().toISOString()
      })}\n`,
      "utf8"
    );
    await writeFile(unrelated, "这不是 DeepWrite 导出租约", "utf8");

    await atomicWritePortableFile(destination, "安全版本");
    expect(await readFile(destination, "utf8")).toBe("安全版本");
    expect(await readdir(root)).not.toContain(
      forgedLease.slice(root.length + 1)
    );
    expect(await readFile(unrelated, "utf8")).toBe(
      "这不是 DeepWrite 导出租约"
    );
  });

  it("reclaims a stale lease even when its pid has been reused by a live process", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-lock-stale-pid-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    const nonce = "fedcba9876543210";
    const staleLease =
      `${destination}.deepwrite-export-lock.${process.pid}.${nonce}`;
    await writeFile(destination, "最初版本", "utf8");
    await writeFile(
      staleLease,
      `${JSON.stringify({
        pid: process.pid,
        nonce,
        acquiredAt: new Date(Date.now() - 120_000).toISOString()
      })}\n`,
      "utf8"
    );
    const staleTime = new Date(Date.now() - 120_000);
    await utimes(staleLease, staleTime, staleTime);

    await atomicWritePortableFile(destination, "复用 PID 后的新版本");

    expect(await readFile(destination, "utf8")).toBe(
      "复用 PID 后的新版本"
    );
    expect(await readdir(root)).not.toContain(
      staleLease.slice(root.length + 1)
    );
  });

  it("preserves the primary export error when lease release also fails", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-export-lock-errors-"))
    );
    const destination = join(root, "book.deepwrite-long.json");
    await writeFile(destination, "最初版本", "utf8");
    let replacementPath = "";
    let failure: unknown;
    try {
      await atomicWritePortableFile(destination, "待恢复版本", {
        async injectFault(point) {
          if (point !== "after-journal-sync") return;
          const leaseName = (await readdir(root)).find((name) =>
            name.includes(".deepwrite-export-lock.")
          );
          if (!leaseName) throw new Error("测试未找到导出锁租约。");
          replacementPath = join(root, leaseName);
          const copiedOwner = await readFile(replacementPath, "utf8");
          await rm(replacementPath);
          await writeFile(replacementPath, copiedOwner, {
            encoding: "utf8",
            flag: "wx"
          });
          throw new Error("primary export failure");
        }
      });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect(
      (failure as AggregateError).errors.map((error) =>
        error instanceof Error ? error.message : String(error)
      )
    ).toEqual(
      expect.arrayContaining([
        "primary export failure",
        expect.stringMatching(/锁所有者发生变化/u)
      ])
    );
    await rm(replacementPath);
    await atomicWritePortableFile(destination, "恢复后版本");
    expect(await readFile(destination, "utf8")).toBe("恢复后版本");
  });

  it("previews and atomically applies a structure change", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-preview-"))
    );
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => "2026-07-26T10:00:00.000Z"
    });
    const created = await service.create(root, {
      title: "结构测试",
      genre: "其他"
    });
    const batch = {
      baseRevision: created.book.workspaceIndex.revision,
      updatedAt: "2026-07-26T11:00:00.000Z",
      operations: [
        {
          type: "volume.update" as const,
          id: created.book.workspaceIndex.plot.volumes[0]!.id,
          patch: { title: "新卷名" }
        },
        {
          type: "worldbuilding.create" as const,
          category: {
            id: "world_weather",
            title: "气候",
            order: 8,
            format: "list" as const,
            contentAuthority: "markdown" as const,
            file: createEmptyLongMarkdownFileReference(
              longWorldbuildingFileId("world_weather"),
              longWorldbuildingContentPath("world_weather"),
              "2026-07-26T11:00:00.000Z"
            )
          }
        }
      ],
      documentWrites: []
    };
    const preview = await service.previewOperations({
      bookId: created.book.id,
      batch
    });
    expect(preview.preview.impact.updatedEntityIds).toHaveLength(1);
    const applied = await service.applyOperations({
      bookId: created.book.id,
      batch,
      baseProjectRevision: 0
    });
    expect(applied.projectRevision).toBe(1);
    const reopened = await service.open({ bookId: created.book.id });
    expect(reopened.book.workspaceIndex.plot.volumes[0]?.title).toBe(
      "新卷名"
    );
    const weather = reopened.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === "world_weather"
    )!;
    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: weather.file.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining("deepwrite-worldbuilding-list:v1")
    });
  });
});
