# 长篇 `list` 工具二层聚焦设计

## 1. 背景

当前长篇智能体只有一个统一的 `list` 工具：

```ts
list({
  stage: "worldbuilding" | "character" | "plot" | "draft" | "continuity",
  chapter_card_id?: string
})
```

它会一次返回整个阶段的全部骨架。例如 `stage=plot` 会同时列出全书故事线、分卷、剧情点、故事情节、章卡、故事事件、事件连接、叙事落点和伏笔线。

但长篇会话的固定上下文已经注入了大部分一级导航：

- 首轮注入世界观分类及可见条目、人物类型及可见人物、分卷、剧情点和章卡目录。
- 后续轮次继续注入最新的分卷、剧情点和章卡结构。
- 固定上下文存在数量限制，并会明确标记被省略的条目。

因此，当前 `list(stage)` 的正常调用经常只是重复上下文；而智能体真正需要的是从一个已知范围继续向下查看，例如：

- 只列“次要配角”中的人物。
- 只列某个世界观分类下的条目。
- 只列某一卷、某个剧情点或某张章卡关联的剧情对象。
- 查看全书级故事线相关的故事事件和伏笔线。
- 只看某章的连续性文件与连续性人物记录。

## 2. 设计结论

保留统一的 `list` 工具，在现有 `stage` 之外新增一个必填参数 `scope_id`：

```ts
list({
  stage: "worldbuilding" | "character" | "plot" | "draft" | "continuity",
  scope_id: string
})
```

`scope_id` 必须传入。`list({ stage, scope_id })` 只提供二层列表，以一个稳定业务 ID 为范围，返回该范围的直接条目和必要关系。`list({ stage })` 是无效调用，工具不会向用户或智能体返回阶段最上层数据。

阶段最上层入口由会话上下文负责传输：世界观传全部分类 ID，人物传全部类型 ID，剧情传 `book_line` 和全部分卷 ID；正文与连续性复用分卷、人物及当前章卡入口。被截断的二层内容再通过带 `scope_id` 的 `list` 获取。

参数命名采用 `scope_id`，不采用 `parent_id`。剧情中的故事事件、叙事落点和伏笔触点常常同时关联多个对象，所传 ID 是查询锚点，不一定是严格的数据父节点。

`scope_id` 继续使用业务 ID，不引入路径、文件 ID、revision 或模型可自行拼装的复合表达式。

## 3. 目标与非目标

### 3.1 目标

- 让 `list` 从“全阶段转储”变成“按范围取得细节目录”。
- 复用固定上下文里已经提供的一级 ID，让模型自然地先定位、再下钻。
- 禁止通过工具重新查询最上层目录，避免与上下文注入重复。
- 返回足够调用 `read`、`edit`、`delete` 的稳定业务 ID 和关键关系，但不返回正文。
- 保持一个统一工具，不恢复按领域拆分的多个 `list_*` 工具。
- 仍由 Core 的工作区索引提供结构事实，不让 Agent 直接读盘或解析内部索引文件。

### 3.2 非目标

- 不把 `list` 改成搜索工具；按标题、正文或模糊语义查找仍不属于本次范围。
- 不在 `list` 中读取 Markdown 正文，也不从 Markdown 标题猜测子结构。
- 不引入分页、排序参数、字段选择器或通用查询 DSL。
- 不改变 `read` 的职责；确定目标后，仍用 `read` 读取完整正文。
- 不改变写入提案、冲突检查和 Core 原子落盘边界。

## 4. 参数契约

建议参数 Schema：

```ts
parameters: strictObject({
  stage: stageParameter,
  scope_id: Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: `^${STABLE_ID_SUFFIX_PATTERN}$`,
    description:
      "必填的二层列表范围 ID。世界观传 category_id，人物传 type_id，剧情/正文/连续性传 book_line、volume_id、arc_id、chapter_card_id、event_id 或 foreshadowing_id 等固定上下文或上一次 list 返回的业务 ID。阶段最上层目录不能通过 list 查询。"
  })
})
```

这里不能直接复用只接受带前缀实体 ID 的窄 Schema，因为内置人物类型 ID 包括 `protagonist`、`major_supporting`、`minor_supporting`、`passerby`，自定义人物类型则使用 `chartype_*`。

`stage` 和 `scope_id` 的组合由执行期校验。工具 Schema 保持扁平和严格，避免为不同 Provider 引入复杂的条件联合 Schema。

### 4.1 与 `chapter_card_id` 的关系

现有 `chapter_card_id` 只服务于 `continuity`，与新的通用聚焦参数重复。实现时建议：

1. 首次落地即由 `scope_id=chapter_*` 承担该能力。
2. 删除工具 Schema 中的 `chapter_card_id`，同步更新系统提示词和测试。
3. 不在新 Schema 中长期保留两个同义参数，避免模型随机选用。

