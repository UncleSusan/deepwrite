import { describe, expect, it } from "vitest";
import source from "./LongPlotStructureManager.vue?raw";

describe("LongPlotStructureManager", () => {
  it("covers every plot entity through proposal-only mutation builders", () => {
    for (const method of [
      "createStoryEvent",
      "updateStoryEvent",
      "reorderStoryEvent",
      "deleteStoryEvent",
      "createEventConnection",
      "updateEventConnection",
      "deleteEventConnection",
      "createNarrativePlacement",
      "updateNarrativePlacement",
      "reorderNarrativePlacement",
      "deleteNarrativePlacement",
      "createForeshadowing",
      "updateForeshadowing",
      "reorderForeshadowing",
      "deleteForeshadowing",
      "createForeshadowingBeat",
      "updateForeshadowingBeat",
      "reorderForeshadowingBeat",
      "deleteForeshadowingBeat"
    ]) {
      expect(source).toContain(`builder.${method}`);
    }
    expect(source).toContain(
      "build(createLongStructureMutationBuilder(props.snapshot))"
    );
    expect(source).not.toContain("window.deepwrite");
    expect(source).not.toContain("applyOperations");
    expect(source).not.toContain("previewOperations");
  });

  it("shows and edits imported fields, including machine story time", () => {
    for (const field of [
      "timeMode",
      "timeLabel",
      "timeValue",
      "location",
      "arcIds",
      "characterIds",
      "sourceEventId",
      "targetEventId",
      "connectionType",
      "eventId",
      "chapterCardId",
      "narrativeMode",
      "disclosure",
      "writingPrompt",
      "coreQuestion",
      "truthEventId",
      "expectedReaderEffect",
      "foreshadowingStatus",
      "threadId",
      "beatType",
      "placementId",
      "plannedScope",
      "executionStatus",
      "commitId"
    ]) {
      expect(source).toContain(`draft.${field}`);
    }
    expect(source).toContain("缺失引用");
    expect(source).toContain("uiMessage.warning");
    expect(source).toContain("由章节提交/回滚流程维护");
  });

  it("keeps reference choices reactive and uses themed shared controls", () => {
    expect(source).toContain("const eventOptions = computed");
    expect(source).toContain("const chapterOptions = computed");
    expect(source).toContain("const placementOptions = computed");
    expect(source).toContain("const threadOptions = computed");
    expect(source.match(/<PopupSelect/gu)?.length).toBeGreaterThanOrEqual(10);
    expect(source).not.toContain("<select");
    expect(source).toContain('type="checkbox"');
    expect(source).toContain('<Teleport to="body">');
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain("cascadeDelete");
    for (const token of [
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
      expect(source).toContain(`var(${token})`);
    }
    expect(source).toContain("@media (max-width: 42rem)");
  });

  it("locks a foreshadowing truth event once any beat is committed", () => {
    expect(source).toContain("const hasCommittedBeat = thread.beats.some(");
    expect(source).toContain(
      "if (hasCommittedBeat && thread.truthEventId)"
    );
    expect(source).toContain("ids.add(thread.truthEventId)");
    expect(source).toContain("editLocked: committedEventIds.value.has(event.id)");
    expect(source).toContain("deleteLocked: committedEventIds.value.has(event.id)");
  });
});
