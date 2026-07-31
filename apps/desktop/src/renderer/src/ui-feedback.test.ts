import { describe, expect, it } from "vitest";
import source from "./ui-feedback.ts?raw";

describe("ui-feedback", () => {
  it("keeps global floating messages centered at the top", () => {
    expect(source).toContain('placement: "top"');
    expect(source).toContain("createDiscreteApi");
    expect(source).toContain("export const uiMessage = message");
    expect(source).not.toContain("top-right");
    expect(source).not.toContain("top-left");
  });
});
