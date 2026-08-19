import type { DeepWriteApi } from "@deepwrite/contracts";
import { createApplyReview } from "./proposal-coordinator/apply-review";
import { createCharacterStructureLane } from "./proposal-coordinator/character-structure-lane";
import { createDraftSectionLane } from "./proposal-coordinator/draft-section-lane";
import { createLibraryLane } from "./proposal-coordinator/library-lane";
import { createLongCharacterLane } from "./proposal-coordinator/long-character-lane";
import { createLongDraftLane } from "./proposal-coordinator/long-draft-lane";
import { createLongPlotLane } from "./proposal-coordinator/long-plot-lane";
import { createLongWorldbuildingLane } from "./proposal-coordinator/long-worldbuilding-lane";
import { createProvisionalSectionHelpers } from "./proposal-coordinator/provisional";
import { createProposalQueue } from "./proposal-coordinator/queue";
import type {
  ProposalCoordinatorContext as ProposalCoordinatorContextModel,
  ProposalLaneContext
} from "./proposal-coordinator/types";

export type {
  AgentEditReviewRequest,
  ProposalCoordinatorNotifications,
  ProposalLaneContext,
  QueuedAgentEdit
} from "./proposal-coordinator/types";

export interface ProposalCoordinatorContext
  extends ProposalCoordinatorContextModel {}

