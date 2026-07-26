import { describe, expect, it } from "vitest";
import source from "./LongStructureManager.vue?raw";

describe("LongStructureManager", () => {
  it("stays an isolated operation-batch renderer boundary", () => {
    expect(source).toContain("batch: LongWorkspaceOperationBatch");
    expect(source).toContain("completion: LongStructureMutationCompletion");
    expect(source).toContain("createLongStructureMutationBuilder(props.snapshot)");
    expect(source).not.toContain("window.deepwrite");
    expect(source).not.toContain("applyOperations");
    expect(source).not.toContain("previewOperations");
    expect(source).not.toContain("<LongWorkspaceTree");
    expect(source).not.toContain("<select");
    expect(source).toContain("<LongPlotStructureManager");
    expect(source).toContain("@mutation=\"forwardPlotMutation\"");
    expect(source).toContain("手工修改会直接保存到本机");
    expect(source).toContain('formMode === "create"');
    expect(source).toContain('"保存修改"');
  });

  it("waits for durable completion and preserves form drafts on failure", () => {
    expect(source).toContain("const pendingMutation = ref<");
    expect(source).toContain(
      "() => props.disabled || pendingMutation.value !== null"
    );
    expect(source).toContain(
      'succeed: () => finishMutation(requestId, "succeeded")'
    );
    expect(source).toContain(
      'fail: () => finishMutation(requestId, "failed")'
    );
    expect(source).toContain("appliedButRefreshFailed");
    expect(source).toContain('if (outcome === "failed") return');
    expect(source).toContain('}, "form")');
    expect(source).toContain('}, "delete")');
    expect(source).not.toContain("if (succeeded) {\n    closeForm()");
    expect(source).not.toContain("if (succeeded) {\n    closeDelete()");
    expect(source).toContain(':disabled="mutationLocked"');
    expect(source).toContain(
      '<fieldset class="modal-body" :disabled="mutationLocked">'
    );
  });

  it("wires create, edit, move, reorder, and delete interactions to builders", () => {
    for (const method of [
      "createWorldbuilding",
      "createCharacter",
      "createVolume",
      "createArc",
      "createChapter",
      "updateWorldbuilding",
      "updateCharacter",
      "updateVolume",
      "updateArc",
      "updateChapter",
      "reorderWorldbuilding",
      "reorderCharacter",
      "reorderVolume",
      "reorderArc",
      "reorderChapter",
      "deleteWorldbuilding",
      "deleteCharacter",
      "deleteVolume",
      "deleteArc",
      "deleteChapter"
    ]) {
      expect(source).toContain(`builder.${method}`);
    }
    expect(source).toContain("cascadeDelete.value = false");
    expect(source).toContain("cascadeDelete.value");
    expect(source).toContain("@click=\"reorder(row, 'up')\"");
    expect(source).toContain("@click=\"openEdit(row)\"");
    expect(source).toContain("@click=\"openDelete(row)\"");
    expect(source).toContain(
      'activeSection.value === "chapter"\n      ? [...props.snapshot.plot.arcs].sort'
    );
  });

  it("locks structures referenced by committed event facts before emitting mutations", () => {
    expect(source).toContain("const committedEventIds = computed(");
    expect(source).toContain("placement.commitId !== null");
    expect(source).toContain("hasCommittedBeat && thread.truthEventId");
    expect(source).toContain("const committedCharacterIds = computed(");
    expect(source).toContain("const committedCharacterGroups = computed(");
    expect(source).toContain("event.characterIds.forEach((id) => ids.add(id))");
    expect(source).toContain("event.arcIds.forEach((id) => ids.add(id))");
    expect(source).toContain(
      "deleteLocked: committedCharacterIds.value.has(character.id)"
    );
    expect(source).toContain(
      "deleteLocked: committedVolumeIds.value.has(volume.id)"
    );
    expect(source).toContain(
      "reorderLocked: committedVolumeIds.value.size > 0"
    );
    expect(source).toContain(
      "deleteLocked: committedArcIds.value.has(arc.id)"
    );
    expect(source).not.toContain(
      "editLocked: committedArcIds.value.has(arc.id)"
    );
    expect(source).toContain("const arcVolumeLocked = computed(");
    expect(source).toContain(":disabled=\"arcVolumeLocked\"");
    expect(source).toContain(
      "已提交剧情弧可更新标题与提纲，但不能迁移到其他卷。"
    );
    expect(source).toContain(
      "reorderLocked: committedVolumeIds.value.has(arc.volumeId)"
    );
  });

  it("uses shared themed controls and teleported compact dialogs", () => {
    expect(source).toContain("<PopupSelect");
    expect(source.match(/<Teleport to="body">/gu)).toHaveLength(2);
    expect(source).toContain(":menu-z-index=\"2300\"");
    for (const themeToken of [
      "--surface-main",
      "--surface-raised",
      "--surface-muted",
      "--surface-hover",
      "--theme-line",
      "--theme-line-soft",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--accent",
      "--accent-soft",
      "--neutral-solid"
    ]) {
      expect(source).toContain(`var(${themeToken})`);
    }
    expect(source).toContain("font-size: 0.875rem");
    expect(source).toContain("@media (max-width: 42rem)");
    expect(source).toContain("uiMessage.warning");
    expect(source).toContain('@keydown.esc.stop="closeForm"');
    expect(source).toContain('@keydown.esc.stop="closeDelete"');
  });
});
