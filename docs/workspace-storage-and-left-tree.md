# DeepWrite 作品存储与左侧导航树结构详解

本文梳理 DeepWrite 三类创作空间（短篇、剧本、长篇）在磁盘上的底层文件结构，以及工作台左侧资源树的构成与数据流。内容以 `packages/contracts` 中的 Zod 契约为准，实现位于 Core Utility（`apps/desktop/src/utilities/`）。

## 0. 总览：两套存储体系

| 体系 | 覆盖作品 | 实现 | 项目清单 | 注册表 |
| --- | --- | --- | --- | --- |
| Folder Catalog | 短篇、剧本、素材库、技能库（含分组） | `folder-catalog-store.ts` + `folder-catalog-store/` | 每个项目文件夹下的 `deepwrite.json` | `catalog-registry.json`（+ `.bak`） |
| Long Project | 长篇 | `long-project-store.ts` + `long-project-store/` + `long-project-catalog.ts` | 每个项目文件夹下的 `deepwrite.json`（极简）+ `long/index.json`（结构索引） | `long-project-registry.json`（+ `.bak` + `.lock`） |

两套体系 deliberately 独立（见 `long-project-catalog.ts:77-81` 的注释）：打开长篇不会触发短篇/剧本快照水合大体积章节正文。

两类注册表都放在 Electron `userData` 目录（Core Utility 由 `DEEPWRITE_USER_DATA_PATH` 环境变量启动，见 `core-entry.ts:65`）：

```text
<userData>/
├── catalog-registry.json          # 短篇/剧本/素材/技能注册表（索引，非真相源）
├── catalog-registry.json.bak      # 最近一次已知良好的备份
├── draft-recovery.json            # 短篇/剧本正文崩溃恢复快照
├── long-project-registry.json     # 长篇注册表（含导航摘要缓存，schemaVersion 2）
├── long-project-registry.json.bak
├── long-project-registry.lock     # 跨进程锁（O_EXCL，带 stale 检测）
└── catalog-projects/              # 默认项目父目录（创建时可另选目录）
    ├── books/                     # 短篇、剧本默认落在同一父目录
    ├── materials/                 # 素材库
    ├── material-groups/           # 素材分组（仅清单，无正文文件）
    ├── skills/                    # 技能库
    └── skill-groups/              # 技能分组
```

注意：注册表只是索引，**项目文件夹才是真相源**。注册表损坏时会自动改名 `.corrupt-<时间戳>` 并重建空索引，用户可通过「打开已存在作品」重新注册（`folder-catalog-store/registry.ts:243-297`）。项目默认落在上面这些父目录，也可以通过「打开已有作品 / 在指定目录创建」（`catalog.*AtPath`、`long.createBookAtPath` 等命令）放到任意位置；`workspaceDirectory.choose` 用于让用户选目录。

所有写盘都走原子写（临时文件 `.deepwrite-<随机>.tmp` + `rename`，权限 0o600/0o700），见 `folder-catalog-store/paths-io.ts:386-399`；长篇注册表另有 `fsync` + 硬链接/符号链接防护。

## 1. 短篇 / 剧本的磁盘结构

短篇和剧本共用同一种项目结构（`kind: "deepwrite.book"`），仅 `bookType` 和默认正文目录标题不同。一个作品的文件夹示例：

```text
我的短篇/                        # 文件夹名 = 书名（重名时自动追加 -2、-3…）
├── deepwrite.json               # 项目清单（唯一元数据源）
├── AGENTS.md                    # 作品上下文（写作约束，供智能体读取）
└── stages/                      # 所有设定/剧情阶段文档
    ├── character-design.md      #   人物设计（list 模式时是「概览」）
    ├── worldbuilding.md         #   世界观
    ├── plot-design.md           #   剧情设计
    ├── intro-design.md          #   导语设计
    ├── plot-refine.md           #   剧情细化
    ├── narrative-perspective.md #   叙事视角
    ├── outline.md               #   大纲
    ├── <自定义阶段>.md           #   用户新增的剧情阶段
    ├── <人物条目>.md             #   人物 list 模式下每个角色一个文件
    └── draft/                   # 正文目录（虚拟目录，固定 id "draft"）
        ├── intro.body.md        #   小节「导语」正文
        ├── intro.state.md       #   小节「导语」人物状态
        ├── section-1.body.md    #   小节「第一节」正文
        └── section-1.state.md   #   小节「第一节」人物状态
```

