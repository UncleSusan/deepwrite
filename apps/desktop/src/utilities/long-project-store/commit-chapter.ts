import {
  LONG_WORKSPACE_INDEX_PATH,
  LongCommitChapterInputSchema,
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitFileId,
  type LongCommitChapterResult,
  type LongLedgerCommitRecord,
  type LongTextFilesCommitChapterInput,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import {
  ProjectTransactionConflictError,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import { loadIndexedFile } from "./cache";
import {
  appendLongCharacterHistoryEntry,
  assertLongContinuityMutationAuthority,
  deriveLongForeshadowingStatus,
  materializeLongContinuityProjection,
  serializeLongContinuityHandoff
} from "./continuity";
import {
  assertExactDecisionIds,
  assertPinnedSetIntegrity,
  assertProjectRevisions,
  mergeIntegrityChecks
} from "./integrity";
import {
  commitLongProjectTransaction,
  encodeUtf8Strict,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { contiguousRecordedThrough, ledgerPath } from "./paths";
import { createLongFileRevision, longRevisionsMatchContent } from "./revisions";
import type { LongProjectStoreContext } from "./store-context";
import {
  LongProjectConflictError,
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  type LoadedLongProject,
  type StoreCommitLongChapterInput
} from "./types";

export async function commitChapter(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  rawInput: StoreCommitLongChapterInput
): Promise<LongCommitChapterResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const input = LongCommitChapterInputSchema.parse({
      ...rawInput,
      bookId: loaded.manifest.id
    });
    assertProjectRevisions(
      loaded,
      input.baseWorkspaceRevision,
      input.baseProjectRevision
    );
    const existingPinnedChecks = await assertPinnedSetIntegrity(loaded);

    const chapterEntry = loaded.index.chapters.find(
      ({ chapterCardId }) => chapterCardId === input.chapterCardId
    );
    if (!chapterEntry || chapterEntry.commitId !== null) {
      throw new Error("当前长篇章卡不存在或已经有连续性记录。");
    }
    if (chapterEntry.bodyStatus !== "written") {
      throw new Error("只有正文已经完成的章节才能创建连续性记录。");
    }
    if (input.mode === "text_files") {
      return await commitTextFilesChapter(
        ctx,
        loaded,
        input,
        chapterEntry,
        existingPinnedChecks
      );
    }
    const usesTypedContinuity =
      input.factMutations.length > 0 ||
      input.knowledgeMutations.length > 0 ||
      input.openLoopMutations.length > 0 ||
      input.chapterOutputs.characterState.trim().length > 0 ||
      input.chapterOutputs.handoff.summary.trim().length > 0 ||
      Object.values(input.coverage).some(
        ({ status, note }) =>
          status !== "not_applicable" || note.trim().length > 0
      );
    const chapterFiles = await Promise.all(
      [
        chapterEntry.body,
        chapterEntry.characterState,
        chapterEntry.handoff
      ].map(async (reference) => await loadIndexedFile(loaded, reference.id))
    );
    const expectedChapterFileRevisions = [
      input.chapterFileRevisions.body,
      input.chapterFileRevisions.characterState,
      input.chapterFileRevisions.handoff
    ];
    for (const [index, chapterFile] of chapterFiles.entries()) {
      const expectedRevision = expectedChapterFileRevisions[index]!;
      if (
        !longRevisionsMatchContent(
          expectedRevision,
          chapterFile.disk.revision,
          chapterFile.disk.bytes
        )
      ) {
        throw new LongProjectConflictError(
          "file",
          expectedRevision,
          chapterFile.disk.revision
        );
      }
    }
    if (!chapterFiles[0]!.disk.content.trim()) {
      throw new Error("提交章节前必须完成章节正文。");
    }
    if (
      !usesTypedContinuity &&
      chapterFiles.slice(1).some(({ disk }) => !disk.content.trim())
    ) {
      throw new Error(
        "旧版连续性提交前必须完成正文、角色状态和下一章交接摘要三份文档。"
      );
    }
    const newlyPinnedChecks: ProjectTransactionFileOperation[] =
      chapterFiles.map((chapterFile) => ({
        action: "check",
        path: chapterFile.reference.path,
        expectedSha256: chapterFile.disk.sha256
      }));

    const placements = loaded.index.plot.narrativePlacements.filter(
      ({ chapterCardId }) => chapterCardId === input.chapterCardId
    );
    assertExactDecisionIds(
      "叙事落点",
      placements.map(({ id }) => id),
      Object.keys(input.placementDecisions)
    );
    const placementById = new Map(
      loaded.index.plot.narrativePlacements.map((placement) => [
        placement.id,
        placement
      ])
    );
    const beats = loaded.index.plot.foreshadowing.flatMap((thread) =>
      thread.beats.filter((beat) => {
        const placement =
          beat.placementId === null
            ? undefined
            : placementById.get(beat.placementId);
        return (
          (beat.chapterCardId ?? placement?.chapterCardId ?? null) ===
          input.chapterCardId
        );
      })
    );
    const foreshadowingIdByBeatId = new Map(
      loaded.index.plot.foreshadowing.flatMap((thread) =>
        thread.beats.map((beat) => [beat.id, thread.id] as const)
      )
    );
    assertExactDecisionIds(
      "伏笔节拍",
      beats.map(({ id }) => id),
      Object.keys(input.foreshadowingBeatDecisions)
    );
    for (const beat of beats) {
      const beatDecision = input.foreshadowingBeatDecisions[beat.id]!;
      if (beatDecision.status !== "committed" || beat.placementId === null) {
        continue;
      }
      const placement = placementById.get(beat.placementId);
      if (!placement) {
        throw new Error(`伏笔节拍 ${beat.id} 绑定的叙事落点不存在。`);
      }
      if (input.placementDecisions[placement.id]?.status !== "committed") {
        throw new Error(
          "已提交的伏笔节拍要求其绑定叙事落点也标记为 committed。"
        );
      }
      if (beat.eventId !== placement.eventId) {
        throw new Error("已提交的伏笔节拍与其绑定叙事落点必须引用同一事件。");
      }
    }
    if (usesTypedContinuity) {
      assertLongContinuityMutationAuthority(loaded.index, input);
    }

    const commitId = createId("commit");
    const timestamp = ctx.timestamp();
    const continuityUpdate = usesTypedContinuity
      ? materializeLongContinuityProjection({
          projection: loaded.index.ledger.projection,
          commitId,
          chapterCardId: input.chapterCardId,
          factMutations: input.factMutations,
          knowledgeMutations: input.knowledgeMutations,
          openLoopMutations: input.openLoopMutations,
          handoff: input.chapterOutputs.handoff
        })
      : {
          projection: loaded.index.ledger.projection,
          factChanges: [],
          knowledgeChanges: [],
          openLoopChanges: []
        };
    const placementChanges: LongLedgerCommitRecord["placementChanges"] =
      placements.map((placement) => {
        const decision = input.placementDecisions[placement.id]!;
        const change = {
          placementId: placement.id,
          before: {
            status: placement.status,
            commitId: placement.commitId
          },
          after: {
            status: decision.status,
            commitId
          },
          note: decision.note
        };
        placement.status = decision.status;
        placement.commitId = commitId;
        return change;
      });
    const foreshadowingBeatChanges: LongLedgerCommitRecord["foreshadowingBeatChanges"] =
      beats.map((beat) => {
        const decision = input.foreshadowingBeatDecisions[beat.id]!;
        const foreshadowingId = foreshadowingIdByBeatId.get(beat.id)!;
        const change = {
          foreshadowingId,
          beatId: beat.id,
          before: {
            status: beat.status,
            commitId: beat.commitId
          },
          after: {
            status: decision.status,
            commitId
          },
          note: decision.note
        };
        beat.status = decision.status;
        beat.commitId = commitId;
        return change;
      });
    const decidedBeatIds = new Set(beats.map(({ id }) => id));
    const foreshadowingThreadChanges: LongLedgerCommitRecord["foreshadowingThreadChanges"] =
      loaded.index.plot.foreshadowing
        .filter((thread) =>
          thread.beats.some((beat) => decidedBeatIds.has(beat.id))
        )
        .map((thread) => {
          const before = thread.status;
          const after = deriveLongForeshadowingStatus(thread);
          thread.status = after;
          return {
            foreshadowingId: thread.id,
            before,
            after
          };
        });

    const updateIds = input.fileUpdates.map(({ fileId }) => fileId);
    if (new Set(updateIds).size !== updateIds.length) {
      throw new Error("连续性提交不能重复更新同一文件。");
    }
    const chapterFileIds = new Set(
      loaded.index.chapters.flatMap((chapter) => [
        chapter.body.id,
        chapter.card.id,
        chapter.characterState.id,
        chapter.handoff.id,
        chapter.foreshadowingChanges.id,
        ...(chapter.worldReveals ? [chapter.worldReveals.id] : []),
        ...chapter.characterContinuity.flatMap((entry) => [
          entry.currentState.id,
          entry.history.id
        ])
      ])
    );
    const continuityFileRoles = new Map<
      string,
      {
        characterId: string;
        role: "relationships" | "current-state" | "history";
      }
    >();
    for (const entry of loaded.index.characterFiles) {
      continuityFileRoles.set(entry.relationships.id, {
        characterId: entry.characterId,
        role: "relationships"
      });
      continuityFileRoles.set(entry.currentState.id, {
        characterId: entry.characterId,
        role: "current-state"
      });
      continuityFileRoles.set(entry.history.id, {
        characterId: entry.characterId,
        role: "history"
      });
    }
    if (loaded.index.ledger.commits.length === 0) {
      const updatedFileIds = new Set(updateIds);
      for (const entry of loaded.index.characterFiles) {
        for (const reference of [
          entry.relationships,
          entry.currentState,
          entry.history
        ]) {
          if (updatedFileIds.has(reference.id)) continue;
          const file = await loadIndexedFile(loaded, reference.id);
          newlyPinnedChecks.push({
            action: "check",
            path: file.reference.path,
            expectedSha256: file.disk.sha256
          });
        }
      }
    }
    const fileChanges: LongLedgerCommitRecord["fileChanges"] = [];
    const fileOperations: Array<{
      path: string;
      content: string;
      expectedSha256: string | null;
    }> = [];
    const generatedChapterOutputs = usesTypedContinuity
      ? [
          {
            file: chapterFiles[1]!,
            content: input.chapterOutputs.characterState
          },
          {
            file: chapterFiles[2]!,
            content: serializeLongContinuityHandoff(
              input.chapterOutputs.handoff
            )
          }
        ]
      : [];
    for (const output of generatedChapterOutputs) {
      if (encodeUtf8Strict(output.content).byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error("账本生成的章节连续性文档超过 32 MiB 限制。");
      }
      const afterRevision = createLongFileRevision(output.content);
      fileChanges.push({
        fileId: output.file.reference.id,
        path: output.file.reference.path,
        mode: "replace",
        before: {
          revision: output.file.disk.revision,
          content: output.file.disk.content
        },
        after: {
          revision: afterRevision,
          content: output.content
        }
      });
      output.file.reference.revision = afterRevision;
      output.file.reference.updatedAt = timestamp;
      fileOperations.push({
        path: output.file.reference.path,
        content: output.content,
        expectedSha256: output.file.disk.sha256
      });
    }
    for (const update of input.fileUpdates) {
      const file = await loadIndexedFile(loaded, update.fileId);
      const continuityRole = continuityFileRoles.get(update.fileId);
      if (
        file.kind !== "markdown" ||
        chapterFileIds.has(update.fileId) ||
        !continuityRole
      ) {
        throw new Error(
          "连续性提交只能更新人物关系、人物当前状态或追加人物历史。"
        );
      }
      if (
        (continuityRole.role === "history" && update.mode !== "append") ||
        (continuityRole.role !== "history" && update.mode !== "replace")
      ) {
        throw new Error(
          continuityRole.role === "history"
            ? "人物历史只能由连续性账本追加，不能整体替换。"
            : "人物关系和当前状态必须提交完整替换内容。"
        );
      }
      if (update.content.trim().length === 0) {
        throw new Error("连续性资料更新不能是空内容。");
      }
      if (
        !longRevisionsMatchContent(
          update.baseRevision,
          file.disk.revision,
          file.disk.bytes
        )
      ) {
        throw new LongProjectConflictError(
          "file",
          update.baseRevision,
          file.disk.revision
        );
      }
      const afterContent =
        continuityRole.role === "history"
          ? appendLongCharacterHistoryEntry(file.disk.content, {
              chapterCardId: input.chapterCardId,
              commitId,
              committedAt: timestamp,
              content: update.content
            })
          : update.content;
      if (encodeUtf8Strict(afterContent).byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error("连续性资料更新后超过 32 MiB 限制。");
      }
      const afterRevision = createLongFileRevision(afterContent);
      fileChanges.push({
        fileId: file.reference.id,
        path: file.reference.path,
        mode: update.mode,
        before: {
          revision: file.disk.revision,
          content: file.disk.content
        },
        after: {
          revision: afterRevision,
          content: afterContent
        }
      });
      file.reference.revision = afterRevision;
      file.reference.updatedAt = timestamp;
      fileOperations.push({
        path: file.reference.path,
        content: afterContent,
        expectedSha256: file.disk.sha256
      });
    }

    const record = LongLedgerCommitRecordSchema.parse({
      schemaVersion: usesTypedContinuity ? 3 : 2,
      id: commitId,
      bookId: loaded.manifest.id,
      sequence: (loaded.index.ledger.commits.at(-1)?.sequence ?? 0) + 1,
      chapterCardId: input.chapterCardId,
      committedAt: timestamp,
      commitMessage: input.commitMessage,
      chapterSummary: input.chapterSummary,
      reversible: true,
      sourceWorkspaceRevision: loaded.index.revision,
      committedWorkspaceRevision: loaded.index.revision + 1,
      sourceProjectRevision: loaded.manifest.revision,
      committedProjectRevision: loaded.manifest.revision + 1,
      previousCommittedThroughChapterId:
        loaded.index.ledger.committedThroughChapterId,
      committedThroughChapterId: contiguousRecordedThrough(
        loaded.index,
        input.chapterCardId
      ),
      previousChapterCommitId: chapterEntry.commitId,
      placementChanges,
      foreshadowingBeatChanges,
      foreshadowingThreadChanges,
      fileChanges,
      coverage: input.coverage,
      factChanges: continuityUpdate.factChanges,
      knowledgeChanges: continuityUpdate.knowledgeChanges,
      openLoopChanges: continuityUpdate.openLoopChanges,
      chapterOutputs: input.chapterOutputs
    });
    const recordContent = serializeJson(record);
    if (encodeUtf8Strict(recordContent).byteLength > MAX_LEDGER_RECORD_BYTES) {
      throw new Error(
        "连续性账本记录超过 128 MiB；请缩短本章连续性资料更新后重试。"
      );
    }
    const recordReference: LongWorkspaceFileReference = {
      id: longLedgerCommitFileId(commitId),
      path: ledgerPath(commitId),
      revision: createLongFileRevision(recordContent),
      updatedAt: timestamp
    };
    chapterEntry.commitId = commitId;
    loaded.index.ledger.committedThroughChapterId =
      record.committedThroughChapterId;
    loaded.index.ledger.projection = continuityUpdate.projection;
    loaded.index.ledger.commits.push({
      id: commitId,
      mode: "structured",
      sequence: record.sequence,
      chapterCardId: input.chapterCardId,
      committedAt: timestamp,
      reversible: record.reversible,
      sourceRevision: loaded.index.revision,
      placementIds: placements.map(({ id }) => id),
      foreshadowingBeatIds: beats.map(({ id }) => id),
      recordFile: recordReference
    });

    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      revision: loaded.index.revision + 1,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      revision: loaded.manifest.revision + 1,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        revision: createLongFileRevision(indexContent),
        updatedAt: timestamp
      }
    });
    const integrityChecks = mergeIntegrityChecks(
      [...existingPinnedChecks, ...newlyPinnedChecks],
      new Set(fileOperations.map(({ path }) => path))
    );
    try {
      await commitLongProjectTransaction({
        projectRoot: loaded.projectDirectory,
        operations: [
          ...integrityChecks,
          ...fileOperations,
          {
            path: recordReference.path,
            content: recordContent,
            expectedSha256: null
          },
          {
            path: LONG_WORKSPACE_INDEX_PATH,
            content: indexContent,
            expectedSha256: loaded.indexDisk.sha256
          },
          {
            path: MANIFEST_PATH,
            content: serializeJson(nextManifest),
            expectedSha256: loaded.manifestDisk.sha256
          }
        ],
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
    } catch (error: unknown) {
      if (error instanceof ProjectTransactionConflictError) {
        throw new LongProjectConflictError(
          "transaction",
          error.expectedSha256 ?? "missing",
          error.actualSha256 ?? "missing"
        );
      }
      throw error;
    }
    const next = await loadProject(ctx, loaded.projectDirectory);
    return {
      record,
      workspaceRevision: next.index.revision,
      projectRevision: next.manifest.revision
    };
  });
}

