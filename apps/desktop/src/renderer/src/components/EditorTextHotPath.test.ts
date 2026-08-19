import { describe, expect, it } from "vitest";
import longHistorySource from "../composables/useLongEditorHistory.ts?raw";
import longEditorSource from "./LongWorkspaceEditor.vue?raw";
import rightEditorSource from "./RightEditorPane.vue?raw";

describe("editor text hot paths", () => {
  it("routes textarea edits through bounded incremental history", () => {
    expect(rightEditorSource).toContain("createBoundedTextHistory()");
    expect(rightEditorSource).toContain("textHistory.recordInput({");
    expect(rightEditorSource).toContain('@beforeinput="handleEditorBeforeInput"');
    expect(rightEditorSource).toContain('@input="handleEditorInput"');
    expect(rightEditorSource).not.toContain("recordUndoSnapshot");
    expect(rightEditorSource).not.toContain("HISTORY_LIMIT");
    expect(longHistorySource).toContain("createBoundedTextHistory()");
    expect(longHistorySource).toContain("textHistory.recordInput({");
    expect(longEditorSource).toContain('@beforeinput="handleEditorBeforeInput"');
    expect(longEditorSource).toContain('@input="handleEditorInput"');
    expect(longHistorySource).not.toContain("recordUndoSnapshot");
    expect(longHistorySource).not.toContain("HISTORY_LIMIT");
  });

  it("updates the character count from edit deltas instead of filtering the full text", () => {
    expect(rightEditorSource).toContain(
      "historyResult?.nonWhitespaceDelta"
    );
    expect(longHistorySource).toContain(
      "updateVisibleCharacterCount("
    );
    expect(rightEditorSource).not.toContain(
      'content.value.replace(/\\s/g, "").length'
    );
    expect(longHistorySource).not.toContain(
      'currentVisibleContent.value.replace(/\\s/gu, "").length'
    );
  });

  it("mutates only the active long-document text field while typing", () => {
    expect(longHistorySource).toContain("state.content = content;");
    expect(longHistorySource).not.toMatch(
      /replaceDocumentState\(key, \{\s*\.\.\.state,\s*content\s*\}\)/u
    );
    expect(longEditorSource).toContain(
      "plotPointSummaryDrafts.value[plotPoint.id] = current;"
    );
    expect(longEditorSource).toContain(
      "volumeOutlineDrafts.value[volume.id] = current;"
    );
  });
});
