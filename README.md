# DeepWrite

[中文](./README.md) | [English](./README.en.md)

> 为创作者打造的本地写作 Harness Agent。

DeepWrite 不是一个简单的 AI 聊天窗口，而是一套面向长流程写作的智能体工作台。它把模型、提示词、写作技能、素材、文稿和工具组织在同一个桌面应用中，让 AI 能够理解当前作品、调用对应能力、修改真实文稿，并把每一次变更交给你审阅。

界面设计参考 Codex 的工作方式：左侧管理项目与上下文，中间与智能体协作，右侧阅读和编辑实际内容。你可以让智能体参与人物设定、剧情设计、大纲规划、分节创作和正文修改，同时始终保留对本地文件与最终内容的控制权。

## 界面预览

![DeepWrite 主工作台全景：左侧资源树、中间智能体对话、右侧编辑器](./全景图.png)

## DeepWrite 能做什么

### Codex 风格的写作工作台

DeepWrite 使用清晰的三栏布局，把写作过程中最常用的内容放在同一个视野中：

- 左侧：作品、章节、素材库、技能库与常用功能
- 中间：智能体对话、思考过程、工具执行与修改建议
- 右侧：人物、剧情、大纲、正文、素材或技能的实际内容

选择不同的作品阶段或章节时，DeepWrite 会自动切换对应的智能体和上下文。浏览素材与技能不会打断当前文稿，章节也可以通过独立标签快速切换。

![智能体协作写作与正文编辑](./智能体与正文.png)

### 面向写作流程的专业智能体

DeepWrite 为短篇创作准备了不同职责的智能体：

- 人物智能体：设计人物、关系、动机与人物弧光
- 剧情智能体：规划主线、导语钩子、冲突、转折与结局
- 大纲智能体：把人物和剧情整理为可执行的分节大纲
- 正文专家：统筹正文结构、审阅成稿并完成润色修改
- 分节写手：围绕当前章节写作，保持情节、人物与文风连续

每个智能体都可以配置自己的系统提示词、欢迎快捷指令和模型；短篇与剧本智能体还可配置资料读取范围，长篇各阶段智能体的读取范围则固定为设定、剧情、正文与连续性账本全量互相可读。你还可以为主智能体组建子智能体团队，让复杂任务由不同角色协作完成。

### 可审阅的文稿修改

智能体不会悄悄覆盖你的文本。对文稿的写入会先生成清晰的差异对比，你可以查看新增和删除内容，再决定接受或拒绝。接受后，修改才会保存到本地项目；如果文稿已经被其他操作更新，DeepWrite 会保留较新的版本，避免静默覆盖。

![智能体修改 Diff 与接受 / 拒绝操作](./diff.png)

### 本地优先的作品与知识库

作品、章节、素材和技能以 `deepwrite.json` 与 UTF-8 Markdown 文件保存在本地文件夹中。它们不是只能被 DeepWrite 读取的封闭数据，可以直接使用 Git 进行版本管理，也可以放入同步盘，或交给其他文本工具继续处理。

DeepWrite 支持：

- 新建或打开本地作品
- 管理人物、剧情、大纲与多个正文小节
- 创建素材库和技能库，并维护 Markdown 条目
- 将指定素材库、技能库或资料分组绑定到作品
- 导入旧版书籍 ZIP，转换为当前文件夹结构
- 自动恢复未保存草稿和最近的智能体会话

### 自选模型，自由切换

你可以在模型配置中添加自己的 API 服务。当前支持：

- OpenAI Completions
- OpenAI Responses
- Anthropic Messages
- Google Generative AI

模型密钥不会暴露给页面渲染层。不同模型可以设置默认思考等级，也可以在对话时按任务切换模型。

### 学习仿写

通过学习仿写功能，DeepWrite 可以分阶段分析参考文本，提取可复用的写作特征，并将结果用于后续创作。相关模型与提示词可以在设置中单独配置。

![学习仿写界面](./学习仿写.png)

## 安装

### 使用安装包

从 [GitHub Releases](https://github.com/swjybky/deepwrite/releases) 下载与你的系统和处理器匹配的安装包：

| 系统 | 安装包 |
| --- | --- |
| Windows x64 | `DeepWrite-<version>-win-x64-test.exe` |
| macOS Apple Silicon | `DeepWrite-<version>-mac-arm64-test.dmg` |
| macOS Intel | `DeepWrite-<version>-mac-x64-test.dmg` |

Windows 运行 `.exe` 后按安装向导完成安装。

macOS 打开 `.dmg`，将 DeepWrite 拖入“应用程序”文件夹。当前测试包使用 ad-hoc 签名且未经过 Apple 公证；通过浏览器、微信等渠道下载后，macOS 可能显示安全提醒。请确认文件来源可信，然后右键应用选择“打开”，或在“系统设置 → 隐私与安全性”中允许打开。

首次启动后，建议依次完成：

1. 选择本地工作目录。
2. 在“模型配置”中添加 API 服务并测试连接。
3. 新建作品，或打开已有的 DeepWrite 项目文件夹。
4. 按需创建并绑定素材库、技能库。

### 从源码运行

开发环境要求：

- Node.js 24 或更高版本
- pnpm 11 或更高版本
- Windows x64，或 macOS Apple Silicon / Intel

```bash
git clone https://github.com/swjybky/deepwrite.git
cd deepwrite
pnpm install
pnpm dev
```

构建生产版本：

```bash
pnpm build
```

运行完整校验：

```bash
pnpm verify
```

## 构建测试安装包

测试安装包必须在对应平台构建，并从仓库根目录运行：

```bash
# 当前支持的全部测试包
pnpm pack:test

# Windows x64
pnpm pack:test:win

# macOS Apple Silicon
pnpm pack:test:mac:arm64

# macOS Intel
pnpm pack:test:mac:x64

# 两种 macOS 架构
pnpm pack:test:mac
```

产物保存在 `apps/desktop/release/`。打包流程会先执行类型检查、边界检查、测试和生产构建，再生成并验证安装包。

## 项目结构

```text
deepwrite/
├── apps/desktop/              # Electron 桌面客户端
├── packages/contracts/        # 进程间命令与事件契约
├── packages/pi-runtime-adapter/
│                              # Agent Runtime 适配层
├── packages/shared/           # 共享类型与工具
├── tools/                     # 校验、运行与打包脚本
└── docs/                      # 架构和阶段文档
```

DeepWrite 采用 Electron 多进程架构。Renderer 只负责界面，Main 管理窗口与安全 IPC，Core Utility 负责本地项目读写，Agent Utility 负责模型和智能体运行，Tool Utility 为受控工具执行提供边界。

更多技术信息请参阅：

- [架构说明](docs/ARCHITECTURE.md)
- [开发阶段状态](docs/PHASE_STATUS.md)

## License

本项目使用 [LICENSE](LICENSE) 中声明的许可协议。
