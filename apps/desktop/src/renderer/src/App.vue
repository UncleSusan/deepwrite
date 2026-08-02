<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { darkTheme, NConfigProvider } from "naive-ui";
import type {
  WorkspaceAgentTeamSettings,
  WorkspaceAgentTeamSettingsInput,
  Book,
  CatalogDocument,
  CatalogDraftRecovery,
  CatalogLibraryEntry,
  CatalogLibraryGroup,
  CatalogSnapshot,
  CreateLongBookInput,
  CreateLibraryInput,
  CreateLibraryGroupInput,
  CreateLibraryEntryInput,
  CreateScriptBookInput,
  CreateShortBookInput,
  GeneralPermissionMode,
  GeneralSettings,
  LearningImitationSettings,
  LearningImitationSettingsInput,
  LearningImitationStageId,
  LibraryAgentDomain,
  LibraryAgentSettings,
  LibraryAgentSettingsInput,
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  LongAgentProfile,
  LongAgentSettings,
  LongAgentSettingsInput,
  LongAgentTeamSettings,
  LongAgentTeamSettingsInput,
  LongArcId,
  LongBookSummary,
  LongChapterCardId,
  LongChapterReadiness,
  LongCharacterGroup,
  LongCharacterId,
  LongImportWriteClawResult,
  LongListBooksResult,
  LongOpenBookResult,
  LongFileId,
  LongFileRevision,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch,
  LongWorkspaceRoot,
  LongWorkspaceRuntimeContext,
  LongWriteDocumentResult,
  MaterialKind,
  MaterialLibraryKind,
  MaterialStageId,
  ModelConfigInput,
  ModelSettings,
  ModelSettingsInput,
  ModelUsageDashboard,
  ModelUsageQueryInput,
  CharacterStructureMutation,
  PlotStructureMutation,
  ShortManuscriptExportFormat,
  ShortWorkspaceAgentId,
  WorkspaceAgentSettings,
  WorkspaceAgentSettingsInput,
  SkillKind,
  SkillStageId,
  SystemEventEnvelope,
  ThinkingLevel,
  UpdateLibraryGroupInput,
  UserPromptAttachment,
  WorkspaceDirectorySettings
} from "@deepwrite/contracts";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_LONG_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  MATERIAL_KINDS,
  MaterialStageIdSchema,
  LongWorkspaceOperationBatchSchema,
  PROMPT_ATTACHMENT_MAX_ITEMS,
  SKILL_KINDS,
  SkillStageIdSchema,
  createDefaultGeneralSettings,
  createExpertDraftDirectoryRevision,
  createLongWorkspaceNavigationSnapshot,
  createShortWorkspaceContentRevision,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  isProvisionalExpertDraftSectionId,
  parseCatalogDraftDocumentId,
  getDefaultLongAgentProfile,
  resolveLongAgentIdForRoot,
  resolveShortWorkspaceAgentIdForStage
} from "@deepwrite/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import AgentTeamSettingsPanel from "./components/AgentTeamSettingsPanel.vue";
import AppIcon from "./components/AppIcon.vue";
import BookResourceDialog from "./components/BookResourceDialog.vue";
import BookTransferDialog from "./components/BookTransferDialog.vue";
import type {
  BookTransferAction,
  BookTransferDialogMode
} from "./components/BookTransferDialog.vue";
import CreateBookDialog from "./components/CreateBookDialog.vue";
import CreateLongChapterCardDialog from "./components/CreateLongChapterCardDialog.vue";
import CreateLongCharacterDialog from "./components/CreateLongCharacterDialog.vue";
import CreateLongPlotPointDialog from "./components/CreateLongPlotPointDialog.vue";
import CreateLongVolumeDialog from "./components/CreateLongVolumeDialog.vue";
import DeleteExpertSectionDialog from "./components/DeleteExpertSectionDialog.vue";
import ExportShortManuscriptDialog from "./components/ExportShortManuscriptDialog.vue";
import CharacterItemDialog from "./components/CharacterItemDialog.vue";
import LibraryProjectDialog from "./components/LibraryProjectDialog.vue";
import LibraryGroupDialog from "./components/LibraryGroupDialog.vue";
import LibraryRemovalDialog from "./components/LibraryRemovalDialog.vue";
import LearningImitationDialog from "./components/LearningImitationDialog.vue";
import LeftSidebar from "./components/LeftSidebar.vue";
import LongWorkspaceEditor from "./components/LongWorkspaceEditor.vue";
import LongBookBindingsDialog from "./components/LongBookBindingsDialog.vue";
import LongBookRemovalDialog from "./components/LongBookRemovalDialog.vue";
import LongMigrationReportDialog from "./components/LongMigrationReportDialog.vue";
import LongRollbackDialog from "./components/LongRollbackDialog.vue";
import LongStructureDialog from "./components/LongStructureDialog.vue";
import PlotStructureDialog, {
  type PlotStructureMutationCompletion
} from "./components/PlotStructureDialog.vue";
import RightEditorPane from "./components/RightEditorPane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
import SettingsPage from "./components/SettingsPage.vue";
import StartupAlertDialog from "./components/StartupAlertDialog.vue";
import WorkspaceDialog from "./components/WorkspaceDialog.vue";
import {
  useAgentConversation,
  type AgentConversationController,
  type AgentRunSettings
} from "./composables/useAgentConversation";
import { useAppearance } from "./composables/useAppearance";
import { useLearningImitation } from "./composables/useLearningImitation";
import {
  useLongWorkspaceProposals,
  type LongWorkspaceProposalEvent
} from "./composables/useLongWorkspaceProposals";
import {
  canApproveLongWritingProposal,
  useLongWritingOrchestrator,
  type LongWritingRunGuard
} from "./composables/useLongWritingOrchestrator";
import { useSubagentAuthoring } from "./composables/useSubagentAuthoring";
import { uiMessage } from "./ui-feedback";
import { resourceSections } from "./data/demoWorkspace";
import {
  MATERIAL_KIND_LABELS,
  SKILL_KIND_LABELS,
  projectCatalogWorkspace,
  resolveBookWorkspaceId,
  resolveDraftSectionResourceId,
  resolveDraftSectionProjection,
  resolvePreferredBookResourceId,
  type DraftDirectoryProjection
} from "./data/catalogWorkspace";
import type {
  AgentEditProposal,
  ComposerReferenceOption,
  EditorTextReference,
  EditorTextReferenceNavigation
} from "./types/conversation";
import type {
  BookResourceDialogMode,
  CatalogResourceNodeActionPayload,
  DialogMode,
  EditorDraftState,
  LongBookResourceNodeActionPayload,
  ResourceSectionActionPayload,
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "./types/workspace";
import {
  LONG_CHARACTER_GROUP_OPTIONS,
  createLongChapterCardVolumeSelection,
  createLongCharacterGroupSelection,
  createLongChapterSelection,
  createLongContinuitySelection,
  createLongPlotPointVolumeSelection,
  longBookIdFromResourceId,
  longBookResourceId,
  nextWritableLongChapterId,
  reconcileLongWorkspaceSelection,
  isLongMigrationEvidenceCategoryId,
  replaceLongBookSummary,
  resolveLongWorkspaceApi,
  type LongStructureMutationCompletion,
  type LongWorkspaceSelection
} from "./types/longWorkspace";
import {
  createLongStructureMutationBuilder,
  rebaseLongStructureBatchAfterDocumentSave
} from "./types/longStructureMutations";
import {
  applyBookResourcePreferences,
  BOOK_RESOURCE_PREFERENCES_STORAGE_KEY,
  parseBookResourcePreferences,
  type BookResourcePreference,
  type BookResourcePreferences
} from "./utils/bookResourcePreferences";
import {
  buildLongWorldbuildingSyncBatch,
  filterSyncableWorldbuildingCategories,
  loadSourceWorldbuildingContents,
  type LongWorldbuildingSyncBookOption
} from "./utils/longWorldbuildingSync";
import {
  buildLibraryAttachments,
  type LibraryAttachmentBuildResult
} from "./utils/libraryAttachments";
import { buildLibraryAgentWorkspaceContext, buildLibraryEntryComposerReferences } from "./utils/libraryAgentContext";
import { buildLibraryAgentSkillAttachments } from "./utils/libraryAgentSkillAttachments";
import { buildLongWorldbuildingFocusSnapshot } from "./utils/longWorldbuildingAgentContext";
import { buildLongCharacterFocusSnapshot } from "./utils/longCharacterAgentContext";
import { buildLongPlotFocusSnapshot } from "./utils/longPlotAgentContext";
import {
  captureWorkspaceDocumentBaselines,
  rebaseDraftsForMatchingDocuments,
  type WorkspaceDocumentBaseline
} from "./utils/catalogSaveReconciliation";
import { draftCharacterStateTitle } from "./utils/draftFileTitles";
import {
  advanceDraftSectionCreationRevision,
  draftSectionCreationRevisionKey,
  expectedDraftSectionCreationRevision,
  resolveDraftSectionCreationCommitPlan,
  type DraftSectionCreationRevisionCursor
} from "./utils/draftSectionCreationRevision";
import { migrateLegacyDraftRecoveries } from "./utils/legacyDraftRecovery";
import {
  resolveProvisionalWriteStagingMode
} from "./utils/provisionalExpertSectionStaging";
import { createShortManuscriptExportInput } from "./utils/shortManuscriptExport";
import {
  agentEditProposalGenerationId,
  agentEditProposalId,
  latestAgentEditProposalInLane,
  classifyAgentEditAcceptance,
  expectedMutationBaseRevision,
  expectedMutationDurableRevision,
  resolveAgentEditProposalGeneration,
  resolveAgentEditorMutationText
} from "./utils/agentEditReview";
import {
  beginAgentEditProposalCommit,
  createAgentEditProposalRevisionLane,
  stageAgentEditProposalRevision,
  type AgentEditProposalCommitSnapshot
} from "./utils/agentEditProposalRevisionLane";
import { createKeyedSerialTaskQueue } from "./utils/keyedSerialTaskQueue";
import {
  AGENT_RUN_PREFERENCES_STORAGE_KEY,
  activeAgentDocumentForSelection,
  agentConversationKeyForDocument as conversationKeyForDocument,
  agentRunScopeForDocument,
  parseAgentRunPreferences,
  type AgentRunPreferencesByScope
} from "./utils/agentRunPreferences";
import { buildAgentTextDiff } from "./utils/agentTextDiff";
import {
  loadGeneralPreferences,
  saveGeneralPreferences
} from "./utils/generalPreferences";
import {
  createLongWorkspaceRefreshClock,
  isMonotonicLongWorkspaceRefresh
} from "./utils/longWorkspaceRefresh";
import { findLongWorldbuildingFile } from "./utils/longWorldbuildingFiles";
import { matchesLongWritingProposalExpectation } from "./utils/longWritingEventExpectation";

const EMPTY_WORKSPACE_DOCUMENT: WorkspaceDocument = {
  id: "deepwrite-empty-workspace",
  domain: "creation",
  title: "尚未打开书籍",
  eyebrow: "创作空间",
  path: ["尚未打开书籍"],
  content: "请从左侧创作空间的“＋”菜单新建书籍，或打开一个已存在的 DeepWrite 书籍文件夹。",
  readOnly: true,
  format: "设定"
};

const EMPTY_RESOURCE_SECTIONS: ResourceTreeSection[] = resourceSections.map((section) => ({
  ...section,
  nodes: []
}));
const COMPOSER_STAGE_LABELS = {
  character_design: "人设",
  plot_design: "剧情",
  expert_draft_coordinator: "正文",
  expert_section_writer: "分节"
} as const satisfies Record<ShortWorkspaceAgentId, string>;
const LONG_WORKSPACE_ROOT_LABELS = {
  worldbuilding: "世界观",
  character_design: "人物设计",
  plot_design: "剧情设计",
  draft: "正文",
  continuity_ledger: "连续性账本"
} as const;
const LONG_WORKSPACE_ROOT_DESCRIPTIONS: Record<LongWorkspaceRoot, string> = {
  worldbuilding: "维护世界规则、势力、地理、历史、术语、境界与物品。",
  character_design: "维护人物核心档案与关系，查看最新状态和历史轨迹。",
  plot_design: "维护全书故事线、分卷、剧情点与章节卡。",
  draft: "按分卷和章卡顺序编辑正文。",
  continuity_ledger:
    "按章核验正文，并留存人物状态与历史、世界观揭露、伏笔变化、章末状态和接续包。"
};
const EDITOR_DRAFT_RECOVERY_KEY = "deepwrite:editor-draft-recovery:v1";
const EDITOR_AUTO_SAVE_DEBOUNCE_MS = 800;
const EDITOR_AUTO_SAVE_RETRY_MS = 250;
let draftRecoveryClock = 0;

function observeDraftRecoveryTimestamp(value: string | undefined): void {
  const timestamp = Date.parse(value ?? "");
  if (Number.isFinite(timestamp)) {
    draftRecoveryClock = Math.max(draftRecoveryClock, timestamp);
  }
}

function nextDraftRecoveryTimestamp(): string {
  draftRecoveryClock = Math.max(Date.now(), draftRecoveryClock + 1);
  return new Date(draftRecoveryClock).toISOString();
}

function loadEmergencyEditorDrafts(): Record<string, EditorDraftState> {
  try {
    const raw = localStorage.getItem(EDITOR_DRAFT_RECOVERY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const draft = value as Record<string, unknown>;
        if (
          draft.dirty !== true ||
          typeof draft.title !== "string" ||
          typeof draft.content !== "string"
        ) {
          return [];
        }
        return [[
          id,
          {
            title: draft.title,
            content: draft.content,
            dirty: true,
            ...(typeof draft.recoveryUpdatedAt === "string" &&
            Number.isFinite(Date.parse(draft.recoveryUpdatedAt))
              ? { recoveryUpdatedAt: draft.recoveryUpdatedAt }
              : {}),
            ...(typeof draft.baseRevision === "string"
              ? { baseRevision: draft.baseRevision }
              : {}),
            ...(typeof draft.baseProjectRevision === "number" &&
            Number.isSafeInteger(draft.baseProjectRevision) &&
            draft.baseProjectRevision >= 0
              ? { baseProjectRevision: draft.baseProjectRevision }
              : {})
          } satisfies EditorDraftState
        ]];
      })
    );
  } catch {
    return {};
  }
}

function loadAgentRunPreferences(): AgentRunPreferencesByScope {
  try {
    return parseAgentRunPreferences(
      localStorage.getItem(AGENT_RUN_PREFERENCES_STORAGE_KEY)
    );
  } catch {
    return {};
  }
}

function mergeRecoveredEditorDrafts(
  coreDrafts: CatalogDraftRecovery,
  emergencyDrafts: Record<string, EditorDraftState>,
  liveDrafts: CatalogDraftRecovery
): Record<string, EditorDraftState> {
  const merged: Record<string, EditorDraftState> = {};
  for (const source of [coreDrafts, emergencyDrafts, liveDrafts]) {
    for (const [id, draft] of Object.entries(source)) {
      if (!draft.dirty) continue;
      const existing = merged[id];
      observeDraftRecoveryTimestamp(existing?.recoveryUpdatedAt);
      observeDraftRecoveryTimestamp(draft.recoveryUpdatedAt);
      const existingTime = Date.parse(existing?.recoveryUpdatedAt ?? "");
      const candidateTime = Date.parse(draft.recoveryUpdatedAt ?? "");
      if (
        existing &&
        Number.isFinite(existingTime) &&
        (!Number.isFinite(candidateTime) || candidateTime < existingTime)
      ) {
        continue;
      }
      merged[id] = {
        title: draft.title,
        content: draft.content,
        dirty: true,
        recoveryUpdatedAt:
          draft.recoveryUpdatedAt ?? nextDraftRecoveryTimestamp(),
        ...(typeof draft.baseRevision === "string"
          ? { baseRevision: draft.baseRevision }
          : {}),
        ...(typeof draft.baseProjectRevision === "number"
          ? { baseProjectRevision: draft.baseProjectRevision }
          : {})
      };
    }
  }
  return merged;
}

const appearance = useAppearance();
const naiveTheme = computed(() =>
  appearance.resolvedScheme.value === "dark" ? darkTheme : null
);
const themeOverrides = computed(() => ({
  common: {
    primaryColor: appearance.activeTheme.value.accent,
    primaryColorHover: appearance.activeTheme.value.accent,
    primaryColorPressed: appearance.activeTheme.value.accent,
    borderRadius: "8px",
    fontFamily: "var(--ui-font)",
    fontSize: `${appearance.activeTheme.value.uiFontSize}px`
  }
}));

const leftCollapsed = ref(false);
const rightCollapsed = ref(false);
const desktopShell = ref<HTMLElement | null>(null);
const leftPaneWidth = ref(window.innerWidth <= 1220 ? 262 : 286);
const rightPaneWidth = ref(
  window.innerWidth <= 1220 ? 395 : Math.min(650, Math.max(410, window.innerWidth * 0.34))
);
const resizingPane = ref<"left" | "right" | null>(null);
// Keep the workspace unselected on launch. A resource ID is set only after the
// user explicitly opens a book or another resource from the tree.
const selectedResourceId = ref("");
const activeCreationResourceId = ref("");
const documents = ref<WorkspaceDocument[]>([{ ...EMPTY_WORKSPACE_DOCUMENT }]);
const editorDrafts = ref<Record<string, EditorDraftState>>({});
const legacyGeneralPreferences = loadGeneralPreferences(window.localStorage);
const generalSettings = ref<GeneralSettings>({
  ...createDefaultGeneralSettings(),
  autoSave: legacyGeneralPreferences.autoSave
});
const editorAutoSaveEnabled = ref(generalSettings.value.autoSave);
let generalSettingsSaveChain: Promise<void> = Promise.resolve();
const editorAutoSaveTimers = new Map<string, number>();
let editorSaveChain: Promise<void> = Promise.resolve();
const selectedExpertSectionIds = ref<Record<string, string>>({});
const selectedDraftFileKinds = ref<
  Record<string, "body" | "character-state">
>({});
const pendingEditorReferences = ref<EditorTextReference[]>([]);
const editorReferenceNavigation = ref<EditorTextReferenceNavigation>();
let editorReferenceNavigationClock = 0;
const acceptingAgentEditDocumentIds = ref<Set<string>>(new Set());
const acceptingAgentEditWorkspaceIds = ref<Set<string>>(new Set());
const savingDocumentIds = ref<Set<string>>(new Set());
let recoveredEditorDraftCount = 0;
const learningImitation = useLearningImitation({
  api: () => window.deepwrite
});
const learningImitationRunning = computed(
  () => learningImitation.isBusy.value
);
const subagentAuthoring = useSubagentAuthoring({
  api: () => window.deepwrite
});
const bookDialogMode = ref<BookResourceDialogMode | null>(null);
const activeBook = ref<ResourceTreeNode | null>(null);
const plotStructureBookId = ref<string | null>(null);
const characterItemDialog = ref<{
  mode: "create" | "rename" | "delete";
  bookId: string;
  itemId?: string;
  title: string;
} | null>(null);
const catalogSnapshot = ref<CatalogSnapshot | null>(null);
const catalogLoading = ref(false);
const catalogMutationPending = ref(false);
const manuscriptExportPending = ref(false);
const exportBookTarget = ref<ResourceTreeNode | null>(null);
const createBookDialogOpen = ref(false);
const bookTransferDialogMode = ref<BookTransferDialogMode | null>(null);
const longBooks = ref<LongBookSummary[]>([]);
const longCatalogDiagnostics = ref<
  NonNullable<LongListBooksResult["diagnostics"]>
>([]);
const activeLongBookId = ref<string | null>(null);
const activeLongWorkspaceIndex = ref<LongWorkspaceIndexSnapshot | null>(null);
const activeLongSelection = ref<LongWorkspaceSelection | null>(null);
const longWorkspaceEditor = ref<{
  saveAllChanges(): Promise<boolean>;
  selectBookLineVolume(volumeId: string): void;
  ensureDocumentsLoaded(
    files: LongWorkspaceSelection["files"]
  ): Promise<boolean>;
  synchronizeProjectRevisions(
    workspaceRevision: number,
    projectRevision: number
  ): void;
  synchronizeProjectRevisionsIfClean(
    bookId: string,
    workspaceRevision: number,
    projectRevision: number
  ): boolean;
} | null>(null);
const activeLongFileContext = ref<{
  bookId: string;
  fileId: LongFileId;
  fileRevision: LongFileRevision;
} | null>(null);
interface LongWorkspaceRefreshStatus {
  bookId: string;
  requestId: number;
  pending: boolean;
  error: string | null;
}
const longWorkspaceRefreshClock = createLongWorkspaceRefreshClock();
const longWorkspaceRefreshStatus =
  ref<LongWorkspaceRefreshStatus | null>(null);
const longCatalogLoading = ref(false);
const longCatalogLoadError = ref<string | null>(null);
let longCatalogRetryAttempts = 0;
let longCatalogRetryTimer: number | undefined;
let longCatalogRequestClock = 0;
let longCatalogLoadPromise: Promise<void> | null = null;
const longWorkspaceLoading = ref(false);
const longSendPreflightPending = ref(false);
const longMutationPending = ref(false);
const longProposalApprovalPending = ref(false);
const longRollbackDialogOpen = ref(false);
const longRollbackPending = ref(false);
const longRollbackCommitId = ref<string | null>(null);
const longStructureDialogOpen = ref(false);
const longCharacterCreate = ref<{
  bookId: string;
  group: LongCharacterGroup;
  groupLabel: string;
} | null>(null);
const longPlotPointCreate = ref<{
  bookId: string;
  volumeId: string;
  volumeTitle: string;
} | null>(null);
const longChapterCardCreate = ref<{
  bookId: string;
  volumeId: string;
  volumeTitle: string;
  arcOptions: Array<{ value: string; label: string }>;
} | null>(null);
const longVolumeCreateOpen = ref(false);
const longBindingsDialogMode = ref<"skill" | "material" | null>(null);
const longBookActionPending = ref(false);
const longBookRemovalDialog = ref<{
  action: "unregister" | "delete";
  bookId: string;
  title: string;
} | null>(null);
const longMigrationReport = ref<LongImportWriteClawResult | null>(null);
const seenLongCatalogDiagnosticKeys = new Set<string>();
let longOpenClock = 0;
interface LibraryProjectDialogState {
  operation: "create-library" | "create-entry" | "remove-entry";
  domain: "material" | "skill";
  libraryId?: string;
  libraryTitle?: string;
  entryId?: string;
  entryTitle?: string;
  documentId?: string;
  materialKind?: MaterialKind | "mixed";
  workspaceType?: "short" | "script" | "long";
}
type CreateLibraryEntryDraft =
  | Omit<Extract<CreateLibraryEntryInput, { domain: "material" }>, "content">
  | Omit<Extract<CreateLibraryEntryInput, { domain: "skill" }>, "content">;
const libraryProjectDialog = ref<LibraryProjectDialogState | null>(null);
interface LibraryGroupDialogState {
  domain: "material" | "skill";
  groupId?: string;
}
const libraryGroupDialog = ref<LibraryGroupDialogState | null>(null);
interface LibraryRemovalDialogState {
  action: "remove" | "delete";
  payload: CatalogResourceNodeActionPayload;
}
const libraryRemovalDialog = ref<LibraryRemovalDialogState | null>(null);
interface LibraryEntryClipboard {
  domain: "material" | "skill";
  title: string;
  content: string;
  stageId: MaterialStageId | SkillStageId;
  sourceLibraryId: string;
  sourceEntryId: string;
  workspaceType: "short" | "script" | "long";
}
const libraryEntryClipboard = ref<LibraryEntryClipboard | null>(null);
const libraryEntryClipboardDomain = computed(
  () => libraryEntryClipboard.value?.domain
);
const MATERIAL_KIND_ALLOWED_STAGES: Record<
  MaterialLibraryKind,
  readonly MaterialStageId[]
> = {
  character: ["character"],
  gimmick: ["gimmick"],
  plot: ["pacing", "intro", "plot_refine"],
  draft: ["draft_excerpt"],
  other: ["other"],
  mixed: [
    "gimmick",
    "character",
    "pacing",
    "intro",
    "plot_refine",
    "draft_excerpt",
    "other"
  ]
};
const activeLibraryGroup = computed<CatalogLibraryGroup | null>(() => {
  const state = libraryGroupDialog.value;
  if (!state?.groupId) return null;
  const groups =
    state.domain === "material"
      ? catalogSnapshot.value?.materialGroups
      : catalogSnapshot.value?.skillGroups;
  return groups?.find((group) => group.id === state.groupId) ?? null;
});
interface PendingExpertSectionDeletion {
  workspaceId: string;
  draftDirectoryId: string;
  sectionId: string;
  sectionTitle: string;
  hasContent: boolean;
  workspaceType: "short" | "script";
}

type CreateCreativeBookPayload =
  | ({ workspaceType: "short" } & CreateShortBookInput)
  | ({ workspaceType: "script" } & CreateScriptBookInput)
  | ({ workspaceType: "long" } & CreateLongBookInput);

const pendingExpertSectionDeletion = ref<PendingExpertSectionDeletion | null>(null);
interface SaveConflictState {
  documentId: string;
  payload: { id: string; title: string; content: string };
  latestSnapshot: CatalogSnapshot;
  diskTitle: string;
  diskContent: string;
}
const saveConflict = ref<SaveConflictState | null>(null);
const saveConflictSubmitting = ref(false);
const currentView = ref<"workspace" | "settings">("workspace");
type WorkspaceMainView = "conversation" | "directory" | "models" | "imitation" | "agent-team";
const workspaceMainView = ref<WorkspaceMainView>("conversation");
const activePrimaryFeature = computed<
  "directory" | "models" | "imitation" | "agent-teams" | undefined
>(() =>
  workspaceMainView.value === "agent-team"
    ? "agent-teams"
    : workspaceMainView.value === "conversation"
      ? undefined
      : workspaceMainView.value
);
const modelSettings = ref<ModelSettings | null>(null);
const modelLoading = ref(false);
const modelSaving = ref(false);
const freeModelsRefreshing = ref(false);
const modelError = ref<string | null>(null);
const modelTestMessage = ref<string | null>(null);
const testingModelId = ref<string | null>(null);
const modelAlertMessages = ref<string[]>([
  "官方模型已经上线！直连厂商！软件整体用量越多，折扣会越大！"
]);
const startupAlertMessages = ref<string[]>([]);
const startupAlertRevision = ref("");
const modelUsageDashboard = ref<ModelUsageDashboard | null>(null);
const modelUsageLoading = ref(false);
const modelUsageError = ref<string | null>(null);
const modelUsageQuery = ref<ModelUsageQueryInput>({});
let modelUsageRequestSequence = 0;
const officialModelUsageDashboard = ref<ModelUsageDashboard | null>(null);
const officialModelsLoading = ref(false);
const officialModelsSaving = ref(false);
let officialModelsRequestSequence = 0;
const workspaceAgentSettings = ref<WorkspaceAgentSettings[]>([
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS
]);
const longAgentSettings = ref<LongAgentSettings>(
  structuredClone(DEFAULT_LONG_AGENT_SETTINGS)
);
const agentTeamSettings = ref<WorkspaceAgentTeamSettings[]>([]);
const longAgentTeamSettings = ref<LongAgentTeamSettings>(
  structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS)
);
const agentTeamLoading = ref(false);
const agentTeamSaving = ref(false);
const agentTeamLoaded = ref(false);
const agentTeamLoadError = ref<string | null>(null);
const longAgentTeamLoading = ref(false);
const longAgentTeamSaving = ref(false);
const longAgentTeamLoaded = ref(false);
const longAgentTeamLoadError = ref<string | null>(null);
const workspaceAgentLoading = ref(false);
const workspaceAgentSaving = ref(false);
const longAgentLoading = ref(false);
const longAgentSaving = ref(false);
const longAgentLoaded = ref(false);
const longAgentLoadError = ref<string | null>(null);
let longAgentLoadPromise: Promise<boolean> | null = null;
const libraryAgentSettings = ref<LibraryAgentSettings>({
  agents: DEFAULT_LIBRARY_AGENT_PROFILES.map((agent) => ({
    ...agent,
    readAccess: {
      skills: agent.readAccess.skills.map((skill) => ({ ...skill }))
    }
  }))
});
const libraryAgentLoading = ref(false);
const libraryAgentSaving = ref(false);
const learningImitationSettings = ref<LearningImitationSettings | null>(null);
const learningImitationLoading = ref(false);
const learningImitationSaving = ref(false);
const workspaceDirectoryPath = ref<string | null>(null);
const workspaceDirectoryLoading = ref(false);
let draftRecoveryTimer: number | undefined;
let draftPersistenceWarningShown = false;
let conversationPersistenceWarningShown = false;
let agentRunPreferenceWarningShown = false;
let removeSystemListener: (() => void) | undefined;
const conversations = new Map<string, AgentConversationController>();
const conversationScopes = new Map<string, string>();
const agentRunPreferences = ref<AgentRunPreferencesByScope>(
  loadAgentRunPreferences()
);
const seenCatalogDiagnosticKeys = new Set<string>();
const warnedUnmappedLegacyRecoveryKeys = new Set<string>();
const handledWorkspaceMutationEventIds = new Set<string>();
interface QueuedAgentEdit {
  conversation: AgentConversationController;
  sessionId: string;
  runId: string;
  proposalId: string;
  workspaceId: string;
  automatic: boolean;
  expectedProposedRevision: string;
  decisionToken: string;
  snapshot: AgentEditProposalCommitSnapshot<AgentEditProposal>;
}
const queuedAgentEdits = new Map<string, QueuedAgentEdit>();
const agentEditCommitQueue = createKeyedSerialTaskQueue<string>();
let agentEditDecisionSequence = 0;
const acceptedLibraryMutationCounts = new Map<string, number>();
const acceptedDraftSectionCreationRevisions = new Map<
  string,
  DraftSectionCreationRevisionCursor
>();
/** runId\0workspaceId → provisionalSectionId → real catalog section id */
const acceptedProvisionalExpertSectionIds = new Map<string, Map<string, string>>();
interface LongWritingAgentRunExpectation {
  bookId: string;
  chapterCardId: string;
  agentId: "expert_section_writer" | "continuity_ledger";
  sessionId: string;
  runId?: string;
  proposalSeen: boolean;
  terminalError?: string;
}
let longWritingAgentRunExpectation:
  | LongWritingAgentRunExpectation
  | null = null;
const longWritingOrchestrator = useLongWritingOrchestrator({
  resolveReadiness: resolveLiveLongChapterReadiness,
  startWriter: startFreshLongChapterWriter,
  startLedger: startFreshLongContinuityLedger,
  saveBarrier: refreshLongWritingSaveBarrier,
  notifications: uiMessage
});
const longWorkspaceProposals = useLongWorkspaceProposals({
  api: resolveLongWorkspaceApi,
  acceptsEvent: acceptsLongProposalEvent,
  approvalModeForEvent: longProposalApprovalMode,
  prepareAutoApprove: prepareAutomaticLongProposal,
  canFinalizeContinuity: canApproveLongProposalDuringActivePlan,
  onContinuityFinalizationFailed: (event, message) => {
    if (!canApproveLongProposalDuringActivePlan(event)) return false;
    return longWritingOrchestrator.handleRunFailure(
      "continuity_ledger",
      `文件已保存，但自动归档失败：${message}`
    );
  },
  onApplied: handleLongProposalApplied,
  onDispatchApproved: handleLongChapterDispatchApproved,
  onRejected: (event) => {
    if (!canApproveLongProposalDuringActivePlan(event)) return;
    if (event.payload.agentId === "continuity_ledger") {
      longWritingOrchestrator.handleRejected(event);
    }
  },
  notifications: uiMessage
});

const catalogProjection = computed(() =>
  catalogSnapshot.value ? projectCatalogWorkspace(catalogSnapshot.value) : null
);

const baseResourceSections = computed<ResourceTreeSection[]>(() => {
  const projected = catalogProjection.value?.resourceSections;
  if (!projected) {
    return EMPTY_RESOURCE_SECTIONS;
  }
  return projected;
});

function loadBookResourcePreferences(): BookResourcePreferences {
  try {
    return parseBookResourcePreferences(
      localStorage.getItem(BOOK_RESOURCE_PREFERENCES_STORAGE_KEY),
      baseResourceSections.value
    );
  } catch {
    return {};
  }
}

const bookResourcePreferences = ref<BookResourcePreferences>(loadBookResourcePreferences());

function longNavigationNodeId(bookId: string, key: string): string {
  return `${longBookResourceId(bookId)}:${key}`;
}

function createLongRootSelection(
  book: LongBookSummary,
  root: LongWorkspaceRoot
): LongWorkspaceSelection {
  const label = LONG_WORKSPACE_ROOT_LABELS[root];
  return {
    key: `root:${root}`,
    root,
    title: label,
    breadcrumbs: [book.title, label],
    files: [],
    preferredRole: "content",
    description: LONG_WORKSPACE_ROOT_DESCRIPTIONS[root]
  };
}

function projectLongWorkspaceNavigation(
  book: LongBookSummary,
  index?: LongWorkspaceIndexSnapshot | null
): ResourceTreeNode[] {
  const node = (
    selection: LongWorkspaceSelection,
    options: {
      icon: NonNullable<ResourceTreeNode["icon"]>;
      label?: string;
      badge?: string;
      children?: ResourceTreeNode[];
      longCharacterGroup?: LongCharacterGroup;
    }
  ): ResourceTreeNode => ({
    id: longNavigationNodeId(book.id, selection.key),
    label: options.label ?? selection.title,
    icon: options.icon,
    ...(options.badge ? { badge: options.badge } : {}),
    ...(options.children?.length ? { children: options.children } : {}),
    ...(options.longCharacterGroup
      ? { longCharacterGroup: options.longCharacterGroup }
      : {}),
    selectableBranch: Boolean(options.children?.length),
    workspaceType: "long",
    longBookId: book.id,
    catalogNodeType: "category",
    longWorkspaceSelection: selection
  });

  const reconcile = (
    selection: LongWorkspaceSelection
  ): LongWorkspaceSelection | undefined =>
    index
      ? reconcileLongWorkspaceSelection(book, index, selection)
      : selection;

  // Long book summaries already contain the lightweight navigation needed by
  // the resource tree. Render it before the book is opened, then reconcile
  // the selection against the complete index when a user selects an item.
  // This keeps the first render consistent with short/script books without
  // loading every long project's file references or document contents.
  const worldRevealSelection = reconcile({
    key: "worldbuilding:reveals",
    root: "worldbuilding",
    title: "世界观揭露",
    breadcrumbs: [book.title, "世界观", "世界观揭露"],
    files: [],
    preferredRole: "world-reveals",
    description: "映射最近一次已提交章节记录中的世界观揭露。"
  });
  const worldChildren = [
    ...[...book.navigation.worldbuilding]
      .sort((left, right) => left.order - right.order)
      .flatMap((category) => {
        const selection = reconcile({
          key: `worldbuilding:${category.id}`,
          root: "worldbuilding",
          title: category.title,
          breadcrumbs: [book.title, "世界观", category.title],
          files: [],
          preferredRole: "content",
          description:
            category.format === "list"
              ? "列表型世界设定。"
              : "文本型世界设定。"
        });
        return selection
          ? [
              node(selection, {
                icon: "file",
                badge: category.format === "list" ? "列表" : "文本"
              })
            ]
          : [];
      }),
    ...(worldRevealSelection
      ? [
          node(worldRevealSelection, {
            icon: "file",
            label: "世界观揭露"
          })
        ]
      : [])
  ];

  const characterOverviewSelection = reconcile({
    key: "character-overview",
    root: "character_design",
    title: "概览",
    breadcrumbs: [book.title, "人物设计", "概览"],
    files: [],
    preferredRole: "overview",
    description:
      "人物设计阶段概览；统计全部人物的简单信息，供智能体先读后定位。"
  });
  const characterGroupChildren = LONG_CHARACTER_GROUP_OPTIONS.map((group) => {
    const characterCount = book.navigation.characters.filter(
      (character) => character.group === group.value
    ).length;
    const selection = reconcile({
      key: `character-group:${group.value}`,
      root: "character_design",
      characterGroup: group.value,
      title: group.label,
      breadcrumbs: [book.title, "人物设计", group.label],
      files: [],
      preferredRole: "core-profile",
      description: `管理${group.label}人物；使用右侧人物标签栏的加号新建人物。`
    });
    const groupSelection = selection ?? {
      key: `character-group:${group.value}`,
      root: "character_design" as const,
      title: group.label,
      breadcrumbs: [book.title, "人物设计", group.label],
      files: [],
      preferredRole: "core-profile" as const
    };
    return node(groupSelection, {
      icon: "folder",
      label: group.label,
      badge: String(characterCount),
      longCharacterGroup: group.value
    });
  });
  const characterChildren = [
    ...(characterOverviewSelection
      ? [
          node(characterOverviewSelection, {
            icon: "file",
            label: "概览"
          })
        ]
      : []),
    ...characterGroupChildren
  ];

  const bookLineSelection = reconcile({
    key: "plot-design:book-line",
    root: "plot_design",
    title: "全书故事线",
    breadcrumbs: [book.title, "剧情设计", "全书故事线"],
    files: [],
    preferredRole: "book-line",
    description: "全书级情节主线。"
  });
  const foreshadowingSelection = reconcile({
    key: "plot-design:foreshadowing",
    root: "plot_design",
    title: "伏笔总览",
    breadcrumbs: [book.title, "剧情设计", "伏笔总览"],
    files: [],
    preferredRole: "book-line",
    description:
      "集中管理伏笔线，并查看各卷、各剧情点中的伏笔触点。"
  });
  const plotPointVolumeChildren: ResourceTreeNode[] = [
    ...book.navigation.volumes
  ]
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    )
    .map((volume) => {
      const plotPointCount = book.navigation.arcs.filter(
        (arc) => arc.volumeId === volume.id
      ).length;
      const selection = reconcile({
        key: `plot-design:plot-points:${volume.id}`,
        root: "plot_design",
        plotPointVolumeId: volume.id,
        title: volume.title,
        breadcrumbs: [
          book.title,
          "剧情设计",
          "剧情点",
          volume.title
        ],
        files: [],
        preferredRole: "book-line",
        description: `${volume.title}共有 ${plotPointCount} 个剧情点。`
      });
      const volumeSelection = selection ?? {
        key: `plot-design:plot-points:${volume.id}`,
        root: "plot_design" as const,
        plotPointVolumeId: volume.id,
        title: volume.title,
        breadcrumbs: [
          book.title,
          "剧情设计",
          "剧情点",
          volume.title
        ],
        files: [],
        preferredRole: "book-line" as const
      };
      return node(volumeSelection, {
        icon: "folder",
        label: volume.title,
        badge: `${plotPointCount} 点`
      });
    });

  const chapterCardManagementChildren: ResourceTreeNode[] =
    [...book.navigation.volumes]
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      )
      .map((volume) => {
        const chapters = book.navigation.chapterCards
          .filter((chapter) => chapter.volumeId === volume.id)
          .sort(
            (left, right) =>
              left.narrativeOrder - right.narrativeOrder ||
              left.id.localeCompare(right.id)
          );
        const fallbackSelection: LongWorkspaceSelection = {
          key: `plot-design:chapter-cards:${volume.id}`,
          root: "plot_design",
          chapterCardVolumeId: volume.id,
          ...(chapters[0] ? { chapterCardId: chapters[0].id } : {}),
          chapterCardTabs: chapters.map((chapter) => ({
            id: chapter.id,
            label: chapter.title
          })),
          title: chapters[0]?.title ?? volume.title,
          breadcrumbs: [
            book.title,
            "剧情设计",
            "章卡",
            volume.title,
            ...(chapters[0] ? [chapters[0].title] : [])
          ],
          files: [],
          preferredRole: "book-line",
          description: chapters.length
            ? `${volume.title} · ${chapters[0]!.title}`
            : `${volume.title}还没有章卡，请使用右侧章卡标签栏的加号新建。`
        };
        const selection =
          (index
            ? createLongChapterCardVolumeSelection(book, index, volume.id)
            : undefined) ?? fallbackSelection;
        return node(selection, {
          icon: "folder",
          label: volume.title,
          badge: `${chapters.length} 章`
        });
      });

  const plotChildren: ResourceTreeNode[] = [
    ...(bookLineSelection
      ? [node(bookLineSelection, { icon: "file", badge: "故事线" })]
      : []),
    node(
      {
        key: "root:plot-points",
        root: "plot_design",
        title: "剧情点",
        breadcrumbs: [book.title, "剧情设计", "剧情点"],
        files: [],
        preferredRole: "book-line",
        description: "按分卷管理剧情点；一卷可以包含多个剧情点。"
      },
      {
        icon: "history",
        badge: String(book.navigation.counts.arcs),
        children: plotPointVolumeChildren
      }
    ),
    ...(foreshadowingSelection
      ? [
          node(foreshadowingSelection, {
            icon: "pin",
            badge: String(book.navigation.counts.foreshadowingThreads)
          })
        ]
      : []),
    node(
      {
        key: "root:plot-chapter-cards",
        root: "plot_design",
        title: "章卡",
        breadcrumbs: [book.title, "剧情设计", "章卡"],
        files: [],
        preferredRole: "book-line",
        description: "直接管理长篇章节卡；正文仍在“正文”中编辑。"
      },
      {
        icon: "file",
        badge: String(book.navigation.counts.chapterCards),
        children: chapterCardManagementChildren
      }
    )
  ];

  const draftChildren = [...book.navigation.volumes]
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    )
    .flatMap<ResourceTreeNode>((volume) => {
      const chapters = book.navigation.chapterCards
        .filter((chapter) => chapter.volumeId === volume.id)
        .sort(
          (left, right) =>
            left.narrativeOrder - right.narrativeOrder ||
            left.id.localeCompare(right.id)
        )
        .flatMap<ResourceTreeNode>((chapter) => {
          const selection = index
            ? createLongChapterSelection(book, index, chapter.id)
            : {
                key: `chapter:${chapter.id}`,
                root: "draft" as const,
                chapterCardId: chapter.id,
                title: chapter.title,
                breadcrumbs: [book.title, "正文", volume.title, chapter.title],
                files: [],
                preferredRole: "body" as const
              };
          return selection ? [node(selection, { icon: "edit" })] : [];
        });
      return chapters.length
        ? [
            {
              id: longNavigationNodeId(book.id, `volume:${volume.id}`),
              label: volume.title,
              icon: "folder",
              badge: `${chapters.length} 章`,
              workspaceType: "long",
              longBookId: book.id,
              catalogNodeType: "category",
              children: chapters
            }
          ]
        : [];
    });

  const continuityPendingChildren: ResourceTreeNode[] = [];
  const continuityRecordChildren: ResourceTreeNode[] = [];
  const nextChapterId = index ? nextWritableLongChapterId(index) : null;
  if (index && nextChapterId) {
    const selection = createLongContinuitySelection(
      book,
      index,
      nextChapterId
    );
    if (selection) {
      const chapter = book.navigation.chapterCards.find(
        ({ id }) => id === nextChapterId
      );
      continuityPendingChildren.push(
        node(selection, {
          icon: "check",
          label: chapter?.title ?? selection.title,
          badge: "待处理"
        })
      );
    }
  }
  if (index) {
    for (const commit of [...index.ledger.commits].sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id)
    )) {
      const selection = createLongContinuitySelection(
        book,
        index,
        commit.chapterCardId
      );
      if (selection) {
        const chapter = book.navigation.chapterCards.find(
          ({ id }) => id === commit.chapterCardId
        );
        continuityRecordChildren.push(
          node(selection, {
            icon: "file",
            label: chapter?.title ?? selection.title,
            badge: `第 ${commit.sequence} 章`
          })
        );
      }
    }
  }
  const continuityChildren: ResourceTreeNode[] = [
    node(
      {
        key: "continuity-group:pending",
        root: "continuity_ledger",
        title: "待处理章节",
        breadcrumbs: [book.title, "连续性账本", "待处理章节"],
        files: [],
        preferredRole: "body",
        description: nextChapterId
          ? "选择章节，以只读文本核对正文证据和待生成的连续性文件。"
          : "当前没有等待连续性核验的章节。"
      },
      {
        icon: "check",
        badge: String(continuityPendingChildren.length),
        children: continuityPendingChildren
      }
    ),
    node(
      {
        key: "continuity-group:records",
        root: "continuity_ledger",
        title: "章节记录",
        breadcrumbs: [book.title, "连续性账本", "章节记录"],
        files: [],
        preferredRole: "body",
        description: "按章节查看已经留存的连续性 Markdown 文件。"
      },
      {
        icon: "file",
        badge: String(continuityRecordChildren.length),
        children: continuityRecordChildren
      }
    )
  ];

  const counts = book.navigation.counts;
  return [
    node(createLongRootSelection(book, "worldbuilding"), {
      icon: "globe",
      badge: String(counts.worldbuildingCategories),
      children: worldChildren
    }),
    node(createLongRootSelection(book, "character_design"), {
      icon: "user",
      badge: String(counts.characters),
      children: characterChildren
    }),
    node(createLongRootSelection(book, "plot_design"), {
      icon: "history",
      badge: String(counts.arcs + counts.volumes + counts.chapterCards),
      children: plotChildren
    }),
    node(createLongRootSelection(book, "draft"), {
      icon: "edit",
      label: "正文",
      badge: String(counts.chapterCards),
      children: draftChildren
    }),
    node(createLongRootSelection(book, "continuity_ledger"), {
      icon: "ledger",
      badge: String(counts.committedChapters),
      children: continuityChildren
    })
  ];
}

const longBookResourceNodes = computed<ResourceTreeNode[]>(() => {
  const availableIds = new Set(longBooks.value.map(({ id }) => id));
  const unavailable = new Map(
    longCatalogDiagnostics.value
      .filter(({ bookId }) => !availableIds.has(bookId))
      .map((diagnostic) => [diagnostic.bookId, diagnostic] as const)
  );
  return [
    ...longBooks.value.map((book) => {
      const workspaceIndex =
        book.id === activeLongBookId.value
          ? activeLongWorkspaceIndex.value
          : null;
      return {
        id: longBookResourceId(book.id),
        label: book.title,
        icon: "book" as const,
        badge: "长篇",
        workspaceType: "long" as const,
        longBookId: book.id,
        catalogNodeType: "long-book" as const,
        selectableBranch: true,
        children: projectLongWorkspaceNavigation(book, workspaceIndex),
        projectRevision: book.projectRevision
      };
    }),
    ...[...unavailable.values()].map((diagnostic) => ({
      id: longBookResourceId(diagnostic.bookId),
      label: `不可用长篇 · ${diagnostic.bookId}`,
      icon: "book" as const,
      badge:
        diagnostic.code === "invalid"
          ? "长篇 · 注册信息无效"
          : "长篇 · 暂不可用",
      workspaceType: "long" as const,
      longBookId: diagnostic.bookId,
      catalogNodeType: "long-book" as const,
      unavailable: true,
      muted: true
    }))
  ];
});

const resourceTreeSections = computed(() =>
  applyBookResourcePreferences(
    baseResourceSections.value,
    bookResourcePreferences.value
  ).map((section) =>
    section.id === "creation"
      ? {
          ...section,
          nodes: [...section.nodes, ...longBookResourceNodes.value]
        }
      : section
  )
);

const activeLongBookSummary = computed(
  () =>
    longBooks.value.find((book) => book.id === activeLongBookId.value) ?? null
);
const longWorldbuildingSyncBookOptions = computed<
  LongWorldbuildingSyncBookOption[]
>(() =>
  longBooks.value.map((book) => ({
    id: book.id,
    title: book.title,
    categoryCount: book.navigation.worldbuilding.filter(
      (category) => !isLongMigrationEvidenceCategoryId(category.id)
    ).length
  }))
);
const activeLongWorkspaceRefreshStatus = computed(() => {
  const status = longWorkspaceRefreshStatus.value;
  return status?.bookId === activeLongBookId.value ? status : null;
});
const activeLongWorkspaceContextReady = computed(
  () =>
    activeLongWorkspaceRefreshStatus.value === null &&
    activeLongWorkspaceIndex.value !== null &&
    activeLongBookSummary.value !== null &&
    activeLongBookSummary.value.navigation.revision ===
      activeLongWorkspaceIndex.value.revision
);
const activeLongRoot = computed(
  () => activeLongSelection.value?.root ?? "worldbuilding"
);
const activeLongStageLabel = computed(
  () => LONG_WORKSPACE_ROOT_LABELS[activeLongRoot.value]
);
const activeLongChapterWriterEnabled = computed(() => {
  const index = activeLongWorkspaceIndex.value;
  const chapterCardId = activeLongSelection.value?.chapterCardId;
  return Boolean(
    index &&
      activeLongRoot.value === "draft" &&
      chapterCardId &&
      nextWritableLongChapterId(index) === chapterCardId
  );
});
const activeLongAgentProfile = computed<LongAgentProfile | null>(() => {
  if (!activeLongBookSummary.value) return null;
  const agentId = resolveLongAgentIdForRoot(
    activeLongRoot.value,
    activeLongChapterWriterEnabled.value
  );
  return (
    longAgentSettings.value.agents.find((profile) => profile.id === agentId) ??
    getDefaultLongAgentProfile(agentId)
  );
});
function buildLongLibraryAttachmentsForProfile(
  summary: LongBookSummary,
  snapshot: CatalogSnapshot,
  profile: LongAgentProfile
): LibraryAttachmentBuildResult {
  const skillKinds = new Set(profile.readAccess.skillKinds);
  const materialKinds = new Set(profile.readAccess.materialKinds);
  return buildLibraryAttachments(snapshot, {
    id: summary.id,
    bookType: "long",
    linkedMaterialIdsByKind: {
      character: materialKinds.has("character")
        ? summary.linkedMaterialIdsByKind.character
        : [],
      gimmick: materialKinds.has("gimmick")
        ? summary.linkedMaterialIdsByKind.gimmick
        : [],
      plot: materialKinds.has("plot")
        ? summary.linkedMaterialIdsByKind.plot
        : [],
      draft: materialKinds.has("draft")
        ? summary.linkedMaterialIdsByKind.draft
        : [],
      other: materialKinds.has("other")
        ? summary.linkedMaterialIdsByKind.other
        : []
    },
    linkedSkillIdsByKind: {
      general: skillKinds.has("general")
        ? summary.linkedSkillIdsByKind.general
        : [],
      plot: skillKinds.has("plot")
        ? summary.linkedSkillIdsByKind.plot
        : [],
      style: skillKinds.has("style")
        ? summary.linkedSkillIdsByKind.style
        : [],
      other: skillKinds.has("other")
        ? summary.linkedSkillIdsByKind.other
        : []
    }
  });
}

function filterLongReadableAttachmentsForProfile(
  attachments: LibraryAttachmentBuildResult,
  profile: LongAgentProfile
): Pick<
  LibraryAttachmentBuildResult,
  "attachedSkills" | "attachedMaterials"
> {
  const skillKinds = new Set(profile.readAccess.skillKinds);
  const materialKinds = new Set(profile.readAccess.materialKinds);
  return {
    attachedSkills: attachments.attachedSkills.filter(
      (skill) => skill.kind !== undefined && skillKinds.has(skill.kind)
    ),
    attachedMaterials: attachments.attachedMaterials.filter(
      (material) =>
        material.kind !== undefined && materialKinds.has(material.kind)
    )
  };
}

function buildLongReadableAttachmentsForProfile(
  summary: LongBookSummary,
  snapshot: CatalogSnapshot | null,
  profile: LongAgentProfile
): Pick<
  LibraryAttachmentBuildResult,
  "attachedSkills" | "attachedMaterials"
> {
  if (!snapshot) {
    return {
      attachedSkills: [],
      attachedMaterials: []
    };
  }
  return filterLongReadableAttachmentsForProfile(
    buildLongLibraryAttachmentsForProfile(summary, snapshot, profile),
    profile
  );
}

const activeLongLibraryAttachments = computed(() => {
  const summary = activeLongBookSummary.value;
  const snapshot = catalogSnapshot.value;
  const profile = activeLongAgentProfile.value;
  return summary && snapshot && profile
    ? buildLongLibraryAttachmentsForProfile(summary, snapshot, profile)
    : null;
});
const activeLongReadableAttachments = computed(() => {
  const attachments = activeLongLibraryAttachments.value;
  const profile = activeLongAgentProfile.value;
  if (!attachments || !profile) {
    return {
      attachedSkills: [],
      attachedMaterials: []
    };
  }
  return filterLongReadableAttachmentsForProfile(attachments, profile);
});
const availableLongSkillReferences = computed<ComposerReferenceOption[]>(() =>
  activeLongReadableAttachments.value.attachedSkills.map((skill) => ({
    id: skill.id,
    label: skill.title,
    detail: `${skill.kind ? SKILL_KIND_LABELS[skill.kind] : "技能"} · 当前长篇已绑定`
  }))
);
const availableLongMaterialReferences = computed<ComposerReferenceOption[]>(() =>
  activeLongReadableAttachments.value.attachedMaterials.map((material) => ({
    id: material.id,
    label: material.title,
    detail: `${material.kind ? MATERIAL_KIND_LABELS[material.kind] : "素材"} · 当前长篇已绑定`
  }))
);
const activeLongRuntimeContext =
  computed<LongWorkspaceRuntimeContext | null>(() => {
    const summary = activeLongBookSummary.value;
    const workspaceIndex = activeLongWorkspaceIndex.value;
    const profile = activeLongAgentProfile.value;
    if (
      !summary ||
      !workspaceIndex ||
      !profile ||
      !activeLongWorkspaceContextReady.value
    ) {
      return null;
    }
    const fileContext =
      activeLongFileContext.value?.bookId === summary.id &&
      activeLongSelection.value?.files.some(
        ({ file }) => file.id === activeLongFileContext.value?.fileId
      )
        ? activeLongFileContext.value
        : null;
    return {
      bookId: summary.id,
      title: summary.title,
      activeRoot: activeLongRoot.value,
      activeAgentId: profile.id,
      ...(fileContext
        ? {
            activeFileId: fileContext.fileId,
            activeFileRevision: fileContext.fileRevision
          }
        : {}),
      ...(activeLongSelection.value?.chapterCardId
        ? {
            activeChapterCardId:
              activeLongSelection.value.chapterCardId
          }
        : {}),
      workspaceRevision: workspaceIndex.revision,
      projectRevision: summary.projectRevision,
      navigation: summary.navigation
    };
  });
const latestLongLedgerCommit = computed(() => {
  const commits = activeLongWorkspaceIndex.value?.ledger.commits ?? [];
  return [...commits].sort(
    (left, right) => right.sequence - left.sequence
  )[0];
});
const longRollbackCommit = computed(() =>
  activeLongWorkspaceIndex.value?.ledger.commits.find(
    ({ id }) => id === longRollbackCommitId.value
  )
);
const longRollbackChapterTitle = computed(() => {
  const chapterId = longRollbackCommit.value?.chapterCardId;
  return (
    activeLongBookSummary.value?.navigation.chapterCards.find(
      ({ id }) => id === chapterId
    )?.title ?? "对应章节"
  );
});
const activeLongProposalItems = computed(() =>
  longWorkspaceProposals.itemsForBook(activeLongBookId.value)
);
const isLongWorkspaceActive = computed(
  () =>
    workspaceMainView.value === "conversation" &&
    activeLongBookId.value !== null
);

function resourceSelectionExists(
  sections: readonly ResourceTreeSection[],
  resourceId: string
): boolean {
  const node = findResourceNodeIn(sections, resourceId);
  if (node?.longBookId) {
    return longBooks.value.some((book) => book.id === node.longBookId);
  }
  const targetId = resourceTargetDocumentId(sections, resourceId);
  return documents.value.some((document) => document.id === targetId);
}

function fallbackCreationResourceId(
  previousSections: readonly ResourceTreeSection[],
  previousResourceId: string
): string {
  const previousTargetId = resourceTargetDocumentId(
    previousSections,
    previousResourceId
  );
  const previousWorkspaceId = documents.value.find(
    (document) => document.id === previousTargetId
  )?.workspaceId;
  return (
    (previousWorkspaceId
      ? resolvePreferredBookResourceId(
          catalogProjection.value ?? undefined,
          previousWorkspaceId
        )
      : undefined) ??
    catalogProjection.value?.draftDirectories[0]?.id ??
    documents.value.find((document) => document.domain === "creation")?.id ??
    documents.value[0]?.id ??
    ""
  );
}

watch(
  resourceTreeSections,
  (nextSections, previousSections) => {
    if (
      selectedResourceId.value &&
      !resourceSelectionExists(nextSections, selectedResourceId.value)
    ) {
      selectedResourceId.value = fallbackCreationResourceId(
        previousSections ?? [],
        selectedResourceId.value
      );
    }
    if (
      activeCreationResourceId.value &&
      !resourceSelectionExists(nextSections, activeCreationResourceId.value)
    ) {
      activeCreationResourceId.value = fallbackCreationResourceId(
        previousSections ?? [],
        activeCreationResourceId.value
      );
    }
  },
  { flush: "sync" }
);
const skillLibraries = computed<ResourceTreeNode[]>(() => {
  if (catalogSnapshot.value) {
    const workspaceType = activeBook.value?.workspaceType ?? "short";
    return catalogSnapshot.value.skills
      .filter((library) => library.skillType === workspaceType)
      .map((library) => ({
      id: library.id,
      label: library.title,
      icon: "library",
      ...(library.isBuiltin ? { badge: "官方" } : {}),
      catalogNodeType: "library",
      libraryId: library.id,
      skillKind: library.skillKind,
      workspaceType: library.skillType
      }));
  }
  return resourceTreeSections.value.find((section) => section.id === "skill")?.nodes ?? [];
});
const materialLibraries = computed<ResourceTreeNode[]>(() => {
  if (catalogSnapshot.value) {
    const workspaceType = activeBook.value?.workspaceType ?? "short";
    return catalogSnapshot.value.materials
      .filter((library) => library.materialType === workspaceType)
      .map((library) => ({
      id: library.id,
      label: library.title,
      icon: "archive",
      ...([library.parentGenre, library.subGenre].filter(Boolean).join(" / ")
        ? { badge: [library.parentGenre, library.subGenre].filter(Boolean).join(" / ") }
        : {}),
      catalogNodeType: "library",
      libraryId: library.id,
      materialKind: library.materialKind,
      workspaceType: library.materialType,
      ...(library.parentGenre ? { parentGenre: library.parentGenre } : {}),
      ...(library.subGenre ? { subGenre: library.subGenre } : {})
      }));
  }
  return resourceTreeSections.value.find((section) => section.id === "material")?.nodes ?? [];
});

function catalogBook(bookId: string): Book | undefined {
  return catalogSnapshot.value?.books.find((book) => book.id === bookId);
}

const plotStructureBook = computed(() =>
  plotStructureBookId.value
    ? catalogBook(plotStructureBookId.value) ?? null
    : null
);

function findResourceNodeIn(
  sections: readonly ResourceTreeSection[],
  resourceId: string
): ResourceTreeNode | undefined {
  const visit = (nodes: readonly ResourceTreeNode[]): ResourceTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === resourceId) return node;
      const nested = visit(node.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(sections.flatMap((section) => section.nodes));
}

function resourceIdForDocumentId(documentId: string): string | undefined {
  const visit = (nodes: readonly ResourceTreeNode[]): string | undefined => {
    for (const node of nodes) {
      if (
        node.id === documentId ||
        node.targetDocumentId === documentId ||
        node.characterStateDocumentId === documentId
      ) {
        return node.id;
      }
      const nested = visit(node.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(resourceTreeSections.value.flatMap((section) => section.nodes));
}

function resourceTargetDocumentId(
  sections: readonly ResourceTreeSection[],
  resourceId: string
): string {
  const node = findResourceNodeIn(sections, resourceId);
  return (
    node?.targetDocumentId ??
    (node?.shortAgentId === "expert_draft_coordinator"
      ? node.children?.find((child) => child.targetDocumentId)?.targetDocumentId
      : undefined) ??
    resourceId
  );
}

function applyCatalogSnapshot(snapshot: CatalogSnapshot): void {
  const previousProjection = catalogProjection.value ?? undefined;
  const selectedWorkspaceAnchor = resolveBookWorkspaceId(
    previousProjection,
    selectedResourceId.value
  );
  const activeWorkspaceAnchor = resolveBookWorkspaceId(
    previousProjection,
    activeCreationResourceId.value
  );
  const diagnostics = snapshot.projectDiagnostics ?? [];
  const diagnosticKeys = new Set(
    diagnostics.map(
      (diagnostic) =>
        `${diagnostic.projectId}\u0000${diagnostic.code}\u0000${diagnostic.message}`
    )
  );
  for (const key of seenCatalogDiagnosticKeys) {
    if (!diagnosticKeys.has(key)) {
      seenCatalogDiagnosticKeys.delete(key);
    }
  }
  const unseenDiagnostics = diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.projectId}\u0000${diagnostic.code}\u0000${diagnostic.message}`;
    if (seenCatalogDiagnosticKeys.has(key)) {
      return false;
    }
    seenCatalogDiagnosticKeys.add(key);
    return true;
  });
  if (unseenDiagnostics.length) {
    const first = unseenDiagnostics[0]!;
    uiMessage.warning(
      `项目“${first.projectId}”暂时无法读取：${first.message}${
        unseenDiagnostics.length > 1
          ? `（另有 ${unseenDiagnostics.length - 1} 个项目）`
          : ""
      }`
    );
  }
  const projection = projectCatalogWorkspace(snapshot);
  const projectedDocuments = new Map(
    projection.workspaceDocuments.map((document) => [document.id, document] as const)
  );
  const recoveryMigration = migrateLegacyDraftRecoveries(
    editorDrafts.value,
    snapshot,
    projection
  );
  const currentUnmappedLegacyKeys = new Set(recoveryMigration.unmappedLegacyKeys);
  for (const key of warnedUnmappedLegacyRecoveryKeys) {
    if (!currentUnmappedLegacyKeys.has(key)) {
      warnedUnmappedLegacyRecoveryKeys.delete(key);
    }
  }
  const newlyUnmappedLegacyKeys = recoveryMigration.unmappedLegacyKeys.filter(
    (key) => !warnedUnmappedLegacyRecoveryKeys.has(key)
  );
  if (newlyUnmappedLegacyKeys.length) {
    newlyUnmappedLegacyKeys.forEach((key) =>
      warnedUnmappedLegacyRecoveryKeys.add(key)
    );
    uiMessage.warning(
      `旧版恢复稿与当前正文的磁盘版本或剧集/小节结构不一致，原恢复稿已保留，请核对当前正文目录${
        newlyUnmappedLegacyKeys.length > 1
          ? `（共 ${newlyUnmappedLegacyKeys.length} 份）`
          : ""
      }`
    );
  }
  editorDrafts.value = Object.fromEntries(
    Object.entries(recoveryMigration.drafts).filter(([documentId, draft]) => {
      if (!draft.dirty) return false;
      const persisted = projectedDocuments.get(documentId);
      return (
        !persisted ||
        persisted.title !== draft.title ||
        persisted.content !== draft.content
      );
    })
  );
  recoveredEditorDraftCount = Object.keys(editorDrafts.value).filter((documentId) =>
    projectedDocuments.has(documentId)
  ).length;
  catalogSnapshot.value = snapshot;
  documents.value = projection.workspaceDocuments.length
    ? projection.workspaceDocuments
    : [{ ...EMPTY_WORKSPACE_DOCUMENT }];

  const selectedTargetId = resourceTargetDocumentId(
    projection.resourceSections,
    selectedResourceId.value
  );
  const selectedLongBookId = longBookIdFromResourceId(
    selectedResourceId.value
  );
  const selectedLongBookExists = Boolean(
    selectedLongBookId &&
      longBooks.value.some((book) => book.id === selectedLongBookId)
  );
  if (
    selectedResourceId.value &&
    !selectedLongBookExists &&
    !documents.value.some((document) => document.id === selectedTargetId)
  ) {
    selectedResourceId.value =
      (selectedWorkspaceAnchor
        ? resolvePreferredBookResourceId(projection, selectedWorkspaceAnchor)
        : undefined) ??
      projection.draftDirectories[0]?.id ??
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }
  const activeCreationTargetId = resourceTargetDocumentId(
    projection.resourceSections,
    activeCreationResourceId.value
  );
  if (
    activeCreationResourceId.value &&
    !documents.value.some((document) => document.id === activeCreationTargetId)
  ) {
    const selectedCreationTargetId = resourceTargetDocumentId(
      projection.resourceSections,
      selectedResourceId.value
    );
    activeCreationResourceId.value =
      (activeWorkspaceAnchor
        ? resolvePreferredBookResourceId(projection, activeWorkspaceAnchor)
        : undefined) ??
      (documents.value.some(
        (document) =>
          document.id === selectedCreationTargetId && document.domain === "creation"
      )
        ? selectedResourceId.value
        : undefined) ??
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }
  queueMicrotask(() => resumeRecoveredAutomaticAgentEdits());
}

async function loadCatalogSnapshot(): Promise<void> {
  if (!window.deepwrite || catalogLoading.value) {
    return;
  }
  catalogLoading.value = true;
  try {
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "加载素材库和技能库失败。");
  } finally {
    catalogLoading.value = false;
  }
}

async function loadLongBookList(
  options: { notify?: boolean; force?: boolean } = {}
): Promise<void> {
  const api = resolveLongWorkspaceApi();
  if (!api) return;
  const notify = options.notify ?? isLongWorkspaceActive.value;
  const force = options.force ?? false;
  if (notify && longCatalogRetryTimer !== undefined) {
    window.clearTimeout(longCatalogRetryTimer);
    longCatalogRetryTimer = undefined;
  }
  if (force) {
    // A mutation may finish while an older list request is still in flight.
    // Invalidate that response before waiting so it can never resurrect a
    // removed book or overwrite a newly opened summary.
    longCatalogRequestClock += 1;
  }
  if (longCatalogLoadPromise) {
    await longCatalogLoadPromise;
    if (!force) return;
    while (longCatalogLoadPromise) {
      await longCatalogLoadPromise;
    }
  }

  const requestId = ++longCatalogRequestClock;
  longCatalogLoading.value = true;
  const request = (async (): Promise<void> => {
    try {
      const result = await api.list();
      if (requestId !== longCatalogRequestClock) return;
      longCatalogLoadError.value = null;
      longCatalogRetryAttempts = 0;
      if (longCatalogRetryTimer !== undefined) {
        window.clearTimeout(longCatalogRetryTimer);
        longCatalogRetryTimer = undefined;
      }
      longCatalogDiagnostics.value = result.diagnostics ?? [];
      const unavailableBookIds = new Set(
        longCatalogDiagnostics.value.map(({ bookId }) => bookId)
      );
      const activeSummary = activeLongBookSummary.value;
      longBooks.value =
        activeSummary &&
        activeLongWorkspaceIndex.value &&
        !unavailableBookIds.has(activeSummary.id)
          ? replaceLongBookSummary(result.books, activeSummary)
          : result.books;
      const currentDiagnosticKeys = new Set(
        (result.diagnostics ?? []).map(
          (diagnostic) =>
            `${diagnostic.bookId}\u0000${diagnostic.code}\u0000${diagnostic.message}`
        )
      );
      for (const key of seenLongCatalogDiagnosticKeys) {
        if (!currentDiagnosticKeys.has(key)) {
          seenLongCatalogDiagnosticKeys.delete(key);
        }
      }
      const unseen = (result.diagnostics ?? []).filter((diagnostic) => {
        const key = `${diagnostic.bookId}\u0000${diagnostic.code}\u0000${diagnostic.message}`;
        return !seenLongCatalogDiagnosticKeys.has(key);
      });
      if (notify && unseen.length) {
        for (const diagnostic of unseen) {
          seenLongCatalogDiagnosticKeys.add(
            `${diagnostic.bookId}\u0000${diagnostic.code}\u0000${diagnostic.message}`
          );
        }
        const first = unseen[0]!;
        uiMessage.warning(
          `长篇项目暂时无法读取：${first.message}${
            unseen.length > 1 ? `（另有 ${unseen.length - 1} 个项目）` : ""
          }`
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "加载长篇创作空间失败。";
      if (requestId !== longCatalogRequestClock) return;
      longCatalogLoadError.value = message;
      if (notify) {
        uiMessage.error(message);
      } else if (
        longCatalogRetryAttempts < 2 &&
        longCatalogRetryTimer === undefined
      ) {
        longCatalogRetryAttempts += 1;
        longCatalogRetryTimer = window.setTimeout(() => {
          longCatalogRetryTimer = undefined;
          void loadLongBookList({ notify: false });
        }, longCatalogRetryAttempts * 1_500);
      }
    }
  })();
  longCatalogLoadPromise = request;
  try {
    await request;
  } finally {
    if (longCatalogLoadPromise === request) {
      longCatalogLoadPromise = null;
      longCatalogLoading.value = false;
    }
  }
}

async function saveActiveLongEditorChanges(): Promise<boolean> {
  if (!activeLongBookId.value) return true;
  const editor = longWorkspaceEditor.value;
  if (!editor) return true;
  try {
    return await editor.saveAllChanges();
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error
        ? error.message
        : "保存长篇修改失败，已取消切换。"
    );
    return false;
  }
}

async function saveActiveLongEditorBeforeLeaving(
  nextBookId?: string
): Promise<boolean> {
  const currentBookId = activeLongBookId.value;
  if (!currentBookId || currentBookId === nextBookId) {
    return true;
  }
  return saveActiveLongEditorChanges();
}

async function openLongBook(bookId: string): Promise<void> {
  const api = resolveLongWorkspaceApi();
  if (!api) {
    uiMessage.warning("浏览器预览不能打开长篇项目，请使用桌面客户端。");
    return;
  }
  if (
    blockActiveLongWritingPlan("打开其他长篇", {
      targetBookId: bookId,
      allowPlanBook: true
    })
  ) {
    return;
  }
  if (!(await saveActiveLongEditorBeforeLeaving(bookId))) {
    return;
  }
  longWorkspaceProposals.activateBook(bookId);
  longWorkspaceRefreshClock.invalidate(bookId);
  longWorkspaceRefreshStatus.value = null;
  const ownOpen = ++longOpenClock;
  activeLongBookId.value = bookId;
  activeLongWorkspaceIndex.value = null;
  activeLongSelection.value = null;
  activeLongFileContext.value = null;
  longRollbackDialogOpen.value = false;
  longStructureDialogOpen.value = false;
  longCharacterCreate.value = null;
  longPlotPointCreate.value = null;
  longChapterCardCreate.value = null;
  longVolumeCreateOpen.value = false;
  longBindingsDialogMode.value = null;
  longWorkspaceLoading.value = true;
  try {
    const opened = await api.open({ bookId });
    if (ownOpen !== longOpenClock || activeLongBookId.value !== bookId) {
      return;
    }
    activeLongWorkspaceIndex.value = opened.book.workspaceIndex;
    longBooks.value = replaceLongBookSummary(longBooks.value, opened.summary);
    longWorkspaceRefreshStatus.value = null;
  } catch (error: unknown) {
    if (ownOpen === longOpenClock) {
      uiMessage.error(
        error instanceof Error ? error.message : "打开长篇项目失败。"
      );
    }
  } finally {
    if (ownOpen === longOpenClock) {
      longWorkspaceLoading.value = false;
    }
  }
}

async function refreshActiveLongWorkspace(bookId: string): Promise<boolean> {
  const api = resolveLongWorkspaceApi();
  if (!api) return false;
  const requestId = longWorkspaceRefreshClock.begin(bookId);
  if (activeLongBookId.value === bookId) {
    longWorkspaceRefreshStatus.value = {
      bookId,
      requestId,
      pending: true,
      error: null
    };
  }
  try {
    const result = await api.getWorkspaceIndex({ bookId });
    if (
      activeLongBookId.value !== bookId ||
      !longWorkspaceRefreshClock.isCurrent(bookId, requestId)
    ) {
      return false;
    }
    if (result.bookId !== bookId) {
      throw new Error("长篇工作区刷新返回了其他书籍。");
    }
    const currentSummary = activeLongBookSummary.value;
    if (!currentSummary || currentSummary.id !== bookId) {
      throw new Error("活动长篇摘要已经切换，无法发布刷新结果。");
    }
    const currentIndex = activeLongWorkspaceIndex.value;
    if (
      !isMonotonicLongWorkspaceRefresh(
        currentIndex
          ? {
              workspaceRevision: currentIndex.revision,
              projectRevision: currentSummary.projectRevision
            }
          : null,
        {
          workspaceRevision: result.workspaceIndex.revision,
          projectRevision: result.projectRevision
        }
      )
    ) {
      longWorkspaceRefreshStatus.value = null;
      return true;
    }
    const nextSummary: LongBookSummary = {
      ...currentSummary,
      projectRevision: result.projectRevision,
      updatedAt: result.workspaceIndex.updatedAt,
      navigation: createLongWorkspaceNavigationSnapshot(
        result.workspaceIndex
      )
    };
    const currentSelection = activeLongSelection.value;
    const nextSelection = currentSelection
      ? reconcileLongWorkspaceSelection(
          nextSummary,
          result.workspaceIndex,
          currentSelection
        ) ?? null
      : null;
    const activeFileId = activeLongFileContext.value?.fileId;
    const nextFile = nextSelection?.files.find(
      ({ file }) => file.id === activeFileId
    )?.file;

    // Publish the index and its derived summary in the same synchronous turn.
    // No await may be inserted between these assignments.
    activeLongWorkspaceIndex.value = result.workspaceIndex;
    longBooks.value = replaceLongBookSummary(longBooks.value, nextSummary);
    if (currentSelection) {
      activeLongSelection.value = nextSelection;
      activeLongFileContext.value = nextFile
        ? {
            bookId,
            fileId: nextFile.id,
            fileRevision: nextFile.revision
          }
        : null;
    }
    longWorkspaceRefreshStatus.value = null;
    return true;
  } catch (error: unknown) {
    if (
      activeLongBookId.value === bookId &&
      longWorkspaceRefreshClock.isCurrent(bookId, requestId)
    ) {
      const message =
        error instanceof Error
          ? error.message
          : "刷新长篇工作区索引失败。";
      longWorkspaceRefreshStatus.value = {
        bookId,
        requestId,
        pending: false,
        error: message
      };
      uiMessage.error(message);
    }
    return false;
  }
}

async function selectLongWorkspaceFile(
  selection: LongWorkspaceSelection
): Promise<boolean> {
  if (
    (activeLongSelection.value?.key !== selection.key ||
      activeLongSelection.value?.characterId !== selection.characterId ||
      activeLongSelection.value?.plotPointId !== selection.plotPointId ||
      activeLongSelection.value?.chapterCardId !== selection.chapterCardId) &&
    !(await saveActiveLongEditorChanges())
  ) {
    return false;
  }
  const preferredFile =
    selection.files.find((file) => file.role === selection.preferredRole) ??
    selection.files[0];
  // Prefetch the target document before publishing the selection so the right
  // pane can swap in ready content instead of flashing a full-page loader.
  if (preferredFile) {
    await longWorkspaceEditor.value?.ensureDocumentsLoaded([preferredFile]);
  }
  activeLongFileContext.value = null;
  activeLongSelection.value = selection;
  return true;
}

async function selectLongCharacterTab(
  characterId: LongCharacterId,
  done?: (accepted: boolean) => void
): Promise<void> {
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  const group = activeLongSelection.value?.characterGroup;
  if (!summary || !index || !group) {
    done?.(false);
    return;
  }
  const accepted = await selectLongWorkspaceFile(
    createLongCharacterGroupSelection(
      summary,
      index,
      group,
      characterId
    )
  );
  done?.(accepted);
}

async function selectLongPlotPointTab(
  plotPointId: LongArcId
): Promise<void> {
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  const volumeId = activeLongSelection.value?.plotPointVolumeId;
  if (!summary || !index || !volumeId) return;
  const selection = createLongPlotPointVolumeSelection(
    summary,
    index,
    volumeId,
    plotPointId
  );
  if (selection) {
    await selectLongWorkspaceFile(selection);
  }
}

async function selectLongChapterCardTab(
  chapterCardId: string
): Promise<void> {
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  const volumeId = activeLongSelection.value?.chapterCardVolumeId;
  if (!summary || !index || !volumeId) return;
  const selection = createLongChapterCardVolumeSelection(
    summary,
    index,
    volumeId,
    chapterCardId
  );
  if (selection) {
    await selectLongWorkspaceFile(selection);
  }
}

async function openLongChapterCardCreate(): Promise<void> {
  const volumeId = activeLongSelection.value?.chapterCardVolumeId;
  const bookId = activeLongBookId.value;
  if (
    !volumeId ||
    !bookId ||
    !activeLongWorkspaceIndex.value ||
    blockActiveLongWritingPlan("新增章卡")
  ) {
    return;
  }
  if (!(await saveActiveLongEditorChanges())) {
    return;
  }
  const index = activeLongWorkspaceIndex.value;
  const volume = index?.plot.volumes.find(({ id }) => id === volumeId);
  const arcs = index?.plot.arcs
    .filter((arc) => arc.volumeId === volumeId)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
  if (!index || !volume) {
    uiMessage.warning("该分卷已不存在，请刷新后重试。");
    return;
  }
  if (!arcs?.length) {
    uiMessage.warning("请先在当前分卷中新建剧情点，再创建章卡。");
    return;
  }
  longChapterCardCreate.value = {
    bookId,
    volumeId,
    volumeTitle: volume.title,
    arcOptions: arcs.map((arc) => ({ value: arc.id, label: arc.title }))
  };
}

async function renameLongCharacter(
  input: { characterId: LongCharacterId; name: string },
  completion: (succeeded: boolean) => void
): Promise<void> {
  const index = activeLongWorkspaceIndex.value;
  const character = index?.characters.find(
    ({ id }) => id === input.characterId
  );
  const name = input.name.trim();
  if (!index || !character) {
    uiMessage.warning("该人物已不存在，请刷新后重试。");
    completion(false);
    return;
  }
  if (!name) {
    uiMessage.warning("人物姓名不能为空。");
    completion(false);
    return;
  }
  if (name === character.name) {
    completion(true);
    return;
  }

  let batch: LongWorkspaceOperationBatch;
  try {
    batch = createLongStructureMutationBuilder(index).updateCharacter(
      character.id,
      { name }
    );
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法修改人物姓名。"
    );
    completion(false);
    return;
  }

  await applyLongStructureMutation(
    batch,
    {
      succeed: () => completion(true),
      fail: () => completion(false),
      appliedButRefreshFailed: () => completion(true)
    },
    {
      successMessage: `已将人物姓名修改为“${name}”`
    }
  );
}

async function renameLongStructureTitle(
  input: {
    kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
  },
  completion: (succeeded: boolean) => void
): Promise<void> {
  const index = activeLongWorkspaceIndex.value;
  const title = input.title.trim();
  if (!index) {
    uiMessage.warning("当前长篇结构尚未就绪。");
    completion(false);
    return;
  }
  if (!title) {
    uiMessage.warning("标题不能为空。");
    completion(false);
    return;
  }

  let batch: LongWorkspaceOperationBatch | undefined;
  let currentTitle: string | undefined;
  let structureLabel = "结构项";
  try {
    const builder = createLongStructureMutationBuilder(index);
    switch (input.kind) {
      case "worldbuilding": {
        const category = index.worldbuilding.find(({ id }) => id === input.id);
        currentTitle = category?.title;
        structureLabel = "世界观分类";
        if (category) {
          batch = builder.updateWorldbuilding(category.id, { title });
        }
        break;
      }
      case "volume": {
        const volume = index.plot.volumes.find(({ id }) => id === input.id);
        currentTitle = volume?.title;
        structureLabel = "分卷";
        if (volume) {
          batch = builder.updateVolume(volume.id, { title });
        }
        break;
      }
      case "plotPoint": {
        const plotPoint = index.plot.arcs.find(({ id }) => id === input.id);
        currentTitle = plotPoint?.title;
        structureLabel = "剧情点";
        if (plotPoint) {
          batch = builder.updateArc(plotPoint.id, { title });
        }
        break;
      }
      case "chapterCard": {
        const chapter = index.plot.chapterCards.find(
          ({ id }) => id === input.id
        );
        currentTitle = chapter?.title;
        structureLabel = "章卡";
        if (chapter) {
          batch = builder.updateChapter(chapter.id, { title });
        }
        break;
      }
    }
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法修改标题。"
    );
    completion(false);
    return;
  }

  if (currentTitle === undefined || !batch) {
    uiMessage.warning(`该${structureLabel}已不存在，请刷新后重试。`);
    completion(false);
    return;
  }
  if (title === currentTitle) {
    completion(true);
    return;
  }

  await applyLongStructureMutation(
    batch,
    {
      succeed: () => completion(true),
      fail: () => completion(false),
      appliedButRefreshFailed: () => completion(true)
    },
    {
      successMessage: `已将${structureLabel}标题修改为“${title}”`
    }
  );
}

function handleLongFileContextChange(
  context: {
    bookId: string;
    fileId: LongFileId;
    fileRevision: LongFileRevision;
  } | null
): void {
  if (context && context.bookId !== activeLongBookId.value) return;
  activeLongFileContext.value = context;
}

function handleLongDocumentSaved(result: LongWriteDocumentResult): void {
  void refreshActiveLongWorkspace(result.bookId);
}

function openLongRollbackDialog(): void {
  if (blockActiveLongWritingPlan("回滚连续性提交")) {
    return;
  }
  const commit = latestLongLedgerCommit.value;
  if (!commit?.reversible) {
    uiMessage.warning("当前没有可回滚的最后提交。");
    return;
  }
  longRollbackCommitId.value = commit.id;
  longRollbackDialogOpen.value = true;
}

function closeLongRollbackDialog(): void {
  if (longRollbackPending.value) return;
  longRollbackDialogOpen.value = false;
  longRollbackCommitId.value = null;
}

async function confirmLongRollback(): Promise<void> {
  const api = resolveLongWorkspaceApi();
  const bookId = activeLongBookId.value;
  if (!api || !bookId || longRollbackPending.value) {
    if (!api) uiMessage.warning("当前环境未连接长篇工作区。");
    return;
  }
  if (blockActiveLongWritingPlan("回滚连续性提交")) {
    longRollbackDialogOpen.value = false;
    longRollbackCommitId.value = null;
    return;
  }

  longRollbackPending.value = true;
  try {
    // A user may request rollback while editing the next, still-uncommitted
    // chapter. Persist that work first, then refresh the CAS revisions that
    // the save advanced before touching the continuity ledger.
    if (!(await saveActiveLongEditorChanges())) {
      return;
    }
    if (!(await refreshActiveLongWorkspace(bookId))) {
      return;
    }
    const summary = activeLongBookSummary.value;
    const index = activeLongWorkspaceIndex.value;
    const commit = longRollbackCommit.value;
    if (
      !summary ||
      summary.id !== bookId ||
      !index ||
      !commit ||
      commit.id !== latestLongLedgerCommit.value?.id ||
      !commit.reversible
    ) {
      longRollbackDialogOpen.value = false;
      longRollbackCommitId.value = null;
      uiMessage.warning("最后提交已经变化，请刷新后重新确认回滚。");
      return;
    }
    await api.rollbackLastCommit({
      bookId: summary.id,
      expectedCommitId: commit.id,
      baseWorkspaceRevision: index.revision,
      baseProjectRevision: summary.projectRevision
    });
    if (activeLongSelection.value?.key === `ledger:${commit.id}`) {
      activeLongSelection.value = null;
      activeLongFileContext.value = null;
    }
    longRollbackDialogOpen.value = false;
    longRollbackCommitId.value = null;
    if (await refreshActiveLongWorkspace(summary.id)) {
      longWorkspaceEditor.value?.synchronizeProjectRevisions(
        activeLongWorkspaceIndex.value!.revision,
        activeLongBookSummary.value!.projectRevision
      );
    }
    await loadLongBookList({ force: true });
    uiMessage.success(`已回滚提交 #${commit.sequence}。`);
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "回滚最后提交失败。"
    );
  } finally {
    longRollbackPending.value = false;
  }
}

function captureAgentRunSettings(
  conversation: AgentConversationController
): AgentRunSettings {
  return {
    selectedModelId: conversation.selectedModelId.value,
    thinkingLevel: conversation.thinkingLevel.value,
    temperature: conversation.temperature.value,
    approvalMode: conversation.approvalMode.value
  };
}

function storeAgentRunPreferences(): void {
  try {
    localStorage.setItem(
      AGENT_RUN_PREFERENCES_STORAGE_KEY,
      JSON.stringify(agentRunPreferences.value)
    );
    agentRunPreferenceWarningShown = false;
  } catch {
    if (agentRunPreferenceWarningShown) return;
    agentRunPreferenceWarningShown = true;
    uiMessage.warning("当前书籍的智能体运行选项暂时无法保存到本机");
  }
}

function persistAgentRunPreferences(
  scope: string,
  preferences: AgentRunSettings
): void {
  agentRunPreferences.value = {
    ...agentRunPreferences.value,
    [scope]: preferences
  };
  storeAgentRunPreferences();
}

function removeAgentRunPreferences(scope: string): void {
  if (!(scope in agentRunPreferences.value)) return;
  const next = { ...agentRunPreferences.value };
  delete next[scope];
  agentRunPreferences.value = next;
  storeAgentRunPreferences();
}

function synchronizeAgentRunPreferences(
  scope: string,
  source: AgentConversationController
): void {
  const preferences = captureAgentRunSettings(source);
  for (const [key, conversation] of conversations) {
    if (conversationScopes.get(key) === scope && conversation !== source) {
      conversation.applyRunSettings(preferences);
    }
  }
  persistAgentRunPreferences(scope, preferences);
}

function conversationForKey(
  key: string,
  scope = "general"
): AgentConversationController {
  const existing = conversations.get(key);
  if (existing) {
    const previousScope = conversationScopes.get(key);
    conversationScopes.set(key, scope);
    if (previousScope !== scope) {
      const preferences = agentRunPreferences.value[scope];
      if (preferences) {
        existing.applyRunSettings(preferences);
      }
    }
    existing.selectApprovalMode(generalSettings.value.permissionMode);
    return existing;
  }
  const created = useAgentConversation({
    api: () => window.deepwrite,
    persistenceKey: `deepwrite:agent-conversations:v1:${encodeURIComponent(key)}`,
    onPersistenceError: () => {
      if (conversationPersistenceWarningShown) return;
      conversationPersistenceWarningShown = true;
      uiMessage.warning("历史对话暂时无法保存到本机，本次运行中仍可继续切换");
    }
  });
  conversations.set(key, created);
  conversationScopes.set(key, scope);
  if (modelSettings.value) {
    created.applyModelSettings(modelSettings.value);
  }
  const preferences = agentRunPreferences.value[scope];
  if (preferences) {
    created.applyRunSettings(preferences);
  } else if (modelSettings.value) {
    persistAgentRunPreferences(scope, captureAgentRunSettings(created));
  }
  created.selectApprovalMode(generalSettings.value.permissionMode);
  queueMicrotask(() => resumeRecoveredAutomaticAgentEdits([created]));
  return created;
}

function allConversations(): AgentConversationController[] {
  return [...conversations.values()];
}

function longConversationKey(
  bookId: string,
  agentId: string,
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"],
  chapterCardId?: string
): string {
  return `long:${encodeURIComponent(bookId)}:${agentId}:${activeRoot}:${encodeURIComponent(
    chapterCardId ?? "__book__"
  )}`;
}

function acceptsLongProposalEvent(
  event: LongWorkspaceProposalEvent
): boolean {
  return longConversationForProposalEvent(event) !== undefined;
}

function longConversationForProposalEvent(
  event:
    | LongWorkspaceProposalEvent
    | Extract<
        SystemEventEnvelope,
        { type: "long.chapter_write_proposal" }
      >
): AgentConversationController | undefined {
  const prefix = `long:${encodeURIComponent(event.payload.bookId)}:`;
  for (const [key, conversation] of conversations) {
    if (
      key.startsWith(prefix) &&
      conversation.acceptsRunEvent(
        event.payload.sessionId,
        event.payload.runId
      )
    ) {
      return conversation;
    }
  }
  return undefined;
}

function longProposalApprovalMode(
  event: LongWorkspaceProposalEvent
): AgentRunSettings["approvalMode"] | undefined {
  if (event.payload.agentId === "continuity_ledger") {
    return "request-approval";
  }
  return longConversationForProposalEvent(event)?.approvalModeForRun(
    event.payload.sessionId,
    event.payload.runId
  );
}

function longAgentRunApprovalMode(
  agentId: LongAgentProfile["id"],
  fallback: AgentRunSettings["approvalMode"]
): AgentRunSettings["approvalMode"] {
  return agentId === "continuity_ledger"
    ? "request-approval"
    : fallback;
}

function observeLongWritingAgentEvent(
  event: SystemEventEnvelope
): void {
  const expectation = longWritingAgentRunExpectation;
  if (!expectation) return;
  if (
    event.type !== "long.chapter_write_proposal" &&
    event.type !== "long.ledger_commit_proposal" &&
    event.type !== "agent.message_completed" &&
    event.type !== "agent.error"
  ) {
    return;
  }
  if (event.payload.sessionId !== expectation.sessionId) return;
  const matchesExpectedProposal =
    event.type === "long.chapter_write_proposal" ||
    event.type === "long.ledger_commit_proposal"
      ? matchesLongWritingProposalExpectation(expectation, event)
      : false;
  if (
    (event.type === "long.chapter_write_proposal" ||
      event.type === "long.ledger_commit_proposal") &&
    !matchesExpectedProposal
  ) {
    return;
  }
  if (
    expectation.runId &&
    expectation.runId !== event.payload.runId
  ) {
    return;
  }
  expectation.runId ??= event.payload.runId;
  if (matchesExpectedProposal) {
    expectation.proposalSeen = true;
    return;
  }
  if (
    event.type !== "agent.message_completed" &&
    event.type !== "agent.error"
  ) {
    return;
  }
  expectation.terminalError =
    event.type === "agent.error"
      ? event.payload.message
      : "智能体运行已结束，但没有形成当前章的待审批提案";
  if (
    !expectation.proposalSeen &&
    (longWritingOrchestrator.state.value.phase ===
      "awaiting_writer_approval" ||
      longWritingOrchestrator.state.value.phase ===
        "awaiting_ledger_approval")
  ) {
    longWritingOrchestrator.handleRunFailure(
      expectation.agentId,
      expectation.terminalError
    );
  }
}

async function refreshLongWritingSaveBarrier(
  bookId: string
): Promise<boolean> {
  const refreshed = await refreshActiveLongWorkspace(bookId);
  if (
    refreshed &&
    activeLongBookId.value === bookId &&
    activeLongWorkspaceIndex.value &&
    activeLongBookSummary.value?.id === bookId
  ) {
    longWorkspaceEditor.value?.synchronizeProjectRevisions(
      activeLongWorkspaceIndex.value.revision,
      activeLongBookSummary.value.projectRevision
    );
  }
  await loadLongBookList({ force: true });
  return refreshed;
}

async function handleLongProposalApplied(
  event: Exclude<
    LongWorkspaceProposalEvent,
    { type: "long.chapter_dispatch_proposal" }
  >
): Promise<void> {
  if (
    canApproveLongProposalDuringActivePlan(event) &&
    event.type === "long.ledger_commit_proposal" &&
    await longWritingOrchestrator.handleApplied(event)
  ) {
    return;
  }
  await refreshLongWritingSaveBarrier(event.payload.bookId);
}

async function readLongDocumentPresence(
  bookId: string,
  fileId: LongFileId
): Promise<{
  hasContent: boolean;
  workspaceRevision: number;
  projectRevision: number;
}> {
  const api = resolveLongWorkspaceApi();
  if (!api) {
    throw new Error("当前环境未连接长篇工作区。");
  }
  let offset = 0;
  let workspaceRevision: number | undefined;
  let projectRevision: number | undefined;
  while (true) {
    const page = await api.readDocument({
      bookId,
      fileId,
      offset,
      maxCharacters: 262_144
    });
    if (
      page.bookId !== bookId ||
      page.file.id !== fileId ||
      page.offset !== offset ||
      (workspaceRevision !== undefined &&
        page.workspaceRevision !== workspaceRevision) ||
      (projectRevision !== undefined &&
        page.projectRevision !== projectRevision)
    ) {
      throw new Error("章节正文读取结果与当前章不一致。");
    }
    workspaceRevision ??= page.workspaceRevision;
    projectRevision ??= page.projectRevision;
    if (page.content.trim()) {
      return {
        hasContent: true,
        workspaceRevision,
        projectRevision
      };
    }
    if (page.nextOffset === null) {
      return {
        hasContent: false,
        workspaceRevision,
        projectRevision
      };
    }
    if (page.nextOffset <= offset) {
      throw new Error("章节正文分页游标无效。");
    }
    offset = page.nextOffset;
  }
}

async function resolveLiveLongChapterReadiness(
  bookId: string,
  chapterCardId: string
): Promise<LongChapterReadiness> {
  if (!(await saveActiveLongEditorChanges())) {
    throw new Error(
      "当前长篇修改尚未保存，无法重新检查章节正文。"
    );
  }
  if (!(await refreshActiveLongWorkspace(bookId))) {
    throw new Error(
      "当前长篇工作区尚未完成刷新，无法重新检查章节正文。"
    );
  }
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  if (!summary || !index || summary.id !== bookId) {
    throw new Error("串行写作计划对应的长篇工作区尚未载入。");
  }
  const chapter = index.plot.chapterCards.find(
    ({ id }) => id === chapterCardId
  );
  const files = index.chapters.find(
    (entry) => entry.chapterCardId === chapterCardId
  );
  if (!chapter || !files) {
    throw new Error("串行写作计划中的章卡或正文文件已经不存在。");
  }
  if (files.commitId !== null) {
    throw new Error(`“${chapter.title}”已经提交，不能重复执行写作计划。`);
  }
  const body = await readLongDocumentPresence(bookId, files.body.id);
  const missingFiles: LongChapterReadiness["missingFiles"] = [];
  if (!body.hasContent) missingFiles.push("body");
  return {
    chapterCardId,
    title: chapter.title,
    status:
      missingFiles.length === 1
        ? "empty"
        : "ready_to_commit",
    missingFiles
  };
}

function longWorkflowRuntimeContext(
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot,
  profile: LongAgentProfile,
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"],
  chapterCardId: string
): LongWorkspaceRuntimeContext {
  return {
    bookId: summary.id,
    title: summary.title,
    activeRoot,
    activeAgentId: profile.id,
    activeChapterCardId: chapterCardId,
    workspaceRevision: index.revision,
    projectRevision: summary.projectRevision,
    navigation: summary.navigation
  };
}

async function startFreshLongAgentRun(input: {
  bookId: string;
  chapterCardId: string;
  agentId: "expert_section_writer" | "continuity_ledger";
  activeRoot: "draft" | "continuity_ledger";
  prompt: string;
}, guard: LongWritingRunGuard): Promise<void> {
  if (!guard.isCurrent()) return;
  if (!(await ensureLongAgentSettingsLoaded())) {
    if (!guard.isCurrent()) return;
    throw new Error(
      longAgentLoadError.value ??
        "长篇智能体设置尚未加载，无法启动串行写作。"
    );
  }
  if (!guard.isCurrent()) return;
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  if (!summary || !index || summary.id !== input.bookId) {
    throw new Error("启动章节智能体前，长篇工作区已经切换。");
  }
  const profile =
    longAgentSettings.value.agents.find(
      ({ id }) => id === input.agentId
    ) ?? getDefaultLongAgentProfile(input.agentId);
  const conversation = conversationForKey(
    longConversationKey(
      summary.id,
      input.agentId,
      input.activeRoot,
      input.chapterCardId
    ),
    `long:${summary.id}`
  );
  if (conversation.isBusy.value) {
    throw new Error(
      `${profile.label}的上一轮仍在收尾，请稍后重试当前章；计划不会跳章。`
    );
  }
  if (!guard.isCurrent()) return;
  conversation.newConversation();
  const sessionId = conversation.sessionId.value;
  const runExpectation: LongWritingAgentRunExpectation = {
    bookId: input.bookId,
    chapterCardId: input.chapterCardId,
    agentId: input.agentId,
    sessionId,
    proposalSeen: false
  };
  longWritingAgentRunExpectation = runExpectation;
  conversation.selectApprovalMode(
    longAgentRunApprovalMode(
      input.agentId,
      generalSettings.value.permissionMode
    )
  );
  conversation.draft.value = input.prompt;
  if (!guard.isCurrent()) {
    if (longWritingAgentRunExpectation === runExpectation) {
      longWritingAgentRunExpectation = null;
    }
    return;
  }
  await conversation.sendLongMessage(
    longWorkflowRuntimeContext(
      summary,
      index,
      profile,
      input.activeRoot,
      input.chapterCardId
    ),
    buildLongReadableAttachmentsForProfile(
      summary,
      catalogSnapshot.value,
      profile
    )
  );
  if (!guard.isCurrent()) return;
  if (conversation.conversationError.value) {
    throw new Error(conversation.conversationError.value);
  }
  if (
    longWritingAgentRunExpectation === runExpectation &&
    runExpectation.terminalError &&
    !runExpectation.proposalSeen
  ) {
    throw new Error(runExpectation.terminalError);
  }
}

async function startFreshLongChapterWriter(
  bookId: string,
  readiness: LongChapterReadiness,
  guard: LongWritingRunGuard
): Promise<void> {
  if (!guard.isCurrent()) return;
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  if (!summary || !index || summary.id !== bookId) {
    throw new Error("当前长篇工作区已经切换。");
  }
  const selection = createLongChapterSelection(
    summary,
    index,
    readiness.chapterCardId
  );
  if (!selection) {
    throw new Error("当前长篇修改尚未保存，单章写作未启动。");
  }
  const selected = await selectLongWorkspaceFile(selection);
  if (!guard.isCurrent()) return;
  if (!selected) {
    throw new Error("当前长篇修改尚未保存，单章写作未启动。");
  }
  const missingLabels = readiness.missingFiles.map((role) =>
    role === "body"
      ? "正文"
      : role === "character_state"
        ? "旧版人物状态候选"
        : "旧版 Handoff 候选"
  );
  await startFreshLongAgentRun(
    {
      bookId,
      chapterCardId: readiness.chapterCardId,
      agentId: "expert_section_writer",
      activeRoot: "draft",
      prompt:
        `执行串行写作计划中的《${readiness.title}》。` +
        `当前正文状态为 ${readiness.status}，缺失：${missingLabels.join("、") || "无"}。` +
        "请先读取章卡、上一章由连续性账本生成的接续包、当前事实投影及本章现有正文；只完成本章正文，已有非空正文原则上保持原文，除非用户明确要求修订。" +
        "一张章卡只对应一个独立 Markdown 正文文件，本轮唯一写作产物是当前章小说正文，不得把相邻章节、章节标题、分析过程或写作参数混入正文。章节及空白正文文件已由剧情设计阶段创建，不要在写作阶段重复创建。正文为空时调用 write_chapter_draft 首次写入；已有正文需先用 read_chapter mode=full 完整读取，再按任务使用 write_chapter_draft 或 edit_chapter_draft。必须提交正文 diff 审批卡，未获用户批准前不得声称已经保存。禁止编写、草拟、补全或修改章末人物状态、交接文档、下一章接续包和连续性事实；这些内容只由后续连续性账本智能体读取已保存正文后生成。"
    },
    guard
  );
}

async function startFreshLongContinuityLedger(
  bookId: string,
  readiness: LongChapterReadiness,
  guard: LongWritingRunGuard
): Promise<void> {
  if (!guard.isCurrent()) return;
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  if (!summary || !index || summary.id !== bookId) {
    throw new Error("当前长篇工作区已经切换。");
  }
  const selection = createLongContinuitySelection(
    summary,
    index,
    readiness.chapterCardId
  );
  if (!selection) {
    throw new Error("当前长篇修改尚未保存，连续性核对未启动。");
  }
  const selected = await selectLongWorkspaceFile(selection);
  if (!guard.isCurrent()) return;
  if (!selected) {
    throw new Error("当前长篇修改尚未保存，连续性核对未启动。");
  }
  await startFreshLongAgentRun(
    {
      bookId,
      chapterCardId: readiness.chapterCardId,
      agentId: "continuity_ledger",
      activeRoot: "continuity_ledger",
      prompt:
        `核对串行写作计划中的《${readiness.title}》。章节正文证据已完整保存。` +
        "请以正文为证据，参考上一章章末状态、接续包以及相关人物、世界和伏笔设计。" +
        "使用 list_continuity_files 与 read_continuity_file 核验内容；按需用 create_continuity_file 创建本章世界观揭露或人物记录，再用 write_continuity_file / edit_continuity_file 写入 Markdown。" +
        "本章必须留存章末状态、下一章接续包和伏笔变化；只为实际涉及的人物记录章末当前状态，并在上一份已提交人物记录上累积追加截至本章的完整历史轨迹；只在正文确有新揭露时创建世界观揭露。" +
        "完成全部文件后调用 propose_continuity_commit 触发客户端内部版本归档；用户只审批文件变更，不再审批归档动作。" +
        "不要生成结构化事实投影、覆盖率、六域摘要或 JSON，不要使用底层索引和 file_id，也不要替用户批准提案。"
    },
    guard
  );
}

async function handleLongChapterDispatchApproved(
  event: Extract<
    LongWorkspaceProposalEvent,
    { type: "long.chapter_dispatch_proposal" }
  >
): Promise<void> {
  const summary = activeLongBookSummary.value;
  const workspaceIndex = activeLongWorkspaceIndex.value;
  if (
    !summary ||
    !workspaceIndex ||
    summary.id !== event.payload.bookId
  ) {
    throw new Error("该单章调度提案不属于当前活动长篇。");
  }
  if (
    workspaceIndex.revision !== event.payload.workspaceRevision ||
    summary.projectRevision !== event.payload.projectRevision
  ) {
    throw new Error(
      "长篇结构已在提案后更新，请让正文统筹智能体重新选择连续下一章。"
    );
  }
  if (
    nextWritableLongChapterId(workspaceIndex) !==
    event.payload.chapterCardId
  ) {
    throw new Error("串行写作计划不再从连续下一章开始，请重新生成提案。");
  }
  const volumeOrder = new Map(
    workspaceIndex.plot.volumes.map(({ id, order }) => [id, order])
  );
  const remaining = [...workspaceIndex.plot.chapterCards]
    .sort(
      (left, right) =>
        (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
          (volumeOrder.get(right.volumeId) ??
            Number.MAX_SAFE_INTEGER) ||
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    )
    .slice(workspaceIndex.ledger.commits.length);
  const first = remaining[0]!;
  const expected: typeof remaining = [];
  if (
    event.payload.scope === "arc" &&
    first.primaryArcId === null
  ) {
    throw new Error("连续下一章没有主剧情点，不能启动剧情点写作。");
  }
  for (const chapter of remaining) {
    if (
      expected.length > 0 &&
      (event.payload.scope === "chapter" ||
        chapter.volumeId !== first.volumeId ||
        (event.payload.scope === "arc" &&
          chapter.primaryArcId !== first.primaryArcId))
    ) {
      break;
    }
    expected.push(chapter);
  }
  if (
    expected.length !== event.payload.chapters.length ||
    expected.some(
      ({ id }, index) =>
        event.payload.chapters[index]?.chapterCardId !== id
    )
  ) {
    throw new Error("串行写作章序与当前卷/剧情点不一致，请重新生成提案。");
  }
  await longWritingOrchestrator.startDispatch(event);
}

function applyModelSettingsToConversations(settings: ModelSettings): void {
  for (const conversation of allConversations()) {
    conversation.applyModelSettings(settings);
  }

  const representativeByScope = new Map<string, AgentConversationController>();
  for (const [key, conversation] of conversations) {
    const scope = conversationScopes.get(key) ?? "general";
    if (!representativeByScope.has(scope)) {
      representativeByScope.set(scope, conversation);
    }
  }
  for (const [scope, representative] of representativeByScope) {
    const preferences = agentRunPreferences.value[scope];
    if (preferences) {
      representative.applyRunSettings(preferences);
    }
    synchronizeAgentRunPreferences(scope, representative);
  }
  applyDefaultApprovalMode(generalSettings.value.permissionMode);
}

conversationForKey("general");

function resourceNode(resourceId: string): ResourceTreeNode | undefined {
  return findResourceNodeIn(resourceTreeSections.value, resourceId);
}

function draftDirectoryForResourceId(
  resourceId: string
): DraftDirectoryProjection | undefined {
  const exact = catalogProjection.value?.draftDirectories.find(
    (directory) => directory.id === resourceId
  );
  if (exact) return exact;
  const node = resourceNode(resourceId);
  const targetId = node?.targetDocumentId ?? resourceId;
  const target = documents.value.find((document) => document.id === targetId);
  if (
    node?.shortAgentId !== "expert_section_writer" &&
    target?.draftDirectoryId === undefined
  ) {
    return undefined;
  }
  return catalogProjection.value?.draftDirectories.find(
    (directory) => directory.workspaceId === target?.workspaceId
  );
}

function selectedDraftSection(
  directory: DraftDirectoryProjection,
  node?: ResourceTreeNode
): DraftDirectoryProjection["sections"][number] | undefined {
  return resolveDraftSectionProjection(
    directory,
    selectedExpertSectionIds.value[directory.id],
    node?.expertSectionId
  );
}

function draftFileDocument(
  directory: DraftDirectoryProjection,
  sectionId: string,
  fileKind: "body" | "character-state"
): WorkspaceDocument | undefined {
  const section = directory.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return undefined;
  const documentId =
    fileKind === "body"
      ? section.bodyDocumentId
      : section.characterStateDocumentId;
  return documents.value.find((document) => document.id === documentId);
}

function documentForResourceId(resourceId: string): WorkspaceDocument | undefined {
  const node = resourceNode(resourceId);
  const directory = draftDirectoryForResourceId(resourceId);
  if (directory) {
    const section = selectedDraftSection(directory, node);
    if (!section) return undefined;
    return draftFileDocument(
      directory,
      section.id,
      selectedDraftFileKinds.value[directory.id] ?? "body"
    );
  }
  const targetId = node?.targetDocumentId ?? resourceId;
  return documents.value.find((document) => document.id === targetId);
}

function liveDocument(document: WorkspaceDocument): WorkspaceDocument {
  const live = editorDrafts.value[document.id];
  return live ? { ...document, title: live.title, content: live.content } : document;
}

function promptDocumentForResourceId(resourceId: string): WorkspaceDocument | undefined {
  const node = resourceNode(resourceId);
  const directory = draftDirectoryForResourceId(resourceId);
  const promptSection = directory
    ? selectedDraftSection(directory, node)
    : undefined;
  const document =
    directory && promptSection
      ? draftFileDocument(directory, promptSection.id, "body")
      : documentForResourceId(resourceId);
  if (!document) return undefined;
  const resolved = liveDocument(document);
  const workspaceLabel = resolved.workspaceType === "script" ? "剧本" : "短篇";
  const unitLabel = resolved.workspaceType === "script" ? "剧集" : "小节";
  if (!node?.shortAgentId) return resolved;
  if (node.shortAgentId === "expert_draft_coordinator" && directory) {
    const {
      catalogDocumentId: _catalogDocumentId,
      draftFileKind: _draftFileKind,
      expertSectionId: _expertSectionId,
      ...contextDocument
    } = resolved;
    return {
      ...contextDocument,
      id: "draft",
      title: directory.title,
      eyebrow: `${workspaceLabel} · 正文`,
      path: [resolved.workspaceTitle ?? resolved.path[0] ?? workspaceLabel, directory.title],
      content: "",
      shortAgentId: "expert_draft_coordinator"
    };
  }
  return {
    ...resolved,
    shortAgentId: node.shortAgentId,
    ...(promptSection && node.shortAgentId === "expert_section_writer"
      ? {
          expertSectionId: promptSection.id,
          title: promptSection.title,
          eyebrow: `${workspaceLabel} · ${unitLabel}编写`,
          path: [
            resolved.workspaceTitle ?? resolved.path[0] ?? workspaceLabel,
            "正文",
            promptSection.title
          ]
        }
      : {})
  };
}

const activeDocument = computed<WorkspaceDocument>(() => {
  const source =
    documentForResourceId(selectedResourceId.value) ?? EMPTY_WORKSPACE_DOCUMENT;
  return liveDocument(source);
});
const activeEditorDraft = computed<EditorDraftState | undefined>(
  () => editorDrafts.value[activeDocument.value.id]
);
const activeExpertSectionTabs = computed(() => {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  return (directory?.sections ?? []).map((section) => ({
    id: section.id,
    title: section.title
  }));
});
const activeExpertSectionId = computed(() => activeDocument.value.expertSectionId);
const activeCharacterItemTabs = computed(() => {
  const document = activeDocument.value;
  if (
    document.domain !== "creation" ||
    document.stageId !== "character_design" ||
    (document.workspaceType !== "short" && document.workspaceType !== "script") ||
    !document.workspaceId
  ) {
    return [] as { id: string; title: string }[];
  }
  const book = catalogBook(document.workspaceId);
  if (!book || book.characterStructure.format !== "list") {
    return [] as { id: string; title: string }[];
  }
  const overview = documents.value.find(
    (candidate) =>
      candidate.workspaceId === book.id &&
      candidate.stageId === "character_design" &&
      candidate.characterFileKind === "overview"
  );
  const items = documents.value
    .filter(
      (candidate) =>
        candidate.workspaceId === book.id &&
        candidate.stageId === "character_design" &&
        candidate.characterFileKind === "item"
    )
    .sort(
      (left, right) =>
        (left.characterItemOrder ?? 0) - (right.characterItemOrder ?? 0)
    );
  return [
    ...(overview ? [{ id: overview.id, title: "概览" }] : []),
    ...items.map((item) => ({ id: item.id, title: item.title }))
  ];
});
const activeEditorSectionTabs = computed(() =>
  activeCharacterItemTabs.value.length
    ? activeCharacterItemTabs.value
    : activeExpertSectionTabs.value
);
const activeEditorSectionId = computed(() =>
  activeCharacterItemTabs.value.length
    ? activeDocument.value.id
    : activeExpertSectionId.value
);
const editorShowsCharacterItemTabs = computed(
  () => activeCharacterItemTabs.value.length > 0
);
const editorShowsExpertSectionTabs = computed(
  () =>
    !editorShowsCharacterItemTabs.value &&
    activeExpertSectionTabs.value.length > 0 &&
    activeDocument.value.workspaceType === "short" &&
    activeDocument.value.stageId === "draft"
);
const showEditorDeleteSection = computed(
  () =>
    editorShowsCharacterItemTabs.value || editorShowsExpertSectionTabs.value
);
const canCreateEditorSection = computed(() => {
  if (editorShowsCharacterItemTabs.value) {
    return (
      activeDocument.value.workspaceType === "short" ||
      activeDocument.value.workspaceType === "script"
    );
  }
  return editorShowsExpertSectionTabs.value;
});
const canDeleteEditorSection = computed(() => {
  if (editorShowsCharacterItemTabs.value) {
    return (
      activeDocument.value.characterFileKind === "item" &&
      Boolean(activeDocument.value.characterItemId)
    );
  }
  if (editorShowsExpertSectionTabs.value) {
    const directory = draftDirectoryForResourceId(selectedResourceId.value);
    return (directory?.sections.length ?? 0) > 1;
  }
  return false;
});
const editorSectionTabsLabel = computed(() =>
  editorShowsCharacterItemTabs.value
    ? "人物条目"
    : undefined
);
const editorCreateSectionLabel = computed(() =>
  editorShowsCharacterItemTabs.value ? "新建人物条目" : undefined
);
const editorDeleteSectionLabel = computed(() => {
  if (editorShowsCharacterItemTabs.value) return "删除当前人物条目";
  if (editorShowsExpertSectionTabs.value) return "删除当前小节";
  return undefined;
});
const activePromptDocument = computed<WorkspaceDocument>(() => {
  return (
    promptDocumentForResourceId(activeCreationResourceId.value) ??
    EMPTY_WORKSPACE_DOCUMENT
  );
});
const activeAgentDocument = computed<WorkspaceDocument>(() =>
  activeAgentDocumentForSelection(
    activeDocument.value,
    activePromptDocument.value
  )
);
const liveWorkspaceDocuments = computed<WorkspaceDocument[]>(() =>
  documents.value.map((document) => {
    const live = editorDrafts.value[document.id];
    return live ? { ...document, title: live.title, content: live.content } : document;
  })
);
const activeLibraryAgentContext = computed(() =>
  buildLibraryAgentWorkspaceContext(
    catalogSnapshot.value,
    activeAgentDocument.value,
    liveWorkspaceDocuments.value
  )
);
const activeLibraryBoundToBook = computed(() => {
  const document = activeDocument.value;
  const workspaceId = activePromptDocument.value.workspaceId;
  if (!document.libraryId || !workspaceId || document.domain === "creation") {
    return false;
  }
  const book = findVisibleBook(workspaceId);
  return document.domain === "skill"
    ? book?.boundSkillLibraryIds?.includes(document.libraryId) ?? false
    : book?.boundMaterialLibraryIds?.includes(document.libraryId) ?? false;
});
const activeConversationKey = computed(() =>
  conversationKeyForDocument(activeAgentDocument.value)
);
const activeConversation = computed(() =>
  conversationForKey(
    activeConversationKey.value,
    agentRunScopeForDocument(activeAgentDocument.value)
  )
);
const messages = computed(() => activeConversation.value.messages.value);
const conversationHistory = computed(() => activeConversation.value.history.value);
const currentSessionId = computed(() => activeConversation.value.sessionId.value);
const composerDraft = computed({
  get: () => activeConversation.value.draft.value,
  set: (value: string) => {
    activeConversation.value.draft.value = value;
  }
});
const approvalMode = computed(() => activeConversation.value.approvalMode.value);
const thinkingLevel = computed(() => activeConversation.value.thinkingLevel.value);
const temperature = computed(() => activeConversation.value.temperature.value);
const configuredModels = computed(
  () => activeConversation.value.configuredModels.value
);
const selectedModelId = computed(
  () => activeConversation.value.selectedModelId.value
);
const conversationError = computed(
  () => activeConversation.value.conversationError.value
);
const responding = computed(() => activeConversation.value.isBusy.value);
const canSend = computed(() => activeConversation.value.canSend.value);
const canSendAttachments = computed(
  () => activeConversation.value.canSendAttachments.value
);
const canStop = computed(() => activeConversation.value.canStop.value);
const activeLongConversation = computed<AgentConversationController | null>(
  () => {
    const summary = activeLongBookSummary.value;
    const profile = activeLongAgentProfile.value;
    if (!summary || !profile) return null;
    return conversationForKey(
      longConversationKey(
        summary.id,
        profile.id,
        activeLongRoot.value,
        activeLongSelection.value?.chapterCardId
      ),
      `long:${summary.id}`
    );
  }
);
const longMessages = computed(
  () => activeLongConversation.value?.messages.value ?? []
);
const longConversationHistory = computed(
  () => activeLongConversation.value?.history.value ?? []
);
const longCurrentSessionId = computed(
  () => activeLongConversation.value?.sessionId.value ?? ""
);
const activeLongConversationProposalItems = computed(() =>
  activeLongProposalItems.value.filter(
    (item) => item.event.payload.sessionId === longCurrentSessionId.value
  )
);
const longApprovalMode = computed(
  () =>
    activeLongConversation.value?.approvalMode.value ??
    generalSettings.value.permissionMode
);
const longComposerDraft = computed({
  get: () => activeLongConversation.value?.draft.value ?? "",
  set: (value: string) => {
    const conversation = activeLongConversation.value;
    if (conversation) conversation.draft.value = value;
  }
});
const longThinkingLevel = computed(
  () => activeLongConversation.value?.thinkingLevel.value ?? "medium"
);
const longTemperature = computed(
  () => activeLongConversation.value?.temperature.value ?? 0.7
);
const longConfiguredModels = computed(
  () => activeLongConversation.value?.configuredModels.value ?? []
);
const longSelectedModelId = computed(
  () => activeLongConversation.value?.selectedModelId.value ?? ""
);
const longConversationError = computed(
  () => activeLongConversation.value?.conversationError.value ?? null
);
const longResponding = computed(
  () => activeLongConversation.value?.isBusy.value ?? false
);
const longCanSend = computed(
  () =>
    !longSendPreflightPending.value &&
    activeLongWorkspaceContextReady.value &&
    (activeLongConversation.value?.canSend.value ?? false)
);
const longCanSendAttachments = computed(
  () =>
    activeLongConversation.value?.canSendAttachments.value ?? false
);
const longCanStop = computed(
  () => activeLongConversation.value?.canStop.value ?? false
);
function agentRunScopeHasWriteBarrier(scope: string): boolean {
  if (scope === "general") return false;
  return [...conversations.entries()].some(
    ([key, conversation]) =>
      conversationScopes.get(key) === scope &&
      (conversation.isBusy.value || conversation.hasPendingEditReview.value)
  );
}

function agentRunScopeIsBusy(scope: string): boolean {
  return [...conversations.entries()].some(
    ([key, conversation]) =>
      conversationScopes.get(key) === scope && conversation.isBusy.value
  );
}

function agentRunScopeHasPendingEditReview(scope: string): boolean {
  return [...conversations.entries()].some(
    ([key, conversation]) =>
      conversationScopes.get(key) === scope &&
      conversation.hasPendingEditReview.value
  );
}

const activeLongAgentRunScope = computed(() =>
  activeLongBookSummary.value
    ? `long:${activeLongBookSummary.value.id}`
    : null
);
const longEditorLocked = computed(() => {
  const scope = activeLongAgentRunScope.value;
  const workspaceId = activeLongBookSummary.value
    ? `long:${activeLongBookSummary.value.id}`
    : null;
  return (
    longSendPreflightPending.value ||
    longProposalApprovalPending.value ||
    Boolean(
      workspaceId && acceptingAgentEditWorkspaceIds.value.has(workspaceId)
    ) ||
    Boolean(scope && agentRunScopeHasWriteBarrier(scope)) ||
    activeLongConversationProposalItems.value.some(
      ({ status }) => status !== "accepted"
    )
  );
});
const longEditorLockedReason = computed(() => {
  if (longSendPreflightPending.value) {
    return "正在保存并准备发送，编辑暂时锁定";
  }
  if (
    longProposalApprovalPending.value ||
    (activeLongBookSummary.value &&
      acceptingAgentEditWorkspaceIds.value.has(
        `long:${activeLongBookSummary.value.id}`
      ))
  ) {
    return "正在应用长篇提案，编辑暂时锁定";
  }
  const scope = activeLongAgentRunScope.value;
  if (scope && agentRunScopeIsBusy(scope)) {
    return "长篇智能体运行中 · 暂停编辑以防止版本冲突";
  }
  return "请先接受或拒绝待审阅变更，再继续编辑";
});
const editorLocked = computed(() => {
  const selectedDocument =
    promptDocumentForResourceId(selectedResourceId.value) ?? activeDocument.value;
  return (
    acceptingAgentEditDocumentIds.value.has(activeDocument.value.id) ||
    acceptingAgentEditWorkspaceIds.value.has(
      agentRunScopeForDocument(activeAgentDocument.value)
    ) ||
    (activeDocument.value.workspaceId !== undefined &&
      acceptingAgentEditWorkspaceIds.value.has(activeDocument.value.workspaceId)) ||
    agentRunScopeHasWriteBarrier(agentRunScopeForDocument(selectedDocument))
  );
});
const editorLockedLabel = computed(() => {
  if (
    acceptingAgentEditDocumentIds.value.has(activeDocument.value.id) ||
    acceptingAgentEditWorkspaceIds.value.has(
      agentRunScopeForDocument(activeAgentDocument.value)
    ) ||
    (activeDocument.value.workspaceId !== undefined &&
      acceptingAgentEditWorkspaceIds.value.has(activeDocument.value.workspaceId))
  ) {
    return "正在接受并保存智能体修改";
  }
  return agentRunScopeHasPendingEditReview(
    agentRunScopeForDocument(activeAgentDocument.value)
  )
    ? "请先接受或拒绝待审阅变更"
    : undefined;
});
const editorSaving = computed(() => savingDocumentIds.value.has(activeDocument.value.id));
const activeAgentId = computed<ShortWorkspaceAgentId | undefined>(() => {
  const document = activeAgentDocument.value;
  return (document.workspaceType === "short" || document.workspaceType === "script") && document.stageId
    ? document.shortAgentId ?? resolveShortWorkspaceAgentIdForStage(document.stageId)
    : undefined;
});
const activeLibraryDomain = computed<LibraryAgentDomain | undefined>(() => {
  const domain = activeAgentDocument.value.domain;
  return domain === "material" || domain === "skill" ? domain : undefined;
});
const activeShortAgentProfile = computed(() => {
  const agentId = activeAgentId.value;
  const workspaceType = activeAgentDocument.value.workspaceType;
  return agentId
    ? workspaceAgentSettings.value
        .find((settings) => settings.workspaceType === workspaceType)
        ?.agents.find((agent) => agent.id === agentId)
    : undefined;
});
const activeLibraryAgentProfile = computed(() => {
  const domain = activeAgentDocument.value.domain;
  return domain === "material" || domain === "skill"
    ? libraryAgentSettings.value.agents.find((agent) => agent.domain === domain)
    : undefined;
});
const activeAgentLabel = computed(
  () =>
    activeShortAgentProfile.value?.label ??
    activeLibraryAgentProfile.value?.label ??
    "智能体对话"
);
const composerBookTitle = computed(
  () =>
    activeAgentDocument.value.workspaceTitle ??
    activeAgentDocument.value.path[0] ??
    "未选择资源"
);
const composerStageLabel = computed(() => {
  const agentId = activeAgentId.value;
  if (agentId) return COMPOSER_STAGE_LABELS[agentId];
  return activeAgentDocument.value.domain === "skill"
    ? "技能库"
    : activeAgentDocument.value.domain === "material"
      ? "素材库"
      : "未选择阶段";
});
const activeLibraryAttachments = computed(() => {
  if (activeAgentDocument.value.domain !== "creation") return null;
  const workspaceId = activePromptDocument.value.workspaceId;
  return catalogSnapshot.value && workspaceId && catalogBook(workspaceId)
    ? buildLibraryAttachments(catalogSnapshot.value, workspaceId)
    : null;
});
const activeLibrarySkillAttachments = computed(() => {
  const profile = activeLibraryAgentProfile.value;
  if (!profile) return null;
  return buildLibraryAgentSkillAttachments(profile.readAccess.skills);
});
const activeLibraryWelcomeSkills = computed(() =>
  activeLibraryAgentProfile.value?.readAccess.skills.map((skill) => ({
    name: skill.name
  }))
);
const activeWelcomeShortcuts = computed(() =>
  activeShortAgentProfile.value?.welcomeShortcuts
);
const availableSkillReferences = computed<ComposerReferenceOption[]>(() => {
  if (activeLibraryDomain.value) {
    return (activeLibrarySkillAttachments.value?.attachedSkills ?? []).map((skill) => ({
      id: skill.id,
      label: skill.title,
      detail: "按需加载的方法"
    }));
  }
  const allowedKinds = new Set(activeShortAgentProfile.value?.readAccess.skill ?? []);
  return (activeLibraryAttachments.value?.attachedSkills ?? [])
    .filter(
      (skill): skill is typeof skill & { kind: SkillKind } =>
        skill.kind !== undefined && allowedKinds.has(skill.kind)
    )
    .map((skill) => ({
      id: skill.id,
      label: skill.title,
      detail: `${SKILL_KIND_LABELS[skill.kind]} · 当前书籍已绑定`
    }));
});
const availableMaterialReferences = computed<ComposerReferenceOption[]>(() => {
  if (activeLibraryDomain.value) {
    return buildLibraryEntryComposerReferences(activeLibraryAgentContext.value);
  }
  const allowedKinds = new Set(activeShortAgentProfile.value?.readAccess.material ?? []);
  return (activeLibraryAttachments.value?.attachedMaterials ?? [])
    .filter(
      (material): material is typeof material & { kind: MaterialKind } =>
        material.kind !== undefined && allowedKinds.has(material.kind)
    )
    .map((material) => ({
      id: material.id,
      label: material.title,
      detail: `${MATERIAL_KIND_LABELS[material.kind]} · 当前书籍已绑定`
    }));
});

const shellClasses = computed(() => ({
  "is-left-collapsed": leftCollapsed.value,
  "is-right-collapsed": rightCollapsed.value,
  "is-resizing": resizingPane.value !== null
}));
const shellStyle = computed(() => ({
  "--left-pane-width": `${leftPaneWidth.value}px`,
  "--right-pane-width": `${rightPaneWidth.value}px`
}));
const hasDesktopRuntime = computed(() => Boolean(window.deepwrite));

watch(conversationError, (message) => {
  if (message) {
    uiMessage.error(message);
  }
});
watch(longConversationError, (message) => {
  if (message) {
    uiMessage.error(message);
  }
});
watch(
  () => learningImitation.error.value,
  (message) => {
    if (message) {
      uiMessage.error(message);
    }
  }
);
watch(
  () => subagentAuthoring.error.value,
  (message) => {
    if (message) {
      uiMessage.error(message);
    }
  }
);

const LEFT_PANE_MIN = 220;
const LEFT_PANE_MAX = 480;
const RIGHT_PANE_MIN = 320;
const RIGHT_PANE_MAX = 760;
const CENTER_PANE_MIN_FALLBACK = 420;

function centerPaneMinWidth(): number {
  if (!desktopShell.value) {
    return CENTER_PANE_MIN_FALLBACK;
  }
  const value = Number.parseFloat(
    window.getComputedStyle(desktopShell.value).getPropertyValue("--center-pane-min")
  );
  return Number.isFinite(value) ? value : CENTER_PANE_MIN_FALLBACK;
}

function clampPaneWidth(side: "left" | "right", width: number): number {
  const shellWidth = desktopShell.value?.getBoundingClientRect().width ?? window.innerWidth;
  const otherWidth =
    side === "left"
      ? rightCollapsed.value
        ? 0
        : rightPaneWidth.value
      : leftCollapsed.value
        ? 0
        : leftPaneWidth.value;
  const paneMin = side === "left" ? LEFT_PANE_MIN : RIGHT_PANE_MIN;
  const paneMax = side === "left" ? LEFT_PANE_MAX : RIGHT_PANE_MAX;
  const availableMax = Math.max(paneMin, shellWidth - otherWidth - centerPaneMinWidth());
  return Math.round(Math.min(Math.max(width, paneMin), paneMax, availableMax));
}

function setPaneWidth(side: "left" | "right", width: number): void {
  if (side === "left") {
    leftPaneWidth.value = clampPaneWidth(side, width);
    return;
  }
  rightPaneWidth.value = clampPaneWidth(side, width);
}

function reconcilePaneWidths(): void {
  if (!leftCollapsed.value) {
    setPaneWidth("left", leftPaneWidth.value);
  }
  if (!rightCollapsed.value) {
    setPaneWidth("right", rightPaneWidth.value);
  }
}

function handleResizeMove(event: PointerEvent): void {
  if (!resizingPane.value || !desktopShell.value) {
    return;
  }
  const bounds = desktopShell.value.getBoundingClientRect();
  const width =
    resizingPane.value === "left" ? event.clientX - bounds.left : bounds.right - event.clientX;
  setPaneWidth(resizingPane.value, width);
}

function stopPaneResize(): void {
  resizingPane.value = null;
  window.removeEventListener("pointermove", handleResizeMove);
  window.removeEventListener("pointerup", stopPaneResize);
  window.removeEventListener("pointercancel", stopPaneResize);
}

function startPaneResize(side: "left" | "right", event: PointerEvent): void {
  event.preventDefault();
  resizingPane.value = side;
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", stopPaneResize);
  window.addEventListener("pointercancel", stopPaneResize);
}

function handleResizeKeydown(side: "left" | "right", event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const currentWidth = side === "left" ? leftPaneWidth.value : rightPaneWidth.value;
  setPaneWidth(side, currentWidth + direction * (side === "left" ? 12 : -12));
}

function blockActiveLongWritingPlan(
  action: string,
  options: {
    targetBookId?: string | null;
    allowPlanBook?: boolean;
  } = {}
): boolean {
  if (!longWritingOrchestrator.active.value) return false;
  const planBookId = longWritingOrchestrator.state.value.bookId;
  if (
    options.allowPlanBook &&
    options.targetBookId &&
    options.targetBookId === planBookId
  ) {
    return false;
  }
  uiMessage.warning(
    `当前长篇串行写作计划尚未完成；请先取消计划，再${action}。`
  );
  return true;
}

async function selectResource(node: ResourceTreeNode): Promise<void> {
  if (
    blockActiveLongWritingPlan("切换创作空间", {
      targetBookId: node.longBookId ?? null,
      allowPlanBook: true
    })
  ) {
    return;
  }
  if (node.longBookId) {
    if (!(await saveActiveLongEditorBeforeLeaving(node.longBookId))) {
      return;
    }
    workspaceMainView.value = "conversation";
    selectedResourceId.value = node.id;
    rightCollapsed.value = false;
    if (
      activeLongBookId.value !== node.longBookId ||
      !activeLongWorkspaceIndex.value
    ) {
      await openLongBook(node.longBookId);
    }
    if (
      node.longWorkspaceSelection &&
      activeLongBookSummary.value?.id === node.longBookId &&
      activeLongWorkspaceIndex.value
    ) {
      const selection = reconcileLongWorkspaceSelection(
        activeLongBookSummary.value,
        activeLongWorkspaceIndex.value,
        node.longWorkspaceSelection
      );
      if (selection) {
        await selectLongWorkspaceFile(selection);
      }
    }
    return;
  }
  if (!(await saveActiveLongEditorBeforeLeaving())) {
    return;
  }
  if (activeLongBookId.value) {
    longWorkspaceRefreshClock.invalidate(activeLongBookId.value);
  }
  longWorkspaceRefreshStatus.value = null;
  activeLongBookId.value = null;
  activeLongWorkspaceIndex.value = null;
  activeLongSelection.value = null;
  activeLongFileContext.value = null;
  longRollbackDialogOpen.value = false;
  longRollbackCommitId.value = null;
  longStructureDialogOpen.value = false;
  longCharacterCreate.value = null;
  longPlotPointCreate.value = null;
  longChapterCardCreate.value = null;
  longVolumeCreateOpen.value = false;
  longBindingsDialogMode.value = null;
  const directory = draftDirectoryForResourceId(node.id);
  if (directory && node.expertSectionId) {
    selectedExpertSectionIds.value = {
      ...selectedExpertSectionIds.value,
      [directory.id]: node.expertSectionId
    };
    selectedDraftFileKinds.value = {
      ...selectedDraftFileKinds.value,
      [directory.id]: "body"
    };
  }
  const document = documentForResourceId(node.id);
  if (!document) {
    return;
  }
  workspaceMainView.value = "conversation";
  selectedResourceId.value = node.id;
  if (document.domain === "creation") {
    activeCreationResourceId.value = node.id;
  }
  rightCollapsed.value = false;
}

function openLongCharacterCreate(): void {
  const group = activeLongSelection.value?.characterGroup;
  const bookId = activeLongBookSummary.value?.id;
  if (!group || !bookId || !activeLongWorkspaceIndex.value) {
    uiMessage.warning("当前人物分组尚未就绪。");
    return;
  }
  if (blockActiveLongWritingPlan("新增人物")) return;
  const groupOption = LONG_CHARACTER_GROUP_OPTIONS.find(
    ({ value }) => value === group
  );
  if (!groupOption) return;
  longCharacterCreate.value = {
    bookId,
    group,
    groupLabel: groupOption.label
  };
}

async function openLongVolumeCreate(): Promise<void> {
  if (
    !activeLongWorkspaceIndex.value ||
    activeLongSelection.value?.key !== "plot-design:book-line" ||
    blockActiveLongWritingPlan("新增分卷")
  ) {
    return;
  }
  if (!(await saveActiveLongEditorChanges())) {
    return;
  }
  longVolumeCreateOpen.value = true;
}

async function openLongPlotPointCreateForVolume(
  bookId: string,
  volumeId: string
): Promise<void> {
  if (blockActiveLongWritingPlan("新增剧情点")) {
    return;
  }
  if (activeLongBookId.value !== bookId) {
    if (!(await saveActiveLongEditorBeforeLeaving(bookId))) {
      return;
    }
    await openLongBook(bookId);
  } else if (!(await saveActiveLongEditorChanges())) {
    return;
  }
  const index = activeLongWorkspaceIndex.value;
  const volume = index?.plot.volumes.find(({ id }) => id === volumeId);
  if (
    activeLongBookId.value !== bookId ||
    !index ||
    !volume
  ) {
    uiMessage.warning("该分卷已不存在，请刷新后重试。");
    return;
  }
  longPlotPointCreate.value = {
    bookId,
    volumeId,
    volumeTitle: volume.title
  };
}

async function openLongPlotPointCreate(): Promise<void> {
  const bookId = activeLongBookId.value;
  const volumeId = activeLongSelection.value?.plotPointVolumeId;
  if (!bookId || !volumeId) {
    uiMessage.warning("当前分卷尚未就绪。");
    return;
  }
  await openLongPlotPointCreateForVolume(bookId, volumeId);
}

async function saveLongVolumeOutline(
  input: { volumeId: string; outline: string },
  completion: (succeeded: boolean) => void
): Promise<void> {
  const index = activeLongWorkspaceIndex.value;
  const volume = index?.plot.volumes.find(({ id }) => id === input.volumeId);
  if (!index || !volume) {
    uiMessage.warning("该分卷已不存在，请刷新后重试。");
    completion(false);
    return;
  }
  let batch: LongWorkspaceOperationBatch;
  try {
    batch = createLongStructureMutationBuilder(index).updateVolume(
      volume.id,
      { summary: input.outline }
    );
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法保存分卷卷纲。"
    );
    completion(false);
    return;
  }
  await applyLongStructureMutation(
    batch,
    {
      succeed: () => completion(true),
      fail: () => completion(false),
      appliedButRefreshFailed: () => completion(true)
    },
    {
      saveEditor: false,
      successMessage: `已保存“${volume.title}”的卷纲`
    }
  );
}

async function saveLongPlotPointContent(
  input: {
    plotPointId: LongArcId;
    field: "summary";
    content: string;
  },
  completion: (succeeded: boolean) => void
): Promise<void> {
  const index = activeLongWorkspaceIndex.value;
  const plotPoint = index?.plot.arcs.find(
    ({ id }) => id === input.plotPointId
  );
  if (!index || !plotPoint) {
    uiMessage.warning("该剧情点已不存在，请刷新后重试。");
    completion(false);
    return;
  }
  let batch: LongWorkspaceOperationBatch;
  try {
    batch = createLongStructureMutationBuilder(index).updateArc(
      plotPoint.id,
      { summary: input.content }
    );
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法保存剧情点内容。"
    );
    completion(false);
    return;
  }
  await applyLongStructureMutation(
    batch,
    {
      succeed: () => completion(true),
      fail: () => completion(false),
      appliedButRefreshFailed: () => completion(true)
    },
    {
      saveEditor: false,
      successMessage: `已保存“${plotPoint.title}”的${
        input.field === "summary" ? "概要" : "故事情节"
      }`
    }
  );
}

async function createLongVolume(
  input: { title: string; summary: string }
): Promise<void> {
  const index = activeLongWorkspaceIndex.value;
  if (
    !longVolumeCreateOpen.value ||
    !index ||
    longBookActionPending.value
  ) {
    uiMessage.warning("当前长篇工作区尚未准备好新建分卷。");
    return;
  }
  let batch: LongWorkspaceOperationBatch;
  try {
    batch = createLongStructureMutationBuilder(index).createVolume(input);
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法创建分卷。"
    );
    return;
  }
  const created = batch.operations.find(
    (operation) => operation.type === "volume.create"
  );
  if (!created || created.type !== "volume.create") {
    uiMessage.warning("无法确定新建分卷。");
    return;
  }

  let succeeded = false;
  let applied = false;
  await handleLongStructureMutation(batch, {
    succeed: () => {
      succeeded = true;
      applied = true;
    },
    fail: () => undefined,
    appliedButRefreshFailed: () => {
      applied = true;
    }
  });
  if (!applied) return;
  longVolumeCreateOpen.value = false;
  if (!succeeded) return;
  await nextTick();
  longWorkspaceEditor.value?.selectBookLineVolume(created.volume.id);
}

async function createLongPlotPoint(
  input: { title: string; summary: string }
): Promise<void> {
  const target = longPlotPointCreate.value;
  const index = activeLongWorkspaceIndex.value;
  if (
    !target ||
    !index ||
    activeLongBookId.value !== target.bookId ||
    longBookActionPending.value
  ) {
    uiMessage.warning("当前分卷尚未准备好新建剧情点。");
    return;
  }
  let batch: LongWorkspaceOperationBatch;
  try {
    batch = createLongStructureMutationBuilder(index).createArc({
      volumeId: target.volumeId,
      title: input.title,
      summary: input.summary,
      outline: ""
    });
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法创建剧情点。"
    );
    return;
  }

  let applied = false;
  await applyLongStructureMutation(
    batch,
    {
      succeed: () => {
        applied = true;
      },
      fail: () => undefined,
      appliedButRefreshFailed: () => {
        applied = true;
      }
    },
    {
      saveEditor: false,
      successMessage: `已创建剧情点“${input.title}”`
    }
  );
  if (applied) {
    longPlotPointCreate.value = null;
  }
}

async function createLongChapterCard(
  input: { title: string; primaryArcId: string }
): Promise<void> {
  const target = longChapterCardCreate.value;
  const index = activeLongWorkspaceIndex.value;
  if (
    !target ||
    !index ||
    activeLongBookId.value !== target.bookId ||
    longBookActionPending.value
  ) {
    uiMessage.warning("当前分卷尚未准备好新建章卡。");
    return;
  }
  if (
    !target.arcOptions.some(({ value }) => value === input.primaryArcId)
  ) {
    uiMessage.warning("所选剧情点已不存在，请重新打开弹窗。");
    return;
  }

  let batch: LongWorkspaceOperationBatch;
  try {
    batch = createLongStructureMutationBuilder(index).createChapter({
      volumeId: target.volumeId,
      primaryArcId: input.primaryArcId,
      title: input.title
    });
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法创建章卡。"
    );
    return;
  }
  const created = batch.operations.find(
    (operation) => operation.type === "chapter.create"
  );
  if (!created || created.type !== "chapter.create") {
    uiMessage.warning("无法确定新建章卡。");
    return;
  }

  let succeeded = false;
  let applied = false;
  await applyLongStructureMutation(
    batch,
    {
      succeed: () => {
        succeeded = true;
        applied = true;
      },
      fail: () => undefined,
      appliedButRefreshFailed: () => {
        applied = true;
      }
    },
    {
      saveEditor: false,
      successMessage: `已创建章卡“${input.title}”`
    }
  );
  if (!applied) return;
  longChapterCardCreate.value = null;
  if (!succeeded) return;
  await nextTick();
  await selectLongChapterCardTab(created.chapterCard.id);
}

function collectResourceNodeIds(node: ResourceTreeNode): string[] {
  return [node.id, ...(node.children?.flatMap(collectResourceNodeIds) ?? [])];
}

function findVisibleBook(bookId: string): ResourceTreeNode | undefined {
  return resourceTreeSections.value
    .find((section) => section.id === "creation")
    ?.nodes.find((node) => node.id === bookId);
}

function updateBookPreference(bookId: string, patch: BookResourcePreference): void {
  bookResourcePreferences.value = {
    ...bookResourcePreferences.value,
    [bookId]: {
      ...bookResourcePreferences.value[bookId],
      ...patch
    }
  };
  try {
    localStorage.setItem(
      BOOK_RESOURCE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(bookResourcePreferences.value)
    );
  } catch {
    uiMessage.warning("书籍设置暂时无法保存，但本次操作仍然有效");
  }
}

async function preparePlotStructureMutation(bookId: string): Promise<boolean> {
  await editorSaveChain;
  const scopedDocuments = documents.value.filter(
    (document) => document.workspaceId === bookId
  );
  const scope = scopedDocuments[0]
    ? agentRunScopeForDocument(scopedDocuments[0])
    : `book:${bookId}`;
  // Load every conversation that can still own a pending write for this book,
  // including persisted section-writer reviews that have not been opened in
  // the current app session yet.
  for (const agentId of [
    "character_design",
    "plot_design",
    "expert_draft_coordinator"
  ] as const) {
    conversationForKey(`${bookId}:${agentId}`, scope);
  }
  for (const sectionId of new Set(
    scopedDocuments.flatMap((document) =>
      document.expertSectionId ? [document.expertSectionId] : []
    )
  )) {
    conversationForKey(
      `${bookId}:expert_section_writer:${encodeURIComponent(sectionId)}`,
      scope
    );
  }
  if (
    agentRunScopeHasWriteBarrier(scope) ||
    acceptingAgentEditWorkspaceIds.value.has(bookId)
  ) {
    uiMessage.warning("请先等待当前智能体结束，并接受或拒绝待审阅变更。");
    return false;
  }
  if (
    saveConflict.value &&
    scopedDocuments.some(({ id }) => id === saveConflict.value?.documentId)
  ) {
    uiMessage.warning("请先处理该作品尚未解决的保存冲突。");
    return false;
  }
  const dirtyDocuments = scopedDocuments.filter(
    ({ id, readOnly }) => !readOnly && editorDrafts.value[id]?.dirty
  );
  for (const document of dirtyDocuments) {
    const draft = editorDrafts.value[document.id];
    if (!draft?.dirty) continue;
    cancelEditorAutoSave(document.id);
    const saved = await persistEditorDocument(
      { id: document.id, title: draft.title, content: draft.content },
      false
    );
    if (!saved) {
      uiMessage.warning("存在无法安全保存的草稿，结构未变更。");
      return false;
    }
  }
  return true;
}

async function openBookDialog(
  mode: BookResourceDialogMode,
  book: ResourceTreeNode
): Promise<void> {
  if (mode === "manage-structure") {
    if (!(await preparePlotStructureMutation(book.id))) return;
    if (catalogBook(book.id)?.projectRevision === undefined) {
      uiMessage.error("当前作品缺少项目版本，无法安全管理结构。");
      return;
    }
    activeBook.value = book;
    plotStructureBookId.value = book.id;
    bookDialogMode.value = null;
    return;
  }
  activeBook.value = book;
  bookDialogMode.value = mode;
}

async function mutateCharacterStructure(
  mutation: CharacterStructureMutation,
  completion: PlotStructureMutationCompletion,
  bookIdOverride?: string
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) {
    completion.fail();
    return;
  }
  const bookId = bookIdOverride ?? plotStructureBookId.value;
  const book = bookId ? catalogBook(bookId) : undefined;
  if (!bookId || !book || !(await preparePlotStructureMutation(bookId))) {
    completion.fail();
    return;
  }
  if (book.projectRevision === undefined) {
    completion.fail();
    uiMessage.error("当前作品缺少项目版本，无法安全变更人物结构。");
    return;
  }
  catalogMutationPending.value = true;
  try {
    await window.deepwrite.catalog.mutateCharacterStructure({
      bookId,
      baseProjectRevision: book.projectRevision,
      mutation
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    completion.succeed();
    uiMessage.success(
      mutation.type === "setFormat"
        ? mutation.format === "list"
          ? "人物结构已转换为条目样式"
          : "人物结构已转换为文本样式"
        : mutation.type === "createItem"
          ? "人物条目已创建"
          : mutation.type === "updateItem"
            ? "人物条目名称已更新"
            : mutation.type === "moveItem"
              ? "人物条目顺序已更新"
              : "人物条目已删除"
    );
  } catch (error) {
    completion.fail();
    uiMessage.error(error instanceof Error ? error.message : "人物结构变更失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function characterBookIdForNode(node: ResourceTreeNode): string | undefined {
  return documentForResourceId(node.id)?.workspaceId;
}

function requestCreateCharacterItem(node: ResourceTreeNode): void {
  const bookId = characterBookIdForNode(node);
  if (!bookId) {
    uiMessage.warning("无法确定人物条目所属作品。");
    return;
  }
  characterItemDialog.value = { mode: "create", bookId, title: "" };
}

function findCharacterDirectoryNode(
  resourceId: string
): ResourceTreeNode | undefined {
  const visit = (
    nodes: readonly ResourceTreeNode[],
    parent?: ResourceTreeNode
  ): ResourceTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === resourceId) {
        if (node.characterDirectory) return node;
        if (parent?.characterDirectory) return parent;
        return undefined;
      }
      const nested = visit(node.children ?? [], node);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(resourceTreeSections.value.flatMap((section) => section.nodes));
}

function selectCharacterItemTab(documentId: string): void {
  if (!activeCharacterItemTabs.value.some((tab) => tab.id === documentId)) {
    uiMessage.warning("该人物条目已不存在，列表已刷新");
    return;
  }
  const resourceId = resourceIdForDocumentId(documentId) ?? documentId;
  selectedResourceId.value = resourceId;
  activeCreationResourceId.value = resourceId;
}

function addCharacterItemFromEditor(): void {
  const directory =
    findCharacterDirectoryNode(selectedResourceId.value) ??
    (activeDocument.value.workspaceId
      ? findCharacterDirectoryNode(
          resourceIdForDocumentId(activeDocument.value.id) ??
            activeDocument.value.id
        )
      : undefined);
  if (!directory) {
    uiMessage.warning("无法确定人物目录，暂时不能新建人物条目。");
    return;
  }
  requestCreateCharacterItem(directory);
}

function deleteCharacterItemFromEditor(): void {
  const document = activeDocument.value;
  if (
    document.characterFileKind !== "item" ||
    !document.characterItemId ||
    !document.workspaceId
  ) {
    uiMessage.warning("请先选择一个人物条目。");
    return;
  }
  characterItemDialog.value = {
    mode: "delete",
    bookId: document.workspaceId,
    itemId: document.characterItemId,
    title: document.title
  };
}

function selectEditorSection(sectionId: string): void {
  if (editorShowsCharacterItemTabs.value) {
    selectCharacterItemTab(sectionId);
    return;
  }
  selectExpertSection(sectionId);
}

function createEditorSection(): void {
  if (editorShowsCharacterItemTabs.value) {
    addCharacterItemFromEditor();
    return;
  }
  void addExpertSectionFromEditor();
}

function deleteEditorSection(): void {
  if (editorShowsCharacterItemTabs.value) {
    deleteCharacterItemFromEditor();
    return;
  }
  removeExpertSectionFromEditor();
}

function handleCharacterItemAction(
  action: "rename" | "move-up" | "move-down" | "delete",
  node: ResourceTreeNode
): void {
  const bookId = characterBookIdForNode(node);
  const itemId = node.characterItemId;
  if (!bookId || !itemId) {
    uiMessage.warning("无法确定人物条目。");
    return;
  }
  if (action === "move-up" || action === "move-down") {
    void mutateCharacterStructure(
      {
        type: "moveItem",
        itemId,
        direction: action === "move-up" ? "up" : "down"
      },
      { succeed: () => undefined, fail: () => undefined },
      bookId
    );
    return;
  }
  characterItemDialog.value = {
    mode: action,
    bookId,
    itemId,
    title: node.label
  };
}

function closeCharacterItemDialog(): void {
  if (!catalogMutationPending.value) characterItemDialog.value = null;
}

function submitCharacterItemDialog(title: string): void {
  const target = characterItemDialog.value;
  if (!target) return;
  const mutation: CharacterStructureMutation =
    target.mode === "create"
      ? { type: "createItem", title }
      : target.mode === "rename"
        ? { type: "updateItem", itemId: target.itemId!, title }
        : { type: "deleteItem", itemId: target.itemId! };
  void mutateCharacterStructure(
    mutation,
    {
      succeed: () => {
        characterItemDialog.value = null;
      },
      fail: () => undefined
    },
    target.bookId
  );
}

function closeBookDialog(): void {
  bookDialogMode.value = null;
  plotStructureBookId.value = null;
  activeBook.value = null;
}

async function mutatePlotStructure(
  mutation: PlotStructureMutation,
  completion: PlotStructureMutationCompletion
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) {
    completion.fail();
    return;
  }
  const bookId = plotStructureBookId.value;
  const book = bookId ? catalogBook(bookId) : undefined;
  if (!bookId || !book || !(await preparePlotStructureMutation(bookId))) {
    completion.fail();
    return;
  }
  if (book.projectRevision === undefined) {
    completion.fail();
    uiMessage.error("当前作品缺少项目版本，无法安全变更剧情结构。");
    return;
  }
  const deletedIndex =
    mutation.type === "delete"
      ? book.plotStages.findIndex(({ id }) => id === mutation.stageId)
      : -1;
  const selectedPlotStageId = documents.value.find(
    ({ id }) => id === selectedResourceId.value
  )?.stageId;
  catalogMutationPending.value = true;
  try {
    await window.deepwrite.catalog.mutatePlotStructure({
      bookId,
      baseProjectRevision: book.projectRevision,
      mutation
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    if (
      mutation.type === "delete" &&
      selectedPlotStageId === mutation.stageId
    ) {
      const refreshed = catalogBook(bookId);
      const fallbackStage = refreshed?.plotStages[
        Math.min(Math.max(0, deletedIndex), refreshed.plotStages.length - 1)
      ];
      const fallbackDocument = fallbackStage
        ? documents.value.find(
            (document) =>
              document.workspaceId === bookId &&
              document.stageId === fallbackStage.id &&
              document.draftFileKind === undefined
          )
        : undefined;
      if (fallbackDocument) {
        selectedResourceId.value = fallbackDocument.id;
        activeCreationResourceId.value = fallbackDocument.id;
      }
    }
    completion.succeed();
    uiMessage.success(
      mutation.type === "create"
        ? "剧情结构已创建，并同步到全部短篇与剧本"
        : mutation.type === "update"
          ? "剧情结构已全局更新"
          : mutation.type === "move"
            ? "剧情结构顺序已更新"
            : mutation.type === "setEnabled"
              ? mutation.enabled
                ? "已启用该剧情结构"
                : "已关闭该剧情结构"
              : "剧情结构已从全部作品中删除"
    );
  } catch (error: unknown) {
    completion.fail();
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      uiMessage.warning("作品已在其他位置更新，已重新加载；请确认后重试。");
    } else {
      uiMessage.error(
        error instanceof Error ? error.message : "剧情结构变更失败。"
      );
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

const MANUSCRIPT_EXPORT_FORMAT_LABELS: Record<
  ShortManuscriptExportFormat,
  string
> = {
  docx: "DOCX",
  txt: "TXT",
  epub: "EPUB"
};

function openBookExportDialog(book: ResourceTreeNode): void {
  exportBookTarget.value = book;
}

function closeBookExportDialog(): void {
  if (!manuscriptExportPending.value) {
    exportBookTarget.value = null;
  }
}

async function exportBookManuscript(
  format: ShortManuscriptExportFormat
): Promise<void> {
  if (!window.deepwrite || manuscriptExportPending.value) return;
  const bookNode = exportBookTarget.value;
  if (!bookNode) return;
  const book = catalogBook(bookNode.id);
  if (!book) {
    uiMessage.error("未找到要导出正文的书籍");
    exportBookTarget.value = null;
    return;
  }
  manuscriptExportPending.value = true;
  try {
    const result = await window.deepwrite.manuscript.exportShort(
      createShortManuscriptExportInput(
        book,
        documents.value,
        editorDrafts.value,
        format
      )
    );
    if (result.status === "saved") {
      exportBookTarget.value = null;
      uiMessage.success(
        `已将“${book.title}”的${book.bookType === "script" ? "全部剧集" : "导语和全部小节"}导出为 ${MANUSCRIPT_EXPORT_FORMAT_LABELS[format]}`
      );
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "导出正文失败。");
  } finally {
    manuscriptExportPending.value = false;
  }
}

async function renameCatalogBook(
  book: ResourceTreeNode,
  payload: { bookId: string; label: string }
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const persistedBook = catalogBook(payload.bookId);
    if (!persistedBook) {
      throw new Error("未找到要修改的书籍。");
    }
    const baseProjectRevision = book.projectRevision ?? persistedBook.projectRevision;
    await window.deepwrite.catalog.updateBook({
      bookId: payload.bookId,
      ...(baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision }),
      title: payload.label.trim().slice(0, 80)
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已将“${book.label}”修改为“${payload.label.trim()}”`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      closeBookDialog();
      uiMessage.warning("书籍配置已在外部更新，已重新加载；请确认后再次修改")
    } else {
      uiMessage.error(error instanceof Error ? error.message : "修改书名失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

function renameBook(payload: { bookId: string; label: string }): void {
  const book = findVisibleBook(payload.bookId);
  if (!book) {
    closeBookDialog();
    return;
  }

  if (catalogBook(payload.bookId)) {
    void renameCatalogBook(book, payload);
    return;
  }

  const label = payload.label.trim().slice(0, 80);
  const documentIds = new Set(collectResourceNodeIds(book));
  documents.value = documents.value.map((document) => {
    if (!documentIds.has(document.id)) {
      return document;
    }
    return {
      ...document,
      path: document.path.length ? [label, ...document.path.slice(1)] : [label],
      ...(document.workspaceId === payload.bookId ? { workspaceTitle: label } : {})
    };
  });
  updateBookPreference(payload.bookId, { label });
  closeBookDialog();
  uiMessage.success(`已将“${book.label}”修改为“${label}”`);
}

function disposeBookConversations(bookId: string, documentIds?: Set<string>): void {
  const conversationKeys = new Set(
    [...conversations.keys()].filter((key) => key.startsWith(`${bookId}:`))
  );
  for (const document of documents.value) {
    if (
      document.workspaceId === bookId ||
      Boolean(documentIds?.has(document.id))
    ) {
      const key = conversationKeyForDocument(document);
      if (key !== "general") conversationKeys.add(key);
    }
  }
  for (const key of conversationKeys) {
    conversations.get(key)?.dispose();
    conversations.delete(key);
    conversationScopes.delete(key);
  }
  removeAgentRunPreferences(`book:${bookId}`);
}

function longBookConversationEntries(
  bookId: string
): Array<[string, AgentConversationController]> {
  const prefix = `long:${encodeURIComponent(bookId)}:`;
  return [...conversations.entries()].filter(([key]) =>
    key.startsWith(prefix)
  );
}

async function stopLongBookAgentRuns(bookId: string): Promise<void> {
  for (const [, conversation] of longBookConversationEntries(bookId)) {
    if (!conversation.isBusy.value) continue;
    const stopAccepted = await conversation.stopGeneration();
    if (!stopAccepted) {
      throw new Error(
        "长篇智能体正在启动，暂时无法安全移除项目；请稍后重试。"
      );
    }
  }
  // Quarantine the proposal queue while the destructive catalog operation is
  // in flight. Even a late event from an aborting run cannot re-enqueue work.
  longWorkspaceProposals.discardBook(bookId);
}

function disposeLongBookRuntime(bookId: string): void {
  for (const [key, conversation] of longBookConversationEntries(bookId)) {
    conversation.dispose({ clearPersistence: true });
    conversations.delete(key);
    conversationScopes.delete(key);
  }
  longWorkspaceProposals.discardBook(bookId);
  if (longWritingOrchestrator.state.value.bookId === bookId) {
    longWritingOrchestrator.cancel();
  }
  if (longWritingAgentRunExpectation?.bookId === bookId) {
    longWritingAgentRunExpectation = null;
  }
  removeAgentRunPreferences(`long:${bookId}`);
}

function disposeLibraryConversation(
  domain: "material" | "skill",
  libraryId: string
): void {
  const key = `library:${domain}:${libraryId}`;
  conversations.get(key)?.dispose();
  conversations.delete(key);
  conversationScopes.delete(key);
  removeAgentRunPreferences(key);
}

async function removeCatalogBook(book: ResourceTreeNode): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: "book",
      projectId: book.id
    });
    if (!result.unregistered) {
      throw new Error(`未找到要移除的${book.workspaceType === "script" ? "剧本" : "书籍"}。`);
    }
    const removedDocumentIds = new Set(collectResourceNodeIds(book));
    editorDrafts.value = Object.fromEntries(
      Object.entries(editorDrafts.value).filter(
        ([documentId]) => !removedDocumentIds.has(documentId)
      )
    );
    disposeBookConversations(book.id);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已移除“${book.label}”`);
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error
        ? error.message
        : `移除${book.workspaceType === "script" ? "剧本" : "书籍"}失败。`
    );
  } finally {
    catalogMutationPending.value = false;
  }
}

async function deleteCatalogBook(book: ResourceTreeNode): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.deleteProject({
      domain: "book",
      projectId: book.id
    });
    if (!result.deleted) {
      throw new Error(`未找到要删除的${book.workspaceType === "script" ? "剧本" : "书籍"}。`);
    }
    const removedDocumentIds = new Set(collectResourceNodeIds(book));
    editorDrafts.value = Object.fromEntries(
      Object.entries(editorDrafts.value).filter(
        ([documentId]) => !removedDocumentIds.has(documentId)
      )
    );
    disposeBookConversations(book.id);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已删除“${book.label}”及其本地文件夹`);
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error
        ? error.message
        : `删除${book.workspaceType === "script" ? "剧本" : "书籍"}失败。`
    );
  } finally {
    catalogMutationPending.value = false;
  }
}

async function removeUnavailableCatalogBook(book: ResourceTreeNode): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: "book",
      projectId: book.id
    });
    if (!result.unregistered) {
      throw new Error("该书籍已经不在项目注册表中。");
    }
    disposeBookConversations(book.id);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(`已解除“${book.label}”的注册，本地文件夹未删除`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "移除不可用书籍失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function removeBook(bookId: string): void {
  const book = findVisibleBook(bookId);
  if (!book) {
    closeBookDialog();
    return;
  }

  if (catalogBook(bookId)) {
    void removeCatalogBook(book);
    return;
  }
  if (book.unavailable) {
    void removeUnavailableCatalogBook(book);
    return;
  }

  const documentIds = new Set(collectResourceNodeIds(book));
  disposeBookConversations(bookId, documentIds);

  documents.value = documents.value.filter((document) => !documentIds.has(document.id));
  editorDrafts.value = Object.fromEntries(
    Object.entries(editorDrafts.value).filter(([documentId]) => !documentIds.has(documentId))
  );
  if (documentIds.has(selectedResourceId.value)) {
    selectedResourceId.value =
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }
  if (documentIds.has(activeCreationResourceId.value)) {
    activeCreationResourceId.value =
      documents.value.find((document) => document.domain === "creation")?.id ??
      documents.value[0]?.id ??
      "";
  }

  updateBookPreference(bookId, { removed: true });
  closeBookDialog();
  uiMessage.success(`已移除“${book.label}”`);
}

function deleteBook(bookId: string): void {
  const book = findVisibleBook(bookId);
  if (!book) {
    closeBookDialog();
    return;
  }
  if (!catalogBook(bookId) || book.unavailable) {
    uiMessage.error("该书籍没有可删除的本地项目文件夹。");
    return;
  }
  void deleteCatalogBook(book);
}

async function updateCatalogBookBindings(
  book: ResourceTreeNode,
  payload:
    | { bookId: string; domain: "skill"; linksByKind: LinkedSkillIdsByKind }
    | { bookId: string; domain: "material"; linksByKind: LinkedMaterialIdsByKind }
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const persistedBook = catalogBook(payload.bookId);
    if (!persistedBook) {
      throw new Error("未找到要更新绑定的书籍。");
    }
    const baseProjectRevision = book.projectRevision ?? persistedBook.projectRevision;
    await window.deepwrite.catalog.updateBook({
      bookId: payload.bookId,
      ...(baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision }),
      ...(payload.domain === "skill"
        ? {
            linkedSkillIdsByKind: payload.linksByKind
          }
        : {
            linkedMaterialIdsByKind: payload.linksByKind
          })
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    closeBookDialog();
    uiMessage.success(
      `已更新“${book.label}”的${payload.domain === "skill" ? "技能库" : "素材库"}绑定`
    );
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      closeBookDialog();
      uiMessage.warning("书籍绑定已在外部更新，已重新加载；请确认后再次保存")
    } else {
      uiMessage.error(error instanceof Error ? error.message : "更新资料库绑定失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

function updateBookBindings(payload:
  | { bookId: string; domain: "skill"; linksByKind: LinkedSkillIdsByKind }
  | { bookId: string; domain: "material"; linksByKind: LinkedMaterialIdsByKind }
): void {
  const book = findVisibleBook(payload.bookId);
  if (!book) {
    closeBookDialog();
    return;
  }
  if (catalogBook(payload.bookId)) {
    void updateCatalogBookBindings(book, payload);
    return;
  }
  updateBookPreference(
    payload.bookId,
    payload.domain === "skill"
      ? { skillLibraryIds: [...new Set(Object.values(payload.linksByKind).flat())] }
      : { materialLibraryIds: [...new Set(Object.values(payload.linksByKind).flat())] }
  );
  closeBookDialog();
  uiMessage.success(
    `已更新“${book.label}”的${payload.domain === "skill" ? "技能库" : "素材库"}绑定`
  );
}

async function createCreativeBook(
  input: CreateCreativeBookPayload
): Promise<void> {
  if (input.workspaceType === "long") {
    await createLongBook({
      title: input.title,
      genre: input.genre,
      linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: input.linkedSkillIdsByKind
    });
    return;
  }
  if (!window.deepwrite || catalogMutationPending.value) {
    return;
  }
  catalogMutationPending.value = true;
  try {
    const workspaceType = input.workspaceType;
    const book =
      input.workspaceType === "script"
        ? await window.deepwrite.catalog.createScriptBook({
            title: input.title,
            genre: input.genre,
            linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
            linkedSkillIdsByKind: input.linkedSkillIdsByKind
          })
        : await window.deepwrite.catalog.createShortBook({
            title: input.title,
            genre: input.genre,
            linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
            linkedSkillIdsByKind: input.linkedSkillIdsByKind
          });
    if (!book) {
      return;
    }
    await loadWorkspaceDirectory();
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    createBookDialogOpen.value = false;
    const targetResourceId = resolvePreferredBookResourceId(
      catalogProjection.value ?? undefined,
      book.id
    );
    if (targetResourceId) {
      const targetNode = findResourceNodeIn(
        resourceTreeSections.value,
        targetResourceId
      );
      if (targetNode) {
        await selectResource(targetNode);
      }
    }
    uiMessage.success(
      `已创建${workspaceType === "script" ? "剧本" : "短篇"}“${book.title}”，素材库和技能库绑定已保存`
    );
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "创建作品失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function activateLongBookWorkspace(opened: LongOpenBookResult): void {
  void loadLongAgentSettings();
  longWorkspaceProposals.activateBook(opened.book.id);
  longWorkspaceRefreshClock.invalidate(opened.book.id);
  longWorkspaceRefreshStatus.value = null;
  activeLongBookId.value = opened.book.id;
  activeLongWorkspaceIndex.value = opened.book.workspaceIndex;
  longBooks.value = replaceLongBookSummary(longBooks.value, opened.summary);
  activeLongSelection.value = null;
  activeLongFileContext.value = null;
  longRollbackDialogOpen.value = false;
  longRollbackCommitId.value = null;
  selectedResourceId.value = longBookResourceId(opened.book.id);
  workspaceMainView.value = "conversation";
  rightCollapsed.value = false;
}

async function createLongBook(input: CreateLongBookInput): Promise<void> {
  const api = resolveLongWorkspaceApi();
  if (!api || longMutationPending.value) {
    if (!api) {
      uiMessage.warning("浏览器预览不能保存长篇作品，请使用桌面客户端创建。");
    }
    return;
  }
  if (blockActiveLongWritingPlan("新建长篇")) {
    return;
  }
  if (!(await saveActiveLongEditorBeforeLeaving())) {
    return;
  }
  longMutationPending.value = true;
  try {
    const opened = await api.create(input);
    if (!opened) return;
    createBookDialogOpen.value = false;
    activateLongBookWorkspace(opened);
    await loadLongBookList({ force: true });
    await loadWorkspaceDirectory();
    uiMessage.success(`已创建长篇“${opened.book.title}”`);
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "创建长篇作品失败。"
    );
  } finally {
    longMutationPending.value = false;
  }
}

async function handleResourceAction(payload: ResourceSectionActionPayload): Promise<void> {
  if (
    payload.domain === "creation" &&
    (payload.action === "choose-open-book" ||
      payload.action === "choose-import-book")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能打开本地作品，请使用桌面客户端。");
      return;
    }
    bookTransferDialogMode.value =
      payload.action === "choose-open-book" ? "open" : "import";
    return;
  }

  if (
    payload.domain === "creation" &&
    payload.action === "refresh-long-books"
  ) {
    if (!resolveLongWorkspaceApi()) {
      uiMessage.warning("浏览器预览不能刷新本地长篇，请使用桌面客户端。");
      return;
    }
    await loadLongBookList({ notify: true, force: true });
    if (!longCatalogLoadError.value) {
      uiMessage.success("长篇列表已刷新");
    }
    return;
  }

  if (
    payload.domain === "creation" &&
    payload.action === "open-long-book"
  ) {
    if (blockActiveLongWritingPlan("打开其他长篇")) {
      return;
    }
    const api = resolveLongWorkspaceApi();
    if (!api) {
      uiMessage.warning("浏览器预览不能打开本地长篇，请使用桌面客户端。");
      return;
    }
    if (longMutationPending.value) return;
    if (!(await saveActiveLongEditorBeforeLeaving())) {
      return;
    }
    longMutationPending.value = true;
    try {
      const opened = await api.openExisting();
      if (!opened) return;
      activateLongBookWorkspace(opened);
      await loadLongBookList({ force: true });
      uiMessage.success(`已打开长篇“${opened.book.title}”`);
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "打开已有长篇失败。"
      );
    } finally {
      longMutationPending.value = false;
    }
    return;
  }

  if (
    payload.domain === "creation" &&
    payload.action === "import-portable-long-book"
  ) {
    if (blockActiveLongWritingPlan("导入长篇")) {
      return;
    }
    const api = resolveLongWorkspaceApi();
    if (!api) {
      uiMessage.warning("浏览器预览不能导入可移植长篇，请使用桌面客户端。");
      return;
    }
    if (longMutationPending.value) return;
    if (!(await saveActiveLongEditorBeforeLeaving())) {
      return;
    }
    longMutationPending.value = true;
    try {
      const imported = await api.importPortable();
      if (!imported) return;
      activateLongBookWorkspace(imported);
      await loadLongBookList({ force: true });
      uiMessage.success(`已导入可移植长篇“${imported.book.title}”`);
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "导入可移植长篇失败。"
      );
    } finally {
      longMutationPending.value = false;
    }
    return;
  }

  if (
    payload.domain === "creation" &&
    payload.action === "migrate-write-claw-long-book"
  ) {
    if (blockActiveLongWritingPlan("导入旧版本长篇")) {
      return;
    }
    const api = resolveLongWorkspaceApi();
    if (!api) {
      uiMessage.warning("浏览器预览不能导入旧版本长篇，请使用桌面客户端。");
      return;
    }
    if (longMutationPending.value) return;
    if (!(await saveActiveLongEditorBeforeLeaving())) {
      return;
    }
    longMutationPending.value = true;
    try {
      const imported = await api.importWriteClaw();
      if (!imported) return;
      activateLongBookWorkspace(imported);
      longMigrationReport.value = imported;
      await loadLongBookList({ force: true });
      uiMessage.success(
        imported.warnings.length
          ? `已导入旧版本长篇“${imported.book.title}”，有 ${imported.warnings.length} 项说明可查看`
          : `已导入旧版本长篇“${imported.book.title}”，源文件保持不变`
      );
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error
          ? error.message
          : "导入旧版本长篇失败。"
      );
    } finally {
      longMutationPending.value = false;
    }
    return;
  }

  if (payload.domain === "creation" && payload.action === "create") {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能保存作品，请使用桌面客户端创建。");
      return;
    }
    createBookDialogOpen.value = true;
    return;
  }

  if (
    payload.action === "create" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能创建本地资料库，请使用桌面客户端。");
      return;
    }
    libraryProjectDialog.value = {
      operation: "create-library",
      domain: payload.domain
    };
    return;
  }

  if (
    payload.action === "create-group" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能创建本地分组，请使用桌面客户端。");
      return;
    }
    libraryGroupDialog.value = { domain: payload.domain };
    return;
  }

  if (payload.domain === "creation" && payload.action === "import-legacy-book") {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能导入旧版书籍，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    catalogMutationPending.value = true;
    try {
      const imported = await window.deepwrite.catalog.importLegacyBook();
      if (!imported) {
        return;
      }
      await loadWorkspaceDirectory();
      applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
      const targetResourceId = resolvePreferredBookResourceId(
        catalogProjection.value ?? undefined,
        imported.id
      );
      if (targetResourceId) {
        const targetNode = findResourceNodeIn(
          resourceTreeSections.value,
          targetResourceId
        );
        if (targetNode) {
          await selectResource(targetNode);
        }
      }
      uiMessage.success(`已导入旧版书籍“${imported.title}”并转换为新的文件结构`);
    } catch (error: unknown) {
      uiMessage.error(error instanceof Error ? error.message : "导入旧版书籍失败。");
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  if (
    payload.action === "import-legacy-library" &&
    (payload.domain === "material" || payload.domain === "skill")
  ) {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能导入旧版资料库，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    catalogMutationPending.value = true;
    try {
      const result = await window.deepwrite.catalog.importLegacyLibrary(
        payload.domain
      );
      if (!result) {
        return;
      }
      await loadWorkspaceDirectory();
      applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
      const imported = result.imported.at(-1);
      const target = documents.value.find(
        (document) => document.libraryId === imported?.id
      );
      if (target) {
        selectedResourceId.value = target.id;
        rightCollapsed.value = false;
      }
      const libraryLabel = payload.domain === "material" ? "素材" : "技能";
      if (result.failures.length === 0) {
        uiMessage.success(
          result.imported.length === 1
            ? `已导入旧版${libraryLabel}库“${result.imported[0]!.title}”并新建资料库`
            : `已导入 ${result.imported.length} 个旧版${libraryLabel}库并新建资料库`
        );
      } else {
        const failureSummary = result.failures
          .map(({ fileName, message }) => `${fileName}：${message}`)
          .join("；");
        if (result.imported.length > 0) {
          uiMessage.warning(
            `已导入 ${result.imported.length} 个旧版${libraryLabel}库，${result.failures.length} 个失败：${failureSummary}`
          );
        } else {
          uiMessage.error(`导入旧版${libraryLabel}库失败：${failureSummary}`);
        }
      }
    } catch (error: unknown) {
      uiMessage.error(
        error instanceof Error ? error.message : "导入旧版资料库失败。"
      );
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  if (payload.action === "import") {
    if (!window.deepwrite) {
      uiMessage.warning("浏览器预览不能打开本地文件夹，请使用桌面客户端。");
      return;
    }
    if (catalogMutationPending.value) {
      return;
    }
    const domain =
      payload.domain === "creation"
        ? "book"
        : payload.domain === "material"
          ? "material"
          : "skill";
    catalogMutationPending.value = true;
    try {
      const opened = await window.deepwrite.catalog.openProject(domain);
      if (!opened) {
        return;
      }
      await loadWorkspaceDirectory();
      applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
      const targetResourceId =
        opened.domain === "book"
          ? resolvePreferredBookResourceId(
              catalogProjection.value ?? undefined,
              opened.id
            )
          : documents.value.find((document) => document.libraryId === opened.id)?.id;
      if (targetResourceId) {
        const targetNode = findResourceNodeIn(
          resourceTreeSections.value,
          targetResourceId
        );
        if (targetNode) {
          await selectResource(targetNode);
        }
      }
      uiMessage.success(`已打开${opened.domain === "book" ? "书籍" : opened.domain === "material" ? "素材库" : "技能库"}“${opened.title}”`);
    } catch (error: unknown) {
      uiMessage.error(error instanceof Error ? error.message : "打开本地项目失败。");
    } finally {
      catalogMutationPending.value = false;
    }
    return;
  }

  uiMessage.info("当前资源操作暂不可用。");
}

function handleBookTransferSelect(action: BookTransferAction): void {
  bookTransferDialogMode.value = null;
  void handleResourceAction({
    domain: "creation",
    action: action === "open-book" ? "import" : action
  });
}

async function clearActiveLongBook(bookId: string): Promise<void> {
  if (activeLongBookId.value !== bookId) return;
  longOpenClock += 1;
  longWorkspaceRefreshClock.invalidate(bookId);
  longWorkspaceRefreshStatus.value = null;
  activeLongBookId.value = null;
  activeLongWorkspaceIndex.value = null;
  activeLongSelection.value = null;
  activeLongFileContext.value = null;
  longRollbackDialogOpen.value = false;
  longRollbackCommitId.value = null;
  longStructureDialogOpen.value = false;
  longCharacterCreate.value = null;
  longPlotPointCreate.value = null;
  longChapterCardCreate.value = null;
  longVolumeCreateOpen.value = false;
  longBindingsDialogMode.value = null;
  const fallback = resourceTreeSections.value
    .find(({ id }) => id === "creation")
    ?.nodes.find((node) => !node.longBookId);
  if (fallback) {
    await selectResource(fallback);
  } else {
    selectedResourceId.value = "";
  }
}

async function handleLongBookAction(
  payload: LongBookResourceNodeActionPayload
): Promise<void> {
  const api = resolveLongWorkspaceApi();
  if (!api) {
    uiMessage.warning("浏览器预览不能管理本地长篇，请使用桌面客户端。");
    return;
  }
  const { longBookId: bookId } = payload.node;
  if (payload.action === "manage-structure") {
    if (
      blockActiveLongWritingPlan("管理其他长篇的结构", {
        targetBookId: bookId,
        allowPlanBook: true
      })
    ) {
      return;
    }
    const saved =
      activeLongBookId.value === bookId
        ? await saveActiveLongEditorChanges()
        : await saveActiveLongEditorBeforeLeaving(bookId);
    if (!saved) {
      return;
    }
    selectedResourceId.value = payload.node.id;
    workspaceMainView.value = "conversation";
    if (
      activeLongBookId.value !== bookId ||
      !activeLongWorkspaceIndex.value
    ) {
      await openLongBook(bookId);
    }
    if (
      activeLongBookId.value === bookId &&
      activeLongWorkspaceIndex.value
    ) {
      longStructureDialogOpen.value = true;
    }
    return;
  }
  if (
    payload.action === "bind-skill" ||
    payload.action === "bind-material"
  ) {
    if (
      blockActiveLongWritingPlan(
        payload.action === "bind-skill"
          ? "管理其他长篇的技能库绑定"
          : "管理其他长篇的素材库绑定",
        {
        targetBookId: bookId,
        allowPlanBook: true
        }
      )
    ) {
      return;
    }
    const saved =
      activeLongBookId.value === bookId
        ? await saveActiveLongEditorChanges()
        : await saveActiveLongEditorBeforeLeaving(bookId);
    if (!saved) {
      return;
    }
    selectedResourceId.value = payload.node.id;
    workspaceMainView.value = "conversation";
    if (activeLongBookId.value !== bookId) {
      await openLongBook(bookId);
    }
    if (activeLongBookId.value === bookId && activeLongBookSummary.value) {
      longBindingsDialogMode.value =
        payload.action === "bind-skill" ? "skill" : "material";
    }
    return;
  }
  if (
    longWritingOrchestrator.active.value &&
    longWritingOrchestrator.state.value.bookId === bookId &&
    blockActiveLongWritingPlan("移除或删除当前长篇")
  ) {
    return;
  }
  longBookRemovalDialog.value = {
    action: payload.action,
    bookId,
    title: payload.node.label
  };
}

async function updateLongBookBindings(payload: {
  linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  linkedSkillIdsByKind: LinkedSkillIdsByKind;
}): Promise<void> {
  const api = resolveLongWorkspaceApi();
  const summary = activeLongBookSummary.value;
  if (!api || !summary || longBookActionPending.value) return;
  const bindingLabel =
    longBindingsDialogMode.value === "skill" ? "技能库绑定" : "素材库绑定";
  if (blockActiveLongWritingPlan(`修改长篇${bindingLabel}`)) {
    return;
  }
  longBookActionPending.value = true;
  try {
    const updated = await api.updateBindings({
      bookId: summary.id,
      expectedProjectRevision: summary.projectRevision,
      linkedMaterialIdsByKind: payload.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: payload.linkedSkillIdsByKind
    });
    longWorkspaceRefreshClock.invalidate(summary.id);
    longWorkspaceRefreshStatus.value = null;
    activeLongWorkspaceIndex.value = updated.book.workspaceIndex;
    longBooks.value = replaceLongBookSummary(
      longBooks.value,
      updated.summary
    );
    longWorkspaceEditor.value?.synchronizeProjectRevisions(
      updated.book.workspaceIndex.revision,
      updated.summary.projectRevision
    );
    longBindingsDialogMode.value = null;
    await loadLongBookList({ force: true });
    uiMessage.success(`已更新长篇“${updated.book.title}”的${bindingLabel}`);
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error
        ? error.message
        : `更新长篇${bindingLabel}失败。`
    );
  } finally {
    longBookActionPending.value = false;
  }
}

async function confirmLongBookRemoval(): Promise<void> {
  const api = resolveLongWorkspaceApi();
  const pending = longBookRemovalDialog.value;
  if (!api || !pending || longBookActionPending.value) return;
  if (
    longWritingOrchestrator.active.value &&
    longWritingOrchestrator.state.value.bookId === pending.bookId &&
    blockActiveLongWritingPlan("移除或删除当前长篇")
  ) {
    return;
  }
  if (
    activeLongBookId.value === pending.bookId &&
    !(await saveActiveLongEditorBeforeLeaving())
  ) {
    return;
  }
  longBookActionPending.value = true;
  let runtimeQuarantined = false;
  try {
    await stopLongBookAgentRuns(pending.bookId);
    runtimeQuarantined = true;
    const result =
      pending.action === "delete"
        ? await api.delete({ bookId: pending.bookId })
        : await api.unregister({ bookId: pending.bookId });
    if (!result.removed) {
      longWorkspaceProposals.activateBook(pending.bookId);
      runtimeQuarantined = false;
      uiMessage.warning("该长篇已经不在当前创作空间中。");
      longBookRemovalDialog.value = null;
      await loadLongBookList({ force: true });
      return;
    }
    disposeLongBookRuntime(pending.bookId);
    runtimeQuarantined = false;
    longBooks.value = longBooks.value.filter(
      ({ id }) => id !== pending.bookId
    );
    await clearActiveLongBook(pending.bookId);
    longBookRemovalDialog.value = null;
    await loadLongBookList({ force: true });
    uiMessage.success(
      pending.action === "delete"
        ? `已永久删除长篇“${pending.title}”`
        : `已从创作空间移除“${pending.title}”，磁盘文件仍保留`
    );
  } catch (error: unknown) {
    if (runtimeQuarantined) {
      longWorkspaceProposals.activateBook(pending.bookId);
    }
    uiMessage.error(
      error instanceof Error ? error.message : "处理长篇项目失败。"
    );
  } finally {
    longBookActionPending.value = false;
  }
}

async function handleLongStructureMutation(
  batch: LongWorkspaceOperationBatch,
  completion: LongStructureMutationCompletion
): Promise<void> {
  await applyLongStructureMutation(batch, completion);
}

async function handleLongWorldbuildingSync(
  payload: { sourceBookId: string; sourceTitle: string },
  completion: LongStructureMutationCompletion
): Promise<void> {
  const api = resolveLongWorkspaceApi();
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  if (!api || !summary || !index) {
    uiMessage.warning("当前长篇结构尚未就绪。");
    completion.fail("当前长篇结构尚未就绪。");
    return;
  }
  if (payload.sourceBookId === summary.id) {
    uiMessage.warning("不能从当前长篇同步到自身。");
    completion.fail("不能从当前长篇同步到自身。");
    return;
  }
  try {
    if (!(await saveActiveLongEditorChanges())) {
      completion.fail("当前长篇修改尚未保存。");
      return;
    }
    if (!(await refreshActiveLongWorkspace(summary.id))) {
      throw new Error("无法同步最新长篇结构，本次修改未保存。");
    }
    const latestIndex = activeLongWorkspaceIndex.value;
    if (!latestIndex || activeLongBookId.value !== summary.id) {
      throw new Error("活动长篇已切换，本次世界观同步未保存。");
    }
    const source = await api.getWorkspaceIndex({
      bookId: payload.sourceBookId
    });
    if (source.bookId !== payload.sourceBookId) {
      throw new Error("来源长篇工作区读取结果不一致。");
    }
    const sourceCategories = filterSyncableWorldbuildingCategories(
      source.workspaceIndex.worldbuilding
    );
    if (sourceCategories.length === 0) {
      throw new Error("所选长篇没有可同步的世界观分类。");
    }
    const contents = await loadSourceWorldbuildingContents(
      (input) => api.readDocument(input),
      payload.sourceBookId,
      sourceCategories
    );
    const plan = await buildLongWorldbuildingSyncBatch({
      target: latestIndex,
      source: source.workspaceIndex,
      contents
    });
    await applyLongStructureMutation(plan.batch, completion, {
      saveEditor: false,
      successMessage: `已从「${payload.sourceTitle}」同步世界观（${plan.createdCategoryCount} 个分类）`
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "同步世界观失败。";
    completion.fail(message);
    uiMessage.error(message);
  }
}

async function applyLongStructureMutation(
  batch: LongWorkspaceOperationBatch,
  completion: LongStructureMutationCompletion,
  options: {
    saveEditor?: boolean;
    successMessage?: string;
  } = {}
): Promise<void> {
  const api = resolveLongWorkspaceApi();
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  if (!api || !summary || !index || longBookActionPending.value) {
    uiMessage.warning("当前长篇结构尚未就绪。");
    completion.fail("当前长篇结构尚未就绪。");
    return;
  }
  if (blockActiveLongWritingPlan("修改长篇结构")) {
    completion.fail("当前长篇串行写作计划尚未完成。");
    return;
  }
  if (
    options.saveEditor !== false &&
    !(await saveActiveLongEditorChanges())
  ) {
    completion.fail("当前长篇修改尚未保存。");
    return;
  }
  if (longBookActionPending.value) {
    completion.fail("另一项长篇结构修改仍在处理中。");
    return;
  }
  longBookActionPending.value = true;
  let applied = false;
  try {
    if (!(await refreshActiveLongWorkspace(summary.id))) {
      throw new Error("无法同步最新长篇结构，本次修改未保存。");
    }
    const latestSummary = activeLongBookSummary.value;
    const latestIndex = activeLongWorkspaceIndex.value;
    if (
      !latestSummary ||
      !latestIndex ||
      latestSummary.id !== summary.id
    ) {
      throw new Error("活动长篇已切换，本次结构修改未保存。");
    }
    const baseProjectRevision =
      latestSummary.projectRevision ?? latestIndex.revision;
    const effectiveBatch = rebaseLongStructureBatchAfterDocumentSave({
      batch,
      before: index,
      after: latestIndex
    });
    const preview = await api.previewOperations({
      bookId: latestSummary.id,
      batch: effectiveBatch
    });
    if (
      preview.bookId !== latestSummary.id ||
      preview.projectRevision !== baseProjectRevision
    ) {
      throw new Error("长篇结构已更新，请基于最新结构重新修改。");
    }
    const applyResult = await api.applyOperations({
      bookId: latestSummary.id,
      batch: {
        ...effectiveBatch,
        expectedImpact: preview.preview.impact
      },
      baseProjectRevision
    });
    applied = true;
    if (
      applyResult.bookId !== latestSummary.id ||
      activeLongBookId.value !== latestSummary.id
    ) {
      throw new Error("活动长篇已切换，无法发布结构保存结果。");
    }
    longBooks.value = replaceLongBookSummary(
      longBooks.value,
      applyResult.summary
    );
    const refreshed = await refreshLongWritingSaveBarrier(latestSummary.id);
    if (!refreshed) {
      longStructureDialogOpen.value = false;
      completion.appliedButRefreshFailed(
        "结构修改已保存，但界面未能同步最新结构。"
      );
      uiMessage.warning(
        "结构修改已保存，但界面未能同步最新结构；请重新打开长篇设置。"
      );
      return;
    }
    completion.succeed();
    uiMessage.success(
      options.successMessage ??
        `已直接保存 ${effectiveBatch.operations.length} 项长篇结构修改`
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "保存长篇结构修改失败。";
    if (applied) {
      longStructureDialogOpen.value = false;
      completion.appliedButRefreshFailed(message);
    } else {
      completion.fail(message);
    }
    uiMessage.error(message);
  } finally {
    longBookActionPending.value = false;
  }
}

async function deleteLongNavigationStructure(
  input: {
    kind: "character" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
  },
  completion: (succeeded: boolean) => void
): Promise<void> {
  const index = activeLongWorkspaceIndex.value;
  if (!index) {
    uiMessage.warning("当前长篇结构尚未就绪。");
    completion(false);
    return;
  }

  const builder = createLongStructureMutationBuilder(index);
  let batch: LongWorkspaceOperationBatch;
  let label: string;
  let title: string;
  try {
    if (input.kind === "character") {
      const target = index.characters.find(({ id }) => id === input.id);
      if (!target) throw new Error("该人物已不存在，请刷新后重试。");
      batch = builder.deleteCharacter(target.id, true);
      label = "人物";
      title = target.name;
    } else if (input.kind === "volume") {
      const target = index.plot.volumes.find(({ id }) => id === input.id);
      if (!target) throw new Error("该分卷已不存在，请刷新后重试。");
      batch = builder.deleteVolume(target.id, true);
      label = "分卷";
      title = target.title;
    } else if (input.kind === "plotPoint") {
      const target = index.plot.arcs.find(({ id }) => id === input.id);
      if (!target) throw new Error("该剧情点已不存在，请刷新后重试。");
      batch = builder.deleteArc(target.id, true);
      label = "剧情点";
      title = target.title;
    } else {
      const target = index.plot.chapterCards.find(({ id }) => id === input.id);
      if (!target) throw new Error("该章卡已不存在，请刷新后重试。");
      batch = builder.deleteChapter(target.id, true);
      label = "章卡";
      title = target.title;
    }
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : `无法删除“${input.title}”。`
    );
    completion(false);
    return;
  }

  await applyLongStructureMutation(
    batch,
    {
      succeed: () => completion(true),
      fail: () => completion(false),
      appliedButRefreshFailed: () => completion(true)
    },
    { successMessage: `已删除${label}“${title}”` }
  );
}

async function createLongCharacter(
  input: { name: string; aliases: string[] }
): Promise<void> {
  const target = longCharacterCreate.value;
  const summary = activeLongBookSummary.value;
  const index = activeLongWorkspaceIndex.value;
  if (
    !target ||
    !summary ||
    !index ||
    summary.id !== target.bookId ||
    longBookActionPending.value
  ) {
    uiMessage.warning("当前人物分组尚未就绪。");
    return;
  }

  let batch: LongWorkspaceOperationBatch;
  try {
    batch = createLongStructureMutationBuilder(index).createCharacter({
      name: input.name,
      group: target.group,
      aliases: input.aliases
    });
  } catch (error: unknown) {
    uiMessage.warning(
      error instanceof Error ? error.message : "无法创建人物。"
    );
    return;
  }
  const created = batch.operations.find(
    (operation) => operation.type === "character.create"
  );
  if (!created || created.type !== "character.create") {
    uiMessage.warning("无法确定新建人物。");
    return;
  }

  let succeeded = false;
  let applied = false;
  await handleLongStructureMutation(batch, {
    succeed: () => {
      succeeded = true;
      applied = true;
    },
    fail: () => undefined,
    appliedButRefreshFailed: () => {
      applied = true;
    }
  });
  if (!applied) return;
  longCharacterCreate.value = null;
  if (!succeeded) return;

  const latestSummary = activeLongBookSummary.value;
  const latestIndex = activeLongWorkspaceIndex.value;
  if (
    !latestSummary ||
    !latestIndex ||
    latestSummary.id !== target.bookId
  ) {
    return;
  }
  const selection = createLongCharacterGroupSelection(
    latestSummary,
    latestIndex,
    target.group,
    created.character.id
  );
  selectedResourceId.value = longNavigationNodeId(
    target.bookId,
    `character-group:${target.group}`
  );
  rightCollapsed.value = false;
  await selectLongWorkspaceFile(selection);
}

function findCatalogLibrary(
  domain: "material" | "skill",
  libraryId: string
) {
  return domain === "material"
    ? catalogSnapshot.value?.materials.find((library) => library.id === libraryId)
    : catalogSnapshot.value?.skills.find((library) => library.id === libraryId);
}

function advanceLibraryDraftProjectRevision(
  domain: "material" | "skill",
  libraryId: string,
  expectedProjectRevision: number | undefined
): void {
  const projectRevision = findCatalogLibrary(domain, libraryId)?.projectRevision;
  if (
    projectRevision === undefined ||
    expectedProjectRevision === undefined ||
    projectRevision !== expectedProjectRevision
  ) {
    return;
  }
  const documentIds = new Set(
    documents.value
      .filter(
        (document) =>
          document.domain === domain && document.libraryId === libraryId
      )
      .map((document) => document.id)
  );
  editorDrafts.value = Object.fromEntries(
    Object.entries(editorDrafts.value).map(([documentId, draft]) => [
      documentId,
      documentIds.has(documentId) && draft.dirty
        ? {
            ...draft,
            recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
            baseProjectRevision: projectRevision
          }
        : draft
    ])
  );
}

async function createCatalogLibrary(payload: CreateLibraryInput): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const created = await window.deepwrite.catalog.createLibrary(payload);
    if (!created) return;
    await loadWorkspaceDirectory();
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryProjectDialog.value = null;
    const target = documents.value.find(
      (document) => document.libraryId === created.id
    );
    if (target) {
      selectedResourceId.value = target.id;
      rightCollapsed.value = false;
    }
    uiMessage.success(`已创建${payload.domain === "material" ? "素材" : "技能"}库“${created.title}”`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "创建资料库失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function createCatalogLibraryGroup(
  payload: CreateLibraryGroupInput
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const created = await window.deepwrite.catalog.createLibraryGroup(payload);
    if (!created) return;
    await loadWorkspaceDirectory();
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryGroupDialog.value = null;
    uiMessage.success(`已创建${payload.domain === "material" ? "素材" : "技能"}分组“${created.title}”`);
  } catch (error: unknown) {
    await loadCatalogSnapshot();
    uiMessage.error(error instanceof Error ? error.message : "创建资料库分组失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function updateCatalogLibraryGroup(
  payload: UpdateLibraryGroupInput
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const updated = await window.deepwrite.catalog.updateLibraryGroup(payload);
    await loadWorkspaceDirectory();
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryGroupDialog.value = null;
    uiMessage.success(`已更新分组“${updated.title}”的绑定`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      libraryGroupDialog.value = null;
      uiMessage.warning("分组配置已在外部更新，已重新加载；请确认后再次切换绑定");
    } else {
      await loadCatalogSnapshot();
      uiMessage.error(error instanceof Error ? error.message : "更新分组绑定失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

function saveCatalogLibraryGroup(
  payload: CreateLibraryGroupInput | UpdateLibraryGroupInput
): void {
  if ("groupId" in payload) {
    void updateCatalogLibraryGroup(payload);
  } else {
    void createCatalogLibraryGroup(payload);
  }
}

async function createCatalogLibraryEntry(
  payload: CreateLibraryEntryDraft
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  try {
    const baseProjectRevision = findCatalogLibrary(
      payload.domain,
      payload.libraryId
    )?.projectRevision;
    const created = await window.deepwrite.catalog.createLibraryEntry({
      ...payload,
      content: "",
      ...(baseProjectRevision === undefined ? {} : { baseProjectRevision })
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    advanceLibraryDraftProjectRevision(
      payload.domain,
      payload.libraryId,
      baseProjectRevision === undefined ? undefined : baseProjectRevision + 1
    );
    libraryProjectDialog.value = null;
    const target = documents.value.find(
      (document) =>
        document.libraryId === payload.libraryId &&
        document.catalogEntryId === created.id
    );
    if (target) {
      selectedResourceId.value = target.id;
      rightCollapsed.value = false;
    }
    uiMessage.success(`已创建${payload.domain === "material" ? "素材" : "技能"}条目“${created.title}”`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      libraryProjectDialog.value = null;
      uiMessage.warning("资料库已在外部更新，已重新加载；请从新目录状态重新创建条目");
    } else {
      uiMessage.error(error instanceof Error ? error.message : "创建资料库条目失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

async function removeCatalogLibraryEntry(payload: {
  domain: "material" | "skill";
  libraryId: string;
  entryId: string;
}): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  catalogMutationPending.value = true;
  const dialogState = libraryProjectDialog.value;
  try {
    const library = findCatalogLibrary(payload.domain, payload.libraryId);
    const baseProjectRevision = library?.projectRevision;
    const persistedDocument = documents.value.find(
      (document) =>
        document.libraryId === payload.libraryId &&
        document.catalogEntryId === payload.entryId
    );
    const result = await window.deepwrite.catalog.removeLibraryEntry({
      ...payload,
      ...(persistedDocument === undefined
        ? {}
        : {
            baseRevision: createShortWorkspaceContentRevision(
              persistedDocument.content
            )
          }),
      ...(baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision })
    });
    if (!result.deleted) {
      await loadCatalogSnapshot();
      libraryProjectDialog.value = null;
      uiMessage.warning("条目已经不存在，目录已重新加载");
      return;
    }
    if (dialogState?.documentId) {
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[dialogState.documentId];
      editorDrafts.value = nextDrafts;
    }
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    advanceLibraryDraftProjectRevision(
      payload.domain,
      payload.libraryId,
      baseProjectRevision === undefined ? undefined : baseProjectRevision + 1
    );
    libraryProjectDialog.value = null;
    uiMessage.success(`已删除${payload.domain === "material" ? "素材" : "技能"}条目文件`);
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      libraryProjectDialog.value = null;
      uiMessage.warning("资料库已在外部更新，已重新加载；请确认后再次删除");
    } else {
      uiMessage.error(error instanceof Error ? error.message : "删除资料库条目失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

function resolveLibraryEntryClipboardPayload(
  domain: "material" | "skill",
  libraryId: string,
  entryId: string,
  fallbackTitle: string
): LibraryEntryClipboard | null {
  const library = findCatalogLibrary(domain, libraryId);
  if (!library) return null;
  const entry = library?.entries.find((item) => item.id === entryId);
  const document = documents.value.find(
    (item) => item.libraryId === libraryId && item.catalogEntryId === entryId
  );
  const draft = document ? editorDrafts.value[document.id] : undefined;
  const title = (
    draft?.dirty ? draft.title : (document?.title ?? entry?.title ?? fallbackTitle)
  ).trim();
  if (!title) {
    return null;
  }
  const content = draft?.dirty
    ? draft.content
    : (document?.content ?? entry?.body ?? "");
  const stageIdRaw =
    entry?.stageId ??
    document?.stageCategoryId ??
    (domain === "material" ? "other" : "draft");
  const materialStage = MaterialStageIdSchema.safeParse(stageIdRaw);
  const skillStage = SkillStageIdSchema.safeParse(stageIdRaw);
  const stageId =
    domain === "material"
      ? materialStage.success
        ? materialStage.data
        : ("other" as MaterialStageId)
      : skillStage.success
        ? skillStage.data
        : ("draft" as SkillStageId);
  return {
    domain,
    title,
    content,
    stageId,
    sourceLibraryId: libraryId,
    sourceEntryId: entryId,
    workspaceType:
      "materialType" in library ? library.materialType : library.skillType
  };
}

function resolvePasteMaterialStageId(
  stageId: MaterialStageId | SkillStageId,
  materialKind: MaterialLibraryKind | undefined
): MaterialStageId {
  const parsed = MaterialStageIdSchema.safeParse(stageId);
  const candidate = parsed.success ? parsed.data : ("other" as MaterialStageId);
  const allowed = MATERIAL_KIND_ALLOWED_STAGES[materialKind ?? "mixed"];
  if (allowed.includes(candidate)) {
    return candidate;
  }
  return allowed[0] ?? "other";
}

function copyCatalogLibraryEntry(payload: CatalogResourceNodeActionPayload): void {
  const libraryId = payload.node.libraryId;
  const entryId = payload.node.catalogEntryId;
  if (!libraryId || !entryId) {
    uiMessage.error("未找到要复制的条目");
    return;
  }
  const clipboard = resolveLibraryEntryClipboardPayload(
    payload.domain,
    libraryId,
    entryId,
    payload.node.label
  );
  if (!clipboard) {
    uiMessage.error("未找到要复制的条目内容");
    return;
  }
  libraryEntryClipboard.value = clipboard;
  uiMessage.success(
    `已复制${payload.domain === "material" ? "素材" : "技能"}条目“${clipboard.title}”`
  );
}

async function pasteCatalogLibraryEntry(
  payload: CatalogResourceNodeActionPayload
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value) return;
  const clipboard = libraryEntryClipboard.value;
  const libraryId = payload.node.libraryId;
  if (!clipboard) {
    uiMessage.warning("剪贴板中没有可粘贴的条目");
    return;
  }
  if (!libraryId) {
    uiMessage.error("未找到要粘贴到的资料库");
    return;
  }
  if (clipboard.domain !== payload.domain) {
    uiMessage.warning(
      clipboard.domain === "material"
        ? "当前复制的是素材条目，只能粘贴到素材库"
        : "当前复制的是技能条目，只能粘贴到技能库"
    );
    return;
  }
  if (
    payload.node.workspaceType &&
    clipboard.workspaceType !== payload.node.workspaceType
  ) {
    uiMessage.warning("不同创作类型的资料库条目不能直接交叉粘贴");
    return;
  }
  if (payload.node.readOnly || payload.node.unavailable) {
    uiMessage.warning("目标资料库为只读或不可用，无法粘贴条目");
    return;
  }
  const library = findCatalogLibrary(payload.domain, libraryId);
  if (!library) {
    uiMessage.error("未找到要粘贴到的资料库");
    return;
  }
  if (payload.domain === "skill" && "isBuiltin" in library && library.isBuiltin) {
    uiMessage.warning("内置技能库为只读内容，不能粘贴条目");
    return;
  }

  catalogMutationPending.value = true;
  try {
    const baseProjectRevision = library.projectRevision;
    const materialKind =
      "materialKind" in library ? library.materialKind : undefined;
    const created =
      clipboard.domain === "material"
        ? await window.deepwrite.catalog.createLibraryEntry({
            domain: "material",
            libraryId,
            title: clipboard.title,
            content: clipboard.content,
            stageId: resolvePasteMaterialStageId(clipboard.stageId, materialKind),
            ...(baseProjectRevision === undefined ? {} : { baseProjectRevision })
          })
        : await window.deepwrite.catalog.createLibraryEntry({
            domain: "skill",
            libraryId,
            title: clipboard.title,
            content: clipboard.content,
            stageId: SkillStageIdSchema.parse(clipboard.stageId),
            ...(baseProjectRevision === undefined ? {} : { baseProjectRevision })
          });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    advanceLibraryDraftProjectRevision(
      payload.domain,
      libraryId,
      baseProjectRevision === undefined ? undefined : baseProjectRevision + 1
    );
    const target = documents.value.find(
      (document) =>
        document.libraryId === libraryId &&
        document.catalogEntryId === created.id
    );
    if (target) {
      selectedResourceId.value = target.id;
      rightCollapsed.value = false;
    }
    uiMessage.success(
      `已粘贴${payload.domain === "material" ? "素材" : "技能"}条目“${created.title}”到“${payload.node.label}”`
    );
  } catch (error: unknown) {
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      uiMessage.warning("资料库已在外部更新，已重新加载；请再次粘贴");
    } else {
      uiMessage.error(error instanceof Error ? error.message : "粘贴资料库条目失败。");
    }
  } finally {
    catalogMutationPending.value = false;
  }
}

async function unregisterCatalogLibrary(
  payload: CatalogResourceNodeActionPayload
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value || !payload.node.libraryId) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: payload.domain,
      projectId: payload.node.libraryId
    });
    if (!result.unregistered) {
      throw new Error("资料库已经不在当前目录中。");
    }
    disposeLibraryConversation(payload.domain, payload.node.libraryId);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryRemovalDialog.value = null;
    uiMessage.success(`已从列表移除“${payload.node.label}”，本地文件夹仍完整保留`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "移除资料库失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

async function deleteCatalogLibrary(
  payload: CatalogResourceNodeActionPayload
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value || !payload.node.libraryId) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.deleteProject({
      domain: payload.domain,
      projectId: payload.node.libraryId
    });
    if (!result.deleted) {
      throw new Error("资料库已经不在当前目录中。");
    }
    const removedDocumentIds = new Set(collectResourceNodeIds(payload.node));
    editorDrafts.value = Object.fromEntries(
      Object.entries(editorDrafts.value).filter(
        ([documentId]) => !removedDocumentIds.has(documentId)
      )
    );
    disposeLibraryConversation(payload.domain, payload.node.libraryId);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    libraryRemovalDialog.value = null;
    uiMessage.success(`已删除“${payload.node.label}”及其本地文件夹`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "删除资料库失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function confirmLibraryRemoval(): void {
  const dialog = libraryRemovalDialog.value;
  if (!dialog) return;
  if (dialog.action === "delete") {
    void deleteCatalogLibrary(dialog.payload);
  } else {
    void unregisterCatalogLibrary(dialog.payload);
  }
}

async function dissolveCatalogLibraryGroup(
  payload: CatalogResourceNodeActionPayload
): Promise<void> {
  if (!window.deepwrite || catalogMutationPending.value || !payload.node.groupId) return;
  catalogMutationPending.value = true;
  try {
    const result = await window.deepwrite.catalog.unregisterProject({
      domain: payload.domain === "material" ? "material-group" : "skill-group",
      projectId: payload.node.groupId
    });
    if (!result.unregistered) {
      throw new Error("分组已经不在当前目录中。");
    }
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    uiMessage.success(`已解散分组“${payload.node.label}”，成员库已回到原分类`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "解散分组失败。");
  } finally {
    catalogMutationPending.value = false;
  }
}

function handleResourceNodeAction(payload: CatalogResourceNodeActionPayload): void {
  if (payload.action === "edit-group-bindings") {
    if (!payload.node.groupId) {
      uiMessage.error("未找到对应的分组");
      return;
    }
    libraryGroupDialog.value = {
      domain: payload.domain,
      groupId: payload.node.groupId
    };
    return;
  }
  if (payload.action === "dissolve-group") {
    void dissolveCatalogLibraryGroup(payload);
    return;
  }
  const libraryId = payload.node.libraryId;
  if (!libraryId) {
    uiMessage.error("未找到对应的本地资料库");
    return;
  }
  if (payload.action === "copy-entry") {
    copyCatalogLibraryEntry(payload);
    return;
  }
  if (
    (payload.node.readOnly || payload.node.unavailable) &&
    (payload.action === "create-entry" ||
      payload.action === "paste-entry" ||
      payload.action === "remove-entry")
  ) {
    uiMessage.warning("内置技能库为只读内容，不能修改条目");
    return;
  }
  if (payload.action === "paste-entry") {
    void pasteCatalogLibraryEntry(payload);
    return;
  }
  if (payload.action === "unregister-library") {
    libraryRemovalDialog.value = { action: "remove", payload };
    return;
  }
  if (payload.action === "delete-library") {
    libraryRemovalDialog.value = { action: "delete", payload };
    return;
  }
  if (payload.action === "create-entry") {
    libraryProjectDialog.value = {
      operation: "create-entry",
      domain: payload.domain,
      libraryId,
      libraryTitle: payload.node.label,
      ...(payload.node.workspaceType
        ? { workspaceType: payload.node.workspaceType }
        : {}),
      ...(payload.domain === "material" && payload.node.materialKind
        ? { materialKind: payload.node.materialKind }
        : {})
    };
    return;
  }
  if (!payload.node.catalogEntryId) {
    uiMessage.error("未找到要删除的条目文件");
    return;
  }
  libraryProjectDialog.value = {
    operation: "remove-entry",
    domain: payload.domain,
    libraryId,
    libraryTitle:
      findCatalogLibrary(payload.domain, libraryId)?.title ?? "资料库",
    entryId: payload.node.catalogEntryId,
    entryTitle: payload.node.label,
    documentId: payload.node.id,
    ...(payload.node.workspaceType
      ? { workspaceType: payload.node.workspaceType }
      : {})
  };
}

function cancelEditorAutoSave(documentId?: string): void {
  if (documentId !== undefined) {
    const timer = editorAutoSaveTimers.get(documentId);
    if (timer !== undefined) window.clearTimeout(timer);
    editorAutoSaveTimers.delete(documentId);
    return;
  }
  for (const timer of editorAutoSaveTimers.values()) {
    window.clearTimeout(timer);
  }
  editorAutoSaveTimers.clear();
}

function enqueueEditorSave(task: () => Promise<void>): void {
  const operation = editorSaveChain.catch(() => undefined).then(task);
  editorSaveChain = operation.catch(() => undefined);
}

function scheduleEditorAutoSave(
  documentId: string,
  delay = EDITOR_AUTO_SAVE_DEBOUNCE_MS
): void {
  if (!editorAutoSaveEnabled.value) return;
  cancelEditorAutoSave(documentId);
  editorAutoSaveTimers.set(
    documentId,
    window.setTimeout(() => {
      editorAutoSaveTimers.delete(documentId);
      enqueueEditorSave(() => runEditorAutoSave(documentId));
    }, delay)
  );
}

function scheduleDirtyEditorDraftsForAutoSave(): void {
  if (!editorAutoSaveEnabled.value) return;
  for (const [documentId, draft] of Object.entries(editorDrafts.value)) {
    if (draft.dirty) scheduleEditorAutoSave(documentId);
  }
}

function applyAppLanguage(language: GeneralSettings["language"]): void {
  const resolvedLanguage =
    language === "auto" && navigator.language.toLowerCase().startsWith("zh")
      ? navigator.language
      : "zh-CN";
  document.documentElement.lang = resolvedLanguage;
  document.documentElement.dataset.appLanguage = language;
}

function applyDefaultApprovalMode(permissionMode: GeneralPermissionMode): void {
  const approvalMode = permissionMode;
  const nextPreferences: AgentRunPreferencesByScope = Object.fromEntries(
    Object.entries(agentRunPreferences.value).map(([scope, preference]) => [
      scope,
      { ...preference, approvalMode }
    ])
  );
  for (const [key, conversation] of conversations) {
    conversation.selectApprovalMode(approvalMode);
    const scope = conversationScopes.get(key) ?? "general";
    nextPreferences[scope] = {
      ...captureAgentRunSettings(conversation),
      approvalMode
    };
  }
  agentRunPreferences.value = nextPreferences;
  storeAgentRunPreferences();
}

function queueGeneralSettingsSave(): void {
  const api = window.deepwrite?.generalSettings;
  if (!api) return;
  const snapshot = { ...generalSettings.value };
  const operation = generalSettingsSaveChain
    .catch(() => undefined)
    .then(async () => {
      await api.save(snapshot);
    });
  generalSettingsSaveChain = operation.catch((error: unknown) => {
    uiMessage.warning(
      error instanceof Error
        ? `常规设置已在本次运行中生效，但写入本机失败：${error.message}`
        : "常规设置已在本次运行中生效，但暂时无法写入本机"
    );
  });
}

async function loadGeneralSettings(): Promise<void> {
  const api = window.deepwrite?.generalSettings;
  if (!api) {
    applyAppLanguage(generalSettings.value.language);
    applyDefaultApprovalMode(generalSettings.value.permissionMode);
    return;
  }
  try {
    const snapshot = await api.list();
    const settings =
      !snapshot.persisted && legacyGeneralPreferences.autoSave
        ? { ...snapshot.settings, autoSave: true }
        : snapshot.settings;
    generalSettings.value = settings;
    editorAutoSaveEnabled.value = settings.autoSave;
    applyAppLanguage(settings.language);
    applyDefaultApprovalMode(settings.permissionMode);
    if (!snapshot.persisted && legacyGeneralPreferences.autoSave) {
      queueGeneralSettingsSave();
    }
  } catch (error: unknown) {
    applyAppLanguage(generalSettings.value.language);
    applyDefaultApprovalMode(generalSettings.value.permissionMode);
    uiMessage.warning(
      error instanceof Error ? error.message : "加载常规设置失败，已使用默认设置"
    );
  }
}

function updatePermissionMode(permissionMode: GeneralPermissionMode): void {
  generalSettings.value = {
    ...generalSettings.value,
    permissionMode
  };
  applyDefaultApprovalMode(permissionMode);
  queueGeneralSettingsSave();
  if (permissionMode === "auto-approve") {
    queueMicrotask(() => resumeRecoveredAutomaticAgentEdits());
  }
}

function updateEditorAutoSave(enabled: boolean): void {
  editorAutoSaveEnabled.value = enabled;
  generalSettings.value = {
    ...generalSettings.value,
    autoSave: enabled
  };
  if (!saveGeneralPreferences(window.localStorage, { autoSave: enabled })) {
    uiMessage.warning("自动保存设置已生效，但暂时无法写入本机配置");
  }
  queueGeneralSettingsSave();
  if (enabled) {
    scheduleDirtyEditorDraftsForAutoSave();
  } else {
    cancelEditorAutoSave();
  }
}

function updateAppLanguage(language: GeneralSettings["language"]): void {
  generalSettings.value = {
    ...generalSettings.value,
    language
  };
  applyAppLanguage(language);
  queueGeneralSettingsSave();
}

function updateShowInMenuBar(enabled: boolean): void {
  generalSettings.value = {
    ...generalSettings.value,
    showInMenuBar: enabled
  };
  queueGeneralSettingsSave();
}

function stageEditorDraft(payload: { id: string; title: string; content: string }): void {
  const persisted = documents.value.find((document) => document.id === payload.id);
  const existingDraft = editorDrafts.value[payload.id];
  editorDrafts.value = {
    ...editorDrafts.value,
    [payload.id]: {
      title: payload.title,
      content: payload.content,
      dirty: true,
      recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
      ...(existingDraft?.baseRevision
        ? { baseRevision: existingDraft.baseRevision }
        : persisted
          ? { baseRevision: createShortWorkspaceContentRevision(persisted.content) }
          : {}),
      ...(existingDraft?.baseProjectRevision !== undefined
        ? { baseProjectRevision: existingDraft.baseProjectRevision }
        : persisted?.catalogProjectRevision === undefined
          ? {}
          : { baseProjectRevision: persisted.catalogProjectRevision })
    }
  };
}

function handleLiveDocumentChange(rawPayload: { id: string; title: string; content: string }): void {
  stageEditorDraft(rawPayload);
  scheduleEditorAutoSave(rawPayload.id);
}

function expertDraftMutationBlocked(source: WorkspaceDocument): boolean {
  return (
    savingDocumentIds.value.has(source.id) ||
    acceptingAgentEditDocumentIds.value.has(source.id) ||
    Boolean(
      source.workspaceId &&
      (acceptingAgentEditWorkspaceIds.value.has(source.workspaceId) ||
        [...conversations.entries()].some(
          ([key, conversation]) =>
            key.startsWith(`${source.workspaceId}:expert_`) &&
            conversation.isBusy.value
        ))
    )
  );
}

function selectExpertSection(sectionId: string): void {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  if (!directory) return;
  if (!directory.sections.some((section) => section.id === sectionId)) {
    uiMessage.warning(
      `该${directory.workspaceType === "script" ? "剧集" : "小节"}已不存在，列表已刷新`
    );
    return;
  }
  selectedExpertSectionIds.value = {
    ...selectedExpertSectionIds.value,
    [directory.id]: sectionId
  };
  const selectedNode = resourceNode(selectedResourceId.value);
  if (selectedNode?.shortAgentId === "expert_section_writer") {
    const sectionResourceId = resolveDraftSectionResourceId(
      resourceNode(directory.id),
      sectionId
    );
    if (sectionResourceId) {
      selectedResourceId.value = sectionResourceId;
      activeCreationResourceId.value = sectionResourceId;
    }
  }
}

function selectDraftFile(fileKind: "body" | "character-state"): void {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  if (!directory) return;
  selectedDraftFileKinds.value = {
    ...selectedDraftFileKinds.value,
    [directory.id]: fileKind
  };
}

function insertEditorSelectionReference(reference: EditorTextReference): void {
  const duplicate = pendingEditorReferences.value.some(
    (item) =>
      item.documentId === reference.documentId &&
      item.start === reference.start &&
      item.end === reference.end &&
      item.text === reference.text
  );
  if (duplicate) {
    uiMessage.info("这段正文已经插入输入框");
    return;
  }
  if (pendingEditorReferences.value.length >= PROMPT_ATTACHMENT_MAX_ITEMS) {
    uiMessage.warning(`每条消息最多插入 ${PROMPT_ATTACHMENT_MAX_ITEMS} 段正文引用`);
    return;
  }
  pendingEditorReferences.value = [...pendingEditorReferences.value, reference];
}

function removeEditorSelectionReference(referenceId: string): void {
  pendingEditorReferences.value = pendingEditorReferences.value.filter(
    (reference) => reference.id !== referenceId
  );
}

function clearEditorSelectionReferences(): void {
  pendingEditorReferences.value = [];
}

function locateEditorSelectionReference(reference: EditorTextReference): void {
  const document = documents.value.find((candidate) => candidate.id === reference.documentId);
  if (!document) {
    removeEditorSelectionReference(reference.id);
    uiMessage.warning("引用的正文文件已不存在，已移除这条引用");
    return;
  }

  let targetResourceId = resourceNode(reference.resourceId)
    ? reference.resourceId
    : resourceIdForDocumentId(reference.documentId) ?? reference.documentId;
  if (document.draftFileKind && document.expertSectionId) {
    const directory = catalogProjection.value?.draftDirectories.find((candidate) =>
      candidate.sections.some(
        (section) =>
          section.bodyDocumentId === document.id ||
          section.characterStateDocumentId === document.id
      )
    );
    if (directory) {
      selectedExpertSectionIds.value = {
        ...selectedExpertSectionIds.value,
        [directory.id]: document.expertSectionId
      };
      selectedDraftFileKinds.value = {
        ...selectedDraftFileKinds.value,
        [directory.id]: document.draftFileKind
      };
      const referenceNode = resourceNode(targetResourceId);
      const referenceDirectory = referenceNode
        ? draftDirectoryForResourceId(referenceNode.id)
        : undefined;
      if (referenceDirectory?.id !== directory.id) {
        targetResourceId =
          resolveDraftSectionResourceId(
            resourceNode(directory.id),
            document.expertSectionId
          ) ?? directory.id;
      }
    }
  }

  selectedResourceId.value = targetResourceId;
  if (document.domain === "creation") {
    activeCreationResourceId.value = targetResourceId;
  }
  rightCollapsed.value = false;
  editorReferenceNavigation.value = {
    requestId: ++editorReferenceNavigationClock,
    reference
  };
}

async function addExpertSection(draftNode: ResourceTreeNode): Promise<void> {
  const directory = draftDirectoryForResourceId(draftNode.id);
  const source = documentForResourceId(draftNode.id);
  if (!directory) return;
  if (
    (source?.workspaceType !== "short" && source?.workspaceType !== "script") ||
    source.stageId !== "draft"
  ) return;
  const unitLabel = source.workspaceType === "script" ? "剧集" : "小节";
  if (
    draftNode.shortAgentId !==
      "expert_draft_coordinator" ||
    expertDraftMutationBlocked(source) ||
    source.readOnly ||
    catalogMutationPending.value ||
    !window.deepwrite
  ) {
    uiMessage.info(`当前正文暂时不能新建${unitLabel}，请稍候`);
    return;
  }
  if (directory.sections.length >= 100) {
    uiMessage.warning(`正文最多支持 100 个${unitLabel}`);
    return;
  }
  catalogMutationPending.value = true;
  try {
    const book = catalogBook(directory.workspaceId);
    const added = await window.deepwrite.catalog.createDraftSection({
      bookId: directory.workspaceId,
      ...(directory.sections.at(-1)
        ? { afterSectionId: directory.sections.at(-1)!.id }
        : {}),
      ...(book?.projectRevision === undefined
        ? {}
        : { baseProjectRevision: book.projectRevision })
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    selectedResourceId.value = directory.id;
    activeCreationResourceId.value = directory.id;
    selectedExpertSectionIds.value = {
      ...selectedExpertSectionIds.value,
      [directory.id]: added.id
    };
    selectedDraftFileKinds.value = {
      ...selectedDraftFileKinds.value,
      [directory.id]: "body"
    };
    uiMessage.success(`已新建“${added.title}”并保存到正文文件夹`);
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : `新建正文${unitLabel}失败。`);
  } finally {
    catalogMutationPending.value = false;
  }
}

async function addExpertSectionFromEditor(): Promise<void> {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  if (!directory || directory.workspaceType !== "short") return;
  const draftNode = resourceNode(directory.id);
  if (!draftNode) {
    uiMessage.info("当前正文暂时不能新建小节，请稍候");
    return;
  }
  await addExpertSection(draftNode);
}

function removeExpertSectionFromEditor(): void {
  const directory = draftDirectoryForResourceId(selectedResourceId.value);
  if (!directory || directory.workspaceType !== "short") return;
  const sectionId = activeExpertSectionId.value;
  if (!sectionId) {
    uiMessage.warning("请先选择一个小节");
    return;
  }
  const draftNode = resourceNode(directory.id);
  const sectionNode = draftNode?.children?.find(
    (child) => child.expertSectionId === sectionId
  );
  if (!sectionNode) {
    uiMessage.warning("该小节已经不存在，列表已刷新");
    return;
  }
  requestRemoveExpertSection(sectionNode);
}

function requestRemoveExpertSection(node: ResourceTreeNode): void {
  if (!node.expertSectionId) return;
  const directory = draftDirectoryForResourceId(node.id);
  const section = directory?.sections.find(
    (candidate) => candidate.id === node.expertSectionId
  );
  if (!directory || !section) {
    uiMessage.warning(`该${directory?.workspaceType === "script" ? "剧集" : "小节"}已经不存在`);
    return;
  }
  if (directory.sections.length <= 1) {
    uiMessage.warning(`正文至少需要保留一个${directory.workspaceType === "script" ? "剧集" : "小节"}`);
    return;
  }
  const body = draftFileDocument(directory, section.id, "body");
  const characterState = draftFileDocument(
    directory,
    section.id,
    "character-state"
  );
  pendingExpertSectionDeletion.value = {
    workspaceId: directory.workspaceId,
    draftDirectoryId: directory.id,
    sectionId: section.id,
    sectionTitle: section.title,
    workspaceType: directory.workspaceType,
    hasContent: Boolean(
      (body && liveDocument(body).content.trim()) ||
      (characterState && liveDocument(characterState).content.trim()) ||
      section.wordCountRequirement.trim()
    )
  };
}

async function confirmRemoveExpertSection(): Promise<void> {
  const pending = pendingExpertSectionDeletion.value;
  if (!pending) return;
  const directory = catalogProjection.value?.draftDirectories.find(
    (candidate) => candidate.id === pending.draftDirectoryId
  );
  const section = directory?.sections.find(
    (candidate) => candidate.id === pending.sectionId
  );
  const source = section
    ? documents.value.find((document) => document.id === section.bodyDocumentId)
    : undefined;
  if (!directory || !section || !source) {
    pendingExpertSectionDeletion.value = null;
    uiMessage.warning("该正文已经不存在");
    return;
  }
  const conversationKey = `${pending.workspaceId}:expert_section_writer:${encodeURIComponent(pending.sectionId)}`;
  if (
    expertDraftMutationBlocked(source) ||
    catalogMutationPending.value ||
    !window.deepwrite
  ) {
    uiMessage.info(`当前${pending.workspaceType === "script" ? "剧集" : "小节"}正在处理或保存，请稍候再删除`);
    return;
  }
  const removedIndex = directory.sections.findIndex(
    (candidate) => candidate.id === pending.sectionId
  );
  const fallbackSections = directory.sections.filter(
    (candidate) => candidate.id !== pending.sectionId
  );
  const fallbackSection =
    fallbackSections[Math.min(removedIndex, fallbackSections.length - 1)];
  catalogMutationPending.value = true;
  try {
    const book = catalogBook(pending.workspaceId);
    const deleted = await window.deepwrite.catalog.deleteDraftSection({
      bookId: pending.workspaceId,
      sectionId: pending.sectionId,
      ...(book?.projectRevision === undefined
        ? {}
        : { baseProjectRevision: book.projectRevision })
    });
    if (!deleted.deleted) {
      throw new Error(
        `该${pending.workspaceType === "script" ? "剧集" : "正文小节"}已经不存在。`
      );
    }
    const nextDrafts = { ...editorDrafts.value };
    delete nextDrafts[section.bodyDocumentId];
    delete nextDrafts[section.characterStateDocumentId];
    editorDrafts.value = nextDrafts;
    conversations.get(conversationKey)?.dispose();
    conversations.delete(conversationKey);
    // Keep the refresh anchored to this book's virtual draft directory. If the
    // deleted child disappears first, the generic fallback would otherwise
    // choose the first draft directory from another book.
    selectedResourceId.value = directory.id;
    activeCreationResourceId.value = directory.id;
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
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
    pendingExpertSectionDeletion.value = null;
    uiMessage.success(`已删除“${pending.sectionTitle}”及对应人物状态文件`);
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error
        ? error.message
        : `删除${pending.workspaceType === "script" ? "剧集" : "正文小节"}失败。`
    );
  } finally {
    catalogMutationPending.value = false;
  }
}

function applyDocumentLocally(
  payload: { id: string; title: string; content: string },
  savedProjectRevision?: number,
  submittedPayload = payload
): void {
  const index = documents.value.findIndex((document) => document.id === payload.id);
  if (index < 0) {
    return;
  }
  const current = documents.value[index]!;
  const projectDocumentIds = new Set(
    documents.value.flatMap((document) => {
      const belongsToProject = current.workspaceId
        ? document.workspaceId === current.workspaceId
        : current.libraryId
          ? document.libraryId === current.libraryId && document.domain === current.domain
          : document.id === current.id;
      return belongsToProject ? [document.id] : [];
    })
  );
  documents.value = documents.value.map((document) => {
    if (!projectDocumentIds.has(document.id)) return document;
    const withProjectRevision =
      savedProjectRevision === undefined
        ? document
        : { ...document, catalogProjectRevision: savedProjectRevision };
    if (document.id === payload.id) {
      const path = [...withProjectRevision.path];
      if (document.draftFileKind === "body" && path.length >= 2) {
        path[path.length - 2] = payload.title;
      } else if (path.length) {
        path[path.length - 1] = payload.title;
      }
      return {
        ...withProjectRevision,
        title: payload.title,
        content: payload.content,
        path
      };
    }
    if (
      current.draftFileKind === "body" &&
      document.draftFileKind === "character-state" &&
      document.expertSectionId === current.expertSectionId
    ) {
      const path = [...withProjectRevision.path];
      if (path.length >= 2) path[path.length - 2] = payload.title;
      return {
        ...withProjectRevision,
        title: draftCharacterStateTitle(payload.title),
        path
      };
    }
    return withProjectRevision;
  });
  const currentDraft = editorDrafts.value[payload.id];
  const nextDrafts = { ...editorDrafts.value };
  if (savedProjectRevision !== undefined) {
    for (const documentId of projectDocumentIds) {
      const draft = nextDrafts[documentId];
      if (draft?.dirty) {
        nextDrafts[documentId] = {
          ...draft,
          recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
          baseProjectRevision: savedProjectRevision
        };
      }
    }
  }
  if (current.draftFileKind === "body" && current.expertSectionId) {
    const pairedState = documents.value.find(
      (document) =>
        document.workspaceId === current.workspaceId &&
        document.expertSectionId === current.expertSectionId &&
        document.draftFileKind === "character-state"
    );
    if (pairedState && nextDrafts[pairedState.id]) {
      nextDrafts[pairedState.id] = {
        ...nextDrafts[pairedState.id]!,
        title: draftCharacterStateTitle(payload.title)
      };
    }
  }
  if (
    currentDraft &&
    (currentDraft.title !== submittedPayload.title ||
      currentDraft.content !== submittedPayload.content)
  ) {
    // The user continued typing while an asynchronous save was in flight.
    // Keep that newer draft and advance only its disk base to what just saved.
    nextDrafts[payload.id] = {
      ...currentDraft,
      ...(current.draftFileKind === "character-state"
        ? { title: payload.title }
        : {}),
      dirty: true,
      recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
      baseRevision: createShortWorkspaceContentRevision(payload.content),
      ...(savedProjectRevision === undefined
        ? {}
        : { baseProjectRevision: savedProjectRevision })
    };
  } else {
    delete nextDrafts[payload.id];
  }
  editorDrafts.value = nextDrafts;
}

function applyAcceptedAgentDocumentLocally(
  payload: { id: string; title: string; content: string },
  savedProjectRevision: number | undefined,
  draftAtAccept: EditorDraftState | undefined
): void {
  const currentDraft = editorDrafts.value[payload.id];
  if (currentDraft && currentDraft === draftAtAccept) {
    // Only replace the exact draft reviewed by the user. Recovery syncs,
    // programmatic writes, or another window may have produced a newer draft
    // while Core was saving; applyDocumentLocally preserves those drafts.
    editorDrafts.value = {
      ...editorDrafts.value,
      [payload.id]: {
        ...currentDraft,
        title: payload.title,
        content: payload.content
      }
    };
  }
  applyDocumentLocally(payload, savedProjectRevision);
}

async function refreshBookAfterSuccessfulDocumentSave(
  workspaceId: string,
  expectedDocuments: ReadonlyMap<string, WorkspaceDocumentBaseline>
): Promise<boolean> {
  if (!window.deepwrite) return false;
  try {
    const latestSnapshot = await window.deepwrite.catalog.snapshot();
    const latestBook = latestSnapshot.books.find(
      (book) => book.id === workspaceId
    );
    if (!latestBook) {
      throw new Error("保存后的书籍没有出现在最新目录快照中。");
    }
    const latestRevision = latestBook.projectRevision;
    const currentRevision = catalogBook(workspaceId)?.projectRevision;
    if (
      latestRevision !== undefined &&
      currentRevision !== undefined &&
      latestRevision < currentRevision
    ) {
      return true;
    }
    applyCatalogSnapshot(latestSnapshot);
    const projectRevision = catalogBook(workspaceId)?.projectRevision;
    editorDrafts.value = rebaseDraftsForMatchingDocuments(
      editorDrafts.value,
      documents.value,
      workspaceId,
      expectedDocuments,
      projectRevision,
      nextDraftRecoveryTimestamp()
    );
    return true;
  } catch {
    uiMessage.warning("文稿已保存，但最新目录版本暂未同步；下次聚焦窗口时会自动重试");
    return false;
  }
}

function setAgentEditDocumentAccepting(documentId: string, accepting: boolean): void {
  const next = new Set(acceptingAgentEditDocumentIds.value);
  if (accepting) {
    next.add(documentId);
  } else {
    next.delete(documentId);
  }
  acceptingAgentEditDocumentIds.value = next;
}

function setAgentEditWorkspaceAccepting(workspaceId: string, accepting: boolean): void {
  const next = new Set(acceptingAgentEditWorkspaceIds.value);
  if (accepting) {
    next.add(workspaceId);
  } else {
    next.delete(workspaceId);
  }
  acceptingAgentEditWorkspaceIds.value = next;
}

function setDocumentSaving(documentId: string, saving: boolean): void {
  const next = new Set(savingDocumentIds.value);
  if (saving) {
    next.add(documentId);
  } else {
    next.delete(documentId);
  }
  savingDocumentIds.value = next;
}

function rememberWorkspaceMutationEvent(eventId: string): boolean {
  if (handledWorkspaceMutationEventIds.has(eventId)) return false;
  handledWorkspaceMutationEventIds.add(eventId);
  while (handledWorkspaceMutationEventIds.size > 2_000) {
    const oldest = handledWorkspaceMutationEventIds.values().next().value as
      | string
      | undefined;
    if (!oldest) break;
    handledWorkspaceMutationEventIds.delete(oldest);
  }
  return true;
}

function applySavedCatalogDocument(
  bookId: string,
  saved: CatalogDocument,
  projectRevision: number | undefined
): void {
  const snapshot = catalogSnapshot.value;
  if (!snapshot) return;
  const nextSnapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: saved.updatedAt,
    books: snapshot.books.map((book) =>
      book.id !== bookId
        ? book
        : {
            ...book,
            updatedAt: saved.updatedAt,
            ...(projectRevision === undefined ? {} : { projectRevision }),
            documents: book.documents.map((document) =>
              document.id === saved.id ? saved : document
            ),
            draft: {
              ...book.draft,
              updatedAt: saved.updatedAt,
              sections: book.draft.sections.map((section) => {
                if (section.body.id === saved.id) {
                  return {
                    ...section,
                    title: saved.title,
                    body: saved,
                    characterState: {
                      ...section.characterState,
                      title: draftCharacterStateTitle(saved.title)
                    },
                    updatedAt: saved.updatedAt
                  };
                }
                if (section.characterState.id === saved.id) {
                  return {
                    ...section,
                    characterState: saved,
                    updatedAt: saved.updatedAt
                  };
                }
                return section;
              })
            }
          }
    )
  };
}

function applySavedLibraryEntry(
  domain: "material" | "skill",
  libraryId: string,
  saved: CatalogLibraryEntry,
  projectRevision: number | undefined
): void {
  const snapshot = catalogSnapshot.value;
  if (!snapshot) return;
  catalogSnapshot.value = {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: saved.updatedAt,
    ...(domain === "material"
      ? {
          materials: snapshot.materials.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: saved.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: library.entries.map((entry) =>
                    entry.id === saved.id ? saved : entry
                  )
                }
          )
        }
      : {
          skills: snapshot.skills.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: saved.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: library.entries.map((entry) =>
                    entry.id === saved.id ? saved : entry
                  )
                }
          )
        })
  } as CatalogSnapshot;
}

function applyCreatedLibraryEntry(
  domain: "material" | "skill",
  libraryId: string,
  created: CatalogLibraryEntry,
  projectRevision: number | undefined
): void {
  const snapshot = catalogSnapshot.value;
  if (!snapshot) return;
  const nextSnapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: created.updatedAt,
    ...(domain === "material"
      ? {
          materials: snapshot.materials.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: created.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: [...library.entries, created]
                }
          )
        }
      : {
          skills: snapshot.skills.map((library) =>
            library.id !== libraryId
              ? library
              : {
                  ...library,
                  updatedAt: created.updatedAt,
                  ...(projectRevision === undefined ? {} : { projectRevision }),
                  entries: [...library.entries, created]
                }
          )
        })
  } as CatalogSnapshot;
  catalogSnapshot.value = nextSnapshot;
  const createdDocument = projectCatalogWorkspace(
    nextSnapshot
  ).workspaceDocuments.find(
    (document) =>
      document.domain === domain &&
      document.libraryId === libraryId &&
      document.catalogEntryId === created.id
  );
  if (
    createdDocument &&
    !documents.value.some((document) => document.id === createdDocument.id)
  ) {
    documents.value = [...documents.value, createdDocument];
  }
}

function restoreDraftAfterSaveFailure(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string }
): void {
  const currentDraft = editorDrafts.value[payload.id];
  const newerDraft =
    currentDraft &&
    (currentDraft.title !== payload.title || currentDraft.content !== payload.content)
      ? currentDraft
      : { title: payload.title, content: payload.content };
  editorDrafts.value = {
    ...editorDrafts.value,
    [payload.id]: {
      ...newerDraft,
      dirty: true,
      recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
      baseRevision:
        currentDraft?.baseRevision ??
        createShortWorkspaceContentRevision(document.content),
      ...(currentDraft?.baseProjectRevision !== undefined
        ? { baseProjectRevision: currentDraft.baseProjectRevision }
        : document.catalogProjectRevision === undefined
          ? {}
          : { baseProjectRevision: document.catalogProjectRevision })
    }
  };
}

function isCatalogConflict(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("catalog.conflict:");
}

async function openSaveConflict(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string }
): Promise<void> {
  if (!window.deepwrite) return;
  try {
    const latestSnapshot = await window.deepwrite.catalog.snapshot();
    const diskBook = document.workspaceId
      ? latestSnapshot.books.find((book) => book.id === document.workspaceId)
      : undefined;
    const diskDocument = document.workspaceId && document.catalogDocumentId
      ? diskBook?.documents.find(
          (candidate) => candidate.id === document.catalogDocumentId
        ) ??
        diskBook?.draft.sections
          .flatMap((section) => [section.body, section.characterState])
          .find((candidate) => candidate.id === document.catalogDocumentId)
      : document.libraryId && document.catalogEntryId && document.domain === "material"
        ? latestSnapshot.materials
            .find((library) => library.id === document.libraryId)
            ?.entries.find((entry) => entry.id === document.catalogEntryId)
        : document.libraryId && document.catalogEntryId && document.domain === "skill"
          ? latestSnapshot.skills
              .find((library) => library.id === document.libraryId)
              ?.entries.find((entry) => entry.id === document.catalogEntryId)
          : undefined;
    applyCatalogSnapshot(latestSnapshot);
    if (!diskDocument) {
      uiMessage.error("磁盘版本已不存在，当前草稿仍保留在恢复区");
      return;
    }
    const diskTitle = diskDocument.title;
    const diskContent = "content" in diskDocument ? diskDocument.content : diskDocument.body;
    if (diskTitle === payload.title && diskContent === payload.content) {
      const nextDrafts = { ...editorDrafts.value };
      const currentDraft = nextDrafts[payload.id];
      if (
        currentDraft &&
        (currentDraft.title !== payload.title ||
          currentDraft.content !== payload.content)
      ) {
        const latestProjectRevision = documents.value.find(
          (candidate) => candidate.id === payload.id
        )?.catalogProjectRevision;
        nextDrafts[payload.id] = {
          ...currentDraft,
          dirty: true,
          recoveryUpdatedAt: nextDraftRecoveryTimestamp(),
          baseRevision: createShortWorkspaceContentRevision(diskContent),
          ...(latestProjectRevision === undefined
            ? {}
            : { baseProjectRevision: latestProjectRevision })
        };
      } else {
        delete nextDrafts[payload.id];
      }
      editorDrafts.value = nextDrafts;
      uiMessage.info(
        currentDraft &&
          (currentDraft.title !== payload.title ||
            currentDraft.content !== payload.content)
          ? "磁盘已包含较早修改；你随后输入的新草稿仍保留"
          : "磁盘版本已经包含当前修改，无需重复保存"
      );
      return;
    }
    saveConflict.value = {
      documentId: payload.id,
      payload,
      latestSnapshot,
      diskTitle,
      diskContent
    };
  } catch (snapshotError: unknown) {
    uiMessage.error(
      snapshotError instanceof Error
        ? snapshotError.message
        : "读取磁盘冲突版本失败，当前草稿仍保留"
    );
  }
}

interface DocumentSaveOptions {
  force?: boolean;
  announceSuccess?: boolean;
}

async function saveCatalogDocument(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string },
  options: DocumentSaveOptions = {}
): Promise<boolean> {
  const force = options.force ?? false;
  if (
    !window.deepwrite ||
    !document.workspaceId ||
    !document.catalogDocumentId ||
    savingDocumentIds.value.has(payload.id)
  ) {
    return false;
  }
  setDocumentSaving(payload.id, true);
  try {
    const projectRevision =
      force
        ? document.catalogProjectRevision
        : editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision;
    const saved = await window.deepwrite.catalog.saveDocument({
      bookId: document.workspaceId,
      documentId: document.catalogDocumentId,
      title: payload.title,
      content: payload.content,
      baseRevision:
        editorDrafts.value[payload.id]?.baseRevision ??
        createShortWorkspaceContentRevision(document.content),
      ...(projectRevision === undefined
        ? {}
        : { baseProjectRevision: projectRevision }),
      ...(force ? { force: true } : {})
    });
    const normalizedPayload = {
      id: payload.id,
      title: saved.title,
      content: saved.content
    };
    applySavedCatalogDocument(document.workspaceId, saved, undefined);
    applyDocumentLocally(
      normalizedPayload,
      undefined,
      payload
    );
    if (options.announceSuccess !== false) {
      uiMessage.success("文稿已保存到本机");
    }
    const expectedDocuments = captureWorkspaceDocumentBaselines(
      documents.value,
      document.workspaceId
    );
    await refreshBookAfterSuccessfulDocumentSave(
      document.workspaceId,
      expectedDocuments
    );
    return true;
  } catch (error: unknown) {
    restoreDraftAfterSaveFailure(document, payload);
    if (isCatalogConflict(error)) {
      await openSaveConflict(document, payload);
    } else {
      uiMessage.error(error instanceof Error ? error.message : "保存文稿失败。");
    }
    return false;
  } finally {
    setDocumentSaving(payload.id, false);
  }
}

async function saveCatalogLibraryEntry(
  document: WorkspaceDocument,
  payload: { id: string; title: string; content: string },
  options: DocumentSaveOptions = {}
): Promise<boolean> {
  const force = options.force ?? false;
  if (
    !window.deepwrite ||
    !document.libraryId ||
    !document.catalogEntryId ||
    (document.domain !== "material" && document.domain !== "skill") ||
    savingDocumentIds.value.has(payload.id)
  ) {
    return false;
  }
  setDocumentSaving(payload.id, true);
  try {
    const projectRevision =
      force
        ? document.catalogProjectRevision
        : editorDrafts.value[payload.id]?.baseProjectRevision ??
          document.catalogProjectRevision;
    const saved = await window.deepwrite.catalog.saveLibraryEntry({
      domain: document.domain,
      libraryId: document.libraryId,
      entryId: document.catalogEntryId,
      title: payload.title,
      content: payload.content,
      baseRevision:
        editorDrafts.value[payload.id]?.baseRevision ??
        createShortWorkspaceContentRevision(document.content),
      ...(projectRevision === undefined
        ? {}
        : { baseProjectRevision: projectRevision }),
      ...(force ? { force: true } : {})
    });
    const savedProjectRevision =
      projectRevision === undefined ? undefined : projectRevision + 1;
    applySavedLibraryEntry(
      document.domain,
      document.libraryId,
      saved,
      savedProjectRevision
    );
    applyDocumentLocally(
      payload,
      savedProjectRevision
    );
    if (options.announceSuccess !== false) {
      uiMessage.success(`${document.domain === "material" ? "素材" : "技能"}内容已保存到本机文件夹`);
    }
    return true;
  } catch (error: unknown) {
    restoreDraftAfterSaveFailure(document, payload);
    if (isCatalogConflict(error)) {
      await openSaveConflict(document, payload);
    } else {
      uiMessage.error(error instanceof Error ? error.message : "保存资料库内容失败。");
    }
    return false;
  } finally {
    setDocumentSaving(payload.id, false);
  }
}

async function persistEditorDocument(
  payload: { id: string; title: string; content: string },
  announceSuccess: boolean
): Promise<boolean> {
  const document = documents.value.find((candidate) => candidate.id === payload.id);
  if (!document) return false;
  if (
    document.workspaceId &&
    acceptingAgentEditWorkspaceIds.value.has(document.workspaceId)
  ) {
    if (announceSuccess) {
      uiMessage.info("正在保存同一作品的智能体修改，请稍候");
    }
    return false;
  }
  if (document.catalogDocumentId && document.workspaceId) {
    return saveCatalogDocument(document, payload, { announceSuccess });
  }
  if (
    document.catalogEntryId &&
    document.libraryId &&
    (document.domain === "material" || document.domain === "skill")
  ) {
    return saveCatalogLibraryEntry(document, payload, { announceSuccess });
  }
  applyDocumentLocally(payload);
  return true;
}

async function runEditorAutoSave(documentId: string): Promise<void> {
  if (!editorAutoSaveEnabled.value) return;
  const draft = editorDrafts.value[documentId];
  const document = documents.value.find((candidate) => candidate.id === documentId);
  if (!draft?.dirty || !document || document.readOnly) return;
  if (
    saveConflict.value?.documentId === documentId ||
    savingDocumentIds.value.size > 0 ||
    agentRunScopeHasWriteBarrier(agentRunScopeForDocument(document)) ||
    acceptingAgentEditDocumentIds.value.has(documentId) ||
    (document.workspaceId !== undefined &&
      acceptingAgentEditWorkspaceIds.value.has(document.workspaceId))
  ) {
    if (saveConflict.value?.documentId !== documentId) {
      scheduleEditorAutoSave(documentId, EDITOR_AUTO_SAVE_RETRY_MS);
    }
    return;
  }

  const submittedPayload = {
    id: documentId,
    title: draft.title,
    content: draft.content
  };
  const saved = await persistEditorDocument(submittedPayload, false);
  const latestDraft = editorDrafts.value[documentId];
  if (
    saved &&
    latestDraft?.dirty &&
    (latestDraft.title !== submittedPayload.title ||
      latestDraft.content !== submittedPayload.content)
  ) {
    scheduleEditorAutoSave(documentId);
  }
}

function applyDocument(rawPayload: { id: string; title: string; content: string }): void {
  cancelEditorAutoSave(rawPayload.id);
  enqueueEditorSave(async () => {
    await persistEditorDocument(rawPayload, true);
  });
}

function keepSaveConflictDraft(): void {
  saveConflict.value = null;
}

function reloadSaveConflictFromDisk(): void {
  const conflict = saveConflict.value;
  if (!conflict) return;
  const nextDrafts = { ...editorDrafts.value };
  delete nextDrafts[conflict.documentId];
  editorDrafts.value = nextDrafts;
  applyCatalogSnapshot(conflict.latestSnapshot);
  saveConflict.value = null;
  uiMessage.success("已重新加载磁盘版本");
}

async function overwriteSaveConflictOnDisk(): Promise<void> {
  const conflict = saveConflict.value;
  if (!conflict || saveConflictSubmitting.value) return;
  saveConflictSubmitting.value = true;
  try {
    applyCatalogSnapshot(conflict.latestSnapshot);
    const document = documents.value.find(
      (candidate) => candidate.id === conflict.documentId
    );
    if (!document) {
      throw new Error("冲突文稿已不在当前项目中，草稿仍保留");
    }
    const saved =
      document.catalogDocumentId && document.workspaceId
        ? await saveCatalogDocument(document, conflict.payload, { force: true })
        : document.catalogEntryId && document.libraryId &&
            (document.domain === "material" || document.domain === "skill")
          ? await saveCatalogLibraryEntry(document, conflict.payload, { force: true })
          : false;
    if (saved) {
      saveConflict.value = null;
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "覆盖磁盘版本失败");
  } finally {
    saveConflictSubmitting.value = false;
  }
}

function newConversation(): void {
  if (activeLongBookId.value !== null) {
    newLongConversation();
    return;
  }
  if (
    acceptingAgentEditDocumentIds.value.size > 0 ||
    acceptingAgentEditWorkspaceIds.value.size > 0 ||
    queuedAgentEdits.size > 0
  ) {
    uiMessage.info("请等待智能体修改保存完成后再新建对话");
    return;
  }
  workspaceMainView.value = "conversation";
  activeConversation.value.newConversation();
  clearEditorSelectionReferences();
}

function selectConversation(sessionId: string): void {
  if (
    acceptingAgentEditDocumentIds.value.size > 0 ||
    acceptingAgentEditWorkspaceIds.value.size > 0 ||
    queuedAgentEdits.size > 0
  ) {
    uiMessage.info("请等待智能体修改保存完成后再切换对话");
    return;
  }
  if (!activeConversation.value.selectConversation(sessionId)) {
    uiMessage.warning(
      activeConversation.value.isBusy.value
        ? "请先停止当前回复，再切换历史对话"
        : "这条历史对话已不可用，请重新打开历史列表"
    );
    return;
  }
  clearEditorSelectionReferences();
  queueMicrotask(() =>
    resumeRecoveredAutomaticAgentEdits([activeConversation.value])
  );
}

function useSuggestion(value: string): void {
  activeConversation.value.useSuggestion(value);
}

async function sendMessage(promptAttachments: UserPromptAttachment[] = []): Promise<void> {
  const conversation = activeConversation.value;
  const sendSessionId = conversation.sessionId.value;
  const attachments = activeLibraryAttachments.value;
  const librarySkillAttachments = activeLibrarySkillAttachments.value;
  if (
    (activeAgentDocument.value.domain === "material" ||
      activeAgentDocument.value.domain === "skill") &&
    !activeLibraryAgentContext.value
  ) {
    uiMessage.warning("当前资料库上下文尚未就绪，请重新选择条目后再发送。");
    return;
  }
  if (attachments && !attachments.complete && attachments.diagnostics.length) {
    const first = attachments.diagnostics[0]!;
    uiMessage.warning(
      attachments.diagnostics.length === 1
        ? first.message
        : `${first.message}（另有 ${attachments.diagnostics.length - 1} 项资料库提示）`
    );
  }
  if (
    librarySkillAttachments &&
    !librarySkillAttachments.complete &&
    librarySkillAttachments.diagnostics.length
  ) {
    const first = librarySkillAttachments.diagnostics[0]!;
    uiMessage.warning(
      librarySkillAttachments.diagnostics.length === 1
        ? first.message
        : `${first.message}（另有 ${librarySkillAttachments.diagnostics.length - 1} 项可用技能提示）`
    );
  }
  await conversation.sendMessage(
    activeAgentDocument.value,
    liveWorkspaceDocuments.value,
    {
      ...(attachments
        ? {
          attachedSkills: attachments.attachedSkills,
          attachedMaterials: attachments.attachedMaterials
          }
        : librarySkillAttachments
          ? { attachedSkills: librarySkillAttachments.attachedSkills }
          : {}),
      ...(activeLibraryAgentContext.value
        ? { libraryWorkspace: activeLibraryAgentContext.value }
        : {})
    },
    promptAttachments
  );
  scheduleQueuedAgentEdits(
    (queued) =>
      queued.conversation === conversation && queued.sessionId === sendSessionId
  );
}

async function stopGeneration(): Promise<void> {
  try {
    if (await activeConversation.value.stopGeneration()) {
      uiMessage.info("已停止生成");
    }
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "停止生成失败，请稍后重试。");
  }
}

function synchronizeLongAgentRunPreferences(): void {
  const conversation = activeLongConversation.value;
  const summary = activeLongBookSummary.value;
  if (!conversation || !summary) return;
  synchronizeAgentRunPreferences(`long:${summary.id}`, conversation);
}

function newLongConversation(): void {
  if (blockActiveLongWritingPlan("新建长篇对话")) {
    return;
  }
  const conversation = activeLongConversation.value;
  if (!conversation) return;
  if (conversation.isBusy.value) {
    uiMessage.warning("请先停止当前长篇回复，再新建对话。");
    return;
  }
  conversation.newConversation();
  workspaceMainView.value = "conversation";
}

function selectLongConversation(sessionId: string): void {
  if (blockActiveLongWritingPlan("切换长篇对话")) {
    return;
  }
  const conversation = activeLongConversation.value;
  if (!conversation) return;
  if (!conversation.selectConversation(sessionId)) {
    uiMessage.warning(
      conversation.isBusy.value
        ? "请先停止当前回复，再切换历史对话。"
        : "这条长篇历史对话已不可用。"
    );
  }
}

function useLongSuggestion(value: string): void {
  activeLongConversation.value?.useSuggestion(value);
}

interface LongMessageSendTarget {
  bookId: string;
  selectionKey: string | null;
  preferredRole: LongWorkspaceSelection["preferredRole"] | null;
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"];
  chapterCardId: string | null;
  fileId: LongFileId | null;
  agentId: LongAgentProfile["id"];
  conversation: AgentConversationController;
  sessionId: string;
  draft: string;
}

function captureLongMessageSendTarget(): LongMessageSendTarget | null {
  const bookId = activeLongBookId.value;
  const summary = activeLongBookSummary.value;
  const profile = activeLongAgentProfile.value;
  const conversation = activeLongConversation.value;
  const runtimeContext = activeLongRuntimeContext.value;
  if (
    !bookId ||
    summary?.id !== bookId ||
    !profile ||
    !conversation ||
    !runtimeContext
  ) {
    return null;
  }
  return {
    bookId,
    selectionKey: activeLongSelection.value?.key ?? null,
    preferredRole: activeLongSelection.value?.preferredRole ?? null,
    activeRoot: runtimeContext.activeRoot,
    chapterCardId: runtimeContext.activeChapterCardId ?? null,
    fileId: runtimeContext.activeFileId ?? null,
    agentId: profile.id,
    conversation,
    sessionId: conversation.sessionId.value,
    draft: conversation.draft.value
  };
}

function isCurrentLongMessageSendTarget(
  target: LongMessageSendTarget
): boolean {
  const selection = activeLongSelection.value;
  const fileId =
    activeLongFileContext.value?.bookId === target.bookId &&
    selection?.files.some(
      ({ file }) => file.id === activeLongFileContext.value?.fileId
    )
      ? activeLongFileContext.value.fileId
      : null;
  return (
    activeLongBookId.value === target.bookId &&
    activeLongBookSummary.value?.id === target.bookId &&
    (selection?.key ?? null) === target.selectionKey &&
    (selection?.preferredRole ?? null) === target.preferredRole &&
    activeLongRoot.value === target.activeRoot &&
    (selection?.chapterCardId ?? null) === target.chapterCardId &&
    fileId === target.fileId &&
    activeLongAgentProfile.value?.id === target.agentId &&
    activeLongConversation.value === target.conversation &&
    target.conversation.sessionId.value === target.sessionId &&
    target.conversation.draft.value === target.draft
  );
}

function confirmLongMessageSendTarget(
  target: LongMessageSendTarget
): boolean {
  if (isCurrentLongMessageSendTarget(target)) return true;
  uiMessage.info("长篇上下文或草稿已切换，本次发送已取消。");
  return false;
}

async function sendLongMessage(
  promptAttachments: UserPromptAttachment[] = []
): Promise<void> {
  if (longSendPreflightPending.value) return;
  const target = captureLongMessageSendTarget();
  if (!target) {
    uiMessage.warning("长篇工作区上下文尚未就绪，请稍后重试。");
    return;
  }
  longSendPreflightPending.value = true;
  try {
    await nextTick();
    if (!confirmLongMessageSendTarget(target)) return;
    const settingsLoaded = await ensureLongAgentSettingsLoaded();
    if (!confirmLongMessageSendTarget(target)) return;
    if (!settingsLoaded) {
      uiMessage.warning(
        longAgentLoadError.value ??
          "长篇智能体设置尚未加载，请重试。"
      );
      return;
    }
    const saved = await saveActiveLongEditorChanges();
    if (!confirmLongMessageSendTarget(target) || !saved) return;
    const refreshed = await refreshActiveLongWorkspace(target.bookId);
    if (!confirmLongMessageSendTarget(target) || !refreshed) return;

    const baseRuntimeContext = activeLongRuntimeContext.value;
    if (
      !baseRuntimeContext ||
      baseRuntimeContext.bookId !== target.bookId ||
      baseRuntimeContext.activeRoot !== target.activeRoot ||
      baseRuntimeContext.activeAgentId !== target.agentId ||
      (baseRuntimeContext.activeChapterCardId ?? null) !==
        target.chapterCardId ||
      (baseRuntimeContext.activeFileId ?? null) !== target.fileId
    ) {
      uiMessage.info("长篇上下文已切换，本次发送已取消。");
      return;
    }
    let runtimeContext = baseRuntimeContext;
    if (
      target.activeRoot === "worldbuilding" &&
      target.fileId
    ) {
      const api = resolveLongWorkspaceApi();
      if (!api) {
        uiMessage.warning("当前环境未连接长篇工作区。");
        return;
      }
      try {
        const worldbuildingFocus =
          await buildLongWorldbuildingFocusSnapshot({
            bookId: target.bookId,
            selection: activeLongSelection.value,
            activeFileId: target.fileId,
            readDocument: (input) => api.readDocument(input)
          });
        if (!confirmLongMessageSendTarget(target)) return;
        if (worldbuildingFocus) {
          runtimeContext = {
            ...baseRuntimeContext,
            worldbuildingFocus
          };
        }
      } catch (error: unknown) {
        uiMessage.warning(
          error instanceof Error
            ? `当前世界观阶段读取失败：${error.message}`
            : "当前世界观阶段读取失败，请重试。"
        );
        return;
      }
    }
    if (
      target.activeRoot === "character_design" &&
      target.fileId
    ) {
      const api = resolveLongWorkspaceApi();
      if (!api) {
        uiMessage.warning("当前环境未连接长篇工作区。");
        return;
      }
      try {
        const characterFocus = await buildLongCharacterFocusSnapshot({
          bookId: target.bookId,
          selection: activeLongSelection.value,
          activeFileId: target.fileId,
          characterOverviewFile:
            activeLongWorkspaceIndex.value?.characterOverview ?? null,
          readDocument: (input) => api.readDocument(input)
        });
        if (!confirmLongMessageSendTarget(target)) return;
        if (characterFocus) {
          runtimeContext = {
            ...baseRuntimeContext,
            characterFocus
          };
        }
      } catch (error: unknown) {
        uiMessage.warning(
          error instanceof Error
            ? `当前人物阶段读取失败：${error.message}`
            : "当前人物阶段读取失败，请重试。"
        );
        return;
      }
    }
    if (target.activeRoot === "plot_design") {
      const plotFocus = buildLongPlotFocusSnapshot({
        selection: activeLongSelection.value,
        navigation: baseRuntimeContext.navigation
      });
      if (plotFocus) {
        runtimeContext = {
          ...baseRuntimeContext,
          plotFocus
        };
      }
    }
    const libraryAttachments = activeLongLibraryAttachments.value;
    if (
      libraryAttachments &&
      !libraryAttachments.complete &&
      libraryAttachments.diagnostics.length
    ) {
      const first = libraryAttachments.diagnostics[0]!;
      uiMessage.warning(
        libraryAttachments.diagnostics.length === 1
          ? first.message
          : `${first.message}（另有 ${libraryAttachments.diagnostics.length - 1} 项长篇资源提示）`
      );
    }
    target.conversation.selectApprovalMode(
      longAgentRunApprovalMode(
        target.agentId,
        generalSettings.value.permissionMode
      )
    );
    await target.conversation.sendLongMessage(
      runtimeContext,
      activeLongReadableAttachments.value,
      promptAttachments
    );
  } finally {
    longSendPreflightPending.value = false;
  }
}

async function retryActiveLongWorkspaceRefresh(): Promise<void> {
  const bookId = activeLongBookId.value;
  if (!bookId || activeLongWorkspaceRefreshStatus.value?.pending) return;
  await refreshActiveLongWorkspace(bookId);
}

async function stopLongGeneration(): Promise<void> {
  const conversation = activeLongConversation.value;
  if (!conversation) return;
  try {
    if (await conversation.stopGeneration()) {
      uiMessage.info("已停止长篇生成。");
    }
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "停止长篇生成失败。"
    );
  }
}

async function cancelLongWritingWorkflow(): Promise<void> {
  const expectation = longWritingAgentRunExpectation;
  if (expectation) {
    longWorkspaceProposals.quarantineSession(
      expectation.bookId,
      expectation.sessionId
    );
  }
  longWritingAgentRunExpectation = null;
  longWritingOrchestrator.cancel();
  if (expectation) {
    const activeRoot =
      expectation.agentId === "expert_section_writer"
        ? "draft"
        : "continuity_ledger";
    const conversation = conversations.get(
      longConversationKey(
        expectation.bookId,
        expectation.agentId,
        activeRoot,
        expectation.chapterCardId
      )
    );
    if (
      conversation &&
      conversation.sessionId.value === expectation.sessionId
    ) {
      const canceledPending =
        conversation.cancelPendingGeneration();
      const stopPromise =
        !canceledPending && conversation.isBusy.value
          ? conversation.stopGeneration()
          : Promise.resolve(false);
      if (!canceledPending) {
        // Invalidate the old session synchronously after capturing any live
        // runId. This closes both pre-acceptance and active-run event windows.
        conversation.newConversation();
      }
      try {
        await stopPromise;
      } catch (error: unknown) {
        uiMessage.warning(
          error instanceof Error
            ? `写作计划已取消；停止后台生成时出现提示：${error.message}`
            : "写作计划已取消；后台生成可能仍在收尾。"
        );
        return;
      }
    }
  }
  uiMessage.info("已取消长篇串行写作计划。");
}

function selectLongModel(modelId: string): void {
  activeLongConversation.value?.selectModel(modelId);
  synchronizeLongAgentRunPreferences();
}

function selectLongThinking(level: ThinkingLevel): void {
  activeLongConversation.value?.selectThinkingLevel(level);
  synchronizeLongAgentRunPreferences();
}

function selectLongTemperature(value: number): void {
  activeLongConversation.value?.selectTemperature(value);
  synchronizeLongAgentRunPreferences();
}

function selectLongApprovalMode(
  mode: AgentRunSettings["approvalMode"]
): void {
  updatePermissionMode(mode);
  activeLongConversation.value?.selectApprovalMode(mode);
  synchronizeLongAgentRunPreferences();
}

function canApproveLongProposalDuringActivePlan(
  event: LongWorkspaceProposalEvent
): boolean {
  return canApproveLongWritingProposal({
    active: longWritingOrchestrator.active.value,
    state: longWritingOrchestrator.state.value,
    currentChapter: longWritingOrchestrator.currentChapter.value,
    expectation: longWritingAgentRunExpectation,
    event
  });
}

async function prepareAutomaticLongProposal(
  event: LongWorkspaceProposalEvent
): Promise<void> {
  if (!canApproveLongProposalDuringActivePlan(event)) {
    throw new Error(
      "长篇串行写作阶段已变化，实时自动保存已暂停；请核对当前章后重试。"
    );
  }
  if (activeLongBookId.value !== event.payload.bookId) return;
  await nextTick();
  if (!(await saveActiveLongEditorChanges())) {
    throw new Error(
      "当前长篇编辑内容尚未保存，智能体提案未自动覆盖；请处理编辑器保存状态后重试。"
    );
  }
  if (!canApproveLongProposalDuringActivePlan(event)) {
    throw new Error(
      "长篇串行写作阶段已在保存检查期间变化，实时自动保存已暂停。"
    );
  }
}

async function approveLongProposal(eventId: string): Promise<void> {
  const bookId = activeLongBookId.value;
  if (!bookId || longProposalApprovalPending.value) return;
  const item = longWorkspaceProposals
    .itemsForBook(bookId)
    .find(({ event }) => event.id === eventId);
  if (!item) return;
  const wasPlanBound = longWritingOrchestrator.active.value;
  if (!canApproveLongProposalDuringActivePlan(item.event)) {
    uiMessage.warning(
      "长篇串行写作计划执行中，只能审批当前章当前阶段的提案；请先处理当前章或取消计划。"
    );
    return;
  }
  longProposalApprovalPending.value = true;
  try {
    await nextTick();
    if (!(await saveActiveLongEditorChanges())) return;
    if (activeLongBookId.value !== bookId) {
      uiMessage.info("活动长篇已切换，本次审批已取消。");
      return;
    }
    if (
      wasPlanBound &&
      !longWritingOrchestrator.active.value
    ) {
      uiMessage.info("串行写作计划已取消，本次审批未执行。");
      return;
    }
    const currentItem = longWorkspaceProposals
      .itemsForBook(bookId)
      .find(({ event }) => event.id === eventId);
    if (!currentItem) return;
    if (!canApproveLongProposalDuringActivePlan(currentItem.event)) {
      uiMessage.warning(
        "串行写作阶段已变化，本次审批已取消；请核对当前章后重试。"
      );
      return;
    }
    await longWorkspaceProposals.approve(bookId, eventId);
  } finally {
    longProposalApprovalPending.value = false;
  }
}

function rejectLongProposal(eventId: string): void {
  const bookId = activeLongBookId.value;
  if (!bookId) return;
  const item = longWorkspaceProposals
    .itemsForBook(bookId)
    .find(({ event }) => event.id === eventId);
  const quarantineContinuitySession = Boolean(
    item &&
      item.event.payload.agentId === "continuity_ledger" &&
      canApproveLongProposalDuringActivePlan(item.event)
  );
  if (longWorkspaceProposals.reject(bookId, eventId)) {
    if (quarantineContinuitySession && item) {
      longWorkspaceProposals.quarantineSession(
        bookId,
        item.event.payload.sessionId
      );
    }
    uiMessage.info("已拒绝该长篇提案，未写入任何文件。");
  }
}

function retryLongProposalPreview(eventId: string): void {
  const bookId = activeLongBookId.value;
  if (!bookId) return;
  void longWorkspaceProposals.retryPreview(bookId, eventId);
}

async function openWorkspaceDialog(mode: DialogMode): Promise<void> {
  if (!(await saveActiveLongEditorBeforeLeaving())) {
    return;
  }
  workspaceMainView.value = mode;
  if ((mode === "models" || mode === "imitation") && !modelSettings.value && window.deepwrite) {
    void loadModelSettings();
  }
}

async function openSettings(): Promise<void> {
  if (!(await saveActiveLongEditorBeforeLeaving())) {
    return;
  }
  currentView.value = "settings";
  if (window.deepwrite) {
    if (!modelSettings.value) {
      void loadModelSettings();
    }
    void loadWorkspaceAgentSettings();
    void loadLibraryAgentSettings();
    void loadLearningImitationSettings();
  }
}

async function openAgentTeams(): Promise<void> {
  if (!(await saveActiveLongEditorBeforeLeaving())) {
    return;
  }
  workspaceMainView.value = "agent-team";
  if (
    window.deepwrite &&
    (!agentTeamLoaded.value || !longAgentTeamLoaded.value)
  ) {
    void loadAgentTeamSettings();
  }
  if (window.deepwrite && !modelSettings.value) {
    void loadModelSettings();
  }
  if (window.deepwrite && !catalogSnapshot.value) {
    void loadCatalogSnapshot();
  }
}

async function loadWorkspaceDirectory(): Promise<void> {
  if (!window.deepwrite) return;
  try {
    const settings: WorkspaceDirectorySettings =
      await window.deepwrite.workspaceDirectory.list();
    workspaceDirectoryPath.value = settings.path;
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "加载工作目录失败。");
  }
}

async function chooseWorkspaceDirectory(): Promise<void> {
  if (!window.deepwrite || workspaceDirectoryLoading.value) return;
  workspaceDirectoryLoading.value = true;
  try {
    const settings = await window.deepwrite.workspaceDirectory.choose();
    if (!settings) return;
    workspaceDirectoryPath.value = settings.path;
    uiMessage.success("工作目录已切换；现有项目保持原位置不变");
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "切换工作目录失败。");
  } finally {
    workspaceDirectoryLoading.value = false;
  }
}

function closeSettings(): void {
  currentView.value = "workspace";
}

type WorkspaceEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "workspace.editor_mutation" }
>;
type LibraryEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "library.editor_mutation" }
>;
type LongWorldbuildingFileMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.worldbuilding_file_proposal" }
>;
type LongCharacterFileMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.character_file_proposal" }
>;
type LongPlotDesignMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.mutation_proposal" }
>;
type LongDraftMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.chapter_write_proposal" }
>;

interface AgentEditReviewRequest {
  runId: string;
  proposalId: string;
  decision: "accept" | "reject";
}

function libraryMutationCountKey(proposal: AgentEditProposal): string {
  const target = proposal.libraryTarget!;
  return `${proposal.runId}\u0000${target.domain}\u0000${target.libraryId}`;
}

function currentLibraryProjectRevisionMatches(
  proposal: AgentEditProposal,
  currentRevision: number | undefined
): boolean {
  const baseRevision = proposal.libraryTarget?.baseProjectRevision;
  if (baseRevision === undefined || currentRevision === undefined) {
    return baseRevision === currentRevision;
  }
  const acceptedCount =
    acceptedLibraryMutationCounts.get(libraryMutationCountKey(proposal)) ?? 0;
  return currentRevision === baseRevision + acceptedCount;
}

function rememberAcceptedLibraryMutation(proposal: AgentEditProposal): void {
  const key = libraryMutationCountKey(proposal);
  acceptedLibraryMutationCounts.set(
    key,
    (acceptedLibraryMutationCounts.get(key) ?? 0) + 1
  );
  while (acceptedLibraryMutationCounts.size > 2_000) {
    const oldest = acceptedLibraryMutationCounts.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    acceptedLibraryMutationCounts.delete(oldest);
  }
}

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
    const oldest = acceptedDraftSectionCreationRevisions.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    acceptedDraftSectionCreationRevisions.delete(oldest);
  }
}

async function acceptLibraryCreationProposal(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  proposal: AgentEditProposal,
  automatic: boolean
): Promise<void> {
  const target = proposal.libraryTarget;
  if (
    !target ||
    target.operation !== "create" ||
    typeof proposal.proposedText !== "string"
  ) {
    const message = "待审阅的新条目缺少完整内容，请重新生成。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (!window.deepwrite) {
    const message = "桌面文件服务当前不可用。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  const library = findCatalogLibrary(target.domain, target.libraryId);
  const readOnly =
    !library ||
    (target.domain === "skill" && "isBuiltin" in library && library.isBuiltin);
  if (readOnly) {
    const message = "目标资料库已不可用或只读，无法创建条目。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }
  if (
    !currentLibraryProjectRevisionMatches(proposal, library.projectRevision)
  ) {
    const message = "资料库目录已发生变化，未创建条目，请重新生成。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }
  if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
    uiMessage.info("同一资料库正在保存其他修改，请稍候再接受");
    return;
  }

  conversation.updateEditProposal(request.runId, request.proposalId, {
    status: "accepting",
    statusMessage: automatic
      ? "正在自动批准并创建资料库条目…"
      : "正在校验资料库版本并创建条目…"
  });
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  try {
    const commonInput = {
      libraryId: target.libraryId,
      title: proposal.title,
      content: proposal.proposedText,
      ...(library.projectRevision === undefined
        ? {}
        : { baseProjectRevision: library.projectRevision })
    };
    const created =
      target.domain === "material"
        ? await window.deepwrite.catalog.createLibraryEntry({
            ...commonInput,
            domain: "material",
            stageId: MaterialStageIdSchema.parse(target.stageId)
          })
        : await window.deepwrite.catalog.createLibraryEntry({
            ...commonInput,
            domain: "skill",
            stageId: SkillStageIdSchema.parse(target.stageId)
          });
    const nextProjectRevision =
      library.projectRevision === undefined
        ? undefined
        : library.projectRevision + 1;
    applyCreatedLibraryEntry(
      target.domain,
      target.libraryId,
      created,
      nextProjectRevision
    );
    rememberAcceptedLibraryMutation(proposal);
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage: automatic
        ? "已自动批准并创建资料库条目。"
        : "已创建并保存到本地 Markdown。"
    });
    const createdDocument = documents.value.find(
      (document) =>
        document.domain === target.domain &&
        document.libraryId === target.libraryId &&
        document.catalogEntryId === created.id
    );
    if (createdDocument) {
      selectedResourceId.value = createdDocument.id;
      rightCollapsed.value = false;
    }
    uiMessage.success(
      automatic ? "已自动批准并创建资料库条目" : "已创建资料库条目"
    );
  } catch (error: unknown) {
    const message = isCatalogConflict(error)
      ? "资料库已在外部更新，未创建条目；请重新生成。"
      : error instanceof Error
        ? error.message
        : "创建资料库条目失败。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: isCatalogConflict(error) ? "conflict" : "error",
      statusMessage: message
    });
    if (isCatalogConflict(error)) {
      await loadCatalogSnapshot();
      uiMessage.warning(message);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
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
      section.wordCountRequirement = document.expertWordCountRequirement ?? "";
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

function provisionalExpertSectionMapKey(runId: string, workspaceId: string): string {
  return `${runId}\u0000${workspaceId}`;
}

function rememberProvisionalExpertSectionMapping(
  runId: string,
  workspaceId: string,
  provisionalSectionId: string,
  realSectionId: string
): void {
  const key = provisionalExpertSectionMapKey(runId, workspaceId);
  const map = acceptedProvisionalExpertSectionIds.get(key) ?? new Map<string, string>();
  map.set(provisionalSectionId, realSectionId);
  acceptedProvisionalExpertSectionIds.set(key, map);
  while (acceptedProvisionalExpertSectionIds.size > 2_000) {
    const oldest = acceptedProvisionalExpertSectionIds.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    acceptedProvisionalExpertSectionIds.delete(oldest);
  }
}

function resolveProvisionalExpertSectionId(
  runId: string,
  workspaceId: string,
  sectionId: string
): string {
  if (!isProvisionalExpertDraftSectionId(sectionId)) return sectionId;
  return (
    acceptedProvisionalExpertSectionIds
      .get(provisionalExpertSectionMapKey(runId, workspaceId))
      ?.get(sectionId) ?? sectionId
  );
}

function findPendingDraftSectionCreationForProvisional(
  conversation: AgentConversationController,
  runId: string,
  provisionalSectionId: string
): AgentEditProposal | undefined {
  return conversation.listEditProposals(runId).find((proposal) =>
    Boolean(
      proposal.draftSectionCreationTarget?.sections.some(
        (section) => section.provisionalSectionId === provisionalSectionId
      ) &&
        (proposal.status === "pending" ||
          proposal.status === "accepting" ||
          proposal.status === "error")
    )
  );
}

function findPendingCharacterCreationForProvisional(
  conversation: AgentConversationController,
  runId: string,
  itemId: string
): AgentEditProposal | undefined {
  return conversation.listEditProposals(runId).find((proposal) => {
    const mutation = proposal.characterStructureTarget?.mutation;
    return Boolean(
      mutation?.type === "createItem" &&
        mutation.itemId === itemId &&
        (proposal.status === "pending" ||
          proposal.status === "accepting" ||
          proposal.status === "error")
    );
  });
}

function remapProvisionalExpertSectionFileProposals(
  conversation: AgentConversationController,
  runId: string,
  workspaceId: string,
  mapping: ReadonlyMap<string, string>
): void {
  for (const proposal of conversation.listEditProposals(runId)) {
    if (!proposal.provisionalExpertSection) continue;
    if (
      proposal.status !== "pending" &&
      proposal.status !== "accepting" &&
      proposal.status !== "error"
    ) {
      continue;
    }
    for (const [provisionalSectionId, realSectionId] of mapping) {
      const provisionalBodyId = catalogDraftBodyDocumentId(provisionalSectionId);
      const provisionalStateId =
        catalogDraftCharacterStateDocumentId(provisionalSectionId);
      const fileKind =
        proposal.documentId === provisionalBodyId
          ? ("body" as const)
          : proposal.documentId === provisionalStateId
            ? ("character-state" as const)
            : undefined;
      if (!fileKind) continue;
      const realDocument = liveWorkspaceDocuments.value.find(
        (document) =>
          document.workspaceId === workspaceId &&
          document.stageId === "draft" &&
          document.expertSectionId === realSectionId &&
          document.draftFileKind === fileKind
      );
      if (!realDocument) continue;
      conversation.updateEditProposal(runId, proposal.id, {
        documentId: realDocument.id,
        title: realDocument.title,
        provisionalExpertSection: false,
        baseRevision: proposal.predecessorProposalId
          ? proposal.baseRevision
          : createShortWorkspaceContentRevision(realDocument.content),
        statusMessage:
          proposal.statusMessage ??
          "已关联到新创建的章节文件，接受后将写入正文。"
      });
      break;
    }
  }
}

function restoreAcceptedDraftSectionCreationMappings(
  conversation: AgentConversationController
): void {
  for (const message of conversation.messages.value) {
    for (const proposal of message.editProposals ?? []) {
      if (
        proposal.status !== "accepted" ||
        !proposal.draftSectionCreationTarget
      ) {
        continue;
      }
      const mapping = new Map<string, string>();
      for (const section of proposal.draftSectionCreationTarget.sections) {
        if (!section.realSectionId) continue;
        mapping.set(section.provisionalSectionId, section.realSectionId);
        rememberProvisionalExpertSectionMapping(
          proposal.runId,
          proposal.workspaceId,
          section.provisionalSectionId,
          section.realSectionId
        );
      }
      if (mapping.size === 0) continue;
      const acceptedDirectoryRevision =
        proposal.draftSectionCreationTarget.acceptedDirectoryRevision;
      if (acceptedDirectoryRevision) {
        rememberAcceptedDraftSectionCreation(
          proposal,
          acceptedDirectoryRevision
        );
      }
      remapProvisionalExpertSectionFileProposals(
        conversation,
        proposal.runId,
        proposal.workspaceId,
        mapping
      );
    }
  }
}

function pauseDependentProvisionalFileProposals(
  conversation: AgentConversationController,
  runId: string,
  provisionalSectionIds: readonly string[],
  message: string
): void {
  const provisionalSet = new Set(provisionalSectionIds);
  for (const proposal of conversation.listEditProposals(runId)) {
    if (!proposal.provisionalExpertSection) continue;
    const parsed = parseCatalogDraftDocumentId(proposal.documentId);
    if (
      !parsed ||
      !provisionalSet.has(parsed.sectionId) ||
      (proposal.status !== "pending" &&
        proposal.status !== "accepting" &&
        proposal.status !== "error")
    ) {
      continue;
    }
    removeQueuedAgentEdit(conversation, runId, proposal.id);
    conversation.updateEditProposal(runId, proposal.id, {
      status: "pending",
      statusMessage: message
    });
  }
}

function conflictDependentProvisionalFileProposals(
  conversation: AgentConversationController,
  runId: string,
  provisionalSectionIds: readonly string[],
  message: string
): void {
  const provisionalSet = new Set(provisionalSectionIds);
  for (const proposal of conversation.listEditProposals(runId)) {
    if (!proposal.provisionalExpertSection) continue;
    if (
      proposal.status !== "pending" &&
      proposal.status !== "accepting" &&
      proposal.status !== "error"
    ) {
      continue;
    }
    const matches = [...provisionalSet].some((sectionId) => {
      const bodyId = catalogDraftBodyDocumentId(sectionId);
      const stateId = catalogDraftCharacterStateDocumentId(sectionId);
      return proposal.documentId === bodyId || proposal.documentId === stateId;
    });
    if (!matches) continue;
    removeQueuedAgentEdit(conversation, runId, proposal.id);
    conversation.updateEditProposal(runId, proposal.id, {
      status: "conflict",
      statusMessage: message,
      proposedText: undefined
    });
  }
}

function autoApproveEditPriority(
  conversation: AgentConversationController,
  runId: string,
  proposalId: string
): number {
  const proposal = conversation.getEditProposal(runId, proposalId);
  if (!proposal) return 2;
  if (proposal.draftSectionCreationTarget) return 0;
  if (proposal.characterStructureTarget?.mutation.type === "createItem") return 0;
  if (
    proposal.longWorldbuildingTarget?.file.operation === "create"
  ) return 0;
  if (
    proposal.longCharacterTarget?.files.every(
      ({ operation }) => operation === "create"
    )
  ) return 0;
  if (proposal.longWorldbuildingTarget?.file.beforeRevision !== null) {
    return proposal.predecessorProposalId ? 1 : 2;
  }
  if (
    proposal.longCharacterTarget &&
    proposal.longCharacterTarget.files.some(
      ({ beforeRevision }) => beforeRevision !== null
    )
  ) {
    return proposal.predecessorProposalId ? 1 : 2;
  }
  if (proposal.longPlotDesignTarget) {
    return 2;
  }
  if (proposal.longDraftTarget) {
    return proposal.predecessorProposalId ? 1 : 2;
  }
  if (proposal.provisionalExpertSection) return 1;
  if (proposal.provisionalCharacterItemId) return 1;
  return 2;
}

function agentEditQueueKey(
  sessionId: string,
  runId: string,
  proposalId: string
): string {
  return `${sessionId}\u0000${runId}\u0000${proposalId}`;
}

function nextAgentEditDecisionToken(proposal: AgentEditProposal): string {
  agentEditDecisionSequence += 1;
  return `${proposal.runId}:${proposal.id}:${proposal.generation ?? 1}:${agentEditDecisionSequence}`;
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

function latestProposalForLane(
  conversation: AgentConversationController,
  runId: string,
  laneId: string
): AgentEditProposal | undefined {
  return latestAgentEditProposalInLane(
    conversation.listEditProposals(runId),
    laneId
  );
}

function expectedLaneDurableRevision(
  conversation: AgentConversationController,
  runId: string,
  existing: AgentEditProposal | undefined,
  currentText: string
): string {
  let cursor = existing;
  const seen = new Set<string>();
  while (
    cursor?.predecessorProposalId &&
    cursor.status !== "accepted" &&
    !seen.has(cursor.id)
  ) {
    seen.add(cursor.id);
    const predecessor = conversation.getEditProposal(
      runId,
      cursor.predecessorProposalId
    );
    if (!predecessor || predecessor.status === "accepted") break;
    cursor = predecessor;
  }
  return expectedMutationDurableRevision(cursor, currentText);
}

function laneDurableRevisionMatches(
  conversation: AgentConversationController,
  runId: string,
  existing: AgentEditProposal | undefined,
  currentText: string,
  currentRevision: string
): boolean {
  if (!existing) {
    return (
      currentRevision === createShortWorkspaceContentRevision(currentText)
    );
  }
  const compatible = new Set<string>();
  let cursor: AgentEditProposal | undefined = existing;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    compatible.add(cursor.baseRevision);
    if (
      cursor.status === "accepting" ||
      cursor.status === "accepted"
    ) {
      compatible.add(cursor.proposedRevision);
    }
    cursor = cursor.predecessorProposalId
      ? conversation.getEditProposal(runId, cursor.predecessorProposalId)
      : undefined;
  }
  compatible.add(
    expectedLaneDurableRevision(
      conversation,
      runId,
      existing,
      currentText
    )
  );
  return compatible.has(currentRevision);
}

function blockedAgentEditLaneMessage(
  proposal: AgentEditProposal | undefined
): string | undefined {
  if (proposal?.status === "rejected") {
    return "此前版本已被拒绝；为避免把被拒内容随后续全文重新带回，本次变更已阻断。";
  }
  if (proposal?.status === "conflict") {
    return "此前版本存在冲突，本次后续变更已阻断，未覆盖当前文稿。";
  }
  return undefined;
}

function isShortOrScriptAgentEdit(proposal: AgentEditProposal): boolean {
  if (proposal.libraryTarget) return false;
  const book = catalogBook(proposal.workspaceId);
  return book?.bookType === "short" || book?.bookType === "script";
}

function canReviewAgentEditDuringRun(proposal: AgentEditProposal): boolean {
  return (
    Boolean(proposal.libraryTarget) ||
    Boolean(proposal.longWorldbuildingTarget) ||
    Boolean(proposal.longCharacterTarget) ||
    Boolean(proposal.longPlotDesignTarget) ||
    Boolean(proposal.longDraftTarget) ||
    isShortOrScriptAgentEdit(proposal)
  );
}

function removeQueuedAgentEdit(
  conversation: AgentConversationController,
  runId: string,
  proposalId: string
): void {
  for (const [key, queued] of queuedAgentEdits) {
    if (
      queued.conversation === conversation &&
      queued.runId === runId &&
      queued.proposalId === proposalId
    ) {
      queuedAgentEdits.delete(key);
    }
  }
}

function blockLaterAgentEditGenerations(
  conversation: AgentConversationController,
  rejected: AgentEditProposal
): void {
  const laneId = rejected.laneId ?? rejected.id;
  const generation = rejected.generation ?? 1;
  for (const candidate of conversation.listEditProposals(rejected.runId)) {
    if (
      candidate.id === rejected.id ||
      (candidate.laneId ?? candidate.id) !== laneId ||
      (candidate.generation ?? 1) <= generation ||
      (candidate.status !== "pending" && candidate.status !== "error")
    ) {
      continue;
    }
    removeQueuedAgentEdit(
      conversation,
      candidate.runId,
      candidate.id
    );
    conversation.updateEditProposal(candidate.runId, candidate.id, {
      status: "conflict",
      proposedText: undefined,
      statusMessage:
        "此前正文版本已被拒绝；该版本继承了被拒内容，因此未写入本地文件。"
    });
  }
}

function queueAgentEdit(
  conversation: AgentConversationController,
  sessionId: string,
  runId: string,
  proposalId: string,
  automatic: boolean,
  scheduleImmediately: boolean
): void {
  const proposal = conversation.getEditProposal(runId, proposalId);
  if (
    !proposal ||
    (proposal.status !== "pending" && proposal.status !== "error")
  ) {
    return;
  }

  const key = agentEditQueueKey(sessionId, runId, proposalId);
  const existingQueued = queuedAgentEdits.get(key);
  if (
    existingQueued?.expectedProposedRevision === proposal.proposedRevision
  ) {
    if (scheduleImmediately) {
      scheduleQueuedAgentEdits(
        (queued) => queued === queuedAgentEdits.get(key)
      );
    }
    return;
  }
  const decisionToken = nextAgentEditDecisionToken(proposal);
  const staged = stageAgentEditProposalRevision(
    createAgentEditProposalRevisionLane<AgentEditProposal>({
      targetKey: proposal.laneId ?? proposal.id,
      durableRevision: proposal.baseRevision,
      overlayRevision: proposal.sourceBaseRevision ?? proposal.baseRevision,
      generation: Math.max(0, (proposal.generation ?? 1) - 1)
    }),
    {
      approvalMode:
        proposal.approvalMode ??
        (automatic ? "auto-approve" : "request-approval"),
      sourceBaseRevision:
        proposal.sourceBaseRevision ?? proposal.baseRevision,
      proposedRevision: proposal.proposedRevision,
      proposal
    }
  );
  if (staged.status !== "staged") {
    return;
  }
  const started = beginAgentEditProposalCommit(staged.lane, {
    generation: proposal.generation ?? 1,
    token: decisionToken
  });
  if (started.status !== "started") {
    return;
  }
  if (scheduleImmediately && !automatic) {
    conversation.updateEditProposal(runId, proposalId, {
      status: "accepting",
      decisionToken,
      statusMessage: automatic
        ? "已进入实时自动保存队列…"
        : "已批准，正在等待本作品的保存队列…"
    });
  }
  queuedAgentEdits.set(key, {
    conversation,
    sessionId,
    runId,
    proposalId,
    workspaceId: proposal.workspaceId,
    automatic,
    expectedProposedRevision: proposal.proposedRevision,
    decisionToken,
    snapshot: started.snapshot
  });
  if (scheduleImmediately) {
    scheduleQueuedAgentEdits((queued) => queued === queuedAgentEdits.get(key));
  }
}

async function acceptCharacterStructureProposal(
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
  ) return;
  const target = proposal.characterStructureTarget;
  const book = catalogBook(proposal.workspaceId);
  if (!target || !book || book.projectRevision === undefined || !window.deepwrite) {
    const message = "人物结构目标已不可用，无法应用本次变更。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }
  const hasAcceptedSameRunPredecessor = conversation
    .listEditProposals(request.runId)
    .some(
      (candidate) =>
        candidate.id !== proposal.id &&
        candidate.workspaceId === proposal.workspaceId &&
        candidate.status === "accepted" &&
        candidate.createdAt <= proposal.createdAt
    );
  if (
    target.baseProjectRevision !== undefined &&
    book.projectRevision !== target.baseProjectRevision &&
    !hasAcceptedSameRunPredecessor
  ) {
    const message = "人物结构版本已变化，未接受本次智能体修改。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }
  conversation.updateEditProposal(request.runId, request.proposalId, {
    status: "accepting",
    statusMessage: automatic ? "正在自动保存人物结构…" : "正在保存人物结构…"
  });
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  try {
    await window.deepwrite.catalog.mutateCharacterStructure({
      bookId: proposal.workspaceId,
      baseProjectRevision: book.projectRevision,
      mutation: target.mutation
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage: automatic
        ? "已自动批准并保存人物结构变更。"
        : "人物结构变更已保存到本地。"
    });
    if (!automatic) uiMessage.success("人物结构变更已保存");
  } catch (error) {
    await loadCatalogSnapshot();
    const message = error instanceof Error ? error.message : "人物结构变更保存失败。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: isCatalogConflict(error) ? "conflict" : "error",
      statusMessage: message
    });
    uiMessage.error(message);
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

function resumeRecoveredAutomaticAgentEdits(
  conversationsToScan: readonly AgentConversationController[] =
    allConversations()
): void {
  if (!catalogSnapshot.value) return;
  for (const conversation of conversationsToScan) {
    restoreAcceptedDraftSectionCreationMappings(conversation);
  }
  for (const conversation of conversationsToScan) {
    for (const message of conversation.messages.value) {
      for (const proposal of message.editProposals ?? []) {
        if (
          proposal.approvalMode !== "auto-approve" ||
          proposal.status !== "pending" ||
          !canReviewAgentEditDuringRun(proposal)
        ) {
          continue;
        }
        queueAgentEdit(
          conversation,
          conversation.sessionId.value,
          proposal.runId,
          proposal.id,
          true,
          true
        );
      }
    }
  }
}

function stageAgentEditProposal(event: WorkspaceEditorMutationEvent): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = allConversations().find((conversation) =>
    conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
  );
  if (!sourceConversation) return;
  const runApprovalMode =
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) ?? "request-approval";

  const mutationTarget = event.payload.mutationTarget;
  if (mutationTarget?.kind === "character-structure") {
    const book = catalogBook(event.payload.workspaceId);
    if (!book || book.characterStructure.format !== "list") {
      const message = "人物结构已变化，本次条目操作未进入审阅。";
      sourceConversation.markToolConflict(event.payload.runId, event.payload.toolCallId, message);
      uiMessage.warning(message);
      return;
    }
    const source = mutationTarget.mutation;
    const mutation: CharacterStructureMutation =
      source.type === "createItem"
        ? { type: "createItem", title: source.title, itemId: source.provisionalItemId }
        : source.type === "updateItem"
          ? { type: "updateItem", itemId: source.itemId, title: source.title }
          : source.type === "moveItem"
            ? { type: "moveItem", itemId: source.itemId, direction: source.direction }
            : { type: "deleteItem", itemId: source.itemId };
    const documentId = `character-structure:${event.payload.toolCallId}`;
    const proposalId = agentEditProposalId(
      event.payload.runId,
      event.payload.workspaceId,
      "character_design",
      documentId
    );
    if (sourceConversation.getEditProposal(event.payload.runId, proposalId)) return;
    const beforeText =
      source.type === "deleteItem"
        ? source.deletedText
        : source.type === "updateItem"
          ? source.previousTitle
          : "";
    const afterText =
      source.type === "deleteItem"
        ? ""
        : source.type === "updateItem"
          ? source.title
          : source.type === "createItem"
            ? source.title
            : event.payload.text;
    const diff = buildAgentTextDiff(beforeText, afterText);
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId: proposalId,
      generation: 1,
      approvalMode: runApprovalMode,
      sourceBaseRevision: event.payload.baseRevision,
      runId: event.payload.runId,
      workspaceId: event.payload.workspaceId,
      stageId: "character_design",
      documentId,
      title:
        source.type === "createItem"
          ? `创建人物条目：${source.title}`
          : source.type === "updateItem"
            ? `修改人物名称：${source.previousTitle} → ${source.title}`
            : source.type === "moveItem"
              ? `${source.direction === "up" ? "上移" : "下移"}人物条目：${source.title}`
              : `删除人物条目：${source.title}`,
      summary: event.payload.summary,
      status: "pending",
      baseRevision: event.payload.baseRevision,
      proposedRevision: createShortWorkspaceContentRevision(afterText),
      proposedText: afterText,
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      characterStructureTarget: {
        mutation,
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
    return;
  }
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
    if (!directory || !book || currentRevision !== expectedDirectoryRevision) {
      const message =
        "正文目录版本已变化，本次章节创建未进入审阅，也没有改动现有文件。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
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
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

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
        sections: mutationTarget.sections.map((section) => ({ ...section })),
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
    return;
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
      return;
    }
    if (section.title !== mutationTarget.previousTitle) {
      const message =
        `章节「${mutationTarget.previousTitle}」的当前标题已变化，本次改名未进入审阅。`;
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
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
      return;
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
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

    const proposedText = event.payload.text;
    const diff = buildAgentTextDiff(mutationTarget.previousTitle, mutationTarget.title);
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
    return;
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
      return;
    }
    if (section.title !== mutationTarget.title) {
      const message =
        `章节「${mutationTarget.title}」的当前标题已变化，本次删除未进入审阅。`;
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    if (directory.sections.length <= 1) {
      const message = "正文至少需要保留一个章节，本次删除未进入审阅。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
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
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

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
    return;
  }

  const expectedDraftFileKind =
    mutationTarget?.kind === "expert-draft-file" && mutationTarget.fileKind === "characterState"
      ? "character-state"
      : mutationTarget?.kind === "expert-draft-file"
        ? mutationTarget.fileKind
        : undefined;
  const target = liveWorkspaceDocuments.value.find((document) =>
    mutationTarget?.kind === "character-file"
      ? document.catalogDocumentId === mutationTarget.documentId &&
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === "character_design"
      : mutationTarget?.kind === "expert-draft-file"
      ? document.id === mutationTarget.documentId &&
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === "draft" &&
        document.expertSectionId === mutationTarget.sectionId &&
        document.draftFileKind === expectedDraftFileKind
      : document.workspaceId === event.payload.workspaceId &&
        document.stageId === event.payload.stageId &&
        document.draftFileKind === undefined
  );
  if (
    (!target || target.readOnly) &&
    mutationTarget?.kind === "expert-draft-file" &&
    isProvisionalExpertDraftSectionId(mutationTarget.sectionId)
  ) {
    const creation = findPendingDraftSectionCreationForProvisional(
      sourceConversation,
      event.payload.runId,
      mutationTarget.sectionId
    );
    const realSectionId = resolveProvisionalExpertSectionId(
      event.payload.runId,
      event.payload.workspaceId,
      mutationTarget.sectionId
    );
    const stagingMode = resolveProvisionalWriteStagingMode({
      hasPendingCreation: Boolean(creation),
      provisionalSectionId: mutationTarget.sectionId,
      resolvedSectionId: realSectionId
    });

    // Mid-run accept already landed the chapter: keep staging on the same
    // provisional-keyed proposal id, but validate/write against the real file.
    if (stagingMode === "mapped-real") {
      const realTarget = liveWorkspaceDocuments.value.find(
        (document) =>
          document.workspaceId === event.payload.workspaceId &&
          document.stageId === "draft" &&
          document.expertSectionId === realSectionId &&
          document.draftFileKind === expectedDraftFileKind
      );
      if (!realTarget || realTarget.readOnly) {
        const message =
          "目标章节尚未创建或已失效，本次智能体变更未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }

      const laneId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        event.payload.stageId,
        mutationTarget.documentId
      );
      const existing = latestProposalForLane(
        sourceConversation,
        event.payload.runId,
        laneId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
        return;
      }
      const blockedMessage = blockedAgentEditLaneMessage(existing);
      if (blockedMessage) {
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          blockedMessage
        );
        return;
      }
      const currentRevision = createShortWorkspaceContentRevision(realTarget.content);
      const expectedBaseRevision = expectedMutationBaseRevision(
        existing,
        realTarget.content
      );
      if (
        event.payload.baseRevision !== expectedBaseRevision ||
        !laneDurableRevisionMatches(
          sourceConversation,
          event.payload.runId,
          existing,
          realTarget.content,
          currentRevision
        )
      ) {
        const message =
          "文稿版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。";
        if (
          existing &&
          (existing.status === "pending" || existing.status === "error")
        ) {
          sourceConversation.updateEditProposal(event.payload.runId, existing.id, {
            status: "conflict",
            statusMessage: message,
            updatedAt: event.timestamp
          });
        }
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }

      const resolvedMutation = resolveAgentEditorMutationText(
        existing?.proposedText !== undefined
          ? existing.proposedText
          : realTarget.content,
        event.payload
      );
      if ("error" in resolvedMutation) {
        if (existing) {
          sourceConversation.updateEditProposal(event.payload.runId, existing.id, {
            status: "conflict",
            statusMessage: resolvedMutation.error,
            updatedAt: event.timestamp
          });
        }
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          resolvedMutation.error
        );
        uiMessage.warning(resolvedMutation.error);
        return;
      }
      const proposedText = resolvedMutation.text;
      const proposedRevision = createShortWorkspaceContentRevision(proposedText);
      const diff = buildAgentTextDiff(realTarget.content, proposedText);
      const identity = resolveAgentEditProposalGeneration(laneId, existing);
      const applyBaseRevision = identity.coalescesExisting
        ? existing!.baseRevision
        : existing?.proposedRevision ?? event.payload.baseRevision;
      const noChanges =
        proposedRevision === currentRevision &&
        (!existing || existing.status === "accepted" || identity.coalescesExisting);
      const proposal: AgentEditProposal = {
        id: identity.id,
        laneId,
        generation: identity.generation,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        ...(identity.predecessorProposalId
          ? { predecessorProposalId: identity.predecessorProposalId }
          : {}),
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: event.payload.stageId,
        documentId: realTarget.id,
        title: realTarget.title,
        summary: event.payload.summary,
        status: noChanges ? "accepted" : "pending",
        baseRevision: applyBaseRevision,
        proposedRevision,
        ...(noChanges ? {} : { proposedText }),
        toolCallIds: [
          ...new Set([
            ...(identity.coalescesExisting ? existing?.toolCallIds ?? [] : []),
            event.payload.toolCallId
          ])
        ],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        ...(noChanges
          ? { statusMessage: "文本没有实际变化，无需保存。" }
          : {}),
        createdAt:
          identity.coalescesExisting && existing
            ? existing.createdAt
            : event.timestamp,
        updatedAt: event.timestamp,
        provisionalExpertSection: false
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (!noChanges && runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposal.id,
          true,
          true
        );
      }
      return;
    }

    if (stagingMode === "unavailable" || !creation) {
      const message =
        "目标章节尚未创建或已失效，本次智能体变更未进入审阅。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const laneId = agentEditProposalId(
      event.payload.runId,
      event.payload.workspaceId,
      event.payload.stageId,
      mutationTarget.documentId
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
      return;
    }
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const baseText = existing?.proposedText ?? "";
    const expectedBaseRevision = expectedMutationBaseRevision(existing, baseText);
    if (event.payload.baseRevision !== expectedBaseRevision) {
      const message =
        "待创建章节的文稿版本已变化，本次智能体变更未进入审阅。";
      if (
        existing &&
        (existing.status === "pending" || existing.status === "error")
      ) {
        sourceConversation.updateEditProposal(event.payload.runId, existing.id, {
          status: "conflict",
          statusMessage: message,
          updatedAt: event.timestamp
        });
      }
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const resolvedMutation = resolveAgentEditorMutationText(baseText, event.payload);
    if ("error" in resolvedMutation) {
      if (existing) {
        sourceConversation.updateEditProposal(event.payload.runId, existing.id, {
          status: "conflict",
          statusMessage: resolvedMutation.error,
          updatedAt: event.timestamp
        });
      }
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        resolvedMutation.error
      );
      uiMessage.warning(resolvedMutation.error);
      return;
    }
    const proposedText = resolvedMutation.text;
    const proposedRevision = createShortWorkspaceContentRevision(proposedText);
    const diff = buildAgentTextDiff(baseText, proposedText);
    const identity = resolveAgentEditProposalGeneration(laneId, existing);
    const applyBaseRevision = identity.coalescesExisting
      ? existing!.baseRevision
      : existing?.proposedRevision ?? event.payload.baseRevision;
    const noChanges =
      proposedRevision === createShortWorkspaceContentRevision("") &&
      (!existing || existing.status === "accepted" || identity.coalescesExisting);
    const sectionTitle =
      creation.draftSectionCreationTarget?.sections.find(
        (section) => section.provisionalSectionId === mutationTarget.sectionId
      )?.title ?? "新章节";
    const title =
      mutationTarget.fileKind === "characterState"
        ? `${sectionTitle} · 人物状态`
        : sectionTitle;
    const proposal: AgentEditProposal = {
      id: identity.id,
      laneId,
      generation: identity.generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: event.payload.baseRevision,
      ...(identity.predecessorProposalId
        ? { predecessorProposalId: identity.predecessorProposalId }
        : {}),
      runId: event.payload.runId,
      workspaceId: event.payload.workspaceId,
      stageId: event.payload.stageId,
      documentId: mutationTarget.documentId,
      title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: applyBaseRevision,
      proposedRevision,
      ...(noChanges ? {} : { proposedText }),
      toolCallIds: [
        ...new Set([
          ...(identity.coalescesExisting ? existing?.toolCallIds ?? [] : []),
          event.payload.toolCallId
        ])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
      createdAt:
        identity.coalescesExisting && existing
          ? existing.createdAt
          : event.timestamp,
      updatedAt: event.timestamp,
      provisionalExpertSection: true
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
    return;
  }

  if (
    (!target || target.readOnly) &&
    mutationTarget?.kind === "character-file" &&
    mutationTarget.itemId
  ) {
    const creation = findPendingCharacterCreationForProvisional(
      sourceConversation,
      event.payload.runId,
      mutationTarget.itemId
    );
    const creationMutation = creation?.characterStructureTarget?.mutation;
    if (!creation || creationMutation?.type !== "createItem") {
      const message = "目标人物条目尚未创建或已失效，本次智能体变更未进入审阅。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const futureDocumentId = [
      "catalog",
      "book-document",
      encodeURIComponent(event.payload.workspaceId),
      encodeURIComponent(mutationTarget.itemId)
    ].join(":");
    const laneId = agentEditProposalId(
      event.payload.runId,
      event.payload.workspaceId,
      event.payload.stageId,
      futureDocumentId
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const baseText = existing?.proposedText ?? "";
    if (
      event.payload.baseRevision !==
      expectedMutationBaseRevision(existing, baseText)
    ) {
      const message = "待创建人物条目的文稿版本已变化，本次智能体变更未进入审阅。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const resolvedMutation = resolveAgentEditorMutationText(
      baseText,
      event.payload
    );
    if ("error" in resolvedMutation) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        resolvedMutation.error
      );
      uiMessage.warning(resolvedMutation.error);
      return;
    }
    const proposedText = resolvedMutation.text;
    const proposedRevision = createShortWorkspaceContentRevision(proposedText);
    const diff = buildAgentTextDiff(baseText, proposedText);
    const identity = resolveAgentEditProposalGeneration(laneId, existing);
    const proposal: AgentEditProposal = {
      id: identity.id,
      laneId,
      generation: identity.generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: event.payload.baseRevision,
      ...(identity.predecessorProposalId
        ? { predecessorProposalId: identity.predecessorProposalId }
        : {}),
      runId: event.payload.runId,
      workspaceId: event.payload.workspaceId,
      stageId: event.payload.stageId,
      documentId: futureDocumentId,
      title: creationMutation.title,
      summary: event.payload.summary,
      status: "pending",
      baseRevision: identity.coalescesExisting
        ? existing!.baseRevision
        : existing?.proposedRevision ?? event.payload.baseRevision,
      proposedRevision,
      proposedText,
      toolCallIds: [
        ...new Set([
          ...(identity.coalescesExisting ? existing?.toolCallIds ?? [] : []),
          event.payload.toolCallId
        ])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      createdAt:
        identity.coalescesExisting && existing
          ? existing.createdAt
          : event.timestamp,
      updatedAt: event.timestamp,
      provisionalCharacterItemId: mutationTarget.itemId
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
    return;
  }

  if (!target || target.readOnly) {
    const message = "目标文稿不可写，本次智能体变更未进入审阅。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const laneId = agentEditProposalId(
    event.payload.runId,
    event.payload.workspaceId,
    event.payload.stageId,
    target.id
  );
  const existing = latestProposalForLane(
    sourceConversation,
    event.payload.runId,
    laneId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
    return;
  }
  const blockedMessage = blockedAgentEditLaneMessage(existing);
  if (blockedMessage) {
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      blockedMessage
    );
    return;
  }
  const currentRevision = createShortWorkspaceContentRevision(target.content);
  const expectedBaseRevision = expectedMutationBaseRevision(
    existing,
    target.content
  );
  if (
    event.payload.baseRevision !== expectedBaseRevision ||
    !laneDurableRevisionMatches(
      sourceConversation,
      event.payload.runId,
      existing,
      target.content,
      currentRevision
    )
  ) {
    const message =
      "文稿版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。";
    if (
      existing &&
      (existing.status === "pending" || existing.status === "error")
    ) {
      sourceConversation.updateEditProposal(event.payload.runId, existing.id, {
        status: "conflict",
        statusMessage: message,
        updatedAt: event.timestamp
      });
    }
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const resolvedMutation = resolveAgentEditorMutationText(
    event.payload.mutationTarget && existing?.proposedText !== undefined
      ? existing.proposedText
      : target.content,
    event.payload
  );
  if ("error" in resolvedMutation) {
    if (
      existing &&
      (existing.status === "pending" || existing.status === "error")
    ) {
      sourceConversation.updateEditProposal(event.payload.runId, existing.id, {
        status: "conflict",
        statusMessage: resolvedMutation.error,
        updatedAt: event.timestamp
      });
    }
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      resolvedMutation.error
    );
    uiMessage.warning(resolvedMutation.error);
    return;
  }
  const proposedText = resolvedMutation.text;
  const proposedRevision = createShortWorkspaceContentRevision(proposedText);

  const diff = buildAgentTextDiff(target.content, proposedText);
  const identity = resolveAgentEditProposalGeneration(laneId, existing);
  const applyBaseRevision = identity.coalescesExisting
    ? existing!.baseRevision
    : existing?.proposedRevision ?? event.payload.baseRevision;
  const noChanges =
    proposedRevision === currentRevision &&
    (!existing || existing.status === "accepted" || identity.coalescesExisting);
  const proposal: AgentEditProposal = {
    id: identity.id,
    laneId,
    generation: identity.generation,
    approvalMode: runApprovalMode,
    sourceBaseRevision: event.payload.baseRevision,
    ...(identity.predecessorProposalId
      ? { predecessorProposalId: identity.predecessorProposalId }
      : {}),
    runId: event.payload.runId,
    workspaceId: event.payload.workspaceId,
    stageId: event.payload.stageId,
    documentId: target.id,
    title: target.title,
    summary: event.payload.summary,
    status: noChanges ? "accepted" : "pending",
    baseRevision: applyBaseRevision,
    proposedRevision,
    ...(noChanges ? {} : { proposedText }),
    toolCallIds: [
      ...new Set([
        ...(identity.coalescesExisting ? existing?.toolCallIds ?? [] : []),
        event.payload.toolCallId
      ])
    ],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
    createdAt:
      identity.coalescesExisting && existing
        ? existing.createdAt
        : event.timestamp,
    updatedAt: event.timestamp
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (!noChanges && runApprovalMode === "auto-approve") {
    queueAgentEdit(
      sourceConversation,
      event.payload.sessionId,
      event.payload.runId,
      proposal.id,
      true,
      true
    );
  }
}

function longWorldbuildingBatchForFile(
  event: LongWorldbuildingFileMutationEvent
): LongWorkspaceOperationBatch | undefined {
  const file = event.payload.files[0];
  if (!file || event.payload.files.length !== 1) return undefined;
  const operations = event.payload.batch.operations.filter(
    (operation) =>
      file.operation === "create" &&
      operation.type === "worldbuildingItem.create" &&
      operation.categoryId === file.categoryId &&
      operation.item.id === file.itemId &&
      operation.item.file.id === file.fileId
  );
  const documentWrites = event.payload.batch.documentWrites.filter(
    (write) =>
      file.operation !== "create" && write.fileId === file.fileId
  );
  if (
    (file.operation === "create" &&
      (operations.length !== 1 || documentWrites.length !== 0)) ||
    (file.operation !== "create" &&
      (operations.length !== 0 || documentWrites.length !== 1))
  ) {
    return undefined;
  }
  return LongWorkspaceOperationBatchSchema.parse({
    ...event.payload.batch,
    operations,
    documentWrites
  });
}

function longPlotDesignProposalText(
  batch: LongWorkspaceOperationBatch
): string {
  return JSON.stringify(
    {
      structureOperations: batch.operations,
      documentWrites: batch.documentWrites
    },
    null,
    2
  );
}

function stageLongPlotDesignEditProposal(
  event: LongPlotDesignMutationEvent
): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = longConversationForProposalEvent(event);
  if (!sourceConversation) return;
  const runApprovalMode =
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) ?? "request-approval";
  const workspaceId = `long:${event.payload.bookId}`;
  const laneId = agentEditProposalId(
    event.payload.runId,
    workspaceId,
    "long-plot-design",
    "plot-design"
  );
  const existing = latestProposalForLane(
    sourceConversation,
    event.payload.runId,
    laneId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
  const blockedMessage = blockedAgentEditLaneMessage(existing);
  if (blockedMessage) {
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      blockedMessage
    );
    return;
  }
  const generation = existing ? (existing.generation ?? 1) + 1 : 1;
  const proposalId = agentEditProposalGenerationId(laneId, generation);
  const sourceRevision = `long-plot:${event.payload.baseProjectRevision}:${event.payload.batch.baseRevision}`;
  const proposedRevision = `${sourceRevision}:${event.payload.toolCallId}`;
  const proposalText = longPlotDesignProposalText(event.payload.batch);
  const diff = buildAgentTextDiff("", proposalText);
  const proposal: AgentEditProposal = {
    id: proposalId,
    laneId,
    generation,
    approvalMode: runApprovalMode,
    sourceBaseRevision: sourceRevision,
    ...(existing ? { predecessorProposalId: existing.id } : {}),
    runId: event.payload.runId,
    workspaceId,
    stageId: "long-plot-design",
    documentId: "plot-design",
    title: "剧情设计变更",
    summary: event.payload.summary,
    status: "pending",
    baseRevision: sourceRevision,
    proposedRevision,
    proposedText: proposalText,
    toolCallIds: [event.payload.toolCallId],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    longPlotDesignTarget: {
      bookId: event.payload.bookId,
      batch: LongWorkspaceOperationBatchSchema.parse(event.payload.batch),
      baseProjectRevision: event.payload.baseProjectRevision
    }
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (runApprovalMode === "auto-approve") {
    queueAgentEdit(
      sourceConversation,
      event.payload.sessionId,
      event.payload.runId,
      proposal.id,
      true,
      true
    );
  }
}

function stageLongWorldbuildingEditProposal(
  event: LongWorldbuildingFileMutationEvent
): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = longConversationForProposalEvent(event);
  if (!sourceConversation) return;
  const file = event.payload.files[0];
  const batch = longWorldbuildingBatchForFile(event);
  if (!file || !batch) {
    const message =
      "世界观文件工具必须一次只形成一个独立文件变更，本次结果未进入审批。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }
  const runApprovalMode =
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) ?? "request-approval";
  const workspaceId = `long:${event.payload.bookId}`;
  const laneDocumentId =
    file.operation === "create"
      ? `create:${file.fileId}`
      : file.fileId;
  const laneId = agentEditProposalId(
    event.payload.runId,
    workspaceId,
    "long-worldbuilding",
    laneDocumentId
  );
  const existing = latestProposalForLane(
    sourceConversation,
    event.payload.runId,
    laneId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
  const blockedMessage = blockedAgentEditLaneMessage(existing);
  if (blockedMessage) {
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      blockedMessage
    );
    return;
  }
  if (
    existing &&
    file.beforeRevision !== existing.proposedRevision
  ) {
    const message =
      "世界观文件的待审批版本链已经变化，本次变更未进入审批。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }
  const creationPredecessor =
    file.operation === "create"
      ? undefined
      : sourceConversation
          .listEditProposals(event.payload.runId)
          .find(
            (proposal) =>
              proposal.longWorldbuildingTarget?.file.fileId ===
                file.fileId &&
              proposal.longWorldbuildingTarget.file.operation ===
                "create" &&
              proposal.longWorldbuildingTarget.file.nextRevision ===
                file.beforeRevision &&
              proposal.status !== "rejected" &&
              proposal.status !== "conflict"
          );
  const generation = existing
    ? (existing.generation ?? 1) + 1
    : 1;
  const proposalId = agentEditProposalGenerationId(laneId, generation);
  const predecessorProposalId =
    existing?.id ?? creationPredecessor?.id;
  const beforeRevision =
    file.beforeRevision ?? `long-missing:${file.fileId}`;
  const diff = buildAgentTextDiff(file.beforeText, file.afterText);
  const noChanges =
    file.operation !== "create" &&
    file.beforeText === file.afterText;
  const proposal: AgentEditProposal = {
    id: proposalId,
    laneId,
    generation,
    approvalMode: runApprovalMode,
    sourceBaseRevision: beforeRevision,
    ...(predecessorProposalId ? { predecessorProposalId } : {}),
    runId: event.payload.runId,
    workspaceId,
    stageId: "long-worldbuilding",
    documentId: file.fileId,
    title: file.title,
    summary: event.payload.summary,
    status: noChanges ? "accepted" : "pending",
    baseRevision: beforeRevision,
    proposedRevision: file.nextRevision,
    ...(noChanges ? {} : { proposedText: file.afterText }),
    toolCallIds: [event.payload.toolCallId],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    ...(noChanges
      ? { statusMessage: "文本没有实际变化，无需保存。" }
      : {}),
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    longWorldbuildingTarget: {
      bookId: event.payload.bookId,
      batch,
      baseProjectRevision: event.payload.baseProjectRevision,
      file
    }
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (!noChanges && runApprovalMode === "auto-approve") {
    queueAgentEdit(
      sourceConversation,
      event.payload.sessionId,
      event.payload.runId,
      proposal.id,
      true,
      true
    );
  }
}

function longCharacterBatchForFiles(
  event: LongCharacterFileMutationEvent
): LongWorkspaceOperationBatch | undefined {
  const files = event.payload.files;
  if (!files.length) return undefined;
  const isCreation = files.every(({ operation }) => operation === "create");
  if (isCreation) {
    const characterIds = new Set(files.map(({ characterId }) => characterId));
    const documents = new Set(files.map(({ document }) => document));
    const operation = event.payload.batch.operations.find(
      (candidate) => candidate.type === "character.create"
    );
    if (
      characterIds.size !== 1 ||
      documents.size !== 4 ||
      files.length !== 4 ||
      event.payload.batch.operations.length !== 1 ||
      event.payload.batch.documentWrites.length !== 0 ||
      !operation ||
      operation.character.id !== files[0]?.characterId ||
      !files.every((file) => {
        const operationFiles = operation.files;
        switch (file.document) {
          case "core_profile":
            return operationFiles.coreProfile.id === file.fileId;
          case "relationships":
            return operationFiles.relationships.id === file.fileId;
          case "current_state":
            return operationFiles.currentState.id === file.fileId;
          case "history":
            return operationFiles.history.id === file.fileId;
          case "overview":
            return false;
        }
      })
    ) {
      return undefined;
    }
    return LongWorkspaceOperationBatchSchema.parse(event.payload.batch);
  }
  const file = files[0];
  if (
    files.length !== 1 ||
    !file ||
    file.operation === "create" ||
    event.payload.batch.operations.length !== 0
  ) {
    return undefined;
  }
  const documentWrites = event.payload.batch.documentWrites.filter(
    (write) => write.fileId === file.fileId
  );
  if (
    documentWrites.length !== 1 ||
    event.payload.batch.documentWrites.length !== 1
  ) {
    return undefined;
  }
  return LongWorkspaceOperationBatchSchema.parse({
    ...event.payload.batch,
    operations: [],
    documentWrites
  });
}

function stageLongCharacterEditProposal(
  event: LongCharacterFileMutationEvent
): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = longConversationForProposalEvent(event);
  if (!sourceConversation) return;
  const files = event.payload.files;
  const batch = longCharacterBatchForFiles(event);
  if (!files.length || !batch) {
    const message =
      "人物文件工具必须形成一名人物的完整创建变更，或一次只修改一份人物档案；本次结果未进入审批。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }
  const isCreation = files.every(({ operation }) => operation === "create");
  const primaryFile = files[0]!;
  const runApprovalMode =
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) ?? "request-approval";
  const workspaceId = `long:${event.payload.bookId}`;
  const laneDocumentId = isCreation
    ? `create:${primaryFile.characterId}`
    : primaryFile.fileId;
  const laneId = agentEditProposalId(
    event.payload.runId,
    workspaceId,
    "long-character",
    laneDocumentId
  );
  const existing = latestProposalForLane(
    sourceConversation,
    event.payload.runId,
    laneId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
  const blockedMessage = blockedAgentEditLaneMessage(existing);
  if (blockedMessage) {
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      blockedMessage
    );
    return;
  }
  if (
    !isCreation &&
    existing &&
    primaryFile.beforeRevision !== existing.proposedRevision
  ) {
    const message =
      "人物档案的待审批版本链已经变化，本次变更未进入审批。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }
  const creationPredecessor = isCreation
    ? undefined
    : sourceConversation
        .listEditProposals(event.payload.runId)
        .find(
          (proposal) =>
            proposal.longCharacterTarget?.files.some(
              (file) =>
                file.fileId === primaryFile.fileId &&
                file.operation === "create" &&
                file.nextRevision === primaryFile.beforeRevision
            ) &&
            proposal.status !== "rejected" &&
            proposal.status !== "conflict"
        );
  const generation = existing
    ? (existing.generation ?? 1) + 1
    : 1;
  const proposalId = agentEditProposalGenerationId(laneId, generation);
  const predecessorProposalId = existing?.id ?? creationPredecessor?.id;
  const beforeRevision = isCreation
    ? `long-missing:${primaryFile.characterId}`
    : primaryFile.beforeRevision ?? `long-missing:${primaryFile.fileId}`;
  const proposedRevision = isCreation
    ? `long-character-create:${files.map(({ nextRevision }) => nextRevision).join(":")}`
    : primaryFile.nextRevision;
  const diff = buildAgentTextDiff(
    isCreation ? "" : primaryFile.beforeText,
    isCreation ? "" : primaryFile.afterText
  );
  const noChanges =
    !isCreation && primaryFile.beforeText === primaryFile.afterText;
  const proposal: AgentEditProposal = {
    id: proposalId,
    laneId,
    generation,
    approvalMode: runApprovalMode,
    sourceBaseRevision: beforeRevision,
    ...(predecessorProposalId ? { predecessorProposalId } : {}),
    runId: event.payload.runId,
    workspaceId,
    stageId: "long-character",
    documentId: laneDocumentId,
    title: isCreation
      ? `${primaryFile.characterName} / 新建人物`
      : primaryFile.title,
    summary: event.payload.summary,
    status: noChanges ? "accepted" : "pending",
    baseRevision: beforeRevision,
    proposedRevision,
    ...(!noChanges && !isCreation
      ? { proposedText: primaryFile.afterText }
      : {}),
    toolCallIds: [event.payload.toolCallId],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    ...(noChanges
      ? { statusMessage: "文本没有实际变化，无需保存。" }
      : {}),
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    longCharacterTarget: {
      bookId: event.payload.bookId,
      batch,
      baseProjectRevision: event.payload.baseProjectRevision,
      files
    }
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (!noChanges && runApprovalMode === "auto-approve") {
    queueAgentEdit(
      sourceConversation,
      event.payload.sessionId,
      event.payload.runId,
      proposal.id,
      true,
      true
    );
  }
}

function stageLongDraftEditProposal(event: LongDraftMutationEvent): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = longConversationForProposalEvent(event);
  if (!sourceConversation) return;
  const file = event.payload.file;
  const runApprovalMode =
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) ?? "request-approval";
  const workspaceId = `long:${event.payload.bookId}`;
  const laneId = agentEditProposalId(
    event.payload.runId,
    workspaceId,
    "long-draft",
    file.fileId
  );
  const existing = latestProposalForLane(
    sourceConversation,
    event.payload.runId,
    laneId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
  const blockedMessage = blockedAgentEditLaneMessage(existing);
  if (blockedMessage) {
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      blockedMessage
    );
    return;
  }
  if (existing && file.beforeRevision !== existing.proposedRevision) {
    const message = "章节正文的待审批版本链已经变化，本次变更未进入审批。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }
  const generation = existing ? (existing.generation ?? 1) + 1 : 1;
  const proposalId = agentEditProposalGenerationId(laneId, generation);
  const diff = buildAgentTextDiff(file.beforeText, file.afterText);
  const noChanges = file.beforeText === file.afterText;
  const proposal: AgentEditProposal = {
    id: proposalId,
    laneId,
    generation,
    approvalMode: runApprovalMode,
    sourceBaseRevision: file.beforeRevision,
    ...(existing ? { predecessorProposalId: existing.id } : {}),
    runId: event.payload.runId,
    workspaceId,
    stageId: "long-draft",
    documentId: file.fileId,
    title: `${file.chapterTitle} / 正文`,
    summary: event.payload.summary,
    status: noChanges ? "accepted" : "pending",
    baseRevision: file.beforeRevision,
    proposedRevision: file.nextRevision,
    ...(noChanges ? {} : { proposedText: file.afterText }),
    toolCallIds: [event.payload.toolCallId],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    ...(noChanges ? { statusMessage: "正文没有实际变化，无需保存。" } : {}),
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    longDraftTarget: {
      bookId: event.payload.bookId,
      batch: event.payload.batch,
      baseProjectRevision: event.payload.baseProjectRevision,
      file
    }
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (!noChanges && runApprovalMode === "auto-approve") {
    queueAgentEdit(
      sourceConversation,
      event.payload.sessionId,
      event.payload.runId,
      proposal.id,
      true,
      true
    );
  }
}

function stageLibraryEditProposal(event: LibraryEditorMutationEvent): void {
  if (!rememberWorkspaceMutationEvent(event.id)) return;
  const sourceConversation = allConversations().find((conversation) =>
    conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
  );
  if (!sourceConversation) return;
  const runApprovalMode =
    sourceConversation.approvalModeForRun(
      event.payload.sessionId,
      event.payload.runId
    ) ?? "request-approval";

  const library = findCatalogLibrary(
    event.payload.domain,
    event.payload.libraryId
  );
  const libraryReadOnly =
    !library ||
    (event.payload.domain === "skill" &&
      "isBuiltin" in library &&
      library.isBuiltin);
  let target: WorkspaceDocument | undefined;
  if (event.payload.operation === "edit") {
    const editPayload = event.payload;
    target = liveWorkspaceDocuments.value.find(
      (document) =>
        document.id === editPayload.documentId &&
        document.domain === editPayload.domain &&
        document.libraryId === editPayload.libraryId &&
        document.catalogEntryId === editPayload.entryId
    );
  }
  if (
    libraryReadOnly ||
    (event.payload.operation === "edit" && (!target || target.readOnly))
  ) {
    const message = "目标资料库或条目不可写，本次智能体变更未进入审阅。";
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const scopeId = `library:${event.payload.domain}:${event.payload.libraryId}`;
  const documentId =
    event.payload.operation === "edit"
      ? event.payload.documentId
      : `library-create:${event.payload.toolCallId}`;
  const proposalId = agentEditProposalId(
    event.payload.runId,
    scopeId,
    "library",
    documentId
  );
  const existing = sourceConversation.getEditProposal(
    event.payload.runId,
    proposalId
  );
  if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

  const currentText = target?.content ?? "";
  const currentRevision = createShortWorkspaceContentRevision(currentText);
  const expectedBaseRevision = expectedMutationBaseRevision(
    existing,
    currentText
  );
  if (
    event.payload.baseRevision !== expectedBaseRevision ||
    (existing !== undefined && currentRevision !== existing.baseRevision)
  ) {
    const message =
      "资料库条目版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。";
    if (existing) {
      sourceConversation.updateEditProposal(event.payload.runId, proposalId, {
        status: "conflict",
        statusMessage: message,
        updatedAt: event.timestamp
      });
    }
    sourceConversation.markToolConflict(
      event.payload.runId,
      event.payload.toolCallId,
      message
    );
    uiMessage.warning(message);
    return;
  }

  const proposedText = event.payload.text;
  const proposedRevision = createShortWorkspaceContentRevision(proposedText);
  const diff = buildAgentTextDiff(currentText, proposedText);
  const noChanges =
    event.payload.operation === "edit" &&
    proposedRevision === (existing?.baseRevision ?? currentRevision) &&
    event.payload.title === target?.title;
  const proposal: AgentEditProposal = {
    id: proposalId,
    approvalMode: runApprovalMode,
    runId: event.payload.runId,
    workspaceId: scopeId,
    stageId: "library",
    documentId,
    title: event.payload.title,
    summary: event.payload.summary,
    status: noChanges ? "accepted" : "pending",
    baseRevision: existing?.baseRevision ?? event.payload.baseRevision,
    proposedRevision,
    ...(noChanges ? {} : { proposedText }),
    toolCallIds: [
      ...new Set([...(existing?.toolCallIds ?? []), event.payload.toolCallId])
    ],
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    ...(diff.truncated ? { truncated: true } : {}),
    ...(noChanges ? { statusMessage: "条目没有实际变化，无需保存。" } : {}),
    createdAt: existing?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
    libraryTarget: {
      operation: event.payload.operation,
      domain: event.payload.domain,
      libraryId: event.payload.libraryId,
      stageId: event.payload.stageId,
      ...(event.payload.baseProjectRevision === undefined
        ? {}
        : { baseProjectRevision: event.payload.baseProjectRevision }),
      ...(event.payload.operation === "edit"
        ? { entryId: event.payload.entryId }
        : {})
    }
  };
  sourceConversation.upsertEditProposal(event.payload.runId, proposal);
  if (!noChanges && runApprovalMode === "auto-approve") {
    queueAgentEdit(
      sourceConversation,
      event.payload.sessionId,
      event.payload.runId,
      proposalId,
      true,
      true
    );
  }
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
  if (!window.deepwrite) {
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
    const message = "正文目录已发生变化，未创建章节，请基于最新目录重新生成。";
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
  const existingTitles = new Set(directory.sections.map((section) => section.title));
  const duplicateTitle = requiresIdempotentRecoveryProbe
    ? undefined
    : target.sections.find((section) =>
        existingTitles.has(section.title)
      )?.title;
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
    !directory.sections.some((section) => section.id === resolvedAfterSectionId)
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
  let createdCount = 0;
  let lastCreatedSectionId: string | undefined;
  const createdMapping = new Map<string, string>();
  try {
    const created = await window.deepwrite.catalog.createDraftSections({
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
    createdCount = created.sections.length;
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
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
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
        ? `已自动批准并创建 ${createdCount} 个空白章节；每章均包含正文和人物状态文件。`
        : `已创建 ${createdCount} 个空白章节并保存到本地 Markdown。`
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
  if (!window.deepwrite) {
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
    const message = "正文目录已发生变化，未修改章节名称，请基于最新目录重新生成。";
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
    const saved = await window.deepwrite.catalog.saveDocument({
      bookId: proposal.workspaceId,
      documentId: bodyDocument.catalogDocumentId,
      title: target.title,
      content: diskContent,
      baseRevision: createShortWorkspaceContentRevision(diskContent),
      ...(book.projectRevision === undefined
        ? {}
        : { baseProjectRevision: book.projectRevision })
    });
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
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
  if (!window.deepwrite) {
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
    const message = "正文目录已发生变化，未删除章节，请基于最新目录重新生成。";
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
    const deleted = await window.deepwrite.catalog.deleteDraftSection({
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
    const conversationKey = `${proposal.workspaceId}:expert_section_writer:${encodeURIComponent(target.sectionId)}`;
    conversations.get(conversationKey)?.dispose();
    conversations.delete(conversationKey);
    applyCatalogSnapshot(await window.deepwrite.catalog.snapshot());
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
    const message =
      error instanceof Error ? error.message : "删除章节失败。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: conflict ? "conflict" : "error",
      statusMessage: message
    });
    uiMessage.error(message);
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

function conflictDependentLongWorldbuildingProposals(
  conversation: AgentConversationController,
  proposal: AgentEditProposal,
  message: string
): void {
  for (const candidate of conversation.listEditProposals(proposal.runId)) {
    if (
      candidate.predecessorProposalId !== proposal.id ||
      !candidate.longWorldbuildingTarget ||
      (candidate.status !== "pending" && candidate.status !== "error")
    ) {
      continue;
    }
    removeQueuedAgentEdit(
      conversation,
      candidate.runId,
      candidate.id
    );
    conversation.updateEditProposal(candidate.runId, candidate.id, {
      status: "conflict",
      proposedText: undefined,
      statusMessage: message
    });
  }
}

function conflictDependentLongCharacterProposals(
  conversation: AgentConversationController,
  proposal: AgentEditProposal,
  message: string
): void {
  const createdFileIds = new Set(
    proposal.longCharacterTarget?.files
      .filter(({ operation }) => operation === "create")
      .map(({ fileId }) => fileId) ?? []
  );
  if (!createdFileIds.size) return;
  for (const candidate of conversation.listEditProposals(proposal.runId)) {
    if (
      candidate.predecessorProposalId !== proposal.id ||
      !candidate.longCharacterTarget?.files.some(({ fileId }) =>
        createdFileIds.has(fileId)
      ) ||
      (candidate.status !== "pending" && candidate.status !== "error")
    ) {
      continue;
    }
    removeQueuedAgentEdit(conversation, candidate.runId, candidate.id);
    conversation.updateEditProposal(candidate.runId, candidate.id, {
      status: "conflict",
      proposedText: undefined,
      statusMessage: message
    });
  }
}

async function acceptLongPlotDesignProposal(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  proposal: AgentEditProposal,
  automatic: boolean
): Promise<void> {
  const target = proposal.longPlotDesignTarget;
  const api = resolveLongWorkspaceApi();
  if (!target || !api) {
    const message = "长篇剧情设计服务当前不可用。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
    const message = automatic
      ? "检测到本书正在保存其他内容，剧情设计实时自动落盘已暂停，请稍后重试。"
      : "同一本书正在保存其他修改，请稍候再接受";
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
      ? "正在自动批准、校验影响并保存剧情设计…"
      : "正在校验影响并保存剧情设计…"
  });
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  let applied = false;
  try {
    if (activeLongBookId.value === target.bookId) {
      await nextTick();
      if (!(await saveActiveLongEditorChanges())) {
        throw new Error("当前长篇编辑内容尚未保存，未覆盖剧情设计。");
      }
    }
    const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
    const predecessor = proposal.predecessorProposalId
      ? conversation.getEditProposal(
          request.runId,
          proposal.predecessorProposalId
        )
      : undefined;
    const predecessorProjectRevision =
      predecessor?.status === "accepted"
        ? predecessor.longPlotDesignTarget?.appliedProjectRevision
        : undefined;
    if (
      latest.projectRevision !== target.baseProjectRevision &&
      latest.projectRevision !== predecessorProjectRevision
    ) {
      const message =
        "剧情设计已在审阅期间发生变化，未覆盖最新结构。请基于当前内容重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const batch = LongWorkspaceOperationBatchSchema.parse({
      ...target.batch,
      baseRevision: latest.workspaceIndex.revision
    });
    const preview = await api.previewOperations({
      bookId: target.bookId,
      batch
    });
    if (
      preview.bookId !== target.bookId ||
      preview.projectRevision !== latest.projectRevision
    ) {
      throw new Error(
        "长篇项目已在审批期间更新，请基于最新剧情设计重新生成。"
      );
    }
    const result = await api.applyOperations({
      bookId: target.bookId,
      batch: LongWorkspaceOperationBatchSchema.parse({
        ...batch,
        expectedImpact: preview.preview.impact
      }),
      baseProjectRevision: latest.projectRevision
    });
    applied = true;
    longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
    const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      longPlotDesignTarget: {
        ...target,
        appliedProjectRevision: result.projectRevision
      },
      statusMessage: refreshed
        ? `${automatic ? "已自动批准并" : "已接受并"}保存剧情设计。`
        : "剧情设计已保存，但界面刷新失败；请手动刷新长篇工作区。"
    });
    if (!automatic) {
      uiMessage.success("已接受并保存剧情设计");
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "保存剧情设计失败，当前结构保持不变。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: applied ? "accepted" : "error",
      statusMessage: applied
        ? `剧情设计已经保存，但刷新失败：${message}`
        : message
    });
    if (applied) {
      uiMessage.warning(`剧情设计已经保存，但刷新失败：${message}`);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

async function acceptLongWorldbuildingFileProposal(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  proposal: AgentEditProposal,
  automatic: boolean
): Promise<void> {
  const target = proposal.longWorldbuildingTarget;
  const api = resolveLongWorkspaceApi();
  if (!target || !api) {
    const message = "长篇世界观文件服务当前不可用。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
    const message = automatic
      ? "检测到本书正在保存其他内容，实时自动落盘已暂停，请稍后重试。"
      : "同一本书正在保存其他修改，请稍候再接受";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: automatic ? "error" : "pending",
      statusMessage: message
    });
    uiMessage.info(message);
    return;
  }

  conversation.updateEditProposal(request.runId, request.proposalId, {
    status: "accepting",
    statusMessage:
      target.file.operation === "create"
        ? automatic
          ? "正在自动批准并创建空白世界观文件…"
          : "正在校验目录版本并创建空白世界观文件…"
        : automatic
          ? "正在自动批准、校验版本并保存世界观文件…"
          : "正在校验版本并保存世界观文件…"
  });
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  let applied = false;
  try {
    if (activeLongBookId.value === target.bookId) {
      await nextTick();
      if (!(await saveActiveLongEditorChanges())) {
        throw new Error(
          "当前长篇编辑内容尚未保存，未覆盖世界观文件。"
        );
      }
    }
    const latest = await api.getWorkspaceIndex({
      bookId: target.bookId
    });
    const currentFile = findLongWorldbuildingFile(
      latest.workspaceIndex.worldbuilding,
      target.file.fileId
    );
    if (currentFile?.revision === target.file.nextRevision) {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage:
          "该世界观文件变更已经存在于本地 Markdown 中。"
      });
      await refreshLongWritingSaveBarrier(target.bookId);
      return;
    }
    if (target.file.operation === "create") {
      if (currentFile) {
        const message =
          "世界观目录已存在同一文件，未重复创建。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    } else if (
      !currentFile ||
      currentFile.revision !== target.file.beforeRevision
    ) {
      const message =
        "世界观文件已在审阅期间发生变化，未覆盖最新内容。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      await refreshLongWritingSaveBarrier(target.bookId);
      uiMessage.warning(message);
      return;
    }

    const nextOrderByCategory = new Map<string, number>();
    const batch = LongWorkspaceOperationBatchSchema.parse({
      ...target.batch,
      baseRevision: latest.workspaceIndex.revision,
      operations: target.batch.operations.map((operation) => {
        if (operation.type !== "worldbuildingItem.create") {
          return operation;
        }
        const category = latest.workspaceIndex.worldbuilding.find(
          ({ id }) => id === operation.categoryId
        );
        if (!category || category.format !== "list") {
          throw new Error(
            "世界观文件的目标分类已不存在或不再是列表型。"
          );
        }
        const nextOrder =
          (nextOrderByCategory.get(category.id) ??
            category.items.length) + 1;
        nextOrderByCategory.set(category.id, nextOrder);
        return {
          ...operation,
          item: {
            ...operation.item,
            order: nextOrder
          }
        };
      })
    });
    const preview = await api.previewOperations({
      bookId: target.bookId,
      batch
    });
    if (
      preview.bookId !== target.bookId ||
      preview.projectRevision !== latest.projectRevision
    ) {
      throw new Error(
        "长篇项目已在审批期间更新，请基于最新世界观重新生成。"
      );
    }
    const result = await api.applyOperations({
      bookId: target.bookId,
      batch: LongWorkspaceOperationBatchSchema.parse({
        ...batch,
        expectedImpact: preview.preview.impact
      }),
      baseProjectRevision: latest.projectRevision
    });
    applied = true;
    longBooks.value = replaceLongBookSummary(
      longBooks.value,
      result.summary
    );
    const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage:
        target.file.operation === "create"
          ? automatic
            ? "已自动批准并创建空白世界观文件。"
            : "已创建空白世界观文件并保存到本地 Markdown。"
          : refreshed
            ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
            : "已保存到本地 Markdown，但界面刷新失败；请手动刷新长篇工作区。"
    });
    if (!automatic) {
      uiMessage.success(
        target.file.operation === "create"
          ? "已创建空白世界观文件"
          : "已接受并保存世界观文件"
      );
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "保存世界观文件失败，原文件保持不变。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: applied ? "accepted" : "error",
      statusMessage: applied
        ? `世界观文件已经保存，但刷新失败：${message}`
        : message
    });
    if (applied) {
      uiMessage.warning(`世界观文件已经保存，但刷新失败：${message}`);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

async function acceptLongCharacterFileProposal(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  proposal: AgentEditProposal,
  automatic: boolean
): Promise<void> {
  const target = proposal.longCharacterTarget;
  const api = resolveLongWorkspaceApi();
  if (!target || !api) {
    const message = "长篇人物文件服务当前不可用。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
    const message = automatic
      ? "检测到本书正在保存其他内容，实时自动落盘已暂停，请稍后重试。"
      : "同一本书正在保存其他修改，请稍候再接受";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: automatic ? "error" : "pending",
      statusMessage: message
    });
    uiMessage.info(message);
    return;
  }

  const isCreation = target.files.every(
    ({ operation }) => operation === "create"
  );
  conversation.updateEditProposal(request.runId, request.proposalId, {
    status: "accepting",
    statusMessage: isCreation
      ? automatic
        ? "正在自动批准并创建人物档案…"
        : "正在校验目录版本并创建人物档案…"
      : automatic
        ? "正在自动批准、校验版本并保存人物档案…"
        : "正在校验版本并保存人物档案…"
  });
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  let applied = false;
  try {
    if (activeLongBookId.value === target.bookId) {
      await nextTick();
      if (!(await saveActiveLongEditorChanges())) {
        throw new Error("当前长篇编辑内容尚未保存，未覆盖人物档案。");
      }
    }
    const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
    const currentFiles = new Map([
      ...(latest.workspaceIndex.characterOverview
        ? [[
            latest.workspaceIndex.characterOverview.id,
            latest.workspaceIndex.characterOverview
          ] as const]
        : []),
      ...latest.workspaceIndex.characterFiles.flatMap((entry) => [
        [entry.coreProfile.id, entry.coreProfile] as const,
        [entry.relationships.id, entry.relationships] as const,
        [entry.currentState.id, entry.currentState] as const,
        [entry.history.id, entry.history] as const
      ])
    ]);
    if (
      target.files.every(
        (file) =>
          currentFiles.get(file.fileId)?.revision === file.nextRevision
      )
    ) {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: "该人物档案变更已经存在于本地 Markdown 中。"
      });
      await refreshLongWritingSaveBarrier(target.bookId);
      return;
    }
    if (isCreation) {
      if (target.files.some((file) => currentFiles.has(file.fileId))) {
        const message = "人物目录已存在同一人物的部分档案，未重复创建。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    } else {
      const changed = target.files.find((file) => {
        const current = currentFiles.get(file.fileId);
        return !current || current.revision !== file.beforeRevision;
      });
      if (changed) {
        const message = "人物档案已在审阅期间发生变化，未覆盖最新内容。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        await refreshLongWritingSaveBarrier(target.bookId);
        uiMessage.warning(message);
        return;
      }
    }

    const nextOrderByGroup = new Map<string, number>();
    const batch = LongWorkspaceOperationBatchSchema.parse({
      ...target.batch,
      baseRevision: latest.workspaceIndex.revision,
      operations: target.batch.operations.map((operation) => {
        if (operation.type !== "character.create") return operation;
        const group = operation.character.group;
        const nextOrder =
          (nextOrderByGroup.get(group) ??
            latest.workspaceIndex.characters.filter(
              (character) => character.group === group
            ).length) + 1;
        nextOrderByGroup.set(group, nextOrder);
        return {
          ...operation,
          character: { ...operation.character, order: nextOrder }
        };
      })
    });
    const preview = await api.previewOperations({
      bookId: target.bookId,
      batch
    });
    if (
      preview.bookId !== target.bookId ||
      preview.projectRevision !== latest.projectRevision
    ) {
      throw new Error(
        "长篇项目已在审批期间更新，请基于最新人物档案重新生成。"
      );
    }
    const result = await api.applyOperations({
      bookId: target.bookId,
      batch: LongWorkspaceOperationBatchSchema.parse({
        ...batch,
        expectedImpact: preview.preview.impact
      }),
      baseProjectRevision: latest.projectRevision
    });
    applied = true;
    longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
    const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage: isCreation
        ? automatic
          ? "已自动批准并创建人物及四份空白档案。"
          : "已创建人物及四份空白档案并保存到本地 Markdown。"
        : refreshed
          ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
          : "已保存到本地 Markdown，但界面刷新失败；请手动刷新长篇工作区。"
    });
    if (!automatic) {
      uiMessage.success(isCreation ? "已创建人物档案" : "已接受并保存人物档案");
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "保存人物档案失败，原文件保持不变。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: applied ? "accepted" : "error",
      statusMessage: applied
        ? `人物档案已经保存，但刷新失败：${message}`
        : message
    });
    if (applied) {
      uiMessage.warning(`人物档案已经保存，但刷新失败：${message}`);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

async function acceptLongDraftProposal(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  proposal: AgentEditProposal,
  automatic: boolean
): Promise<void> {
  const target = proposal.longDraftTarget;
  const api = resolveLongWorkspaceApi();
  if (!target || !api) {
    const message = "长篇正文服务当前不可用。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
    const message = automatic
      ? "检测到本书正在保存其他内容，正文实时自动落盘已暂停，请稍后重试。"
      : "同一本书正在保存其他修改，请稍候再接受";
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
      ? "正在自动批准、校验版本并保存章节正文…"
      : "正在校验版本并保存章节正文…"
  });
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  let applied = false;
  try {
    if (activeLongBookId.value === target.bookId) {
      await nextTick();
      if (!(await saveActiveLongEditorChanges())) {
        throw new Error("当前长篇编辑内容尚未保存，未覆盖章节正文。");
      }
    }
    const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
    const chapter = latest.workspaceIndex.chapters.find(
      ({ chapterCardId }) => chapterCardId === target.file.chapterCardId
    );
    if (!chapter || chapter.body.id !== target.file.fileId) {
      const message = "目标章卡或章节正文已经不存在，未保存本次修改。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (chapter.body.revision === target.file.nextRevision) {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: "该章节正文变更已经存在于本地 Markdown 中。"
      });
      const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
      if (refreshed) {
        await longWritingOrchestrator.handleChapterSaved(
          target.bookId,
          target.file.chapterCardId
        );
      }
      return;
    }
    const predecessor = proposal.predecessorProposalId
      ? conversation.getEditProposal(
          request.runId,
          proposal.predecessorProposalId
        )
      : undefined;
    const predecessorProjectRevision =
      predecessor?.status === "accepted"
        ? predecessor.longDraftTarget?.appliedProjectRevision
        : undefined;
    if (
      latest.projectRevision !== target.baseProjectRevision &&
      latest.projectRevision !== predecessorProjectRevision
    ) {
      const message =
        "章节正文已在审阅期间发生变化，未覆盖最新内容。请基于当前正文重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (chapter.body.revision !== target.file.beforeRevision) {
      const message = "章节正文已在审阅期间发生变化，未覆盖最新内容。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      await refreshLongWritingSaveBarrier(target.bookId);
      uiMessage.warning(message);
      return;
    }
    const batch = LongWorkspaceOperationBatchSchema.parse({
      ...target.batch,
      baseRevision: latest.workspaceIndex.revision
    });
    const preview = await api.previewOperations({
      bookId: target.bookId,
      batch
    });
    if (
      preview.bookId !== target.bookId ||
      preview.projectRevision !== latest.projectRevision
    ) {
      throw new Error(
        "长篇项目已在审批期间更新，请基于最新正文重新生成。"
      );
    }
    const result = await api.applyOperations({
      bookId: target.bookId,
      batch: LongWorkspaceOperationBatchSchema.parse({
        ...batch,
        expectedImpact: preview.preview.impact
      }),
      baseProjectRevision: latest.projectRevision
    });
    applied = true;
    longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
    const refreshed = await refreshLongWritingSaveBarrier(target.bookId);
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      longDraftTarget: {
        ...target,
        appliedProjectRevision: result.projectRevision
      },
      statusMessage: refreshed
        ? `${automatic ? "已自动批准并" : "已接受并"}保存章节正文到本地 Markdown。`
        : "章节正文已保存，但界面刷新失败；请手动刷新长篇工作区。"
    });
    if (refreshed) {
      await longWritingOrchestrator.handleChapterSaved(
        target.bookId,
        target.file.chapterCardId
      );
    }
    if (!automatic) {
      uiMessage.success("已接受并保存章节正文");
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "保存章节正文失败，原文件保持不变。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: applied ? "accepted" : "error",
      statusMessage: applied
        ? `章节正文已经保存，但刷新失败：${message}`
        : message
    });
    if (applied) {
      uiMessage.warning(`章节正文已经保存，但刷新失败：${message}`);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

async function applyAgentEdit(
  conversation: AgentConversationController,
  request: AgentEditReviewRequest,
  automatic = false,
  reservation?: {
    decisionToken: string;
    expectedProposedRevision: string;
  }
): Promise<void> {
  let proposal = conversation.getEditProposal(request.runId, request.proposalId);
  if (!proposal) {
    uiMessage.error("待审阅的智能体变更已不存在，请重新生成修改。");
    return;
  }
  const reserved = Boolean(
    reservation &&
      proposal.status === "accepting" &&
      proposal.decisionToken === reservation.decisionToken &&
      proposal.proposedRevision === reservation.expectedProposedRevision
  );
  if (reservation && !reserved) {
    return;
  }
  if (
    conversation.isBusy.value &&
    !canReviewAgentEditDuringRun(proposal)
  ) {
    uiMessage.info("请等待本轮智能体完成后再审阅文稿变更");
    return;
  }

  if (request.decision === "reject") {
    if (proposal.status === "accepting" || proposal.status === "accepted") return;
    removeQueuedAgentEdit(conversation, request.runId, request.proposalId);
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "rejected",
      proposedText: undefined,
      statusMessage: proposal.longPlotDesignTarget
        ? "已拒绝，剧情设计保持不变。"
        : proposal.longDraftTarget
          ? "已拒绝，章节正文保持不变。"
        : "已拒绝，原文保持不变。"
    });
    if (proposal.draftSectionCreationTarget) {
      conflictDependentProvisionalFileProposals(
        conversation,
        request.runId,
        proposal.draftSectionCreationTarget.sections.map(
          (section) => section.provisionalSectionId
        ),
        "空白章节创建已被拒绝，相关正文写入无法落盘。"
      );
    }
    if (
      proposal.longWorldbuildingTarget?.file.operation === "create"
    ) {
      conflictDependentLongWorldbuildingProposals(
        conversation,
        proposal,
        "空白世界观文件创建已被拒绝，相关正文写入无法落盘。"
      );
    }
    if (
      proposal.longCharacterTarget?.files.every(
        ({ operation }) => operation === "create"
      )
    ) {
      conflictDependentLongCharacterProposals(
        conversation,
        proposal,
        "人物创建已被拒绝，相关人物档案写入无法落盘。"
      );
    }
    blockLaterAgentEditGenerations(conversation, proposal);
    if (proposal.longDraftTarget) {
      longWritingOrchestrator.handleChapterRejected(
        proposal.longDraftTarget.bookId,
        proposal.longDraftTarget.file.chapterCardId
      );
    }
    uiMessage.info(
      proposal.longPlotDesignTarget
        ? "已拒绝剧情设计变更，当前结构未改变"
        : proposal.longDraftTarget
          ? "已拒绝章节正文变更，当前正文未改变"
        : "已拒绝智能体修改，原文未改变"
    );
    return;
  }

  if (
    (proposal.status === "accepting" && !reserved) ||
    proposal.status === "accepted" ||
    proposal.status === "rejected" ||
    proposal.status === "conflict"
  ) {
    return;
  }

  if (proposal.predecessorProposalId) {
    const predecessor = conversation.getEditProposal(
      request.runId,
      proposal.predecessorProposalId
    );
    if (
      !predecessor ||
      predecessor.status === "rejected" ||
      predecessor.status === "conflict" ||
      predecessor.status === "error"
    ) {
      const message =
        "前一版智能体修改未能落盘，本版依赖已阻断，没有覆盖当前文稿。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
      return;
    }
    if (predecessor.status !== "accepted") {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "pending",
        statusMessage: "正在等待前一版修改完成落盘…"
      });
      return;
    }
  }

  if (proposal.libraryTarget?.operation === "create") {
    await acceptLibraryCreationProposal(
      conversation,
      request,
      proposal,
      automatic
    );
    return;
  }

  if (proposal.longWorldbuildingTarget) {
    await acceptLongWorldbuildingFileProposal(
      conversation,
      request,
      proposal,
      automatic
    );
    return;
  }

  if (proposal.longCharacterTarget) {
    await acceptLongCharacterFileProposal(
      conversation,
      request,
      proposal,
      automatic
    );
    return;
  }

  if (proposal.longPlotDesignTarget) {
    await acceptLongPlotDesignProposal(
      conversation,
      request,
      proposal,
      automatic
    );
    return;
  }

  if (proposal.longDraftTarget) {
    await acceptLongDraftProposal(
      conversation,
      request,
      proposal,
      automatic
    );
    return;
  }

  if (proposal.characterStructureTarget) {
    await acceptCharacterStructureProposal(
      conversation,
      request,
      proposal,
      automatic,
      reserved
    );
    return;
  }

  if (proposal.draftSectionCreationTarget) {
    await acceptDraftSectionCreationProposal(
      conversation,
      request,
      proposal,
      automatic,
      reserved
    );
    return;
  }

  if (proposal.draftSectionRenameTarget) {
    await acceptDraftSectionRenameProposal(
      conversation,
      request,
      proposal,
      automatic,
      reserved
    );
    return;
  }

  if (proposal.draftSectionDeletionTarget) {
    await acceptDraftSectionDeletionProposal(
      conversation,
      request,
      proposal,
      automatic,
      reserved
    );
    return;
  }

  if (proposal.provisionalExpertSection) {
    const parsedDocumentId = parseCatalogDraftDocumentId(proposal.documentId);
    if (!parsedDocumentId) {
      const message = "待审阅的临时章节文件标识无效，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const provisionalSectionId = parsedDocumentId.sectionId;
    const creation = findPendingDraftSectionCreationForProvisional(
      conversation,
      request.runId,
      provisionalSectionId
    );
    if (creation?.status === "error" || creation?.status === "accepting") {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "pending",
        statusMessage:
          creation.status === "error"
            ? "章节创建结果尚未确认，正文内容已保留；请先重试章节创建。"
            : "正在等待关联章节创建完成…"
      });
      return;
    }
    if (creation) {
      await acceptDraftSectionCreationProposal(
        conversation,
        {
          runId: request.runId,
          proposalId: creation.id,
          decision: "accept"
        },
        creation,
        automatic
      );
    } else {
      const realSectionId = resolveProvisionalExpertSectionId(
        request.runId,
        proposal.workspaceId,
        provisionalSectionId
      );
      if (realSectionId !== provisionalSectionId) {
        remapProvisionalExpertSectionFileProposals(
          conversation,
          request.runId,
          proposal.workspaceId,
          new Map([[provisionalSectionId, realSectionId]])
        );
      } else {
        const inFlight = conversation.listEditProposals(request.runId).find(
          (candidate) =>
            candidate.draftSectionCreationTarget?.sections.some(
              (section) => section.provisionalSectionId === provisionalSectionId
            ) && candidate.status === "accepting"
        );
        if (inFlight) {
          uiMessage.info("同一作品正在保存其他修改，请稍候再接受");
          return;
        }
      }
    }
    const remapped = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (!remapped) {
      uiMessage.error("待审阅的智能体变更已不存在，请重新生成修改。");
      return;
    }
    proposal = remapped;
    if (proposal.provisionalExpertSection) {
      const message =
        "目标空白章节尚未落盘，无法写入正文。请先接受章节创建，或重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
  }

  if (proposal.provisionalCharacterItemId) {
    const creation = findPendingCharacterCreationForProvisional(
      conversation,
      request.runId,
      proposal.provisionalCharacterItemId
    );
    if (creation?.status === "error" || creation?.status === "accepting") {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "pending",
        statusMessage:
          creation.status === "error"
            ? "人物条目创建结果尚未确认，正文内容已保留；请先重试创建操作。"
            : "正在等待关联人物条目创建完成…"
      });
      return;
    }
    if (creation) {
      await acceptCharacterStructureProposal(
        conversation,
        {
          runId: request.runId,
          proposalId: creation.id,
          decision: "accept"
        },
        creation,
        automatic
      );
    }
    const createdTarget = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === proposal.workspaceId &&
        document.catalogDocumentId === proposal.provisionalCharacterItemId
    );
    if (!createdTarget) {
      const message =
        "目标人物条目尚未落盘，无法写入正文。请先接受人物条目创建，或重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
  }

  const target = liveWorkspaceDocuments.value.find(
    (document) => document.id === proposal.documentId
  );
  const persistedDocument = documents.value.find(
    (document) => document.id === proposal.documentId
  );
  if (!target || !persistedDocument || target.readOnly) {
    const message = "目标文稿已不可用，无法接受这项智能体修改。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }

  if (proposal.libraryTarget) {
    const library = findCatalogLibrary(
      proposal.libraryTarget.domain,
      proposal.libraryTarget.libraryId
    );
    if (
      !library ||
      !currentLibraryProjectRevisionMatches(proposal, library.projectRevision)
    ) {
      const message =
        "资料库目录已在审阅期间发生变化，未接受智能体修改。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
  }

  if (
    acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId) ||
    documents.value.some(
      (document) =>
        (document.workspaceId === proposal.workspaceId ||
          (proposal.libraryTarget !== undefined &&
            document.domain === proposal.libraryTarget.domain &&
            document.libraryId === proposal.libraryTarget.libraryId)) &&
        savingDocumentIds.value.has(document.id)
    )
  ) {
    const message = automatic
      ? "检测到作品正在保存其他内容，实时自动落盘已暂停，请稍后人工重试。"
      : "同一作品正在保存其他修改，请稍候再接受";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: automatic ? "error" : "pending",
      statusMessage: message
    });
    uiMessage.info(message);
    return;
  }

  const currentDraft = editorDrafts.value[target.id];
  const persistedRevision = createShortWorkspaceContentRevision(
    persistedDocument.content
  );
  if (
    persistedRevision === proposal.proposedRevision &&
    (!proposal.libraryTarget || persistedDocument.title === proposal.title)
  ) {
    const draftRevision = currentDraft
      ? createShortWorkspaceContentRevision(currentDraft.content)
      : undefined;
    const staleRecoveryDraft = Boolean(
      currentDraft &&
        currentDraft.title === persistedDocument.title &&
        (draftRevision === proposal.baseRevision ||
          draftRevision === proposal.proposedRevision)
    );
    if (staleRecoveryDraft) {
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[target.id];
      editorDrafts.value = nextDrafts;
    }
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage:
        currentDraft && !staleRecoveryDraft
          ? "修改已在本地 Markdown 中；检测到另一份未保存草稿，已为你保留。"
          : "修改已经存在于本地 Markdown 中。"
    });
    if (!automatic) {
      uiMessage.success("智能体修改已经保存在本地文稿中");
    }
    return;
  }

  const acceptance = classifyAgentEditAcceptance(proposal, target.content);
  if (acceptance === "missing-proposed-text") {
    const message = "待审阅变更缺少完整修改稿，请重新生成修改。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "error",
      statusMessage: message
    });
    uiMessage.error(message);
    return;
  }
  if (acceptance === "conflict") {
    const message =
      "文稿已在审阅期间发生变化，未接受智能体修改，也没有覆盖最新内容。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "conflict",
      statusMessage: message
    });
    uiMessage.warning(message);
    return;
  }

  const proposedText = proposal.proposedText!;
  const payload = {
    id: target.id,
    title: proposal.title,
    content: proposedText
  };
  conversation.updateEditProposal(request.runId, request.proposalId, {
    status: "accepting",
    statusMessage: automatic
      ? "正在自动批准、校验版本并保存到本地 Markdown…"
      : "正在校验版本并保存到本地 Markdown…"
  });
  setAgentEditDocumentAccepting(target.id, true);
  setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
  const draftAtAccept = currentDraft;

  try {
    let persisted = false;
    let newerDraftPreserved = false;
    if (persistedDocument.workspaceId && persistedDocument.catalogDocumentId) {
      if (!window.deepwrite) {
        throw new Error("桌面文件服务当前不可用。");
      }
      const projectRevision =
        currentDraft?.baseProjectRevision ?? persistedDocument.catalogProjectRevision;
      const saved = await window.deepwrite.catalog.saveDocument({
        bookId: persistedDocument.workspaceId,
        documentId: persistedDocument.catalogDocumentId,
        title: payload.title,
        content: payload.content,
        baseRevision:
          currentDraft?.baseRevision ??
          createShortWorkspaceContentRevision(persistedDocument.content),
        ...(projectRevision === undefined
          ? {}
          : { baseProjectRevision: projectRevision })
      });
      const normalizedPayload = {
        id: payload.id,
        title: saved.title,
        content: saved.content
      };
      applySavedCatalogDocument(persistedDocument.workspaceId, saved, undefined);
      applyAcceptedAgentDocumentLocally(
        normalizedPayload,
        undefined,
        draftAtAccept
      );
      const expectedDocuments = captureWorkspaceDocumentBaselines(
        documents.value,
        persistedDocument.workspaceId
      );
      await refreshBookAfterSuccessfulDocumentSave(
        persistedDocument.workspaceId,
        expectedDocuments
      );
      newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
      persisted = true;
    } else if (
      proposal.libraryTarget?.operation === "edit" &&
      persistedDocument.catalogEntryId &&
      persistedDocument.libraryId &&
      (persistedDocument.domain === "material" ||
        persistedDocument.domain === "skill")
    ) {
      if (!window.deepwrite) {
        throw new Error("桌面文件服务当前不可用。");
      }
      const library = findCatalogLibrary(
        persistedDocument.domain,
        persistedDocument.libraryId
      );
      if (!library) {
        throw new Error("目标资料库已不存在。");
      }
      const projectRevision = library.projectRevision;
      const saved = await window.deepwrite.catalog.saveLibraryEntry({
        domain: persistedDocument.domain,
        libraryId: persistedDocument.libraryId,
        entryId: persistedDocument.catalogEntryId,
        title: payload.title,
        content: payload.content,
        baseRevision:
          currentDraft?.baseRevision ??
          createShortWorkspaceContentRevision(persistedDocument.content),
        ...(projectRevision === undefined
          ? {}
          : { baseProjectRevision: projectRevision })
      });
      const savedProjectRevision =
        projectRevision === undefined ? undefined : projectRevision + 1;
      const normalizedPayload = {
        id: payload.id,
        title: saved.title,
        content: saved.body
      };
      applySavedLibraryEntry(
        persistedDocument.domain,
        persistedDocument.libraryId,
        saved,
        savedProjectRevision
      );
      applyAcceptedAgentDocumentLocally(
        normalizedPayload,
        savedProjectRevision,
        draftAtAccept
      );
      rememberAcceptedLibraryMutation(proposal);
      newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
      persisted = true;
    } else {
      applyAcceptedAgentDocumentLocally(payload, undefined, draftAtAccept);
      newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepted",
      proposedText: undefined,
      statusMessage: newerDraftPreserved
        ? `${automatic ? "已自动批准并" : "已"}保存审阅时的智能体修改；保存期间出现的更新草稿已保留。`
        : persisted
          ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
          : `${automatic ? "已自动批准并写入" : "已接受到"}当前工作区；该预览资源没有对应的本地文件。`
    });
    if (!automatic) {
      uiMessage.success(
        persisted ? "已接受并保存智能体修改" : "已接受智能体修改"
      );
    }
  } catch (error: unknown) {
    const conflict = isCatalogConflict(error);
    const message = conflict
      ? "本地 Markdown 已在其他位置更新，未保存智能体修改；请基于最新文稿重新生成。"
      : error instanceof Error
        ? error.message
        : "保存智能体修改失败，原文保持不变。";
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: conflict ? "conflict" : "error",
      statusMessage: message
    });
    if (conflict) {
      await loadCatalogSnapshot();
      uiMessage.warning(message);
    } else {
      uiMessage.error(message);
    }
  } finally {
    setAgentEditDocumentAccepting(target.id, false);
    setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
  }
}

async function reviewAgentEdit(request: AgentEditReviewRequest): Promise<void> {
  const conversation = activeConversation.value;
  const proposal = conversation.getEditProposal(
    request.runId,
    request.proposalId
  );
  if (
    request.decision === "accept" &&
    proposal &&
    canReviewAgentEditDuringRun(proposal)
  ) {
    queueAgentEdit(
      conversation,
      conversation.sessionId.value,
      request.runId,
      request.proposalId,
      false,
      true
    );
    return;
  }
  await applyAgentEdit(conversation, request);
}

async function reviewLongAgentEdit(
  request: AgentEditReviewRequest
): Promise<void> {
  const conversation = activeLongConversation.value;
  if (!conversation) return;
  const proposal = conversation.getEditProposal(
    request.runId,
    request.proposalId
  );
  if (
    request.decision === "accept" &&
    proposal &&
    canReviewAgentEditDuringRun(proposal)
  ) {
    queueAgentEdit(
      conversation,
      conversation.sessionId.value,
      request.runId,
      request.proposalId,
      false,
      true
    );
    return;
  }
  await applyAgentEdit(conversation, request);
}

async function drainQueuedAgentEditsForWorkspace(
  workspaceId: string
): Promise<void> {
  const entries = [...queuedAgentEdits.entries()]
    .filter(([, queued]) => queued.workspaceId === workspaceId)
    .sort(([, left], [, right]) => {
      const priority =
        autoApproveEditPriority(
          left.conversation,
          left.runId,
          left.proposalId
        ) -
        autoApproveEditPriority(
          right.conversation,
          right.runId,
          right.proposalId
        );
      if (priority !== 0) return priority;
      const leftProposal = left.conversation.getEditProposal(
        left.runId,
        left.proposalId
      );
      const rightProposal = right.conversation.getEditProposal(
        right.runId,
        right.proposalId
      );
      return (
        (leftProposal?.generation ?? 1) -
          (rightProposal?.generation ?? 1) ||
        Date.parse(leftProposal?.createdAt ?? "") -
          Date.parse(rightProposal?.createdAt ?? "")
      );
    });

  for (const [key, queued] of entries) {
    if (queuedAgentEdits.get(key) !== queued) {
      continue;
    }
    const current = queued.conversation.getEditProposal(
      queued.runId,
      queued.proposalId
    );
    if (
      !current ||
      queued.snapshot.token !== queued.decisionToken ||
      queued.snapshot.proposal.id !== queued.proposalId ||
      queued.snapshot.proposedRevision !== queued.expectedProposedRevision ||
      current.proposedRevision !== queued.expectedProposedRevision ||
      (current.status !== "pending" &&
        current.status !== "error" &&
        !(
          current.status === "accepting" &&
          current.decisionToken === queued.decisionToken
        ))
    ) {
      if (queuedAgentEdits.get(key) === queued) {
        queuedAgentEdits.delete(key);
      }
      continue;
    }
    if (
      current.status === "pending" ||
      current.status === "error"
    ) {
      queued.conversation.updateEditProposal(
        queued.runId,
        queued.proposalId,
        {
          status: "accepting",
          decisionToken: queued.decisionToken,
          statusMessage: queued.automatic
            ? "已进入自动保存队列…"
            : "已批准，正在等待本作品的保存队列…"
        }
      );
    }

    if (queuedAgentEdits.get(key) !== queued) {
      continue;
    }
    queuedAgentEdits.delete(key);
    await applyAgentEdit(
      queued.conversation,
      {
        runId: queued.runId,
        proposalId: queued.proposalId,
        decision: "accept"
      },
      queued.automatic,
      {
        decisionToken: queued.decisionToken,
        expectedProposedRevision: queued.expectedProposedRevision
      }
    );
  }
}

function scheduleQueuedAgentEdits(
  matches: (queued: QueuedAgentEdit) => boolean
): void {
  const workspaceIds = new Set(
    [...queuedAgentEdits.values()]
      .filter(matches)
      .map((queued) => queued.workspaceId)
  );
  for (const workspaceId of workspaceIds) {
    void agentEditCommitQueue
      .enqueue(workspaceId, () =>
        drainQueuedAgentEditsForWorkspace(workspaceId)
      )
      .catch((error: unknown) => {
        uiMessage.error(
          error instanceof Error ? error.message : "批准智能体修改失败。"
        );
      });
  }
}

function handleSystemEvent(event: SystemEventEnvelope): void {
  learningImitation.handleEvent(event);
  subagentAuthoring.handleEvent(event);
  observeLongWritingAgentEvent(event);
  if (
    event.type === "long.mutation_proposal" &&
    event.payload.agentId === "plot_design"
  ) {
    stageLongPlotDesignEditProposal(event);
  } else if (event.type === "long.worldbuilding_file_proposal") {
    stageLongWorldbuildingEditProposal(event);
  } else if (event.type === "long.character_file_proposal") {
    stageLongCharacterEditProposal(event);
  } else if (event.type === "long.chapter_write_proposal") {
    stageLongDraftEditProposal(event);
  } else {
    void longWorkspaceProposals.handleEvent(event);
  }
  if (event.type === "workspace.editor_mutation") {
    stageAgentEditProposal(event);
  }
  if (event.type === "library.editor_mutation") {
    stageLibraryEditProposal(event);
  }
  if (event.type === "workspace.stage_selection") {
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    const target = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === event.payload.workspaceId &&
        document.stageId === event.payload.stageId
    );
    if (sourceConversation && target) {
      selectedResourceId.value = target.id;
      activeCreationResourceId.value = target.id;
      rightCollapsed.value = false;
    }
  }
  for (const conversation of allConversations()) {
    conversation.handleEvent(event);
  }
  if (event.type === "agent.message_completed" || event.type === "agent.error") {
    scheduleQueuedAgentEdits(
      (queued) =>
        queued.sessionId === event.payload.sessionId &&
        queued.runId === event.payload.runId
    );
  }
}

async function loadModelSettings(): Promise<void> {
  if (!window.deepwrite) {
    return;
  }
  modelLoading.value = true;
  modelError.value = null;
  try {
    const settings = await window.deepwrite.models.list();
    applyLoadedModelSettings(settings);
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "加载模型配置失败。";
  } finally {
    modelLoading.value = false;
  }
}

async function loadAppAlerts(): Promise<void> {
  const api = window.deepwrite?.appAlerts;
  if (!api) return;
  try {
    const snapshot = await api.get();
    modelAlertMessages.value = [...snapshot.modelMessages];
    if (snapshot.shouldShowDesktop) {
      startupAlertMessages.value = [...snapshot.desktopMessages];
      startupAlertRevision.value = snapshot.desktopRevision;
    }
  } catch (error: unknown) {
    console.warn(
      "DeepWrite app alerts could not be loaded:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

function closeStartupAlert(): void {
  const revision = startupAlertRevision.value;
  startupAlertMessages.value = [];
  startupAlertRevision.value = "";
  if (!revision || !window.deepwrite?.appAlerts) return;
  void window.deepwrite.appAlerts.acknowledgeDesktop(revision).catch((error: unknown) => {
    console.warn(
      "DeepWrite desktop alert acknowledgement could not be saved:",
      error instanceof Error ? error.message : "unknown error"
    );
  });
}

async function loadModelUsage(input: ModelUsageQueryInput = modelUsageQuery.value): Promise<void> {
  const api = window.deepwrite?.modelUsage;
  if (!api) return;
  const query = {
    ...(input.startAt ? { startAt: input.startAt } : {}),
    ...(input.endAt ? { endAt: input.endAt } : {}),
    ...(input.modelConfigIds?.length ? { modelConfigIds: [...input.modelConfigIds] } : {}),
    ...(input.managedBy ? { managedBy: input.managedBy } : {}),
    ...(input.modules?.length ? { modules: [...input.modules] } : {})
  } satisfies ModelUsageQueryInput;
  const requestSequence = ++modelUsageRequestSequence;
  modelUsageLoading.value = true;
  modelUsageError.value = null;
  try {
    const dashboard = await api.query(query);
    if (requestSequence !== modelUsageRequestSequence) return;
    modelUsageDashboard.value = dashboard;
    modelUsageQuery.value = query;
  } catch (error: unknown) {
    if (requestSequence !== modelUsageRequestSequence) return;
    modelUsageError.value =
      error instanceof Error ? error.message : "加载模型用量失败。";
    uiMessage.warning(modelUsageError.value);
  } finally {
    if (requestSequence === modelUsageRequestSequence) {
      modelUsageLoading.value = false;
    }
  }
}

function applyLoadedModelSettings(settings: ModelSettings): void {
  modelSettings.value = settings;
  learningImitation.setConfiguredModels(settings.models, settings.defaultModelId);
  applyModelSettingsToConversations(settings);
}

async function queryOfficialModelUsage(settings: ModelSettings): Promise<ModelUsageDashboard> {
  const api = window.deepwrite?.modelUsage;
  if (!api) {
    throw new Error("当前环境未提供模型用量接口。");
  }
  return api.query({ managedBy: "deepwrite-official" });
}

async function loadOfficialModels(): Promise<void> {
  if (!window.deepwrite) return;
  const requestSequence = ++officialModelsRequestSequence;
  officialModelsLoading.value = true;
  try {
    const settings = await window.deepwrite.models.refreshOfficial();
    const dashboard = await queryOfficialModelUsage(settings);
    if (requestSequence !== officialModelsRequestSequence) return;
    applyLoadedModelSettings(settings);
    officialModelUsageDashboard.value = dashboard;
  } catch (error: unknown) {
    if (requestSequence !== officialModelsRequestSequence) return;
    uiMessage.error(
      error instanceof Error ? error.message : "加载官方模型失败。"
    );
  } finally {
    if (requestSequence === officialModelsRequestSequence) {
      officialModelsLoading.value = false;
    }
  }
}

async function saveOfficialToken(apiKey: string): Promise<void> {
  if (!window.deepwrite || officialModelsSaving.value) return;
  officialModelsSaving.value = true;
  try {
    const settings = await window.deepwrite.models.saveOfficialToken(apiKey);
    applyLoadedModelSettings(settings);
    officialModelUsageDashboard.value = await queryOfficialModelUsage(settings);
    uiMessage.success("官方令牌已安全保存，官方模型现在可以直接使用。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存官方令牌失败。"
    );
  } finally {
    officialModelsSaving.value = false;
  }
}

async function clearOfficialToken(): Promise<void> {
  if (!window.deepwrite || officialModelsSaving.value) return;
  officialModelsSaving.value = true;
  try {
    const settings = await window.deepwrite.models.clearOfficialToken();
    applyLoadedModelSettings(settings);
    officialModelUsageDashboard.value = await queryOfficialModelUsage(settings);
    uiMessage.info("官方令牌已移除，历史用量仍保留在本机账本中。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "移除官方令牌失败。"
    );
  } finally {
    officialModelsSaving.value = false;
  }
}

watch(workspaceMainView, (view) => {
  if (view === "models") {
    void loadModelSettings();
  }
});

async function saveModelSettings(settings: ModelSettingsInput): Promise<void> {
  if (!window.deepwrite || modelSaving.value) {
    return;
  }
  modelSaving.value = true;
  modelError.value = null;
  modelTestMessage.value = null;
  try {
    const saved = await window.deepwrite.models.save(settings);
    applyLoadedModelSettings(saved);
    modelTestMessage.value = "模型配置已保存，并已同步到后续对话。";
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "保存模型配置失败。";
  } finally {
    modelSaving.value = false;
  }
}

async function refreshFreeModels(): Promise<void> {
  if (!window.deepwrite || freeModelsRefreshing.value) {
    return;
  }
  freeModelsRefreshing.value = true;
  modelError.value = null;
  modelTestMessage.value = null;
  try {
    const settings = await window.deepwrite.models.refreshFree();
    applyLoadedModelSettings(settings);
    modelTestMessage.value = "免费模型配置已刷新。";
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "刷新免费模型配置失败。";
  } finally {
    freeModelsRefreshing.value = false;
  }
}

async function testModel(model: ModelConfigInput): Promise<void> {
  if (!window.deepwrite || testingModelId.value) {
    return;
  }
  testingModelId.value = model.id;
  modelError.value = null;
  modelTestMessage.value = null;
  try {
    const result = await window.deepwrite.models.test(model);
    modelTestMessage.value = result.message;
  } catch (error: unknown) {
    modelError.value = error instanceof Error ? error.message : "模型连接测试失败。";
    uiMessage.error(modelError.value);
  } finally {
    testingModelId.value = null;
  }
}

async function loadShortAndScriptAgentSettings(): Promise<void> {
  if (!window.deepwrite || workspaceAgentLoading.value) return;
  workspaceAgentLoading.value = true;
  try {
    const results = await Promise.allSettled([
      window.deepwrite.workspaceAgents.list("short"),
      window.deepwrite.workspaceAgents.list("script")
    ]);
    const loaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    if (loaded.length) {
      const loadedTypes = new Set(
        loaded.map(({ workspaceType }) => workspaceType)
      );
      workspaceAgentSettings.value = [
        ...workspaceAgentSettings.value.filter(
          ({ workspaceType }) => !loadedTypes.has(workspaceType)
        ),
        ...loaded
      ];
    }
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length) {
      uiMessage.error(
        failures
          .map((error) =>
            error instanceof Error ? error.message : "加载创作空间智能体设置失败。"
          )
          .join("；")
      );
    }
  } finally {
    workspaceAgentLoading.value = false;
  }
}

async function loadLongAgentSettings(): Promise<boolean> {
  const api = window.deepwrite;
  if (!api) return false;
  if (longAgentLoaded.value) return true;
  if (longAgentLoadPromise) return await longAgentLoadPromise;
  const pending = (async () => {
    longAgentLoading.value = true;
    longAgentLoadError.value = null;
    try {
      longAgentSettings.value = await api.longAgents.list();
      longAgentLoaded.value = true;
      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "加载长篇智能体设置失败。";
      longAgentLoaded.value = false;
      longAgentLoadError.value = message;
      uiMessage.error(message);
      return false;
    } finally {
      longAgentLoading.value = false;
    }
  })();
  longAgentLoadPromise = pending;
  try {
    return await pending;
  } finally {
    if (longAgentLoadPromise === pending) {
      longAgentLoadPromise = null;
    }
  }
}

async function ensureLongAgentSettingsLoaded(): Promise<boolean> {
  return longAgentLoaded.value || (await loadLongAgentSettings());
}

async function loadWorkspaceAgentSettings(): Promise<void> {
  if (!window.deepwrite) return;
  await Promise.all([
    loadShortAndScriptAgentSettings(),
    loadLongAgentSettings()
  ]);
}

async function saveWorkspaceAgentSettings(
  settings: WorkspaceAgentSettingsInput
): Promise<void> {
  if (!window.deepwrite || workspaceAgentSaving.value) return;
  workspaceAgentSaving.value = true;
  try {
    const saved =
      settings.workspaceType === "script"
        ? await window.deepwrite.workspaceAgents.save(settings)
        : await window.deepwrite.workspaceAgents.save(settings);
    workspaceAgentSettings.value = [
      ...workspaceAgentSettings.value.filter(
        (candidate) => candidate.workspaceType !== saved.workspaceType
      ),
      saved
    ];
    uiMessage.success(
      `${saved.workspaceType === "script" ? "剧本" : "短篇"}智能体提示词、欢迎快捷与读取范围已保存，下一轮对话立即生效。`
    );
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存创作空间智能体设置失败。"
    );
  } finally {
    workspaceAgentSaving.value = false;
  }
}

async function saveLongAgentSettings(
  settings: LongAgentSettingsInput
): Promise<void> {
  if (!window.deepwrite || longAgentSaving.value) return;
  longAgentSaving.value = true;
  try {
    longAgentSettings.value = await window.deepwrite.longAgents.save(settings);
    longAgentLoaded.value = true;
    longAgentLoadError.value = null;
    uiMessage.success(
      "长篇六个智能体的提示词、欢迎快捷与读取范围已保存，下一轮对话立即生效。"
    );
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存长篇智能体设置失败。"
    );
  } finally {
    longAgentSaving.value = false;
  }
}

async function loadShortAndScriptAgentTeamSettings(): Promise<void> {
  if (!window.deepwrite || agentTeamLoading.value) return;
  agentTeamLoading.value = true;
  agentTeamLoadError.value = null;
  try {
    const results = await Promise.allSettled([
      window.deepwrite.agentTeams.list("short"),
      window.deepwrite.agentTeams.list("script")
    ]);
    const loaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    if (loaded.length) {
      const loadedTypes = new Set(
        loaded.map(({ workspaceType }) => workspaceType)
      );
      agentTeamSettings.value = [
        ...agentTeamSettings.value.filter(
          ({ workspaceType }) => !loadedTypes.has(workspaceType)
        ),
        ...loaded
      ];
    }
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    agentTeamLoaded.value = failures.length === 0;
    if (failures.length) {
      const message = failures
        .map((error) =>
          error instanceof Error ? error.message : "加载智能体团队设置失败。"
        )
        .join("；");
      agentTeamLoadError.value = message;
      uiMessage.error(message);
    }
  } finally {
    agentTeamLoading.value = false;
  }
}

async function loadLongAgentTeamSettings(): Promise<void> {
  if (!window.deepwrite || longAgentTeamLoading.value) return;
  longAgentTeamLoading.value = true;
  longAgentTeamLoadError.value = null;
  try {
    longAgentTeamSettings.value =
      await window.deepwrite.longAgentTeams.list();
    longAgentTeamLoaded.value = true;
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "加载长篇智能体团队设置失败。";
    longAgentTeamLoaded.value = false;
    longAgentTeamLoadError.value = message;
  } finally {
    longAgentTeamLoading.value = false;
  }
}

async function loadAgentTeamSettings(): Promise<void> {
  if (!window.deepwrite) return;
  const pending: Promise<void>[] = [];
  if (!agentTeamLoaded.value && !agentTeamLoading.value) {
    pending.push(loadShortAndScriptAgentTeamSettings());
  }
  if (!longAgentTeamLoaded.value && !longAgentTeamLoading.value) {
    pending.push(loadLongAgentTeamSettings());
  }
  await Promise.all(pending);
}

async function saveAgentTeamSettings(
  settings: WorkspaceAgentTeamSettingsInput
): Promise<void> {
  if (!window.deepwrite || agentTeamSaving.value) return;
  agentTeamSaving.value = true;
  try {
    const saved =
      settings.workspaceType === "script"
        ? await window.deepwrite.agentTeams.save(settings)
        : await window.deepwrite.agentTeams.save(settings);
    agentTeamSettings.value = [
      ...agentTeamSettings.value.filter(
        (candidate) => candidate.workspaceType !== saved.workspaceType
      ),
      saved
    ];
    agentTeamLoaded.value = true;
    agentTeamLoadError.value = null;
    uiMessage.success("智能体团队已保存，下一轮对话立即生效。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存智能体团队设置失败。"
    );
  } finally {
    agentTeamSaving.value = false;
  }
}

async function saveLongAgentTeamSettings(
  settings: LongAgentTeamSettingsInput
): Promise<void> {
  if (!window.deepwrite || longAgentTeamSaving.value) return;
  longAgentTeamSaving.value = true;
  try {
    longAgentTeamSettings.value =
      await window.deepwrite.longAgentTeams.save(settings);
    longAgentTeamLoaded.value = true;
    longAgentTeamLoadError.value = null;
    uiMessage.success("长篇智能体团队已保存，下一轮对话立即生效。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error
        ? error.message
        : "保存长篇智能体团队设置失败。"
    );
  } finally {
    longAgentTeamSaving.value = false;
  }
}

async function loadLibraryAgentSettings(): Promise<void> {
  if (!window.deepwrite || libraryAgentLoading.value) return;
  libraryAgentLoading.value = true;
  try {
    libraryAgentSettings.value = await window.deepwrite.libraryAgents.list();
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "加载资料库智能体设置失败。"
    );
  } finally {
    libraryAgentLoading.value = false;
  }
}

async function saveLibraryAgentSettings(
  settings: LibraryAgentSettingsInput
): Promise<void> {
  if (!window.deepwrite || libraryAgentSaving.value) return;
  libraryAgentSaving.value = true;
  try {
    libraryAgentSettings.value = await window.deepwrite.libraryAgents.save(
      settings
    );
    uiMessage.success("资料库智能体设置已保存，下一轮对话立即生效。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存资料库智能体设置失败。"
    );
  } finally {
    libraryAgentSaving.value = false;
  }
}

async function resetLibraryAgentSettings(
  domain: LibraryAgentDomain
): Promise<void> {
  if (!window.deepwrite || libraryAgentSaving.value) return;
  libraryAgentSaving.value = true;
  try {
    libraryAgentSettings.value = await window.deepwrite.libraryAgents.reset(
      domain
    );
    uiMessage.success(
      `${domain === "skill" ? "技能库" : "素材库"}智能体已恢复默认设置。`
    );
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "恢复资料库智能体默认设置失败。"
    );
  } finally {
    libraryAgentSaving.value = false;
  }
}

async function loadLearningImitationSettings(): Promise<void> {
  if (!window.deepwrite || learningImitationLoading.value) return;
  learningImitationLoading.value = true;
  try {
    learningImitationSettings.value =
      await window.deepwrite.learningImitationSettings.list();
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "加载学习仿写设置失败。"
    );
  } finally {
    learningImitationLoading.value = false;
  }
}

async function saveLearningImitationSettings(
  settings: LearningImitationSettingsInput
): Promise<void> {
  if (!window.deepwrite || learningImitationSaving.value) return;
  learningImitationSaving.value = true;
  try {
    learningImitationSettings.value =
      await window.deepwrite.learningImitationSettings.save(settings);
    uiMessage.success("学习仿写提示词已保存，下一次运行对应阶段时生效。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "保存学习仿写设置失败。"
    );
  } finally {
    learningImitationSaving.value = false;
  }
}

async function resetLearningImitationSettings(
  stageId: LearningImitationStageId
): Promise<void> {
  if (!window.deepwrite || learningImitationSaving.value) return;
  learningImitationSaving.value = true;
  try {
    learningImitationSettings.value =
      await window.deepwrite.learningImitationSettings.reset(stageId);
    uiMessage.success("当前阶段已恢复默认提示词。");
  } catch (error: unknown) {
    uiMessage.error(
      error instanceof Error ? error.message : "恢复学习仿写默认设置失败。"
    );
  } finally {
    learningImitationSaving.value = false;
  }
}

function synchronizeActiveAgentRunPreferences(): void {
  synchronizeAgentRunPreferences(
    agentRunScopeForDocument(activeAgentDocument.value),
    activeConversation.value
  );
}

function selectModel(modelId: string): void {
  activeConversation.value.selectModel(modelId);
  synchronizeActiveAgentRunPreferences();
}

function selectThinking(level: ThinkingLevel): void {
  activeConversation.value.selectThinkingLevel(level);
  synchronizeActiveAgentRunPreferences();
}

function selectTemperature(value: number): void {
  activeConversation.value.selectTemperature(value);
  synchronizeActiveAgentRunPreferences();
}

function selectApprovalMode(mode: AgentRunSettings["approvalMode"]): void {
  updatePermissionMode(mode);
  activeConversation.value.selectApprovalMode(mode);
  synchronizeActiveAgentRunPreferences();
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newConversation();
  }
  if (event.key === "Escape") {
    createBookDialogOpen.value = false;
    bookTransferDialogMode.value = null;
    libraryProjectDialog.value = null;
    libraryGroupDialog.value = null;
    saveConflict.value = null;
    closeBookDialog();
    if (currentView.value === "settings") {
      closeSettings();
    }
  }
}

function currentDraftRecovery(): CatalogDraftRecovery {
  return Object.fromEntries(
    Object.entries(editorDrafts.value).flatMap(([id, draft]) =>
      draft.dirty
        ? [[id, { ...draft, dirty: true as const }]]
        : []
    )
  );
}

async function loadEditorDraftRecovery(): Promise<void> {
  const emergencyDrafts = loadEmergencyEditorDrafts();
  let coreDrafts: CatalogDraftRecovery = {};
  if (window.deepwrite) {
    try {
      coreDrafts = await window.deepwrite.catalog.loadDraftRecovery();
    } catch (error: unknown) {
      uiMessage.warning(
        error instanceof Error
          ? `草稿恢复文件读取失败：${error.message}`
          : "草稿恢复文件暂时无法读取"
      );
    }
  }
  const recoveredDrafts = mergeRecoveredEditorDrafts(
    coreDrafts,
    emergencyDrafts,
    {}
  );
  recoveredEditorDraftCount = Object.keys(recoveredDrafts).length;
  editorDrafts.value = mergeRecoveredEditorDrafts(
    coreDrafts,
    emergencyDrafts,
    currentDraftRecovery()
  );
}

function persistEmergencyDraftRecovery(): void {
  const dirtyDrafts = currentDraftRecovery();
  try {
    if (Object.keys(dirtyDrafts).length) {
      localStorage.setItem(EDITOR_DRAFT_RECOVERY_KEY, JSON.stringify(dirtyDrafts));
    } else {
      localStorage.removeItem(EDITOR_DRAFT_RECOVERY_KEY);
    }
  } catch {
    // The Core recovery file is the primary store; localStorage is only a
    // synchronous last-chance fallback during window teardown.
  }
}

async function flushEditorDraftRecovery(showWarning = true): Promise<void> {
  if (!window.deepwrite) {
    persistEmergencyDraftRecovery();
    return;
  }
  const draftsToSave = currentDraftRecovery();
  const savedFingerprint = JSON.stringify(draftsToSave);
  try {
    await window.deepwrite.catalog.saveDraftRecovery(draftsToSave);
    if (JSON.stringify(currentDraftRecovery()) === savedFingerprint) {
      localStorage.removeItem(EDITOR_DRAFT_RECOVERY_KEY);
    } else {
      persistEmergencyDraftRecovery();
    }
    draftPersistenceWarningShown = false;
  } catch {
    persistEmergencyDraftRecovery();
    if (showWarning && !draftPersistenceWarningShown) {
      draftPersistenceWarningShown = true;
      uiMessage.warning("未保存草稿暂时无法写入恢复文件，请先保存文稿再关闭应用");
    }
  }
}

function scheduleEditorDraftRecovery(): void {
  if (draftRecoveryTimer !== undefined) {
    window.clearTimeout(draftRecoveryTimer);
  }
  draftRecoveryTimer = window.setTimeout(() => {
    draftRecoveryTimer = undefined;
    void flushEditorDraftRecovery();
  }, 250);
}

function handleBeforeUnload(): void {
  persistEmergencyDraftRecovery();
  void flushEditorDraftRecovery(false);
}

async function refreshLongWorkspaceOnWindowFocus(
  bookId: string
): Promise<void> {
  if (!(await refreshActiveLongWorkspace(bookId))) return;
  const index = activeLongWorkspaceIndex.value;
  const summary = activeLongBookSummary.value;
  if (
    activeLongBookId.value !== bookId ||
    !index ||
    !summary ||
    summary.id !== bookId
  ) {
    return;
  }
  const synchronized =
    longWorkspaceEditor.value?.synchronizeProjectRevisionsIfClean(
      bookId,
      index.revision,
      summary.projectRevision
    ) ?? true;
  if (!synchronized) {
    uiMessage.warning(
      "长篇项目已在外部更新；当前有未保存内容，已保留编辑内容和原版本基线，请先保存并处理版本冲突。"
    );
  }
}

function refreshCatalogOnWindowFocus(): void {
  if (!window.deepwrite) return;
  void loadAppAlerts();
  void loadCatalogSnapshot();
  const bookId = activeLongBookId.value;
  if (bookId) {
    void loadLongBookList({ notify: true });
    void refreshLongWorkspaceOnWindowFocus(bookId);
  }
}

watch([leftCollapsed, rightCollapsed, currentView], () => {
  void nextTick(reconcilePaneWidths);
});

watch(editorDrafts, () => {
  scheduleEditorDraftRecovery();
});

onMounted(async () => {
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", reconcilePaneWidths);
  window.addEventListener("focus", refreshCatalogOnWindowFocus);
  window.addEventListener("beforeunload", handleBeforeUnload);
  reconcilePaneWidths();
  await loadEditorDraftRecovery();
  await loadGeneralSettings();
  if (!window.deepwrite) {
    if (recoveredEditorDraftCount > 0) {
      uiMessage.info(`已恢复 ${recoveredEditorDraftCount} 份未保存草稿`, {
        duration: 1500
      });
    }
    return;
  }

  void loadAppAlerts();
  removeSystemListener = window.deepwrite.events.subscribe(handleSystemEvent);
  await Promise.all([
    loadCatalogSnapshot(),
    loadModelSettings(),
    loadShortAndScriptAgentSettings(),
    loadShortAndScriptAgentTeamSettings(),
    loadLearningImitationSettings(),
    loadWorkspaceDirectory()
  ]);
  scheduleDirtyEditorDraftsForAutoSave();
  void loadLongBookList({ notify: false });
  void loadLongAgentSettings();
  if (recoveredEditorDraftCount > 0) {
    uiMessage.info(`已恢复 ${recoveredEditorDraftCount} 份未保存草稿`, {
      duration: 1500
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("resize", reconcilePaneWidths);
  window.removeEventListener("focus", refreshCatalogOnWindowFocus);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  stopPaneResize();
  cancelEditorAutoSave();
  removeSystemListener?.();
  if (draftRecoveryTimer !== undefined) {
    window.clearTimeout(draftRecoveryTimer);
    draftRecoveryTimer = undefined;
  }
  persistEmergencyDraftRecovery();
  void flushEditorDraftRecovery(false);
  if (longCatalogRetryTimer !== undefined) {
    window.clearTimeout(longCatalogRetryTimer);
    longCatalogRetryTimer = undefined;
  }
  longCatalogRequestClock += 1;
  for (const conversation of allConversations()) {
    conversation.dispose();
  }
  learningImitation.dispose();
});
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
      <SettingsPage
        v-if="currentView === 'settings'"
        :permission-mode="generalSettings.permissionMode"
        :auto-save-enabled="editorAutoSaveEnabled"
        :language="generalSettings.language"
        :show-in-menu-bar="generalSettings.showInMenuBar"
        :workspace-agent-settings="workspaceAgentSettings"
        :long-agent-settings="longAgentSettings"
        :workspace-agent-loading="workspaceAgentLoading"
        :workspace-agent-saving="workspaceAgentSaving"
        :long-agent-loading="longAgentLoading"
        :long-agent-saving="longAgentSaving"
        :long-agent-error="longAgentLoadError"
        :library-agent-settings="libraryAgentSettings"
        :library-agent-loading="libraryAgentLoading"
        :library-agent-saving="libraryAgentSaving"
        :learning-imitation-settings="learningImitationSettings"
        :learning-imitation-loading="learningImitationLoading"
        :learning-imitation-saving="learningImitationSaving"
        :model-usage-dashboard="modelUsageDashboard"
        :model-usage-loading="modelUsageLoading"
        :model-settings="modelSettings"
        :official-model-usage-dashboard="officialModelUsageDashboard"
        :official-models-loading="officialModelsLoading"
        :official-models-saving="officialModelsSaving"
        :runtime-available="hasDesktopRuntime"
        @back="closeSettings"
        @update-permission-mode="updatePermissionMode"
        @update-auto-save="updateEditorAutoSave"
        @update-language="updateAppLanguage"
        @update-show-in-menu-bar="updateShowInMenuBar"
        @save-workspace-agents="saveWorkspaceAgentSettings"
        @retry-long-agents="loadLongAgentSettings"
        @save-long-agents="saveLongAgentSettings"
        @save-library-agents="saveLibraryAgentSettings"
        @reset-library-agent="resetLibraryAgentSettings"
        @save-learning-imitation="saveLearningImitationSettings"
        @reset-learning-imitation="resetLearningImitationSettings"
        @load-model-usage="loadModelUsage"
        @load-official-models="loadOfficialModels"
        @save-official-token="saveOfficialToken"
        @clear-official-token="clearOfficialToken"
      />

    <div
      v-else
      ref="desktopShell"
      class="desktop-shell"
      :class="shellClasses"
      :style="shellStyle"
      data-testid="desktop-shell"
    >
      <LeftSidebar
        v-if="!leftCollapsed"
        :sections="resourceTreeSections"
        :selected-id="selectedResourceId"
        :imitation-running="learningImitationRunning"
        :library-entry-clipboard-domain="libraryEntryClipboardDomain"
        :active-primary-feature="activePrimaryFeature"
        @collapse="leftCollapsed = true"
        @new-conversation="newConversation"
        @open-dialog="openWorkspaceDialog"
        @open-agent-teams="openAgentTeams"
        @open-settings="openSettings"
        @select-resource="selectResource"
        @book-action="openBookDialog"
        @export-book="openBookExportDialog"
        @resource-action="handleResourceAction"
        @resource-node-action="handleResourceNodeAction"
        @long-book-action="handleLongBookAction"
        @create-expert-section="addExpertSection"
        @remove-expert-section="requestRemoveExpertSection"
        @create-character-item="requestCreateCharacterItem"
        @character-item-action="handleCharacterItemAction"
      />

      <main
        v-show="workspaceMainView === 'agent-team'"
        class="agent-team-main-view"
        aria-label="智能体团队"
      >
        <button
          v-if="leftCollapsed"
          class="icon-button agent-team-expand-sidebar"
          type="button"
          aria-label="展开左侧栏"
          @click="leftCollapsed = false"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <AgentTeamSettingsPanel
          :settings="agentTeamSettings"
          :long-settings="longAgentTeamSettings"
          :models="modelSettings?.models ?? []"
          :skills="catalogSnapshot?.skills ?? []"
          :preferred-model-id="modelSettings?.defaultModelId ?? null"
          :loading="agentTeamLoading"
          :saving="agentTeamSaving"
          :load-error="agentTeamLoadError"
          :long-loading="longAgentTeamLoading"
          :long-saving="longAgentTeamSaving"
          :long-load-error="longAgentTeamLoadError"
          :runtime-available="hasDesktopRuntime"
          :authoring-generating="subagentAuthoring.isBusy.value"
          :authoring-draft="subagentAuthoring.draft.value"
          :authoring-status-text="subagentAuthoring.statusText.value"
          :authoring-error="subagentAuthoring.error.value"
          @retry="loadAgentTeamSettings"
          @save="saveAgentTeamSettings"
          @save-long="saveLongAgentTeamSettings"
          @authoring-generate="(payload) => void subagentAuthoring.generate(payload.context, payload.modelId)"
          @authoring-stop="() => void subagentAuthoring.stop()"
          @authoring-reset="subagentAuthoring.reset()"
        />
      </main>

      <main
        v-show="workspaceMainView === 'directory' || workspaceMainView === 'models'"
        class="workspace-settings-main-view"
        :aria-label="workspaceMainView === 'directory' ? '工作目录' : '模型配置'"
      >
        <button
          v-if="leftCollapsed"
          class="icon-button workspace-settings-expand-sidebar"
          type="button"
          aria-label="展开左侧栏"
          @click="leftCollapsed = false"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <WorkspaceDialog
          :mode="workspaceMainView === 'directory' ? 'directory' : 'models'"
          :active="workspaceMainView === 'directory' || workspaceMainView === 'models'"
          :model-settings="modelSettings"
          :model-loading="modelLoading"
          :model-saving="modelSaving"
          :free-models-refreshing="freeModelsRefreshing"
          :model-error="modelError"
          :model-test-message="modelTestMessage"
          :testing-model-id="testingModelId"
          :model-alert-messages="modelAlertMessages"
          :workspace-directory-path="workspaceDirectoryPath"
          :workspace-directory-loading="workspaceDirectoryLoading"
          @save-models="saveModelSettings"
          @refresh-free-models="refreshFreeModels"
          @test-model="testModel"
          @choose-workspace-directory="chooseWorkspaceDirectory"
        />
      </main>

      <main
        v-show="workspaceMainView === 'imitation'"
        class="learning-imitation-main-view"
        aria-label="学习仿写"
      >
        <button
          v-if="leftCollapsed"
          class="icon-button learning-imitation-expand-sidebar"
          type="button"
          aria-label="展开左侧栏"
          @click="leftCollapsed = false"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <LearningImitationDialog
          :active="workspaceMainView === 'imitation'"
          :controller="learningImitation"
          :models="modelSettings?.models ?? []"
          :catalog-snapshot="catalogSnapshot"
          :approval-mode="generalSettings.permissionMode"
          @refresh-catalog="loadCatalogSnapshot"
        />
      </main>

      <main
        v-show="isLongWorkspaceActive"
        class="long-workspace-main-view"
        :class="{ 'is-right-collapsed': rightCollapsed }"
        aria-label="长篇创作空间"
      >
        <button
          v-if="leftCollapsed"
          class="icon-button long-workspace-expand-sidebar"
          type="button"
          aria-label="展开左侧栏"
          @click="leftCollapsed = false"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <template
          v-if="activeLongBookSummary && activeLongWorkspaceIndex"
        >
          <div class="long-agent-column">
            <AgentConversation
              v-if="activeLongConversation && activeLongAgentProfile"
              class="long-agent-conversation"
              v-model:draft="longComposerDraft"
              :messages="longMessages"
              :conversation-history="longConversationHistory"
              :current-session-id="longCurrentSessionId"
              :responding="longResponding"
              :can-send="longCanSend"
              :can-send-attachments="longCanSendAttachments"
              :can-stop="longCanStop"
              :runtime-available="hasDesktopRuntime"
              :models="longConfiguredModels"
              :selected-model-id="longSelectedModelId"
              :thinking-level="longThinkingLevel"
              :temperature="longTemperature"
              :approval-mode="longApprovalMode"
              allow-live-edit-review
              :context-title="
                activeLongSelection?.title ?? activeLongBookSummary.title
              "
              :book-title="activeLongBookSummary.title"
              :stage-label="activeLongStageLabel"
              :agent-label="activeLongAgentProfile.label"
              :agent-id="activeLongAgentProfile.id"
              agent-workspace-type="long"
              :library-domain="undefined"
              :library-skills="undefined"
              :welcome-shortcuts="
                activeLongAgentProfile.welcomeShortcuts
              "
              :available-skills="availableLongSkillReferences"
              :available-materials="availableLongMaterialReferences"
              :editor-references="[]"
              :long-proposal-items="activeLongConversationProposalItems"
              :long-workspace-index="activeLongWorkspaceIndex"
              :left-collapsed="leftCollapsed"
              :right-collapsed="rightCollapsed"
              @new-conversation="newLongConversation"
              @select-conversation="selectLongConversation"
              @send="sendLongMessage"
              @stop="stopLongGeneration"
              @suggestion="useLongSuggestion"
              @toggle-left="leftCollapsed = !leftCollapsed"
              @toggle-right="rightCollapsed = !rightCollapsed"
              @select-model="selectLongModel"
              @select-thinking="selectLongThinking"
              @select-temperature="selectLongTemperature"
              @select-approval="selectLongApprovalMode"
              @review-edit="reviewLongAgentEdit"
              @approve-long-proposal="approveLongProposal"
              @reject-long-proposal="rejectLongProposal"
              @retry-long-proposal-preview="retryLongProposalPreview"
            />
            <section
              v-if="activeLongWorkspaceRefreshStatus?.error"
              class="long-workspace-refresh-status is-error"
              aria-live="polite"
            >
              <span>
                最新工作区索引尚未同步，长篇智能体已暂停发送。
              </span>
              <button
                type="button"
                @click="retryActiveLongWorkspaceRefresh"
              >
                重新同步
              </button>
            </section>
            <section
              v-if="
                longWritingOrchestrator.state.value.phase !== 'idle' &&
                longWritingOrchestrator.state.value.bookId ===
                  activeLongBookSummary.id
              "
              class="long-writing-workflow-status"
              aria-live="polite"
            >
              <div>
                <strong>串行写作计划</strong>
                <span
                  v-if="longWritingOrchestrator.currentChapter.value"
                >
                  {{
                    longWritingOrchestrator.currentChapter.value.title
                  }}
                  ·
                  {{
                    Math.min(
                      longWritingOrchestrator.state.value.currentIndex + 1,
                      longWritingOrchestrator.state.value.chapters.length
                    )
                  }}/{{ longWritingOrchestrator.state.value.chapters.length }}
                </span>
                <span v-else>已完成</span>
              </div>
              <small
                v-if="longWritingOrchestrator.state.value.error"
                class="is-error"
              >
                {{ longWritingOrchestrator.state.value.error }}
              </small>
              <small v-else>
                {{
                  longWritingOrchestrator.state.value.phase ===
                  "awaiting_writer_approval"
                    ? "等待你审阅本章正文写入提案"
                    : longWritingOrchestrator.state.value.phase ===
                        "awaiting_ledger_approval"
                      ? "等待你审阅本章连续性文件；全部通过后自动归档"
                      : longWritingOrchestrator.state.value.phase ===
                          "complete"
                        ? "本次计划已完成"
                        : "正在核对文件与保存屏障"
                }}
              </small>
              <div
                v-if="
                  longWritingOrchestrator.state.value.phase !== 'complete'
                "
                class="long-writing-workflow-actions"
              >
                <button
                  v-if="
                    longWritingOrchestrator.state.value.phase === 'error'
                  "
                  type="button"
                  @click="longWritingOrchestrator.retry"
                >
                  重试当前章
                </button>
                <button
                  type="button"
                  @click="cancelLongWritingWorkflow"
                >
                  取消计划
                </button>
              </div>
              <button
                v-if="
                  longWritingOrchestrator.state.value.phase === 'complete'
                "
                type="button"
                @click="longWritingOrchestrator.cancel"
              >
                完成
              </button>
            </section>
          </div>
          <LongWorkspaceEditor
            v-show="!rightCollapsed"
            ref="longWorkspaceEditor"
            :book-id="activeLongBookSummary.id"
            :selection="activeLongSelection"
            :workspace-index="activeLongWorkspaceIndex"
            :latest-commit="latestLongLedgerCommit"
            :locked="longEditorLocked"
            :locked-reason="longEditorLockedReason"
            @saved="handleLongDocumentSaved"
            @context-change="handleLongFileContextChange"
            @collapse="rightCollapsed = true"
            @rollback="openLongRollbackDialog"
            @select-character="selectLongCharacterTab"
            @select-plot-point="selectLongPlotPointTab"
            @select-chapter-card="selectLongChapterCardTab"
            @rename-character="renameLongCharacter"
            @rename-structure-title="renameLongStructureTitle"
            @create-character="openLongCharacterCreate"
            @create-plot-point="openLongPlotPointCreate"
            @create-chapter-card="openLongChapterCardCreate"
            @create-volume="openLongVolumeCreate"
            @delete-structure="deleteLongNavigationStructure"
            @save-volume-outline="saveLongVolumeOutline"
            @save-plot-point-content="saveLongPlotPointContent"
            @mutation="handleLongStructureMutation"
          />
        </template>
        <div v-else class="long-workspace-loading-state">
          <span class="long-workspace-loading-icon">
            <AppIcon name="book" :size="28" />
          </span>
          <strong>
            {{
              longWorkspaceLoading
                ? "正在打开长篇工作区…"
                : "长篇工作区尚未载入"
            }}
          </strong>
          <span>
            {{
              longWorkspaceLoading
                ? "先加载轻量导航索引，正文将在选择文件后按需读取。"
                : "请再次选择左侧长篇书籍重试。"
            }}
          </span>
        </div>
      </main>

      <AgentConversation
        v-show="workspaceMainView === 'conversation'"
        :class="{ 'is-long-workspace-hidden': isLongWorkspaceActive }"
        v-model:draft="composerDraft"
        :messages="messages"
        :conversation-history="conversationHistory"
        :current-session-id="currentSessionId"
        :responding="responding"
        :can-send="canSend"
        :can-send-attachments="canSendAttachments"
        :can-stop="canStop"
        :runtime-available="hasDesktopRuntime"
        :models="configuredModels"
        :selected-model-id="selectedModelId"
        :thinking-level="thinkingLevel"
        :temperature="temperature"
        :approval-mode="approvalMode"
        allow-live-edit-review
        :context-title="activeAgentDocument.title"
        :book-title="composerBookTitle"
        :stage-label="composerStageLabel"
        :agent-label="activeAgentLabel"
        :agent-id="activeAgentId"
        :library-domain="activeLibraryDomain"
        :library-skills="activeLibraryWelcomeSkills"
        :welcome-shortcuts="activeWelcomeShortcuts"
        :available-skills="availableSkillReferences"
        :available-materials="availableMaterialReferences"
        :editor-references="pendingEditorReferences"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        @new-conversation="newConversation"
        @select-conversation="selectConversation"
        @send="sendMessage"
        @stop="stopGeneration"
        @suggestion="useSuggestion"
        @toggle-left="leftCollapsed = !leftCollapsed"
        @toggle-right="rightCollapsed = !rightCollapsed"
        @select-model="selectModel"
        @select-thinking="selectThinking"
        @select-temperature="selectTemperature"
        @select-approval="selectApprovalMode"
        @review-edit="reviewAgentEdit"
        @clear-editor-references="clearEditorSelectionReferences"
        @remove-editor-reference="removeEditorSelectionReference"
        @locate-editor-reference="locateEditorSelectionReference"
      />

      <RightEditorPane
        v-if="
          workspaceMainView === 'conversation' &&
          !rightCollapsed &&
          !isLongWorkspaceActive
        "
        :document="activeDocument"
        :resource-id="selectedResourceId"
        :draft-state="activeEditorDraft"
        :locate-reference="editorReferenceNavigation"
        :locked="editorLocked"
        :locked-label="editorLockedLabel"
        :saving="editorSaving"
        :auto-save-enabled="editorAutoSaveEnabled"
        :bound-to-current-book="activeLibraryBoundToBook"
        :section-tabs="activeEditorSectionTabs"
        :active-section-id="activeEditorSectionId"
        :section-tabs-label="editorSectionTabsLabel"
        :can-create-section="canCreateEditorSection"
        :create-section-label="editorCreateSectionLabel"
        :show-delete-section="showEditorDeleteSection"
        :can-delete-section="canDeleteEditorSection"
        :delete-section-label="editorDeleteSectionLabel"
        @collapse="rightCollapsed = true"
        @save="applyDocument"
        @live-change="handleLiveDocumentChange"
        @insert-selection="insertEditorSelectionReference"
        @select-section="selectEditorSection"
        @create-section="createEditorSection"
        @delete-section="deleteEditorSection"
        @select-draft-file="selectDraftFile"
      />

      <div
        v-if="!leftCollapsed"
        class="pane-resizer pane-resizer-left"
        role="separator"
        aria-label="调整左侧栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="LEFT_PANE_MIN"
        :aria-valuemax="LEFT_PANE_MAX"
        :aria-valuenow="leftPaneWidth"
        tabindex="0"
        @pointerdown="startPaneResize('left', $event)"
        @keydown="handleResizeKeydown('left', $event)"
      />

      <div
        v-if="workspaceMainView === 'conversation' && !rightCollapsed"
        class="pane-resizer pane-resizer-right"
        role="separator"
        aria-label="调整右侧栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="RIGHT_PANE_MIN"
        :aria-valuemax="RIGHT_PANE_MAX"
        :aria-valuenow="rightPaneWidth"
        tabindex="0"
        @pointerdown="startPaneResize('right', $event)"
        @keydown="handleResizeKeydown('right', $event)"
      />

    </div>

    <BookResourceDialog
      :mode="bookDialogMode"
      :book="activeBook"
      :skill-libraries="skillLibraries"
      :material-libraries="materialLibraries"
      :material-groups="catalogSnapshot?.materialGroups ?? []"
      :skill-groups="catalogSnapshot?.skillGroups ?? []"
      :loading="catalogLoading"
      :submitting="catalogMutationPending"
      @close="closeBookDialog"
      @rename="renameBook"
      @remove="removeBook"
      @delete="deleteBook"
      @update-bindings="updateBookBindings"
    />
    <PlotStructureDialog
      :open="Boolean(plotStructureBookId)"
      :book="plotStructureBook"
      :pending="catalogMutationPending"
      @close="closeBookDialog"
      @mutation="mutatePlotStructure"
      @character-mutation="mutateCharacterStructure"
    />
    <CharacterItemDialog
      :open="Boolean(characterItemDialog)"
      :mode="characterItemDialog?.mode ?? 'create'"
      :title="characterItemDialog?.title ?? ''"
      :pending="catalogMutationPending"
      @close="closeCharacterItemDialog"
      @submit="submitCharacterItemDialog"
    />
    <ExportShortManuscriptDialog
      :open="Boolean(exportBookTarget)"
      :book-title="exportBookTarget?.label ?? ''"
      :workspace-type="exportBookTarget?.workspaceType === 'script' ? 'script' : 'short'"
      :submitting="manuscriptExportPending"
      @close="closeBookExportDialog"
      @export="exportBookManuscript"
    />
    <LibraryRemovalDialog
      :open="Boolean(libraryRemovalDialog)"
      :action="libraryRemovalDialog?.action ?? 'remove'"
      :domain="libraryRemovalDialog?.payload.domain ?? 'material'"
      :label="libraryRemovalDialog?.payload.node.label ?? ''"
      :submitting="catalogMutationPending"
      @close="libraryRemovalDialog = null"
      @confirm="confirmLibraryRemoval"
    />
    <CreateBookDialog
      :open="createBookDialogOpen"
      :materials="catalogSnapshot?.materials ?? []"
      :material-groups="catalogSnapshot?.materialGroups ?? []"
      :skills="catalogSnapshot?.skills ?? []"
      :skill-groups="catalogSnapshot?.skillGroups ?? []"
      :loading="catalogLoading"
      :submitting="catalogMutationPending || longMutationPending"
      @close="createBookDialogOpen = false"
      @submit="createCreativeBook"
    />
    <BookTransferDialog
      :mode="bookTransferDialogMode"
      :pending="catalogMutationPending || longMutationPending"
      @close="bookTransferDialogMode = null"
      @select="handleBookTransferSelect"
    />
    <LongRollbackDialog
      :open="longRollbackDialogOpen && Boolean(longRollbackCommit)"
      :book-title="activeLongBookSummary?.title ?? ''"
      :chapter-title="longRollbackChapterTitle"
      :commit-sequence="longRollbackCommit?.sequence ?? 0"
      :pending="longRollbackPending"
      @close="closeLongRollbackDialog"
      @confirm="confirmLongRollback"
    />
    <LongStructureDialog
      :open="longStructureDialogOpen"
      :book-title="activeLongBookSummary?.title ?? ''"
      :book-id="activeLongBookId"
      :sync-book-options="longWorldbuildingSyncBookOptions"
      :snapshot="activeLongWorkspaceIndex"
      :pending="longBookActionPending"
      @close="longStructureDialogOpen = false"
      @mutation="handleLongStructureMutation"
      @sync-worldbuilding="handleLongWorldbuildingSync"
    />
    <CreateLongCharacterDialog
      :open="Boolean(longCharacterCreate)"
      :group-label="longCharacterCreate?.groupLabel ?? ''"
      :pending="longBookActionPending"
      @close="longCharacterCreate = null"
      @submit="createLongCharacter"
    />
    <CreateLongPlotPointDialog
      :open="Boolean(longPlotPointCreate)"
      :volume-title="longPlotPointCreate?.volumeTitle ?? ''"
      :pending="longBookActionPending"
      @close="longPlotPointCreate = null"
      @submit="createLongPlotPoint"
    />
    <CreateLongChapterCardDialog
      :open="Boolean(longChapterCardCreate)"
      :volume-title="longChapterCardCreate?.volumeTitle ?? ''"
      :arc-options="longChapterCardCreate?.arcOptions ?? []"
      :pending="longBookActionPending"
      @close="longChapterCardCreate = null"
      @submit="createLongChapterCard"
    />
    <CreateLongVolumeDialog
      :open="longVolumeCreateOpen"
      :pending="longBookActionPending"
      @close="longVolumeCreateOpen = false"
      @submit="createLongVolume"
    />
    <LongBookBindingsDialog
      v-if="activeLongBookSummary"
      :mode="longBindingsDialogMode"
      :book-title="activeLongBookSummary.title"
      :materials="catalogSnapshot?.materials ?? []"
      :skills="catalogSnapshot?.skills ?? []"
      :linked-material-ids-by-kind="
        activeLongBookSummary.linkedMaterialIdsByKind
      "
      :linked-skill-ids-by-kind="
        activeLongBookSummary.linkedSkillIdsByKind
      "
      :submitting="longBookActionPending"
      @close="longBindingsDialogMode = null"
      @submit="updateLongBookBindings"
    />
    <LongBookRemovalDialog
      :open="Boolean(longBookRemovalDialog)"
      :action="longBookRemovalDialog?.action ?? 'unregister'"
      :title="longBookRemovalDialog?.title ?? ''"
      :pending="longBookActionPending"
      @close="longBookRemovalDialog = null"
      @confirm="confirmLongBookRemoval"
    />
    <LongMigrationReportDialog
      :open="Boolean(longMigrationReport)"
      :title="longMigrationReport?.book.title ?? ''"
      :source-kind="
        longMigrationReport?.sourceKind ?? 'write-claw-zip'
      "
      :legacy-schema-version="
        longMigrationReport?.legacySchemaVersion ?? 0
      "
      :committed-chapter-policy="
        longMigrationReport?.committedChapterPolicy ??
        'written-uncommitted'
      "
      :warnings="longMigrationReport?.warnings ?? []"
      @close="longMigrationReport = null"
    />
    <LibraryProjectDialog
      :open="Boolean(libraryProjectDialog)"
      :operation="libraryProjectDialog?.operation ?? null"
      :domain="libraryProjectDialog?.domain ?? 'material'"
      :library-id="libraryProjectDialog?.libraryId"
      :library-title="libraryProjectDialog?.libraryTitle"
      :material-kind="libraryProjectDialog?.materialKind"
      :entry-id="libraryProjectDialog?.entryId"
      :entry-title="libraryProjectDialog?.entryTitle"
      :workspace-type="libraryProjectDialog?.workspaceType"
      :submitting="catalogMutationPending"
      @close="libraryProjectDialog = null"
      @create-library="createCatalogLibrary"
      @create-entry="createCatalogLibraryEntry"
      @remove-entry="removeCatalogLibraryEntry"
    />
    <LibraryGroupDialog
      :open="Boolean(libraryGroupDialog)"
      :domain="libraryGroupDialog?.domain ?? 'material'"
      :group="activeLibraryGroup"
      :materials="catalogSnapshot?.materials ?? []"
      :material-groups="catalogSnapshot?.materialGroups ?? []"
      :skills="catalogSnapshot?.skills ?? []"
      :skill-groups="catalogSnapshot?.skillGroups ?? []"
      :submitting="catalogMutationPending"
      @close="libraryGroupDialog = null"
      @submit="saveCatalogLibraryGroup"
    />
    <SaveConflictDialog
      :open="Boolean(saveConflict)"
      :title="saveConflict?.payload.title ?? ''"
      :draft-content="saveConflict?.payload.content ?? ''"
      :disk-content="saveConflict?.diskContent ?? ''"
      :submitting="saveConflictSubmitting"
      @keep="keepSaveConflictDraft"
      @reload="reloadSaveConflictFromDisk"
      @overwrite="overwriteSaveConflictOnDisk"
    />
    <DeleteExpertSectionDialog
      :open="Boolean(pendingExpertSectionDeletion)"
      :section-title="pendingExpertSectionDeletion?.sectionTitle ?? ''"
      :has-content="pendingExpertSectionDeletion?.hasContent ?? false"
      :workspace-type="pendingExpertSectionDeletion?.workspaceType"
      @close="pendingExpertSectionDeletion = null"
      @confirm="confirmRemoveExpertSection"
    />
    <StartupAlertDialog
      :open="startupAlertMessages.length > 0"
      :messages="startupAlertMessages"
      @close="closeStartupAlert"
    />
  </NConfigProvider>
</template>
