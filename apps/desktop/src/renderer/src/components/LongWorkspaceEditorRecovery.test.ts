import { describe, expect, it } from "vitest";
import recoverySource from "../composables/useLongEditorRecovery.ts?raw";
import sessionSource from "../composables/useLongEditorDocumentSession.ts?raw";
import historySource from "../composables/useLongEditorHistory.ts?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";

describe("long workspace editor crash recovery", () => {
  it("persists dirty long documents with a debounced write and an unload flush", () => {
    expect(recoverySource).toContain(
      'const RECOVERY_STORAGE_PREFIX = "deepwrite:long-editor-recovery:v1:"'
    );
    expect(recoverySource).toContain("bookId: state.bookId");
    expect(recoverySource).toContain("fileId: state.file.id");
    expect(recoverySource).toContain("content: state.content");
    expect(recoverySource).toContain("savedContent: state.savedContent");
    expect(recoverySource).toContain("baseRevision: state.file.revision");
    expect(recoverySource).toContain(
      "workspaceRevision: state.workspaceRevision"
    );
    expect(recoverySource).toContain("projectRevision: state.projectRevision");
    expect(recoverySource).toContain("timestamp: Date.now()");
    expect(historySource).toContain("options.scheduleRecoveryWrite(key)");
    expect(recoverySource).toContain("RECOVERY_WRITE_DEBOUNCE_MS");
    expect(recoverySource).toContain(
      "function flushAllRecoveryRecords(): void"
    );
    expect(recoverySource).toContain(
      "function handleBeforeUnload(event: BeforeUnloadEvent)"
    );
    expect(recoverySource).toMatch(
      /handleBeforeUnload[\s\S]*flushAllRecoveryRecords\(\)/
    );
    expect(recoverySource).toMatch(
      /onBeforeUnmount\(\(\) => \{[\s\S]*flushAllRecoveryRecords\(\)/
    );
  });

  it("isolates recovery keys by both book and file", () => {
    expect(recoverySource).toContain(
      "`${RECOVERY_STORAGE_PREFIX}${encodeURIComponent(bookId)}:${encodeURIComponent(fileId)}`"
    );
    expect(sessionSource).toContain('return `${bookId}\\u0000${fileId}`');
    expect(recoverySource).toContain("value.bookId !== expectedBookId");
    expect(recoverySource).toContain("value.fileId !== expectedFileId");
    expect(sessionSource).toContain(
      "options.readRecoveryRecord(bookId, firstPage.file.id)"
    );
  });

  it("automatically restores only a recovery based on the current disk revision", () => {
    expect(sessionSource).toContain(
      "recovery?.baseRevision === firstPage.file.revision"
    );
    expect(sessionSource).toContain(
      "recoveryMatchesDisk && recovery.content !== content"
    );
    expect(sessionSource).toContain("content: recoveredContent");
    expect(sessionSource).toContain("savedContent: content");
    expect(sessionSource).toContain("已恢复");
    expect(sessionSource).toContain("本机未保存内容");
  });

  it("keeps a stale recovery without replacing disk content and offers explicit reconciliation", () => {
    expect(sessionSource).toMatch(
      /else if \(recovery\) \{[\s\S]*staleRecoveryByKey\.value[\s\S]*磁盘内容未被覆盖/
    );
    expect(editorSource).toContain("发现旧版本恢复副本");
    expect(editorSource).toContain("复制副本");
    expect(editorSource).toContain("载入副本核对");
    expect(sessionSource).toContain(
      "磁盘文件尚未被修改"
    );
    expect(recoverySource).toContain(
      "baseRevision: state.file.revision"
    );
    expect(sessionSource).toContain(
      "baseWorkspaceRevision: state.workspaceRevision"
    );
    expect(sessionSource).toContain(
      "baseProjectRevision: state.projectRevision"
    );
  });

  it("clears a recovery after a successful clean save or a manual revert to disk", () => {
    expect(historySource).toMatch(
      /if \(content === state\.savedContent\) \{[\s\S]*clearRecoveryRecordForKey/
    );
    expect(sessionSource).toMatch(
      /const savedState = documentStates\.value\[key\][\s\S]*savedState\?\.content === savedState\?\.savedContent[\s\S]*clearRecoveryRecordForKey/
    );
    expect(recoverySource).toContain(
      "resolveRecoveryStorage()?.removeItem(recoveryStorageKey(bookId, fileId))"
    );
    expect(sessionSource).toMatch(
      /else if \(savedState\) \{[\s\S]*persistRecoveryForKey\(key\)/
    );
  });

  it("rejects corrupt, oversized, expired, future-dated, and non-editable recovery data safely", () => {
    expect(recoverySource).toContain(
      "raw.length > RECOVERY_MAX_RECORD_CHARACTERS"
    );
    expect(recoverySource).toContain("value.schemaVersion !== 1");
    expect(recoverySource).toContain(
      "now - value.timestamp > RECOVERY_MAX_AGE_MS"
    );
    expect(recoverySource).toContain(
      "value.timestamp > now + RECOVERY_CLOCK_SKEW_MS"
    );
    expect(recoverySource).toMatch(
      /const record = parseStoredRecovery[\s\S]*storage\.removeItem\(storageKey\)/
    );
    expect(recoverySource).toContain("isEditableLongFile(state.file)");
    expect(sessionSource).toContain("!selectedFile.readOnly");
    expect(sessionSource).toContain(
      "`locked` is a transient write barrier"
    );
    expect(sessionSource).not.toMatch(
      /const editable =[\s\S]{0,120}!props\.locked/
    );
    expect(recoverySource).toContain(
      "A disabled or unavailable localStorage must never break the editor"
    );
  });

  it("never exposes stale text as editable when a revision reload fails", () => {
    expect(sessionSource).toContain("const dirty =");
    expect(sessionSource).toContain("refreshingJustSavedDocument");
    expect(sessionSource).toContain(
      "loaded: dirty || refreshingJustSavedDocument"
    );
    expect(sessionSource).toContain(
      "`loading` still makes the textarea read-only"
    );
    expect(editorSource).toContain("state?.loading");
    expect(editorSource).toContain(':busy="isDocumentContentBusy"');
    expect(editorSource).toContain(
      ':readonly="currentReadOnly || isDocumentContentBusy"'
    );
    expect(sessionSource).toMatch(
      /catch \(error: unknown\)[\s\S]*loaded: false,[\s\S]*loadError: message/
    );
    expect(sessionSource).toContain(
      "never keep it editable after"
    );
    expect(editorSource).toContain("!state.loaded");
    expect(editorSource).toContain("重新读取");
    expect(editorSource).toContain("@click=\"loadSelectedDocument(true)\"");
  });

  it("does not report a leave-save as clean when typing continues during the write", () => {
    expect(sessionSource).toContain("const bookId = state.bookId");
    expect(sessionSource).toMatch(
      /const saved = await runExclusiveSave[\s\S]*return !Object\.entries\(documentStates\.value\)\.some/
    );
    expect(sessionSource).toContain(
      "workspaceRevision: Math.max("
    );
    expect(sessionSource).toContain("Never regress to the older read baseline");
    expect(sessionSource.match(/props\.bookId === bookId/gu)).toHaveLength(2);
    expect(sessionSource).toContain(
      "保存期间的新修改仍待保存"
    );
  });
});