长篇工具调用不是对外持久化 API，每轮都会向模型下发最新工具 Schema，因此无需维持长期双参数兼容层。如果后续确认历史工具调用会被原样重放，再在执行器内部短期兼容旧字段，但不要继续向模型公开旧字段。

## 5. 分阶段行为

### 5.1 世界观 `worldbuilding`

全部世界观分类的 `category_id`、标题和格式由固定上下文传输，不提供世界观一级调用。

二层调用 `list({ stage: "worldbuilding", scope_id: "world_geography" })`：

- 若范围是列表型分类，按分类内顺序列出全部条目，返回 `item_id` 和标题。
- 若范围是文本型分类，返回它是原子正文目标，并明确提示使用 `read(id=category_id)`；不伪造子条目。
- 若传入 `worlditem_*` 叶子 ID，返回明确错误：“世界观条目没有结构化子列表，请使用 read”；不解析 Markdown 正文生成列表。

示例：

```text
范围：世界观 / 地理（world_geography，列表）
共 3 项：
- worlditem_north 北境
- worlditem_capital 王都
- worlditem_south_sea 南海群岛
```

### 5.2 人物 `character`

`character_overview` 以及全部人物类型的 `type_id`、标题和人数由固定上下文传输，不提供人物一级调用。

二层调用 `list({ stage: "character", scope_id: "minor_supporting" })`：

- 按该类型内顺序列出全部人物。
- 返回 `character_id`、姓名和别名；别名是当前固定人物目录没有注入、但定位人物时有用的细节。
- 不返回核心档案、关系、状态或历史正文；读取人物正文仍需 `read(id, document)`。

示例：

```text
范围：人物 / 次要配角（minor_supporting）
共 2 人：
- character_luo 罗七（别名：七叔）
- character_ning 宁霜
读取人物详情时使用 read，并指定 document。
```

传入 `character_overview` 或 `character_*` 时，由于它们是正文目标而不是列表容器，应提示改用 `read`。这样可以避免 `list` 和 `read` 职责重叠。

### 5.3 剧情 `plot`

`book_line`、全部分卷及轻量结构计数由固定上下文传输，不提供剧情一级调用。

剧情二层允许以下范围。

#### `scope_id=book_line`

返回全书级剧情细节目录：

- `book_line` 本身作为可 `read` 的正文目标。
- 全书故事事件：ID、标题、时间标签、地点、关联剧情点和人物。
- 全书伏笔线：ID、标题、状态、计划跨度和触点数。
- 事件连接与叙事落点只返回总数，并提示应从具体事件、章卡或伏笔线继续聚焦，避免再次形成全量关系转储。

这使“全书故事线”成为明确的全书级二层入口，同时不把所有卷内章卡和所有关系边重复列一遍。

#### `scope_id=volume_*`

返回该卷内：

- 剧情点及其故事情节数量、章卡数量。
- 章卡，按卷内叙事顺序排列，并标注主剧情点和正文状态。
- 与该卷有关的故事事件数量和伏笔线数量；这里只返回摘要，具体关系继续用更窄的范围查看。

#### `scope_id=arc_*`

返回该剧情点关联的：

- 故事情节，按顺序列出 `storyplot_*` 和标题。
- 以该剧情点为主剧情点的章卡。
- 引用该剧情点的故事事件。

#### `scope_id=chapter_*`

返回该章卡的剧情侧结构：

- 章卡 ID、标题、所属卷和主剧情点。
- 叙事落点，按 `orderInChapter` 排列。
- 解析到该章的伏笔触点，标注所属伏笔线、触点类型和状态。

本调用只列剧情结构；章卡正文和连续性文件分别通过 `draft`、`continuity` 阶段查看。

#### `scope_id=event_*`

返回该故事事件的：

- 基础定位信息和关联人物、剧情点。
- 入边和出边事件连接。
- 使用该事件的叙事落点。
- 引用该事件的伏笔线或伏笔触点。

#### `scope_id=foreshadow_*`

返回该伏笔线的全部触点，按 `order` 排列，并提供计划锚点、执行锚点、触点类型和状态。

`storyplot_*`、`connection_*`、`placement_*` 和 `beat_*` 是叶子对象，没有自然的二层列表；传入时提示使用 `read`。其中 index-backed 对象由现有 `read` 返回精简元数据和正文域。

### 5.4 正文 `draft`

正文复用固定上下文中的分卷 ID，不提供正文一级调用。

二层调用支持：

- `scope_id=volume_*`：列该卷的全部章卡，按叙事顺序返回标题、主剧情点和正文状态。
- `scope_id=arc_*`：列以该剧情点为主线的章卡，仍按全书叙事顺序返回。

