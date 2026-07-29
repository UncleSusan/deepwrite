import { describe, expect, it } from "vitest";
import appSource from "./App.vue?raw";

describe("initial workspace selection", () => {
  it("keeps the workspace unselected until the user opens a resource", () => {
    expect(appSource).toContain('const selectedResourceId = ref("");');
    expect(appSource).toContain('const activeCreationResourceId = ref("");');
    expect(appSource).toContain("selectedResourceId.value &&");
    expect(appSource).toContain("activeCreationResourceId.value &&");
  });

  it("shows the empty workspace instead of falling back to the first book", () => {
    expect(appSource).toContain(
      "documentForResourceId(selectedResourceId.value) ?? EMPTY_WORKSPACE_DOCUMENT"
    );
    expect(appSource).toContain(
      "promptDocumentForResourceId(activeCreationResourceId.value) ??\n    EMPTY_WORKSPACE_DOCUMENT"
    );
  });
});
