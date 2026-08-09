import { describe, expect, it } from "vitest";
import appSource from "./App.vue?raw";

describe("project duplicate integration", () => {
  it("saves catalog drafts, calls the duplicate API and navigates to normal copies", () => {
    expect(appSource).toContain("prepareLibraryProjectsForDuplicate");
    expect(appSource).toContain("preparePlotStructureMutation(book.id)");
    expect(appSource).toContain("window.deepwrite.catalog.duplicateProject");
    expect(appSource).toContain('domain: "book"');
    expect(appSource).toContain('payload.action === "duplicate-group"');
    expect(appSource).toContain("duplicated.copiedMemberLibraryIds.length");
    expect(appSource).toContain("resolvePreferredBookResourceId");
  });

  it("blocks an active long writing plan, saves the editor and opens the copy", () => {
    expect(appSource).toContain('payload.action === "duplicate"');
    expect(appSource).toContain("await saveActiveLongEditorChanges()");
    expect(appSource).toContain("await api.duplicateBook({ bookId })");
    expect(appSource).toContain("node.longBookId === duplicated.book.id");
    expect(appSource).toContain("请先取消计划，再复制长篇");
  });
});
