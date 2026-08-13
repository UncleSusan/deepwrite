import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App performance boundaries", () => {
  it("keeps large immutable catalog data shallow and reuses one projection", () => {
    expect(source).toContain(
      "const catalogSnapshot = shallowRef<CatalogSnapshot | null>(null)"
    );
    expect(source).toContain(
      "const catalogProjection = shallowRef<CatalogWorkspaceProjection | null>(null)"
    );
    expect(source).not.toContain("const catalogProjection = computed(");
    expect(source).toContain(
      "const projectedDocuments = projection.index.workspaceDocumentById"
    );
    expect(source).toContain("catalogProjection.value = projection");
  });

  it("indexes the visible tree and document collection for navigation", () => {
    expect(source).toContain("const documentById = computed(");
    expect(source).toContain("createResourceTreeLookup(resourceTreeSections.value)");
    expect(source).toContain("resourceTreeLookup.value.nodeById.get(resourceId)");
    expect(source).toContain(
      "resourceTreeLookup.value.resourceIdByDocumentId.get(documentId)"
    );
  });

  it("coalesces catalog reads and throttles noisy window-focus refreshes", () => {
    expect(source).toContain("let catalogLoadPromise: Promise<void> | null = null");
    expect(source).toContain("catalogReloadRequested = true");
    expect(source).toContain("while (catalogReloadRequested)");
    expect(source).toContain("WINDOW_FOCUS_REFRESH_INTERVAL_MS");
    expect(source).toContain("performWindowFocusRefresh");
  });
});
