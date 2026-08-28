import {
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createExpertDraftDirectoryRevision,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import { captureWorkspaceDocumentBaselines } from "../../utils/catalogSaveReconciliation";
import { draftCharacterStateTitle } from "../../utils/draftFileTitles";
import {
  advanceDraftSectionCreationRevision,
  draftSectionCreationRevisionKey,
  expectedDraftSectionCreationRevision,
  resolveDraftSectionCreationCommitPlan
} from "../../utils/draftSectionCreationRevision";
import type { AgentConversationController } from "../useAgentConversation";
import { saveCreatedDraftSectionContents } from "./creation-content";
import { agentEditProposalId } from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import type {
  AgentEditReviewRequest,
  ProposalLaneContext,
  WorkspaceEditorMutationEvent
} from "./types";

export function createDraftSectionLane(ctx: ProposalLaneContext) {
  const {
    api,
    uiMessage,
    catalogProjection,
    catalogBook,
    loadCatalogSnapshot,
    applyAcceptedAgentDocumentLocally,
    isCatalogConflict,
    refreshBookAfterSuccessfulDocumentSave,
    documents,
    editorDrafts,
    liveWorkspaceDocuments,
    selectedDraftFileKinds,
    selectedExpertSectionIds,
    acceptingAgentEditWorkspaceIds,
    setAgentEditWorkspaceAccepting,
    removeConversation,
    legacyDraftSectionConversationKeys,
    selectedResourceId,
    activeCreationResourceId,
    acceptedDraftSectionCreationRevisions
  } = ctx;

  const queueAgentEdit: ProposalLaneContext["queueAgentEdit"] = (...args) =>
    ctx.queueAgentEdit(...args);
  const removeQueuedAgentEdit: ProposalLaneContext["removeQueuedAgentEdit"] = (
    ...args
  ) => ctx.removeQueuedAgentEdit(...args);
  const rememberProvisionalExpertSectionMapping: ProposalLaneContext["rememberProvisionalExpertSectionMapping"] =
    (...args) => ctx.rememberProvisionalExpertSectionMapping(...args);
  const resolveProvisionalExpertSectionId: ProposalLaneContext["resolveProvisionalExpertSectionId"] =
    (...args) => ctx.resolveProvisionalExpertSectionId(...args);
  const remapProvisionalExpertSectionFileProposals: ProposalLaneContext["remapProvisionalExpertSectionFileProposals"] =
    (...args) => ctx.remapProvisionalExpertSectionFileProposals(...args);
  const pauseDependentProvisionalFileProposals: ProposalLaneContext["pauseDependentProvisionalFileProposals"] =
    (...args) => ctx.pauseDependentProvisionalFileProposals(...args);
  const conflictDependentProvisionalFileProposals: ProposalLaneContext["conflictDependentProvisionalFileProposals"] =
    (...args) => ctx.conflictDependentProvisionalFileProposals(...args);

  function expectedDraftSectionCreationBaseRevision(
    proposal: AgentEditProposal
  ): string {
    return expectedDraftSectionCreationRevision(
      proposal.baseRevision,
      acceptedDraftSectionCreationRevisions.get(
        draftSectionCreationRevisionKey(proposal.runId, proposal.workspaceId)
      )
    );
  }

  function rememberAcceptedDraftSectionCreation(
    proposal: AgentEditProposal,
    currentRevision: string
  ): void {
    const key = draftSectionCreationRevisionKey(
      proposal.runId,
      proposal.workspaceId
    );
    acceptedDraftSectionCreationRevisions.set(
      key,
      advanceDraftSectionCreationRevision(
        proposal.baseRevision,
        currentRevision,
        acceptedDraftSectionCreationRevisions.get(key)
      )
    );
    while (acceptedDraftSectionCreationRevisions.size > 2_000) {
      const oldest = acceptedDraftSectionCreationRevisions.keys().next()
        .value as string | undefined;
      if (!oldest) break;
      acceptedDraftSectionCreationRevisions.delete(oldest);
    }
  }

  function currentExpertDraftDirectoryRevision(
    workspaceId: string
  ): string | undefined {
    const sections = new Map<
      string,
      {
        order: number;
        title: string;
        wordCountRequirement: string;
        hasBody: boolean;
        hasCharacterState: boolean;
      }
    >();
    for (const document of liveWorkspaceDocuments.value) {
      if (
        document.workspaceId !== workspaceId ||
        document.stageId !== "draft" ||
        !document.expertSectionId ||
        !document.draftFileKind
      ) {
        continue;
      }
      const section = sections.get(document.expertSectionId) ?? {
        order: document.expertSectionOrder ?? Number.MAX_SAFE_INTEGER,
        title:
          document.draftFileKind === "body"
            ? document.title
            : document.title.replace(/\s*·\s*人物状态$/u, ""),
        wordCountRequirement: document.expertWordCountRequirement ?? "",
        hasBody: false,
        hasCharacterState: false
      };
      if (document.draftFileKind === "body") {
        section.title = document.title;
        section.wordCountRequirement =
          document.expertWordCountRequirement ?? "";
        section.hasBody = true;
      } else {
        section.hasCharacterState = true;
      }
      sections.set(document.expertSectionId, section);
    }
    const complete = [...sections.entries()]
      .filter(([, section]) => section.hasBody && section.hasCharacterState)
      .sort((left, right) => left[1].order - right[1].order);
    if (complete.length === 0) return undefined;
    return createExpertDraftDirectoryRevision(
      complete.map(([sectionId, section]) => ({
        id: sectionId,
        title: section.title,
        wordCountRequirement: section.wordCountRequirement
      }))
    );
  }

  function draftSectionCreationOperationId(
    proposal: AgentEditProposal
  ): string {
    return [
      "agent-draft-sections",
      proposal.proposedRevision,
      proposal.runId.slice(-120),
      proposal.id.slice(-240)
    ].join(":");
  }

  async function acceptDraftSectionCreationProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.draftSectionCreationTarget;
    if (!target || target.sections.length === 0) {
      const message = "待审阅的章节创建缺少完整参数，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = "桌面文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    if (!directory || !book) {
      const message = "目标正文目录已不可用，无法创建章节。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const currentDirectoryRevision = currentExpertDraftDirectoryRevision(
      proposal.workspaceId
    );
    const expectedDirectoryRevision =
      expectedDraftSectionCreationBaseRevision(proposal);
    const commitPlan = resolveDraftSectionCreationCommitPlan({
      currentDirectoryRevision,
      expectedDirectoryRevision,
      capturedBaseProjectRevision: target.baseProjectRevision,
      currentProjectRevision: book.projectRevision
    });
    if (commitPlan.mode === "conflict") {
      const message =
        "正文目录已发生变化，未创建章节，请基于最新目录重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const requiresIdempotentRecoveryProbe =
      commitPlan.mode === "idempotent-recovery";
    if (
      !requiresIdempotentRecoveryProbe &&
      directory.sections.length + target.sections.length > 100
    ) {
      const message = "创建后将超过正文最多 100 个章节的限制。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const existingTitles = new Set(
      directory.sections.map((section) => section.title)
    );
    const duplicateTitle = requiresIdempotentRecoveryProbe
      ? undefined
      : target.sections.find((section) => existingTitles.has(section.title))
          ?.title;
    if (duplicateTitle) {
      const message = `正文目录已存在同名章节“${duplicateTitle}”，未重复创建。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const resolvedAfterSectionId = target.afterSectionId
      ? resolveProvisionalExpertSectionId(
          request.runId,
          proposal.workspaceId,
          target.afterSectionId
        )
      : undefined;
    if (
      !requiresIdempotentRecoveryProbe &&
      resolvedAfterSectionId &&
      !directory.sections.some(
        (section) => section.id === resolvedAfterSectionId
      )
    ) {
      const message = "指定的章节插入位置已不存在，未创建章节。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到作品正在保存其他内容，实时自动建章已暂停，请稍后人工重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并创建空白章节文件…"
        : "正在校验目录版本并创建空白章节文件…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let lastCreatedSectionId: string | undefined;
    const createdMapping = new Map<string, string>();
    try {
      const created = await currentApi.catalog.createDraftSections({
        operationId: draftSectionCreationOperationId(proposal),
        bookId: proposal.workspaceId,
        ...(resolvedAfterSectionId
          ? { afterSectionId: resolvedAfterSectionId }
          : {}),
        ...(commitPlan.baseProjectRevision === undefined
          ? {}
          : { baseProjectRevision: commitPlan.baseProjectRevision }),
        sections: target.sections.map((section) => ({
          clientSectionId: section.provisionalSectionId,
          title: section.title,
          ...(section.wordCountRequirement
            ? { wordCountRequirement: section.wordCountRequirement }
            : {})
        }))
      });
      const createdCount = created.sections.length;
      for (const result of created.sections) {
        lastCreatedSectionId = result.section.id;
        createdMapping.set(result.clientSectionId, result.section.id);
        rememberProvisionalExpertSectionMapping(
          request.runId,
          proposal.workspaceId,
          result.clientSectionId,
          result.section.id
        );
      }
      await saveCreatedDraftSectionContents(currentApi.catalog, {
        bookId: proposal.workspaceId,
        requested: target.sections,
        created: created.sections,
        projectRevision: created.projectRevision
      });
      await loadCatalogSnapshot();
      const savedDirectoryRevision = currentExpertDraftDirectoryRevision(
        proposal.workspaceId
      );
      if (!savedDirectoryRevision) {
        throw new Error("创建完成后无法读取最新正文目录版本。");
      }
      rememberAcceptedDraftSectionCreation(proposal, savedDirectoryRevision);
      remapProvisionalExpertSectionFileProposals(
        conversation,
        request.runId,
        proposal.workspaceId,
        createdMapping
      );
      const refreshedDirectory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === proposal.workspaceId
      );
      if (refreshedDirectory && !automatic) {
        selectedResourceId.value = refreshedDirectory.id;
        activeCreationResourceId.value = refreshedDirectory.id;
        if (lastCreatedSectionId) {
          selectedExpertSectionIds.value = {
            ...selectedExpertSectionIds.value,
            [refreshedDirectory.id]: lastCreatedSectionId
          };
          selectedDraftFileKinds.value = {
            ...selectedDraftFileKinds.value,
            [refreshedDirectory.id]: "body"
          };
        }
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        draftSectionCreationTarget: {
          ...target,
          acceptedDirectoryRevision: savedDirectoryRevision,
          sections: target.sections.map((section) => ({
            ...section,
            ...(createdMapping.get(section.provisionalSectionId)
              ? {
                  realSectionId: createdMapping.get(
                    section.provisionalSectionId
                  )!
                }
              : {})
          }))
        },
        statusMessage: automatic
          ? `已自动批准并创建 ${createdCount} 个章节；随创建提交的正文与人物状态已一并保存。`
          : `已创建 ${createdCount} 个章节，并保存随创建提交的正文与人物状态。`
      });
      if (!automatic) {
        uiMessage.success(`已创建 ${createdCount} 个空白章节文件`);
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message =
        error instanceof Error ? error.message : "创建空白章节失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      if (conflict) {
        conflictDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          "关联的空白章节确认未能创建，相关正文写入已取消。"
        );
      } else {
        pauseDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          "章节创建结果尚未确认，正文内容已保留；请先重试章节创建。"
        );
      }
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function acceptDraftSectionRenameProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.draftSectionRenameTarget;
    if (!target) {
      const message = "待审阅的章节改名缺少完整参数，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = "桌面文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    const bodyDocument = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === proposal.workspaceId &&
        document.stageId === "draft" &&
        document.expertSectionId === target.sectionId &&
        document.draftFileKind === "body" &&
        document.catalogDocumentId
    );
    if (!directory || !book || !bodyDocument?.catalogDocumentId) {
      const message = "目标章节已不可用，无法修改名称。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const section = directory.sections.find(
      (candidate) => candidate.id === target.sectionId
    );
    if (!section) {
      const message = "目标章节已不存在，无法修改名称。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const currentDirectoryRevision = currentExpertDraftDirectoryRevision(
      proposal.workspaceId
    );
    const expectedDirectoryRevision =
      expectedDraftSectionCreationBaseRevision(proposal);
    if (currentDirectoryRevision !== expectedDirectoryRevision) {
      const message =
        "正文目录已发生变化，未修改章节名称，请基于最新目录重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (section.title !== target.previousTitle) {
      if (section.title === target.title) {
        rememberAcceptedDraftSectionCreation(
          proposal,
          currentDirectoryRevision ?? proposal.baseRevision
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "accepted",
          proposedText: undefined,
          statusMessage: automatic
            ? `章节名称已是「${target.title}」，无需重复保存。`
            : `章节名称已是「${target.title}」，无需重复保存。`
        });
        return;
      }
      const message = `章节「${target.previousTitle}」的当前标题已变化，未应用本次改名。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (
      directory.sections.some(
        (candidate) =>
          candidate.id !== target.sectionId && candidate.title === target.title
      )
    ) {
      const message = `正文目录已存在同名章节「${target.title}」，未修改名称。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到作品正在保存其他内容，实时自动改名已暂停，请稍后人工重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并修改章节名称…"
        : "正在校验目录版本并修改章节名称…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      // Rename must preserve on-disk body bytes; dirty editor drafts stay local.
      const diskContent = bodyDocument.content;
      const saved = await currentApi.catalog.saveDocument({
        bookId: proposal.workspaceId,
        documentId: bodyDocument.catalogDocumentId,
        title: target.title,
        content: diskContent,
        baseRevision: createShortWorkspaceContentRevision(diskContent),
        ...(book.projectRevision === undefined
          ? {}
          : { baseProjectRevision: book.projectRevision })
      });
      applyAcceptedAgentDocumentLocally(
        {
          id: bodyDocument.id,
          title: saved.title,
          content: saved.content
        },
        saved.projectRevision,
        undefined
      );
      const expectedDocuments = captureWorkspaceDocumentBaselines(
        documents.value,
        proposal.workspaceId
      );
      await refreshBookAfterSuccessfulDocumentSave(
        proposal.workspaceId,
        expectedDocuments,
        saved.projectRevision
      );
      const draft = editorDrafts.value[bodyDocument.id];
      if (draft) {
        editorDrafts.value = {
          ...editorDrafts.value,
          [bodyDocument.id]: {
            ...draft,
            title: saved.title
          }
        };
      }
      const characterStateDocument = liveWorkspaceDocuments.value.find(
        (document) =>
          document.workspaceId === proposal.workspaceId &&
          document.stageId === "draft" &&
          document.expertSectionId === target.sectionId &&
          document.draftFileKind === "character-state"
      );
      const characterDraft = characterStateDocument
        ? editorDrafts.value[characterStateDocument.id]
        : undefined;
      if (characterStateDocument && characterDraft) {
        editorDrafts.value = {
          ...editorDrafts.value,
          [characterStateDocument.id]: {
            ...characterDraft,
            title: draftCharacterStateTitle(saved.title)
          }
        };
      }
      const savedDirectoryRevision = currentExpertDraftDirectoryRevision(
        proposal.workspaceId
      );
      if (!savedDirectoryRevision) {
        throw new Error("改名完成后无法读取最新正文目录版本。");
      }
      rememberAcceptedDraftSectionCreation(proposal, savedDirectoryRevision);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: automatic
          ? `已自动批准并将章节「${target.previousTitle}」改名为「${target.title}」。`
          : `已将章节「${target.previousTitle}」改名为「${target.title}」并保存到本机。`
      });
      if (!automatic) {
        uiMessage.success(`已将章节改名为「${target.title}」`);
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message =
        error instanceof Error ? error.message : "修改章节名称失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function conflictDependentDeletedSectionProposals(
    conversation: AgentConversationController,
    runId: string,
    sectionId: string,
    message: string,
    exceptProposalId?: string
  ): void {
    const bodyId = catalogDraftBodyDocumentId(sectionId);
    const stateId = catalogDraftCharacterStateDocumentId(sectionId);
    for (const candidate of conversation.listEditProposals(runId)) {
      if (exceptProposalId && candidate.id === exceptProposalId) continue;
      if (
        candidate.status !== "pending" &&
        candidate.status !== "error" &&
        candidate.status !== "accepting"
      ) {
        continue;
      }
      const targetsDeletedSection =
        candidate.documentId === bodyId ||
        candidate.documentId === stateId ||
        candidate.draftSectionRenameTarget?.sectionId === sectionId ||
        (candidate.draftSectionDeletionTarget?.sectionId === sectionId &&
          candidate.id !== exceptProposalId);
      if (!targetsDeletedSection) continue;
      removeQueuedAgentEdit(conversation, runId, candidate.id);
      conversation.updateEditProposal(runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
    }
  }

  async function acceptDraftSectionDeletionProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.draftSectionDeletionTarget;
    if (!target) {
      const message = "待审阅的章节删除缺少完整参数，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = "桌面文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    if (!directory || !book) {
      const message = "目标正文目录已不可用，无法删除章节。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const section = directory.sections.find(
      (candidate) => candidate.id === target.sectionId
    );
    if (!section) {
      rememberAcceptedDraftSectionCreation(
        proposal,
        currentExpertDraftDirectoryRevision(proposal.workspaceId) ??
          proposal.baseRevision
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: `章节「${target.title}」已不存在，无需重复删除。`
      });
      conflictDependentDeletedSectionProposals(
        conversation,
        request.runId,
        target.sectionId,
        "目标章节已删除，相关正文变更无法落盘。",
        request.proposalId
      );
      return;
    }
    if (section.title !== target.title) {
      const message = `章节「${target.title}」的当前标题已变化，未应用本次删除。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (directory.sections.length <= 1) {
      const message = "正文至少需要保留一个章节，未删除。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const currentDirectoryRevision = currentExpertDraftDirectoryRevision(
      proposal.workspaceId
    );
    const expectedDirectoryRevision =
      expectedDraftSectionCreationBaseRevision(proposal);
    if (currentDirectoryRevision !== expectedDirectoryRevision) {
      const message =
        "正文目录已发生变化，未删除章节，请基于最新目录重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到作品正在保存其他内容，实时自动删除已暂停，请稍后人工重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并删除章节…"
        : "正在校验目录版本并删除章节…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const removedIndex = directory.sections.findIndex(
        (candidate) => candidate.id === target.sectionId
      );
      const fallbackSections = directory.sections.filter(
        (candidate) => candidate.id !== target.sectionId
      );
      const fallbackSection =
        fallbackSections[Math.min(removedIndex, fallbackSections.length - 1)];
      const deleted = await currentApi.catalog.deleteDraftSection({
        bookId: proposal.workspaceId,
        sectionId: target.sectionId,
        ...(book.projectRevision === undefined
          ? {}
          : { baseProjectRevision: book.projectRevision })
      });
      if (!deleted.deleted) {
        throw new Error(`章节「${target.title}」已经不存在。`);
      }
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[section.bodyDocumentId];
      delete nextDrafts[section.characterStateDocumentId];
      editorDrafts.value = nextDrafts;
      for (const conversationKey of legacyDraftSectionConversationKeys(
        proposal.workspaceId,
        target.sectionId
      )) {
        removeConversation(conversationKey);
      }
      await loadCatalogSnapshot();
      if (!automatic) {
        selectedResourceId.value = directory.id;
        activeCreationResourceId.value = directory.id;
        if (fallbackSection) {
          selectedExpertSectionIds.value = {
            ...selectedExpertSectionIds.value,
            [directory.id]: fallbackSection.id
          };
        }
        selectedDraftFileKinds.value = {
          ...selectedDraftFileKinds.value,
          [directory.id]: "body"
        };
      }
      const savedDirectoryRevision = currentExpertDraftDirectoryRevision(
        proposal.workspaceId
      );
      if (!savedDirectoryRevision) {
        throw new Error("删除完成后无法读取最新正文目录版本。");
      }
      rememberAcceptedDraftSectionCreation(proposal, savedDirectoryRevision);
      conflictDependentDeletedSectionProposals(
        conversation,
        request.runId,
        target.sectionId,
        "目标章节已删除，相关正文变更无法落盘。",
        request.proposalId
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: automatic
          ? `已自动批准并删除章节「${target.title}」及其正文与人物状态文件。`
          : `已删除章节「${target.title}」及其正文与人物状态文件。`
      });
      if (!automatic) {
        uiMessage.success(`已删除“${target.title}”及对应人物状态文件`);
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message = error instanceof Error ? error.message : "删除章节失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function stageDraftSectionDirectoryProposal(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: AgentConversationController,
    runApprovalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean {
    const mutationTarget = event.payload.mutationTarget;
    if (mutationTarget?.kind === "expert-draft-section-creation") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      const currentRevision = currentExpertDraftDirectoryRevision(
        event.payload.workspaceId
      );
      // Same cursor as accept: same-run creates keep frozen baseRevision R0, but after
      // an earlier accept the live directory may already be R1/R2/...
      const expectedDirectoryRevision = expectedDraftSectionCreationRevision(
        event.payload.baseRevision,
        acceptedDraftSectionCreationRevisions.get(
          draftSectionCreationRevisionKey(
            event.payload.runId,
            event.payload.workspaceId
          )
        )
      );
      if (
        !directory ||
        !book ||
        currentRevision !== expectedDirectoryRevision
      ) {
        const message =
          "正文目录版本已变化，本次章节创建未进入审阅，也没有改动现有文件。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }

      const documentId = `draft-section-creation:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return true;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff("", proposedText);
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: `创建 ${mutationTarget.sections.length} 个空白章节`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionCreationTarget: {
          sections: mutationTarget.sections.map((section) => ({
            title: section.title,
            wordCountRequirement: section.wordCountRequirement,
            provisionalSectionId: section.provisionalSectionId,
            ...(section.bodyContent === undefined
              ? {}
              : { bodyContent: section.bodyContent }),
            ...(section.characterStateContent === undefined
              ? {}
              : { characterStateContent: section.characterStateContent })
          })),
          ...(mutationTarget.afterSectionId
            ? { afterSectionId: mutationTarget.afterSectionId }
            : {}),
          ...(book.projectRevision === undefined
            ? {}
            : { baseProjectRevision: book.projectRevision })
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }

    if (mutationTarget?.kind === "expert-draft-section-rename") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      const currentRevision = currentExpertDraftDirectoryRevision(
        event.payload.workspaceId
      );
      const expectedDirectoryRevision = expectedDraftSectionCreationRevision(
        event.payload.baseRevision,
        acceptedDraftSectionCreationRevisions.get(
          draftSectionCreationRevisionKey(
            event.payload.runId,
            event.payload.workspaceId
          )
        )
      );
      const section = directory?.sections.find(
        (candidate) => candidate.id === mutationTarget.sectionId
      );
      if (
        !directory ||
        !book ||
        !section ||
        currentRevision !== expectedDirectoryRevision
      ) {
        const message =
          "正文目录版本已变化，本次章节改名未进入审阅，也没有改动现有文件。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      if (section.title !== mutationTarget.previousTitle) {
        const message = `章节「${mutationTarget.previousTitle}」的当前标题已变化，本次改名未进入审阅。`;
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      if (
        directory.sections.some(
          (candidate) =>
            candidate.id !== mutationTarget.sectionId &&
            candidate.title === mutationTarget.title
        )
      ) {
        const message = `正文目录已存在同名章节「${mutationTarget.title}」，本次改名未进入审阅。`;
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }

      const documentId = `draft-section-rename:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return true;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff(
        mutationTarget.previousTitle,
        mutationTarget.title
      );
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: `修改章节名称：${mutationTarget.previousTitle} → ${mutationTarget.title}`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionRenameTarget: {
          sectionId: mutationTarget.sectionId,
          previousTitle: mutationTarget.previousTitle,
          title: mutationTarget.title,
          ...(book.projectRevision === undefined
            ? {}
            : { baseProjectRevision: book.projectRevision })
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }

    if (mutationTarget?.kind === "expert-draft-section-deletion") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      const currentRevision = currentExpertDraftDirectoryRevision(
        event.payload.workspaceId
      );
      const expectedDirectoryRevision = expectedDraftSectionCreationRevision(
        event.payload.baseRevision,
        acceptedDraftSectionCreationRevisions.get(
          draftSectionCreationRevisionKey(
            event.payload.runId,
            event.payload.workspaceId
          )
        )
      );
      const section = directory?.sections.find(
        (candidate) => candidate.id === mutationTarget.sectionId
      );
      if (
        !directory ||
        !book ||
        !section ||
        currentRevision !== expectedDirectoryRevision
      ) {
        const message =
          "正文目录版本已变化，本次章节删除未进入审阅，也没有改动现有文件。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      if (section.title !== mutationTarget.title) {
        const message = `章节「${mutationTarget.title}」的当前标题已变化，本次删除未进入审阅。`;
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }
      if (directory.sections.length <= 1) {
        const message = "正文至少需要保留一个章节，本次删除未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return true;
      }

      const documentId = `draft-section-deletion:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return true;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff(mutationTarget.title, "");
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: `删除章节：${mutationTarget.title}`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionDeletionTarget: {
          sectionId: mutationTarget.sectionId,
          title: mutationTarget.title,
          ...(book.projectRevision === undefined
            ? {}
            : { baseProjectRevision: book.projectRevision })
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return true;
    }
    return false;
  }

  return {
    expectedDraftSectionCreationBaseRevision,
    rememberAcceptedDraftSectionCreation,
    currentExpertDraftDirectoryRevision,
    draftSectionCreationOperationId,
    acceptDraftSectionCreationProposal,
    acceptDraftSectionRenameProposal,
    conflictDependentDeletedSectionProposals,
    acceptDraftSectionDeletionProposal,
    stageDraftSectionDirectoryProposal
  };
}
