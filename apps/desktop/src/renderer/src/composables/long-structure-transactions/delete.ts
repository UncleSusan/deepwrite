import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { nextTick } from "vue";
import { createLongChapterSelection } from "../../types/longWorkspace";
import { longNavigationNodeId } from "../../utils/longWorkspaceResourceTree";
import { longDeletionDescription } from "../../utils/longDeletionImpact";
import { longImpactConfirmationDescription } from "../../utils/longImpactConfirmation";
import type { LongStructureLease } from "./lease";
import type { LongStructureSync } from "./sync";
import { isActiveLongTreeItem, resolveLongTreeItemDetails } from "./tree";

type MutationModule = typeof import("../../types/longStructureMutations");

export function createLongStructureDelete(
  host: LongStructureLease,
  sync: LongStructureSync,
  loadLongStructureMutationModule: () => Promise<MutationModule>
) {
  const {
    uiMessage,
    resources,
    session,
    state,
    isDisposed,
    assertCurrentLongStructureMutationTarget,
    withMutation,
    runTracked,
    mutationIsCurrent
  } = host;
  const { executeLongStructureMutation } = sync;
  const {
    activeBookId: activeLongBookId,
    activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex,
    selection: activeLongSelection,
    draftSectionDeleteTarget: longDraftSectionDelete,
    treeItemDeleteTarget: longTreeItemDelete,
    selectedResourceId
  } = state;
  const { selectWorkspaceFile: selectLongWorkspaceFile } = session;
  const resourceNode = resources.node;
  const selectResource = resources.select;

  async function buildNavigationDeleteBatch(
    index: LongWorkspaceIndexSnapshot,
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    }
  ): Promise<{
    batch: LongWorkspaceOperationBatch;
    label: string;
    title: string;
  }> {
    const { createLongStructureMutationBuilder } =
      await loadLongStructureMutationModule();
    const builder = createLongStructureMutationBuilder(index);
    if (input.kind === "character") {
      const target = index.characters.find(({ id }) => id === input.id);
      if (!target) throw new Error("该人物已不存在，请刷新后重试。");
      return {
        batch: builder.deleteCharacter(target.id),
        label: "人物",
        title: target.name
      };
    }
    if (input.kind === "volume") {
      const target = index.plot.volumes.find(({ id }) => id === input.id);
      if (!target) throw new Error("该分卷已不存在，请刷新后重试。");
      return {
        batch: builder.deleteVolume(target.id),
        label: "分卷",
        title: target.title
      };
    }
    if (input.kind === "plotPoint") {
      const target = index.plot.arcs.find(({ id }) => id === input.id);
      if (!target) throw new Error("该剧情点已不存在，请刷新后重试。");
      return {
        batch: builder.deleteArc(target.id),
        label: "剧情点",
        title: target.title
      };
    }
    const target = index.plot.chapterCards.find(({ id }) => id === input.id);
    if (!target) throw new Error("该章卡已不存在，请刷新后重试。");
    return {
      batch: builder.deleteChapter(target.id),
      label: "章卡",
      title: target.title
    };
  }

  async function confirmDeleteLongTreeItem(): Promise<void> {
    const pending = longTreeItemDelete.value;
    const target = pending?.node.longTreeItem;
    if (!pending || !target) return;
    await withMutation(
      pending.bookId,
      (message) => uiMessage.info(message),
      async (lease) => {
        const index = lease.target.index;
        const details = resolveLongTreeItemDetails(
          pending.bookId,
          index,
          pending.node
        );
        if (!details) {
          if (longTreeItemDelete.value === pending) {
            longTreeItemDelete.value = null;
          }
          uiMessage.warning("该条目已不存在，请刷新后重试。");
          return;
        }
        const currentIndex = details.orderedIds.indexOf(target.id);
        const fallbackItemId =
          details.orderedIds[currentIndex + 1] ??
          details.orderedIds[currentIndex - 1];
        const fallbackResourceId = fallbackItemId
          ? details.resourceIdForItem(fallbackItemId)
          : details.parentResourceId;
        const deletedSelected =
          selectedResourceId.value === pending.node.id ||
          isActiveLongTreeItem(pending.node, activeLongSelection.value);
        let batch: LongWorkspaceOperationBatch;
        try {
          const { createLongStructureMutationBuilder } =
            await loadLongStructureMutationModule();
          assertCurrentLongStructureMutationTarget(lease.target, lease);
          const builder = createLongStructureMutationBuilder(index);
          if (target.kind === "worldbuilding-item") {
            if (!target.parentId) throw new Error("缺少世界观分类 ID。");
            batch = builder.deleteWorldbuildingItem(target.parentId, target.id);
          } else if (target.kind === "character") {
            batch = builder.deleteCharacter(target.id);
          } else if (target.kind === "volume") {
            batch = builder.deleteVolume(target.id);
          } else if (target.kind === "plot-point") {
            batch = builder.deleteArc(target.id);
          } else {
            batch = builder.deleteChapter(target.id);
          }
        } catch (error: unknown) {
          if (isDisposed()) return;
          uiMessage.warning(
            error instanceof Error
              ? error.message
              : `无法删除“${details.title}”。`
          );
          return;
        }
        let succeeded = false;
        let applied = false;
        await executeLongStructureMutation(
          lease,
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
            successMessage: `已删除${details.label}“${details.title}”`,
            expectedImpact: pending.expectedImpact,
            onImpactChanged: (expectedImpact) => {
              const latestIndex = activeLongWorkspaceIndex.value;
              const latestDetails = latestIndex
                ? resolveLongTreeItemDetails(
                    pending.bookId,
                    latestIndex,
                    pending.node
                  )
                : null;
              if (longTreeItemDelete.value !== pending || !latestDetails)
                return;
              longTreeItemDelete.value = {
                ...pending,
                description: longImpactConfirmationDescription(
                  expectedImpact,
                  latestDetails.description
                ),
                expectedImpact
              };
            }
          },
          index
        );
        if (!applied || isDisposed()) return;
        if (longTreeItemDelete.value === pending) {
          longTreeItemDelete.value = null;
        }
        if (!succeeded || !deletedSelected || !mutationIsCurrent(lease)) return;
        await nextTick();
        if (!mutationIsCurrent(lease)) return;
        const fallbackNode = resourceNode(fallbackResourceId);
        if (fallbackNode) await selectResource(fallbackNode);
      }
    );
  }

  async function deleteLongNavigationStructure(
    expectedBookId: string,
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void,
    isTargetCurrent: () => boolean = () => true
  ): Promise<void> {
    await withMutation(
      expectedBookId,
      (message) => {
        uiMessage.warning(message);
        completion(false);
      },
      async (lease) => {
        const index = lease.target.index;
        let deletion: Awaited<ReturnType<typeof buildNavigationDeleteBatch>>;
        try {
          assertCurrentLongStructureMutationTarget(lease.target, lease);
          if (!isTargetCurrent()) {
            throw new Error("删除目标已切换，本次操作已取消。");
          }
          deletion = await buildNavigationDeleteBatch(index, input);
          assertCurrentLongStructureMutationTarget(lease.target, lease);
          if (!isTargetCurrent()) {
            throw new Error("删除目标已切换，本次操作已取消。");
          }
        } catch (error: unknown) {
          if (isDisposed()) return;
          uiMessage.warning(
            error instanceof Error
              ? error.message
              : `无法删除“${input.title}”。`
          );
          completion(false);
          return;
        }
        let changedImpact: LongWorkspaceImpactConfirmation | undefined;
        await executeLongStructureMutation(
          lease,
          deletion.batch,
          {
            succeed: () => completion(true),
            fail: () => completion(false, changedImpact),
            appliedButRefreshFailed: () => completion(true)
          },
          {
            successMessage: `已删除${deletion.label}“${deletion.title}”`,
            expectedImpact: input.expectedImpact,
            onImpactChanged: (impact) => {
              changedImpact = impact;
            }
          },
          index
        );
      }
    );
  }

  async function confirmDeleteLongDraftSection(): Promise<void> {
    const pending = longDraftSectionDelete.value;
    if (!pending) return;
    await deleteLongNavigationStructure(
      pending.bookId,
      {
        kind: "chapterCard",
        id: pending.chapterCardId,
        title: pending.title,
        expectedImpact: pending.expectedImpact
      },
      (succeeded, changedImpact) => {
        if (!succeeded && changedImpact) {
          const latestIndex = activeLongWorkspaceIndex.value;
          if (latestIndex && longDraftSectionDelete.value === pending) {
            longDraftSectionDelete.value = {
              ...pending,
              description: longImpactConfirmationDescription(
                changedImpact,
                longDeletionDescription(
                  latestIndex,
                  "chapterCard",
                  pending.chapterCardId
                )
              ),
              expectedImpact: changedImpact
            };
          }
          return;
        }
        if (!succeeded || isDisposed()) return;
        const deletedSelected =
          activeLongSelection.value?.chapterCardId === pending.chapterCardId ||
          selectedResourceId.value ===
            longNavigationNodeId(
              pending.bookId,
              `chapter:${pending.chapterCardId}`
            );
        if (longDraftSectionDelete.value === pending) {
          longDraftSectionDelete.value = null;
        }
        if (!deletedSelected) return;
        const summary = activeLongBookSummary.value;
        const index = activeLongWorkspaceIndex.value;
        if (!summary || !index || summary.id !== pending.bookId) return;
        const remaining = summary.navigation.chapterCards
          .filter((chapter) => chapter.volumeId === pending.volumeId)
          .sort(
            (left, right) =>
              left.narrativeOrder - right.narrativeOrder ||
              left.id.localeCompare(right.id)
          );
        const next = remaining[0];
        if (next) {
          const selection = createLongChapterSelection(summary, index, next.id);
          if (selection) {
            selectedResourceId.value = longNavigationNodeId(
              pending.bookId,
              selection.key
            );
            void runTracked(() => selectLongWorkspaceFile(selection)).catch(
              (error: unknown) => {
                if (isDisposed()) return;
                uiMessage.error(
                  error instanceof Error
                    ? error.message
                    : "小节已删除，但无法打开下一小节。"
                );
              }
            );
            return;
          }
        }
        selectedResourceId.value = longNavigationNodeId(
          pending.bookId,
          `volume:${pending.volumeId}`
        );
      },
      () => longDraftSectionDelete.value === pending
    );
  }

  async function deleteActiveLongNavigationStructure(
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void
  ): Promise<void> {
    const expectedBookId = activeLongBookId.value;
    if (!expectedBookId) {
      uiMessage.warning("当前长篇结构尚未就绪。");
      completion(false);
      return;
    }
    await deleteLongNavigationStructure(expectedBookId, input, completion);
  }

  async function previewActiveLongNavigationStructure(
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ): Promise<void> {
    const expectedBookId = activeLongBookId.value;
    const index = activeLongWorkspaceIndex.value;
    if (!expectedBookId || !index) {
      uiMessage.warning("当前长篇结构尚未就绪。");
      completion();
      return;
    }
    await runTracked(async () => {
      try {
        const deletion = await buildNavigationDeleteBatch(index, input);
        if (
          isDisposed() ||
          activeLongBookId.value !== expectedBookId ||
          activeLongWorkspaceIndex.value !== index
        ) {
          completion();
          return;
        }
        const impact = await sync.previewLongStructureImpact(
          expectedBookId,
          deletion.batch
        );
        if (
          isDisposed() ||
          activeLongBookId.value !== expectedBookId ||
          activeLongWorkspaceIndex.value !== index
        ) {
          completion();
          return;
        }
        completion(impact);
      } catch (error: unknown) {
        if (isDisposed()) return;
        uiMessage.warning(
          error instanceof Error
            ? error.message
            : `无法核对“${input.title}”的删除影响。`
        );
        completion();
      }
    });
  }

  return {
    confirmDeleteLongTreeItem,
    confirmDeleteLongDraftSection,
    deleteLongNavigationStructure,
    deleteActiveLongNavigationStructure,
    previewActiveLongNavigationStructure
  };
}

export type LongStructureDelete = ReturnType<typeof createLongStructureDelete>;
