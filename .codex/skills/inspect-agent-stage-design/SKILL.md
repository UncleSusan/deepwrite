---
name: inspect-agent-stage-design
description: 只读检查 DeepWrite 某个阶段或某类智能体的实际设计，从代码追踪阶段到智能体的映射、系统提示词来源与运行时拼接、工具装配条件、工具名称/描述/参数 schema、上下文构建与注入位置、会话复用及子智能体边界，并直接在对话中形成带源码证据的中文文本清单。用于用户提出“查看某某阶段的智能体设计”“列出某智能体的提示词和工具”“分析某阶段上下文如何注入”“查看 agent prompt/tool schema”等请求；不修改业务代码，也不生成或写入审计报告文件。
---

# 查看智能体阶段设计

从当前仓库代码还原指定阶段的实际运行设计。以运行时最终装配结果为准，不把默认常量、旧版迁移提示词或测试夹具误报为当前生效设计。

## 边界

- 只读取和搜索代码、配置定义及相关测试；不得修改业务代码、配置或用户数据。
- 只在最终回复中给出文本结果；不得创建 Markdown、TXT、JSON 或其他审计产物。
- 不启动会产生写入或外部副作用的运行。仅在静态代码不足以展开动态 schema 时，才执行只读或临时目录内的本地检查。
- 不输出 API Key、Token、凭据或与目标智能体设计无关的用户内容。发现秘密值时只说明其配置来源和是否参与选择。
- 默认检查当前工作树。用户指定提交、分支或版本时才切换证据范围，并明确版本基线。

## 工作流

### 1. 解析阶段范围

把用户说的阶段名称同时按中文标签、阶段 ID、智能体 ID、工作区类型和功能入口检索。先使用 `rg` 定位，不凭记忆匹配。

优先检查：

- 短篇：`packages/contracts/src/workspace.ts`。
- 剧本：`packages/contracts/src/script-workspace.ts`。
- 长篇：`packages/contracts/src/long-workspace.ts`、`long-agent-settings.ts`、`long-agent-team.ts`。
- 学习仿写：`packages/contracts/src/learning-imitation.ts`、`apps/desktop/src/main/learning-imitation-config-store.ts`。
- 资料库：`packages/contracts/src/library-agent.ts`、`apps/desktop/src/main/library-agent-config-store.ts`。
- 技能转子智能体：`packages/contracts/src/subagent-authoring.ts` 与运行时同名实现。

确认并列出：用户名称、工作区类型、阶段 ID、实际智能体 ID、选择规则和证据位置。剧情动态阶段可能共享同一个 `plot_design` 智能体；正文阶段可能按当前文档或显式选择分成协调器与分节/分集写手，不得把阶段 ID 直接当作智能体 ID。

若存在多个合理匹配，优先分析名称完全匹配且与用户当前措辞最接近的一项，同时在开头列出其他候选。歧义会改变核心结论且代码无法消除时，再向用户询问范围。

### 2. 追踪实际运行链路

沿真实调用链读取实现，至少覆盖：

1. Renderer 在发送时如何构造 `workspaceContext`：通常从 `apps/desktop/src/renderer/src/composables/useAgentConversation.ts` 开始；学习仿写和技能转子智能体读取各自 composable。
2. `packages/contracts/src/session.ts` 如何校验阶段、profile 与上下文配对。
3. `apps/desktop/src/preload/index.ts` 如何发送 `session.prompt`。
4. `apps/desktop/src/main/index.ts` 如何解析系统配置、profile、模型与子智能体定义。
5. `apps/desktop/src/utilities/agent-entry.ts` 如何转交运行参数和流式事件。
6. `packages/pi-runtime-adapter/src/index.ts` 如何合成提示词、选择工具、构造用户消息并复用会话。

同时读取目标配置 store，区分默认值、用户可覆盖字段、不可变字段、迁移/退休值和最终 `resolve` 结果。只有名称含 `RETIRED`、仅在测试中出现或只用于迁移比较的内容，不算当前提示词。

### 3. 还原提示词

分别提取并按实际拼接顺序列出：

- Runtime 基础系统提示词。
- 当前智能体 profile 的默认提示词及其配置/覆盖来源。
- 运行时追加的不可编辑约束、工作区结构、写入审批边界、格式硬约束和子智能体要求。
- 条件分支：工作区类型、智能体 ID、人物结构格式、审批模式、焦点资源等如何改变提示词。
- 最终有效顺序：指出每一段来自哪个函数或配置；能从代码确定时给出完整文本，动态值用 `{{字段名}}` 标示并解释来源。

