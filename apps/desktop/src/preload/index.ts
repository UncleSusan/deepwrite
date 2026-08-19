import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_EVENT_CHANNEL,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  createEnvelope,
  type DeepWriteApi,
  type SystemEventEnvelope,
  type SystemHealthPayload
} from "@deepwrite/contracts";

import {
  chooseExternalSkills,
  createDraftSection,
  createDraftSections,
  createLibrary,
  createLibraryEntry,
  createLibraryGroup,
  createScriptBook,
  createShortBook,
  deleteBook,
  deleteDraftSection,
  deleteProject,
  duplicateProject,
  getCatalogIndex,
  getCatalogSnapshot,
  importLegacyLibrary,
  loadDraftRecovery,
  moveDraftSection,
  moveLibraryEntry,
  mutateCharacterStructure,
  mutatePlotStructure,
  openProject,
  readCatalogDocument,
  removeLibraryEntry,
  saveDocument,
  saveDraftRecovery,
  saveLibraryEntry,
  unregisterProject,
  updateBook,
  updateLibrary,
  updateLibraryGroup
} from "./catalog-api";
import {
  appAlerts,
  cloudBackup,
  loadConversationPersistence,
  marketplace,
  removeConversationPersistence,
  saveConversationPersistence,
  updates
} from "./extras-api";
import { browserId, invokeCommand } from "./invoke";
import { long } from "./long-api";
import {
  chatAssistantProjectConfig,
  clearOfficialModelToken,
  listModels,
  listRemoteModels,
  modelUsage,
  queryOfficialModelBalance,
  refreshFreeModels,
  refreshOfficialModels,
  saveModels,
  saveOfficialModelToken,
  session,
  setOfficialModelEnabled,
  testModel
} from "./session-models-api";
import {
  chooseWorkspaceDirectory,
  exportLongManuscript,
  exportShortManuscript,
  listAgentTeams,
  listAppearance,
  listGeneralSettings,
  listLearningImitationSettings,
  listLibraryAgents,
  listLongAgentTeams,
  listLongAgents,
  listWorkspaceAgents,
  listWorkspaceDirectory,
  resetLearningImitationSettings,
  resetLibraryAgents,
  resetLongAgents,
  resetWorkspaceAgents,
  saveAgentTeams,
  saveAppearance,
  saveGeneralSettings,
  saveLearningImitationSettings,
  saveLibraryAgents,
  saveLongAgentTeams,
  saveLongAgents,
  saveWorkspaceAgents
} from "./settings-api";

async function getHealth(): Promise<SystemHealthPayload> {
  const id = browserId("cmd_health");
  return SystemHealthPayloadSchema.parse(
    await invokeCommand<SystemHealthPayload>(
      createEnvelope("system.health", {}, { id, correlationId: id })
    )
  );
}

const api: DeepWriteApi = {
  system: {
    health: getHealth
  },
  conversationPersistence: {
    load: loadConversationPersistence,
    save: saveConversationPersistence,
    remove: removeConversationPersistence
  },
  updates,
  appAlerts,
  marketplace,
  cloudBackup,
  catalog: {
    index: getCatalogIndex,
    readDocument: readCatalogDocument,
    snapshot: getCatalogSnapshot,
    loadDraftRecovery,
    saveDraftRecovery,
    createShortBook,
    createScriptBook,
    createLibrary,
    updateLibrary,
    createLibraryGroup,
    openProject,
    importLegacyLibrary,
    updateBook,
    mutateCharacterStructure,
    mutatePlotStructure,
    updateLibraryGroup,
    deleteBook,
    saveDocument,
    createDraftSection,
    createDraftSections,
    deleteDraftSection,
    moveDraftSection,
    saveLibraryEntry,
    createLibraryEntry,
    chooseExternalSkills,
    removeLibraryEntry,
    moveLibraryEntry,
    unregisterProject,
    deleteProject,
    duplicateProject
  },
  long,
  session,
  models: {
    list: listModels,
    refreshFree: refreshFreeModels,
    refreshOfficial: refreshOfficialModels,
    queryOfficialBalance: queryOfficialModelBalance,
    saveOfficialToken: saveOfficialModelToken,
    clearOfficialToken: clearOfficialModelToken,
    setOfficialModelEnabled,
    save: saveModels,
    test: testModel,
    listRemote: listRemoteModels
  },
  modelUsage,
  chatAssistantProjectConfig,
  workspaceAgents: {
    list: listWorkspaceAgents,
    save: saveWorkspaceAgents,
    reset: resetWorkspaceAgents
  },
  longAgents: {
    list: listLongAgents,
    save: saveLongAgents,
    reset: resetLongAgents
  },
  longAgentTeams: {
    list: listLongAgentTeams,
    save: saveLongAgentTeams
  },
  agentTeams: {
    list: listAgentTeams,
    save: saveAgentTeams
  },
  libraryAgents: {
    list: listLibraryAgents,
    save: saveLibraryAgents,
    reset: resetLibraryAgents
  },
  learningImitationSettings: {
    list: listLearningImitationSettings,
    save: saveLearningImitationSettings,
    reset: resetLearningImitationSettings
  },
  workspaceDirectory: {
    list: listWorkspaceDirectory,
    choose: chooseWorkspaceDirectory
  },
  appearance: {
    list: listAppearance,
    save: saveAppearance
  },
  generalSettings: {
    list: listGeneralSettings,
    save: saveGeneralSettings
  },
  manuscript: {
    exportLong: exportLongManuscript,
    exportShort: exportShortManuscript
  },
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown): void => {
        const parsed = SystemEventEnvelopeSchema.safeParse(rawEvent);
        if (!parsed.success) {
          console.warn("DeepWrite discarded an invalid desktop event.");
          return;
        }
        listener(parsed.data as SystemEventEnvelope);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    }
  }
};

contextBridge.exposeInMainWorld("deepwrite", api);
