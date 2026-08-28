import {
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceFileReferenceSchema
} from "@deepwrite/contracts";
import {
  FIXED_NOW,
  LONG_WORKSPACE_INDEX_PATH,
  createFixture,
  createLongFileRevision,
  describe,
  expect,
  firstChapterFiles,
  it,
  join,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longChapterWorldRevealsFileId,
  projectTransactionContentSha256,
  readFile,
  readdir,
  writeFile
} from "./long-project-store.test-support";

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function legacyRevision(content: string): string {
  const digest = projectTransactionContentSha256(Buffer.from(content, "utf8"));
  return `v1:${Buffer.byteLength(content, "utf8")}:${digest.slice(0, 8)}`;
}

function secondChapterFiles(chapterCardId: string) {
  const storage = projectTransactionContentSha256(chapterCardId).slice(0, 32);
  const emptyRevision = createLongFileRevision("");
  const file = (id: string, path: string) => ({
    id,
    path,
    revision: emptyRevision,
    updatedAt: FIXED_NOW
  });
  return {
    chapterCardId,
    bodyStatus: "empty" as const,
    body: file(
      longChapterBodyFileId(chapterCardId),
      `long/chapters/${storage}/body.md`
    ),
    card: file(
      longChapterCardFileId(chapterCardId),
      `long/chapters/${storage}/card.md`
    ),
    characterState: file(
      longChapterCharacterStateFileId(chapterCardId),
      `long/chapters/${storage}/character-state.md`
    ),
    handoff: file(
      longChapterHandoffFileId(chapterCardId),
      `long/chapters/${storage}/handoff.md`
    ),
    foreshadowingChanges: file(
      longChapterForeshadowingChangesFileId(chapterCardId),
      longChapterContinuityFilePath(chapterCardId, "foreshadowing-changes.md")
    ),
    worldReveals: null,
    characterContinuity: [],
    commitId: null
  };
}

async function introduceSafeHistoricalAuditDrift(
  projectDirectory: string
): Promise<{ commitId: string; addedWorldRevealFileId: string }> {
  const indexPath = join(projectDirectory, LONG_WORKSPACE_INDEX_PATH);
  const index = LongWorkspaceIndexSnapshotSchema.parse(
    JSON.parse(await readFile(indexPath, "utf8"))
  );
  const commit = index.ledger.commits[0]!;
  const chapter = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === commit.chapterCardId
  )!;
  const recordPath = join(projectDirectory, commit.recordFile.path);
  const record = LongLedgerCommitRecordSchema.parse(
    JSON.parse(await readFile(recordPath, "utf8"))
  );
  if (record.schemaVersion !== 4) {
    throw new Error("expected a v4 text-file ledger record");
  }

  const characterStateContent = await readFile(
    join(projectDirectory, chapter.characterState.path),
    "utf8"
  );
  const auditedCharacterState = record.continuityFiles.find(
    ({ fileId }) => fileId === chapter.characterState.id
  )!;
  auditedCharacterState.revision = legacyRevision(
    characterStateContent
  ) as typeof auditedCharacterState.revision;

  const worldRevealContent = "旧版本在提交后补建，但内容仍属于第一章。";
  const worldReveals = LongWorkspaceFileReferenceSchema.parse({
    id: longChapterWorldRevealsFileId(chapter.chapterCardId),
    path: longChapterContinuityFilePath(
      chapter.chapterCardId,
      "world-reveals.md"
    ),
    revision: createLongFileRevision(worldRevealContent),
    updatedAt: FIXED_NOW
  });
  chapter.worldReveals = worldReveals;
  await writeFile(
    join(projectDirectory, worldReveals.path),
    worldRevealContent,
    "utf8"
  );

  const recordContent = serializeJson(record);
  commit.recordFile.revision = createLongFileRevision(recordContent);
  await writeFile(recordPath, recordContent, "utf8");

  const validatedIndex = LongWorkspaceIndexSnapshotSchema.parse(index);
  const indexContent = serializeJson(validatedIndex);
  await writeFile(indexPath, indexContent, "utf8");

  const manifestPath = join(projectDirectory, "deepwrite.json");
  const manifest = LongProjectManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8"))
  );
  manifest.workspaceIndexFile.revision = createLongFileRevision(indexContent);
  await writeFile(manifestPath, serializeJson(manifest), "utf8");

  return { commitId: commit.id, addedWorldRevealFileId: worldReveals.id };
}