export async function commitTextFilesChapter(
  ctx: LongProjectStoreContext,
  loaded: LoadedLongProject,
  input: LongTextFilesCommitChapterInput,
  chapterEntry: LongWorkspaceIndexSnapshot["chapters"][number],
  existingPinnedChecks: readonly ProjectTransactionFileOperation[]
): Promise<LongCommitChapterResult> {
  const body = await loadIndexedFile(loaded, chapterEntry.body.id);
  if (
    !longRevisionsMatchContent(
      input.chapterFileRevisions.body,
      body.disk.revision,
      body.disk.bytes
    )
  ) {
    throw new LongProjectConflictError(
      "file",
      input.chapterFileRevisions.body,
      body.disk.revision
    );
  }
  if (!body.disk.content.trim()) {
    throw new Error("提交章节前必须完成章节正文。");
  }

  const placements = loaded.index.plot.narrativePlacements.filter(
    ({ chapterCardId }) => chapterCardId === input.chapterCardId
  );
  const placementById = new Map(
    loaded.index.plot.narrativePlacements.map((placement) => [
      placement.id,
      placement
    ])
  );
  const beats = loaded.index.plot.foreshadowing.flatMap((thread) =>
    thread.beats.filter((beat) => {
      const placement =
        beat.placementId === null
          ? undefined
          : placementById.get(beat.placementId);
      return (
        (beat.chapterCardId ?? placement?.chapterCardId ?? null) ===
        input.chapterCardId
      );
    })
  );
  const foreshadowingIdByBeatId = new Map(
    loaded.index.plot.foreshadowing.flatMap((thread) =>
      thread.beats.map((beat) => [beat.id, thread.id] as const)
    )
  );
  assertExactDecisionIds(
    "伏笔触点",
    beats.map(({ id }) => id),
    Object.keys(input.foreshadowingBeatDecisions)
  );

  const continuityReferences = [
    chapterEntry.characterState,
    chapterEntry.handoff,
    ...(beats.length > 0 ? [chapterEntry.foreshadowingChanges] : []),
    ...(chapterEntry.worldReveals ? [chapterEntry.worldReveals] : []),
    ...chapterEntry.characterContinuity.flatMap((entry) => [
      entry.currentState,
      entry.history
    ])
  ];
  const expectedRevisionByFileId = new Map(
    input.continuityFileRevisions.map(({ fileId, revision }) => [
      fileId,
      revision
    ])
  );
  if (
    expectedRevisionByFileId.size !== continuityReferences.length ||
    continuityReferences.some(({ id }) => !expectedRevisionByFileId.has(id))
  ) {
    throw new Error(
      `连续性提交必须精确引用本章的章末状态、接续包${
        beats.length > 0 ? "、既有伏笔触点变化" : ""
      }以及已创建的世界观和人物记录文件。`
    );
  }
  const continuityFiles = await Promise.all(
    continuityReferences.map(
      async (reference) => await loadIndexedFile(loaded, reference.id)
    )
  );
  for (const file of continuityFiles) {
    const expectedRevision = expectedRevisionByFileId.get(file.reference.id)!;
    if (
      !longRevisionsMatchContent(
        expectedRevision,
        file.disk.revision,
        file.disk.bytes
      )
    ) {
      throw new LongProjectConflictError(
        "file",
        expectedRevision,
        file.disk.revision
      );
    }
    if (!file.disk.content.trim()) {
      throw new Error(`连续性文件尚未写入内容：${file.reference.path}`);
    }
  }

  const commitId = createId("commit");
  const timestamp = ctx.timestamp();
  // 叙事落点仍随章节归档；伏笔触点则必须由连续性智能体依据正文
  // 逐项给出 committed / missed 和证据，不能再按章节挂载关系自动判定。
  const placementChanges: LongLedgerCommitRecord["placementChanges"] =
    placements.map((placement) => {
      const change = {
        placementId: placement.id,
        before: {
          status: placement.status,
          commitId: placement.commitId
        },
        after: {
          status: "committed" as const,
          commitId
        },
        note: ""
      };
      placement.status = change.after.status;
      placement.commitId = commitId;
      return change;
    });
  const foreshadowingBeatChanges: LongLedgerCommitRecord["foreshadowingBeatChanges"] =
    beats.map((beat) => {
      const decision = input.foreshadowingBeatDecisions[beat.id]!;
      const foreshadowingId = foreshadowingIdByBeatId.get(beat.id)!;
      const change = {
        foreshadowingId,
        beatId: beat.id,
        before: {
          status: beat.status,
          commitId: beat.commitId
        },
        after: {
          status: decision.status,
          commitId
        },
        note: decision.note
      };
      beat.status = change.after.status;
      beat.commitId = commitId;
      return change;
    });
  const decidedBeatIds = new Set(beats.map(({ id }) => id));
  const foreshadowingThreadChanges: LongLedgerCommitRecord["foreshadowingThreadChanges"] =
    loaded.index.plot.foreshadowing
      .filter((thread) =>
        thread.beats.some((beat) => decidedBeatIds.has(beat.id))
      )
      .map((thread) => {
        const before = thread.status;
        const after = deriveLongForeshadowingStatus(thread);
        thread.status = after;
        return {
          foreshadowingId: thread.id,
          before,
          after
        };
      });
  const record = LongLedgerCommitRecordSchema.parse({
    schemaVersion: 4,
    id: commitId,
    bookId: loaded.manifest.id,
    sequence: (loaded.index.ledger.commits.at(-1)?.sequence ?? 0) + 1,
    chapterCardId: input.chapterCardId,
    committedAt: timestamp,
    commitMessage: input.commitMessage,
    reversible: true,
    sourceWorkspaceRevision: loaded.index.revision,
    committedWorkspaceRevision: loaded.index.revision + 1,
    sourceProjectRevision: loaded.manifest.revision,
    committedProjectRevision: loaded.manifest.revision + 1,
    previousCommittedThroughChapterId:
      loaded.index.ledger.committedThroughChapterId,
    committedThroughChapterId: contiguousRecordedThrough(
      loaded.index,
      input.chapterCardId
    ),
    previousChapterCommitId: chapterEntry.commitId,
    placementChanges,
    foreshadowingBeatChanges,
    foreshadowingThreadChanges,
    fileChanges: [],
    continuityFiles: continuityFiles.map((file) => ({
      fileId: file.reference.id,
      path: file.reference.path,
      revision: file.disk.revision
    }))
  });
  const recordContent = serializeJson(record);
  const recordReference: LongWorkspaceFileReference = {
    id: longLedgerCommitFileId(commitId),
    path: ledgerPath(commitId),
    revision: createLongFileRevision(recordContent),
    updatedAt: timestamp
  };

  chapterEntry.commitId = commitId;
  loaded.index.ledger.committedThroughChapterId =
    record.committedThroughChapterId;
  loaded.index.ledger.commits.push({
    id: commitId,
    mode: "text_files",
    sequence: record.sequence,
    chapterCardId: input.chapterCardId,
    committedAt: timestamp,
    reversible: true,
    sourceRevision: loaded.index.revision,
    placementIds: placements.map(({ id }) => id),
    foreshadowingBeatIds: beats.map(({ id }) => id),
    recordFile: recordReference
  });

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...loaded.index,
    revision: loaded.index.revision + 1,
    updatedAt: timestamp
  });
  const indexContent = serializeJson(nextIndex);
  const nextManifest = LongProjectManifestSchema.parse({
    ...loaded.manifest,
    revision: loaded.manifest.revision + 1,
    updatedAt: timestamp,
    workspaceIndexFile: {
      ...loaded.manifest.workspaceIndexFile,
      revision: createLongFileRevision(indexContent),
      updatedAt: timestamp
    }
  });
  const newlyPinnedChecks: ProjectTransactionFileOperation[] = [
    body,
    ...continuityFiles
  ].map((file) => ({
    action: "check",
    path: file.reference.path,
    expectedSha256: file.disk.sha256
  }));
  try {
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        ...mergeIntegrityChecks(
          [...existingPinnedChecks, ...newlyPinnedChecks],
          new Set([recordReference.path])
        ),
        {
          path: recordReference.path,
          content: recordContent,
          expectedSha256: null
        },
        {
          path: LONG_WORKSPACE_INDEX_PATH,
          content: indexContent,
          expectedSha256: loaded.indexDisk.sha256
        },
        {
          path: MANIFEST_PATH,
          content: serializeJson(nextManifest),
          expectedSha256: loaded.manifestDisk.sha256
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
  } catch (error: unknown) {
    if (error instanceof ProjectTransactionConflictError) {
      throw new LongProjectConflictError(
        "transaction",
        error.expectedSha256 ?? "missing",
        error.actualSha256 ?? "missing"
      );
    }
    throw error;
  }
  const next = await loadProject(ctx, loaded.projectDirectory);
  return {
    record,
    workspaceRevision: next.index.revision,
    projectRevision: next.manifest.revision
  };
}