剧本的差异只有：`bookType: "script"`，正文目录标题为「剧集」（短篇为「正文」），默认小节为「第一集」（短篇为「导语 + 第一节」，见 `packages/contracts/src/expert-draft.ts:65-95`）。

### 1.1 文件命名规则

- 正文/设定文件路径是相对项目根的 `.md` 路径，契约 `CatalogProjectContentPathSchema` 强制：不允许绝对路径、反斜杠、`.`/`..` 段（`packages/contracts/src/catalog/kinds.ts:34-61`）。
- 设定文档统一放 `stages/`，文件名由文档 id 经 `sanitizePathSegment` 清洗而来（NFC 规范化、非法字符转 `-`、空白转 `-`，最长 80 字符），撞名时追加 `-2`、`-3`（`folder-catalog-store/paths-io.ts:20-74`）。
- 正文小节每个小节两个文件：`stages/draft/<小节id>.body.md`（正文）和 `stages/draft/<小节id>.state.md`（人物状态），见 `manifest.ts:671-728`。
- 清单里 `id` 与 `path` 全局唯一，且解析后必须指向不同真实文件（inode 级去重），防止两个条目指向同一文件。

### 1.2 `deepwrite.json` 字段详解（书籍，schemaVersion 4）

定义见 `packages/contracts/src/catalog/manifests.ts`。当前版本字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schemaVersion` | `4` | 清单版本。v1 正文单文件、v2 引入正文目录、v3 引入剧情阶段、v4 引入人物结构；旧版本读取时自动迁移 |
| `revision` | 非负整数 | 项目修订号，每次写入 +1，用于乐观并发冲突检测 |
| `kind` | `"deepwrite.book"` | 项目种类 |
| `id` | 字符串 | 项目 ID（`createCatalogId("book")` 生成） |
| `title` | 字符串 | 书名 |
| `createdAt` / `updatedAt` | ISO 时间戳 | 创建/更新时间 |
| `bookType` | `"short" \| "script"` | 短篇或剧本 |
| `genre` | 枚举 | 题材：世情 / 追妻 / 科幻 / 悬疑 / 其他（短篇剧本共用一套，见 `SCRIPT_BOOK_GENRES`） |
| `status` | `"editing" \| "completed"` | 连载状态 |
| `linkedMaterialIdsByKind` | 对象 | 绑定的素材库 id，按 `character/gimmick/plot/draft/other` 五类分组 |
| `linkedSkillIdsByKind` | 对象 | 绑定的技能库 id，按 `general/plot/style/other` 四类分组 |
| `characterStructure` | 对象 | 人物结构：`{format:"text"}` 单文档模式，或 `{format:"list", items:[{id,title,order}]}` 列表模式（每个 item 对应 `documents` 里一篇文档，`character-structure.ts`） |
| `plotStages` | 数组 | 剧情阶段绑定 `[{id,title,description,enabled}]`。定义全局统一（注册表 `creativePlotStages`），每本书本地记录顺序与启用开关；新书默认只启用 剧情设计/导语设计/剧情细化 三项（`plot-stages.ts:129-153`） |
| `documents` | 数组 | 设定文档清单 `[{id,title,path,createdAt,updatedAt}]`，最多 4096 篇；内容不在清单里，在 `path` 指向的 Markdown 文件 |
| `draft` | 对象 | 正文目录 `{id:"draft", title, sections[], createdAt, updatedAt}`；每个 section 含 `id/title/wordCountRequirement` 和 `body`、`characterState` 两个文件条目（各含 `id/title/path/createdAt/updatedAt`），小节 1–100 个 |
| `draftSectionCreationOperations` | 数组（可选） | 批量建小节操作的幂等记录（`operationId` + 请求哈希 + client/服务端小节 id 映射），用于崩溃后去重 |

正文小节两个文件的文档 id 有固定格式：`draft-section:<sectionId>:body` 和 `draft-section:<sectionId>:character-state`（`draft-directory.ts:21-33`）。

### 1.3 素材库 / 技能库（同一体系，顺带说明）

```text
我的人设素材库/
├── deepwrite.json    # kind: "deepwrite.material-library"
└── entries/          # 每条素材一个 .md
    ├── <条目id>.md
    └── ...