export function useProposalCoordinator(context: ProposalCoordinatorContext) {
  const { api, notifications: uiMessage } = context;
  const {
    snapshot: catalogSnapshot,
    projection: catalogProjection,
    catalogBook,
    findCatalogLibrary,
    loadSnapshot: loadCatalogSnapshot,
    applyAcceptedDocumentLocally: applyAcceptedAgentDocumentLocally,
    applyCreatedLibraryEntry,
    applySavedLibraryEntry,
    applyUpdatedLibrary: applyUpdatedCatalogLibrary,
    isConflict: isCatalogConflict,
    refreshBookAfterSave: refreshBookAfterSuccessfulDocumentSave
  } = context.catalog;
  const {
    documents,
    drafts: editorDrafts,
    liveDocuments: liveWorkspaceDocuments,
    selectedDraftFileKinds,
    selectedExpertSectionIds,
    acceptingWorkspaceIds: acceptingAgentEditWorkspaceIds,
    savingDocumentIds,
    rememberWorkspaceMutationEvent,
    setDocumentAccepting: setAgentEditDocumentAccepting,
    setWorkspaceAccepting: setAgentEditWorkspaceAccepting
  } = context.editor;
  const {
    active: activeConversation,
    activeLong: activeLongConversation,
    byKey: conversations,
    all: allConversations,
    remove: removeConversation,
    legacyDraftSectionKeys: legacyDraftSectionConversationKeys,
    forLongProposal: longConversationForProposalEvent
  } = context.conversations;
  const {
    activeBookId: activeLongBookId,
    books: longBooks,
    writingOrchestrator: longWritingOrchestrator,
    refreshWritingSaveBarrier: refreshLongWritingSaveBarrier,
    saveActiveEditorChanges: saveActiveLongEditorChanges
  } = context.longWorkspace;
  const {
    selectedResourceId,
    activeCreationResourceId,
    rightCollapsed
  } = context.navigation;

  const ctx = {
    api: (): DeepWriteApi | undefined => {
      const currentApi = api();
      return currentApi;
    },
    uiMessage,
    catalogSnapshot,
    catalogProjection,
    catalogBook,
    findCatalogLibrary,
    loadCatalogSnapshot,
    applyAcceptedAgentDocumentLocally,
    applyCreatedLibraryEntry,
    applySavedLibraryEntry,
    applyUpdatedCatalogLibrary,
    isCatalogConflict,
    refreshBookAfterSuccessfulDocumentSave,
    documents,
    editorDrafts,
    liveWorkspaceDocuments,
    selectedDraftFileKinds,
    selectedExpertSectionIds,
    acceptingAgentEditWorkspaceIds,
    savingDocumentIds,
    rememberWorkspaceMutationEvent,
    setAgentEditDocumentAccepting,
    setAgentEditWorkspaceAccepting,
    activeConversation,
    activeLongConversation,
    conversations,
    allConversations,
    removeConversation,
    legacyDraftSectionConversationKeys,
    longConversationForProposalEvent,
    activeLongBookId,
    longBooks,
    longWritingOrchestrator,
    refreshLongWritingSaveBarrier,
    saveActiveLongEditorChanges,
    selectedResourceId,
    activeCreationResourceId,
    rightCollapsed
  } as ProposalLaneContext;

  const queue = createProposalQueue(ctx);
  const provisional = createProvisionalSectionHelpers(ctx);
  const libraryLane = createLibraryLane(ctx);
  const draftSectionLane = createDraftSectionLane(ctx);
  const characterStructureLane = createCharacterStructureLane(ctx);
  const longWorldbuildingLane = createLongWorldbuildingLane(ctx);
  const longCharacterLane = createLongCharacterLane(ctx);
  const longPlotLane = createLongPlotLane(ctx);
  const longDraftLane = createLongDraftLane(ctx);
  const applyReview = createApplyReview(ctx);

  Object.assign(
    ctx,
    queue,
    provisional,
    libraryLane,
    draftSectionLane,
    characterStructureLane,
    longWorldbuildingLane,
    longCharacterLane,
    longPlotLane,
    longDraftLane,
    applyReview
  );

  return {
    resumeRecoveredAutomaticAgentEdits: (
      ...args: Parameters<typeof applyReview.resumeRecoveredAutomaticAgentEdits>
    ) => {
      if (!queue.isDisposed()) {
        applyReview.resumeRecoveredAutomaticAgentEdits(...args);
      }
    },
    hasQueuedAgentEdits: queue.hasQueuedAgentEdits,
    reviewAgentEdit: (...args: Parameters<typeof applyReview.reviewAgentEdit>) =>
      queue.invokeWhileActive(() => applyReview.reviewAgentEdit(...args)),
    reviewLongAgentEdit: (
      ...args: Parameters<typeof applyReview.reviewLongAgentEdit>
    ) => queue.invokeWhileActive(() => applyReview.reviewLongAgentEdit(...args)),
    scheduleQueuedAgentEdits: (
      ...args: Parameters<typeof queue.scheduleQueuedAgentEdits>
    ) => {
      if (!queue.isDisposed()) queue.scheduleQueuedAgentEdits(...args);
    },
    stageAgentEditProposal: (
      ...args: Parameters<typeof applyReview.stageAgentEditProposal>
    ) => {
      if (!queue.isDisposed()) applyReview.stageAgentEditProposal(...args);
    },
    stageLibraryEditProposal: (
      ...args: Parameters<typeof libraryLane.stageLibraryEditProposal>
    ) => {
      if (!queue.isDisposed()) libraryLane.stageLibraryEditProposal(...args);
    },
    stageLongCharacterEditProposal: (
      ...args: Parameters<typeof longCharacterLane.stageLongCharacterEditProposal>
    ) => {
      if (!queue.isDisposed()) {
        longCharacterLane.stageLongCharacterEditProposal(...args);
      }
    },
    stageLongDraftEditProposal: (
      ...args: Parameters<typeof longDraftLane.stageLongDraftEditProposal>
    ) => {
      if (!queue.isDisposed()) longDraftLane.stageLongDraftEditProposal(...args);
    },
    stageLongPlotDesignEditProposal: (
      ...args: Parameters<typeof longPlotLane.stageLongPlotDesignEditProposal>
    ) => {
      if (!queue.isDisposed()) {
        longPlotLane.stageLongPlotDesignEditProposal(...args);
      }
    },
    stageLongWorldbuildingEditProposal: (
      ...args: Parameters<typeof longWorldbuildingLane.stageLongWorldbuildingEditProposal>
    ) => {
      if (!queue.isDisposed()) {
        longWorldbuildingLane.stageLongWorldbuildingEditProposal(...args);
      }
    },
    drain: queue.drain,
    dispose: queue.dispose
  };
}

export type ProposalCoordinator = ReturnType<typeof useProposalCoordinator>;
