import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  LongReadDocumentCommandEnvelopeSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  createEnvelope,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import {
  preflightLongMutationProposal,
  requireAccepted,
  requireExecutor,
  textResult,
  throwIfAborted
} from "./shared";
import { createProposalOverlay } from "./proposal-overlay";
import type {
  BuildLongWorkspaceToolsInput,
  LongAgentToolDetails,
  LongQueryCommandEnvelope
} from "./index";

/** Credential registered by `read`, required before overwriting existing text. */
export interface FullyReadDocumentEntry {
  content: string;
  file: LongWorkspaceFileReference;
  workspaceRevision: number;
  projectRevision: number;
}

export function longProposalResultSummary(
  input: BuildLongWorkspaceToolsInput,
  pendingSummary: string
): string {
  return input.writeApprovalMode === "auto-approve"
    ? pendingSummary.replace(
        /等待客户端审阅(?:与冲突检查)?。$/,
        "已提交实时自动保存队列；以审批卡的落盘状态为准。"
      )
    : pendingSummary;
}

export function createLongToolContext(input: BuildLongWorkspaceToolsInput) {
  const { workspace, profile } = input;
  if (
    profile.workspaceType !== "long" ||
    profile.id !== workspace.activeAgentId
  ) {
    throw new Error(
      "Long agent profile does not match the active workspace agent."
    );
  }

  const readableRoots = new Set(profile.readAccess.workspaceRoots);
  const writableRoots = new Set(profile.writeAccess.workspaceRoots);
  const capabilities = new Set(profile.writeAccess.capabilities);

  let indexPromise:
    | Promise<{
        index: LongWorkspaceIndexSnapshot;
        projectRevision: number;
      }>
    | undefined;
  let querySequence = 0;
  let indexSequence = 0;
  const fullyReadDocuments = new Map<string, FullyReadDocumentEntry>();
  /** Index-backed entities have no file, so their read credential is the body text. */
  const fullyReadRecords = new Map<string, string>();
  const proposalOverlay =
    input.sharedState?.proposalOverlay ?? createProposalOverlay();

  const execute = async (
    command: LongQueryCommandEnvelope,
    signal?: AbortSignal
  ): Promise<unknown> => {
    throwIfAborted(signal);
    const result = await requireExecutor(input.executor)(command, signal);
    throwIfAborted(signal);
    return requireAccepted(result);
  };

  const loadIndex = async (
    signal?: AbortSignal
  ): Promise<{
    index: LongWorkspaceIndexSnapshot;
    projectRevision: number;
  }> => {
    if (!indexPromise) {
      const command = LongGetWorkspaceIndexCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.getWorkspaceIndex",
          { bookId: workspace.bookId },
          {
            id: `long-query-${input.runId}-index-${++indexSequence}`,
            context: {
              sessionId: input.sessionId,
              runId: input.runId,
              resourceId: workspace.bookId
            }
          }
        )
      );
      indexPromise = execute(command, signal)
        .then((payload) => LongWorkspaceIndexResultSchema.parse(payload))
        .then((result) => {
          if (result.bookId !== workspace.bookId) {
            throw new Error(
              "Core returned a workspace index for another book."
            );
          }
          return {
            index: result.workspaceIndex,
            projectRevision: result.projectRevision
          };
        })
        .catch((error) => {
          indexPromise = undefined;
          throw error;
        });
    }
    const value = await indexPromise;
    throwIfAborted(signal);
    return {
      index: proposalOverlay.applyToIndex(value.index),
      projectRevision: value.projectRevision
    };
  };

  const reloadIndex = async (signal?: AbortSignal) => {
    indexPromise = undefined;
    return loadIndex(signal);
  };

  /** Reads a document end to end; Core may report a newer but consistent revision. */
  const readWholeDocument = async (
    file: LongWorkspaceFileReference,
    expectedWorkspaceRevision: number,
    expectedProjectRevision: number,
    signal?: AbortSignal
  ): Promise<{ content: string; file: LongWorkspaceFileReference }> => {
    const pending = proposalOverlay.document(file.id);
    if (pending) return { content: pending.content, file: pending.file };
    let offset = 0;
    let content = "";
    let readWorkspaceRevision: number | null = null;
    let readProjectRevision: number | null = null;
    let readFileRevision: string | null = null;
    for (;;) {
      const command = LongReadDocumentCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.readDocument",
          {
            bookId: workspace.bookId,
            fileId: file.id,
            offset,
            maxCharacters: 262_144
          },
          {
            id: `long-query-${input.runId}-read-${++querySequence}`,
            context: {
              sessionId: input.sessionId,
              runId: input.runId,
              resourceId: workspace.bookId
            }
          }
        )
      );
      const result = LongReadDocumentResultSchema.parse(
        await execute(command, signal)
      );
      if (
        result.bookId !== workspace.bookId ||
        result.file.id !== file.id ||
        result.file.path !== file.path ||
        result.offset !== offset ||
        result.workspaceRevision < expectedWorkspaceRevision ||
        result.projectRevision < expectedProjectRevision ||
        (readFileRevision !== null &&
          result.file.revision !== readFileRevision) ||
        (readWorkspaceRevision !== null &&
          result.workspaceRevision !== readWorkspaceRevision) ||
        (readProjectRevision !== null &&
          result.projectRevision !== readProjectRevision)
      ) {
        throw new Error("Core returned a different long document.");
      }
      readWorkspaceRevision ??= result.workspaceRevision;
      readProjectRevision ??= result.projectRevision;
      readFileRevision ??= result.file.revision;
      content += result.content;
      if (result.nextOffset === null) {
        return { content, file: result.file };
      }
      offset = result.nextOffset;
    }
  };

  const loadActiveChapterMutationContext = async (
    signal?: AbortSignal,
    chapterCardId?: string
  ): Promise<{
    index: LongWorkspaceIndexSnapshot;
    projectRevision: number;
    activeChapterCardId: string;
    chapter: LongWorkspaceIndexSnapshot["chapters"][number];
  }> => {
    const { index, projectRevision } = await reloadIndex(signal);
    const activeChapterCardId = chapterCardId ?? workspace.activeChapterCardId;
    if (!activeChapterCardId) {
      throw new Error("需要指定 chapter_card_id，或先选中一张待提交章卡。");
    }
    // Send-time workspace/project revisions can lag after in-run file writes or
    // a manuscript autosave. The live index is authoritative for the commit.
    if (
      workspace.navigation.bookId !== index.bookId ||
      workspace.navigation.committedThroughChapterId !==
        index.ledger.committedThroughChapterId
    ) {
      throw new Error(
        "Long workspace context no longer matches the loaded workspace index."
      );
    }
    const chapter = index.chapters.find(
      (candidate) => candidate.chapterCardId === activeChapterCardId
    );
    if (!chapter) {
      throw new Error(
        "Long workspace target chapter no longer matches the loaded workspace index."
      );
    }
    if (chapter.commitId !== null) {
      throw new Error("The target long chapter is already committed.");
    }
    return { index, projectRevision, activeChapterCardId, chapter };
  };

  const formLongMutationProposal = (proposal: {
    index: LongWorkspaceIndexSnapshot;
    batch: LongWorkspaceOperationBatch;
    projectRevision: number;
    summary: string;
    message: string;
  }): AgentToolResult<LongAgentToolDetails> => {
    const preflightFailure = preflightLongMutationProposal(
      proposal.index,
      proposal.batch
    );
    if (preflightFailure) return preflightFailure;
    return textResult(longProposalResultSummary(input, proposal.message), {
      kind: "long-mutation-proposal",
      bookId: workspace.bookId,
      agentId: profile.id,
      batch: proposal.batch,
      baseProjectRevision: proposal.projectRevision,
      summary: proposal.summary
    });
  };

  const rememberProposal = (input: {
    operations: readonly LongWorkspaceOperation[];
    changes: readonly {
      file: LongWorkspaceFileReference;
      afterText: string;
      nextRevision: string;
    }[];
    timestamp: string;
    workspaceRevision: number;
    projectRevision: number;
  }): void => {
    const writes = input.changes.map((change) => ({
      content: change.afterText,
      file: {
        ...change.file,
        revision: change.nextRevision,
        updatedAt: input.timestamp
      }
    }));
    proposalOverlay.remember(input.operations, writes);
    for (const write of writes) {
      fullyReadDocuments.set(write.file.id, {
        content: write.content,
        file: write.file,
        workspaceRevision: input.workspaceRevision,
        projectRevision: input.projectRevision
      });
    }
  };

  return {
    input,
    workspace,
    profile,
    readableRoots,
    writableRoots,
    capabilities,
    fullyReadDocuments,
    fullyReadRecords,
    execute,
    loadIndex,
    reloadIndex,
    readWholeDocument,
    loadActiveChapterMutationContext,
    formLongMutationProposal,
    rememberProposal
  };
}

export type LongToolContext = ReturnType<typeof createLongToolContext>;
