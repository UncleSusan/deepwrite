import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LongLedgerCommitRecordSchema
} from "@deepwrite/contracts";
import {
  parseLongPortableExportBundle
} from "./long-portable-bundle";
import {
  LongProjectStore
} from "./long-project-store";
import {
  LongWorkspaceService
} from "./long-workspace-service";
import {
  readWriteClawLongImportPlan
} from "./write-claw-long-import";

const FIXED_NOW = "2026-07-26T12:00:00.000Z";
const temporaryRoots: string[] = [];

function legacyBook() {
  return {
    id: "legacy-import-book",
    title: "迁移长篇",
    book_type: "long",
    categories: ["悬疑"],
    linked_material_ids_by_kind: {
      plot: ["material-long-legacy"]
    },
    linked_skill_ids_by_kind: {
      style: ["skill-long-legacy"]
    },
    memories: [
      {
        id: "memory-shadow",
        tag: "规则",
        content: "影子只在午夜后说真话。",
        created_at: "2025-01-02T00:00:00Z",
        updated_at: "2025-01-03T00:00:00Z"
      }
    ],
    memory_auto_capture_enabled: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-06-01T00:00:00Z",
    long_workspace: {
      schema_version: 5,
      revision: 9,
      worldbuilding: {
        categories: [
          {
            id: "rules",
            name: "规则",
            format: "text",
            overview: "",
            items: [],
            text: "午夜之后，所有影子都会说真话。"
          }
        ]
      },
      characters: {
        protagonists: {
          entries: [
            {
              id: "hero",
              name: "林岚",
              core_profile: "调查记者",
              relationships: "",
              current_state: "正在追查旧案",
              history: ""
            }
          ]
        },
        major_supporting: { entries: [] },
        minor_supporting: { entries: [] },
        passersby: { entries: [] }
      },
      plot: {
        book_line: "林岚追查会说话的影子。",
        volumes: [
          { id: "volume-1", name: "影城", outline: "", order: 1 }
        ],
        arcs: [
          {
            id: "arc-1",
            volume_id: "volume-1",
            name: "旧案",
            outline: "",
            order: 1
          }
        ],
        chapter_cards: [
          {
            id: "chapter-1",
            volume_id: "volume-1",
            arc_id: "arc-1",
            stage_id: "draft.volume-1.arc-1.chapter-1",
            title: "午夜来电",
            outline: "",
            world_constraints: "",
            characters: ["hero"],
            narrative_order: 1
          }
        ],
        story_events: [],
        event_links: [],
        narrative_placements: [],
        foreshadowing: []
      },
      chapters: {
        "draft.volume-1.arc-1.chapter-1": {
          title: "午夜来电",
          body: "电话在午夜十二点整响起。",
          character_state: "林岚决定赴约。",
          handoff: "下一章前往废弃报社。",
          committed: true,
          committed_at: "2025-06-01T00:00:00Z",
          commit_id: "legacy-commit"
        }
      },
      ledger: {
        committed_through: "draft.volume-1.arc-1.chapter-1",
        timeline: [
          {
            chapter_stage_id: "draft.volume-1.arc-1.chapter-1",
            chapter_card_id: "chapter-1",
            commit_id: "legacy-commit",
            content: "林岚于午夜接到来电。"
          }
        ],
        character_states: [],
        faction_states: [],
        realm_states: [],
        foreshadowing_states: [],
        continuity_notes: [],
        chapter_changes: []
      }
    }
  };
}

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-long-import-export-"))
  );
  temporaryRoots.push(root);
  const parentDirectory = join(root, "projects");
  const sourceDirectory = join(root, "source");
  await mkdir(parentDirectory);
  await mkdir(sourceDirectory);
  const sourcePath = join(sourceDirectory, "book.json");
  await writeFile(sourcePath, JSON.stringify(legacyBook(), null, 2), "utf8");
  return { root, parentDirectory, sourcePath };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

