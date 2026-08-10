# DeepWrite 对外获取接口与远程 JSON 清单

本文按当前桌面端实际源码梳理“由 DeepWrite 主动从外部地址读取配置或 JSON”的入口。范围以 `apps/desktop/src/` 和 `packages/contracts/src/` 的运行时代码为准，不把用户自行填写的模型 API 地址、模型推理请求、普通网页跳转或仅用于构建的下载地址算作远程配置接口。

## 一、总览

| 类别 | 请求地址 | 方法与触发时机 | 外部返回内容 | 本地保存 / 失败降级 |
| --- | --- | --- | --- | --- |
| 免费模型配置 | 由 `MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL` 配置的中转服务：`/deepwrite/v1/MODEL.json` | `GET`；应用启动时拉取；读取模型列表时最多每 24 小时自动刷新一次；设置页支持强制刷新 | 免费模型列表、默认模型、最低客户端版本、启停状态、可选远程 API Key | 缓存到 `userData/config/deepwrite-free-models-cache.json`；缓存会剔除 API Key；Key 经 `safeStorage` 加密后写入 `model-secrets.json`；刷新失败沿用最后一次有效缓存 |
| 官方模型支持配置 | 由 `MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL` 配置的中转服务：`/deepwrite/v1/MODELDEEPWRITE.json` | `GET`；应用启动时拉取；进入“官方模型”页或点击刷新时强制重拉 | 官方支持模型、价格、折扣、可用状态、默认模型，以及余额接口的 URL 和集成 Token | 缓存到 `userData/config/deepwrite-official-models-cache.json`；缓存会剔除余额集成 Token；刷新失败沿用最后一次有效缓存 |
| 官方模型余额 | 由 `MODELDEEPWRITE.json.balance.url` 声明，校验后固定请求 `https://www.moxing.pro/v1/account/balance?include_keys=true` | `GET`；加载官方模型页、保存或清除官方令牌后查询 | 账户余额、Key 配额、各 Key 用量、金额换算参数 | 不落远程响应缓存；接口地址只允许 `www.moxing.pro` 的指定路径；鉴权使用远程官方配置中的集成 Token |
| 公告 / 提醒 | 由 `MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL` 配置的中转服务：`/deepwrite/v1/ALERT.json` | `GET`；Renderer 挂载时获取；窗口重新获得焦点时再次获取；每次加时间戳参数绕过缓存 | 启动公告和模型区域公告 | 缓存及已读状态写入 `userData/config/app-alert-state.json`；失败使用缓存，无缓存时使用内置模型公告且不弹启动公告 |

本文范围内直接使用 `fetch` 获取外部数据的入口只有上述免费模型、官方模型、官方余额和公告几类。

## 二、免费模型配置：`MODEL.json`

### 1. JSON 结构

当前解析器接受的结构如下，模型字段最终还要通过 `ModelConfigInputSchema`：

```jsonc
{
  "schemaVersion": 1,
  "revision": "2026-07-20.1",
  "minAppVersion": "1.0.0",
  "status": {
    "enabled": true,
    "message": ""
  },
  "models": [
    {
      "id": "deepwrite-free-writing",
      "label": "DeepWrite 免费模型",
      "provider": "openrouter",
      "modelId": "openrouter/free",
      "api": "openai-completions",
      "baseUrl": "https://openrouter.ai/api/v1",
      "reasoning": false,
      "defaultThinkingLevel": "off",
      "thinkingLevelOptions": ["minimal", "low", "medium", "high", "xhigh", "max"],
      "temperatureOptions": [0.1, 0.7, 1],
      "enabled": true,
      "sort": 10,
      "apiKey": "可选；仅在 Main 进程接收，不传给 Renderer"
    }
  ],
  "defaultModelId": "deepwrite-free-writing"
}
```

### 2. 强约束

- `schemaVersion` 必须为 `1`，`revision` 必须存在，最多 120 字符。
- 模型最多 50 个，模型 ID 唯一，并且必须以 `deepwrite-free-` 开头。
- Provider 只能是 `openrouter`，协议只能是 `openai-completions`。
- `baseUrl` 被锁定为 `https://openrouter.ai/api/v1`。
- `modelId` 只能是 `openrouter/free` 或以 `:free` 结尾，防止远程配置把免费入口改成付费模型。
- `status.enabled=false` 会整体暂停免费模型；`models[].enabled=false` 会过滤单个模型。
- 客户端低于 `minAppVersion` 时，不暴露任何免费模型，并提示升级。
- 请求超时 10 秒，响应正文上限 1 MB。

