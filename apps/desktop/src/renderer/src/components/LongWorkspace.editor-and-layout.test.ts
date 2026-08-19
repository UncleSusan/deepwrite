import {
  agentConversationSource,
  agentRunPreferencesSource,
  appSource,
  bindingsSource,
  chapterCardDialogSource,
  characterDialogSource,
  characterNavigationSource,
  continuityNavigationSource,
  conversationStoreSource,
  describe,
  dialogCoordinatorSource,
  dialogSource,
  editorDeleteDialogsSource,
  editorDeleteSource,
  editorSessionSource,
  editorSource,
  editorStructureSource,
  expect,
  featureHostCoordinatorSource,
  foreshadowingFiltersSource,
  foreshadowingMutationsSource,
  it,
  lazyLongStructureTransactionsSource,
  leftSidebarSource,
  legacySyncSource,
  longBookLifecycleSource,
  longConversationSource,
  longRollbackSource,
  longStructureTransactionsCreateSource,
  longStructureTransactionsDeleteSource,
  longStructureTransactionsFacadeSource,
  longStructureTransactionsLeaseSource,
  longStructureTransactionsRenameSaveSource,
  longStructureTransactionsSource,
  longStructureTransactionsSyncSource,
  longStructureTransactionsTreeSource,
  longWorkspaceModuleSource,
  longWorkspaceResourceTreeSource,
  longWorkspaceSessionSource,
  longWorkspaceStoreSource,
  longWorkspaceTypeSource,
  manuscriptNavigationSource,
  plotPointDialogSource,
  presentationCoordinatorSource,
  proposalSource,
  removalSource,
  resourceTreeCoordinatorSource,
  rollbackSource,
  sectionSource,
  structureSource,
  treeNodeSource,
  workspaceDialogLayerSource,
  workspaceSystemEventRoutesSource,
  workspaceTypeSource,
  worldbuildingNavigationSource,
  writingOrchestratorSource,
  writingWorkflowSource,
  writingWorkspaceSource,
} from "./LongWorkspace.test-support";

