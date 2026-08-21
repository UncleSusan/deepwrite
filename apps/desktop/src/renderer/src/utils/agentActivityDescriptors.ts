import {
  resolveScriptWorkspaceAgentIdForStage,
  resolveShortWorkspaceAgentIdForStage,
  type LibraryAgentSettings,
  type LongAgentSettings,
  type LongBookSummary,
  type WorkspaceAgentSettings
} from "@deepwrite/contracts";
import type { AgentActivityDescriptor } from "../types/agentActivity";
import type { WorkspaceDocument } from "../types/workspace";
import type { ResourceTreeLookup } from "./resourceTreeLookup";
import { agentConversationKeyForDocument } from "./agentRunPreferences";
import {
  LONG_WORKSPACE_ROOT_LABELS,
  longNavigationNodeId
} from "./longWorkspaceResourceTree";

export interface AgentActivityDescriptorSources {
  documents: readonly WorkspaceDocument[];
  resourceTree: ResourceTreeLookup;
  workspaceAgents: readonly WorkspaceAgentSettings[];
  longAgents: LongAgentSettings;
  libraryAgents: LibraryAgentSettings;
  longBooks: readonly LongBookSummary[];
}

function resourceIdForDocument(
  document: WorkspaceDocument,
  lookup: ResourceTreeLookup
): string {
  return lookup.resourceIdByDocumentId.get(document.id) ?? document.id;
}

function shortAgentLabel(
  document: WorkspaceDocument,
  settings: readonly WorkspaceAgentSettings[]
): string | undefined {
  if (
    !document.stageId ||
    (document.workspaceType !== "short" && document.workspaceType !== "script")
  ) {
    return undefined;
  }
  const agentId =
    document.shortAgentId ??
    (document.workspaceType === "script"
      ? resolveScriptWorkspaceAgentIdForStage(document.stageId)
      : resolveShortWorkspaceAgentIdForStage(document.stageId));
  return settings
    .find(({ workspaceType }) => workspaceType === document.workspaceType)
    ?.agents.find(({ id }) => id === agentId)?.label;
}

function resolveDocumentDescriptor(
  conversationKey: string,
  sources: AgentActivityDescriptorSources
): AgentActivityDescriptor | undefined {
  const document = sources.documents.find(
    (candidate) =>
      agentConversationKeyForDocument(candidate) === conversationKey
  );
  if (!document) return undefined;
  const libraryDomain =
    document.domain === "skill" || document.domain === "material"
      ? document.domain
      : undefined;
  const agentLabel = libraryDomain
    ? sources.libraryAgents.agents.find(
        ({ domain }) => domain === libraryDomain
      )?.label
    : shortAgentLabel(document, sources.workspaceAgents);
  const owner = document.workspaceTitle ?? document.path[0] ?? document.title;
  return {
    conversationKey,
    agentLabel: agentLabel ?? "智能体对话",
    contextLabel:
      owner === document.title ? owner : `${owner} · ${document.title}`,
    targetResourceId: resourceIdForDocument(document, sources.resourceTree)
  };
}

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function resolveLongDescriptor(
  conversationKey: string,
  sources: AgentActivityDescriptorSources
): AgentActivityDescriptor | undefined {
  const match = conversationKey.match(/^long:([^:]+):([^:]+):([^:]+):(.+)$/u);
  if (!match) return undefined;
  const bookId = decodeSegment(match[1]!);
  const agentId = match[2]!;
  const root = match[3]! as keyof typeof LONG_WORKSPACE_ROOT_LABELS;
  const chapterCardId = decodeSegment(match[4]!);
  if (!bookId || !(root in LONG_WORKSPACE_ROOT_LABELS)) return undefined;
  const book = sources.longBooks.find(({ id }) => id === bookId);
  const agent = sources.longAgents.agents.find(({ id }) => id === agentId);
  const matchingNode =
    chapterCardId && chapterCardId !== "__book__"
      ? [...sources.resourceTree.nodeById.values()].find(
          (node) =>
            node.longBookId === bookId &&
            node.longWorkspaceSelection?.root === root &&
            node.longWorkspaceSelection.chapterCardId === chapterCardId
        )
      : undefined;
  const rootResourceId = longNavigationNodeId(bookId, `root:${root}`);
  return {
    conversationKey,
    agentLabel: agent?.label ?? "长篇智能体",
    contextLabel: `${book?.title ?? "长篇作品"} · ${LONG_WORKSPACE_ROOT_LABELS[root]}`,
    targetResourceId:
      matchingNode?.id ??
      (sources.resourceTree.nodeById.has(rootResourceId)
        ? rootResourceId
        : longNavigationNodeId(bookId, "root:worldbuilding"))
  };
}

export function resolveAgentActivityDescriptor(
  conversationKey: string,
  sources: AgentActivityDescriptorSources
): AgentActivityDescriptor | undefined {
  return conversationKey.startsWith("long:")
    ? resolveLongDescriptor(conversationKey, sources)
    : resolveDocumentDescriptor(conversationKey, sources);
}
