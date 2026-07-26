import { describe, expect, it } from "vitest";
import appSource from "../App.vue?raw";
import bindingsSource from "./LongBookBindingsDialog.vue?raw";
import dialogSource from "./CreateLongBookDialog.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import migrationReportSource from "./LongMigrationReportDialog.vue?raw";
import proposalSource from "./LongProposalReview.vue?raw";
import removalSource from "./LongBookRemovalDialog.vue?raw";
import rollbackSource from "./LongRollbackDialog.vue?raw";
import sectionSource from "./TreeSection.vue?raw";
import structureSource from "./LongStructureManager.vue?raw";
import treeSource from "./LongWorkspaceTree.vue?raw";
import longWorkspaceTypeSource from "../types/longWorkspace.ts?raw";
import workspaceTypeSource from "../types/workspace.ts?raw";
import writingOrchestratorSource from "../composables/useLongWritingOrchestrator.ts?raw";
import agentRunPreferencesSource from "../utils/agentRunPreferences.ts?raw";

describe("long-form renderer vertical slice", () => {
  it("offers an independent long-book creation action and themed dialog", () => {
    expect(sectionSource).toContain('id: "create-long-book"');
    expect(sectionSource).toContain('label: "新建长篇"');
    expect(dialogSource).toContain("<PopupSelect");
    expect(dialogSource).not.toContain("<select");
    expect(dialogSource).toContain("uiMessage.warning");
    expect(dialogSource).toContain("<Teleport to=\"body\">");
    expect(dialogSource).toContain("var(--surface-main)");
    expect(dialogSource).toContain("var(--neutral-solid)");
    expect(dialogSource).toContain("linkedMaterialIdsByKind");
    expect(dialogSource).toContain("linkedSkillIdsByKind");
    expect(dialogSource).toContain('materialType === "long"');
    expect(dialogSource).toContain('skillType === "long"');
  });

  it("renders all five long-workspace roots from the navigation summary", () => {
    for (const root of [
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]) {
      expect(treeSource).toContain(`id: "${root}"`);
    }
    expect(treeSource).toContain("summary.navigation.counts");
    expect(treeSource).toContain("workspaceIndex.ledger.commits");
    expect(treeSource).toContain("isLongMigrationEvidenceCategoryId");
    expect(treeSource).toContain("{ readOnly: true }");
    expect(longWorkspaceTypeSource).toContain('role: "body"');
    expect(longWorkspaceTypeSource).toContain('role: "character-state"');
    expect(longWorkspaceTypeSource).toContain('role: "handoff"');
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
    expect(longWorkspaceTypeSource).toContain('label: "人物状态"');
    expect(longWorkspaceTypeSource).toContain('label: "Handoff"');
    expect(editorSource).toContain("async function saveAllChanges()");
    expect(editorSource).toContain("离开前已自动保存");
    expect(appSource).toContain("saveActiveLongEditorBeforeLeaving");
    expect(appSource).toContain('ref="longWorkspaceEditor"');
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
    expect(appSource).toContain("<LongWorkspaceTree");
    expect(appSource).toContain("<LongWorkspaceEditor");
    expect(appSource).toContain("!isLongWorkspaceActive");
    expect(appSource).toContain("<CreateShortBookDialog");
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

  it("uses dedicated long agent context and approval surfaces", () => {
    expect(appSource).toContain("activeLongRuntimeContext");
    expect(appSource).toContain("conversation.sendLongMessage(");
    expect(appSource).toContain("activeLongReadableAttachments");
    expect(appSource).toContain("profile.readAccess.skillKinds");
    expect(appSource).toContain("profile.readAccess.materialKinds");
    expect(appSource).toContain("<LongProposalReview");
    expect(proposalSource).toContain("long.mutation_proposal");
    expect(proposalSource).toContain("long.chapter_dispatch_proposal");
    expect(proposalSource).toContain("long.chapter_write_proposal");
    expect(proposalSource).toContain("long.ledger_commit_proposal");
    expect(proposalSource).toContain("查看具体影响");
    expect(proposalSource).toContain("删除实体");
    expect(proposalSource).toContain("实体完整前后快照");
    expect(proposalSource).toContain("entitySnapshotText(change.before)");
    expect(proposalSource).toContain("entitySnapshotText(change.after)");
    expect(proposalSource).not.toContain(".slice(0, 80)");
    expect(proposalSource).toContain("本章六类连续性摘要");
    expect(proposalSource).toContain("decision.note");
    expect(editorSource).toContain("LongLedgerCommitRecordSchema");
    expect(editorSource).toContain("本章连续性摘要");
    expect(editorSource).toContain("伏笔线状态推导");
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
      "迁移长篇",
      "管理其他长篇的结构",
      "管理其他长篇的资源绑定",
      "回滚连续性提交",
      "修改长篇资源绑定",
      "修改长篇结构",
      "新建长篇对话",
      "切换长篇对话"
    ]) {
      expect(appSource).toContain(
        `blockActiveLongWritingPlan("${action}"`
      );
    }
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

  it("invalidates in-flight searches when the scope or query changes", () => {
    expect(treeSource).toContain("function setSearchScope(");
    expect(treeSource).toContain("watch(\n  searchQuery,");
    expect(treeSource.match(/searchClock \+= 1;/gu)?.length).toBeGreaterThanOrEqual(
      4
    );
    expect(treeSource).toContain("searchLoading.value = false");
    expect(treeSource).toContain("props.workspaceIndex.revision");
    expect(treeSource).toContain("props.summary.projectRevision");
    expect(treeSource).toContain('{ flush: "sync" }');
    expect(editorSource).toContain(
      "props.selection?.preferredRole"
    );
  });

  it("keeps saved revisions atomic and pauses long-agent sends while refreshing", () => {
    expect(appSource).toContain("createLongWorkspaceRefreshClock()");
    expect(appSource).toContain("isMonotonicLongWorkspaceRefresh(");
    expect(appSource).toContain("activeLongWorkspaceContextReady");
    expect(appSource).toContain("longWorkspaceRefreshStatus.value = {");
    expect(appSource).toContain("retryActiveLongWorkspaceRefresh");
    expect(appSource).toContain("长篇智能体已暂停发送");
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
    expect(appSource).toContain(
      "longProposalApprovalPending || longSendPreflightPending"
    );
    expect(appSource).toContain(
      "正在保存并准备发送，编辑暂时锁定"
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
    expect(appSource).not.toContain(
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
    expect(treeSource).toContain("createLongChapterSelection");
    expect(treeSource).toContain("createLongContinuitySelection");
    expect(treeSource).toContain("核对下一章并提交");
    expect(longWorkspaceTypeSource).toContain(
      'root: "continuity_ledger"'
    );
    expect(longWorkspaceTypeSource).toContain(
      "chapterCardId: chapter.id"
    );
    expect(longWorkspaceTypeSource).toContain(
      "请先回滚最后一次连续性提交"
    );
    expect(editorSource).toContain(
      "请先回滚最后一次提交"
    );
  });

  it("exposes explicit migration, portable export and isolated book removal", () => {
    expect(sectionSource).toContain('id: "open-long-book"');
    expect(sectionSource).toContain('id: "import-portable-long-book"');
    expect(sectionSource).toContain('id: "migrate-write-claw-long-book"');
    expect(appSource).toContain("api.importPortable()");
    expect(appSource).toContain("api.importWriteClaw()");
    expect(appSource).toContain("api.exportPortable({");
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
    expect(bindingsSource).toContain("Catalog 中缺失");
    expect(bindingsSource).toContain("只有点击移除才会解除已有绑定");
    expect(bindingsSource).not.toContain("catalog.updateBook");
  });

  it("routes manual structure changes through the same preview queue", () => {
    expect(appSource).toContain("<LongStructureDialog");
    expect(appSource).toContain(
      "longWorkspaceProposals.enqueueManualMutation"
    );
    expect(structureSource).toContain(
      'proposal: [batch: LongWorkspaceOperationBatch]'
    );
  });
});
