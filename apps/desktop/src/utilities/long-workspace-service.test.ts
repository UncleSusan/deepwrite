import {
  mkdtemp,
  realpath,
  rm
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
  LongWorkspaceService
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
            format: "text" as const,
            contentAuthority: "markdown" as const,
            file: createEmptyLongMarkdownFileReference(
              longWorldbuildingFileId("world_weather"),
              longWorldbuildingContentPath("world_weather"),
              "2026-07-26T11:00:00.000Z"
            )
          }
        },
        {
          type: "worldbuilding.create" as const,
          category: {
            id: "world_biomes",
            title: "生态区",
            order: 9,
            format: "list" as const,
            contentAuthority: "files" as const,
            items: []
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
    if (weather.format !== "text") throw new Error("expected text category");
    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: weather.file.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      content: ""
    });
    const geography = reopened.book.workspaceIndex.worldbuilding.find(
      ({ id }) => id === "world_biomes"
    );
    if (
      !geography ||
      geography.format !== "list" ||
      !geography.overview
    ) {
      throw new Error("expected list category overview");
    }
    await expect(
      service.readDocument({
        bookId: created.book.id,
        fileId: geography.overview.id,
        offset: 0,
        maxCharacters: 100
      })
    ).resolves.toMatchObject({
      file: expect.objectContaining({ id: geography.overview.id }),
      content: ""
    });
  });
});