describe("long import/export store integration", () => {
  it("imports through staging without changing the explicit source file", async () => {
    const { parentDirectory, sourcePath } = await fixture();
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const beforeContent = await readFile(sourcePath);
    const beforeInfo = await lstat(sourcePath);

    const imported = await store.importWriteClawBook(
      parentDirectory,
      sourcePath
    );

    const afterInfo = await lstat(sourcePath);
    expect(await readFile(sourcePath)).toEqual(beforeContent);
    expect({
      ino: afterInfo.ino,
      size: afterInfo.size,
      mode: afterInfo.mode,
      mtimeMs: afterInfo.mtimeMs
    }).toEqual({
      ino: beforeInfo.ino,
      size: beforeInfo.size,
      mode: beforeInfo.mode,
      mtimeMs: beforeInfo.mtimeMs
    });
    expect(imported).toMatchObject({
      sourceKind: "book-json",
      legacySchemaVersion: 5,
      committedChapterPolicy: "legacy-checkpoints"
    });
    expect(imported.book.workspaceIndex.ledger.commits).toHaveLength(1);
    expect(
      imported.book.workspaceIndex.ledger.commits[0]!.reversible
    ).toBe(false);
    expect(imported.book.workspaceIndex.chapters[0]!.commitId).toBe(
      imported.book.workspaceIndex.ledger.commits[0]!.id
    );
    expect(imported.book.linkedMaterialIdsByKind.plot).toEqual([
      "material-long-legacy"
    ]);
    expect(imported.book.linkedSkillIdsByKind.style).toEqual([
      "skill-long-legacy"
    ]);
    const memoryCategory = imported.book.workspaceIndex.worldbuilding.find(
      ({ title }) => title === "书籍记忆（旧版）"
    )!;
    const memoryDocument = await store.readDocument(
      imported.projectDirectory,
      { fileId: memoryCategory.file.id }
    );
    expect(memoryDocument.content).toContain("memory-shadow");
    expect(memoryDocument.content).toContain("仅存档");
    await expect(
      store.writeDocument(imported.projectDirectory, {
        fileId: memoryCategory.file.id,
        content: "不应允许覆盖",
        expectedFileRevision: memoryDocument.revision,
        expectedWorkspaceRevision: memoryDocument.workspaceRevision,
        expectedProjectRevision: memoryDocument.projectRevision
      })
    ).rejects.toThrow(/只读迁移证据/u);
    const memorySearch = await store.search(imported.projectDirectory, {
      query: "影子只在午夜后说真话",
      fileIds: [memoryCategory.file.id]
    });
    expect(memorySearch.matches.length).toBeGreaterThan(0);
    expect(
      memorySearch.matches.every(
        ({ fileId }) => fileId === memoryCategory.file.id
      )
    ).toBe(true);
    const body = imported.book.workspaceIndex.chapters[0]!.body;
    await expect(
      store.readDocument(imported.projectDirectory, { fileId: body.id })
    ).resolves.toMatchObject({
      content: "电话在午夜十二点整响起。"
    });
    expect(
      (await readdir(parentDirectory)).some((name) =>
        name.includes(".staging-")
      )
    ).toBe(false);
  });

  it("refuses an existing deterministic target without overwriting it", async () => {
    const { parentDirectory, sourcePath } = await fixture();
    const plan = await readWriteClawLongImportPlan(sourcePath, {
      importedAt: FIXED_NOW
    });
    const target = join(parentDirectory, plan.manifest.id);
    await mkdir(target);
    const sentinelPath = join(target, "keep.txt");
    await writeFile(sentinelPath, "用户原文件", "utf8");
    const store = new LongProjectStore({ now: () => FIXED_NOW });

    await expect(
      store.importWriteClawBook(parentDirectory, sourcePath)
    ).rejects.toThrow(/已存在/u);
    expect(await readFile(sentinelPath, "utf8")).toBe("用户原文件");
    expect(await readdir(parentDirectory)).toEqual([plan.manifest.id]);
  });

  it("rejects a symbolic-link Write Claw source before creating a project", async () => {
    if (process.platform === "win32") return;
    const { root, parentDirectory, sourcePath } = await fixture();
    const linkedSource = join(root, "linked-book.json");
    await symlink(sourcePath, linkedSource);
    const store = new LongProjectStore({ now: () => FIXED_NOW });

    await expect(
      store.importWriteClawBook(parentDirectory, linkedSource)
    ).rejects.toThrow(/符号链接/u);
    expect(await readdir(parentDirectory)).toEqual([]);
  });

  it("rejects a hard-linked Write Claw source before creating a project", async () => {
    if (process.platform === "win32") return;
    const { root, parentDirectory, sourcePath } = await fixture();
    const linkedSource = join(root, "hard-linked-book.json");
    await link(sourcePath, linkedSource);
    const store = new LongProjectStore({ now: () => FIXED_NOW });

    await expect(
      store.importWriteClawBook(parentDirectory, linkedSource)
    ).rejects.toThrow(/硬链接/u);
    expect(await readdir(parentDirectory)).toEqual([]);
  });

  it("exports every indexed file and rejects an externally changed document", async () => {
    const { parentDirectory, sourcePath } = await fixture();
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const imported = await store.importWriteClawBook(
      parentDirectory,
      sourcePath
    );

    const bundle = parseLongPortableExportBundle(
      await store.exportPortableBundle(imported.projectDirectory)
    );
    expect(bundle.bookId).toBe(imported.book.id);
    expect(bundle.files).toHaveLength(
      1 +
        imported.book.workspaceIndex.worldbuilding.length +
        imported.book.workspaceIndex.characterFiles.length * 4 +
        imported.book.workspaceIndex.chapters.length * 3 +
        imported.book.workspaceIndex.ledger.commits.length
    );
    const body = imported.book.workspaceIndex.chapters[0]!.body;
    expect(bundle.files.find(({ id }) => id === body.id)?.content).toBe(
      "电话在午夜十二点整响起。"
    );

    await writeFile(
      join(imported.projectDirectory, body.path),
      "外部编辑但尚未写回索引",
      "utf8"
    );
    await expect(
      store.exportPortableBundle(imported.projectDirectory)
    ).rejects.toThrow(/revision/u);
  });

  it("includes and validates current reversible ledger records", async () => {
    const { root, parentDirectory } = await fixture();
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const created = await store.createBook(parentDirectory, {
      id: "longbook_export-ledger",
      title: "账本导出",
      genre: "悬疑"
    });
    const chapter = created.book.workspaceIndex.chapters[0]!;
    const chapterCardId = chapter.chapterCardId;
    const written = await store.writeChapter(created.projectDirectory, {
      chapterCardId,
      body: { content: "正文", baseRevision: chapter.body.revision },
      characterState: {
        content: "人物状态",
        baseRevision: chapter.characterState.revision
      },
      handoff: {
        content: "交接注意",
        baseRevision: chapter.handoff.revision
      },
      baseWorkspaceRevision: 0,
      baseProjectRevision: 0
    });
    const committed = await store.commitChapter(created.projectDirectory, {
      chapterCardId,
      chapterFileRevisions: {
        body: written.bodyRevision,
        characterState: written.characterStateRevision,
        handoff: written.handoffRevision
      },
      commitMessage: "提交导出测试章节",
      chapterSummary: {
        timeline: "第一天。",
        characterStates: "人物状态已写入。",
        factionStates: "势力状态无变化。",
        realmStates: "境界状态无变化。",
        foreshadowingStates: "伏笔状态无变化。",
        continuityNotes: "验证账本导出。"
      },
      placementDecisions: {},
      foreshadowingBeatDecisions: {},
      fileUpdates: [],
      baseWorkspaceRevision: written.workspaceRevision,
      baseProjectRevision: written.projectRevision
    });

    const bundle = parseLongPortableExportBundle(
      await store.exportPortableBundle(created.projectDirectory)
    );
    const ledgerFile = bundle.files.find(
      ({ kind }) => kind === "ledger-record"
    );
    expect(ledgerFile).toBeDefined();
    expect(
      LongLedgerCommitRecordSchema.parse(JSON.parse(ledgerFile!.content))
    ).toMatchObject({
      id: committed.record.id,
      chapterCardId,
      reversible: true
    });

    const portablePath = join(root, "reversible-ledger.deepwrite-long.json");
    await writeFile(
      portablePath,
      await store.exportPortableBundle(created.projectDirectory),
      "utf8"
    );
    const restoreParent = join(root, "reversible-restore");
    await mkdir(restoreParent);
    const restored = await store.importPortableBundle(
      restoreParent,
      portablePath
    );
    await expect(
      store.rollbackLastCommit(restored.projectDirectory, {
        expectedCommitId: committed.record.id,
        baseWorkspaceRevision: committed.workspaceRevision,
        baseProjectRevision: committed.projectRevision
      })
    ).resolves.toMatchObject({
      rolledBackCommitId: committed.record.id,
      committedThroughChapterId: null
    });
    await expect(
      store.openBook(restored.projectDirectory)
    ).resolves.toMatchObject({
      book: {
        workspaceIndex: {
          ledger: { commits: [] }
        }
      }
    });
  });

  it("round-trips a portable project through staging without changing its source", async () => {
    const { root, parentDirectory, sourcePath } = await fixture();
    const restoreParent = join(root, "restored-projects");
    await mkdir(restoreParent);
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const imported = await store.importWriteClawBook(
      parentDirectory,
      sourcePath
    );
    const portablePath = join(
      root,
      "migration.deepwrite-long.json"
    );
    const portableContent = await store.exportPortableBundle(
      imported.projectDirectory
    );
    await writeFile(portablePath, portableContent, "utf8");
    const beforeSource = await readFile(portablePath);
    const beforeInfo = await lstat(portablePath);

    const restored = await store.importPortableBundle(
      restoreParent,
      portablePath
    );

    expect(restored.exportedAt).toBe(FIXED_NOW);
    expect(restored.book).toEqual(imported.book);
    expect(await readFile(portablePath)).toEqual(beforeSource);
    expect((await lstat(portablePath)).mtimeMs).toBe(beforeInfo.mtimeMs);
    const reexported = parseLongPortableExportBundle(
      await store.exportPortableBundle(restored.projectDirectory)
    );
    const original = parseLongPortableExportBundle(portableContent);
    expect(reexported.manifest).toEqual(original.manifest);
    expect(reexported.index).toEqual(original.index);
    expect(reexported.files).toEqual(original.files);
    expect(
      (await readdir(restoreParent)).some((name) =>
        name.includes(".staging-")
      )
    ).toBe(false);
  });

  it("rejects a tampered portable project without leaving a partial target", async () => {
    const { root, parentDirectory, sourcePath } = await fixture();
    const restoreParent = join(root, "tampered-restores");
    await mkdir(restoreParent);
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const imported = await store.importWriteClawBook(
      parentDirectory,
      sourcePath
    );
    const bundle = JSON.parse(
      await store.exportPortableBundle(imported.projectDirectory)
    ) as {
      bookId: string;
      files: Array<{ content: string }>;
    };
    bundle.files[0]!.content = "被篡改的内容";
    const portablePath = join(root, "tampered.deepwrite-long.json");
    await writeFile(portablePath, JSON.stringify(bundle), "utf8");

    await expect(
      store.importPortableBundle(restoreParent, portablePath)
    ).rejects.toThrow(/校验失败/u);
    expect(await readdir(restoreParent)).toEqual([]);
  });
});