### 3. 调用和缓存

- Main 进程创建 `ModelConfigStore` 后并行初始化免费、官方模型目录。
- 免费目录初始化时强制请求一次；之后 `getCatalog()` 在同一进程中按 24 小时间隔刷新。
- 设置页“刷新免费模型”走 `models.refreshFree`，会忽略 24 小时间隔并显式报告失败。
- 远程 `apiKey` 不进入模型公开结构，也不会写入免费模型缓存；Main 会将其交给 Electron `safeStorage`，以密文保存到 `userData/config/model-secrets.json`。
- 系统安全存储不可用时拒绝把远程 API Key 明文落盘。

源码：[`deepwrite-free-model-config.ts`](../apps/desktop/src/main/deepwrite-free-model-config.ts)、[`model-config-store.ts`](../apps/desktop/src/main/model-config-store.ts)、[`models.ts`](../packages/contracts/src/models.ts)。

## 三、官方模型支持配置：`MODELDEEPWRITE.json`

### 1. JSON 结构

按当前解析器，该配置的结构可归纳为：

```jsonc
{
  "enabled": true,
  "message": "可选的停用提示",
  "defaultModelId": "deepwrite-xxx",
  "models": [
    {
      "id": "deepwrite-xxx",
      "label": "模型展示名",
      "provider": "deepseek-official",
      "modelId": "供应端模型 ID",
      "requestModelId": "可选的实际路由 ID",
      "supportsDeveloperRole": true,
      "api": "openai-completions",
      "baseUrl": "https://www.moxing.pro/v1/",
      "reasoning": true,
      "defaultThinkingLevel": "high",
      "thinkingLevelOptions": ["low", "high", "max"],
      "temperatureOptions": [0.7, 1, 1.5],
      "input": 1,
      "output": 2,
      "cache": 0.02,
      "discount": 0.65,
      "status": 0,
      "enabled": true,
      "sort": 10
    }
  ],
  "balance": {
    "url": "https://www.moxing.pro/v1/balance",
    "key": "itk-mxai-***"
  }
}
```

其中 `input`、`output`、`cache` 是每百万 Token 的人民币价格，`discount` 是当前计费折扣系数，`status: 0` 表示可用、`status: 1` 表示不可用。

### 2. 强约束

- 模型最多 50 个且 ID 唯一；ID 必须以 `deepwrite-` 开头，但不能使用为免费模型保留的 `deepwrite-free-` 前缀。
- 远程模型项不能携带 `apiKey`、`clearApiKey` 或 `managedBy`。
- Provider 固定为 `deepseek-official`，协议固定为 `openai-completions`。
- 模型 `baseUrl` 必须属于 `https://www.moxing.pro`，不允许用户名、密码、查询参数或 hash。
- 余额集成 Token 必须以 `itk-mxai-` 开头；余额 URL 只接受同域的 `/v1/balance` 或 `/v1/account/balance`。
- 解析成功后余额 URL 会被规范化为 `/v1/account/balance`。
- 请求超时 10 秒，配置及余额响应正文上限均为 1 MB。

### 3. 调用和缓存

- 应用启动时请求一次；普通模型列表读取不会反复刷新官方目录。
- 进入“设置 → 官方模型”会强制刷新官方配置，随后并行读取本地用量账本和远程余额。
- 官方目录缓存会保留 `balance.url`，但主动剔除 `balance.key`。因此冷启动离线时可以显示缓存的模型列表，但重启后无法仅凭缓存查询远程余额。
- 用户填写的官方令牌与远程配置中的余额集成 Token 是两种凭据：前者用于模型调用并由 `safeStorage` 加密保存；后者用于查询账户余额，只保留在当前进程内存中。

源码：[`deepwrite-official-model-config.ts`](../apps/desktop/src/main/deepwrite-official-model-config.ts)、[`model-config-store.ts`](../apps/desktop/src/main/model-config-store.ts)、[`OfficialModelsPanel.vue`](../apps/desktop/src/renderer/src/components/OfficialModelsPanel.vue)。

## 四、官方模型余额接口

请求形式：

```http
GET https://www.moxing.pro/v1/account/balance?include_keys=true
Accept: application/json
Authorization: Bearer <MODELDEEPWRITE.json 中的 balance.key>
```

外部响应要求顶层为 `success: true` 且存在 `data`。当前代码会读取：

