import { describe, expect, it } from "vitest";
import appSource from "../App.vue?raw";
import source from "./RightEditorPane.vue?raw";

describe("RightEditorPane expert draft navigation", () => {
  it("shows automatic save status while preserving an immediate save action", () => {
    expect(source).toContain('autoSaveEnabled ? "等待自动保存"');
    expect(source).toContain('autoSaveEnabled ? "本机文稿 · 更改后自动保存"');
    expect(source).toContain('autoSaveEnabled ? "立即保存" : "应用"');
  });

  it("limits material and skill entries to 40,000 characters with a footer reminder", () => {
    expect(source).toContain("LIBRARY_AGENT_ENTRY_MAX_CHARACTERS");
    expect(source).toContain(':maxlength="contentMaxLength"');
    expect(source).toContain("每个条目最多 40,000 字，请勿上传过多内容");
    expect(source).toContain("contentExceedsLimit");
  });

  it("shows a live, non-blocking format reason after the binding badge for skill entries", () => {
    expect(source).toContain('import { parseSkillFrontmatter } from "../utils/skillFrontmatter"');
    expect(source).toContain('props.document.domain !== "skill" || !props.document.catalogEntryId');
    expect(source).toContain("parseSkillFrontmatter(content.value)");

    const bindingBadge = source.indexOf("仅浏览 · 未绑定");
    const formatBadge = source.indexOf('class="skill-format-error-badge"');
    expect(bindingBadge).toBeGreaterThan(-1);
    expect(formatBadge).toBeGreaterThan(bindingBadge);
    expect(source).toContain('v-if="skillFormatError"');
    expect(source).toContain(':title="skillFormatError"');
    expect(source).toContain(':aria-label="skillFormatError"');
    expect(source).not.toContain("!dirty || contentExceedsLimit || skillFormatError");
  });

  it("keeps library overview titles fixed while routing overview content to persistent saves", () => {
    expect(source).toContain('props.document.catalogLibraryField === "overview"');
    expect(source).toContain("document.draftFileKind === 'character-state' || isLibraryOverview");
    expect(source).toContain("CATALOG_LIBRARY_OVERVIEW_MAX_CHARACTERS");
    expect(appSource).toContain("async function saveCatalogLibraryOverview(");
    expect(appSource).toContain('catalogLibraryField !== "overview"');
    expect(appSource).toContain("overview: payload.content");
    expect(appSource).toContain("return saveCatalogLibraryOverview(document, payload");
  });

  it("renders independently managed section tabs before the active section editor", () => {
    const tabsStart = source.indexOf('class="section-tabs-bar"');
    const editorStart = source.indexOf('class="editor-document"', tabsStart);

    expect(tabsStart).toBeGreaterThan(-1);
    expect(source).toContain(':aria-label="resolvedSectionTabsLabel"');
    expect(source).toContain('props.sectionTabsLabel ?? `正文${draftUnitLabel.value}`');
    expect(source).toContain('props.document.workspaceType === "script" ? "剧集" : "小节"');
    expect(source).toContain("emit('selectSection', section.id)");
    expect(source).toContain('v-if="canCreateSection"');
    expect(source).toContain(':aria-label="resolvedCreateSectionLabel"');
    expect(source).toContain("emit('createSection')");
    expect(source).toContain('v-if="showDeleteSection"');
    expect(source).toContain('class="section-tabs-remove"');
    expect(source).toContain("emit('deleteSection')");
    expect(editorStart).toBeGreaterThan(tabsStart);
  });

  it("remembers the scroll position of every section instead of reusing the previous section position", () => {
    expect(source).toContain("editorScrollMemoryKey(props.document)");
    expect(source).toContain("rememberCurrentDocumentScroll(previousScrollMemoryKey)");
    expect(source).toContain('restoreDocumentScroll(nextScrollMemoryKey, "edit")');
    expect(source).toContain('@scroll="handleDocumentScroll"');
    expect(source).toContain("scroller.scrollTop = recalledEditorScrollPosition(key, view)");
  });

  it("routes the short-story tab add button through the existing sidebar creation flow", () => {
    expect(appSource).toContain("async function addExpertSectionFromEditor()");
    expect(appSource).toContain('directory.workspaceType !== "short"');
    expect(appSource).toContain("await addExpertSection(draftNode)");
    expect(appSource).toContain('@create-section="createEditorSection"');
    expect(appSource).toContain(
      'activeDocument.value.workspaceType === "short"'
    );
  });

  it("routes the short-story tab remove button through the existing sidebar deletion flow", () => {
    expect(appSource).toContain("const editorShowsExpertSectionTabs = computed");
    expect(appSource).toContain("const showEditorDeleteSection = computed");
    expect(appSource).toContain('return "删除当前小节"');
    expect(appSource).toContain("(directory?.sections.length ?? 0) > 1");
    expect(appSource).toContain("function removeExpertSectionFromEditor()");
    expect(appSource).toContain("requestRemoveExpertSection(sectionNode)");
    expect(appSource).toContain(':show-delete-section="showEditorDeleteSection"');
    expect(appSource).toContain('@delete-section="deleteEditorSection"');
  });

  it("reuses section tabs for list-style short character items with add and remove controls", () => {
    expect(appSource).toContain("const activeCharacterItemTabs = computed");
    expect(appSource).toContain('book.characterStructure.format !== "list"');
    expect(appSource).toContain('title: "概览"');
    expect(appSource).toContain('? "人物条目"');
    expect(appSource).toContain('? "新建人物条目"');
    expect(appSource).toContain('return "删除当前人物条目"');
    expect(appSource).toContain(':show-delete-section="showEditorDeleteSection"');
    expect(appSource).toContain("function addCharacterItemFromEditor()");
    expect(appSource).toContain("function deleteCharacterItemFromEditor()");
    expect(appSource).toContain('@delete-section="deleteEditorSection"');
  });

  it("offers one insert action only after right-clicking a selected editor range", () => {
    expect(source).toContain('aria-label="正文选区操作"');
    expect(source).toContain("插入输入框");
    expect(source.match(/role="menuitem"/g)).toHaveLength(1);
    expect(source).toContain('@contextmenu="handleEditorContextMenu"');
    expect(source).toContain("event.preventDefault()");
    expect(source).not.toContain('@mouseup="handleEditorMouseup"');
    expect(source).not.toContain('@keyup="handleEditorKeyup"');
    expect(source).toContain("emit(\"insertSelection\", reference)");
    expect(source).toContain("input.setSelectionRange(range.start, range.end, \"forward\")");
  });

  it("provides working text undo, redo, find, and replace controls", () => {
    expect(source).toContain('aria-label="撤销"');
    expect(source).toContain('aria-label="还原"');
    expect(source).toContain('aria-label="查找"');
    expect(source).toContain('aria-label="替换"');
    expect(source).toContain('@beforeinput="handleEditorBeforeInput"');
    expect(source).toContain('@keydown="handleEditorKeydown"');
    expect(source).toContain("recordUndoSnapshot()");
    expect(source).toContain("replaceCurrentMatch");
    expect(source).toContain("replaceAllMatches");
    expect(source).not.toContain('aria-label="粗体"');
    expect(source).not.toContain('aria-label="斜体"');
    expect(source).not.toContain('aria-label="引用"');
  });

  it("renders creation, skill, and material document previews through Markdown", () => {
    expect(source).toContain('import MarkdownContent from "./MarkdownContent.vue"');
    expect(source).toContain('<MarkdownContent v-if="content.trim()" :content="content" />');
    expect(source).not.toContain('v-for="(paragraph, index) in paragraphs"');
  });
});
