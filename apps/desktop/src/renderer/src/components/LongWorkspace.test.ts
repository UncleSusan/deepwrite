import { describe, expect, it } from "vitest";
import appSource from "../App.vue?raw";
import agentConversationSource from "./AgentConversation.vue?raw";
import bindingsSource from "./LongBookBindingsDialog.vue?raw";
import chapterCardDialogSource from "./CreateLongChapterCardDialog.vue?raw";
import characterDialogSource from "./CreateLongCharacterDialog.vue?raw";
import plotPointDialogSource from "./CreateLongPlotPointDialog.vue?raw";
import dialogSource from "./CreateBookDialog.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import foreshadowingSource from "./LongForeshadowingWorkspace.vue?raw";
import migrationReportSource from "./LongMigrationReportDialog.vue?raw";
import leftSidebarSource from "./LeftSidebar.vue?raw";
import proposalSource from "./LongProposalReview.vue?raw";
import removalSource from "./LongBookRemovalDialog.vue?raw";
import rollbackSource from "./LongRollbackDialog.vue?raw";
import sectionSource from "./TreeSection.vue?raw";
import structureSource from "./LongStructureManager.vue?raw";
import treeNodeSource from "./TreeNodeItem.vue?raw";
import longWorkspaceTypeSource from "../types/longWorkspace.ts?raw";
import workspaceTypeSource from "../types/workspace.ts?raw";
import writingOrchestratorSource from "../composables/useLongWritingOrchestrator.ts?raw";
import agentRunPreferencesSource from "../utils/agentRunPreferences.ts?raw";