传入 `chapter_*` 时提示用 `read(id=chapter_id, document=body)`，因为正文是叶子目标。

### 5.5 连续性 `continuity`

连续性复用固定上下文中的分卷、人物和当前章卡 ID，不提供连续性一级调用。

二层调用支持：

- `scope_id=volume_*`：列该卷全部章卡的正文状态和连续记录状态。
- `scope_id=chapter_*`：列该章已有的连续性文档、连续性人物文件、可核验伏笔触点，以及 commit 状态。
- `scope_id=character_*`：列包含该人物连续性文件的章节，按全书叙事顺序返回，便于追踪人物状态链。

这覆盖并扩展当前 `chapter_card_id` 的单章能力。

## 6. 范围归属规则

为避免同一数据在不同实现中产生不同结果，关系型范围必须统一定义：

- 事件属于某剧情点：`event.arcIds` 包含该剧情点 ID。
- 事件属于某卷：事件关联该卷中的任一剧情点，或事件存在落在该卷章卡上的叙事落点。
- 章卡属于某剧情点：`chapter.primaryArcId` 等于该剧情点 ID。非主线关联不应由工具自行猜测。
- 伏笔触点属于某章：优先使用触点的 `chapterCardId`；否则通过 `placementId` 解析到叙事落点的 `chapterCardId`。
- 伏笔线属于某卷：至少一个触点的卷、剧情点、事件、叙事落点或章卡锚点可解析到该卷。
- 人物连续性属于某章：该章 `characterContinuity` 中存在对应 `characterId`。

所有关系解析应放在 `tool-list` 的纯函数或独立的聚焦查询模块中，并以工作区索引为唯一输入，避免调用之间产生隐式状态。

## 7. 输出约定

继续返回中文纯文本，不包装 JSON。统一格式为：

```text
范围：<阶段> / <范围标题>（<scope_id>）
共 <N> 项：
- <stable_id> <title>（<必要关系>）
...
下一步：需要正文时使用 read(...)
```

输出遵循以下约束：

- 第一行必须回显解析后的阶段和范围，便于模型发现传错范围。
- 所有可继续操作的对象必须返回稳定业务 ID。
- 只返回定位和判断下一步所需的关系；不得泄露路径、fileId、revision。
- 顺序沿用领域顺序：分类/类型/剧情点使用 `order`，章卡使用分卷顺序加 `narrativeOrder`，触点使用 `order`。
- 空列表必须明确返回“共 0 项”，不能用模糊描述。
- 不返回 Markdown 正文片段；正文由 `read` 负责。
- 不把内部枚举直接堆给用户，已有中文标签的状态和关系应使用中文标签，可在必要时保留机器值。

## 8. 校验与错误

执行顺序建议为：

1. 工具 Schema 要求 `scope_id`；执行器也必须防御性拒绝缺失值，且不得读取索引或返回最上层数据。
2. 校验当前智能体是否有该 `stage` 对应根目录的读取权限。
3. 读取并缓存本轮最新工作区索引。
4. 解析 `scope_id` 的真实类型和所属阶段。
5. 校验该范围是否允许用于当前阶段。
6. 返回聚焦列表，或给出可执行的错误提示。

典型错误：

```text
范围 minor_supporting 属于人物阶段，不能用于 plot；请改用 stage=character。
```

```text
worlditem_capital 是世界观正文条目，没有结构化子列表；请使用 read(id=worlditem_capital)。
```

```text
未找到范围 arc_escape；请使用当前上下文或上一次 list 返回的 scope_id。
```

不能只返回“参数错误”，否则模型容易重复同一错误调用。

## 9. 固定上下文与提示词调整

工具落地时应同步修改长篇提示词，避免新能力存在但模型仍按旧习惯调用。

系统工具边界建议调整为：

```text
固定上下文已提供全部最上层入口。list 的 stage 与 scope_id 都必须提供，且 scope_id 必须来自固定上下文或上一次 list；不得省略 scope_id 查询阶段最上层数据。需要次要人物、某个世界观分类、某卷/剧情点/章卡、全书故事线或某章连续性等细节目录时使用 list，需要正文时使用 read。
```

固定上下文中的省略提示也应给出精确调用：

- 世界观分类内省略：`list(stage=worldbuilding, scope_id=<category_id>)`。
- 某人物类型内省略：`list(stage=character, scope_id=<type_id>)`。
- 章卡窗口省略：优先根据所属卷调用 `list(stage=draft, scope_id=<volume_id>)`。
- 伏笔目录省略：`list(stage=plot, scope_id=book_line)`，之后再对具体伏笔线下钻。

