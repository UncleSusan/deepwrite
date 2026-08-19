import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell
} from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CatalogInstallMarketplaceSkillContentResultSchema,
  CatalogSnapshotSchema,
  CommandEnvelopeSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  SystemReadyEventEnvelopeSchema,
  SessionPromptAcceptedPayloadSchema,
  createDefaultAppearanceSettings,
  createDefaultGeneralSettings,
  createEnvelope,
  type AppearanceSettings,
  type CommandResult,
  type GeneralSettings,
  type SystemEventEnvelope,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createId, nowIso } from "@deepwrite/shared";
import { AppearanceConfigStore } from "./appearance-config-store";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import { GeneralSettingsStore } from "./general-settings-store";
import { ChatAssistantProjectConfigStore } from "./chat-assistant-project-config-store";
import { ModelConfigStore } from "./model-config-store";
import { ModelUsageStore } from "./model-usage-store";
import { SoftwareTokenUsageReporter } from "./software-token-usage-reporter";
import { LearningImitationConfigStore } from "./learning-imitation-config-store";
import { LibraryAgentConfigStore } from "./library-agent-config-store";
import { LongAgentConfigStore } from "./long-agent-config-store";
import { LongAgentTeamConfigStore } from "./long-agent-team-config-store";
import {
  applyNativeAppearanceChrome,
  resolveNativeBackgroundColor
} from "./native-appearance-chrome";
import { exportShortManuscript } from "./short-manuscript-export";
import { exportLongManuscript } from "./long-manuscript-export";
import { UtilitySupervisor } from "./supervisor";
import {
  AGENT_CORE_LONG_QUERY_COMMANDS,
  authorizeMainInternalCommand
} from "./internal-command-authorizer";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";
import { WorkspaceDirectoryStore } from "./workspace-directory-store";
import { UpdateService } from "./update-service";
import { AppAlertStore } from "./app-alert-store";
import { MarketplaceClient } from "./marketplace-client";
import {
  CloudBackupService,
  registerCloudBackupIpc
} from "../extras/cloud-backup";
import { ContinuationImportPreviewRegistry } from "./continuation-import-preview-registry";
import { LegacySyncPreviewRegistry } from "./legacy-sync-preview-registry";
import { readExternalSkills } from "./external-skill-import";
import { importLegacyLibraryArchives } from "./legacy-library-import-batch";
import { listRemoteModels } from "./list-remote-models";
import { createMainWindowStartupGate } from "./main-window-startup-gate";
import { resolveDeepWriteAppMode } from "./app-run-mode";
import { recordUsageObservation, type UsageRunContext } from "./usage-observation";
import { dispatchCommand } from "./ipc/dispatch-command";
import type { ActiveRun, IpcCommandContext } from "./ipc/command-types";
import { registerMarketplaceIpc } from "./ipc/marketplace-ipc";
import { registerUpdateAlertIpc } from "./ipc/update-alert-ipc";
import {
  chooseWorkspaceDirectory,
  requireSelectedWorkspaceDirectory,
  workspaceGroupParent,
  workspaceResourceParent
} from "./ipc/workspace-paths";