async function introduceConflictingHistoricalAudit(
  projectDirectory: string
): Promise<{ commitId: string; staleRevision: string }> {
  const indexPath = join(projectDirectory, LONG_WORKSPACE_INDEX_PATH);
  const index = LongWorkspaceIndexSnapshotSchema.parse(
    JSON.parse(await readFile(indexPath, "utf8"))
  );
  const commit = index.ledger.commits[0]!;
  const chapter = index.chapters.find(
    ({ chapterCardId }) => chapterCardId === commit.chapterCardId
  )!;
  const recordPath = join(projectDirectory, commit.recordFile.path);
  const record = LongLedgerCommitRecordSchema.parse(
    JSON.parse(await readFile(recordPath, "utf8"))
  );
  if (record.schemaVersion !== 4) {
    throw new Error("expected a v4 text-file ledger record");
  }

  const staleRevision = createLongFileRevision("已经过时的章末状态");
  const auditedCharacterState = record.continuityFiles.find(
    ({ fileId }) => fileId === chapter.characterState.id
  )!;
  auditedCharacterState.revision = staleRevision;
  const recordContent = serializeJson(record);
  commit.recordFile.revision = createLongFileRevision(recordContent);
  await writeFile(recordPath, recordContent, "utf8");

  const validatedIndex = LongWorkspaceIndexSnapshotSchema.parse(index);
  const indexContent = serializeJson(validatedIndex);
  await writeFile(indexPath, indexContent, "utf8");

  const manifestPath = join(projectDirectory, "deepwrite.json");
  const manifest = LongProjectManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8"))
  );
  manifest.workspaceIndexFile.revision = createLongFileRevision(indexContent);
  await writeFile(manifestPath, serializeJson(manifest), "utf8");

  return { commitId: commit.id, staleRevision };
}

