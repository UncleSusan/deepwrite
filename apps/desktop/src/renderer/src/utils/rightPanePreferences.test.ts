import { describe, expect, it } from "vitest";
import {
  RIGHT_PANE_PREFERENCES_STORAGE_KEY,
  loadRightPanePreferences,
  parseRightPanePreferences,
  rightPanePreferenceKey,
  saveRightPanePreferences
} from "./rightPanePreferences";

describe("right pane preferences", () => {
  it("uses independent stage keys while sharing a stage across books", () => {
    const worldbuilding = rightPanePreferenceKey({
      domain: "creation",
      workspaceType: "short",
      stageId: "worldbuilding"
    });
    expect(worldbuilding).toBe("short:worldbuilding");
    expect(
      rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "short",
        stageId: "worldbuilding"
      })
    ).toBe(worldbuilding);
    expect(
      rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "short",
        stageId: "plot_design"
      })
    ).toBe("short:plot_design");
    expect(
      rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "short",
        stageId: "plot_refine"
      })
    ).toBe("short:plot_refine");
    expect(
      rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "script",
        stageId: "plot_design"
      })
    ).toBe("script:plot_design");
    expect(
      rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "long",
        stageId: "character_design"
      })
    ).toBe("long:character_design");
  });

  it("rejects malformed or out-of-range stored widths", () => {
    expect(parseRightPanePreferences("not-json")).toEqual({ widths: {} });
    expect(
      parseRightPanePreferences(
        JSON.stringify({ version: 1, widths: { "short:worldbuilding": 200 } })
      )
    ).toEqual({ widths: {} });
    expect(
      parseRightPanePreferences(
        JSON.stringify({ version: 2, widths: { "short:worldbuilding": 480 } })
      )
    ).toEqual({ widths: {} });
  });

  it("does not create preference keys outside a creative stage", () => {
    expect(
      rightPanePreferenceKey({
        domain: "material",
        workspaceType: "short",
        stageId: "plot_design"
      })
    ).toBeUndefined();
    expect(
      rightPanePreferenceKey({
        domain: "creation",
        workspaceType: "short"
      })
    ).toBeUndefined();
  });

  it("persists and restores each stage width", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    const preferences = {
      widths: {
        "short:character_design": 430,
        "short:plot_design": 520,
        "short:plot_refine": 610,
        "script:plot_design": 470
      }
    };

    expect(saveRightPanePreferences(storage, preferences)).toBe(true);
    expect(values.get(RIGHT_PANE_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, widths: preferences.widths })
    );
    expect(loadRightPanePreferences(storage)).toEqual(preferences);
  });
});