const activeRuns = new Map<string, ActiveRun>();
const terminalRuns = new Set<string>();
const pendingUsageContexts = new Map<string, UsageRunContext>();
let smokeEventTap: ((event: SystemEventEnvelope) => void) | undefined;
let mainWindow: BrowserWindow | undefined;
let modelConfigStore: ModelConfigStore | undefined;
let modelUsageStore: ModelUsageStore | undefined;
let softwareTokenUsageReporter: SoftwareTokenUsageReporter | undefined;
let agentTeamConfigStore: AgentTeamConfigStore | undefined;
let appearanceConfigStore: AppearanceConfigStore | undefined;
let generalSettingsStore: GeneralSettingsStore | undefined;
let chatAssistantProjectConfigStore: ChatAssistantProjectConfigStore | undefined;
let learningImitationConfigStore: LearningImitationConfigStore | undefined;
let libraryAgentConfigStore: LibraryAgentConfigStore | undefined;
let longAgentConfigStore: LongAgentConfigStore | undefined;
let longAgentTeamConfigStore: LongAgentTeamConfigStore | undefined;
let cachedAppearanceSettings: AppearanceSettings = createDefaultAppearanceSettings();
let cachedGeneralSettings: GeneralSettings = createDefaultGeneralSettings();
let nativeAppearanceListenerBound = false;
let workspaceAgentConfigStore: WorkspaceAgentConfigStore | undefined;
let workspaceDirectoryStore: WorkspaceDirectoryStore | undefined;
let quitting = false;
let shutdownComplete = false;
let menuBarTray: Tray | undefined;
let updateService: UpdateService | undefined;
let appAlertStore: AppAlertStore | undefined;
let marketplaceClient: MarketplaceClient | undefined;
let cloudBackupService: CloudBackupService | undefined;
let installUpdateAfterShutdown = false;
const RENDERER_DRAFT_FLUSH_GRACE_MS = 500;
const continuationImportPreviews = new ContinuationImportPreviewRegistry();
const legacySyncPreviews = new LegacySyncPreviewRegistry();
const mainWindowStartupGate = createMainWindowStartupGate(() => showMainWindow());

function broadcastEvent(event: SystemEventEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENT_CHANNEL, event);
    }
  }
}

function beginGracefulShutdown(options: { installUpdate?: boolean } = {}): void {
  installUpdateAfterShutdown ||= options.installUpdate === true;
  if (quitting) {
    if (shutdownComplete && installUpdateAfterShutdown && updateService) {
      updateService.quitAndInstall();
    }
    return;
  }
  quitting = true;
  destroyMenuBarTray();
  setTimeout(() => {
    void (async () => {
      try {
        await supervisor.shutdownAll();
      } catch (error: unknown) {
        console.warn(
          "DeepWrite utilities did not shut down cleanly:",
          error instanceof Error ? error.message : "unknown error"
        );
      } finally {
        try {
          await modelUsageStore?.flush();
        } catch (error: unknown) {
          console.warn(
            "DeepWrite model usage records could not finish flushing:",
            error instanceof Error ? error.message : "unknown error"
          );
        }
        try {
          await softwareTokenUsageReporter?.reportBeforeShutdown();
        } catch {
          console.warn("DeepWrite software token usage was not reported before shutdown.");
        }
        shutdownComplete = true;
        if (installUpdateAfterShutdown && updateService) {
          updateService.quitAndInstall();
        } else {
          app.quit();
        }
      }
    })();
  }, RENDERER_DRAFT_FLUSH_GRACE_MS);
}

type AgentEventEnvelope = Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.evaluation_snapshot"
      | "agent.turn_started"
      | "agent.retry_scheduled"
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.usage_observed"
      | "agent.error"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "learning_imitation.result_updated"
      | "subagent_authoring.draft_updated"
      | "library.editor_mutation"
      | "workspace.editor_mutation"
      | "workspace.stage_selection"
      | "long.mutation_proposal"
      | "long.chapter_write_proposal"
      | "long.chapter_dispatch_proposal"
      | "long.ledger_commit_proposal"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed";
  }
>;

