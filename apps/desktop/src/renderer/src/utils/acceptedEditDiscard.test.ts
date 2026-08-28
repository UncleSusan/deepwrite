import { describe, expect, it } from "vitest";
import type { LongWorkspaceOperationBatch } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type {
  AgentEditProposal,
  AgentToolTrace,
  ChatMessage
} from "../types/conversation";
import {
  agentApprovalCanDiscard,
  buildLongEditUndoBatch,
  isModificationTool,
  longApprovalCanDiscard,
  textEditDiscardSnapshot
} from "./acceptedEditDiscard";

function acceptedTextProposal(
  overrides: Partial<AgentEditProposal> = {}
): AgentEditProposal {
  return {
    id: "proposal-1",
    runId: "run-1",
    workspaceId: "book-1",
    stageId: "draft",
    documentId: "document-1",
    title: "第一章",
    summary: "修改正文",
    status: "accepted",
    baseRevision: "before-revision",
    proposedRevision: "after-revision",
    toolCallIds: ["tool-1"],
    additions: 1,
    deletions: 1,
    hunks: [],
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
    discardSnapshot: {
      beforeText: "修改前",
      beforeTitle: "第一章"
    },
    ...overrides
  };
}

function messageWithTool(name: string): Pick<ChatMessage, "toolCalls"> {
  return {
    toolCalls: [{ id: "tool-1", name } as AgentToolTrace]
  };
}

function acceptedLongFileProposal(
  operation: "create" | "write" | "edit"
): LongWorkspaceProposalItem {
  return {
    status: "accepted",
    event: {
      id: "long-proposal-1",
      type: "long.worldbuilding_file_proposal",
      payload: {
        toolCallId: "tool-1",
        files: [{ operation }]
      }
    }
  } as unknown as LongWorkspaceProposalItem;
}

describe("accepted edit discard eligibility", () => {
  it("recognizes modification tools without treating create as an edit", () => {
    expect(isModificationTool({ name: "edit" })).toBe(true);
    expect(isModificationTool({ name: "edit_document" })).toBe(true);
    expect(isModificationTool({ name: "create" })).toBe(false);
    expect(isModificationTool({ name: "write" })).toBe(false);
  });

  it("shows discard only for an accepted proposal produced by edit", () => {
    const proposal = acceptedTextProposal();

    expect(agentApprovalCanDiscard(messageWithTool("edit"), proposal)).toBe(
      true
    );
    expect(agentApprovalCanDiscard(messageWithTool("create"), proposal)).toBe(
      false
    );
    expect(
      agentApprovalCanDiscard(messageWithTool("edit"), {
        ...proposal,
        status: "pending"
      })
    ).toBe(false);
  });

  it("keeps the original snapshot only while coalescing the same generation", () => {
    const existing = acceptedTextProposal();

    expect(
      textEditDiscardSnapshot(existing, true, "第一版修改后", "第一章")
    ).toEqual(existing.discardSnapshot);
    expect(
      textEditDiscardSnapshot(existing, false, "第一版修改后", "第一章")
    ).toEqual({
      beforeText: "第一版修改后",
      beforeTitle: "第一章"
    });
  });

  it("never enables discard for short-form creation proposals", () => {
    expect(
      agentApprovalCanDiscard(messageWithTool("edit"), {
        ...acceptedTextProposal(),
        libraryTarget: {
          operation: "create",
          domain: "material",
          libraryId: "library-1"
        }
      })
    ).toBe(false);
    expect(
      agentApprovalCanDiscard(messageWithTool("edit"), {
        ...acceptedTextProposal(),
        draftSectionCreationTarget: {
          sections: [
            {
              title: "新章节",
              wordCountRequirement: "1000 字",
              provisionalSectionId: "section-1"
            }
          ]
        }
      })
    ).toBe(false);
  });

  it("never enables discard for long-form file creation", () => {
    expect(
      longApprovalCanDiscard(
        messageWithTool("edit"),
        acceptedLongFileProposal("edit")
      )
    ).toBe(true);
    expect(
      longApprovalCanDiscard(
        messageWithTool("edit"),
        acceptedLongFileProposal("write")
      )
    ).toBe(true);
    expect(
      longApprovalCanDiscard(
        messageWithTool("edit"),
        acceptedLongFileProposal("create")
      )
    ).toBe(false);
    expect(
      longApprovalCanDiscard(
        messageWithTool("create"),
        acceptedLongFileProposal("edit")
      )
    ).toBe(false);
  });

  it("builds structural undo only from update operations and preview snapshots", () => {
    const batch = {
      baseRevision: 7,
      updatedAt: "2026-08-25T00:00:00.000Z",
      operations: [
        {
          type: "worldbuilding.update",
          id: "world-rules",
          patch: { title: "新标题" }
        }
      ],
      documentWrites: []
    } as unknown as LongWorkspaceOperationBatch;
    const preview = {
      entityChanges: [
        {
          id: "world-rules",
          before: { id: "world-rules", title: "旧标题", order: 1 }
        }
      ]
    } as unknown as NonNullable<LongWorkspaceProposalItem["preview"]>;

    expect(buildLongEditUndoBatch(batch, preview)).toMatchObject({
      operations: [
        {
          type: "worldbuilding.update",
          id: "world-rules",
          patch: { title: "旧标题" }
        }
      ],
      documentWrites: []
    });
    expect(
      buildLongEditUndoBatch(
        {
          ...batch,
          operations: [
            { type: "worldbuilding.delete", id: "world-rules" }
          ] as LongWorkspaceOperationBatch["operations"]
        },
        preview
      )
    ).toBeUndefined();
  });
});
