import type { ModelConfigInput } from "@deepwrite/contracts";

function rawErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  const separator = error.message.indexOf(": ");
  return separator >= 0 ? error.message.slice(separator + 2) : error.message;
}

export function modelConnectionErrorMessage(
  model: Pick<ModelConfigInput, "provider" | "deploymentTarget">,
  error: unknown,
  fallback: string
): string {
  const message = rawErrorMessage(error, fallback);
  if (model.provider.trim().toLowerCase() !== "ollama") return message;

  const normalized = message.toLowerCase();
  if (
    /out of memory|cuda.*memory|gpu.*memory|insufficient.*memory|failed to allocate|kv cache/u.test(
      normalized
    )
  ) {
    return "Ollama 推理失败：GPU 显存不足。请降到 16K 上下文、保持并发 1，或换用更小量化。";
  }
  if (
    /model.*not found|model.*does not exist|no such model|pull model|http 404|status.?404/u.test(
      normalized
    )
  ) {
    return "Ollama 已连接，但模型尚未导入或模型 ID 不匹配。请在 AutoDL 运行 ollama list 后填写真实模型 ID。";
  }
  if (/timeout|timed out|aborterror|etimedout|超时/u.test(normalized)) {
    return "Ollama 请求超时。请检查 SSH 隧道和 AutoDL 网络，并降低上下文或输出长度后重试。";
  }
  if (
    /http 502|http 503|status.?50[23]|socket hang up|connection reset|服务未启动|服务未正常/u.test(
      normalized
    )
  ) {
    return "SSH 隧道可达，但 Ollama 服务未正常响应。请在 AutoDL 检查 ollama serve 和服务日志。";
  }
  if (
    /econnrefused|connection refused|fetch failed|failed to fetch|network|connect error|无法连接模型服务|连接被拒绝/u.test(
      normalized
    )
  ) {
    return model.deploymentTarget === "autodl-ollama"
      ? "无法连接 127.0.0.1:11434：SSH 隧道尚未建立或已经断开。"
      : "无法连接本机 Ollama：请确认 Ollama 服务已经启动并监听 11434 端口。";
  }
  return message;
}