function isAgentEvent(event: SystemEventEnvelope): event is AgentEventEnvelope {
  return (
    event.type === "agent.evaluation_snapshot" ||
    event.type === "agent.turn_started" ||
    event.type === "agent.retry_scheduled" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.usage_observed" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "learning_imitation.result_updated" ||
    event.type === "subagent_authoring.draft_updated" ||
    event.type === "library.editor_mutation" ||
    event.type === "workspace.editor_mutation" ||
    event.type === "workspace.stage_selection" ||
    event.type === "long.mutation_proposal" ||
    event.type === "long.chapter_write_proposal" ||
    event.type === "long.chapter_dispatch_proposal" ||
    event.type === "long.ledger_commit_proposal" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}

function rememberTerminalRun(runId: string): void {
  terminalRuns.add(runId);
  while (terminalRuns.size > 2_000) {
    const oldest = terminalRuns.values().next().value as string | undefined;
    if (!oldest) {
      return;
    }
    terminalRuns.delete(oldest);
  }
}


function handleUtilityEvent(event: SystemEventEnvelope, worker: UtilityWorkerName): void {
  if (isAgentEvent(event) && worker !== "agent") {
    return;
  }

  const validated = SystemEventEnvelopeSchema.parse(event) as SystemEventEnvelope;
  if (validated.type === "agent.usage_observed") {
    recordUsageObservation(validated, modelUsageStore, activeRuns, pendingUsageContexts);
    return;
  }
  if (isAgentEvent(validated)) {
    const runId = validated.payload.runId;
    if (validated.type === "agent.message_completed" || validated.type === "agent.error") {
      const activeRun = activeRuns.get(runId);
      rememberTerminalRun(runId);
      activeRuns.delete(runId);
      pendingUsageContexts.delete(
        activeRun?.correlationId ?? validated.context.correlationId
      );
    } else if (!terminalRuns.has(runId) && !activeRuns.has(runId)) {
      const usageContext = pendingUsageContexts.get(validated.context.correlationId);
      activeRuns.set(runId, {
        sessionId: validated.payload.sessionId,
        correlationId: validated.context.correlationId,
        runtime: validated.payload.runtime,
        accepted: false,
        ...(usageContext ? { usageContext } : {})
      });
    }
  }
  smokeEventTap?.(validated);
  broadcastEvent(validated);
}

function handleUnexpectedExit(worker: UtilityWorkerName, reason: string): void {
  if (worker === "agent") {
    for (const [runId, run] of activeRuns) {
      const event = SystemEventEnvelopeSchema.parse(
        createEnvelope(
          "agent.error",
          {
            sessionId: run.sessionId,
            runId,
            code: "agent.utility_exited",
            message: "Agent Utility 意外退出，本轮对话已终止。",
            details: { reason },
            runtime: run.runtime
          },
          {
            id: createId("evt"),
            context: {
              correlationId: run.correlationId,
              sessionId: run.sessionId,
              runId
            }
          }
        )
      ) as SystemEventEnvelope;
      rememberTerminalRun(runId);
      smokeEventTap?.(event);
      broadcastEvent(event);
    }
    activeRuns.clear();
    pendingUsageContexts.clear();
  }

  broadcastEvent(
    SystemEventEnvelopeSchema.parse(
      createEnvelope(
        "system.worker_restarting",
        { worker, reason, detectedAt: nowIso() },
        { id: createId("evt_restarting") }
      )
    ) as SystemEventEnvelope
  );
}

function handleWorkerRestarted(worker: UtilityWorkerName, reason: string): void {
  broadcastEvent(
    SystemEventEnvelopeSchema.parse(
      createEnvelope(
        "system.worker_restarted",
        { worker, reason, restartedAt: nowIso() },
        { id: createId("evt_restarted") }
      )
    ) as SystemEventEnvelope
  );
}

const supervisor = new UtilitySupervisor({
  onUtilityEvent: handleUtilityEvent,
  onUnexpectedExit: handleUnexpectedExit,
  onWorkerRestarted: handleWorkerRestarted,
  internalCommandAllowlist: {
    core: AGENT_CORE_LONG_QUERY_COMMANDS
  },
  internalCommandAuthorize: (context) =>
    authorizeMainInternalCommand(context, activeRuns)
});

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function createMainWindow(): BrowserWindow {
  const isDarwin = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: resolveNativeBackgroundColor(cachedAppearanceSettings),
    title: "DeepWrite",
    icon: join(__dirname, "../../build/icon.png"),
    ...(isDarwin
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 10 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  const windowWebContentsId = window.webContents.id;

  applyNativeAppearanceChrome(cachedAppearanceSettings, [window]);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  if (process.env.DEEPWRITE_SMOKE !== "1") {
    window.once("ready-to-show", () => window.show());
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  window.webContents.once("did-finish-load", () => void announceReady(window));
  window.on("close", (event) => {
    if (
      cachedGeneralSettings.showInMenuBar &&
      !quitting &&
      !shutdownComplete
    ) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    continuationImportPreviews.clearForWebContents(windowWebContentsId);
    legacySyncPreviews.clearForWebContents(windowWebContentsId);
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  return window;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function destroyMenuBarTray(): void {
  menuBarTray?.destroy();
  menuBarTray = undefined;
}

function syncMenuBarTray(): void {
  if (!cachedGeneralSettings.showInMenuBar) {
    destroyMenuBarTray();
    return;
  }
  if (menuBarTray && !menuBarTray.isDestroyed()) {
    return;
  }

  const rendererIconPath = join(__dirname, "../renderer/app-icon.png");
  const buildIconPath = join(__dirname, "../../build/icon.png");
  const sourceIcon = existsSync(rendererIconPath)
    ? rendererIconPath
    : buildIconPath;
  let trayIcon = nativeImage.createFromPath(sourceIcon);
  if (process.platform === "darwin" && !trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 18, height: 18 });
    trayIcon.setTemplateImage(true);
  }
  menuBarTray = new Tray(trayIcon);
  menuBarTray.setToolTip("DeepWrite");
  menuBarTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 DeepWrite",
        click: showMainWindow
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => app.quit()
      }
    ])
  );
  menuBarTray.on("click", showMainWindow);
}

