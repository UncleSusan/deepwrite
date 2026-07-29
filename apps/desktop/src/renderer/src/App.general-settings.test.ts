import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App general settings integration", () => {
  it("loads and persists general settings through the desktop runtime", () => {
    expect(source).toContain("await loadGeneralSettings();");
    expect(source).toContain("window.deepwrite?.generalSettings");
    expect(source).toContain("await api.save(snapshot);");
  });

  it("uses the configured permission as every agent's default approval mode", () => {
    expect(source).toContain("const approvalMode = permissionMode");
    expect(source).toContain("applyDefaultApprovalMode(permissionMode)");
    expect(source).toContain("updatePermissionMode(mode)");
    expect(source).toContain(':approval-mode="longApprovalMode"');
    expect(source).toContain('@update-permission-mode="updatePermissionMode"');
  });

  it("applies language and menu-bar setting changes", () => {
    expect(source).toContain("document.documentElement.lang = resolvedLanguage");
    expect(source).toContain('@update-language="updateAppLanguage"');
    expect(source).toContain('@update-show-in-menu-bar="updateShowInMenuBar"');
  });
});
