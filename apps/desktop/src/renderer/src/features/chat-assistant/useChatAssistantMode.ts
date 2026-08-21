import type {
  CatalogIndexSnapshot,
  ChatAssistantMode,
  ChatAssistantProjectConfig,
  ChatAssistantProjectRef,
  ChatAssistantRequestContext,
  LongBookSummary
} from "@deepwrite/contracts";
import { computed, ref, shallowRef, type Ref } from "vue";
import type { AgentConversationController } from "../../composables/useAgentConversation";

const MODE_STORAGE_KEY = "deepwrite:chat-assistant-mode:v1";
const PROJECT_STORAGE_KEY = "deepwrite:chat-assistant-project:v1";

export interface ChatAssistantProjectOption {
  key: string;
  label: string;
  project: ChatAssistantProjectRef;
  available: boolean;
}

export interface ChatAssistantModeOptions {
  conversationForKey(key: string, scope?: string): AgentConversationController;
  catalogSnapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
  longBooks: Readonly<Ref<readonly LongBookSummary[]>>;
}

function projectKey(project: ChatAssistantProjectRef): string {
  return `${project.projectType}:${project.projectId}`;
}

function readMode(): ChatAssistantMode {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === "project"
      ? "project"
      : "normal";
  } catch {
    return "normal";
  }
}

function readProject(): ChatAssistantProjectRef | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(PROJECT_STORAGE_KEY) ?? "null"
    ) as Partial<ChatAssistantProjectRef> | null;
    if (
      value &&
      (value.projectType === "short" ||
        value.projectType === "script" ||
        value.projectType === "long") &&
      typeof value.projectId === "string" &&
      value.projectId.trim()
    ) {
      return {
        projectType: value.projectType,
        projectId: value.projectId.trim()
      };
    }
  } catch {
    // Ignore damaged local UI preferences.
  }
  return null;
}

function persistPreference(
  mode: ChatAssistantMode,
  project: ChatAssistantProjectRef | null
): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    if (project) {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
    }
  } catch {
    // Local preferences are optional; the active in-memory state remains valid.
  }
}