function syncGeneralSettings(settings: GeneralSettings): void {
  cachedGeneralSettings = settings;
  syncMenuBarTray();
}


function extractCommandRequestId(rawCommand: unknown): string {
  if (
    rawCommand &&
    typeof rawCommand === "object" &&
    "id" in rawCommand &&
    typeof (rawCommand as { id: unknown }).id === "string"
  ) {
    const requestId = (rawCommand as { id: string }).id.trim();
    if (requestId) {
      return requestId;
    }
  }
  return "unknown";
}

function summarizeCommandValidationIssues(
  issues: readonly { path: PropertyKey[]; message: string }[]
): Record<string, unknown> {
  const preview = issues.slice(0, 3).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message
  }));
  return {
    issueCount: issues.length,
    issues: preview
  };
}

function requireModelConfigStore(): ModelConfigStore {
  if (!modelConfigStore) {
    throw new Error("模型配置存储尚未初始化。");
  }
  return modelConfigStore;
}

function requireModelUsageStore(): ModelUsageStore {
  if (!modelUsageStore) {
    throw new Error("模型用量存储尚未初始化。");
  }
  return modelUsageStore;
}

function requireChatAssistantProjectConfigStore(): ChatAssistantProjectConfigStore {
  if (!chatAssistantProjectConfigStore) {
    throw new Error("聊天助手项目配置存储尚未初始化。");
  }
  return chatAssistantProjectConfigStore;
}

function requireWorkspaceAgentConfigStore(): WorkspaceAgentConfigStore {
  if (!workspaceAgentConfigStore) {
    throw new Error("创作空间智能体设置存储尚未初始化。");
  }
  return workspaceAgentConfigStore;
}

function requireAgentTeamConfigStore(): AgentTeamConfigStore {
  if (!agentTeamConfigStore) {
    throw new Error("智能体团队设置存储尚未初始化。");
  }
  return agentTeamConfigStore;
}

function requireLibraryAgentConfigStore(): LibraryAgentConfigStore {
  if (!libraryAgentConfigStore) {
    throw new Error("资料库智能体设置存储尚未初始化。");
  }
  return libraryAgentConfigStore;
}

