# AutoDL Ollama 单模型多角色部署

本文用于在 AutoDL 上运行一个 Qwen3-30B-A3B-Instruct-2507 GGUF Q4_K_M 模型，并通过 SSH 隧道连接 DeepWrite。DeepWrite 中五个角色复用同一模型，但角色提示词、子会话和采样温度相互隔离。

## 推荐环境

- GPU：RTX 5090 32GB
- CPU：16 核或以上
- 内存：64GB 或以上
- 数据盘：100GB 或以上
- 镜像：PyTorch 2.8.0 / Python 3.12 / CUDA 12.8
- 初始上下文：32K
- 初始并发：1

## 1. 安装并启动 Ollama

在 AutoDL 终端执行：

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama --version
```

前台验证启动：

```bash
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_CONTEXT_LENGTH=32768 ollama serve
```

需要退出终端后继续运行时，可在 `tmux` 会话中执行同一命令。保持服务只监听 AutoDL 本机回环地址，不需要把 11434 直接暴露到公网。

## 2. 获取或导入 GGUF

先把实际的 Qwen3-30B-A3B-Instruct-2507 Q4_K_M GGUF 文件放到 AutoDL 数据盘。文件名和下载来源可能变化，以下命令不假设模型标签。

创建 `Modelfile`：

```text
FROM /root/autodl-tmp/models/<实际GGUF文件名>.gguf
PARAMETER num_ctx 32768
```

使用自己定义的本地 ID 导入：

```bash
ollama create <自定义模型ID> -f /root/autodl-tmp/models/Modelfile
ollama list
```

后续所有验证和 DeepWrite 配置都使用 `ollama list` 第一列显示的真实模型 ID。不要直接照抄网页名称或本文中的占位符。

## 3. 验证 Ollama 接口

模型列表：

```bash
curl http://127.0.0.1:11434/v1/models
```

聊天接口，将 `<ollama list中的真实模型ID>` 替换为实际值：

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"<ollama list中的真实模型ID>","messages":[{"role":"user","content":"只回复 OK"}],"temperature":0.3,"max_tokens":16}'
```

应先在 AutoDL 本机完成这两项验证，再排查 SSH 隧道或 DeepWrite。

## 4. Windows 建立 SSH 隧道

在 Windows PowerShell 中执行，并保持该窗口运行：

```powershell
ssh -N -L 11434:127.0.0.1:11434 root@AutoDL主机 -p SSH端口
```

另开一个 PowerShell 验证隧道：

```powershell
Invoke-RestMethod http://127.0.0.1:11434/v1/models
```

若本机 11434 已被本机 Ollama 占用，可改用其他本地端口，例如 `11435:127.0.0.1:11434`，并把 DeepWrite API 地址改成 `http://127.0.0.1:11435/v1`。

## 5. DeepWrite 模型配置

打开“设置 → 模型配置”，点击“AutoDL Ollama”，填写：

| 字段 | 值 |
| --- | --- |
| Provider | Ollama |
| API 类型 | OpenAI Completions |
| API 地址 | `http://127.0.0.1:11434/v1` |
| API Key | 留空 |
| 模型 ID | `ollama list` 返回的真实 ID |
| 模型模式 | 不思考模式 |
| 上下文长度 | 初始 `32768` |
| 最高输出长度 | 初始 `8192` |
| 并发上限 | 初始 `1`，确认显存余量后可改 `2` |

先点击“拉取”验证 `/v1/models`，再点击“测试当前填写”。保存模型配置后可设为默认模型。

上下文长度是 DeepWrite 的请求预算与 Ollama 的服务参数，两边应保持一致。若修改 DeepWrite 为 64K，也要用 `OLLAMA_CONTEXT_LENGTH=65536` 重启服务，或修改 Modelfile 的 `num_ctx` 后重新创建模型。角色页面显示的 16K～64K 是部署建议，不是伪造的逐角色 Ollama 参数。

## 6. 应用五角色团队

打开“智能体团队”，进入一个长篇团队，在“单模型多角色”区域选择刚才保存的 Ollama 模型并应用模板。模板会创建：

| 角色 | 温度 | 上下文建议 | 用途 |
| --- | ---: | --- | --- |
| 主编 | 0.4 | 32K～64K | 任务拆分、卷级归并、冲突裁决、全书规划 |
| 拆书分析 | 0.3 | 32K | 五条拆书管线的证据分析 |
| 正文写作 | 0.8 | 16K～32K | 按确认章纲写正文、对白和场景 |
| 文风写作 | 0.75 | 16K～32K | 应用已确认的方法和文风参数 |
| 审计终审 | 0.25 | 32K～64K | 独立审计和反方复核 |

同一模型 ID 可以重复绑定。每次子智能体调用都会创建独立会话，并使用该角色自己的系统提示和温度。主智能体会被要求在交付前调用审计终审做反方复核，再交给主编裁决冲突。

完整拆书仍在“学习仿写 → 长篇拆书”中选择同一个 Ollama 模型执行。五条管线保持独立，默认串行，并继续使用章节窗口、分卷归并、全书归并、断点续跑和失败重试。

## 7. 显存不足时降级

按以下顺序调整：

1. 并发保持 `1`。
2. 上下文从 32K 降到 24K 或 16K，并同步修改 Ollama 服务参数和 DeepWrite 高级配置。
3. 降低最高输出长度，例如从 8192 降到 4096。
4. 停止占用同一 GPU 的其他进程。
5. 最后再考虑更小量化或更小模型。

不要依靠把上下文开到最大提升长篇质量。长篇质量主要来自章节窗口、结构化证据、分阶段归并和反方复核。

## 8. AutoDL 关机后

AutoDL 实例关机后，Ollama 进程和 SSH 隧道都会断开。下次开机需要：

1. 在 AutoDL 重新启动 `ollama serve`。
2. 用 `ollama list` 确认模型仍在数据盘且 ID 未变化。
3. 在 Windows 重新运行 SSH 隧道命令。
4. 在 DeepWrite 重新拉取模型列表或测试连接。
