import { describe, expect, it } from "vitest";
import source from "./AgentTeamCatalogFeature.vue?raw";

describe("AgentTeamCatalogFeature", () => {
  it("opens with a catalog and keeps the existing editor behind team selection", () => {
    expect(source).toContain('class="team-catalog"');
    expect(source).toContain('v-if="selectedTeam"');
    expect(source).toContain("<AgentTeamSettingsPanel");
    expect(source).toContain("selectedTeamId = team.id");
    expect(source).toContain("返回团队列表");
  });

  it("supports per-type selection toggles and protected deletion", () => {
    expect(source).toContain('class="enable-selector"');
    expect(source).toContain(
      "emit('setEnabled', { teamId: team.id, enabled: !isEnabled(team) })"
    );
    expect(source).toContain(
      "catalog?.enabledTeamIds[team.workspaceType] === team.id"
    );
    expect(source).toContain("确认删除");
    expect(source).toContain('class="danger-button"');
  });

  it("creates blank named profiles through the catalog API without auto activation", () => {
    expect(source).toContain(
      'emit("create", { name, workspaceType: createWorkspaceType.value })'
    );
    expect(source).not.toContain('emit("setEnabled"');
    expect(source).toContain("pendingExistingTeamIds");
    expect(source).toContain("<PopupSelect");
    expect(source).toContain(':menu-z-index="2200"');
  });

  it("resets detail state whenever the primary navigation is activated", () => {
    expect(source).toContain("() => props.navigationEpoch");
    expect(source).toContain("selectedTeamId.value = null");
    expect(source).toContain('emit("authoringReset")');
  });

  it("uses the settings back-button structure and makes the whole card clickable", () => {
    expect(source).toContain('<AppIcon name="chevron" :size="14" />');
    expect(source).toContain('@click="selectedTeamId = team.id"');
    expect(source).toContain("@click.stop");
  });

  it("downloads each complete team and installs uploaded team archives", () => {
    expect(source).toContain("安装团队");
    expect(source).toContain("emit('install')");
    expect(source).toContain("emit('download', { teamId: team.id })");
    expect(source).toContain('<AppIcon name="download"');
  });
});