function requireLongAgentConfigStore(): LongAgentConfigStore {
  if (!longAgentConfigStore) {
    throw new Error("长篇智能体设置存储尚未初始化。");
  }
  return longAgentConfigStore;
}

function requireLongAgentTeamConfigStore(): LongAgentTeamConfigStore {
  if (!longAgentTeamConfigStore) {
    throw new Error("长篇智能体团队设置存储尚未初始化。");
  }
  return longAgentTeamConfigStore;
}

function requireLearningImitationConfigStore(): LearningImitationConfigStore {
  if (!learningImitationConfigStore) {
    throw new Error("学习仿写设置存储尚未初始化。");
  }
  return learningImitationConfigStore;
}

function requireWorkspaceDirectoryStore(): WorkspaceDirectoryStore {
  if (!workspaceDirectoryStore) {
    throw new Error("工作目录配置存储尚未初始化。");
  }
  return workspaceDirectoryStore;
}

function requireAppearanceConfigStore(): AppearanceConfigStore {
  if (!appearanceConfigStore) {
    throw new Error("外观设置存储尚未初始化。");
  }
  return appearanceConfigStore;
}

function requireGeneralSettingsStore(): GeneralSettingsStore {
  if (!generalSettingsStore) {
    throw new Error("常规设置存储尚未初始化。");
  }
  return generalSettingsStore;
}

function syncNativeAppearanceChrome(settings: AppearanceSettings): void {
  cachedAppearanceSettings = settings;
  applyNativeAppearanceChrome(settings);
  if (!nativeAppearanceListenerBound) {
    nativeAppearanceListenerBound = true;
    nativeTheme.on("updated", () => {
      if (cachedAppearanceSettings.mode === "system") {
        applyNativeAppearanceChrome(cachedAppearanceSettings);
      }
    });
  }
}

async function loadAndSyncNativeAppearanceChrome(): Promise<void> {
  try {
    const snapshot = await requireAppearanceConfigStore().list();
    syncNativeAppearanceChrome(snapshot.settings);
  } catch {
    syncNativeAppearanceChrome(createDefaultAppearanceSettings());
  }
}


function configureCatalogEnvironment(): string {
  const userDataPath = app.getPath("userData");
  process.env.DEEPWRITE_USER_DATA_PATH = userDataPath;
  process.env.DEEPWRITE_APP_MODE = resolveDeepWriteAppMode(
    import.meta.env.MAIN_VITE_DEEPWRITE_APP_MODE
  );

  const currentLegacyRoot = join(
    app.getPath("home"),
    "Library",
    "Application Support",
    "DeepWrite",
    ".data"
  );
  const configuredProjectRoot =
    process.env.DEEPWRITE_LEGACY_PROJECT_DATA_ROOT?.trim();
  const repositoryCandidates = [
    ...(configuredProjectRoot ? [resolve(configuredProjectRoot)] : []),
    join(app.getPath("home"), "project", "openwrite", "write-claw", ".data"),
    resolve(process.cwd(), "../openwrite/write-claw/.data"),
    resolve(app.getAppPath(), "../../../openwrite/write-claw/.data")
  ];
  const repositoryFallback =
    repositoryCandidates.find((candidate) => existsSync(candidate)) ??
    repositoryCandidates[0]!;
  const legacyDataRoots = [
    ...(existsSync(currentLegacyRoot) ? [currentLegacyRoot] : []),
    ...(existsSync(repositoryFallback) ? [repositoryFallback] : [])
  ].filter((root, index, roots) => roots.indexOf(root) === index);
  if (legacyDataRoots.length > 0) {
    process.env.DEEPWRITE_LEGACY_DATA_ROOT = legacyDataRoots[0];
    process.env.DEEPWRITE_LEGACY_DATA_ROOTS = JSON.stringify(legacyDataRoots);
  } else {
    delete process.env.DEEPWRITE_LEGACY_DATA_ROOT;
    delete process.env.DEEPWRITE_LEGACY_DATA_ROOTS;
  }
  return userDataPath;
}


