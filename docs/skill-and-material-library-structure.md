# 技能库 / 素材库：磁盘结构与左侧树

只记录文件与树节点的层级。技能库、素材库走同一套 Folder Catalog，每个库或分组都是独立项目文件夹；左侧树由快照投影而成，分类节点不落盘。

## 1. 默认落盘位置

```text
<userData>/
├── catalog-registry.json          # 索引（非真相源）：id → 项目文件夹路径
├── catalog-registry.json.bak
└── catalog-projects/
    ├── skills/                    # 技能库
    ├── skill-groups/              # 技能分组（仅清单）
    ├── materials/                 # 素材库
    └── material-groups/           # 素材分组（仅清单）
```

项目也可以建在任意目录，注册表仍指向该文件夹。文件夹名 = 库/分组标题（非法字符清洗后最长 80 字，重名追加 `-2`、`-3`…）。

## 2. 技能库磁盘结构

### 2.1 单个技能库

```text
<技能库标题>/
├── deepwrite.json                 # kind: "deepwrite.skill-library"
└── entries/                       # 创建时即存在，可为空
    ├── <条目id>.md                # 文件名由条目 id 清洗而来，撞名追加 -2、-3
    └── …
```

- 库说明（overview）写在 `deepwrite.json` 里，没有独立 `.md`。
- 条目正文只存在 `entries/`；清单 `entries[]` 记录 `id` / `title` / `path` / `stageId`。
- `skillKind`：`general` | `plot` | `style` | `other`
- 条目 `stageId`：`character_design` | `plot_design` | `outline` | `draft` | `expert_section_writer`
- `skillType`：`short` | `long` | `script`（用途标记，不改变目录形状）
- 内置库 `isBuiltin: true`，磁盘形状相同

### 2.2 技能分组

```text
<分组标题>/
└── deepwrite.json                 # kind: "deepwrite.skill-group"
```

没有 `entries/`。`members` 只存成员库 id：

```text
members.general / plot / style / other
```

成员库仍各自占用 `skills/`（或自选目录）下的独立文件夹。

## 3. 素材库磁盘结构

### 3.1 单个素材库

```text
<素材库标题>/
├── deepwrite.json                 # kind: "deepwrite.material-library"
└── entries/
    ├── <条目id>.md
    └── …
```

- 库介绍（overview）写在 `deepwrite.json` 里，没有独立 `.md`。
- `materialKind`：`character` | `gimmick` | `plot` | `draft` | `other` | `mixed`
- 条目 `stageId`：`gimmick` | `character` | `pacing` | `intro` | `plot_refine` | `draft_excerpt` | `other`
- `materialType`：`short` | `long` | `script`
- `parentGenre` / `subGenre` 存在清单里，不形成子目录

### 3.2 素材分组

```text
<分组标题>/
└── deepwrite.json                 # kind: "deepwrite.material-group"
```

`members` 只存成员库 id：

```text
members.character / gimmick / plot / draft / other
```

成员库仍各自占用 `materials/`（或自选目录）下的独立文件夹。

## 4. 左侧树：技能库

投影顺序：无法读取的库 → 分组 → 未入组的分类。已入组的库只出现在分组下，不再出现在分类下。分类节点是虚拟的。

```text
技能库
├── 无法读取的技能库（…）                         # 诊断节点，仅损坏/不可用时出现
├── <技能分组>
│   ├── <成员库> [通用|剧情|文风|其他]            # 角标来自 members 槽位
│   │   ├── 库说明                               # 对应清单 overview
│   │   ├── <条目>                               # 对应 entries/<id>.md
│   │   └── …
│   └── 已丢失的技能库（<id>）                    # members 指向的库不在快照中
└── <分类> [库数量]                               # 仅含未入组库
    └── <技能库>
        ├── 库说明
        └── <条目>…
```

分类顺序与标签：

| 顺序 | skillKind | 树标签 |
| --- | --- | --- |
| 1 | general | 通用技能库 |
| 2 | plot | 剧情设计技能库 |
| 3 | style | 文风写作技能库 |
| 4 | other | 其他技能库 |

分组内成员按 `general → plot → style → other` 展开，槽位标签为「通用 / 剧情 / 文风 / 其他」。条目按清单顺序平铺，树上不再套一层 stage 目录。

条目 stage 仅作编辑器上下文：

| stageId | 标签 |
| --- | --- |
| character_design | 人物技能 |
| plot_design | 剧情技能 |
| outline | 大纲技能 |
| draft | 正文专家编写技能 |
| expert_section_writer | 分节写手技能 |

## 5. 左侧树：素材库

投影顺序：无法读取的库 → 分组 → 未入组的分类。已入组的库只出现在分组下。`materialKind: mixed` 未入组时归入「其他」。

```text
素材库
├── 无法读取的素材库（…）
├── <素材分组>
│   ├── <成员库> [人设|梗|剧情|正文|其他]
│   │   ├── 库介绍                               # 对应清单 overview
│   │   ├── <条目>                               # 对应 entries/<id>.md
│   │   └── …
│   └── 已丢失的素材库（<id>）
└── <分类> [库数量]
    └── <素材库>
        ├── 库介绍
        └── <条目>…
```

分类顺序与标签（树分类 ≠ 清单 kind 的枚举顺序）：

| 顺序 | materialKind | 树分类标签 |
| --- | --- | --- |
| 1 | character | 人设 |
| 2 | plot | 剧情 |
| 3 | gimmick | 梗 |
| 4 | draft | 正文 |
| 5 | other（含 mixed） | 其他 |

分组内成员按 `character → gimmick → plot → draft → other` 展开。条目按清单顺序平铺，树上不再套一层 stage 或题材目录。

条目 stage 与 kind 对应：

| stageId | 标签 | 对应 materialKind |
| --- | --- | --- |
| gimmick | 梗 | gimmick |
| character | 人设 | character |
| pacing | 剧情设计 | plot |
| intro | 导语设计 | plot |
| plot_refine | 剧情细化 | plot |
| draft_excerpt | 优秀正文片段 | draft |
| other | 其他素材 | other |

## 6. 磁盘节点 ↔ 树节点

```text
skills/<标题>/deepwrite.json                 →  技能库节点 +「库说明」
skills/<标题>/entries/<条目id>.md            →  技能条目叶子
skill-groups/<标题>/deepwrite.json           →  技能分组节点
（无对应目录）                               →  「通用技能库」等分类节点

materials/<标题>/deepwrite.json              →  素材库节点 +「库介绍」
materials/<标题>/entries/<条目id>.md         →  素材条目叶子
material-groups/<标题>/deepwrite.json        →  素材分组节点
（无对应目录）                               →  「人设 / 剧情 / 梗 / 正文 / 其他」分类节点
```

分组不移动、不复制成员文件夹，只在清单里引用 id。
