import {
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  committedWorkspace,
  createBatch,
  describe,
  expect,
  expectOperationError,
  file,
  it,
  later,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterContinuityFilePath,
  longChapterWorldRevealsFileId,
  longLedgerCommitFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: crud-and-deletion", () => {
  it("defaults old projects to top tabs and updates per-book feature settings", () => {
    const source = workspace();
    expect(source.featureSettings.worldbuildingItemLayout).toBe("top-tabs");
    expect(source.featureSettings.characterAndContinuityItemLayout).toBe(
      "top-tabs"
    );
    expect(source.featureSettings.plotItemLayout).toBe("top-tabs");

    const result = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        baseRevision: source.revision,
        updatedAt: later,
        operations: [
          {
            type: "featureSettings.update",
            patch: {
              worldbuildingItemLayout: "left-tree",
              characterAndContinuityItemLayout: "left-tree",
              plotItemLayout: "left-tree"
            }
          }
        ]
      })
    );

    expect(result.snapshot.featureSettings.worldbuildingItemLayout).toBe(
      "left-tree"
    );
    expect(
      result.snapshot.featureSettings.characterAndContinuityItemLayout
    ).toBe("left-tree");
    expect(result.snapshot.featureSettings.plotItemLayout).toBe("left-tree");
    expect(result.fileIntents).toEqual([]);
    expect(result.documentWrites).toEqual([]);
  });

  it("applies typed cross-entity CRUD and returns only file/document intentions", () => {
    const source = workspace();
    const result = applyLongWorkspaceOperations(source, createBatch());

    expect(source.revision).toBe(7);
    expect(source.plot.volumes).toHaveLength(1);
    expect(result.resultRevision).toBe(8);
    expect(result.snapshot.plot.volumes.map(({ order }) => order)).toEqual([
      1, 2
    ]);
    expect(result.snapshot.plot.volumes[1]?.title).toBe("钟楼卷");
    expect(
      result.snapshot.plot.arcs.find(({ id }) => id === "arc_tower")?.order
    ).toBe(1);
    expect(
      result.snapshot.plot.chapterCards.find(({ id }) => id === "chapter_three")
        ?.narrativeOrder
    ).toBe(1);
    expect(
      result.snapshot.plot.narrativePlacements.find(
        ({ id }) => id === "placement_bell"
      )?.orderInChapter
    ).toBe(1);
    expect(
      result.fileIntents.filter(({ action }) => action === "create")
    ).toHaveLength(8);
    expect(result.documentWrites[0]?.content).toContain("魔法规则");
    expect(result.entityChanges).toHaveLength(
      result.impact.createdEntityIds.length +
        result.impact.updatedEntityIds.length +
        result.impact.deletedEntityIds.length
    );
    expect(
      result.entityChanges.find(({ id }) => id === "volume_two")
    ).toMatchObject({
      kind: "volume",
      action: "create",
      before: null,
      after: expect.objectContaining({ title: "钟楼卷", order: 2 })
    });
    expect(result.provisionalIdMap).toMatchObject({
      provisional_world: "world_magic",
      provisional_character: "character_bob",
      provisional_volume: "volume_two",
      provisional_chapter: "chapter_three",
      provisional_beat: "beat_bell_plant"
    });
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(result.snapshot).success
    ).toBe(true);

    const deletedConnection = applyLongWorkspaceOperations(
      result.snapshot,
      LongWorkspaceOperationBatchSchema.parse({
        baseRevision: 8,
        updatedAt: later,
        operations: [
          {
            type: "connection.delete",
            id: "connection_letter_enables_bell",
            cascade: false
          }
        ]
      })
    );
    expect(deletedConnection.snapshot.plot.eventConnections).toHaveLength(0);
    expect(deletedConnection.impact.deletedEntityIds).toContain(
      "connection_letter_enables_bell"
    );
  });

  it("adds an overview file to every newly-created list worldbuilding category", () => {
    const source = workspace();
    const result = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        baseRevision: source.revision,
        updatedAt: later,
        operations: [
          {
            type: "worldbuilding.create",
            category: {
              id: "world_geography",
              title: "地理",
              order: source.worldbuilding.length + 1,
              format: "list",
              contentAuthority: "files",
              items: []
            }
          }
        ]
      })
    );
    const category = result.snapshot.worldbuilding.find(
      ({ id }) => id === "world_geography"
    );
    expect(category).toMatchObject({
      format: "list",
      overview: {
        id: longWorldbuildingOverviewFileId("world_geography"),
        path: longWorldbuildingOverviewContentPath("world_geography")
      }
    });
    expect(result.fileIntents).toContainEqual(
      expect.objectContaining({
        action: "create",
        file: expect.objectContaining({
          id: longWorldbuildingOverviewFileId("world_geography")
        })
      })
    );
  });

  it("creates optional chapter continuity files and deletes them with the chapter", () => {
    const source = workspace();
    const currentState = file(
      longChapterCharacterCurrentStateFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "current-state.md"
      ),
      later
    );
    const history = file(
      longChapterCharacterHistoryFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "history.md"
      ),
      later
    );
    const worldReveals = file(
      longChapterWorldRevealsFileId("chapter_one"),
      longChapterContinuityFilePath("chapter_one", "world-reveals.md"),
      later
    );
    const created = applyLongWorkspaceOperations(source, {
      baseRevision: source.revision,
      updatedAt: later,
      operations: [
        {
          type: "chapterContinuity.worldReveals.create",
          chapterCardId: "chapter_one",
          file: worldReveals
        },
        {
          type: "chapterContinuity.character.create",
          chapterCardId: "chapter_one",
          characterId: "character_alice",
          currentState,
          history
        }
      ]
    });
    expect(created.fileIntents).toHaveLength(3);
    expect(created.snapshot.chapters[0]).toMatchObject({
      worldReveals: { id: worldReveals.id },
      characterContinuity: [
        {
          characterId: "character_alice",
          currentState: { id: currentState.id },
          history: { id: history.id }
        }
      ]
    });

    const characterDeleteBatch = {
      baseRevision: created.resultRevision,
      updatedAt: later,
      operations: [
        { type: "character.delete", id: "character_alice", cascade: true }
      ]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const characterDeletePreview = previewLongWorkspaceOperations(
      created.snapshot,
      characterDeleteBatch
    );
    const deletedCharacter = applyLongWorkspaceOperations(created.snapshot, {
      ...characterDeleteBatch,
      expectedImpact: characterDeletePreview.impact
    });
    expect(deletedCharacter.snapshot.chapters[0]!.characterContinuity).toEqual(
      []
    );
    expect(
      deletedCharacter.fileIntents.filter(
        ({ action, file }) =>
          action === "delete" &&
          (file.id === currentState.id || file.id === history.id)
      )
    ).toHaveLength(2);

    const deleted = applyLongWorkspaceOperations(created.snapshot, {
      baseRevision: created.resultRevision,
      updatedAt: later,
      operations: [
        { type: "chapter.delete", id: "chapter_one", cascade: false }
      ]
    });
    expect(
      deleted.fileIntents.filter(({ action }) => action === "delete")
    ).toHaveLength(8);
  });

  it("creates custom character types and migrates characters atomically on delete", () => {
    const source = workspace();
    const created = applyLongWorkspaceOperations(source, {
      baseRevision: source.revision,
      updatedAt: later,
      operations: [
        {
          type: "characterType.create",
          characterType: {
            id: "chartype_antagonist",
            title: "反派",
            order: source.characterTypes.length + 1
          }
        }
      ]
    });
    expect(created.snapshot.characterTypes.at(-1)).toEqual({
      id: "chartype_antagonist",
      title: "反派",
      order: 5
    });

    const originalFiles = structuredClone(created.snapshot.characterFiles);
    const migrated = applyLongWorkspaceOperations(created.snapshot, {
      baseRevision: created.resultRevision,
      updatedAt: later,
      operations: [
        {
          type: "characterType.delete",
          id: "protagonist",
          moveCharactersToTypeId: "chartype_antagonist"
        }
      ]
    });
    expect(
      migrated.snapshot.characterTypes.some(({ id }) => id === "protagonist")
    ).toBe(false);
    expect(migrated.snapshot.characters[0]).toMatchObject({
      id: "character_alice",
      group: "chartype_antagonist",
      order: 1
    });
    expect(migrated.snapshot.characterFiles).toEqual(originalFiles);

    expect(() =>
      applyLongWorkspaceOperations(created.snapshot, {
        baseRevision: created.resultRevision,
        updatedAt: later,
        operations: [{ type: "characterType.delete", id: "protagonist" }]
      })
    ).toThrow(/requires another target type/u);
  });

  it("deletes only optional continuity files from uncommitted chapters", () => {
    const source = workspace();
    const currentState = file(
      longChapterCharacterCurrentStateFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "current-state.md"
      ),
      later
    );
    const history = file(
      longChapterCharacterHistoryFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "history.md"
      ),
      later
    );
    const worldReveals = file(
      longChapterWorldRevealsFileId("chapter_one"),
      longChapterContinuityFilePath("chapter_one", "world-reveals.md"),
      later
    );
    const created = applyLongWorkspaceOperations(source, {
      baseRevision: source.revision,
      updatedAt: later,
      operations: [
        {
          type: "chapterContinuity.worldReveals.create",
          chapterCardId: "chapter_one",
          file: worldReveals
        },
        {
          type: "chapterContinuity.character.create",
          chapterCardId: "chapter_one",
          characterId: "character_alice",
          currentState,
          history
        }
      ]
    });

    const deleted = applyLongWorkspaceOperations(created.snapshot, {
      baseRevision: created.resultRevision,
      updatedAt: later,
      operations: [
        {
          type: "chapterContinuity.worldReveals.delete",
          chapterCardId: "chapter_one"
        },
        {
          type: "chapterContinuity.character.delete",
          chapterCardId: "chapter_one",
          characterId: "character_alice"
        }
      ]
    });
    expect(deleted.snapshot.chapters[0]).toMatchObject({
      worldReveals: null,
      characterContinuity: []
    });
    const deleteIntents = deleted.fileIntents.map(
      ({ action, file: target }) => [action, target.id]
    );
    expect(deleteIntents).toHaveLength(3);
    expect(deleteIntents).toEqual(
      expect.arrayContaining([
        ["delete", worldReveals.id],
        ["delete", currentState.id],
        ["delete", history.id]
      ])
    );

    const committed = structuredClone(created.snapshot);
    committed.chapters[0]!.commitId = "commit_existing";
    committed.ledger.committedThroughChapterId = "chapter_one";
    committed.ledger.commits.push({
      id: "commit_existing",
      mode: "text_files",
      sequence: 1,
      chapterCardId: "chapter_one",
      committedAt: later,
      reversible: true,
      sourceRevision: committed.revision,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile: file(
        longLedgerCommitFileId("commit_existing"),
        "long/ledger/commit-existing.json"
      )
    });
    for (const operation of [
      {
        type: "chapterContinuity.worldReveals.delete" as const,
        chapterCardId: "chapter_one"
      },
      {
        type: "chapterContinuity.character.delete" as const,
        chapterCardId: "chapter_one",
        characterId: "character_alice"
      }
    ]) {
      expect(() =>
        applyLongWorkspaceOperations(structuredClone(committed), {
          baseRevision: committed.revision,
          updatedAt: later,
          operations: [operation]
        })
      ).not.toThrow();
    }

    for (const forbiddenType of [
      "chapterContinuity.body.delete",
      "chapterContinuity.chapterEndState.delete",
      "chapterContinuity.handoff.delete",
      "chapterContinuity.foreshadowingChanges.delete"
    ]) {
      expect(
        LongWorkspaceOperationBatchSchema.safeParse({
          baseRevision: source.revision,
          updatedAt: later,
          operations: [{ type: forbiddenType, chapterCardId: "chapter_one" }]
        }).success
      ).toBe(false);
    }
  });

  it("rejects deleting referenced entities unless cascade is explicit", () => {
    const source = workspace();
    expectOperationError(
      () =>
        applyLongWorkspaceOperations(
          source,
          LongWorkspaceOperationBatchSchema.parse({
            baseRevision: source.revision,
            updatedAt: later,
            operations: [
              { type: "arc.delete", id: "arc_letter", cascade: false }
            ]
          })
        ),
      "cascade_required"
    );
    expectOperationError(
      () =>
        applyLongWorkspaceOperations(
          source,
          LongWorkspaceOperationBatchSchema.parse({
            baseRevision: source.revision,
            updatedAt: later,
            operations: [
              {
                type: "character.delete",
                id: "character_alice",
                cascade: false
              }
            ]
          })
        ),
      "cascade_required"
    );

    expectOperationError(
      () =>
        applyLongWorkspaceOperations(source, {
          baseRevision: source.revision,
          updatedAt: later,
          operations: [
            {
              type: "connection.create",
              connection: {
                id: "connection_missing_target",
                sourceEventId: "event_letter",
                targetEventId: "event_missing",
                type: "causes",
                note: ""
              }
            }
          ]
        }),
      "invalid_result"
    );
  });

  it("deletes a plot point without cascading through weakly linked chapters", () => {
    const source = workspace();
    source.plot.storyEvents = [];
    source.plot.storyPlots = [];
    source.plot.eventConnections = [];
    source.plot.narrativePlacements = [];
    source.plot.foreshadowing = [];

    const result = applyLongWorkspaceOperations(source, {
      baseRevision: source.revision,
      updatedAt: later,
      operations: [{ type: "arc.delete", id: "arc_letter", cascade: false }]
    });

    expect(result.snapshot.plot.arcs).toEqual([]);
    expect(result.snapshot.plot.chapterCards).toHaveLength(2);
    expect(
      result.snapshot.plot.chapterCards.every(
        ({ volumeId, primaryArcId }) =>
          volumeId === "volume_one" && primaryArcId === null
      )
    ).toBe(true);
    expect(result.snapshot.chapters).toHaveLength(2);
    expect(result.fileIntents).toEqual([]);

    const committed = committedWorkspace();
    committed.plot.storyEvents = [];
    const committedResult = applyLongWorkspaceOperations(committed, {
      baseRevision: committed.revision,
      updatedAt: later,
      operations: [{ type: "arc.delete", id: "arc_letter", cascade: false }]
    });
    expect(
      committedResult.snapshot.plot.chapterCards.find(
        ({ id }) => id === "chapter_one"
      )?.primaryArcId
    ).toBeNull();
    expect(committedResult.snapshot.chapters[0]!.commitId).toBe("commit_first");
  });
});