```jsonc
{
  "success": true,
  "data": {
    "queried_at": "查询时间",
    "account_balance": 0,
    "account_balance_yuan": 0,
    "key_quota_remaining": 0,
    "key_quota_remaining_yuan": 0,
    "quota_per_unit": 1,
    "keys": [
      {
        "key_suffix": "用户令牌末四位",
        "remain_quota": 0,
        "remain_yuan": 0,
        "granted_quota": 0,
        "granted_yuan": 0,
        "used_quota": 0,
        "used_yuan": 0,
        "unlimited": false
      }
    ]
  }
}
```

客户端使用用户官方令牌的末四位匹配 `keys[].key_suffix`，并汇总所有 Key 的 `used_quota` 与 `used_yuan`。对 Renderer 输出前会通过 `OfficialModelBalanceSchema` 再校验一次。

## 五、公告配置：`ALERT.json`

### 1. JSON 结构

```json
{
  "desketop": ["启动时显示一次的公告"],
  "model": ["模型配置区域持续显示的公告"]
}
```

注意：`desketop` 是已发布上游文件沿用的拼写错误，当前契约为兼容远程文件而保留，不能直接改成 `desktop`。

### 2. 行为和约束

- JSON 必须严格只有 `desketop` 和 `model` 两个字段。
- 每条消息为 1～500 字符；每组最多 20 条；`model` 至少 1 条。
- 每次请求会附加 `deepwrite_cache_bust=<当前时间戳>`，同时设置 `no-store` 和 no-cache 请求头。
- 请求超时 10 秒，响应正文上限 64 KB。
- Renderer 首次挂载和窗口每次重新获得焦点时读取，因此同一进程可能多次请求。
- `desketop` 数组的 SHA-256 作为版本号；用户关闭启动公告后保存已读版本，同一内容不再弹出，内容变化后重新弹出。
- 远程失败时优先使用本地缓存；无有效缓存时，启动公告为空，模型公告使用代码内置文案。

源码：[`app-alert.ts`](../packages/contracts/src/app-alert.ts)、[`app-alert-store.ts`](../apps/desktop/src/main/app-alert-store.ts)、[`App.vue`](../apps/desktop/src/renderer/src/App.vue)。

## 六、相关但不属于“远程配置 JSON”的对外地址

| 类型 | 地址 / 来源 | 说明 |
| --- | --- | --- |
| 官方模型购买页 | `https://pay.ldxp.cn/shop/UKGFTY58` | Renderer 中的外链，只负责打开网页，不读取 JSON |
| 免费模型实际推理 | `https://openrouter.ai/api/v1` | 从免费模型配置选定后，由 Agent Runtime 发起模型请求；不是配置拉取接口 |
| 官方模型实际推理 | `https://www.moxing.pro/...` | 路径来自官方目录，但域名被限制；用于模型推理，不是配置 JSON |
| 用户自定义模型 | 用户填写的 `baseUrl` | 可为 OpenAI、Anthropic、DeepSeek、Kimi、通义、智谱、Moonshot、Gemini、Ollama 等；属于用户配置的模型服务，不是 DeepWrite 固定对外拉取项 |

## 七、维护与安全注意点

- 三份公开数据配置统一通过构建环境中的 `MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL` 指向中转服务；本地实际配置不得提交到仓库。
- 免费模型 JSON 可以下发 API Key，官方模型 JSON 可以下发余额集成 Token。虽然本地缓存已剔除敏感字段，但远程 Raw 文件本身必须按密钥文件管理，避免仓库权限或发布链路泄露。
- 免费与官方模型配置都限制了可访问域名 / Provider / 协议，能降低远程配置被篡改后把模型流量导向任意服务器的风险；公告没有签名校验，主要依赖 HTTPS 与托管仓库权限。

## 八、快速定位索引

| 关注点 | 主要源码 |
| --- | --- |
| 免费模型 URL、解析、缓存、刷新周期 | `apps/desktop/src/main/deepwrite-free-model-config.ts` |
| 官方模型 URL、解析、余额请求、缓存 | `apps/desktop/src/main/deepwrite-official-model-config.ts` |
| 模型目录初始化、密钥落盘、Renderer 输出 | `apps/desktop/src/main/model-config-store.ts` |
| 模型公共字段与余额输出契约 | `packages/contracts/src/models.ts` |
| 公告 URL 与 JSON 契约 | `packages/contracts/src/app-alert.ts` |
| 公告请求、缓存、已读状态 | `apps/desktop/src/main/app-alert-store.ts` |
| Main 初始化及 IPC 路由 | `apps/desktop/src/main/index.ts` |
| Renderer 触发入口 | `apps/desktop/src/renderer/src/App.vue` |
