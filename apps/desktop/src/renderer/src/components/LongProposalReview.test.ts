import { describe, expect, it } from "vitest";
import source from "./LongProposalReview.vue?raw";

describe("LongProposalReview worldbuilding file cards", () => {
  it("renders long worldbuilding proposals as concrete file diffs", () => {
    expect(source).toContain("long.worldbuilding_file_proposal");
    expect(source).toContain("worldbuilding-file-card");
    expect(source).toContain("worldbuildingOperationLabel");
    expect(source).toContain("buildAgentTextDiff");
    expect(source).toContain("查看差异");
    expect(source).toContain("card.diff.additions");
    expect(source).toContain("card.diff.deletions");
    expect(source).toContain("已自动批准并保存到本地 Markdown。");
    expect(source).toContain("等待前序文件");
    expect(source).toContain("正在等待前序文件创建或写入完成");
  });

  it("keeps structure changes separate from worldbuilding file writes", () => {
    expect(source).toContain('case "long.mutation_proposal":');
    expect(source).toContain('return "结构变更";');
    expect(source).toContain(
      'case "long.worldbuilding_file_proposal":'
    );
    expect(source).toContain('return "确认写入并保存";');
  });
});
