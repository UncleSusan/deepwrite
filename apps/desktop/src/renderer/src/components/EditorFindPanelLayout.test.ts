import { describe, expect, it } from "vitest";
import longEditorSource from "./LongEditorFindReplaceBar.vue?raw";

describe("editor find panel layout", () => {
  it("anchors long-editor panels to their complete toolbar instead of the button group", () => {
    expect(longEditorSource).toMatch(
      /\.long-editor-text-tools\s*\{\s*position:\s*static;/u
    );
    expect(longEditorSource).toMatch(
      /\.long-editor-find-panel\s*\{[\s\S]*?right:\s*13px;[\s\S]*?width:\s*min\(350px, calc\(100% - 26px\)\);/u
    );
    expect(longEditorSource).toMatch(
      /\.long-story-plot-text-toolbar\s*\{\s*position:\s*relative;/u
    );
    expect(longEditorSource).toMatch(
      /\.long-story-plot-text-toolbar \.long-editor-find-panel\s*\{\s*right:\s*0;\s*left:\s*auto;/u
    );
  });
});
