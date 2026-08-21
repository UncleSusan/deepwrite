import {
  createLongWorkspaceNavigationSnapshot,
  type LongBookSummary,
  type LongWorkspaceIndexSnapshot,
  type LongWriteDocumentResult
} from "@deepwrite/contracts";
import type { Ref, ShallowRef } from "vue";
import type {
  LongWorkspaceFileContext,
  LongWorkspaceRefreshStatus,
  LongWorkspaceRevisionSyncRequirement
} from "../stores/longWorkspaceStore";
import {
  reconcileLongWorkspaceSelection,
  replaceLongBookSummary,
  type LongWorkspaceRendererApi,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import {
  createLongWorkspaceRefreshClock,
  hasReachedLongWorkspaceRevisionTarget,
  isMonotonicLongWorkspaceRefresh
} from "../utils/longWorkspaceRefresh";

interface LongWorkspaceRefreshEditorPort {
  synchronizeProjectRevisions(
    workspaceRevision: number,
    projectRevision: number
  ): void;
  synchronizeProjectRevisionsIfClean(
    bookId: string,
    workspaceRevision: number,
    projectRevision: number
  ): boolean;
}

interface LongWorkspaceRefreshState {
  longBooks: Ref<readonly LongBookSummary[]>;
  activeBookId: Ref<string | null>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Ref<LongWorkspaceIndexSnapshot | null>;
  selection: Ref<LongWorkspaceSelection | null>;
  fileContext: Ref<LongWorkspaceFileContext | null>;
  refreshStatus: Ref<LongWorkspaceRefreshStatus | null>;
  activeRefreshStatus: Readonly<Ref<LongWorkspaceRefreshStatus | null>>;
  revisionRequirement: Ref<LongWorkspaceRevisionSyncRequirement | null>;
  activeRevisionRequirement: Readonly<
    Ref<LongWorkspaceRevisionSyncRequirement | null>
  >;
}

interface LongWorkspaceRefreshNotifications {
  error(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface LongWorkspaceRefreshCoordinatorOptions {
  state: LongWorkspaceRefreshState;
  editor: Readonly<ShallowRef<LongWorkspaceRefreshEditorPort | null>>;
  api(): LongWorkspaceRendererApi | undefined;
  isDisposed(): boolean;
  synchronizeSelectedResourceForLayout(bookId: string): void;
  notifications: LongWorkspaceRefreshNotifications;
}

interface RefreshActiveWorkspaceOptions {
  publishPending?: boolean;
}

/** Owns refresh ordering, revision adoption, and passive focus reconciliation. */
export function useLongWorkspaceRefreshCoordinator(
  options: LongWorkspaceRefreshCoordinatorOptions
) {
  const { state, editor, notifications } = options;
  const refreshClock = createLongWorkspaceRefreshClock();

  async function refreshActiveWorkspace(
    bookId: string,
    refreshOptions: RefreshActiveWorkspaceOptions = {}
  ): Promise<boolean> {
    if (options.isDisposed()) return false;
    const api = options.api();
    if (!api) return false;
    const requestId = refreshClock.begin(bookId);
    if (
      state.activeBookId.value === bookId &&
      refreshOptions.publishPending !== false
    ) {
      state.refreshStatus.value = {
        bookId,
        requestId,
        pending: true,
        error: null
      };
    }

    try {
      const result = await api.getWorkspaceIndex({ bookId });
      if (
        options.isDisposed() ||
        state.activeBookId.value !== bookId ||
        !refreshClock.isCurrent(bookId, requestId)
      ) {
        return false;
      }
      if (result.bookId !== bookId) {
        throw new Error("长篇工作区刷新返回了其他书籍。");
      }
      const currentSummary = state.activeBookSummary.value;
      if (!currentSummary || currentSummary.id !== bookId) {
        throw new Error("活动长篇摘要已经切换，无法发布刷新结果。");
      }
      const currentIndex = state.workspaceIndex.value;
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
        state.refreshStatus.value = null;
        return true;
      }

      const nextSummary: LongBookSummary = {
        ...currentSummary,
        projectRevision: result.projectRevision,
        updatedAt: result.workspaceIndex.updatedAt,
        navigation: createLongWorkspaceNavigationSnapshot(result.workspaceIndex)
      };
      const currentSelection = state.selection.value;
      const nextSelection = currentSelection
        ? (reconcileLongWorkspaceSelection(
            nextSummary,
            result.workspaceIndex,
            currentSelection
          ) ?? null)
        : null;
      const activeFileId = state.fileContext.value?.fileId;
      const nextFile = nextSelection?.files.find(
        ({ file }) => file.id === activeFileId
      )?.file;

      // Publish the matching index, summary, selection and file context as one
      // synchronous boundary so consumers never observe mixed revisions.
      state.workspaceIndex.value = result.workspaceIndex;
      state.longBooks.value = replaceLongBookSummary(
        state.longBooks.value,
        nextSummary
      );
      if (currentSelection) {
        state.selection.value = nextSelection;
        state.fileContext.value = nextFile
          ? {
              bookId,
              fileId: nextFile.id,
              fileRevision: nextFile.revision
            }
          : null;
      }
      options.synchronizeSelectedResourceForLayout(bookId);
      state.refreshStatus.value = null;
      return true;
    } catch (error: unknown) {
      if (
        !options.isDisposed() &&
        state.activeBookId.value === bookId &&
        refreshClock.isCurrent(bookId, requestId)
      ) {
        const message =
          error instanceof Error ? error.message : "刷新长篇工作区索引失败。";
        state.refreshStatus.value = {
          bookId,
          requestId,
          pending: false,
          error: message
        };
        notifications.error(message);
      }
      return false;
    }
  }

  function synchronizeRequiredRevision(bookId: string): boolean {
    const requirement = state.revisionRequirement.value;
    if (!requirement || requirement.bookId !== bookId) return true;
    const index = state.workspaceIndex.value;
    const summary = state.activeBookSummary.value;
    if (
      state.activeBookId.value !== bookId ||
      !index ||
      !summary ||
      summary.id !== bookId ||
      !hasReachedLongWorkspaceRevisionTarget(
        {
          workspaceRevision: index.revision,
          projectRevision: summary.projectRevision
        },
        requirement
      )
    ) {
      return false;
    }
    try {
      editor.value?.synchronizeProjectRevisions(
        index.revision,
        summary.projectRevision
      );
    } catch {
      return false;
    }
    state.revisionRequirement.value = null;
    return true;
  }

  function markRevisionSyncFailure(bookId: string): void {
    if (state.activeBookId.value !== bookId) return;
    if (state.activeRefreshStatus.value?.error) return;
    state.refreshStatus.value = {
      bookId,
      requestId: refreshClock.begin(bookId),
      pending: false,
      error:
        "账本回滚已经完成，但最新工作区版本尚未同步。正文编辑已锁定，请重新同步。"
    };
  }

  async function refreshAndSynchronizeRequiredRevision(
    bookId: string
  ): Promise<boolean> {
    const requirement = state.revisionRequirement.value;
    if (!requirement || requirement.bookId !== bookId) {
      return refreshActiveWorkspace(bookId);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refreshed = await refreshActiveWorkspace(bookId);
      if (synchronizeRequiredRevision(bookId)) return true;
      if (!refreshed && state.activeRefreshStatus.value?.error) break;
    }
    markRevisionSyncFailure(bookId);
    return false;
  }

  function handleDocumentSaved(result: LongWriteDocumentResult): void {
    void refreshActiveWorkspace(result.bookId);
  }

  async function retryActiveRefresh(): Promise<void> {
    const bookId = state.activeBookId.value;
    if (!bookId || state.activeRefreshStatus.value?.pending) return;
    if (state.activeRevisionRequirement.value) {
      if (await refreshAndSynchronizeRequiredRevision(bookId)) {
        notifications.success("已同步账本回滚后的最新版本，可以继续编辑正文。");
      }
      return;
    }
    await refreshActiveWorkspace(bookId);
  }

  async function refreshOnWindowFocus(bookId: string): Promise<void> {
    // A passive focus check must not toggle the editor's write barrier. If the
    // disk revision actually changed, normal document reconciliation still
    // protects dirty drafts and refreshes clean content.
    if (!(await refreshActiveWorkspace(bookId, { publishPending: false }))) {
      return;
    }
    const index = state.workspaceIndex.value;
    const summary = state.activeBookSummary.value;
    if (
      state.activeBookId.value !== bookId ||
      !index ||
      !summary ||
      summary.id !== bookId
    ) {
      return;
    }
    const synchronized =
      editor.value?.synchronizeProjectRevisionsIfClean(
        bookId,
        index.revision,
        summary.projectRevision
      ) ?? true;
    if (!synchronized) {
      notifications.warning(
        "长篇项目已在外部更新；当前有未保存内容，已保留编辑内容和原版本基线，请先保存并处理版本冲突。"
      );
    }
  }

  function invalidate(bookId: string): void {
    refreshClock.invalidate(bookId);
  }

  return {
    refreshActiveWorkspace,
    refreshAndSynchronizeRequiredRevision,
    handleDocumentSaved,
    retryActiveRefresh,
    refreshOnWindowFocus,
    invalidate
  };
}
