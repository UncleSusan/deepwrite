import { describe, expect, it } from "vitest";
import type { AgentSubagentRun, ChatMessage } from "../types/conversation";
import {
  subagentRetryStatus,
  subagentReviewHint,
  subagentStatusLabel
} from "./subagentRunPresentation";

const startedAt = "2026-01-01T00:00:00.000Z";

function run(overrides: Partial<AgentSubagentRun> = {}): AgentSubagentRun {
  return {
    parentToolCallId: "tool_1",
    subagentRunId: "sub_1",
    subagentId: "writer",
    name: "写手小弟",
    task: "请编写第2小节正文",
    status: "running",
    runtime: { provider: "openai", model: "demo", mode: "local-faux" },
    toolCalls: [],
    processingSteps: [],
    startedAt,
    ...overrides
  };
}

describe("subagentRunPresentation", () => {
  it("formats retry labels from the live clock", () => {
    const retrying = run({
      retry: {
        turnId: "turn_1",
        attempt: 2,
        maxAttempts: 4,
        state: "scheduled",
        retryAt: "2026-01-01T00:00:08.000Z"
      }
    });
    expect(
      subagentStatusLabel(retrying, Date.parse("2026-01-01T00:00:05.000Z"))
    ).toBe("3s 后重试");
    expect(
      subagentRetryStatus(retrying, Date.parse("2026-01-01T00:00:05.000Z"))
    ).toBe("网络波动，3s 后重试（第 1/3 次）");
    expect(
      subagentRetryStatus(
        run({
          retry: {
            turnId: "turn_1",
            attempt: 2,
            maxAttempts: 4,
            state: "trying"
          }
        }),
        Date.parse(startedAt)
      )
    ).toBe("正在重试（第 1/3 次）");
  });

  it("prefers pending review over write-call counts", () => {
    const writing = run({
      toolCalls: [
        {
          id: "write_1",
          name: "write_draft_section",
          args: { section_id: "section-2" },
          status: "completed",
          requestedAt: startedAt
        }
      ]
    });
    const message = {
      editProposals: [
        {
          id: "proposal_1",
          status: "pending",
          toolCallIds: ["write_1"],
          createdAt: startedAt
        }
      ]
    } as ChatMessage;
    expect(subagentReviewHint({} as ChatMessage, writing)).toBe("1 次写入调用");
    expect(subagentReviewHint(message, writing)).toBe("1 项待审阅");
  });
});