export function useChatAssistantMode(options: ChatAssistantModeOptions) {
  const mode = ref<ChatAssistantMode>(readMode());
  const selectedProject = ref<ChatAssistantProjectRef | null>(readProject());
  const configuredProjects = ref<readonly ChatAssistantProjectRef[]>([]);
  const controller = shallowRef<AgentConversationController | null>(null);

  const projectOptions = computed<readonly ChatAssistantProjectOption[]>(() => [
    ...(options.catalogSnapshot.value?.books ?? []).map((book) => ({
      key: projectKey({ projectType: book.bookType, projectId: book.id }),
      label: book.title,
      project: { projectType: book.bookType, projectId: book.id },
      available: true
    })),
    ...options.longBooks.value.map((book) => ({
      key: projectKey({ projectType: "long", projectId: book.id }),
      label: book.title,
      project: { projectType: "long" as const, projectId: book.id },
      available: true
    }))
  ]);

  const configuredProjectOptions = computed<
    readonly ChatAssistantProjectOption[]
  >(() =>
    configuredProjects.value.map((project) => {
      const key = projectKey(project);
      const live = projectOptions.value.find((option) => option.key === key);
      return (
        live ?? {
          key,
          label: `已失效项目（${project.projectId}）`,
          project,
          available: false
        }
      );
    })
  );

  const selectedProjectKey = computed(() =>
    selectedProject.value ? projectKey(selectedProject.value) : ""
  );
  const selectedProjectOption = computed(
    () =>
      projectOptions.value.find(
        ({ key }) => key === selectedProjectKey.value
      ) ?? null
  );
  const selectedConfiguredProjectOption = computed(
    () =>
      configuredProjectOptions.value.find(
        ({ key }) => key === selectedProjectKey.value
      ) ?? selectedProjectOption.value
  );
  const projectAvailable = computed(
    () => mode.value !== "project" || selectedProjectOption.value !== null
  );
  const isBusy = computed(() => controller.value?.isBusy.value ?? false);
  const requestContext = computed<ChatAssistantRequestContext | null>(() => {
    if (mode.value === "normal") return { mode: "normal" };
    if (!selectedProject.value || !projectAvailable.value) return null;
    return { mode: "project", project: selectedProject.value };
  });

  function controllerIdentity(): { key: string; scope: string } {
    if (mode.value === "normal") {
      return { key: "chat-assistant:normal", scope: "assistant-chat:normal" };
    }
    const suffix = selectedProject.value
      ? projectKey(selectedProject.value)
      : "unselected";
    return {
      key: `chat-assistant:project:${suffix}`,
      scope: `assistant-chat:project:${suffix}`
    };
  }

  function activateController(): AgentConversationController {
    const identity = controllerIdentity();
    controller.value = options.conversationForKey(identity.key, identity.scope);
    return controller.value;
  }

  function setMode(nextMode: ChatAssistantMode): boolean {
    if (nextMode === mode.value) return true;
    if (isBusy.value) return false;
    mode.value = nextMode;
    persistPreference(mode.value, selectedProject.value);
    activateController();
    return true;
  }

  function selectProject(key: string): boolean {
    if (isBusy.value) return false;
    const option =
      configuredProjectOptions.value.find(
        (candidate) => candidate.key === key
      ) ?? projectOptions.value.find((candidate) => candidate.key === key);
    if (!option) return false;
    selectedProject.value = option.project;
    persistPreference(mode.value, selectedProject.value);
    if (mode.value === "project") activateController();
    return true;
  }

  async function refreshConfiguredProjects(): Promise<boolean> {
    const api = window.deepwrite?.chatAssistantProjectConfig;
    if (!api) return false;
    try {
      configuredProjects.value = await api.list();
      return true;
    } catch {
      return false;
    }
  }

  async function sendAssistantMessage(webSearchEnabled = false): Promise<void> {
    const context = requestContext.value;
    if (!context || !controller.value) return;
    await controller.value.sendAssistantMessage(
      webSearchEnabled ? { ...context, webSearchEnabled: true } : context
    );
  }

  function requireProject(): ChatAssistantProjectRef {
    if (!selectedProject.value || !projectAvailable.value) {
      throw new Error("当前项目不可用，请重新选择项目。");
    }
    return selectedProject.value;
  }

  async function loadProjectConfig(
    project: ChatAssistantProjectRef = requireProject()
  ): Promise<ChatAssistantProjectConfig> {
    const api = window.deepwrite?.chatAssistantProjectConfig;
    if (!api) throw new Error("桌面桥接尚未就绪，请稍后重试。");
    return api.get(project);
  }

  async function saveProjectConfig(
    systemPrompt: string,
    project: ChatAssistantProjectRef = requireProject()
  ): Promise<ChatAssistantProjectConfig> {
    const api = window.deepwrite?.chatAssistantProjectConfig;
    if (!api) throw new Error("桌面桥接尚未就绪，请稍后重试。");
    return api.save(project, systemPrompt);
  }

  async function resetProjectConfig(
    project: ChatAssistantProjectRef = requireProject()
  ): Promise<ChatAssistantProjectConfig> {
    const api = window.deepwrite?.chatAssistantProjectConfig;
    if (!api) throw new Error("桌面桥接尚未就绪，请稍后重试。");
    return api.reset(project);
  }

  activateController();
  void refreshConfiguredProjects();

  return {
    mode: mode as Readonly<Ref<ChatAssistantMode>>,
    selectedProject: selectedProject as Readonly<
      Ref<ChatAssistantProjectRef | null>
    >,
    selectedProjectKey,
    selectedProjectOption,
    selectedConfiguredProjectOption,
    projectOptions,
    configuredProjects: configuredProjects as Readonly<
      Ref<readonly ChatAssistantProjectRef[]>
    >,
    configuredProjectOptions,
    projectAvailable,
    requestContext,
    controller: controller as Readonly<Ref<AgentConversationController>>,
    isBusy,
    setMode,
    selectProject,
    refreshConfiguredProjects,
    sendAssistantMessage,
    loadProjectConfig,
    saveProjectConfig,
    resetProjectConfig
  };
}

export type ChatAssistantModeFeature = ReturnType<typeof useChatAssistantMode>;
