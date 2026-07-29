import { describe, expect, it } from "vitest";
import source from "./LongStructureManager.vue?raw";

describe("LongStructureManager", () => {
  it("keeps worldbuilding as the only editable structure category", () => {
    expect(source).toContain("props.snapshot.worldbuilding");
    expect(source).toContain("builder.createWorldbuilding");
    expect(source).toContain("builder.updateWorldbuilding");
    expect(source).toContain("builder.reorderWorldbuilding");
    expect(source).toContain("builder.deleteWorldbuilding");
    expect(source).toContain("新建世界观分类");
    expect(source).not.toContain("builder.createVolume");
    expect(source).not.toContain("builder.createArc");
    expect(source).not.toContain("builder.createChapter");
    expect(source).not.toContain("builder.updateCharacter");
    expect(source).not.toContain("builder.updateVolume");
    expect(source).not.toContain("builder.updateArc");
    expect(source).not.toContain("builder.updateChapter");
    expect(source).not.toContain("builder.deleteCharacter");
    expect(source).not.toContain("builder.deleteVolume");
    expect(source).not.toContain("builder.deleteArc");
    expect(source).not.toContain("builder.deleteChapter");
  });

  it("replaces narrative management with an empty feature configuration panel", () => {
    expect(source).toContain('type StructurePanel = "foundation" | "features"');
    expect(source).toContain('label: "基础结构"');
    expect(source).toContain('label: "功能配置"');
    expect(source).toContain("功能配置项暂时为空");
    expect(source).not.toContain('label: "剧情与叙事"');
    expect(source).not.toContain("<LongPlotStructureManager");
    expect(source).not.toContain('label: "人物"');
    expect(source).not.toContain('label: "分卷"');
    expect(source).not.toContain('label: "剧情点"');
    expect(source).not.toContain('label: "章卡"');
  });

  it("waits for durable completion and preserves form drafts on failure", () => {
    expect(source).toContain("const pendingMutation = ref<");
    expect(source).toContain(
      "() => props.disabled || pendingMutation.value !== null"
    );
    expect(source).toContain(
      'succeed: () => finishMutation(requestId, "succeeded")'
    );
    expect(source).toContain(
      'fail: () => finishMutation(requestId, "failed")'
    );
    expect(source).toContain("appliedButRefreshFailed");
    expect(source).toContain('if (outcome === "failed") return');
    expect(source).toContain('}, "form")');
    expect(source).toContain('"delete"');
    expect(source).toContain(':disabled="mutationLocked"');
  });

  it("uses shared themed controls and compact teleported dialogs", () => {
    expect(source).toContain("<PopupSelect");
    expect(source.match(/<Teleport to="body">/gu)).toHaveLength(2);
    expect(source).toContain(":menu-z-index=\"2300\"");
    for (const themeToken of [
      "--surface-main",
      "--surface-raised",
      "--surface-muted",
      "--surface-hover",
      "--theme-line",
      "--theme-line-soft",
      "--text-primary",
      "--text-secondary",
      "--text-tertiary",
      "--accent",
      "--accent-soft",
      "--neutral-solid"
    ]) {
      expect(source).toContain(`var(${themeToken})`);
    }
    expect(source).toContain("font-size: 0.875rem");
    expect(source).toContain("@media (max-width: 42rem)");
    expect(source).toContain("uiMessage.warning");
    expect(source).toContain('@keydown.esc.stop="closeForm"');
    expect(source).toContain('@keydown.esc.stop="closeDelete"');
  });
});
