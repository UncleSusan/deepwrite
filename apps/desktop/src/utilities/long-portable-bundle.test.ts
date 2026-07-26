import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitFileId,
  type LongProjectManifest,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  LONG_PORTABLE_BUNDLE_MAX_BYTES,
  buildLongPortableExportBundle,
  parseLongPortableExportBundle,
  stringifyLongPortableExportBundle
} from "./long-portable-bundle";
import {
  createWriteClawLongImportPlan
} from "./write-claw-long-import";
import {
  parseWriteClawLongSourceBytes
} from "./write-claw-long-archive";

const FIXED_NOW = "2026-07-26T12:00:00.000Z";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function revision(content: string): string {
  return `v1:${Buffer.byteLength(content, "utf8")}:${sha256(content).slice(0, 8)}`;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function basePlan() {
  const workspace = {
    schema_version: 5,
    worldbuilding: {
      categories: [
        {
          id: "rules",
          name: "规则",
          format: "text",
          overview: "",
          items: [],
          text: "规则正文"
        }
      ]
    },
    characters: {
      protagonists: { entries: [] },
      major_supporting: { entries: [] },
      minor_supporting: { entries: [] },
      passersby: { entries: [] }
    },
    plot: {
      book_line: "主线",
      volumes: [{ id: "v1", name: "第一卷", outline: "", order: 1 }],
      arcs: [
        {
          id: "a1",
          volume_id: "v1",
          name: "第一弧",
          outline: "",
          order: 1
        }
      ],
      chapter_cards: [
        {
          id: "c1",
          volume_id: "v1",
          arc_id: "a1",
          stage_id: "draft.volume-1.arc-1.chapter-1",
          title: "第一章",
          outline: "",
          world_constraints: "",
          characters: [],
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
        title: "第一章",
        body: "正文",
        character_state: "状态",
        handoff: "交接",
        committed: false
      }
    },
    ledger: {
      committed_through: "",
      timeline: [],
      character_states: [],
      faction_states: [],
      realm_states: [],
      foreshadowing_states: [],
      continuity_notes: [],
      chapter_changes: []
    }
  };
  const source = parseWriteClawLongSourceBytes(
    Buffer.from(JSON.stringify(workspace), "utf8"),
    "long_workspace.json"
  );
  return createWriteClawLongImportPlan(source, {
    importedAt: FIXED_NOW,
    title: "可移植测试",
    sourceIdentity: "portable-test"
  });
}

function withLedgerRecord() {
  const plan = basePlan();
  const commitId = "commit_bundle";
  const chapterId = plan.index.plot.chapterCards[0]!.id;
  const record = LongLedgerCommitRecordSchema.parse({
    schemaVersion: 1,
    id: commitId,
    bookId: plan.index.bookId,
    sequence: 1,
    chapterCardId: chapterId,
    committedAt: FIXED_NOW,
    reversible: true,
    sourceWorkspaceRevision: 0,
    committedWorkspaceRevision: 1,
    sourceProjectRevision: 0,
    committedProjectRevision: 1,
    previousCommittedThroughChapterId: null,
    committedThroughChapterId: chapterId,
    previousChapterCommitId: null,
    placementChanges: [],
    foreshadowingBeatChanges: [],
    fileChanges: []
  });
  const recordContent = serializeJson(record);
  const recordPath = `long/ledger/${sha256(commitId).slice(0, 32)}.json`;
  const index = LongWorkspaceIndexSnapshotSchema.parse({
    ...plan.index,
    revision: 1,
    chapters: plan.index.chapters.map((chapter) => ({
      ...chapter,
      commitId
    })),
    ledger: {
      committedThroughChapterId: chapterId,
      commits: [
        {
          id: commitId,
          sequence: 1,
          chapterCardId: chapterId,
          committedAt: FIXED_NOW,
          reversible: true,
          sourceRevision: 0,
          placementIds: [],
          foreshadowingBeatIds: [],
          recordFile: {
            id: longLedgerCommitFileId(commitId),
            path: recordPath,
            revision: revision(recordContent),
            updatedAt: FIXED_NOW
          }
        }
      ]
    }
  });
  const manifest = LongProjectManifestSchema.parse({
    ...plan.manifest,
    revision: 1,
    workspaceIndexFile: {
      id: LONG_WORKSPACE_INDEX_FILE_ID,
      path: LONG_WORKSPACE_INDEX_PATH,
      revision: revision(serializeJson(index)),
      updatedAt: FIXED_NOW
    }
  });
  return { plan, manifest, index, recordContent };
}

describe("long portable export bundle", () => {
  it("keeps in-memory portable JSON under a strict 64 MiB ceiling", () => {
    expect(LONG_PORTABLE_BUNDLE_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  it("builds, serializes and parses a complete bundle including ledger records", async () => {
    const { plan, manifest, index, recordContent } = withLedgerRecord();
    const contentById = new Map(
      plan.documents.map(({ fileId, content }) => [fileId, content])
    );
    contentById.set(index.ledger.commits[0]!.recordFile.id, recordContent);

    const bundle = await buildLongPortableExportBundle({
      manifest,
      index,
      exportedAt: FIXED_NOW,
      readFile: ({ id }) => {
        const content = contentById.get(id);
        if (content === undefined) throw new Error(`missing ${id}`);
        return content;
      }
    });
    const serialized = stringifyLongPortableExportBundle(bundle);
    const parsed = parseLongPortableExportBundle(serialized);

    expect(parsed.schema).toBe("deepwrite.long-book.portable");
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.bookId).toBe(index.bookId);
    expect(parsed.manifest.value).toEqual(manifest);
    expect(parsed.index.value).toEqual(index);
    expect(parsed.files).toHaveLength(plan.documents.length + 1);
    expect(parsed.files.at(-1)).toMatchObject({
      id: index.ledger.commits[0]!.recordFile.id,
      kind: "ledger-record",
      content: recordContent
    });
    expect(
      parsed.files.every(({ sha256: digest }) =>
        /^[0-9a-f]{64}$/u.test(digest)
      )
    ).toBe(true);
  });

  it("rejects stale source content and tampered bundle hashes/content", async () => {
    const plan = basePlan();
    const contents = new Map(
      plan.documents.map(({ fileId, content }) => [fileId, content])
    );

    await expect(
      buildLongPortableExportBundle({
        manifest: plan.manifest,
        index: plan.index,
        exportedAt: FIXED_NOW,
        readFile: ({ id }) =>
          id === plan.index.bookLine.id ? "被外部修改" : contents.get(id)!
      })
    ).rejects.toThrow(/revision/u);

    const bundle = await buildLongPortableExportBundle({
      manifest: plan.manifest,
      index: plan.index,
      exportedAt: FIXED_NOW,
      readFile: ({ id }) => contents.get(id)!
    });
    const tamperedContent = structuredClone(bundle);
    tamperedContent.files[0]!.content += "篡改";
    expect(() => parseLongPortableExportBundle(tamperedContent)).toThrow(
      /完整性/u
    );

    const tamperedManifest = structuredClone(bundle);
    tamperedManifest.manifest.sha256 = "0".repeat(64);
    expect(() => parseLongPortableExportBundle(tamperedManifest)).toThrow(
      /SHA-256/u
    );
  });

  it("rejects an incomplete portable file set", async () => {
    const plan = basePlan();
    const contents = new Map(
      plan.documents.map(({ fileId, content }) => [fileId, content])
    );
    const bundle = await buildLongPortableExportBundle({
      manifest: plan.manifest,
      index: plan.index,
      exportedAt: FIXED_NOW,
      readFile: ({ id }) => contents.get(id)!
    });
    bundle.files.pop();

    expect(() => parseLongPortableExportBundle(bundle)).toThrow(/完整/u);
  });

  it("cross-validates ledger records against their index entries", async () => {
    const { plan, manifest, index, recordContent } = withLedgerRecord();
    const contents = new Map(
      plan.documents.map(({ fileId, content }) => [fileId, content])
    );
    contents.set(index.ledger.commits[0]!.recordFile.id, recordContent);
    const bundle = await buildLongPortableExportBundle({
      manifest,
      index,
      exportedAt: FIXED_NOW,
      readFile: ({ id }) => contents.get(id)!
    });
    const tampered = structuredClone(bundle);
    const ledgerFile = tampered.files.find(
      ({ kind }) => kind === "ledger-record"
    )!;
    const record = JSON.parse(ledgerFile.content) as {
      sourceWorkspaceRevision: number;
      committedWorkspaceRevision: number;
      sourceProjectRevision: number;
      committedProjectRevision: number;
    };
    record.sourceWorkspaceRevision = 5;
    record.committedWorkspaceRevision = 6;
    record.sourceProjectRevision = 5;
    record.committedProjectRevision = 6;
    ledgerFile.content = serializeJson(record);
    ledgerFile.revision = revision(ledgerFile.content);
    ledgerFile.sha256 = sha256(ledgerFile.content);
    tampered.index.value.ledger.commits[0]!.recordFile.revision =
      ledgerFile.revision as never;
    const indexText = serializeJson(tampered.index.value);
    tampered.index.sha256 = sha256(indexText);
    tampered.manifest.value.workspaceIndexFile.revision =
      revision(indexText) as never;
    tampered.manifest.sha256 = sha256(
      serializeJson(tampered.manifest.value)
    );

    expect(() => parseLongPortableExportBundle(tampered)).toThrow(
      /账本记录.*索引不一致/u
    );
  });

  it("rejects a fully rehashed ledger forgery with a split project revision chain", async () => {
    const { plan, manifest, index, recordContent } = withLedgerRecord();
    const contents = new Map(
      plan.documents.map(({ fileId, content }) => [fileId, content])
    );
    contents.set(index.ledger.commits[0]!.recordFile.id, recordContent);
    const bundle = await buildLongPortableExportBundle({
      manifest,
      index,
      exportedAt: FIXED_NOW,
      readFile: ({ id }) => contents.get(id)!
    });
    const tampered = structuredClone(bundle);
    const ledgerFile = tampered.files.find(
      ({ kind }) => kind === "ledger-record"
    )!;
    const record = JSON.parse(ledgerFile.content) as {
      sourceProjectRevision: number;
      committedProjectRevision: number;
    };
    record.sourceProjectRevision = 5;
    record.committedProjectRevision = 6;
    ledgerFile.content = serializeJson(record);
    ledgerFile.revision = revision(ledgerFile.content);
    ledgerFile.sha256 = sha256(ledgerFile.content);
    tampered.index.value.revision = 6;
    tampered.index.value.ledger.commits[0]!.recordFile.revision =
      ledgerFile.revision as never;
    const indexText = serializeJson(tampered.index.value);
    tampered.index.sha256 = sha256(indexText);
    tampered.manifest.value.revision = 6;
    tampered.manifest.value.workspaceIndexFile.revision =
      revision(indexText) as never;
    tampered.manifest.sha256 = sha256(
      serializeJson(tampered.manifest.value)
    );

    expect(() => parseLongPortableExportBundle(tampered)).toThrow(
      /revision/u
    );
  });

  it("rejects a rehashed ledger record that invents a prior chapter commit", async () => {
    const { plan, manifest, index, recordContent } = withLedgerRecord();
    const contents = new Map(
      plan.documents.map(({ fileId, content }) => [fileId, content])
    );
    contents.set(index.ledger.commits[0]!.recordFile.id, recordContent);
    const bundle = await buildLongPortableExportBundle({
      manifest,
      index,
      exportedAt: FIXED_NOW,
      readFile: ({ id }) => contents.get(id)!
    });
    const tampered = structuredClone(bundle);
    const ledgerFile = tampered.files.find(
      ({ kind }) => kind === "ledger-record"
    )!;
    const record = JSON.parse(ledgerFile.content) as {
      previousChapterCommitId: string | null;
    };
    record.previousChapterCommitId = "commit_forged";
    ledgerFile.content = serializeJson(record);
    ledgerFile.revision = revision(ledgerFile.content);
    ledgerFile.sha256 = sha256(ledgerFile.content);
    tampered.index.value.ledger.commits[0]!.recordFile.revision =
      ledgerFile.revision as never;
    const indexText = serializeJson(tampered.index.value);
    tampered.index.sha256 = sha256(indexText);
    tampered.manifest.value.workspaceIndexFile.revision =
      revision(indexText) as never;
    tampered.manifest.sha256 = sha256(
      serializeJson(tampered.manifest.value)
    );

    expect(() => parseLongPortableExportBundle(tampered)).toThrow(
      /回滚前态/u
    );
  });

  it("reads indexed files sequentially so very large projects do not exhaust file handles", async () => {
    const plan = basePlan();
    const contents = new Map(
      plan.documents.map(({ fileId, content }) => [fileId, content])
    );
    let activeReads = 0;
    let maximumActiveReads = 0;

    await buildLongPortableExportBundle({
      manifest: plan.manifest,
      index: plan.index,
      exportedAt: FIXED_NOW,
      readFile: async ({ id }) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        await Promise.resolve();
        activeReads -= 1;
        return contents.get(id)!;
      }
    });

    expect(maximumActiveReads).toBe(1);
  });
});
