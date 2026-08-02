# GitHub Release 测试版自动更新发布说明

本文说明 DeepWrite 测试版本如何构建、上传到 GitHub Release，并让已经安装的旧版本通过“头像 → 版本更新”完成后台下载和重启安装。

## 一、发布前准备

1. 确定新版本号，例如 `1.1.3`。新版本必须大于用户当前安装的版本。
2. 同步修改仓库根目录 `package.json` 和 `apps/desktop/package.json` 中的 `version`，两处必须完全一致。
3. 暂时不要先提高根目录 `update.json` 的版本号。应先构建并上传安装文件，确认 Release 可用后，最后再更新并推送 `update.json`，避免用户提前发现一个尚未上传完整的版本。
4. 测试包不需要正式发布签名。Windows 测试包不签名；Mac 测试包使用 ad-hoc 签名，不做 Apple 公证。

## 二、构建测试包

必须从仓库根目录运行项目提供的打包命令，不能直接调用 electron-builder，也不能跳过 `pnpm verify`。

```bash
# Windows x64（应优先在 Windows x64 机器执行）
pnpm pack:test:win

# Mac Apple Silicon / arm64
pnpm pack:test:mac:arm64

# Mac Intel / x64
pnpm pack:test:mac:x64

# 同时构建两种 Mac 架构
pnpm pack:test:mac
```

产物位于 `apps/desktop/release/`。打包过程还会生成 electron-updater 使用的 `latest.yml`、`latest-mac.yml` 和 `.blockmap` 文件。

## 三、创建 GitHub Release

1. 在 GitHub 仓库 `swjybky/deepwrite` 创建新 Release。
2. Tag 使用 `v版本号`，例如 `v1.1.3`。
3. Release 标题建议使用 `DeepWrite 1.1.3`。
4. 上传文件期间可以先保存为 Draft。
5. 文件上传完整并核对无误后，再发布 Release。稳定更新不要勾选 “Set as a pre-release”。

## 四、Release 必须上传的文件

### Windows x64

必须上传：

```text
DeepWrite-<version>-win-x64-test.exe
DeepWrite-<version>-win-x64-test.exe.blockmap
latest.yml
```

示例：

```text
DeepWrite-1.1.3-win-x64-test.exe
DeepWrite-1.1.3-win-x64-test.exe.blockmap
latest.yml
```

### macOS arm64

必须上传：

```text
DeepWrite-<version>-mac-arm64-test.dmg
DeepWrite-<version>-mac-arm64-test.zip
DeepWrite-<version>-mac-arm64-test.zip.blockmap
latest-mac.yml
```

### macOS x64

必须上传：

```text
DeepWrite-<version>-mac-x64-test.dmg
DeepWrite-<version>-mac-x64-test.zip
DeepWrite-<version>-mac-x64-test.zip.blockmap
latest-mac.yml
```

DMG 用于用户首次手动安装；electron-updater 在 Mac 上主要使用 ZIP 和 `latest-mac.yml` 完成自动更新。因此不能只上传 DMG。

如果同一个 Release 同时提供 arm64 和 x64，请只上传最终生成且同时正确引用两个架构文件的 `latest-mac.yml`。上传前打开该文件检查 `files` 中的文件名和 SHA-512 是否与 Release 中的实际 ZIP 一致。不要随意手工修改 SHA-512。

## 五、最后更新 update.json

Release 发布完成且所有下载地址可访问后，修改仓库根目录 `update.json`：

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "channel": "stable",
  "version": "1.1.3",
  "title": "DeepWrite 1.1.3",
  "publishedAt": "2026-08-02T12:00:00+08:00",
  "releaseNotes": [
    "新增功能一",
    "修复问题二"
  ],
  "mandatory": false,
  "minimumSupportedVersion": "1.0.0",
  "releasePage": "https://github.com/swjybky/deepwrite/releases/tag/v1.1.3",
  "feedUrl": "https://github.com/swjybky/deepwrite/releases/latest/download"
}
```

提交并推送到 `main`。客户端固定读取：

```text
https://raw.githubusercontent.com/swjybky/deepwrite/main/update.json
```

注意：`update.json.version`、两个 `package.json` 的 `version`、Git tag 和 `latest*.yml` 中的版本必须一致。

## 六、验证自动更新

1. 安装旧版本测试包，例如 `1.1.2`。
2. 按上述流程发布 `1.1.3`。
3. 在旧版本中点击头像，再点击“版本更新”。
4. 确认界面显示 `1.1.3` 和正确的更新说明。
5. 点击“后台下载更新”，确认下载百分比、大小和速度持续更新。
6. 下载完成后点击“重启并安装”。
7. 确认 DeepWrite 退出、完成安装、自动重新启动，并显示当前版本 `1.1.3`。
8. 再次检查更新，应提示“当前已是最新版本”。

开发模式下可以检查远程 `update.json`，但不能验证下载安装。完整流程必须使用已经安装的测试包验证。

## 七、测试包限制

- Mac 测试包仅使用 ad-hoc 签名，没有 Developer ID 信任链，也没有 Apple 公证。通过浏览器、微信等渠道下载后仍可能被 Gatekeeper 提示或拦截。
- Windows 测试包未做代码签名，可能出现 SmartScreen 警告。
- GitHub 在部分网络环境下访问较慢，下载失败时可以在更新弹窗中重新检查或重新下载。
- 测试阶段不得宣称该更新流程等同于正式签名、公证后的发布体验。

## 八、常见失败原因

- `update.json` 已更新，但对应 Release 仍是 Draft 或文件尚未上传完整。
- `update.json`、应用版本、Git tag、`latest.yml` 或 `latest-mac.yml` 的版本不一致。
- 漏传 `.blockmap`、`latest.yml`、`latest-mac.yml` 或 Mac ZIP。
- `latest*.yml` 引用的文件名与实际上传文件名不同。
- 同时构建多个 Mac 架构时，一个架构生成的 `latest-mac.yml` 覆盖了另一个架构的清单。
- 用户运行的是开发模式，而不是已经安装的测试包。
