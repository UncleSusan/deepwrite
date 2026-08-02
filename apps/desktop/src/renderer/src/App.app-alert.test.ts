import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App remote alerts", () => {
  it("loads alerts at startup while keeping a model notice fallback", () => {
    expect(source).toContain("void loadAppAlerts();");
    expect(source).toContain("await api.get()");
    expect(source).toContain("官方模型已经上线！直连厂商！软件整体用量越多，折扣会越大！");
    expect(source).toContain(':model-alert-messages="modelAlertMessages"');
  });

  it("shows unseen desktop content and acknowledges it when dismissed", () => {
    expect(source).toContain("snapshot.shouldShowDesktop");
    expect(source).toContain("snapshot.desktopRevision");
    expect(source).toContain("appAlerts.acknowledgeDesktop(revision)");
    expect(source).toContain("<StartupAlertDialog");
    expect(source).toContain('@close="closeStartupAlert"');
  });

  it("checks the remote alert again when a hidden window regains focus", () => {
    expect(source).toMatch(
      /function refreshCatalogOnWindowFocus\(\): void \{[\s\S]*?void loadAppAlerts\(\);/u
    );
  });
});
