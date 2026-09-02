# 无窗口完整拆书

`@deepwrite/book-analysis-runner` 将完整拆书的五条既有管线放到运行 Ollama 的本机执行，支持 Linux 和 Windows。原书快照、断点文件、Ollama 请求和中间归并结果均留在执行机器；完成时只生成一个可在 DeepWrite 桌面端导入的结果包。

## 安装运行器

```bash
git clone -b feature/headless-book-analysis-runner https://github.com/UncleSusan/deepwrite.git
cd deepwrite
corepack enable
corepack pnpm install --frozen-lockfile
pnpm book-analysis:build
```

运行器需要 Node 24 或更高版本，以及本机已启动的 Ollama。先确认实际模型 ID，不要假设标签：

```bash
ollama list
curl http://127.0.0.1:11434/v1/models
```

## Linux 或 AutoDL：新建任务

先将 TXT 或按章节整理的目录上传到 AutoDL。以下示例使用默认的全文深度拆解，文风仍按前中后和分卷抽样；模型 ID 必须替换为 `ollama list` 的实际输出。

```bash
node packages/book-analysis-runner/dist/cli.mjs run \
  --source /data/books/reference.txt \
  --workspace /data/book-analysis/reference-book \
  --model "实际模型 ID" \
  --scope full \
  --context-window 32768 \
  --max-tokens 8192 \
  --temperature 0.3
```

按章节目录执行时，改为：

```bash
--source /data/books/reference-book --source-kind directory
```

完整拆书始终使用 50 章以内的处理窗口，随后进行多级归并；五条管线串行执行，默认适配单模型单并发 Ollama。`--style-full-text` 可将文风从抽样改为全文。

建议通过 `nohup` 或 `tmux` 运行，SSH 断开不会中断任务：

```bash
nohup node packages/book-analysis-runner/dist/cli.mjs run \
  --source /data/books/reference.txt \
  --workspace /data/book-analysis/reference-book \
  --model "实际模型 ID" > /data/book-analysis/reference-book/run.log 2>&1 &
```

## 续跑与下载

执行器在每个批次和归并步骤后原子写入 `task.json`。中断后使用相同模型 ID 和工作目录续跑：

```bash
node packages/book-analysis-runner/dist/cli.mjs run \
  --workspace /data/book-analysis/reference-book \
  --model "实际模型 ID" \
  --resume
```

全部五项成功后，工作目录会生成 `result.deepwrite-book-analysis.json`。它不包含原文快照、Ollama 地址之外的凭据或 API Key。下载到 Windows：

```powershell
scp root@AutoDL主机:/data/book-analysis/reference-book/result.deepwrite-book-analysis.json .
```

在 DeepWrite 中进入“学习仿写 → 长篇拆书 → 完整拆书”，点击“导入 Linux 结果包”。应用会验证任务是否完整、预设路由是否一致，并自动创建或复用“书名 · 完整拆书”的素材库分组与技能库分组，写入剧情结构、人物、作品设定集、方法蒸馏和文风五项结果。

AutoDL 关机后，需要重新启动 `ollama serve`；中断任务无需重新上传原书，只要工作目录的 `source.json` 与 `task.json` 还在即可续跑。

## Windows 本机运行

Windows 与 Linux 使用同一运行器、同一工作目录格式和同一结果包，不需要 Electron 或桌面窗口。先在仓库根目录完成安装与构建：

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm book-analysis:build
ollama list
```

使用 PowerShell 启动脚本新建任务。`--` 后的参数会原样传给运行器；模型 ID 必须替换为 `ollama list` 的实际输出：

```powershell
corepack pnpm --filter @deepwrite/book-analysis-runner start:windows -- run `
  --source "D:\books\reference.txt" `
  --workspace "D:\book-analysis\reference-book" `
  --model "实际模型 ID" `
  --scope full `
  --context-window 32768 `
  --max-tokens 8192 `
  --temperature 0.3
```

按章节整理的目录需要补充 `--source-kind directory`。中断后以相同模型 ID 和工作目录续跑：

```powershell
corepack pnpm --filter @deepwrite/book-analysis-runner start:windows -- run `
  --workspace "D:\book-analysis\reference-book" `
  --model "实际模型 ID" `
  --resume
```

要在关闭终端后继续执行，可在仓库根目录的 PowerShell 中启动隐藏后台进程并记录日志：

```powershell
$workspace = "D:\book-analysis\reference-book"
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
Start-Process powershell -WindowStyle Hidden -ArgumentList @(
  "-ExecutionPolicy", "Bypass", "-File", ".\packages\book-analysis-runner\scripts\run-windows.ps1",
  "run", "--source", "D:\books\reference.txt", "--workspace", $workspace,
  "--model", "实际模型 ID", "--scope", "full"
) -RedirectStandardOutput "$workspace\run.log" -RedirectStandardError "$workspace\run.error.log"
```

执行中可用 `Get-Content "$workspace\run.log" -Wait` 查看进度。完成后直接在 DeepWrite 的“学习仿写 → 长篇拆书 → 完整拆书”导入 `$workspace\result.deepwrite-book-analysis.json`；本机运行不需要下载或 SSH 隧道。