function applyGeneralSettingsSnapshot(snapshot: { settings: GeneralSettings }): void {
  syncGeneralSettings(snapshot.settings);
}

function createIpcCommandContext(
  senderWebContentsId: number,
  window: BrowserWindow
): IpcCommandContext {
  const chooseDirectory = () =>
    chooseWorkspaceDirectory({
      requireWorkspaceDirectoryStore,
      getDocumentsPath: () => app.getPath("documents"),
      dialog
    });
  return {
    getMainWindow: () => window,
    supervisor,
    broadcastEvent,
    dialog,
    continuationImportPreviews,
    legacySyncPreviews,
    authorizeMainInternalCommand,
    activeRuns,
    pendingUsageContexts,
    terminalRuns,
    recordUsageObservation: (event) =>
      recordUsageObservation(event, modelUsageStore, activeRuns, pendingUsageContexts),
    requireModelConfigStore,
    requireModelUsageStore,
    requireChatAssistantProjectConfigStore,
    requireWorkspaceAgentConfigStore,
    requireAgentTeamConfigStore,
    requireLibraryAgentConfigStore,
    requireLongAgentConfigStore,
    requireLongAgentTeamConfigStore,
    requireLearningImitationConfigStore,
    requireWorkspaceDirectoryStore,
    requireAppearanceConfigStore,
    requireGeneralSettingsStore,
    exportShortManuscript,
    exportLongManuscript,
    listRemoteModels,
    resolveDraftApiKey: (input) => requireModelConfigStore().resolveDraftApiKey(input),
    readExternalSkills,
    importLegacyLibraryArchives,
    cachedAppearanceSettings: () => cachedAppearanceSettings,
    syncNativeAppearanceChrome,
    syncGeneralSettings: (settings) => applyGeneralSettingsSnapshot({ settings }),
    requireSelectedWorkspaceDirectory: () =>
      requireSelectedWorkspaceDirectory({
        requireWorkspaceDirectoryStore,
        chooseWorkspaceDirectory: chooseDirectory
      }),
    workspaceResourceParent,
    workspaceGroupParent,
    chooseWorkspaceDirectory: chooseDirectory,
    senderWebContentsId,
    getDocumentsPath: () => app.getPath("documents"),
    getAppVersion: () => app.getVersion()
  };
}

function registerIpc(): void {
  registerUpdateAlertIpc({
    getMainWindow: () => mainWindow,
    getUpdateService: () => updateService,
    getAppAlertStore: () => appAlertStore
  });
  registerMarketplaceIpc({
    getMainWindow: () => mainWindow,
    getMarketplaceClient: () => marketplaceClient
  });
  registerCloudBackupIpc(
    () => cloudBackupService,
    () => mainWindow
  );

  ipcMain.handle(
    IPC_COMMAND_CHANNEL,
    async (event, rawCommand: unknown): Promise<CommandResult> => {
      const requestId = extractCommandRequestId(rawCommand);
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents
      ) {
        return {
          status: "rejected",
          requestId,
          error: {
            code: "ipc.untrusted_sender",
            message: "IPC command sender is not the active DeepWrite window."
          }
        };
      }
      const parsed = CommandEnvelopeSchema.safeParse(rawCommand);
      if (!parsed.success) {
        const details = summarizeCommandValidationIssues(parsed.error.issues);
        const firstIssue = Array.isArray(details.issues)
          ? (details.issues[0] as { path?: string; message?: string } | undefined)
          : undefined;
        const issueHint =
          firstIssue?.path && firstIssue.message
            ? ` (${firstIssue.path}: ${firstIssue.message})`
            : "";
        console.error(
          `DeepWrite IPC rejected invalid command ${requestId}:`,
          details
        );
        return {
          status: "rejected",
          requestId,
          error: {
            code: "ipc.invalid_command",
            message: `Command envelope failed schema validation.${issueHint}`,
            details
          }
        };
      }

      return dispatchCommand(
        createIpcCommandContext(event.sender.id, mainWindow),
        parsed.data
      );
    }
  );
}