```

素材库清单额外字段：`materialType`（short/long/script）、`materialKind`（character/gimmick/plot/draft/other/mixed）、`parentGenre`/`subGenre`（题材分类）、`overview`（库介绍，**正文直接存在清单里**）、`entries[]`（每条含 `stageId` 阶段分类：梗/人设/剧情设计/导语设计/剧情细化/优秀正文片段/其他）。技能库类似：`skillKind`（general/plot/style/other）、`isBuiltin`、`marketplaceSource`，条目 `stageId` 为 人物技能/剧情技能/大纲技能/正文专家编写技能/分节写手技能。分组项目（`material-group`/`skill-group`）只有清单没有 `entries/`，`members` 记录成员库 id。

### 1.4 其他文件

- `AGENTS.md`：作品上下文，创建时写入默认文案（短篇/剧本各一套，`writing-context.ts`），上限 10,000 字符，智能体读写它来获取写作约束。
- `draft-recovery.json`（userData 级）：崩溃恢复用的正文快照。

## 2. 长篇的磁盘结构

长篇项目同样是一个文件夹 + `deepwrite.json`，但清单刻意保持极简，结构和文件索引全部在 `long/index.json`（见 `book.ts:210-224` 注释）。ID 全部是不透明稳定 id（`longbook_`、`volume_`、`arc_`、`chapter_`、`character_`、`world_`、`commit_`、`file_` 等前缀，见 `long-workspace/ids.ts:141-206`）。

```text
我的长篇/
├── deepwrite.json                    # 极简清单（见 2.1）
├── AGENTS.md                         # 长篇写作上下文（默认「长篇上下文」文案，≤10,000 字符）
└── long/
    ├── index.json                    # 工作区索引：全部结构 + 文件引用 + 账本投影（见 2.2）
    ├── plot/
    │   └── book-line.md              # 全书故事线
    ├── worldbuilding/
    │   └── <world_*>/                # 每个世界观分类一个目录（目录名为 id 的 sha256 前 32 位）
    │       ├── content.md            #   文本型分类：分类本身即正文
    │       ├── overview.md           #   列表型分类：概览（该类地图）
    │       └── items/
    │           └── <worlditem_*>.md  #   列表型分类：每个条目一个文件
    ├── characters/
    │   ├── overview.md               # 人物概览（索引，统计所有人物）
    │   └── <character_*>/            # 每个人物一个目录（哈希名）
    │       ├── core-profile.md       #   核心档案
    │       └── relationships.md      #   人物关系
    ├── story-plots/
    │   └── <storyplot_*>/
    │       └── body.md               # 故事情节（剧情点下的场景链正文）
    ├── chapters/
    │   └── <chapter_*>/              # 每张章卡一个目录（哈希名）
    │       ├── card.md               #   章卡（本章任务，不写正文）
    │       ├── body.md               #   章节正文
    │       ├── character-state.md    #   章末人物状态（账本）
    │       └── handoff.md            #   下一章接续包（账本）
    ├── continuity/
    │   └── chapters/
    │       └── <chapter_*>/
    │           ├── foreshadowing-changes.md   # 本章伏笔触点变化
    │           ├── world-reveals.md           # 本章世界观揭露（可选）
    │           └── characters/
    │               └── <character_*>/
    │                   ├── current-state.md   # 该人物本章后当前状态
    │                   └── history.md         # 该人物历史轨迹增量
    └── ledger/
        └── <commit_*>.json           # 每次章节提交的账本记录（JSON，含正文快照与变更）