describe("LongProjectStore: v4 ledger compatibility", () => {
  it("continues a later commit when an older audit uses an equivalent legacy revision and predates optional files", async () => {
    const { projectStore, created } = await createFixture(
      "ledger-compatible-history"
    );
    const initial = created.book.workspaceIndex;
    const firstChapterId = initial.plot.chapterCards[0]!.id;
    const secondChapterId = "chapter_later";
    const laterFiles = secondChapterFiles(secondChapterId);
    const structured = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          baseRevision: 0,
          updatedAt: FIXED_NOW,
          operations: [
            {
              type: "chapter.create",
              chapterCard: {
                id: secondChapterId,
                volumeId: initial.plot.volumes[0]!.id,
                primaryArcId: initial.plot.arcs[0]!.id,
                title: "第二章",
                narrativeOrder: 2
              },
              files: laterFiles
            }
          ],
          documentWrites: []
        },
        expectedProjectRevision: 0
      }
    );
    const firstFiles = firstChapterFiles(structured.book);
    const firstWritten = await projectStore.writeChapter(
      created.projectDirectory,
      {
        chapterCardId: firstChapterId,
        body: { content: "第一章正文", baseRevision: firstFiles.body.revision },
        characterState: {
          content: "第一章章末状态",
          baseRevision: firstFiles.characterState.revision
        },
        handoff: {
          content: "下一章继续调查。",
          baseRevision: firstFiles.handoff.revision
        },
        baseWorkspaceRevision: 1,
        baseProjectRevision: 1
      }
    );
    await projectStore.commitChapter(created.projectDirectory, {
      mode: "text_files",
      chapterCardId: firstChapterId,
      chapterFileRevisions: { body: firstWritten.bodyRevision },
      continuityFileRevisions: [
        {
          fileId: firstFiles.characterState.id,
          revision: firstWritten.characterStateRevision
        },
        {
          fileId: firstFiles.handoff.id,
          revision: firstWritten.handoffRevision
        }
      ],
      foreshadowingBeatDecisions: {},
      commitMessage: "提交第一章账本",
      baseWorkspaceRevision: 2,
      baseProjectRevision: 2
    });

    const drift = await introduceSafeHistoricalAuditDrift(
      created.projectDirectory
    );
    const secondWritten = await projectStore.writeChapter(
      created.projectDirectory,
      {
        chapterCardId: secondChapterId,
        body: { content: "第二章正文", baseRevision: laterFiles.body.revision },
        characterState: {
          content: "第二章章末状态",
          baseRevision: laterFiles.characterState.revision
        },
        handoff: {
          content: "下一章承接第二章。",
          baseRevision: laterFiles.handoff.revision
        },
        baseWorkspaceRevision: 3,
        baseProjectRevision: 3
      }
    );

    await expect(
      projectStore.commitChapter(created.projectDirectory, {
        mode: "text_files",
        chapterCardId: secondChapterId,
        chapterFileRevisions: { body: secondWritten.bodyRevision },
        continuityFileRevisions: [
          {
            fileId: laterFiles.characterState.id,
            revision: secondWritten.characterStateRevision
          },
          {
            fileId: laterFiles.handoff.id,
            revision: secondWritten.handoffRevision
          }
        ],
        foreshadowingBeatDecisions: {},
        commitMessage: "提交第二章账本",
        baseWorkspaceRevision: 4,
        baseProjectRevision: 4
      })
    ).resolves.toMatchObject({
      record: { sequence: 2, chapterCardId: secondChapterId },
      workspaceRevision: 5,
      projectRevision: 5
    });

    const after = await projectStore.openBook(created.projectDirectory);
    expect(
      after.book.workspaceIndex.ledger.commits.map(({ id }) => id)
    ).toEqual([drift.commitId, expect.any(String)]);
    expect(after.book.workspaceIndex.chapters[0]!.worldReveals?.id).toBe(
      drift.addedWorldRevealFileId
    );

    const historicalRecordPath =
      after.book.workspaceIndex.ledger.commits[0]!.recordFile.path;
    const historicalRecord = LongLedgerCommitRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(created.projectDirectory, historicalRecordPath),
          "utf8"
        )
      )
    );
    expect(historicalRecord.continuityFiles).toHaveLength(2);
    expect(historicalRecord.continuityFiles[0]!.revision).toMatch(/^v1:/u);
  });

  it("overwrites a conflicting v4 audit from current files and continues the pending commit", async () => {
    const { projectStore, created } = await createFixture(
      "ledger-current-overwrites-history"
    );
    const initial = created.book.workspaceIndex;
    const firstChapterId = initial.plot.chapterCards[0]!.id;
    const secondChapterId = "chapter_after_repair";
    const laterFiles = secondChapterFiles(secondChapterId);
    const structured = await projectStore.applyWorkspaceOperations(
      created.projectDirectory,
      {
        batch: {
          baseRevision: 0,
          updatedAt: FIXED_NOW,
          operations: [
            {
              type: "chapter.create",
              chapterCard: {
                id: secondChapterId,
                volumeId: initial.plot.volumes[0]!.id,
                primaryArcId: initial.plot.arcs[0]!.id,
                title: "修复后的第二章",
                narrativeOrder: 2
              },
              files: laterFiles
            }
          ],
          documentWrites: []
        },
        expectedProjectRevision: 0
      }
    );
    const firstFiles = firstChapterFiles(structured.book);
    const firstWritten = await projectStore.writeChapter(
      created.projectDirectory,
      {
        chapterCardId: firstChapterId,
        body: { content: "第一章正文", baseRevision: firstFiles.body.revision },
        characterState: {
          content: "当前最完整的第一章章末状态",
          baseRevision: firstFiles.characterState.revision
        },
        handoff: {
          content: "当前最完整的第一章接续包",
          baseRevision: firstFiles.handoff.revision
        },
        baseWorkspaceRevision: 1,
        baseProjectRevision: 1
      }
    );
    await projectStore.commitChapter(created.projectDirectory, {
      mode: "text_files",
      chapterCardId: firstChapterId,
      chapterFileRevisions: { body: firstWritten.bodyRevision },
      continuityFileRevisions: [
        {
          fileId: firstFiles.characterState.id,
          revision: firstWritten.characterStateRevision
        },
        {
          fileId: firstFiles.handoff.id,
          revision: firstWritten.handoffRevision
        }
      ],
      foreshadowingBeatDecisions: {},
      commitMessage: "提交第一章账本",
      baseWorkspaceRevision: 2,
      baseProjectRevision: 2
    });

    const drift = await introduceConflictingHistoricalAudit(
      created.projectDirectory
    );
    const secondWritten = await projectStore.writeChapter(
      created.projectDirectory,
      {
        chapterCardId: secondChapterId,
        body: { content: "第二章正文", baseRevision: laterFiles.body.revision },
        characterState: {
          content: "第二章章末状态",
          baseRevision: laterFiles.characterState.revision
        },
        handoff: {
          content: "第二章接续包",
          baseRevision: laterFiles.handoff.revision
        },
        baseWorkspaceRevision: 3,
        baseProjectRevision: 3
      }
    );

    await expect(
      projectStore.commitChapter(created.projectDirectory, {
        mode: "text_files",
        chapterCardId: secondChapterId,
        chapterFileRevisions: { body: secondWritten.bodyRevision },
        continuityFileRevisions: [
          {
            fileId: laterFiles.characterState.id,
            revision: secondWritten.characterStateRevision
          },
          {
            fileId: laterFiles.handoff.id,
            revision: secondWritten.handoffRevision
          }
        ],
        foreshadowingBeatDecisions: {},
        commitMessage: "覆盖旧清单后提交第二章账本",
        baseWorkspaceRevision: 4,
        baseProjectRevision: 4
      })
    ).resolves.toMatchObject({
      record: { sequence: 2, chapterCardId: secondChapterId },
      workspaceRevision: 6,
      projectRevision: 6
    });

    const after = await projectStore.openBook(created.projectDirectory);
    const historicalEntry = after.book.workspaceIndex.ledger.commits[0]!;
    expect(after.book.workspaceIndex.ledger.commits).toHaveLength(2);
    expect(historicalEntry.id).toBe(drift.commitId);
    const historicalChapter = after.book.workspaceIndex.chapters.find(
      ({ chapterCardId }) => chapterCardId === firstChapterId
    )!;
    const expectedCurrentReferences = [
      historicalChapter.characterState,
      historicalChapter.handoff,
      historicalChapter.foreshadowingChanges,
      ...(historicalChapter.worldReveals
        ? [historicalChapter.worldReveals]
        : []),
      ...historicalChapter.characterContinuity.flatMap((continuity) => [
        continuity.currentState,
        continuity.history
      ])
    ];
    const historicalRecord = LongLedgerCommitRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(created.projectDirectory, historicalEntry.recordFile.path),
          "utf8"
        )
      )
    );
    expect(historicalRecord.continuityFiles).toEqual(
      expectedCurrentReferences.map(({ id, path, revision }) => ({
        fileId: id,
        path,
        revision
      }))
    );
    expect(
      await readFile(
        join(created.projectDirectory, historicalChapter.characterState.path),
        "utf8"
      )
    ).toBe("当前最完整的第一章章末状态");

    const backupNames = await readdir(
      join(created.projectDirectory, "long/ledger/recovery")
    );
    expect(backupNames).toHaveLength(1);
    expect(backupNames[0]).toMatch(
      new RegExp(
        `^${drift.commitId}\\.[0-9a-f]{8}\\.before-current-overwrite\\.json$`,
        "u"
      )
    );
    const backupRecord = LongLedgerCommitRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(
            created.projectDirectory,
            "long/ledger/recovery",
            backupNames[0]!
          ),
          "utf8"
        )
      )
    );
    expect(
      backupRecord.continuityFiles.find(
        ({ fileId }) => fileId === historicalChapter.characterState.id
      )?.revision
    ).toBe(drift.staleRevision);
  });
});