describe("long import/export service integration", () => {
  it("registers an imported book and exports it again by book id", async () => {
    const { root, parentDirectory, sourcePath } = await fixture();
    const service = new LongWorkspaceService({
      userDataPath: join(root, "user-data"),
      now: () => FIXED_NOW
    });

    const imported = await service.importWriteClawBook(
      parentDirectory,
      sourcePath
    );
    expect((await service.list()).books.map(({ id }) => id)).toContain(
      imported.book.id
    );
    const bundle = parseLongPortableExportBundle(
      await service.exportPortableBundle(imported.book.id)
    );
    expect(bundle.bookId).toBe(imported.book.id);
    expect(bundle.manifest.value.title).toBe("迁移长篇");
  });

  it("registers a restored portable project in an independent catalog", async () => {
    const { root, parentDirectory, sourcePath } = await fixture();
    const sourceStore = new LongProjectStore({ now: () => FIXED_NOW });
    const imported = await sourceStore.importWriteClawBook(
      parentDirectory,
      sourcePath
    );
    const portablePath = join(root, "restore.deepwrite-long.json");
    await writeFile(
      portablePath,
      await sourceStore.exportPortableBundle(imported.projectDirectory),
      "utf8"
    );
    const restoreParent = join(root, "service-restores");
    await mkdir(restoreParent);
    const service = new LongWorkspaceService({
      userDataPath: join(root, "restore-user-data"),
      now: () => FIXED_NOW
    });

    const restored = await service.importPortableBundle(
      restoreParent,
      portablePath
    );

    expect(restored.book.id).toBe(imported.book.id);
    expect((await service.list()).books).toEqual([
      expect.objectContaining({ id: imported.book.id, title: "迁移长篇" })
    ]);
  });

  it("writes portable exports outside the source project and rejects in-project destinations", async () => {
    const { root, parentDirectory, sourcePath } = await fixture();
    const service = new LongWorkspaceService({
      userDataPath: join(root, "safe-export-user-data"),
      now: () => FIXED_NOW
    });
    const imported = await service.importWriteClawBook(
      parentDirectory,
      sourcePath
    );
    const manifestPath = join(imported.projectDirectory, "deepwrite.json");
    const manifestBefore = await readFile(manifestPath, "utf8");

    await expect(
      service.exportPortableBundleToPath(imported.book.id, manifestPath)
    ).rejects.toThrow(/不能导出到源工程目录内/u);
    await expect(
      service.exportPortableBundleToPath(
        imported.book.id,
        join(imported.projectDirectory, "portable.deepwrite-long.json")
      )
    ).rejects.toThrow(/不能导出到源工程目录内/u);
    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
    await expect(
      lstat(
        join(
          imported.projectDirectory,
          "portable.deepwrite-long.json"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });

    const exportDirectory = join(root, "exports");
    await mkdir(exportDirectory);
    const destination = join(
      exportDirectory,
      "portable.deepwrite-long.json"
    );
    await expect(
      service.exportPortableBundleToPath(imported.book.id, destination)
    ).resolves.toMatchObject({
      filePath: destination,
      bytes: expect.any(Number)
    });
    expect(
      parseLongPortableExportBundle(await readFile(destination, "utf8")).bookId
    ).toBe(imported.book.id);
  });
});