```

路径规则：目录名是实体 id 的 `sha256` 前 32 位十六进制（`long-project-store/paths.ts:20-22` 的 `storageKey`），这样展示名/顺序变化永远不影响身份。契约层另有「兼容路径」：旧版项目的 `long/characters/<原名>/` 等未哈希目录在读取时仍然兼容（`paths.ts:234-268`）。文件引用统一是 `{id, path, revision, updatedAt}` 四元组，`revision` 为 `v2:<字节数>:<sha256>` 内容哈希，用于并发冲突检测。

### 2.1 `deepwrite.json`（长篇清单，schemaVersion 1）

字段（`long-workspace/book.ts:215-223`）：`schemaVersion`、`revision`、`kind: "deepwrite.long-book"`、`id`（`longbook_*`）、`title`、`bookType: "long"`、`genre`（自由字符串）、`status`（editing/completed）、`linkedMaterialIdsByKind` / `linkedSkillIdsByKind`（同短篇）、`linkedResourceStageScopes`（可选：按库限制启用的长篇阶段）、`createdAt` / `updatedAt`、`workspaceIndexFile`（固定指向 `long/index.json` 的文件引用）。

### 2.2 `long/index.json`（工作区索引）

`LongWorkspaceIndexSnapshotSchema`（`long-workspace/index-schema.ts`）字段：

- `schemaVersion` / `revision` / `bookId` / `updatedAt`：版本与同步水位。
- `bookLine`：`long/plot/book-line.md` 的文件引用。
- `featureSettings`：三项条目布局开关（`worldbuildingItemLayout` / `characterAndContinuityItemLayout` / `plotItemLayout`），值 `top-tabs` / `right-list` / `left-tree`，**直接决定左侧树是否展开到条目级**（见第 3 节）。
- `worldbuilding[]`：世界观分类。`format: "text"`（contentAuthority: markdown，一个 `content.md`）或 `format: "list"`（contentAuthority: files，`overview` + `items[]`，每个 item 有 `file` 引用）。新书默认建 7 个分类：规则/势力/地理/历史/术语/境界/物品（`long-project-store/types.ts:56-64`）。
- `characterOverview`：人物概览文件引用。
- `characterTypes[]`：人物类型（内置 主角/主要配角/次要配角/路人，可自定义 `chartype_*`）。
- `characters[]`：人物条目 `{id, name, group(类型id), order, aliases[]}`。
- `characterFiles[]`：每个人物的文件对 `{characterId, coreProfile, relationships}`。人物的「当前状态/历史轨迹」**不在人物目录**，而是映射自最新已提交章节的 continuity 文件。
- `plot`（`LongPlotIndexSchema`，`plot.ts:370-381`）：
  - `volumes[]`：分卷 `{id, title, order, summary(卷纲)}`。
  - `arcs[]`：剧情点 `{id, volumeId, title, order, summary?, outline}`。
  - `chapterCards[]`：章卡 `{id, volumeId, primaryArcId, title, narrativeOrder}`；章卡正文计划在 `chapters/<id>/card.md`。
  - `storyEvents[]`：故事事件（故事真相）`{id, title, summary, timeMode, timeLabel, timeValue?, storyOrder, location, arcIds, characterIds}`。
  - `storyPlots[]`：故事情节 `{id, arcId, title, order, file}`（每个指向 `story-plots/<id>/body.md`）。
  - `eventConnections[]`：事件连接 `{source, target, type: before/same_time/overlaps/causes/enables/conceals, note}`。
  - `narrativePlacements[]`：叙事落点 `{eventId, chapterCardId, orderInChapter, mode: scene/flashback/…, disclosure: hint/partial/full/false, writingPrompt, status, commitId}`。
  - `foreshadowing[]`：伏笔线 `{id, title, coreQuestion, hiddenTruth?, plannedSpan?, truthEventId, expectedReaderEffect, status, beats[]}`；每个触点 beat 有类型（source/plant/reinforce/misdirect/partial_reveal/reveal/payoff/aftermath）、计划锚点（卷/剧情点）与执行锚点（事件/落点/章卡）。
- `chapters[]`：每章的文件束 `{chapterCardId, body, card, characterState, handoff, foreshadowingChanges?, worldReveals?, characterContinuity[], bodyStatus: empty/written, commitId}`。
- `ledger`：`{committedThroughChapterId, commits[], projection}`。`commits[]` 每项 `{id, mode: structured/text_files/import_checkpoint, sequence, chapterCardId, committedAt, reversible, sourceRevision, placementIds, foreshadowingBeatIds, recordFile}`；`recordFile` 指向 `long/ledger/<hash>.json`，记录文件内含章末摘要、覆盖度核验、事实/认知/开放循环变更、文件变更快照等（`long-ledger.ts`）。`projection` 是全部提交累计出的连续性投影（facts/knowledge/openLoops/latestHandoff）。

### 2.3 导航快照（LongBookSummary）

注册表 v2 会在每个长篇条目里缓存一份 `LongBookSummary`（≤1 MiB），其中的 `navigation`（`navigation.ts`）只含计数和轻量条目（卷/剧情点/章卡/人物/世界分类的 id+标题+order，章卡带 `bodyStatus`），**不含文件引用和正文**。左侧树靠它在不打开长篇的情况下就能画出整棵树。

## 3. 左侧资源树

### 3.1 组件与数据流

```text
Core Utility (folder-catalog-store / long-project-catalog)
  │  catalog.index（元数据快照，正文只带字节数/戳，不带水合内容）
  │  long.list（LongBookSummary 列表）
  ▼  window.deepwrite 白名单 IPC（preload 双向 Zod 校验）
