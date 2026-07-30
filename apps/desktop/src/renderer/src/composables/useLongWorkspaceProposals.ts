import { ref, type Ref } from "vue";
import {
  LongMutationProposalEventEnvelopeSchema,
  LongWorkspaceOperationBatchSchema,
  createEnvelope,
  type AgentWriteApprovalMode,
  type LongAgentId,
  type LongWorkspaceImpactPreview,
  type LongWorkspaceOperationBatch,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import { createKeyedSerialTaskQueue } from "../utils/keyedSerialTaskQueue";

export type LongWorkspaceProposalEvent = Extract<
  SystemEventEnvelope,
  {
    type:
      | "long.mutation_proposal"
      | "long.worldbuilding_file_proposal"
      | "long.chapter_dispatch_proposal"
      | "long.chapter_write_proposal"
      | "long.ledger_commit_proposal";
  }
>;

export type LongMutationProposalEvent = Extract<
  LongWorkspaceProposalEvent,
  { type: "long.mutation_proposal" }
>;

export type LongWorldbuildingFileProposalEvent = Extract<
  LongWorkspaceProposalEvent,
  { type: "long.worldbuilding_file_proposal" }
>;

export type LongWorkspaceProposalStatus =
  | "previewing"
  | "waiting"
  | "ready"
  | "submitting"
  | "error"
  | "accepted";

export interface LongWorkspaceProposalItem {
  event: LongWorkspaceProposalEvent;
  approvalMode: AgentWriteApprovalMode;
  status: LongWorkspaceProposalStatus;
  preview?: LongWorkspaceImpactPreview;
  previewProjectRevision?: number;
  effectiveBatch?: LongWorkspaceOperationBatch;
  effectiveProjectRevision?: number;
  error?: string;
}

interface LongProposalNotifications {
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

export interface UseLongWorkspaceProposalsOptions {
  api: () => LongWorkspaceRendererApi | undefined;
  acceptsEvent: (event: LongWorkspaceProposalEvent) => boolean;
  approvalModeForEvent?: (
    event: LongWorkspaceProposalEvent
  ) => AgentWriteApprovalMode | undefined;
  prepareAutoApprove?: (
    event: LongWorkspaceProposalEvent
  ) => void | Promise<void>;
  onApplied?: (
    event: Exclude<
      LongWorkspaceProposalEvent,
      { type: "long.chapter_dispatch_proposal" }
    >
  ) => void | Promise<void>;
  onDispatchApproved?: (
    event: Extract<
      LongWorkspaceProposalEvent,
      { type: "long.chapter_dispatch_proposal" }
    >
  ) => void | Promise<void>;
  onRejected?: (event: LongWorkspaceProposalEvent) => void;
  notifications: LongProposalNotifications;
}

export interface EnqueueManualLongMutationInput {
  bookId: string;
  agentId?: LongAgentId;
  batch: LongWorkspaceOperationBatch;
  baseProjectRevision: number;
  summary: string;
}

export interface LongWorkspaceProposalController {
  queues: Ref<Record<string, LongWorkspaceProposalItem[]>>;
  itemsForBook(bookId: string | null | undefined): LongWorkspaceProposalItem[];
  activateBook(bookId: string): void;
  discardBook(bookId: string): void;
  quarantineSession(bookId: string, sessionId: string): void;
  handleEvent(event: SystemEventEnvelope): Promise<boolean>;
  enqueueManualMutation(
    input: EnqueueManualLongMutationInput
  ): Promise<LongMutationProposalEvent>;
  retryPreview(bookId: string, eventId: string): Promise<void>;
  approve(bookId: string, eventId: string): Promise<void>;
  reject(bookId: string, eventId: string): boolean;
}

const LONG_PROPOSAL_TYPES = new Set<SystemEventEnvelope["type"]>([
  "long.mutation_proposal",
  "long.worldbuilding_file_proposal",
  "long.chapter_dispatch_proposal",
  "long.chapter_write_proposal",
  "long.ledger_commit_proposal"
]);

function isLongProposalEvent(
  event: SystemEventEnvelope
): event is LongWorkspaceProposalEvent {
  return LONG_PROPOSAL_TYPES.has(event.type);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useLongWorkspaceProposals(
  options: UseLongWorkspaceProposalsOptions
): LongWorkspaceProposalController {
  const queues = ref<Record<string, LongWorkspaceProposalItem[]>>({});
  const handledEventIds = new Set<string>();
  const handledProposalKeys = new Set<string>();
  const discardedBookIds = new Set<string>();
  const quarantinedSessions = new Set<string>();
  const automaticProposalQueue = createKeyedSerialTaskQueue<string>();

  function sessionKey(bookId: string, sessionId: string): string {
    return `${bookId}\u0000${sessionId}`;
  }

  function proposalKey(event: LongWorkspaceProposalEvent): string {
    return [
      event.type,
      event.payload.bookId,
      event.payload.sessionId,
      event.payload.runId,
      event.payload.toolCallId
    ].join("\u0000");
  }

  function itemsForBook(
    bookId: string | null | undefined
  ): LongWorkspaceProposalItem[] {
    return bookId ? queues.value[bookId] ?? [] : [];
  }

  function setBookItems(
    bookId: string,
    items: LongWorkspaceProposalItem[]
  ): void {
    const pending = items.filter(({ status }) => status !== "accepted");
    const accepted = items
      .filter(({ status }) => status === "accepted")
      .slice(-100);
    const retained = [...pending, ...accepted].sort(
      (left, right) =>
        left.event.timestamp.localeCompare(right.event.timestamp)
    );
    const next = { ...queues.value };
    if (retained.length) {
      next[bookId] = retained;
    } else {
      delete next[bookId];
    }
    queues.value = next;
  }

  function activateBook(bookId: string): void {
    discardedBookIds.delete(bookId);
  }

  function discardBook(bookId: string): void {
    discardedBookIds.add(bookId);
    setBookItems(bookId, []);
  }

  function quarantineSession(bookId: string, sessionId: string): void {
    quarantinedSessions.add(sessionKey(bookId, sessionId));
    while (quarantinedSessions.size > 2_000) {
      const oldest = quarantinedSessions.values().next().value as
        | string
        | undefined;
      if (!oldest) break;
      quarantinedSessions.delete(oldest);
    }
    setBookItems(
      bookId,
      itemsForBook(bookId).filter(
        (item) => item.event.payload.sessionId !== sessionId
      )
    );
  }

  function updateItem(
    bookId: string,
    eventId: string,
    patch: Partial<Omit<LongWorkspaceProposalItem, "event">> & {
      clearError?: boolean;
    }
  ): void {
    setBookItems(
      bookId,
      itemsForBook(bookId).map((item) => {
        if (item.event.id !== eventId) return item;
        const { clearError, ...values } = patch;
        const next = { ...item, ...values };
        if (clearError) delete next.error;
        return next;
      })
    );
  }

  function removeItem(bookId: string, eventId: string): void {
    setBookItems(
      bookId,
      itemsForBook(bookId).filter((item) => item.event.id !== eventId)
    );
  }

  function currentItem(
    bookId: string,
    eventId: string
  ): LongWorkspaceProposalItem | undefined {
    return itemsForBook(bookId).find(
      (item) => item.event.id === eventId
    );
  }

  function pendingFilePredecessor(
    item: LongWorkspaceProposalItem,
    fileId: string,
    expectedRevision: string | null
  ): LongWorkspaceProposalItem | undefined {
    const items = itemsForBook(item.event.payload.bookId);
    const currentIndex = items.findIndex(
      ({ event }) => event.id === item.event.id
    );
    if (currentIndex < 0) return undefined;
    return items
      .slice(0, currentIndex)
      .reverse()
      .find(
        (candidate) =>
          candidate.event.type ===
            "long.worldbuilding_file_proposal" &&
          candidate.event.payload.files.some(
            (file) =>
              file.fileId === fileId &&
              file.nextRevision === expectedRevision
          ) &&
          candidate.status !== "error"
      );
  }

  async function previewMutation(
    item: LongWorkspaceProposalItem
  ): Promise<void> {
    if (
      item.event.type !== "long.mutation_proposal" &&
      item.event.type !== "long.worldbuilding_file_proposal"
    ) return;
    const { event } = item;
    const api = options.api();
    if (!api) {
      updateItem(event.payload.bookId, event.id, {
        status: "error",
        error: "当前环境未连接长篇工作区。"
      });
      return;
    }
    updateItem(event.payload.bookId, event.id, {
      status: "previewing",
      clearError: true
    });
    try {
      let effectiveBatch = event.payload.batch;
      let effectiveProjectRevision = event.payload.baseProjectRevision;
      if (event.type === "long.worldbuilding_file_proposal") {
        const latest = await api.getWorkspaceIndex({
          bookId: event.payload.bookId
        });
        const currentFiles = new Map(
          latest.workspaceIndex.worldbuilding.flatMap((category) =>
            category.format === "text"
              ? [[category.file.id, category.file] as const]
              : [
                  ...(category.overview
                    ? [[
                        category.overview.id,
                        category.overview
                      ] as const]
                    : []),
                  ...category.items.map(
                    ({ file }) => [file.id, file] as const
                  )
                ]
          )
        );
        for (const file of event.payload.files) {
          const current = currentFiles.get(file.fileId);
          if (file.operation === "create") {
            if (current) {
              throw new Error(
                `世界观文件已存在，无法重复创建：${file.filePath}`
              );
            }
          } else if (
            !current ||
            current.revision !== file.beforeRevision
          ) {
            const predecessor = pendingFilePredecessor(
              item,
              file.fileId,
              file.beforeRevision
            );
            if (predecessor && predecessor.status !== "accepted") {
              updateItem(event.payload.bookId, event.id, {
                status: "waiting",
                clearError: true
              });
              return;
            }
            throw new Error(
              `世界观文件已在提案后更新，未覆盖最新内容：${file.filePath}`
            );
          }
        }
        const nextOrderByCategory = new Map<string, number>();
        effectiveBatch = {
          ...event.payload.batch,
          baseRevision: latest.workspaceIndex.revision,
          operations: event.payload.batch.operations.map((operation) => {
            if (operation.type !== "worldbuildingItem.create") {
              return operation;
            }
            const category = latest.workspaceIndex.worldbuilding.find(
              ({ id }) => id === operation.categoryId
            );
            if (!category || category.format !== "list") {
              throw new Error(
                "世界观条目的目标分类已不存在或不再是列表型。"
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
        };
        effectiveProjectRevision = latest.projectRevision;
      }
      const result = await api.previewOperations({
        bookId: event.payload.bookId,
        batch: effectiveBatch
      });
      if (result.bookId !== event.payload.bookId) {
        throw new Error("结构影响预览返回了错误的长篇项目。");
      }
      if (
        result.projectRevision !==
        effectiveProjectRevision
      ) {
        throw new Error(
          "长篇项目已在提案后更新，请基于最新结构重新生成提案。"
        );
      }
      if (!currentItem(event.payload.bookId, event.id)) return;
      updateItem(event.payload.bookId, event.id, {
        status: "ready",
        preview: result.preview,
        previewProjectRevision: result.projectRevision,
        effectiveBatch,
        effectiveProjectRevision,
        clearError: true
      });
    } catch (error: unknown) {
      if (!currentItem(event.payload.bookId, event.id)) return;
      updateItem(event.payload.bookId, event.id, {
        status: "error",
        error: errorMessage(error, "预览长篇结构影响失败。")
      });
    }
  }

  function rememberEvent(event: LongWorkspaceProposalEvent): boolean {
    const semanticKey = proposalKey(event);
    if (
      handledEventIds.has(event.id) ||
      handledProposalKeys.has(semanticKey)
    ) {
      return false;
    }
    handledEventIds.add(event.id);
    handledProposalKeys.add(semanticKey);
    while (handledEventIds.size > 2_000) {
      const oldest = handledEventIds.values().next().value as
        | string
        | undefined;
      if (!oldest) break;
      handledEventIds.delete(oldest);
    }
    while (handledProposalKeys.size > 2_000) {
      const oldest = handledProposalKeys.values().next().value as
        | string
        | undefined;
      if (!oldest) break;
      handledProposalKeys.delete(oldest);
    }
    return true;
  }

  async function processAutomaticProposal(
    event: LongWorkspaceProposalEvent,
    previewFirst: boolean
  ): Promise<void> {
    await automaticProposalQueue.enqueue(event.payload.bookId, async () => {
      let current = currentItem(event.payload.bookId, event.id);
      if (!current) return;
      let prepared = false;
      if (
        previewFirst &&
        current.event.type === "long.worldbuilding_file_proposal"
      ) {
        try {
          await options.prepareAutoApprove?.(event);
          prepared = true;
        } catch (error: unknown) {
          const message = errorMessage(
            error,
            "世界观文件实时自动保存前检查失败。"
          );
          updateItem(event.payload.bookId, event.id, {
            status: "error",
            error: message
          });
          options.notifications.error(message);
          return;
        }
      }
      if (
        previewFirst &&
        (current.event.type === "long.mutation_proposal" ||
          current.event.type === "long.worldbuilding_file_proposal")
      ) {
        await previewMutation(current);
        current = currentItem(event.payload.bookId, event.id);
      }
      if (!current || current.status !== "ready") return;
      if (!prepared) {
        try {
          await options.prepareAutoApprove?.(event);
        } catch (error: unknown) {
          const message = errorMessage(
            error,
            "长篇提案实时自动保存前检查失败。"
          );
          updateItem(event.payload.bookId, event.id, {
            status: "error",
            error: message
          });
          options.notifications.error(message);
          return;
        }
      }
      await approve(event.payload.bookId, event.id);
    });
  }

  async function enqueueProposalEvent(
    event: LongWorkspaceProposalEvent,
    approvalMode: AgentWriteApprovalMode =
      options.approvalModeForEvent?.(event) ?? "request-approval"
  ): Promise<boolean> {
    if (!rememberEvent(event)) {
      return false;
    }

    const item: LongWorkspaceProposalItem = {
      event,
      approvalMode,
      status:
        event.type === "long.mutation_proposal" ||
        event.type === "long.worldbuilding_file_proposal"
          ? "previewing"
          : "ready"
    };
    setBookItems(event.payload.bookId, [
      ...itemsForBook(event.payload.bookId),
      item
    ]);
    if (approvalMode === "auto-approve") {
      await processAutomaticProposal(event, true);
    } else if (
      event.type === "long.mutation_proposal" ||
      event.type === "long.worldbuilding_file_proposal"
    ) {
      await previewMutation(item);
    }
    return true;
  }

  async function handleEvent(event: SystemEventEnvelope): Promise<boolean> {
    if (
      !isLongProposalEvent(event) ||
      discardedBookIds.has(event.payload.bookId) ||
      quarantinedSessions.has(
        sessionKey(event.payload.bookId, event.payload.sessionId)
      ) ||
      handledEventIds.has(event.id) ||
      handledProposalKeys.has(proposalKey(event)) ||
      !options.acceptsEvent(event)
    ) {
      return false;
    }
    return enqueueProposalEvent(event);
  }

  function createUniqueManualEventId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const eventId = createId("long_manual_mutation");
      if (!handledEventIds.has(eventId)) {
        return eventId;
      }
    }
    throw new Error("无法为手工长篇结构提案生成唯一事件 ID。");
  }

  async function enqueueManualMutation(
    input: EnqueueManualLongMutationInput
  ): Promise<LongMutationProposalEvent> {
    const eventId = createUniqueManualEventId();
    const sessionId = createId("long_manual_session");
    const runId = createId("long_manual_run");
    const event = LongMutationProposalEventEnvelopeSchema.parse(
      createEnvelope(
        "long.mutation_proposal",
        {
          sessionId,
          runId,
          toolCallId: createId("long_manual_tool"),
          bookId: input.bookId,
          agentId: input.agentId ?? "plot_design",
          summary: input.summary,
          runtime: {
            provider: "deepwrite",
            model: "manual-structure-manager",
            mode: "local-faux"
          },
          batch: input.batch,
          baseProjectRevision: input.baseProjectRevision
        },
        {
          id: eventId,
          context: {
            sessionId,
            runId,
            resourceId: input.bookId
          }
        }
      )
    );
    activateBook(input.bookId);
    if (!(await enqueueProposalEvent(event, "request-approval"))) {
      throw new Error("手工长篇结构提案事件 ID 冲突，请重试。");
    }
    return event;
  }

  async function retryPreview(
    bookId: string,
    eventId: string
  ): Promise<void> {
    const item = currentItem(bookId, eventId);
    if (
      !item ||
      item.status === "previewing" ||
      item.status === "submitting"
    ) {
      return;
    }
    if (
      item.approvalMode === "auto-approve" &&
      item.event.type === "long.worldbuilding_file_proposal"
    ) {
      await processAutomaticProposal(item.event, true);
      return;
    }
    await previewMutation(item);
    const current = currentItem(bookId, eventId);
    if (
      current?.approvalMode === "auto-approve" &&
      current.status === "ready"
    ) {
      await processAutomaticProposal(current.event, false);
    }
  }

  async function approve(bookId: string, eventId: string): Promise<void> {
    const item = currentItem(bookId, eventId);
    const api = options.api();
    if (!item || !api || item.status === "submitting") {
      if (!api) {
        options.notifications.warning("当前环境未连接长篇工作区。");
      }
      return;
    }
    if (
      (item.event.type === "long.mutation_proposal" ||
        item.event.type === "long.worldbuilding_file_proposal") &&
      (item.status !== "ready" || !item.preview)
    ) {
      options.notifications.warning("请先完成结构影响预览，再确认应用。");
      return;
    }
    const mutationPreview =
      item.event.type === "long.mutation_proposal" ||
      item.event.type === "long.worldbuilding_file_proposal"
        ? item.preview
        : undefined;
    if (
      item.event.type !== "long.mutation_proposal" &&
      item.event.type !== "long.worldbuilding_file_proposal" &&
      item.status !== "ready" &&
      item.status !== "error"
    ) {
      return;
    }

    updateItem(bookId, eventId, {
      status: "submitting",
      clearError: true
    });
    if (item.event.type === "long.chapter_dispatch_proposal") {
      try {
        await options.onDispatchApproved?.(item.event);
        removeItem(bookId, eventId);
        options.notifications.success(
          `已启动从“${item.event.payload.title}”开始的 ${item.event.payload.chapters.length} 章串行写作计划。`
        );
      } catch (error: unknown) {
        updateItem(bookId, eventId, {
          status: "error",
          error: errorMessage(error, "处理长篇提案失败。")
        });
        options.notifications.error(
          errorMessage(error, "处理长篇提案失败。")
        );
      }
      return;
    }

    try {
      if (
        item.event.type === "long.mutation_proposal" ||
        item.event.type === "long.worldbuilding_file_proposal"
      ) {
        const effectiveBatch =
          item.effectiveBatch ?? item.event.payload.batch;
        const effectiveProjectRevision =
          item.effectiveProjectRevision ??
          item.event.payload.baseProjectRevision;
        await api.applyOperations({
          bookId,
          batch: LongWorkspaceOperationBatchSchema.parse({
            ...effectiveBatch,
            expectedImpact: mutationPreview!.impact
          }),
          baseProjectRevision: effectiveProjectRevision
        });
      } else if (item.event.type === "long.chapter_write_proposal") {
        await api.writeChapter(item.event.payload.input);
      } else {
        await api.commitChapter(item.event.payload.input);
      }
    } catch (error: unknown) {
      updateItem(bookId, eventId, {
        status: "error",
        error: errorMessage(error, "处理长篇提案失败。")
      });
      options.notifications.error(
        errorMessage(error, "处理长篇提案失败。")
      );
      return;
    }

    if (item.event.type === "long.worldbuilding_file_proposal") {
      updateItem(bookId, eventId, {
        status: "accepted",
        clearError: true
      });
    } else {
      removeItem(bookId, eventId);
    }
    options.notifications.success(
      item.event.type === "long.mutation_proposal"
        ? "长篇结构提案已应用。"
        : item.event.type === "long.worldbuilding_file_proposal"
          ? "世界观文件变更已保存到本地 Markdown。"
        : item.event.type === "long.chapter_write_proposal"
          ? "章节正文证据已写入；正在进入连续性结算。"
          : "章节连续性账本已提交。"
    );
    try {
      await options.onApplied?.(item.event);
    } catch (error: unknown) {
      options.notifications.warning(
        `长篇提案已经写入，但后续刷新失败：${errorMessage(
          error,
          "请手动刷新长篇工作区。"
        )}`
      );
    }
    if (item.event.type === "long.worldbuilding_file_proposal") {
      const appliedFileIds = new Set(
        item.event.payload.files.map(({ fileId }) => fileId)
      );
      for (const waiting of itemsForBook(bookId).filter(
        (candidate) =>
          candidate.status === "waiting" &&
          candidate.event.type ===
            "long.worldbuilding_file_proposal" &&
          candidate.event.payload.files.some(({ fileId }) =>
            appliedFileIds.has(fileId)
          )
      )) {
        if (waiting.approvalMode === "auto-approve") {
          queueMicrotask(() => {
            void processAutomaticProposal(waiting.event, true);
          });
        } else {
          await previewMutation(waiting);
        }
      }
    }
  }

  function reject(bookId: string, eventId: string): boolean {
    const item = currentItem(bookId, eventId);
    if (
      !item ||
      item.status === "submitting" ||
      item.status === "accepted"
    ) return false;
    if (item.event.type === "long.worldbuilding_file_proposal") {
      const rejectedFileIds = new Set(
        item.event.payload.files.map(({ fileId }) => fileId)
      );
      for (const dependent of itemsForBook(bookId)) {
        if (
          dependent.status === "waiting" &&
          dependent.event.type ===
            "long.worldbuilding_file_proposal" &&
          dependent.event.payload.files.some(({ fileId }) =>
            rejectedFileIds.has(fileId)
          )
        ) {
          updateItem(bookId, dependent.event.id, {
            status: "error",
            error:
              "依赖的世界观文件创建或前序写入已被拒绝，本次变更未保存。"
          });
        }
      }
    }
    options.onRejected?.(item.event);
    removeItem(bookId, eventId);
    return true;
  }

  return {
    queues,
    itemsForBook,
    activateBook,
    discardBook,
    quarantineSession,
    handleEvent,
    enqueueManualMutation,
    retryPreview,
    approve,
    reject
  };
}