describe("long-form renderer vertical slice: editor-and-layout", () => {
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
      expect(editorStructureSource).toContain(
        'emit(\n      "renameStructureTitle"'
      );
      expect(appSource).toContain(
        '@rename-structure-title="renameLongStructureTitle"'
      );
      expect(longStructureTransactionsSource).toContain(
        "createLongStructureMutationBuilder(index)"
      );
      expect(longStructureTransactionsSource).toContain(
        "builder.updateWorldbuilding(category.id, { title })"
      );
      expect(longStructureTransactionsSource).toContain(
        "builder.updateVolume(volume.id, { title })"
      );
      expect(longStructureTransactionsSource).toContain(
        "builder.updateArc(plotPoint.id, { title })"
      );
      expect(longStructureTransactionsSource).toContain(
        "builder.updateChapter(chapter.id, { title })"
      );
      expect(editorSource).not.toContain(
        'chapterCardId === target.id && commitId !== null'
      );
    });

  it("lazy-loads selected files and saves Markdown with all CAS revisions", () => {
      expect(editorSessionSource).toContain("api.readDocument({");
      expect(editorSessionSource).toContain("api.writeDocument({");
      expect(editorSessionSource).toContain("baseRevision: state.file.revision");
      expect(editorSessionSource).toContain(
        "baseWorkspaceRevision: state.workspaceRevision"
      );
      expect(editorSessionSource).toContain(
        "baseProjectRevision: state.projectRevision"
      );
      expect(editorSource).toContain("currentReadOnly");
      expect(longWorkspaceTypeSource).toContain('label: "正文"');
      expect(longWorkspaceTypeSource).toContain('label: "章末状态"');
      expect(longWorkspaceTypeSource).toContain('label: "下一章接续包"');
      expect(editorSessionSource).toContain("async function saveAllChanges()");
      expect(editorSessionSource).toContain("离开前已自动保存");
      expect(appSource).toContain("saveActiveLongEditorBeforeLeaving");
      expect(appSource).toContain(
        '@editor-port-change="updateLongWorkspaceEditorPort"'
      );
      expect(longWorkspaceModuleSource).toContain(':ref="captureEditorPort"');
    });

  it("loads only the selected character document and avoids unbounded sibling prefetches", () => {
      expect(editorSessionSource).not.toContain("prefetchCharacterDocuments");
      expect(editorSessionSource).not.toContain(
        "void loadWorkspaceDocument(file, false, true)"
      );
      expect(editorSessionSource).toContain("async function loadSelectedDocument");
      expect(editorSessionSource).toContain("await loadWorkspaceDocument(selectedFile, force)");
      expect(editorSessionSource).toContain(
        "async function prefetchActiveSelectionFiles"
      );
      expect(editorSessionSource).toContain(
        "Avoid unbounded sibling character"
      );
      expect(editorSessionSource).toContain(
        "async function ensureDocumentsLoaded"
      );
      expect(editorStructureSource).toContain(
        "async function selectRole(role: LongWorkspaceFileRole)"
      );
      expect(longWorkspaceSessionSource).toContain(
        "await editor.value?.ensureDocumentsLoaded([preferredFile])"
      );
      expect(longWorkspaceSessionSource).toContain(
        "state.selection.value?.chapterCardId !== nextSelection.chapterCardId"
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

  it("renders list worldbuilding with top, right-list or left-tree navigation", () => {
      expect(editorStructureSource).toContain(
        'selection.files.find(({ role }) => role === "overview")'
      );
      expect(editorSource).toContain(
        '@select-overview="selectWorldbuildingOverview"'
      );
      expect(worldbuildingNavigationSource).toContain(
        `@click="emit('selectOverview')"`
      );
      expect(longStructureTransactionsSource).toContain(
        'type === "worldbuildingItem.create"'
      );
      expect(editorStructureSource).toContain('emit("createWorldbuildingItem")');
      expect(worldbuildingNavigationSource).toContain(
        'class="section-tabs-bar long-worldbuilding-tabs"'
      );
      expect(worldbuildingNavigationSource).toContain(
        'aria-label="世界观条目"'
      );
      expect(editorSource).toContain("currentUsesTopWorldbuildingTabs");
      expect(editorSource).toContain("currentUsesRightWorldbuildingList");
      expect(editorSource).toContain("currentUsesLeftTreeWorldbuilding");
      expect(editorSource).toContain('=== "left-tree"');
      expect(editorSource).toContain('"right-list"');
      expect(worldbuildingNavigationSource).toContain(
        'aria-label="世界观条目列表"'
      );
      expect(worldbuildingNavigationSource).toContain("long-entry-list-pane");
      expect(worldbuildingNavigationSource).toContain("items.length");
      expect(editorSource).toContain("@container (max-width: 26rem)");
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

  it("uses independent right-side entry layouts for shared and plot workspaces", () => {
      expect(editorSource).toContain("characterAndContinuityItemLayout");
      expect(editorSource).toContain("plotItemLayout");
      expect(editorSource).toContain("currentUsesRightCharacterList");
      expect(editorSource).toContain("currentUsesRightContinuityList");
      expect(editorSource).toContain("currentUsesRightBookLineList");
      expect(editorSource).toContain("currentUsesRightPlotPointList");
      expect(editorSource).toContain("currentUsesRightChapterCardList");
      expect(editorSource).toContain("currentUsesLeftTreeCharacter");
      expect(editorSource).toContain("currentUsesLeftTreePlot");
      expect(editorSource).toContain("currentUsesLeftTreeContinuity");
      expect(continuityNavigationSource).toContain(
        'aria-label="连续性账本文件列表"'
      );
      expect(editorSource).toContain('aria-label="全书故事线列表"');
      expect(editorSource).toContain('aria-label="剧情点列表"');
      expect(manuscriptNavigationSource).toContain('aria-label="章卡列表"');
      expect(manuscriptNavigationSource).toContain("toggleActionMenu");
      expect(manuscriptNavigationSource).toContain("runMenuAction");
      expect(editorStructureSource).toContain('type: "chapter.reorder"');
      expect(editorSource).not.toContain("isChapterCardCommitted");
      expect(editorSource).toContain("!currentUsesRightContinuityList.value");
      expect(editorSource).toContain("long-entry-list-pane");
      expect(editorSource).toContain("captureNavigationSelection");
      expect(editorStructureSource).toContain("function captureNavigationSelection(");
    });

  it("loads a list worldbuilding item before activating its tab", () => {
      expect(editorStructureSource).toContain(
        "async function selectWorldbuildingItem(itemId: string)"
      );
      expect(editorStructureSource).toContain(
        "await loadWorkspaceDocument(selectedFile)"
      );
      expect(editorStructureSource).toContain(
        "activeWorldbuildingItemId.value = itemId"
      );
      expect(worldbuildingNavigationSource).toContain(
        "'is-loading': pendingItemId === item.id"
      );
      expect(worldbuildingNavigationSource).toContain(
        "'is-loading': pendingOverview"
      );
      expect(editorStructureSource).toContain("await selectWorldbuildingItem(item.id)");
      expect(editorDeleteSource).toContain("void options.selectWorldbuildingItem(nextId)");
    });

  it("keeps the long editor surface stable while documents refresh or switch", () => {
      expect(editorSessionSource).toContain("const showEditorLoading = computed");
      expect(editorSessionSource).toContain(
        "state?.loading && !state.loaded && !state.content"
      );
      expect(editorSessionSource).toContain("const isDocumentSwitchPending = computed");
      expect(editorSessionSource).toContain("heldSelectionFile");
      expect(editorSessionSource).toContain(
        "async function prefetchWorldbuildingSelectionFiles"
      );
      expect(editorSessionSource).toContain("inflightDocumentLoads");
      expect(editorSource).toContain("v-else-if=\"showEditorLoading\"");
      expect(editorSource).toContain(
        "currentReadOnly || isDocumentContentBusy"
      );
    });

  it("creates the document session before eagerly reading visible editor content", () => {
      const documentSessionIndex = editorSource.indexOf(
        "} = useLongEditorDocumentSession({"
      );
      const characterCountIndex = editorSource.indexOf(
        "const characterCount = ref("
      );

      expect(documentSessionIndex).toBeGreaterThan(-1);
      expect(characterCountIndex).toBeGreaterThan(documentSessionIndex);
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
      expect(editorSessionSource).toContain(
        "function synchronizeProjectRevisionsIfClean("
      );
      expect(editorSessionSource).toContain("if (bookId !== props.bookId) return true");
      expect(editorSessionSource).toContain("key.startsWith(prefix)");
      expect(editorSessionSource).toContain(
        "state.loaded && state.content !== state.savedContent"
      );
      expect(editorSource).toContain(
        "synchronizeProjectRevisionsIfClean"
      );
      expect(longWorkspaceSessionSource).toContain(
        "async function refreshOnWindowFocus("
      );
      expect(longWorkspaceSessionSource).toContain(
        "editor.value?.synchronizeProjectRevisionsIfClean("
      );
      expect(longWorkspaceSessionSource).toContain("当前有未保存内容");
    });

  it("mounts the long workspace without routing it through short/script state", () => {
      expect(resourceTreeCoordinatorSource).toContain(
        'catalogNodeType: "long-book"'
      );
      expect(appSource).not.toContain("<LongWorkspaceTree");
      expect(appSource).toContain("<LongWorkspaceModule");
      expect(longWorkspaceModuleSource).toContain("<LongWorkspaceEditor");
      expect(appSource).toContain("isLongWorkspaceActive");
      expect(appSource).toContain("activeFeature === 'long-workspace'");
      const shortWorkspaceMountSource =
        appSource.split("<WritingWorkspaceModule")[1]?.split("/>")[0] ?? "";
      expect(shortWorkspaceMountSource).toContain("activeFeature === 'conversation'");
      expect(writingWorkspaceSource).toContain("<RightEditorPane");
      expect(workspaceDialogLayerSource).toContain("<CreateBookDialog");
      expect(appSource).toContain('@submit-create-book="createCreativeBook"');
      expect(appSource).toContain("async function createCreativeBook(");
      expect(appSource).toContain(
        "await shortBookLifecycle.createBook(input)"
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

  it("keeps the first long-form entry on a stable two-column shell", () => {
      const openSource =
        longWorkspaceSessionSource
          .split("async function openBook(")[1]
          ?.split("async function refreshActiveWorkspace")[0] ?? "";
      expect(openSource).toContain(
        "requestedSelection: LongWorkspaceSelection | null = null"
      );
      expect(openSource).toContain(
        "store.activateBook(bookId, requestedSelection, true)"
      );
      expect(longWorkspaceStoreSource).toContain(
        "selection.value = requestedSelection"
      );
      expect(longStructureTransactionsSource).toContain(
        "node.longWorkspaceSelection ?? null"
      );
      expect(longWorkspaceModuleSource).toContain('<template v-if="book">');
      expect(longWorkspaceModuleSource).toContain(
        'class="long-workspace-editor-loading-state"'
      );
      expect(longWorkspaceModuleSource).toContain(
        '<template v-if="workspaceIndex">'
      );
    });
});