stores/catalogIndexStore.ts        stores/longWorkspaceStore.ts（由生命周期 coordinator 驱动）
  │  projectCatalogWorkspace()（data/catalogWorkspace.ts）
  ▼
CatalogWorkspaceProjection { resourceSections, workspaceDocuments, draftDirectories, index(多张查找 Map) }
  │
  ▼  useWorkspaceResourceTreeCoordinator.ts
     · 叠加用户书籍偏好（隐藏/排序，localStorage）
     · 把长篇节点（projectLongWorkspaceNavigation）并入「创作空间」section
     · createResourceTreeLookup 一次性建索引
  ▼
LeftSidebar.vue → TreeSection.vue（每个 section）→ TreeNodeItem.vue（递归渲染节点）
```

正文内容不走快照：树/文档先以「元数据投影」渲染（`catalogContentBytes/Stamp/Loaded`），打开文档时才经 `catalog.readDocument` 惰性水合并进 LRU 缓存（`catalogIndexStore.ts` 的 `readDocument`）。

### 3.2 顶层三个 section

固定为（`catalogWorkspace.ts:1200-1226`）：

- **创作空间**（`creation`）：短篇书、剧本书、长篇书节点。操作菜单：新建作品 / 打开已有作品 / 导入作品 / 刷新长篇列表。
- **技能库**（`skill`）：技能分组节点 + 按 `skillKind` 分类（通用/剧情设计/文风写作/其他）的库节点；每库下有「库介绍」+ 条目节点。操作：新建技能库 / 新建分组 / 打开已存在 / 导入旧版。
- **素材库**（`material`）：素材分组 + 按人设/剧情/梗/正文/其他分类的库节点，结构同上。

### 3.3 节点数据结构 `ResourceTreeNode`

定义在 `types/workspace.ts:156-212`。通用字段：`id`、`label`、`icon`、`badge`（角标）、`muted/readOnly/missing/unavailable`、`children`、`selectableBranch`（有子节点仍可被选中为上下文）、`targetDocumentId`（合成导航节点指向的真实编辑器文档）。领域字段：

- 书籍节点：`catalogNodeType: "book" | "long-book"`、`workspaceType: "short" | "script" | "long"`、`projectRevision`、`boundSkill/MaterialLibraryIds(ByKind)`（绑定关系）。
- 目录/分类节点：`catalogNodeType: "category"`、`stageCategoryId`（阶段 id）、`draftDirectoryId`、`characterDirectory`。
- 文档/小节节点：`catalogNodeType: "document"`、`expertSectionId`（正文小节）、`characterStateDocumentId`（配套人物状态文档）、`characterItemId`（人物条目）、`catalogEntryId`（库条目）。
- 长篇节点：`longBookId`、`longWorkspaceSelection`（选中后给长篇工作区的选择描述）、`longCharacterGroup`、`longDraftVolumeId`、`longTreeCollection` / `longTreeItem`（可增删排序的集合/条目标记）。

### 3.4 短篇 / 剧本书的树层级

`createBookProjection()`（`catalogWorkspace.ts:570-781`）把一本书投影为：

```text
📖 《书名》 [短篇|剧本]
├── 👤 人物            （list 模式时为可选择目录：概览 + 各人物条目；text 模式时单节点）
├── ✨ 剧情            （启用的剧情阶段各一节点：世界观/剧情设计/导语设计/剧情细化/叙事视角/大纲…，按书内顺序）
└── 📁 正文|剧集       （虚拟目录，可选中）
    ├── 导语 / 第一节…  （短篇默认：导语 + 第一节）
    └── 第一集…         （剧本默认：第一集；每节点同时引用 body 与 character-state 两个文档）
