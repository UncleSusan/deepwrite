import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitFileId
} from "@deepwrite/contracts";
import {
  LONG_PORTABLE_BUNDLE_SCHEMA,
  LONG_PORTABLE_BUNDLE_SCHEMA_VERSION,
  parseLongPortableExportBundle,
  type LongPortableExportBundle
} from "./long-portable-bundle";
import { parseWriteClawLongSourceBytes } from "./write-claw-long-archive";
import { createWriteClawLongImportPlan } from "./write-claw-long-import";

const FIXED_NOW = "2026-07-26T12:00:00.000Z";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function revision(content: string): string {
  return `v2:${Buffer.byteLength(content, "utf8")}:${sha256(content)}`;
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
    title: "可移植导入测试",
    sourceIdentity: "portable-import-test"
  });
}

function portableImportFixture(): LongPortableExportBundle {
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
  const files = [
    ...plan.documents.map((document) => ({
      id: document.fileId,
      path: document.path,
      kind: "markdown" as const,
      revision: document.revision,
      sha256: sha256(document.content),
      content: document.content
    })),
    {
      id: longLedgerCommitFileId(commitId),
      path: recordPath,
      kind: "ledger-record" as const,
      revision: revision(recordContent),
      sha256: sha256(recordContent),
      content: recordContent
    }
  ];
  return {
    schema: LONG_PORTABLE_BUNDLE_SCHEMA,
    schemaVersion: LONG_PORTABLE_BUNDLE_SCHEMA_VERSION,
    exportedAt: FIXED_NOW,
    bookId: manifest.id,
    manifest: {
      mediaType: "application/json",
      sha256: sha256(serializeJson(manifest)),
      value: manifest
    },
    index: {
      mediaType: "application/json",
      sha256: sha256(serializeJson(index)),
      value: index
    },
    files
  };
}

function rehashLedgerMutation(
  bundle: LongPortableExportBundle,
  mutate: (record: Record<string, unknown>) => void
): void {
  const ledgerFile = bundle.files.find(
    ({ kind }) => kind === "ledger-record"
  )!;
  const record = JSON.parse(ledgerFile.content) as Record<string, unknown>;
  mutate(record);
  ledgerFile.content = serializeJson(record);
  ledgerFile.revision = revision(ledgerFile.content);
  ledgerFile.sha256 = sha256(ledgerFile.content);
  bundle.index.value.ledger.commits[0]!.recordFile.revision =
    ledgerFile.revision as never;
  const indexText = serializeJson(bundle.index.value);
  bundle.index.sha256 = sha256(indexText);
  bundle.manifest.value.workspaceIndexFile.revision =
    revision(indexText) as never;
  bundle.manifest.sha256 = sha256(serializeJson(bundle.manifest.value));
}

describe("long portable import parser", () => {
  it("accepts a complete bundle with a cross-validated ledger record", () => {
    const parsed = parseLongPortableExportBundle(portableImportFixture());

    expect(parsed.index.value.ledger.commits).toHaveLength(1);
    expect(parsed.files.some(({ kind }) => kind === "ledger-record")).toBe(
      true
    );
  });

  it("rejects tampered content and manifest hashes", () => {
    const tamperedContent = structuredClone(portableImportFixture());
    tamperedContent.files[0]!.content += "篡改";
    expect(() => parseLongPortableExportBundle(tamperedContent)).toThrow(
      /完整性/u
    );

    const tamperedManifest = structuredClone(portableImportFixture());
    tamperedManifest.manifest.sha256 = "0".repeat(64);
    expect(() => parseLongPortableExportBundle(tamperedManifest)).toThrow(
      /SHA-256/u
    );
  });

  it("rejects missing, duplicate and case-equivalent file paths", () => {
    const incomplete = structuredClone(portableImportFixture());
    incomplete.files.pop();
    expect(() => parseLongPortableExportBundle(incomplete)).toThrow(/完整/u);

    const duplicate = structuredClone(portableImportFixture());
    duplicate.files[1] = { ...duplicate.files[0]! };
    expect(() => parseLongPortableExportBundle(duplicate)).toThrow(/重复/u);

    const pathCollision = structuredClone(portableImportFixture());
    pathCollision.files[1]!.path =
      pathCollision.files[0]!.path.toLocaleUpperCase("en-US");
    expect(() => parseLongPortableExportBundle(pathCollision)).toThrow(
      /重复/u
    );
  });

  it("rejects a fully rehashed record that no longer matches its index", () => {
    const tampered = structuredClone(portableImportFixture());
    rehashLedgerMutation(tampered, (record) => {
      record.sourceWorkspaceRevision = 5;
      record.committedWorkspaceRevision = 6;
      record.sourceProjectRevision = 5;
      record.committedProjectRevision = 6;
    });

    expect(() => parseLongPortableExportBundle(tampered)).toThrow(
      /账本记录.*索引不一致/u
    );
  });

  it("rejects rehashed project-revision and previous-commit forgeries", () => {
    const splitRevision = structuredClone(portableImportFixture());
    rehashLedgerMutation(splitRevision, (record) => {
      record.sourceProjectRevision = 5;
      record.committedProjectRevision = 6;
    });
    expect(() => parseLongPortableExportBundle(splitRevision)).toThrow(
      /revision/u
    );

    const inventedPreviousCommit = structuredClone(portableImportFixture());
    rehashLedgerMutation(inventedPreviousCommit, (record) => {
      record.previousChapterCommitId = "commit_forged";
    });
    expect(() =>
      parseLongPortableExportBundle(inventedPreviousCommit)
    ).toThrow(/回滚前态/u);
  });
});
