import { describe, expect, it } from "vitest";
import source from "./LongForeshadowingWorkspace.vue?raw";
import filterBarSource from "./ForeshadowingFilterBar.vue?raw";
import editorDialogSource from "./ForeshadowingEditorDialog.vue?raw";
import deleteDialogSource from "./ForeshadowingDeleteDialog.vue?raw";
import filtersSource from "../composables/useForeshadowingFilters.ts?raw";
import mutationsSource from "../composables/useForeshadowingMutations.ts?raw";

const workspaceSource = [
  source,
  filterBarSource,
  editorDialogSource,
  deleteDialogSource,
  filtersSource,
  mutationsSource
].join("\n");

const dialogSources = [source, filterBarSource, editorDialogSource, deleteDialogSource].join(
  "\n"
);

describe("LongForeshadowingWorkspace", () => {
  it("projects one foreshadowing model into overview, volume, and plot-point views", () => {
    expect(workspaceSource).toContain(
      'type WorkspaceMode = "overview" | "volume" | "plotPoint"'
    );
    expect(workspaceSource).toContain("伏笔总览");
    expect(workspaceSource).toContain("本卷伏笔");
    expect(workspaceSource).toContain("伏笔触点");
    expect(workspaceSource).toContain("visibleThreads");
    expect(workspaceSource).toContain("activeThreadBeats");
  });

  it("automatically groups a volume without duplicating stored summaries", () => {
    for (const label of [
      "本卷新埋",
      "本卷推进",
      "本卷回收",
      "带往后卷"
    ]) {
      expect(workspaceSource).toContain(label);
    }
    for (const type of [
      "source",
      "plant",
      "reinforce",
      "misdirect",
      "partial_reveal",
      "reveal",
      "payoff"
    ]) {
      expect(workspaceSource).toContain(`"${type}"`);
    }
    expect(workspaceSource).toContain(
      'thread.status === "resolved" || thread.status === "abandoned"'
    );
    expect(workspaceSource).toContain("hasLaterVolumeBeat || isPlannedCrossVolume");
    expect(workspaceSource).toContain(
      'status !== "missed"'
    );
  });

  it("creates stable mutually exclusive volume or arc anchors for every touchpoint", () => {
    expect(workspaceSource).toContain("beat.arcId");
    expect(workspaceSource).toContain("beat.volumeId");
    expect(workspaceSource).toContain("arcId: props.plotPointId");
    expect(workspaceSource).toContain(
      "volumeId: beatDraft.arcId ? null : beatDraft.volumeId || null"
    );
    expect(workspaceSource).toContain("arcId: beatDraft.arcId || null");
    expect(workspaceSource).not.toContain("plotPointId: beatDraft");
    expect(workspaceSource).toContain("选择剧情点后，这里会自动清空。");
    expect(workspaceSource).toContain("精确到剧情点时只保存剧情点锚点。");
    expect(workspaceSource).toContain("const directArcId = beat.arcId ??");
    expect(workspaceSource).toContain(
      'const directVolumeId = directArcId ? "" : beat.volumeId ?? ""'
    );
    expect(workspaceSource).toContain(
      "arcById.value.get(arcId)?.volumeId === beat.volumeId"
    );
  });

  it("supports thread and touchpoint CRUD through the shared mutation builder", () => {
    for (const method of [
      "createForeshadowing",
      "updateForeshadowing",
      "deleteForeshadowing",
      "createForeshadowingBeat",
      "updateForeshadowingBeat",
      "deleteForeshadowingBeat"
    ]) {
      expect(workspaceSource).toContain(`builder.${method}`);
    }
    expect(workspaceSource).toContain("hiddenTruth");
    expect(workspaceSource).toContain("plannedSpan");
    expect(workspaceSource).toContain(
      "build(createLongStructureMutationBuilder(props.snapshot))"
    );
    expect(workspaceSource).toContain(
      "const targetThread = thread ?? activeThread.value ?? threads.value[0]"
    );
    expect(workspaceSource).toContain(
      'formMode.value === "create" ? ("planned" as const) : threadDraft.status'
    );
    expect(workspaceSource).toContain(`v-if="formMode === 'edit'"`);
  });

  it("keeps submitted surfaces locked until the real apply completion", () => {
    expect(workspaceSource).toContain("completion: LongStructureMutationCompletion");
    expect(workspaceSource).toContain("const pendingMutation = ref<");
    expect(workspaceSource).toContain(
      'succeed: () => finishMutation(requestId, "succeeded")'
    );
    expect(workspaceSource).toContain(
      'fail: () => finishMutation(requestId, "failed")'
    );
    expect(workspaceSource).toContain("appliedButRefreshFailed");
    expect(workspaceSource).toContain('if (outcome === "failed") return');
    expect(workspaceSource).toContain('}, "form")');
  });

  it("keeps committed core fields locked while exposing status-only abandon and restore actions", () => {
    expect(workspaceSource).toContain(
      "!canBackfillThreadMetadata(activeThread)"
    );
    expect(workspaceSource).toContain("补全伏笔信息");
    expect(workspaceSource).toContain(
      "originalThread.hiddenTruth === undefined"
    );
    expect(workspaceSource).toContain(
      "originalThread.plannedSpan === undefined"
    );
    expect(workspaceSource).toContain("editingCommittedThread");
    const toggleStart = workspaceSource.indexOf(
      "function toggleThreadAbandoned(thread: ForeshadowingThread)"
    );
    const toggleEnd = workspaceSource.indexOf(
      "function closeDelete()",
      toggleStart
    );
    const toggleImplementation = workspaceSource.slice(toggleStart, toggleEnd);
    expect(toggleStart).toBeGreaterThan(-1);
    expect(toggleImplementation).toContain(
      'status: thread.status === "abandoned" ? "planned" : "abandoned"'
    );
    expect(toggleImplementation).toContain('"background"');
    expect(workspaceSource).toContain("标记废弃");
    expect(workspaceSource).toContain("恢复伏笔线");
    expect(workspaceSource).toContain("更新状态中…");
  });

  it("uses themed popup controls, floating feedback, and accessible teleported dialogs", () => {
    expect(workspaceSource.match(/\srequired(?:\s|\/?>)/gu)).toHaveLength(1);
    expect(dialogSources.match(/<PopupSelect/gu)?.length).toBeGreaterThanOrEqual(8);
    expect(dialogSources).not.toContain("<select");
    expect(filtersSource).not.toContain("<select");
    expect(mutationsSource).not.toContain("<select");
    expect(workspaceSource).toContain("uiMessage.warning");
    expect(workspaceSource).toContain("uiMessage.info");
    expect(dialogSources.match(/<Teleport to="body">/gu)).toHaveLength(2);
    expect(workspaceSource).toContain('role="alertdialog"');
    expect(workspaceSource).toContain(
      'aria-describedby="foreshadow-delete-description"'
    );
    expect(workspaceSource).toContain("function focusOpenedForm()");
    expect(workspaceSource).toContain('ref="deleteCancelButton"');
    for (const token of [
      "--surface-main",
      "--surface-raised",
      "--surface-muted",
      "--surface-hover",
      "--surface-selected",
      "--theme-line",
      "--theme-line-soft",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--accent",
      "--accent-soft",
      "--neutral-solid"
    ]) {
      expect(workspaceSource).toContain(`var(${token})`);
    }
    expect(workspaceSource).toContain("@container (max-width: 38rem)");
    expect(workspaceSource).toContain("@container (max-width: 28rem)");
  });
});