describe("long-form renderer vertical slice", () => {
  it("keeps create-book loading feedback inside the stable action footer", () => {
    const actionsStart = dialogSource.indexOf(
      '<div class="dialog-actions create-short-book-actions">'
    );
    const statusStart = dialogSource.indexOf(
      'class="dialog-action-status"',
      actionsStart
    );
    const cancelStart = dialogSource.indexOf(
      'class="dialog-secondary-button"',
      actionsStart
    );

    expect(actionsStart).toBeGreaterThan(-1);
    expect(statusStart).toBeGreaterThan(actionsStart);
    expect(statusStart).toBeLessThan(cancelStart);
    expect(dialogSource).not.toContain(
      '<p v-if="loading" class="create-short-stable-hint"'
    );
  });

  it("projects one foreshadowing data source into overview, volume, and plot-point views", () => {
    expect(appSource).toContain('key: "plot-design:foreshadowing"');
    expect(appSource).toContain(
      "book.navigation.counts.foreshadowingThreads"
    );
    expect(longWorkspaceTypeSource).toContain(
      'selection.key === "plot-design:foreshadowing"'
    );
    expect(editorSource).toContain("<LongForeshadowingWorkspace");
    expect(editorSource).toContain("currentIsForeshadowingWorkspace");
    expect(editorSource).toContain("currentIsVolumeForeshadowing");
    expect(editorSource).toContain("currentIsPlotPointForeshadowing");
    expect(editorSource).toContain("本卷伏笔");
    expect(editorSource).toContain("伏笔触点");
    expect(editorSource).toContain(
      '@mutation="forwardForeshadowingMutation"'
    );
    expect(editorSource).toContain('if (tab === "foreshadowing")');
    expect(editorSource).toContain(
      "if (!props.locked && !(await saveAllChanges())) return;"
    );
    expect(editorSource).toContain(
      "if (currentIsPlotPointForeshadowing.value)"
    );
    expect(appSource).toContain('@mutation="handleLongStructureMutation"');
    expect(foreshadowingSource).toContain(
      "createLongStructureMutationBuilder"
    );
    expect(foreshadowingSource).toContain('"overview" | "volume" | "plotPoint"');
  });

  it("offers long-book creation in the unified themed creation dialog", () => {
    expect(sectionSource).toContain('"新建作品"');
    expect(sectionSource).not.toContain('id: "create-long-book"');
    expect(dialogSource).toContain('role="tablist"');
    expect(dialogSource).toContain('label: "长篇"');
    expect(dialogSource).toContain("<PopupSelect");
    expect(dialogSource).not.toContain("<select");
    expect(dialogSource).toContain("uiMessage.warning");
    expect(dialogSource).toContain("<Teleport to=\"body\">");
    expect(dialogSource).toContain("linkedMaterialIdsByKind");
    expect(dialogSource).toContain("linkedSkillIdsByKind");
    expect(dialogSource).toContain('workspaceType.value === "long"');
  });

  it("renders all five long-workspace roots from the navigation summary", () => {
    for (const root of [
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]) {
      expect(appSource).toContain(`${root}:`);
    }
    expect(appSource).toContain("book.navigation.counts");
    expect(appSource).toContain("index.ledger.commits");
    expect(longWorkspaceTypeSource).toContain(
      "isLongMigrationEvidenceCategoryId"
    );
    expect(longWorkspaceTypeSource).toContain("{ readOnly: true }");
    expect(longWorkspaceTypeSource).toContain('role: "body"');
    expect(longWorkspaceTypeSource).toContain('role: "character-state"');
    expect(longWorkspaceTypeSource).toContain('role: "handoff"');
  });

  it("groups characters into four permanent folders with tab-bar creation", () => {
    for (const [group, label] of [
      ["protagonist", "主角"],
      ["major_supporting", "主要配角"],
      ["minor_supporting", "次要配角"],
      ["passerby", "路人"]
    ]) {
      expect(longWorkspaceTypeSource).toContain(
        `{ value: "${group}", label: "${label}" }`
      );
    }
    expect(appSource).toContain(
      "const characterGroupChildren = LONG_CHARACTER_GROUP_OPTIONS.map"
    );
    expect(appSource).toContain('key: "character-overview"');
    expect(appSource).toContain("character.group === group.value");
    expect(appSource).toContain("longCharacterGroup: group.value");
    expect(appSource).toContain("label: options.label ?? selection.title");
    expect(appSource).toContain("label: group.label");
    const characterProjection = appSource.slice(
      appSource.indexOf(
        "const characterGroupChildren = LONG_CHARACTER_GROUP_OPTIONS.map"
      ),
      appSource.indexOf("const bookLineSelection")
    );
    expect(characterProjection).not.toContain(
      "key: `character:${character.id}`"
    );
    expect(characterProjection).not.toContain("children: characters");
    expect(treeNodeSource).not.toContain("createLongCharacter");
    expect(editorSource).toContain("currentIsCharacterGroup");
    expect(editorSource).toContain('aria-label="新增人物"');
    expect(editorSource).toContain('aria-label="删除当前人物"');
    expect(editorSource).toContain('aria-label="删除当前分卷"');
    expect(editorSource).toContain('aria-label="删除当前剧情点"');
    expect(editorSource).toContain('aria-label="删除当前章卡"');
    expect(editorSource).toContain('aria-label="删除当前世界观条目"');
    expect(editorSource).toContain('<AppIcon name="minus" :size="15" />');
    expect(editorSource).toContain('role="alertdialog"');
    expect(editorSource).toContain('emit(\n    "deleteStructure"');
    expect(appSource).toContain(
      '@delete-structure="deleteLongNavigationStructure"'
    );
    expect(appSource).toContain("builder.deleteCharacter(target.id, true)");
    expect(appSource).toContain("builder.deleteVolume(target.id, true)");
    expect(appSource).toContain("builder.deleteArc(target.id, true)");
    expect(appSource).toContain("builder.deleteChapter(target.id, true)");
    expect(editorSource).toContain("emit('createCharacter')");
    expect(editorSource).toContain("currentEmptyCollection");
    expect(editorSource).toContain("还没有${selection.title}");
    expect(editorSource).toContain("新建第一个人物");
    expect(editorSource).toContain("新建第一个剧情点");
    expect(editorSource).toContain("新建第一张章卡");
    expect(editorSource).toContain("@click=\"createFirstCollectionItem\"");
    expect(appSource).toContain(
      '@create-character="openLongCharacterCreate"'
    );
    expect(appSource).toContain('plot_design: "剧情设计"');
    expect(appSource).toContain('key: "root:plot-points"');
    expect(appSource).toContain(
      "const plotPointVolumeChildren: ResourceTreeNode[]"
    );
    expect(appSource).toContain(
      "key: `plot-design:plot-points:${volume.id}`"
    );
    expect(appSource).toContain("label: volume.title");
    expect(appSource).toContain('title: "剧情点"');
    expect(appSource).toContain('title: "章卡"');
    expect(appSource).toContain('label: "正文"');
    const chapterCardProjection = appSource.slice(
      appSource.indexOf(
        "const chapterCardManagementChildren: ResourceTreeNode[]"
      ),
      appSource.indexOf("const plotChildren: ResourceTreeNode[]")
    );
    expect(chapterCardProjection).toContain(
      "key: `plot-design:chapter-cards:${volume.id}`"
    );
    expect(chapterCardProjection).toContain("chapterCardTabs:");
    expect(chapterCardProjection).not.toContain(
      "root:chapter-card-management:"
    );
    expect(chapterCardProjection).not.toContain("children: chapters");
    const plotChildrenProjection = appSource.slice(
      appSource.indexOf("const plotChildren: ResourceTreeNode[]"),
      appSource.indexOf("const draftChildren")
    );
    const plotPointsPosition = plotChildrenProjection.indexOf(
      'key: "root:plot-points"'
    );
    const foreshadowingPosition = plotChildrenProjection.indexOf(
      "node(foreshadowingSelection"
    );
    expect(plotPointsPosition).toBeGreaterThan(-1);
    expect(foreshadowingPosition).toBeGreaterThan(-1);
    expect(plotPointsPosition).toBeLessThan(foreshadowingPosition);
    expect(plotChildrenProjection).not.toContain('key: "root:plot-volumes"');
    expect(plotChildrenProjection).not.toContain(
      'key: `root:plot-arc:${arc.id}`'
    );
    expect(
      plotChildrenProjection.indexOf('key: "root:plot-points"')
    ).toBeLessThan(
      plotChildrenProjection.indexOf('key: "root:plot-chapter-cards"')
    );
    const longRootProjection = appSource.slice(
      appSource.indexOf("const counts = book.navigation.counts;"),
      appSource.indexOf("const longBookResourceNodes")
    );
    expect(
      longRootProjection.match(/node\(createLongRootSelection/gu)
    ).toHaveLength(5);
    expect(longRootProjection).not.toContain('title: "章卡"');
    expect(editorSource).toContain("全书总纲");
    expect(editorSource).toContain("orderedBookLineVolumes");
    expect(editorSource).toContain("currentIsPlotPointWorkspace");
    expect(editorSource).toContain("selection.plotPointTabs");
    expect(editorSource).toContain("emit('selectPlotPoint', plotPoint.id)");
    expect(editorSource).toContain("currentIsChapterCardWorkspace");
    expect(editorSource).toContain("selection.chapterCardTabs");
    expect(editorSource).toContain(
      "emit('selectChapterCard', chapterCard.id)"
    );
    expect(appSource).toContain(
      '@select-chapter-card="selectLongChapterCardTab"'
    );
    expect(editorSource).toContain("概要");
    expect(editorSource).toContain("故事情节");
    expect(editorSource).toContain("selection.plotPointId === plotPoint.id");
    expect(editorSource).toContain('aria-label="新建分卷"');
    expect(editorSource).toContain('emit("createVolume")');
    expect(editorSource).toContain('"saveVolumeOutline"');
    expect(appSource).toContain('@create-volume="openLongVolumeCreate"');
    expect(appSource).toContain(
      '@save-volume-outline="saveLongVolumeOutline"'
    );
    expect(editorSource).toContain('"savePlotPointContent"');
    expect(appSource).toContain(
      '@save-plot-point-content="saveLongPlotPointContent"'
    );
    expect(editorSource).toContain("章卡内容");
    expect(editorSource).not.toContain("activeChapterCardTab");
    expect(editorSource).not.toContain(">\n            章节大纲\n");
    expect(editorSource).not.toContain(">\n            世界约束\n");
    expect(editorSource).toContain("currentIsChapterCardContent");
    expect(editorSource).toContain("saveDocumentState(stateKey(selectedFile.file.id)");
    expect(appSource).toContain(
      "createLongStructureMutationBuilder(index).createChapter"
    );
    expect(appSource).not.toContain('worldConstraints: ""');
    expect(appSource).toContain("<CreateLongVolumeDialog");
    expect(appSource).toContain("@submit=\"createLongVolume\"");
    expect(appSource).toContain("<CreateLongPlotPointDialog");
    expect(appSource).toContain("@submit=\"createLongPlotPoint\"");
    expect(appSource).toContain("<CreateLongChapterCardDialog");
    expect(appSource).toContain("@submit=\"createLongChapterCard\"");
    expect(chapterCardDialogSource).toContain("新建章卡");
    expect(chapterCardDialogSource).toContain("补充完整内容");
    expect(chapterCardDialogSource).not.toContain("章节大纲和世界约束");
    expect(chapterCardDialogSource).not.toContain("LongStructureManager");
    expect(plotPointDialogSource).toContain("新建剧情点");
    expect(plotPointDialogSource).not.toContain("LongStructureManager");
    const createVolumeEntry = appSource.slice(
      appSource.indexOf("async function openLongVolumeCreate"),
      appSource.indexOf("async function openLongPlotPointCreate")
    );
    expect(createVolumeEntry).toContain("longVolumeCreateOpen.value = true");
    expect(createVolumeEntry).not.toContain(
      "longStructureDialogOpen.value = true"
    );
    const createPlotPointEntry = appSource.slice(
      appSource.indexOf("async function openLongPlotPointCreateForVolume"),
      appSource.indexOf("async function saveLongVolumeOutline")
    );
    expect(createPlotPointEntry).toContain(
      "longPlotPointCreate.value = {"
    );
    expect(createPlotPointEntry).not.toContain(
      "longStructureDialogOpen.value = true"
    );
    const createChapterCardEntry = appSource.slice(
      appSource.indexOf("async function openLongChapterCardCreate"),
      appSource.indexOf("async function renameLongCharacter")
    );
    expect(createChapterCardEntry).toContain(
      "longChapterCardCreate.value = {"
    );
    expect(createChapterCardEntry).not.toContain(
      "longStructureDialogOpen.value = true"
    );
    expect(appSource).not.toContain("openLongStructureTreeAction");
    expect(appSource).not.toContain("longStructureSection");
    expect(appSource).not.toContain(":initial-section=");
    expect(appSource).not.toContain(":initial-action=");
    expect(appSource).not.toContain(":initial-item-id=");
    expect(appSource).toContain(
      "createLongStructureMutationBuilder(index).createCharacter"
    );
    expect(appSource).toContain(
      '@select-character="selectLongCharacterTab"'
    );
    expect(editorSource).toContain('v-if="currentIsCharacterGroup"');
    expect(editorSource).toContain(
      '@click="requestSelectCharacter(character.id)"'
    );
    expect(editorSource).toContain(
      "selection.characterId === character.id"
    );
    expect(editorSource).toContain(
      "'is-loading': pendingCharacterId === character.id"
    );
    expect(editorSource).toContain(
      "selection.key.startsWith('character-group:')"
    );
    expect(editorSource).toContain("selection.description ??");
    expect(editorSource).toContain(
      "'has-navigation-tabs':\n        currentIsCharacterGroup ||"
    );
    expect(editorSource).not.toContain(
      "Boolean(selection?.characterTabs?.length) ||"
    );
    expect(characterDialogSource).toContain("新增人物");
    expect(characterDialogSource).toContain(
      "核心档案、人物关系、当前状态和历史轨迹"
    );
    expect(characterDialogSource).toContain("<Teleport to=\"body\">");
    expect(characterDialogSource).toContain("uiMessage.warning");
  });

  it("edits and persists a character name directly from the document title", () => {
    expect(editorSource).toContain('v-else-if="currentIsCharacterDocument"');
    expect(editorSource).toContain('v-model="characterNameDraft"');
    expect(editorSource).toContain('aria-label="人物姓名"');
    expect(editorSource).toContain('@change="saveCharacterName"');
    expect(editorSource).toContain(
      '@keydown="handleCharacterNameKeydown"'
    );
    expect(editorSource).toContain(
      'emit("renameCharacter", { characterId, name }'
    );
    expect(appSource).toContain(
      '@rename-character="renameLongCharacter"'
    );
    expect(appSource).toContain(
      "createLongStructureMutationBuilder(index).updateCharacter"
    );
  });

  it("edits and persists long-form structure titles from the document title", () => {
    expect(editorSource).toContain("currentStructureTitleTarget");
    expect(editorSource).toContain('inputLabel: "剧情点标题"');
    expect(editorSource).toContain('inputLabel: "分卷名称"');
    expect(editorSource).toContain('inputLabel: "章卡标题"');
    expect(editorSource).toContain('inputLabel: "世界观分类名称"');
    expect(editorSource).toContain('v-model="structureTitleDraft"');
    expect(editorSource).toContain('@change="saveStructureTitle"');
    expect(editorSource).toContain(
      '@keydown="handleStructureTitleKeydown"'
    );
    expect(editorSource).toContain(
      'emit(\n    "renameStructureTitle"'
    );
    expect(appSource).toContain(
      '@rename-structure-title="renameLongStructureTitle"'
    );
    expect(appSource).toContain(
      "createLongStructureMutationBuilder(index)"
    );
    expect(appSource).toContain(
      "builder.updateWorldbuilding(category.id, { title })"
    );
    expect(appSource).toContain(
      "builder.updateVolume(volume.id, { title })"
    );
    expect(appSource).toContain(
      "builder.updateArc(plotPoint.id, { title })"
    );
    expect(appSource).toContain(
      "builder.updateChapter(chapter.id, { title })"
    );
    expect(editorSource).toContain(
      'chapterCardId === target.id && commitId !== null'
    );
  });

  it("lazy-loads selected files and saves Markdown with all CAS revisions", () => {
    expect(editorSource).toContain("api.readDocument({");
    expect(editorSource).toContain("api.writeDocument({");
    expect(editorSource).toContain("baseRevision: state.file.revision");
    expect(editorSource).toContain(
      "baseWorkspaceRevision: state.workspaceRevision"
    );
    expect(editorSource).toContain(
      "baseProjectRevision: state.projectRevision"
    );
    expect(editorSource).toContain("currentReadOnly");
    expect(longWorkspaceTypeSource).toContain('label: "正文"');
    expect(longWorkspaceTypeSource).toContain('label: "章末状态"');
    expect(longWorkspaceTypeSource).toContain('label: "下一章接续包"');
    expect(editorSource).toContain("async function saveAllChanges()");
    expect(editorSource).toContain("离开前已自动保存");
    expect(appSource).toContain("saveActiveLongEditorBeforeLeaving");
    expect(appSource).toContain('ref="longWorkspaceEditor"');
  });

  it("loads only the selected character document and avoids unbounded sibling prefetches", () => {
    expect(editorSource).not.toContain("prefetchCharacterDocuments");
    expect(editorSource).not.toContain(
      "void loadWorkspaceDocument(file, false, true)"
    );
    expect(editorSource).toContain("async function loadSelectedDocument");
    expect(editorSource).toContain("await loadWorkspaceDocument(selectedFile, force)");
    expect(editorSource).toContain(
      "async function prefetchActiveSelectionFiles"
    );
    expect(editorSource).toContain(
      "Avoid unbounded sibling character"
    );
    expect(editorSource).toContain(
      "async function ensureDocumentsLoaded"
    );
    expect(editorSource).toContain(
      "async function selectRole(role: LongWorkspaceFileRole)"
    );
    expect(appSource).toContain(
      "await longWorkspaceEditor.value?.ensureDocumentsLoaded([preferredFile])"
    );
    expect(appSource).toContain(
      "activeLongSelection.value?.chapterCardId !== selection.chapterCardId"
    );
  });

  it("reconciles structural drafts from the workspace revision without a deep synchronous watcher", () => {
    expect(editorSource).toContain("props.workspaceIndex?.revision");
    expect(editorSource).toContain('flush: "post"');
    expect(editorSource).not.toContain(
      'props.workspaceIndex?.plot.volumes,\n      props.workspaceIndex?.plot.arcs'
    );
    expect(editorSource).not.toContain('{ immediate: true, deep: true, flush: "sync" }');
  });

  it("renders list worldbuilding as tabs and text worldbuilding as a direct textarea", () => {
    expect(editorSource).toContain(
      'selection.files.find(({ role }) => role === "overview")'
    );
    expect(editorSource).toContain('@click="selectWorldbuildingOverview"');
    expect(editorSource).toContain(
      'type: "worldbuildingItem.create"'
    );
    expect(editorSource).toContain('class="section-tabs-bar long-worldbuilding-tabs"');
    expect(editorSource).toContain('aria-label="世界观条目"');
    expect(editorSource).toContain(
      "!currentIsWorldbuildingList.value"
    );
    expect(editorSource).toContain(
      'v-if="showGenericFileTabs"'
    );
    expect(editorSource).toContain(
      "currentState.value?.content"
    );
    expect(editorSource).toContain('class="long-document-editor"');
    expect(editorSource).not.toContain('"文本 · CAS 保存"');
    expect(longWorkspaceTypeSource).toContain(
      "worldbuildingFormat?: LongWorldbuildingFormat"
    );
  });

  it("loads a list worldbuilding item before activating its tab", () => {
    expect(editorSource).toContain(
      "async function selectWorldbuildingItem(itemId: string)"
    );
    expect(editorSource).toContain(
      "await loadWorkspaceDocument(selectedFile)"
    );
    expect(editorSource).toContain(
      "activeWorldbuildingItemId.value = itemId"
    );
    expect(editorSource).toContain(
      "'is-loading': pendingWorldbuildingItemId === item.id"
    );
    expect(editorSource).toContain(
      "'is-loading': pendingWorldbuildingOverview"
    );
    expect(editorSource).toContain("void selectWorldbuildingItem(item.id)");
    expect(editorSource).toContain("void selectWorldbuildingItem(nextId)");
  });

  it("keeps the long editor surface stable while documents refresh or switch", () => {
    expect(editorSource).toContain("const showEditorLoading = computed");
    expect(editorSource).toContain(
      "state?.loading && !state.loaded && !state.content"
    );
    expect(editorSource).toContain("const isDocumentSwitchPending = computed");
    expect(editorSource).toContain("heldSelectionFile");
    expect(editorSource).toContain(
      "async function prefetchWorldbuildingSelectionFiles"
    );
    expect(editorSource).toContain("inflightDocumentLoads");
    expect(editorSource).toContain("v-else-if=\"showEditorLoading\"");
    expect(editorSource).toContain(
      "currentReadOnly || isDocumentContentBusy"
    );
  });

  it("uses the shared writing-editor layout without exposing internal revisions", () => {
    expect(editorSource).toContain('class="long-editor-breadcrumbs"');
    expect(editorSource).toContain('class="long-editor-file-tabs"');
    expect(editorSource).toContain('class="long-editor-view-tabs"');
    expect(editorSource).toContain('class="long-document-title"');
    expect(editorSource).toContain('class="long-editor-footer"');
    expect(editorSource).toContain("已保存到本机");
    expect(editorSource).toContain("立即保存");
    expect(editorSource).not.toContain("currentState.file.revision");
  });

  it("refreshes clean long-editor CAS baselines on window focus without touching dirty drafts", () => {
    expect(editorSource).toContain(
      "function synchronizeProjectRevisionsIfClean("
    );
    expect(editorSource).toContain("if (bookId !== props.bookId) return true");
    expect(editorSource).toContain("key.startsWith(prefix)");
    expect(editorSource).toContain(
      "state.loaded && state.content !== state.savedContent"
    );
    expect(editorSource).toContain(
      "synchronizeProjectRevisionsIfClean"
    );
    expect(appSource).toContain(
      "async function refreshLongWorkspaceOnWindowFocus("
    );
    expect(appSource).toContain(
      "longWorkspaceEditor.value?.synchronizeProjectRevisionsIfClean("
    );
    expect(appSource).toContain("当前有未保存内容");
  });

  it("mounts the long workspace without routing it through short/script state", () => {
    expect(appSource).toContain('catalogNodeType: "long-book"');
    expect(appSource).not.toContain("<LongWorkspaceTree");
    expect(appSource).toContain("<LongWorkspaceEditor");
    expect(appSource).toContain("isLongWorkspaceActive");
    expect(appSource).toContain("!isLongWorkspaceActive");
    const shortEditorMountSource =
      appSource.split("<RightEditorPane")[1]?.split("/>")[0] ?? "";
    expect(shortEditorMountSource).toContain("!isLongWorkspaceActive");
    expect(appSource).toContain("<CreateBookDialog");
    expect(appSource).toContain("async function createCreativeBook(");
    expect(appSource).toContain(
      'input.workspaceType === "script"'
    );
    expect(workspaceTypeSource).toContain(
      'workspaceType?: "short" | "script" | "long";'
    );
    const workspaceDocumentSource =
      workspaceTypeSource.split("export interface WorkspaceDocument")[1] ??
      "";
    expect(workspaceDocumentSource).toContain(
      'workspaceType?: "short" | "script";'
    );
    expect(workspaceDocumentSource).not.toContain(
      'workspaceType?: "short" | "script" | "long";'
    );
  });

  it("projects long-form navigation into the same recursive tree used by short books", () => {
    expect(appSource).toContain("function projectLongWorkspaceNavigation(");
    expect(appSource).toContain("longWorkspaceSelection: selection");
    expect(appSource).toContain(
      "children: projectLongWorkspaceNavigation(book, workspaceIndex)"
    );
    expect(appSource).toContain(
      "index\n      ? reconcileLongWorkspaceSelection(book, index, selection)\n      : selection"
    );
    expect(appSource).toContain("[...book.navigation.worldbuilding]");
    expect(appSource.indexOf("[...book.navigation.worldbuilding]")).toBeLessThan(
      appSource.indexOf("...(worldRevealSelection")
    );
    expect(appSource).toContain("selectableBranch: true");
    expect(appSource).toContain('badge: "长篇"');
    expect(appSource).not.toContain("badge: `长篇 · ${book.genre}`");
    expect(appSource).toContain("node.longWorkspaceSelection");
    expect(leftSidebarSource).toContain("<TreeSection");
    expect(leftSidebarSource).not.toContain('<slot name="long-workspace" />');
    expect(treeNodeSource).toContain("<TreeNodeItem");
    expect(treeNodeSource).toContain(":depth=\"depth + 1\"");
    for (const label of [
      "世界观",
      "人物设计",
      "剧情设计",
      "正文",
      "连续性账本"
    ]) {
      expect(appSource).toContain(label);
    }
    expect(appSource).toContain("class=\"long-workspace-main-view\"");
    expect(appSource).toContain("'is-right-collapsed': rightCollapsed");
    expect(appSource).toContain(':left-collapsed="leftCollapsed"');
    expect(appSource).toContain(':right-collapsed="rightCollapsed"');
    expect(appSource).toContain('@toggle-left="leftCollapsed = !leftCollapsed"');
    expect(appSource).toContain('@toggle-right="rightCollapsed = !rightCollapsed"');
    expect(appSource).toContain('v-show="!rightCollapsed"');
  });

  it("uses dedicated long agent context and approval surfaces", () => {
    expect(appSource).toContain("activeLongRuntimeContext");
    expect(appSource).toContain("conversation.sendLongMessage(");
    expect(appSource).toContain("activeLongReadableAttachments");
    expect(appSource).toContain("profile.readAccess.skillKinds");
    expect(appSource).toContain("profile.readAccess.materialKinds");
    expect(appSource).not.toContain("<LongProposalReview");
    expect(agentConversationSource).toContain("<LongProposalReview");
    expect(agentConversationSource).toContain("embedded");
    expect(appSource).toContain(
      ':long-proposal-items="activeLongConversationProposalItems"'
    );
    expect(appSource).toContain('@review-edit="reviewLongAgentEdit"');
    expect(proposalSource).toContain("long.mutation_proposal");
    expect(proposalSource).toContain("long.chapter_dispatch_proposal");
    expect(proposalSource).not.toContain("long.chapter_write_proposal");
    expect(appSource).toContain("stageLongDraftEditProposal(event)");
    expect(proposalSource).not.toContain("long.ledger_commit_proposal");
    expect(appSource).toContain(
      "canFinalizeContinuity: canApproveLongProposalDuringActivePlan"
    );
    expect(proposalSource).toContain("查看具体影响");
    expect(proposalSource).toContain("删除实体");
    expect(proposalSource).toContain("实体完整前后快照");
    expect(proposalSource).toContain("entitySnapshotText(change.before)");
    expect(proposalSource).toContain("entitySnapshotText(change.after)");
    expect(proposalSource).not.toContain(".slice(0, 80)");
    expect(proposalSource).toContain("long.continuity_file_proposal");
    expect(proposalSource).not.toContain("查看提交内容");
    expect(proposalSource).not.toContain("本章六类连续性摘要");
    expect(proposalSource).toContain("item.approvalMode === \"auto-approve\"");
    expect(proposalSource).toContain("自动保存中");
    expect(appSource).toContain("approvalModeForEvent: longProposalApprovalMode");
    expect(appSource).toContain("prepareAutoApprove: prepareAutomaticLongProposal");
    expect(appSource).toContain("longAgentRunApprovalMode(");
    expect(appSource).toContain(
      'event.payload.agentId === "continuity_ledger"'
    );
    expect(appSource).toContain('return "request-approval";');
    expect(appSource).toContain(
      "longWritingOrchestrator.handleRejected(event)"
    );
    expect(appSource).toContain(
      "longWorkspaceProposals.quarantineSession("
    );
    expect(editorSource).not.toContain("LongLedgerCommitRecordSchema");
    expect(editorSource).not.toContain("本章连续性摘要");
    expect(editorSource).not.toContain("伏笔线状态推导");
    expect(editorSource).not.toContain("查看原始审计记录");
    expect(proposalSource).not.toContain("workspace.editor_mutation");
  });

  it("runs approved chapter, arc, and volume plans as fresh serial agent sessions", () => {
    expect(appSource).toContain("longWritingOrchestrator.startDispatch(event)");
    expect(appSource).toContain("conversation.newConversation()");
    expect(appSource).toContain('agentId: "expert_section_writer"');
    expect(appSource).toContain('agentId: "continuity_ledger"');
    expect(appSource).toContain("resolveLiveLongChapterReadiness");
    expect(appSource).toContain("refreshLongWritingSaveBarrier");
    expect(appSource).toContain("async function cancelLongWritingWorkflow()");
    expect(appSource).toContain("longWritingAgentRunExpectation = null");
    expect(appSource).toContain("@click=\"cancelLongWritingWorkflow\"");
    expect(appSource).toContain("取消计划");
    expect(proposalSource).toContain("主弧连续章节");
    expect(proposalSource).toContain("当前卷章节");
    expect(writingOrchestratorSource).toContain(
      'phase: "awaiting_writer_approval"'
    );
    expect(writingOrchestratorSource).toContain(
      'phase: "awaiting_ledger_approval"'
    );
    expect(writingOrchestratorSource).toContain(
      'fail(error, "after_write")'
    );
    expect(writingOrchestratorSource).toContain(
      'fail(error, "after_ledger")'
    );
    expect(writingOrchestratorSource).toContain(
      "guard: LongWritingRunGuard"
    );
    expect(writingOrchestratorSource).toContain(
      "runEpoch === epoch"
    );
    const freshRunSource =
      appSource
        .split("async function startFreshLongAgentRun(")[1]
        ?.split("async function startFreshLongChapterWriter(")[0] ?? "";
    expect(
      freshRunSource.match(/guard\.isCurrent\(\)/gu)?.length
    ).toBeGreaterThanOrEqual(5);
    expect(freshRunSource).toContain(
      "buildLongReadableAttachmentsForProfile("
    );
    expect(freshRunSource).not.toContain(
      "activeLongReadableAttachments"
    );
    const cancelSource =
      appSource
        .split("async function cancelLongWritingWorkflow()")[1]
        ?.split("function selectLongModel(")[0] ?? "";
    expect(cancelSource).toContain(
      "conversation.sessionId.value === expectation.sessionId"
    );
    expect(cancelSource.indexOf("longWorkspaceProposals.quarantineSession("))
      .toBeLessThan(
        cancelSource.indexOf("longWritingAgentRunExpectation = null")
      );
    expect(cancelSource).toContain(
      "conversation.cancelPendingGeneration()"
    );
    expect(cancelSource.indexOf("conversation.newConversation()")).toBeLessThan(
      cancelSource.indexOf("await stopPromise")
    );
    expect(writingOrchestratorSource).toContain(
      "event.payload.agentId !== expectation.agentId"
    );
    expect(writingOrchestratorSource).toContain(
      "event.payload.sessionId !== expectation.sessionId"
    );
    expect(writingOrchestratorSource).toContain(
      "event.payload.runId !== expectation.runId"
    );
    expect(appSource).toContain(
      "if (!canApproveLongProposalDuringActivePlan(event)) return;"
    );
  });

  it("guards every plan-invalidating navigation or mutation until cancellation", () => {
    expect(appSource).toContain("function blockActiveLongWritingPlan(");
    for (const action of [
      "新建长篇",
      "打开其他长篇",
      "导入长篇",
      "导入旧版本长篇",
      "管理其他长篇的结构",
      "回滚连续性提交",
      "修改长篇结构",
      "新建长篇对话",
      "切换长篇对话"
    ]) {
      expect(appSource).toContain(
        `blockActiveLongWritingPlan("${action}"`
      );
    }
    expect(appSource).toContain('"管理其他长篇的技能库绑定"');
    expect(appSource).toContain('"管理其他长篇的素材库绑定"');
    expect(appSource).toContain("`修改长篇${bindingLabel}`");
    expect(appSource).toContain("请先取消计划");
    expect(appSource).toContain(
      "longWritingOrchestrator.state.value.bookId ==="
    );
    expect(appSource).toContain("activeLongBookSummary.id");
    expect(appSource).toContain(
      "if (conversation.isBusy.value)"
    );
    expect(appSource).toContain(
      "请先停止当前长篇回复，再新建对话。"
    );
    const newConversationSource =
      appSource
        .split("function newConversation(): void {")[1]
        ?.split("function selectConversation(")[0] ?? "";
    expect(newConversationSource).toContain(
      "activeLongBookId.value !== null"
    );
    expect(newConversationSource).not.toContain(
      "isLongWorkspaceActive.value"
    );
    const newLongConversationSource =
      appSource
        .split("function newLongConversation(): void {")[1]
        ?.split("function selectLongConversation(")[0] ?? "";
    expect(newLongConversationSource).toContain(
      'workspaceMainView.value = "conversation"'
    );
  });

  it("keeps saved revisions atomic and pauses long-agent sends while refreshing", () => {
    expect(appSource).toContain("createLongWorkspaceRefreshClock()");
    expect(appSource).toContain("isMonotonicLongWorkspaceRefresh(");
    expect(appSource).toContain("activeLongWorkspaceContextReady");
    expect(appSource).toContain("longWorkspaceRefreshStatus.value = {");
    expect(appSource).toContain("retryActiveLongWorkspaceRefresh");
    expect(appSource).toContain("长篇智能体已暂停发送");
    expect(appSource).toContain(
      'v-if="activeLongWorkspaceRefreshStatus?.error"'
    );
    expect(appSource).not.toContain(
      'activeLongWorkspaceRefreshStatus.pending\n                    ? "正在同步保存后的最新工作区索引…"'
    );
    const sendLongMessageSource =
      appSource
        .split("async function sendLongMessage(")[1]
        ?.split("async function retryActiveLongWorkspaceRefresh")[0] ?? "";
    expect(sendLongMessageSource).toContain("await nextTick()");
    expect(
      sendLongMessageSource.match(
        /confirmLongMessageSendTarget\(target\)/gu
      )?.length
    ).toBeGreaterThanOrEqual(4);
    expect(sendLongMessageSource.indexOf("saveActiveLongEditorChanges()")).toBeLessThan(
      sendLongMessageSource.indexOf(
        "refreshActiveLongWorkspace(target.bookId)"
      )
    );
    expect(sendLongMessageSource.indexOf(
      "refreshActiveLongWorkspace(target.bookId)"
    )).toBeLessThan(
      sendLongMessageSource.indexOf("activeLongRuntimeContext.value")
    );
    expect(sendLongMessageSource).toContain(
      "target.conversation.sendLongMessage("
    );
    const sendTargetSource =
      appSource
        .split("interface LongMessageSendTarget")[1]
        ?.split("async function sendLongMessage(")[0] ?? "";
    for (const field of [
      "bookId:",
      "selectionKey:",
      "preferredRole:",
      "activeRoot:",
      "chapterCardId:",
      "fileId:",
      "agentId:",
      "conversation:",
      "sessionId:",
      "draft:"
    ]) {
      expect(sendTargetSource).toContain(field);
    }
    expect(appSource).toContain(':locked="longEditorLocked"');
    expect(appSource).toContain(
      "agentRunScopeHasWriteBarrier(scope)"
    );
    expect(appSource).toContain(
      "conversation.hasPendingEditReview.value"
    );
    expect(appSource).toContain(
      "正在保存并准备发送，编辑暂时锁定"
    );
    expect(appSource).toContain(
      "长篇智能体运行中 · 暂停编辑以防止版本冲突"
    );
    expect(editorSource).toContain("lockedReason?: string");
    expect(editorSource).toContain(':disabled="locked"');
    const approveSource =
      appSource
        .split("async function approveLongProposal(")[1]
        ?.split("function rejectLongProposal(")[0] ?? "";
    expect(approveSource).toContain(
      "canApproveLongProposalDuringActivePlan(item.event)"
    );
    expect(approveSource).toContain(
      "const wasPlanBound = longWritingOrchestrator.active.value"
    );
    expect(
      approveSource.indexOf(
        "longProposalApprovalPending.value = true"
      )
    ).toBeLessThan(
      approveSource.indexOf("await saveActiveLongEditorChanges()")
    );
    expect(approveSource.indexOf("await nextTick()")).toBeLessThan(
      approveSource.indexOf("await saveActiveLongEditorChanges()")
    );
    expect(approveSource).toContain(
      "canApproveLongProposalDuringActivePlan(currentItem.event)"
    );
    expect(approveSource).toContain(
      "wasPlanBound &&"
    );
    expect(approveSource).toContain(
      "!longWritingOrchestrator.active.value"
    );
    const readinessSource =
      appSource
        .split("async function resolveLiveLongChapterReadiness(")[1]
        ?.split("function longWorkflowRuntimeContext")[0] ?? "";
    expect(readinessSource).toContain("saveActiveLongEditorChanges()");
    expect(readinessSource).toContain("refreshActiveLongWorkspace(bookId)");
    expect(readinessSource).not.toContain(
      "replaceLongBookSummary(longBooks.value, result.summary)"
    );
  });

  it("isolates long conversation history by book, agent, root, and chapter", () => {
    expect(appSource).toContain(
      'activeRoot: LongWorkspaceRuntimeContext["activeRoot"]'
    );
    expect(appSource).toContain('chapterCardId ?? "__book__"');
    expect(appSource).toContain(
      "activeLongSelection.value?.chapterCardId"
    );
    expect(appSource).toContain("input.activeRoot");
    expect(appSource).toContain("input.chapterCardId");
    expect(appSource).toContain(
      "const prefix = `long:${encodeURIComponent(event.payload.bookId)}:`"
    );
    expect(agentRunPreferencesSource).toContain(
      "return `${document.workspaceId}:${agentId}${"
    );
    expect(agentRunPreferencesSource).not.toContain(
      "longConversationKey"
    );
  });

  it("requires a modal confirmation before rolling back the final commit", () => {
    expect(editorSource).toContain("回滚最后提交");
    expect(appSource).toContain("api.rollbackLastCommit({");
    expect(appSource).toContain(
      "if (!(await saveActiveLongEditorChanges()))"
    );
    expect(appSource).toContain(
      "await refreshActiveLongWorkspace(bookId)"
    );
    expect(rollbackSource).toContain('role="alertdialog"');
    expect(rollbackSource).toContain('aria-modal="true"');
    expect(rollbackSource).toContain("var(--surface-raised)");
  });

  it("provides a continuity review entry without replacing chapter authoring", () => {
    expect(appSource).toContain("createLongChapterSelection");
    expect(appSource).toContain("createLongContinuitySelection");
    expect(appSource).toContain('title: "待处理章节"');
    expect(longWorkspaceTypeSource).toContain("本章对应的 Markdown 状态文件");
    expect(longWorkspaceTypeSource).toContain(
      'root: "continuity_ledger"'
    );
    expect(longWorkspaceTypeSource).toContain(
      "chapterCardId: chapter.id"
    );
    expect(longWorkspaceTypeSource).toContain(
      "请先回滚最后一次连续性提交"
    );
    expect(editorSource).toContain("回滚最后提交");
    expect(editorSource).toContain("只读内容");
  });

  it("exposes explicit migration and isolated book removal", () => {
    expect(sectionSource).toContain('"choose-open-book"');
    expect(sectionSource).toContain('id: "choose-import-book"');
    expect(appSource).toContain("<BookTransferDialog");
    expect(appSource).toContain("api.importPortable()");
    expect(appSource).toContain("api.importWriteClaw()");
    expect(appSource).not.toContain("api.exportPortable({");
    expect(appSource).toContain(
      "activeLongBookId.value === bookId &&"
    );
    expect(appSource).toContain("<LongMigrationReportDialog");
    expect(appSource).toContain("<LongBookRemovalDialog");
    expect(migrationReportSource).toContain("不会修改");
    expect(removalSource).toContain("整个长篇项目文件夹");
    expect(appSource).toContain("stopLongBookAgentRuns");
    expect(appSource).toContain(
      "conversation.dispose({ clearPersistence: true })"
    );
    expect(appSource).toContain(
      "longWorkspaceProposals.discardBook(bookId)"
    );
    expect(appSource).toContain(
      'removeAgentRunPreferences(`long:${bookId}`)'
    );
    expect(appSource).toContain("longCatalogDiagnostics");
    expect(appSource).toContain("不可用长篇 ·");
    expect(appSource).toContain("unavailable: true");
    expect(sectionSource).toContain('id: "refresh-long-books"');
    expect(appSource).toContain(
      "options: { notify?: boolean; force?: boolean }"
    );
    expect(appSource).toContain(
      "requestId !== longCatalogRequestClock"
    );
    expect(appSource).toContain(
      "await loadLongBookList({ force: true })"
    );
    expect(appSource).toContain(
      "longCatalogRetryAttempts < 2"
    );
  });

  it("updates long resource bindings through an isolated CAS command", () => {
    expect(appSource).toContain("<LongBookBindingsDialog");
    expect(appSource).toContain("api.updateBindings({");
    expect(appSource).toContain(
      "expectedProjectRevision: summary.projectRevision"
    );
    expect(appSource).toContain(
      "longWorkspaceEditor.value?.synchronizeProjectRevisions"
    );
    expect(editorSource).toContain("function synchronizeProjectRevisions(");
    expect(bindingsSource).toContain("<PopupSelect");
    expect(bindingsSource).toContain("create-short-binding-panel");
    expect(bindingsSource).toContain("create-short-kind-grid");
    expect(bindingsSource).toContain("Catalog 中缺失");
    expect(bindingsSource).not.toContain("catalog.updateBook");
  });

  it("applies manual structure changes directly after an internal impact check", () => {
    expect(appSource).toContain("<LongStructureDialog");
    expect(appSource).toContain("async function handleLongStructureMutation(");
    expect(appSource).toContain("async function handleLongWorldbuildingSync(");
    expect(appSource).toContain("buildLongWorldbuildingSyncBatch");
    expect(appSource).toContain('@sync-worldbuilding="handleLongWorldbuildingSync"');
    expect(appSource).toContain("const preview = await api.previewOperations({");
    expect(appSource).toContain(
      "const applyResult = await api.applyOperations({"
    );
    expect(appSource).toContain("expectedImpact: preview.preview.impact");
    expect(appSource).not.toContain(
      "longWorkspaceProposals.enqueueManualMutation({"
    );
    expect(structureSource).toContain(
      "completion: LongStructureMutationCompletion"
    );
    expect(structureSource).toContain("builder.createWorldbuilding");
    expect(structureSource).toContain("builder.updateWorldbuilding");
    expect(structureSource).toContain("加载其他书籍世界观");
    expect(structureSource).not.toContain("<LongPlotStructureManager");
    expect(structureSource).toContain('@click="openCreate"');
    expect(structureSource).toContain('@click="openEdit(row)"');
    expect(structureSource).toContain('@click="openDelete(row)"');
  });
});
