import type { LongWorkspaceIndexSnapshot, LongWorkspaceOperationBatch } from "@deepwrite/contracts";
import { replaceLongBookSummary, type LongStructureMutationCompletion } from "../../types/longWorkspace";
import type { LongStructureLease } from "./lease";
import type { LongStructureMutationLease } from "./types";

export function createLongStructureSync(
  host: LongStructureLease,
  loadLongStructureMutationModule: () => Promise<typeof import("../../types/longStructureMutations")>
) {
  const {
    uiMessage, resources, session, state, resolveLongWorkspaceApi, isDisposed,
    captureLongStructureMutationTarget, mutationIsCurrent,
    assertCurrentLongStructureMutationTarget, withMutation
  } = host;
  const {
    longBooks, activeBookId: activeLongBookId, activeBookSummary: activeLongBookSummary,
    workspaceIndex: activeLongWorkspaceIndex, selection: activeLongSelection,
    structureDialogOpen: longStructureDialogOpen
  } = state;
  const {
    blockWritingPlan: blockActiveLongWritingPlan,
    saveActiveEditorChanges: saveActiveLongEditorChanges,
    refreshActiveWorkspace: refreshActiveLongWorkspace,
    refreshWritingSaveBarrier: refreshLongWritingSaveBarrier,
    editor: longWorkspaceEditor
  } = session;

  async function handleLongWorldbuildingSync(
    payload: { sourceBookId: string; sourceTitle: string },
    completion: LongStructureMutationCompletion
  ): Promise<void> {
    const expectedBookId = activeLongBookSummary.value?.id;
    await withMutation(
      expectedBookId,
      (message) => {
        uiMessage.warning(message);
        completion.fail(message);
      },
      async (lease) => {
        const api = resolveLongWorkspaceApi();
        const summary = activeLongBookSummary.value;
        const index = activeLongWorkspaceIndex.value;
        if (!api || !summary || !index) {
          const message = "当前长篇结构尚未就绪。";
          uiMessage.warning(message);
          completion.fail(message);
          return;
        }
        if (payload.sourceBookId === summary.id) {
          const message = "不能从当前长篇同步到自身。";
          uiMessage.warning(message);
          completion.fail(message);
          return;
        }
        try {
          const {
            buildLongWorldbuildingSyncBatch,
            filterSyncableWorldbuildingCategories,
            loadSourceWorldbuildingContents
          } = await import("../../utils/longWorldbuildingSync");
          assertCurrentLongStructureMutationTarget(lease.target, lease);
          if (!(await saveActiveLongEditorChanges())) {
            completion.fail("当前长篇修改尚未保存。");
            return;
          }
          if (!mutationIsCurrent(lease)) return;
          if (!captureLongStructureMutationTarget(lease.target.bookId)) {
            throw new Error("活动长篇已切换，本次世界观同步未保存。");
          }
          if (!(await refreshActiveLongWorkspace(lease.target.bookId))) {
            throw new Error("无法同步最新长篇结构，本次修改未保存。");
          }
          if (!mutationIsCurrent(lease)) return;
          const latestTarget = captureLongStructureMutationTarget(lease.target.bookId);
          const latestIndex = latestTarget?.index;
          if (!latestTarget || !latestIndex) {
            throw new Error("活动长篇已切换，本次世界观同步未保存。");
          }
          const source = await api.getWorkspaceIndex({ bookId: payload.sourceBookId });
          assertCurrentLongStructureMutationTarget(
            latestTarget, lease, "活动长篇或结构已切换，本次世界观同步未保存。"
          );
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
            (input) => api.readDocument(input), payload.sourceBookId, sourceCategories
          );
          assertCurrentLongStructureMutationTarget(
            latestTarget, lease, "活动长篇或结构已切换，本次世界观同步未保存。"
          );
          const plan = await buildLongWorldbuildingSyncBatch({
            target: latestIndex, source: source.workspaceIndex, contents
          });
          assertCurrentLongStructureMutationTarget(
            latestTarget, lease, "活动长篇或结构已切换，本次世界观同步未保存。"
          );
          await executeLongStructureMutation(lease, plan.batch, completion, {
            saveEditor: false,
            successMessage: `已从「${payload.sourceTitle}」同步世界观（${plan.createdCategoryCount} 个分类）`
          }, latestIndex);
        } catch (error: unknown) {
          if (isDisposed()) return;
          const message = error instanceof Error ? error.message : "同步世界观失败。";
          completion.fail(message);
          uiMessage.error(message);
        }
      }
    );
  }

  async function executeLongStructureMutation(
    lease: LongStructureMutationLease,
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion,
    options: { saveEditor?: boolean; successMessage?: string } = {},
    beforeIndex: LongWorkspaceIndexSnapshot = lease.target.index
  ): Promise<void> {
    const workspaceApi = resolveLongWorkspaceApi();
    if (!workspaceApi || !mutationIsCurrent(lease)) {
      if (!isDisposed()) {
        const message = "当前长篇结构尚未就绪。";
        uiMessage.warning(message);
        completion.fail(message);
      }
      return;
    }
    const expectedBookId = lease.target.bookId;
    const updatesItemLayout = batch.operations.some(
      (operation) => operation.type === "featureSettings.update"
    );
    if (updatesItemLayout && activeLongSelection.value) {
      activeLongSelection.value = {
        ...activeLongSelection.value,
        ...longWorkspaceEditor.value?.captureNavigationSelection()
      };
    }
    if (blockActiveLongWritingPlan("修改长篇结构")) {
      completion.fail("当前长篇串行写作计划尚未完成。");
      return;
    }
    if (options.saveEditor !== false && !(await saveActiveLongEditorChanges())) {
      if (mutationIsCurrent(lease)) completion.fail("当前长篇修改尚未保存。");
      return;
    }
    if (!mutationIsCurrent(lease)) return;
    if (!captureLongStructureMutationTarget(expectedBookId)) {
      const message = "活动长篇已切换，本次结构修改未保存。";
      completion.fail(message);
      uiMessage.warning(message);
      return;
    }
    try {
      if (!(await refreshActiveLongWorkspace(expectedBookId))) {
        throw new Error("无法同步最新长篇结构，本次修改未保存。");
      }
      if (!mutationIsCurrent(lease)) return;
      const latestSummary = activeLongBookSummary.value;
      const latestTarget = captureLongStructureMutationTarget(expectedBookId);
      const latestIndex = latestTarget?.index;
      if (!latestSummary || !latestTarget || !latestIndex || latestSummary.id !== expectedBookId) {
        throw new Error("活动长篇已切换，本次结构修改未保存。");
      }
      const baseProjectRevision =
        latestSummary.projectRevision ?? latestIndex.revision;
      const { rebaseLongStructureBatchAfterDocumentSave } =
        await loadLongStructureMutationModule();
      assertCurrentLongStructureMutationTarget(latestTarget, lease);
      const effectiveBatch = rebaseLongStructureBatchAfterDocumentSave({
        batch,
        before: beforeIndex,
        after: latestIndex
      });
      const preview = await workspaceApi.previewOperations({
        bookId: expectedBookId,
        batch: effectiveBatch
      });
      assertCurrentLongStructureMutationTarget(latestTarget, lease);
      if (preview.bookId !== expectedBookId || preview.projectRevision !== baseProjectRevision) {
        throw new Error("长篇结构已更新，请基于最新结构重新修改。");
      }
      assertCurrentLongStructureMutationTarget(latestTarget, lease);
      const applyResult = await workspaceApi.applyOperations({
        bookId: expectedBookId,
        batch: {
          ...effectiveBatch,
          expectedImpact: preview.preview.impact
        },
        baseProjectRevision
      });
      lease.applied = true;
      if (isDisposed()) return;
      if (
        applyResult.bookId !== expectedBookId ||
        activeLongBookId.value !== expectedBookId ||
        activeLongBookSummary.value?.id !== expectedBookId
      ) {
        throw new Error("活动长篇已切换，无法发布结构保存结果。");
      }
      longBooks.value = replaceLongBookSummary(longBooks.value, applyResult.summary);
      const refreshed = await refreshLongWritingSaveBarrier(expectedBookId);
      if (isDisposed()) return;
      if (!refreshed) {
        longStructureDialogOpen.value = false;
        completion.appliedButRefreshFailed("结构修改已保存，但界面未能同步最新结构。");
        uiMessage.warning("结构修改已保存，但界面未能同步最新结构；请重新打开长篇设置。");
        return;
      }
      if (updatesItemLayout) {
        resources.synchronizeSelectedResourceForLayout(expectedBookId);
      }
      completion.succeed();
      uiMessage.success(
        options.successMessage ?? `已直接保存 ${effectiveBatch.operations.length} 项长篇结构修改`
      );
    } catch (error: unknown) {
      if (isDisposed()) return;
      const message = error instanceof Error ? error.message : "保存长篇结构修改失败。";
      if (lease.applied) {
        longStructureDialogOpen.value = false;
        completion.appliedButRefreshFailed(message);
      } else {
        completion.fail(message);
      }
      uiMessage.error(message);
    }
  }

  return { handleLongWorldbuildingSync, executeLongStructureMutation };
}

export type LongStructureSync = ReturnType<typeof createLongStructureSync>;