async function runAgentSmoke(health: ReturnType<typeof SystemHealthPayloadSchema.parse>): Promise<void> {
  const sessionId = "session_electron_smoke";
  const commandId = createId("cmd_smoke");
  const events: SystemEventEnvelope[] = [];
  let resolveTerminal: (() => void) | undefined;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });

  smokeEventTap = (event) => {
    if (isAgentEvent(event) && "sessionId" in event.payload && event.payload.sessionId === sessionId) {
      events.push(event);
      if (event.type === "agent.message_completed" || event.type === "agent.error") {
        resolveTerminal?.();
      }
    }
  };

  try {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId,
          message: "验证 DeepWrite Electron Faux 流式链路",
          thinkingLevel: "medium" as const,
          workspaceContext: {
            activeResource: {
              id: "chapter_smoke",
              domain: "creation" as const,
              title: "冒烟测试章节",
              path: ["测试作品", "冒烟测试章节"],
              format: "正文",
              source: "live-editor" as const,
              content: "这是发送瞬间的实时文稿。"
            }
          }
        },
        {
          id: commandId,
          context: { correlationId: commandId, sessionId, resourceId: "chapter_smoke" }
        }
      )
    );

    const result = await supervisor.requestCommand("agent", command);
    if (result.status === "rejected") {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
    await Promise.race([
      terminal,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent smoke timed out.")), 8_000)
      )
    ]);

    const completed = events.find((event) => event.type === "agent.message_completed");
    const errors = events.filter((event) => event.type === "agent.error");
    const deltas = events.filter((event) => event.type === "agent.message_delta");
    const thinking = events.filter((event) => event.type === "agent.thinking_delta");
    const deltaText = deltas
      .map((event) => event.type === "agent.message_delta" ? event.payload.delta : "")
      .join("");

    if (
      accepted.runtime.mode !== "local-faux" ||
      !completed ||
      errors.length > 0 ||
      deltas.length < 2 ||
      thinking.length < 1 ||
      (completed.type === "agent.message_completed" && completed.payload.content !== deltaText)
    ) {
      throw new Error("Agent smoke event assertions failed.");
    }

    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({
        health,
        agent: {
          status: "ok",
          runtime: accepted.runtime,
          deltaCount: deltas.length,
          thinkingDeltaCount: thinking.length,
          completed: true
        }
      })}`
    );
  } finally {
    smokeEventTap = undefined;
  }
}

async function announceReady(window: BrowserWindow): Promise<void> {
  const health = SystemHealthPayloadSchema.parse(await supervisor.collectHealth());
  const event = SystemReadyEventEnvelopeSchema.parse(
    createEnvelope("system.ready", health, { id: createId("evt_ready") })
  ) as SystemEventEnvelope;
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_EVENT_CHANNEL, event);
  }

  if (process.env.DEEPWRITE_SMOKE === "1") {
    try {
      await runAgentSmoke(health);
    } catch (error: unknown) {
      console.error(`DEEPWRITE_SMOKE_FAIL ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      app.quit();
    }
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  shutdownComplete = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindowStartupGate.requestShow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const userDataPath = configureCatalogEnvironment();
    modelConfigStore = new ModelConfigStore(userDataPath, {
      appVersion: app.getVersion()
    });
    modelUsageStore = new ModelUsageStore(userDataPath);
    softwareTokenUsageReporter = new SoftwareTokenUsageReporter(
      userDataPath,
      modelUsageStore
    );
    void softwareTokenUsageReporter.reportAtStartup().catch(() => {
      console.warn("DeepWrite software token usage was not reported at startup.");
    });
    void modelConfigStore.initialize();
    void modelConfigStore
      .list()
      .then((settings) => modelUsageStore?.syncConfiguredModels(settings.models))
      .catch((error: unknown) => {
        console.warn(
          "DeepWrite model usage registry could not initialize:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
    workspaceAgentConfigStore = new WorkspaceAgentConfigStore(userDataPath);
    agentTeamConfigStore = new AgentTeamConfigStore(userDataPath);
    libraryAgentConfigStore = new LibraryAgentConfigStore(userDataPath);
    longAgentConfigStore = new LongAgentConfigStore(userDataPath);
    longAgentTeamConfigStore = new LongAgentTeamConfigStore(userDataPath);
    learningImitationConfigStore = new LearningImitationConfigStore(userDataPath);
    workspaceDirectoryStore = new WorkspaceDirectoryStore(userDataPath);
    appearanceConfigStore = new AppearanceConfigStore(userDataPath);
    generalSettingsStore = new GeneralSettingsStore(userDataPath);
    chatAssistantProjectConfigStore = new ChatAssistantProjectConfigStore(
      userDataPath
    );
    await workspaceDirectoryStore.initializeDefault(app.getPath("documents"));
    await loadAndSyncNativeAppearanceChrome();
    syncGeneralSettings(
      (await generalSettingsStore.list()).settings
    );
    updateService = new UpdateService(() => {
      beginGracefulShutdown({ installUpdate: true });
    });
    appAlertStore = new AppAlertStore(userDataPath);
    cloudBackupService = new CloudBackupService(userDataPath, {
      getWorkspaceDirectory: async () => {
        const current = await requireWorkspaceDirectoryStore().list();
        return current.path;
      },
      registerCatalogProject: async ({ projectDirectory, domain }) => {
        const id = createId("cmd_cloud_backup_open");
        const command = CommandEnvelopeSchema.parse(
          createEnvelope(
            "catalog.openProjectAtPath",
            { projectDirectory, domain },
            { id, correlationId: id }
          )
        );
        const result = await supervisor.requestCommand("core", command, 0);
        if (result.status === "rejected") {
          throw new Error(result.error.message);
        }
      },
      registerLongBook: async (projectDirectory) => {
        const id = createId("cmd_cloud_backup_open_long");
        const command = CommandEnvelopeSchema.parse(
          createEnvelope(
            "long.openAtPath",
            { projectDirectory },
            { id, correlationId: id }
          )
        );
        const result = await supervisor.requestCommand("core", command, 0);
        if (result.status === "rejected") {
          throw new Error(result.error.message);
        }
      }
    });
    marketplaceClient = new MarketplaceClient(userDataPath, {
      loadCatalogSnapshot: async () => {
        const id = createId("cmd_marketplace_snapshot");
        const command = CommandEnvelopeSchema.parse(
          createEnvelope("catalog.snapshot", {}, { id, correlationId: id })
        );
        const result = await supervisor.requestCommand("core", command, 0);
        if (result.status === "rejected") {
          throw new Error(result.error.message);
        }
        return CatalogSnapshotSchema.parse(result.payload);
      },
      installPackage: async (input) => {
        const id = createId("cmd_marketplace_install");
        const command = CommandEnvelopeSchema.parse(
          createEnvelope("catalog.installMarketplaceSkillContent", input, {
            id,
            correlationId: id
          })
        );
        const result = await supervisor.requestCommand("core", command, 0);
        if (result.status === "rejected") {
          throw new Error(result.error.message);
        }
        return CatalogInstallMarketplaceSkillContentResultSchema.parse(
          result.payload
        );
      }
    });
    updateService.subscribe((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(UPDATE_STATE_EVENT_CHANNEL, state);
      }
    });
    registerIpc();
    supervisor.startAll();
    mainWindow = createMainWindow();
    mainWindowStartupGate.markReady();

    app.on("activate", () => {
      showMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownComplete) {
    return;
  }
  event.preventDefault();
  beginGracefulShutdown();
});
