import { describe, expect, it } from "vitest";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import documentSessionSource from "../composables/useLongEditorDocumentSession.ts?raw";
import historySource from "../composables/useLongEditorHistory.ts?raw";
import recoverySource from "../composables/useLongEditorRecovery.ts?raw";

const implementationSource = [
  editorSource,
  documentSessionSource,
  historySource,
  recoverySource
].join("\n");

describe("long workspace editor crash recovery", () => {
  it("persists dirty long documents with a debounced write and an unload flush", () => {
    expect(implementationSource).toContain(
      'const RECOVERY_STORAGE_PREFIX = "deepwrite:long-editor-recovery:v1:"'
    );
    expect(implementationSource).toContain("bookId: state.bookId");
    expect(implementationSource).toContain("fileId: state.file.id");
    expect(implementationSource).toContain("content: state.content");
    expect(implementationSource).toContain("savedContent: state.savedContent");
    expect(implementationSource).toContain("baseRevision: state.file.revision");
    expect(implementationSource).toContain(
      "workspaceRevision: state.workspaceRevision"
    );
    expect(implementationSource).toContain(
      "projectRevision: state.projectRevision"
    );
    expect(implementationSource).toContain("timestamp: Date.now()");
    expect(implementationSource).toContain(
      "options.scheduleRecoveryWrite(key)"
    );
    expect(implementationSource).toContain("RECOVERY_WRITE_DEBOUNCE_MS");
    expect(implementationSource).toContain(
      "function flushAllRecoveryRecords(): void"
    );
    expect(implementationSource).toContain(
      "function handleBeforeUnload(event: BeforeUnloadEvent)"
    );
    expect(implementationSource).toMatch(
      /handleBeforeUnload[\s\S]*flushAllRecoveryRecords\(\)/
    );
    expect(implementationSource).toMatch(
      /onBeforeUnmount\(\(\) => \{[\s\S]*flushAllRecoveryRecords\(\)/
    );
  });

  it("isolates recovery keys by both book and file", () => {
    expect(implementationSource).toContain(
      "`${RECOVERY_STORAGE_PREFIX}${encodeURIComponent(bookId)}:${encodeURIComponent(fileId)}`"
    );
    expect(implementationSource).toContain(
      "return `${bookId}\\u0000${fileId}`"
    );
    expect(implementationSource).toContain("value.bookId !== expectedBookId");
    expect(implementationSource).toContain("value.fileId !== expectedFileId");
    expect(implementationSource).toContain(
      "readRecoveryRecord(bookId, firstPage.file.id)"
    );
  });

  it("automatically restores only a recovery based on the current disk revision", () => {
    expect(implementationSource).toContain(
      "recovery?.baseRevision === firstPage.file.revision"
    );
    expect(implementationSource).toContain(
      "recoveryMatchesDisk && recovery.content !== content"
    );
    expect(implementationSource).toContain("content: recoveredContent");
    expect(implementationSource).toContain("savedContent: content");
    expect(implementationSource).toContain("已恢复");
    expect(implementationSource).toContain("本机未保存内容");
  });

  it("keeps a stale recovery without replacing disk content and offers explicit reconciliation", () => {
    expect(implementationSource).toMatch(
      /else if \(recovery\) \{[\s\S]*staleRecoveryByKey\.value[\s\S]*磁盘内容未被覆盖/
    );
    expect(implementationSource).toContain("发现旧版本恢复副本");
    expect(implementationSource).toContain("复制副本");
    expect(implementationSource).toContain("载入副本核对");
    expect(implementationSource).toContain("磁盘文件尚未被修改");
    expect(implementationSource).toContain("baseRevision: state.file.revision");
    expect(implementationSource).toContain(
      "baseWorkspaceRevision: state.workspaceRevision"
    );
    expect(implementationSource).toContain(
      "baseProjectRevision: state.projectRevision"
    );
  });

  it("clears a recovery after a successful clean save or a manual revert to disk", () => {
    expect(recoverySource).toContain(
      "if (state.content === state.savedContent)"
    );
    expect(recoverySource).toContain("clearRecoveryRecordForKey(");
    expect(implementationSource).toMatch(
      /const savedState = documentStates\.value\[key\][\s\S]*savedState\?\.content === savedState\?\.savedContent[\s\S]*clearRecoveryRecordForKey/
    );
    expect(implementationSource).toContain(
      "resolveRecoveryStorage()?.removeItem(recoveryStorageKey(bookId, fileId))"
    );
    expect(implementationSource).toMatch(
      /else if \(savedState\) \{[\s\S]*persistRecoveryForKey\(key\)/
    );
  });

  it("rejects corrupt, oversized, expired, future-dated, and non-editable recovery data safely", () => {
    expect(implementationSource).toContain(
      "raw.length > RECOVERY_MAX_RECORD_CHARACTERS"
    );
    expect(implementationSource).toContain("value.schemaVersion !== 1");
    expect(implementationSource).toContain(
      "now - value.timestamp > RECOVERY_MAX_AGE_MS"
    );
    expect(implementationSource).toContain(
      "value.timestamp > now + RECOVERY_CLOCK_SKEW_MS"
    );
    expect(implementationSource).toMatch(
      /const record = parseStoredRecovery[\s\S]*storage\.removeItem\(storageKey\)/
    );
    expect(implementationSource).toContain("isEditableLongFile(state.file)");
    expect(implementationSource).toContain("!selectedFile.readOnly");
    expect(implementationSource).toContain(
      "`locked` is a transient write barrier"
    );
    expect(implementationSource).not.toMatch(
      /const editable =[\s\S]{0,120}!props\.locked/
    );
    expect(implementationSource).toContain(
      "A disabled or unavailable localStorage must never break the editor"
    );
  });

  it("never exposes stale text as editable when a revision reload fails", () => {
    expect(implementationSource).toContain("const dirty =");
    expect(implementationSource).toContain("refreshingJustSavedDocument");
    expect(implementationSource).toContain(
      "loaded: dirty || refreshingJustSavedDocument"
    );
    expect(implementationSource).toContain(
      "`loading` still makes the textarea read-only"
    );
    expect(implementationSource).toContain("state?.loading");
    expect(implementationSource).toContain(':busy="isDocumentContentBusy"');
    expect(implementationSource).toContain(
      ':readonly="currentReadOnly || isDocumentContentBusy"'
    );
    expect(implementationSource).toMatch(
      /catch \(error: unknown\)[\s\S]*loaded: false,[\s\S]*loadError: message/
    );
    expect(implementationSource).toContain("never keep it editable after");
    expect(implementationSource).toContain("!state.loaded");
    expect(implementationSource).toContain("重新读取");
    expect(implementationSource).toContain(
      '@click="loadSelectedDocument(true)"'
    );
  });

  it("does not report a leave-save as clean when typing continues during the write", () => {
    expect(implementationSource).toContain("const bookId = state.bookId");
    expect(implementationSource).toMatch(
      /const saved = await runExclusiveSave[\s\S]*return\s*\(?\s*!Object\.entries\(documentStates\.value\)\.some/
    );
    expect(implementationSource).toContain("workspaceRevision: Math.max(");
    expect(implementationSource).toContain(
      "Never regress to the older read baseline"
    );
    expect(
      documentSessionSource.match(/props\.bookId === bookId/gu)
    ).toHaveLength(2);
    expect(implementationSource).toContain("保存期间的新修改仍待保存");
  });
});
