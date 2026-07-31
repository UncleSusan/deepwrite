import { describe, expect, it } from "vitest";
import source from "./LongWorkspaceEditor.vue?raw";

describe("LongWorkspaceEditor continuity integration", () => {
  it("renders the continuity workspace for ledger views without replacing record details", () => {
    expect(source).toContain(
      'import LongContinuityWorkspace from "./LongContinuityWorkspace.vue"'
    );
    expect(source).toContain(
      'props.selection?.root === "continuity_ledger"'
    );
    expect(source).toContain(
      'currentSelectionFile.value?.role !== "ledger-record"'
    );
    expect(source).toContain("<LongContinuityWorkspace");
    expect(source).toContain(":book-id=\"bookId\"");
    expect(source).toContain(":snapshot=\"workspaceIndex\"");
    expect(source).toContain(
      ":view=\"selection.continuityView ?? 'inbox'\""
    );
    expect(source).toContain(":evidence-content=\"currentVisibleContent\"");
    expect(source).toContain("currentContinuityWorkspaceChapterProps");

    const recordStart = source.indexOf(
      'class="long-ledger-record"'
    );
    expect(recordStart).toBeGreaterThan(-1);
    expect(source.slice(recordStart)).toContain(
      "currentLedgerRecord.placementChanges"
    );
    expect(source.slice(recordStart)).toContain(
      "currentLedgerRecord.foreshadowingBeatChanges"
    );
    expect(source.slice(recordStart)).toContain("查看原始审计记录");
  });

  it("keeps ledger projections out of character, world, plot, and foreshadowing editors", () => {
    expect(source).not.toContain(
      'import LongContinuityProjectionPanel from "./LongContinuityProjectionPanel.vue"'
    );
    expect(source).not.toContain("<LongContinuityProjectionPanel");
    expect(source).not.toContain("currentContinuityProjectionDomain");
    expect(source).not.toContain("currentContinuityProjectionSubjectProps");
    expect(source).not.toContain("long-continuity-projection-slot");
    expect(source).toContain("<LongForeshadowingWorkspace");
  });

  it("forwards commit navigation through one editor event", () => {
    expect(source).toContain("selectLedgerCommit: [commitId: string]");
    expect(
      source.match(/@select-commit="emit\('selectLedgerCommit', \$event\)"/gu)
    ).toHaveLength(1);
  });

  it("keeps continuity dashboards outside text editing and save controls", () => {
    expect(source).toContain("!currentIsContinuityWorkspace.value");
    expect(source).toContain('v-if="showGenericFileTabs"');
    expect(source).toContain(
      'v-if="!currentIsContinuityWorkspace" class="long-editor-footer"'
    );
    expect(source).toContain(".long-continuity-workspace-host");
    expect(source).not.toContain(".long-continuity-projection-slot");
  });
});
