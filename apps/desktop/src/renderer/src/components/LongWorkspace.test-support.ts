import { describe, expect, it } from "vitest";
import appSource from "../WorkspaceShell.vue?raw";
import conversationListSource from "./ConversationMessageList.vue?raw";
import conversationItemSource from "./ConversationMessageItem.vue?raw";
import processingTimelineSource from "./ConversationProcessingTimeline.vue?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import bindingsSource from "./LongBookBindingsDialog.vue?raw";
import chapterCardDialogSource from "./CreateLongChapterCardDialog.vue?raw";
import characterDialogSource from "./CreateLongCharacterDialog.vue?raw";
import characterNavigationSource from "./LongCharacterNavigation.vue?raw";
import continuityNavigationSource from "./LongContinuityLedgerNavigation.vue?raw";
import plotPointDialogSource from "./CreateLongPlotPointDialog.vue?raw";
import dialogSource from "./CreateBookDialog.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import editorSessionSource from "../composables/useLongEditorDocumentSession.ts?raw";
import editorStructureSource from "../composables/useLongEditorStructureSelection.ts?raw";
import editorDeleteSource from "../composables/useLongEditorDeleteDialogs.ts?raw";
import editorDeleteDialogsSource from "./LongEditorDeleteDialogs.vue?raw";
import longWorkspaceModuleSource from "./LongWorkspaceModule.vue?raw";
import manuscriptNavigationSource from "./LongManuscriptNavigation.vue?raw";
import worldbuildingNavigationSource from "./LongWorldbuildingNavigation.vue?raw";
import foreshadowingFiltersSource from "../composables/useForeshadowingFilters.ts?raw";
import foreshadowingMutationsSource from "../composables/useForeshadowingMutations.ts?raw";
import legacySyncSource from "./LongLegacySyncDialog.vue?raw";
import leftSidebarSource from "./LeftSidebar.vue?raw";
import proposalSource from "./LongProposalReview.vue?raw";
import removalSource from "./LongBookRemovalDialog.vue?raw";
import rollbackSource from "./LongRollbackDialog.vue?raw";
import sectionSource from "./TreeSection.vue?raw";
import structureSource from "./LongStructureManager.vue?raw";
import treeNodeSource from "./TreeNodeItem.vue?raw";
import workspaceDialogLayerSource from "./WorkspaceDialogLayer.vue?raw";
import longWorkspaceTypeSource from "../types/longWorkspace.ts?raw";
import workspaceTypeSource from "../types/workspace.ts?raw";
import writingOrchestratorSource from "../composables/useLongWritingOrchestrator.ts?raw";
import longConversationSource from "../composables/useLongConversationCoordinator.ts?raw";
import writingWorkflowSource from "../composables/useLongWritingWorkflowCoordinator.ts?raw";
import longBookLifecycleSource from "../composables/useLongBookLifecycleCoordinator.ts?raw";
import presentationCoordinatorSource from "../composables/useLongWorkspacePresentationCoordinator.ts?raw";
import longRollbackSource from "../composables/useLongRollbackCoordinator.ts?raw";
import longWorkspaceRefreshSource from "../composables/useLongWorkspaceRefreshCoordinator.ts?raw";
import longWorkspaceSessionSource from "../composables/useLongWorkspaceSessionCoordinator.ts?raw";
import longStructureTransactionsFacadeSource from "../composables/useLongStructureTransactionsCoordinator.ts?raw";
import longStructureTransactionsLeaseSource from "../composables/long-structure-transactions/lease.ts?raw";
import longStructureTransactionsTreeSource from "../composables/long-structure-transactions/tree.ts?raw";
import longStructureTransactionsCreateSource from "../composables/long-structure-transactions/create.ts?raw";
import longStructureTransactionsRenameSaveSource from "../composables/long-structure-transactions/rename-save.ts?raw";
import longStructureTransactionsDeleteSource from "../composables/long-structure-transactions/delete.ts?raw";
import longStructureTransactionsSyncSource from "../composables/long-structure-transactions/sync.ts?raw";
const longStructureTransactionsSource = [
  longStructureTransactionsLeaseSource,
  longStructureTransactionsTreeSource,
  longStructureTransactionsCreateSource,
  longStructureTransactionsRenameSaveSource,
  longStructureTransactionsDeleteSource,
  longStructureTransactionsSyncSource,
  longStructureTransactionsFacadeSource
].join("\n");
import lazyLongStructureTransactionsSource from "../composables/useLazyLongStructureTransactionsCoordinator.ts?raw";
import dialogCoordinatorSource from "../composables/useWorkspaceDialogModuleCoordinator.ts?raw";
import resourceTreeCoordinatorSource from "../composables/useWorkspaceResourceTreeCoordinator.ts?raw";
import featureHostCoordinatorSource from "../composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import workspaceSystemEventRoutesSource from "../events/registerWorkspaceSystemEventRoutes.ts?raw";
import conversationStoreSource from "../stores/conversationStore.ts?raw";
import longWorkspaceStoreSource from "../stores/longWorkspaceStore.ts?raw";
import agentRunPreferencesSource from "../utils/agentRunPreferences.ts?raw";
import longWorkspaceResourceTreeSource from "../utils/longWorkspaceResourceTree.ts?raw";
import writingWorkspaceSource from "./WritingWorkspaceModule.vue?raw";

const agentConversationSource = [
  conversationListSource,
  conversationItemSource,
  processingTimelineSource,
  processingItemSource
].join("\n");

export {
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
  longWorkspaceRefreshSource,
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
  writingWorkspaceSource
};
