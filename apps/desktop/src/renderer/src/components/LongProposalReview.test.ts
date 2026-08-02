import { describe, expect, it } from "vitest";
import conversationSource from "./AgentConversation.vue?raw";
import source from "./LongProposalReview.vue?raw";

describe("LongProposalReview content file cards", () => {
  it("supports inline rendering inside its originating conversation turn", () => {
    expect(source).toContain("embedded?: boolean");
    expect(source).toContain("'is-embedded': embedded");
    expect(source).toContain("'has-content-file-items': hasContentFileItems");
    expect(source).toContain('<header v-if="!embedded">');
    expect(source).toContain(".long-proposal-review.is-embedded");
  });

  it("uses the existing text-edit card surface for every Markdown proposal", () => {
    expect(source).toContain("long.worldbuilding_file_proposal");
    expect(source).toContain("long.character_file_proposal");
    expect(source).toContain("buildAgentTextDiff");
    for (const className of [
      "edit-proposal-card",
      "edit-proposal-header",
      "edit-proposal-status",
      "edit-proposal-stats",
      "edit-proposal-diff",
      "edit-diff-content",
      "edit-proposal-footer",
      "edit-proposal-actions",
      "edit-review-button is-reject",
      "edit-review-button is-accept"
    ]) {
      expect(source).toContain(className);
      expect(conversationSource).toContain(className);
    }
    expect(source).not.toContain("worldbuilding-file-card");
    expect(source).not.toContain("long.ledger_commit_proposal");
    expect(source).not.toContain("查看提交内容");
    expect(source).toContain("contentProposalDiffStats(item)");
    expect(source).toContain("已自动批准并保存到本地 Markdown。");
    expect(source).toContain("接受后将应用到对应 Markdown 并自动保存到本机。");
    expect(source).toContain("重试接受并保存");
    expect(source).toContain("等待前序文件");
    expect(source).toContain("正在等待前序文件创建或写入完成，随后继续校验。");
  });

  it("keeps structure changes separate from worldbuilding file writes", () => {
    expect(source).toContain('case "long.mutation_proposal":');
    expect(source).toContain('return "结构变更";');
    expect(source).toContain(
      'case "long.worldbuilding_file_proposal":'
    );
    expect(source).toContain('case "long.character_file_proposal":');
    expect(source).toContain('return "确认写入并保存";');
  });

  it("does not render unverified continuity metadata or diffs", () => {
    expect(source).toContain("trustedContinuityIdentity");
    expect(source).toContain("contentFileTitle(item, card.file)");
    expect(source).toContain("canDisplayContentFileDiff(item)");
    expect(source).toContain('item.status === "ready"');
    expect(source).toContain('item.status === "submitting"');
    expect(source).toContain('item.status === "accepted"');
    expect(source).toContain("文件身份和原文尚未通过校验");
    expect(source).not.toContain("{{ card.file.filePath }}");
  });
});