不要只复制默认 prompt 常量。以 `buildEffectiveSystemPrompt` 或目标运行时等价函数的最终组合为准。若仓库外持久化配置可能覆盖默认值但本轮未提供实际配置，明确写“代码默认值”，不得声称是某台机器当前生效的自定义值。

### 4. 还原有效工具集

从运行时工具选择分支进入对应 builder：

- 短篇/剧本：`packages/pi-runtime-adapter/src/short-agent-tools.ts`。
- 长篇：`packages/pi-runtime-adapter/src/long-agent-tools.ts`。
- 资料库：`library-agent-tools.ts`。
- 学习仿写：`learning-imitation-tools.ts`。
- 技能转子：`subagent-authoring-tools.ts`。
- 子智能体：`subagent-runtime.ts`，并继续检查子智能体继承的父工具 builder。

只列出目标阶段在当前条件下会装配的工具。逐个还原：

- `name`。
- 最终 `description`，包括字符串插值和条件差异。
- 最终参数 `parameters` schema，转换成易读 JSON Schema/TypeBox 风格文本；保留字段名、类型、必填/可选、枚举、长度/数量限制、嵌套结构和 `additionalProperties` 语义。
- 装配条件和权限来源，例如 profile 的 read/write access、当前 stage、工作区格式、只读状态、审批模式、附加技能/素材、是否启用子智能体。
- 写工具是直接落盘、生成提案、更新预览还是等待审批；不要仅凭工具名推断。

继续追踪 `defineTool`、schema sanitizer、共享常量和动态 `literalUnion` 等 helper，报告送给模型的 schema，而不只是源码中最初的 TypeBox 表达式。无法从静态代码确定的动态枚举，要列出生成规则和所需运行时字段，不得猜值。

### 5. 解释上下文注入

逐项列出上下文内容、来源、过滤规则、长度限制、注入角色和生命周期：

- 哪些内容进入系统提示词。
- 哪些内容进入第一条 user message 的固定上下文包装。
- 后续轮次是否只追加原始用户消息。
- active resource、阶段快照、正文目录、焦点节点、关联技能、关联素材和上传附件如何处理。
- 哪些正文只给索引、必须通过工具按需读取。
- 截断上限、readAccess 过滤、schema 校验和敏感标识隐藏规则。
- 会话 key 如何隔离不同工作区/智能体，系统提示词和工具是否每轮刷新，历史消息何时清空。

重点检查 `buildRuntimeUserPrompt`、`buildRawUserMessage`、首次消息判断和目标 composable 的快照构造。将“上下文存在于 payload”与“实际送给模型”分开说明。

### 6. 用测试交叉验证

检索对应 `*.test.ts`，验证阶段映射、提示词拼接、工具名称/schema、权限裁剪和首轮注入行为。测试只作为佐证；若测试与生产实现不一致，以生产调用链为主并指出偏差。

## 输出格式

使用中文 Markdown 文本直接回复，不生成文件。默认按以下顺序：

1. **范围与结论**：阶段、工作区、智能体 ID、设计摘要、是否存在动态配置。
2. **阶段到智能体映射**：映射规则、入口和运行链路。
3. **系统提示词**：按最终拼接顺序分段列出正文、来源、是否可配置及生效条件。
4. **工具清单**：先给工具总数和条件，再逐工具列 `name`、`description`、`parameters schema`、权限/副作用语义。
5. **上下文插入设计**：按 system / 首轮 user / 后续 user / tool-on-demand 分类。
6. **会话、审批与子智能体**：只列与目标阶段有关的复用、刷新、审批和继承行为。
7. **源码证据**：给出可点击的绝对文件路径和精确起始行号。
8. **无法静态确认项**：列出需要实际配置或运行时快照才能确定的值。

提示词或 schema 很长时仍要完整覆盖目标阶段，但可把重复定义提取为“共享片段 + 本工具差异”，不得用“等”“略”省掉字段。结论必须区分代码事实、条件推导和无法确认项。

## 完成检查

- 已证明阶段如何选择智能体，而不是只按名称猜测。
- 已区分默认提示词、可持久化覆盖、退休提示词和运行时硬约束。
- 已从最终 builder 得到有效工具集，并列出每个工具的描述与完整 schema。
- 已解释上下文的来源、过滤、截断、注入角色和首轮/后续轮次差异。
- 已说明写工具的真实副作用与审批语义。
- 已提供生产代码证据，并用测试交叉验证。
- 未修改业务代码，未在仓库中生成审计结果文件。
