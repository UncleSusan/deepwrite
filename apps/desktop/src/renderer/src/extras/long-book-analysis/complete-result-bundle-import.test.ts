import { describe, expect, it } from "vitest";
import commands from "../../../../main/extras/long-book-analysis/commands.ts?raw";
import controller from "./useCompleteBookAnalysis.ts?raw";
import panel from "./CompleteAnalysisPanel.vue?raw";

describe("complete analysis Linux result import", () => {
  it("validates result packages in Main and reuses complete-analysis archiving", () => {
    expect(commands).toContain("longBookAnalysis.chooseResultBundle");
    expect(commands).toContain("LongBookAnalysisResultBundleSchema.parse");
    expect(controller).toContain("persistCompleteAnalysisResults");
    expect(panel).toContain("导入 Linux 结果包");
  });
});