首轮注入完整的轻量目录，后续轮次也必须重新注入世界观分类入口、人物类型入口、`book_line`、分卷和轻量结构导航，保证 `scope_id` 在结构变化后仍可取得。人物、世界观条目和章卡等二层明细可以继续截断，截断提示必须带可调用的 `scope_id`。

## 10. 代码落点

实现预计只需要修改长篇 Agent 查询层和相关提示词，不新增 Core 命令：

- `packages/pi-runtime-adapter/src/long-agent-tools/tool-list.ts`
  - 防御性拒绝缺失 `scope_id`，只分派二层范围解析。
  - 分阶段关系解析拆到 `list-world-character.ts`、`list-plot.ts`、`list-draft-continuity.ts`，共用格式化与关系工具放在 `list-shared.ts`；不要把所有职责继续堆回入口文件。
- `packages/pi-runtime-adapter/src/long-agent-tools/schemas.ts`
  - 增加 `scope_id` 参数 Schema。
- `packages/pi-runtime-adapter/src/long-agent-tools/entity-registry.ts`
  - 复用现有稳定 ID 类型解析；补充人物类型范围判断和可下钻范围定义。
- `packages/pi-runtime-adapter/src/prompts-long.ts`
  - 更新统一工具边界。
- `packages/pi-runtime-adapter/src/prompts-long-directory.ts`
  - 将世界观、人物省略提示改成带 `scope_id` 的调用。
- `packages/pi-runtime-adapter/src/prompts-long-navigation.ts`
  - 将章卡窗口省略提示改成卷级聚焦调用。
- `packages/pi-runtime-adapter/src/long-agent-tools.surface.test.ts`
  - 将“各阶段一次列全”的旧断言改为必填参数和二层聚焦断言。

`LongWorkspaceIndexSnapshot` 已包含本设计需要的分类、人物类型、人物、剧情关系和连续性文件索引，因此不需要新增 `long.*` 契约、Preload API、Main 路由或 Core Utility handler。

## 11. 测试设计

至少覆盖以下场景：

- 工具 Schema 的 `stage` 与 `scope_id` 都是必填字段，并保持 `additionalProperties: false`。
- 每个阶段的不带范围调用都被拒绝，且不会读取或返回最上层数据。
- `minor_supporting` 和自定义 `chartype_*` 都能列人物。
- 列表型世界观分类返回条目；文本型分类提示 `read`；叶子条目拒绝下钻。
- `book_line`、卷、剧情点、章卡、事件和伏笔线分别返回规定的关系。
- 卷范围不会混入其它卷的剧情点、章卡和事件。
- 章卡伏笔触点同时覆盖直接 `chapterCardId` 和经 `placementId` 解析两种路径。
- `draft` 的卷级列表保持叙事顺序，`arc_*` 只返回主剧情点匹配的章卡。
- `continuity` 支持卷、章卡和人物三个范围。
- 跨阶段 ID、未知 ID、叶子 ID 都返回含正确下一步的错误。
- 所有输出都不包含文件路径、fileId、revision 或正文内容。
- 无权读取某阶段时，在读取/格式化数据前拒绝。
- Provider 工具 Schema 兼容测试继续通过。

## 12. 验收标准

本设计实现完成后，应满足：

- 智能体询问“有哪些次要人物”时，使用 `list(stage=character, scope_id=minor_supporting)`，结果不包含主角或路人。
- 智能体需要某个世界观分类的条目时，只返回该分类，不再返回全部世界观。
- 智能体处理某卷、剧情点、章卡、事件或伏笔线时，只获得该范围内的关系骨架。
- `list(stage=plot)` 因缺少 `scope_id` 直接失败，不返回任何阶段目录。
- 固定上下文已经给出 ID 时，提示词引导模型直接调用二层列表，不重复一级列表。
- 任何正文仍必须由 `read` 明确读取，`list` 不承担正文预览。
- 不新增跨进程协议，不突破 Renderer、Main、Core、Agent 的既有职责边界。

## 13. 暂不采用的方案

### 增加 `detail=true`

布尔参数只能表达“更详细”，不能说明详细到哪一类人物、哪个分类或哪一卷，仍会得到全阶段转储。

### 增加通用 `filter` 文本

自由文本过滤会把稳定 ID 查询退化为模糊搜索，结果不可预测，也难以做严格权限和归属校验。

### 增加 `kind`、`parent_id`、`status`、`limit` 等多个参数

虽然表达力更强，但会迅速形成查询 DSL，增加模型误调用和 Provider Schema 兼容成本。当前数据已有稳定业务 ID，单个 `scope_id` 足以表达二层范围。

### 为每类对象新增独立工具

例如 `list_minor_characters`、`list_volume_events` 会重新扩大工具面，与当前统一长篇 CRUD 工具的方向冲突。