```

未匹配到阶段的自定义文档并入「剧情」分组末尾。点击叶子节点打开对应 `WorkspaceDocument`（含 `stageId`、`shortAgentId`、字数要求等编辑器上下文）。

### 3.5 长篇书的树层级

`projectLongWorkspaceNavigation()`（`utils/longWorkspaceResourceTree.ts`）把长篇投影为五大根节点（对应长篇智能体的五个阶段）：

```text
📖 《书名》 [长篇]
├── 🌐 世界观 [n]
│   ├── 各世界观分类 [列表|文本]
│   │   └── （left-tree 布局时）概览 + 各条目     ← longTreeCollection/Item，可新建/排序/删除
│   └── 世界观揭露（只读，映射最近一次提交）
├── 👤 人物设计 [n]
│   ├── 概览
│   └── 各人物类型目录（主角/主要配角/…）[人数]
│       └── （left-tree 布局时）各人物节点
├── 🕓 剧情设计 [卷+点+卡数]
│   ├── 全书故事线 [故事线]（left-tree 时：全书总纲 + 各卷）
│   ├── 剧情点 [n]（按卷分组；left-tree 时展开到剧情点）
│   ├── 伏笔总览 [n]
│   └── 章卡 [n]（按卷分组 [m 章]；left-tree 时展开到章卡）
├── ✏️ 正文 [章数]
│   └── 各卷目录 [m 章]（longDraftVolumeId，可加小节）
│       └── 各章 [待编写|待提交|已完成]
└── 📒 连续性账本 [已提交章数]
    ├── 待处理章节 [n]（有正文但未提交的章）
    └── 章节记录 [n]（按提交序号，left-tree 时展开到每个连续性文件，只读）
```

前三级（卷/剧情点/章卡、人物、世界观条目）是否在树上展开，由该书的 `featureSettings.*ItemLayout` 决定（`top-tabs`/`right-list` 时在工作区内展示，树只到分类级）。未打开的书也能画出这棵树（用注册表缓存的 `navigation` 摘要）；打开后（`long.open` → `activeLongWorkspaceIndex`）用完整索引 reconcile 选择并补齐条目级节点与账本状态。

### 3.4 树交互

- **节点选择**：`TreeNodeItem` 点击 emit `select`，由 `useWorkspaceResourceCoordinator` 解析为工作区选择并联动右侧编辑器；长篇节点另由 `synchronizeSelectedLongResourceForLayout` 按布局偏好同步树选中态。
- **置顶**：书籍/库节点可 pin，`pinnedResources.ts` 持久化到 localStorage，置顶区排在 section 顶部。
- **行内操作菜单**（hover 出现的「⋯」）：书籍有 管理结构/重命名/复制/导出/绑定技能/绑定素材/移除/删除；库有 新建条目/重命名/复制条目/粘贴/删除等；长篇另有 同步旧版。正文小节支持上移/下移/删除；人物条目支持重命名/上移/下移/删除；长篇集合条目支持新建与 move-up/move-down/delete。
- **拖拽**：素材/技能条目可跨库拖拽移动（`moveLibraryEntry`，支持排序到某条目前或改阶段分类）。
- **section 级菜单**：每个 section 头部「＋」展开新建/打开/导入菜单；section 可整体折叠。

## 4. 关键文件索引

| 主题 | 位置 |
| --- | --- |
| 短篇/剧本/库清单 Schema | `packages/contracts/src/catalog/manifests.ts`、`kinds.ts`、`draft-directory.ts`、`character-structure.ts`、`plot-stages.ts` |
| Folder Catalog 实现 | `apps/desktop/src/utilities/folder-catalog-store.ts` 及 `folder-catalog-store/`（manifest/lifecycle/registry/paths-io/snapshot/writing-context…） |
| 长篇契约 | `packages/contracts/src/long-workspace/`（book/ids/index-schema/plot/characters/continuity/worldbuilding/navigation）、`long-ledger.ts` |
| 长篇实现 | `apps/desktop/src/utilities/long-project-store.ts` 及 `long-project-store/`（paths/io/lifecycle/documents/operations/commit-chapter/write-chapter/revisions/rollback/search…）、`long-project-catalog.ts`、`long-workspace-service.ts` |
| Core 命令路由 | `apps/desktop/src/utilities/core-entry.ts`（`catalog.*`、`long.*`） |
| 树数据投影 | `apps/desktop/src/renderer/src/data/catalogWorkspace.ts`、`utils/longWorkspaceResourceTree.ts`、`utils/longWorkspaceDraftTree.ts`、`utils/resourceTreeLookup.ts` |
| 树状态与编排 | `stores/catalogIndexStore.ts`、`stores/longWorkspaceStore.ts`、`composables/useWorkspaceResourceTreeCoordinator.ts`、`useWorkspaceResourceCoordinator.ts` |
| 树组件 | `components/LeftSidebar.vue`、`TreeSection.vue`、`TreeNodeItem.vue` |
| 树节点类型 | `apps/desktop/src/renderer/src/types/workspace.ts`、`types/longWorkspace.ts` |
