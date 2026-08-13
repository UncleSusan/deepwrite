import { describe, expect, it } from "vitest";
import source from "./CloudBackupPage.vue?raw";
import appSource from "../../App.vue?raw";
import sidebarSource from "../../components/LeftSidebar.vue?raw";

describe("CloudBackupPage", () => {
  it("lives under more features and never asks the user to log in", () => {
    expect(source).toContain("云端备份");
    expect(source).toContain("无需登录");
    expect(source).toContain("本机备份密钥");
    expect(source).not.toContain("password");
    expect(source).not.toContain("authMode");
    expect(sidebarSource).toContain('{ id: "cloud-backup", label: "云端备份"');
    expect(sidebarSource).toContain('emit("openCloudBackup")');
    expect(appSource).toContain('@open-cloud-backup="openCloudBackup"');
    expect(appSource).toContain("workspaceMainView === 'cloud-backup'");
  });

  it("requires a confirmation dialog before backup or restore writes data", () => {
    expect(source).toContain("确认同步内容");
    expect(source).toContain("将新增");
    expect(source).toContain("将覆盖");
    expect(source).toContain("不会改动");
    expect(source).toContain("confirmPreview");
    expect(source).toContain("danger-button");
    expect(source).toContain("100 MB");
  });
});
