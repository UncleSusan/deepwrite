function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current && !visited.has(current) && chain.length < 6) {
    chain.push(current);
    visited.add(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return chain;
}

function networkErrorCode(error: unknown): string {
  for (const item of errorChain(error)) {
    if (typeof item !== "object" || item === null || !("code" in item))
      continue;
    const code = String((item as { code?: unknown }).code ?? "").trim();
    if (code) return code.toUpperCase();
  }
  return "";
}

function networkErrorText(error: unknown): string {
  return errorChain(error)
    .map((item) => (item instanceof Error ? item.message : String(item)))
    .join(" ")
    .toLowerCase();
}

export function ollamaNetworkErrorMessage(error: unknown): string {
  const code = networkErrorCode(error);
  const text = networkErrorText(error);
  if (
    code === "UND_ERR_SOCKET" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    /other side closed|socket hang up|connection reset/u.test(text)
  ) {
    return "模型服务连接已建立，但 Ollama 未正常响应（connection reset）。";
  }
  if (code === "ECONNREFUSED" || /connection refused/u.test(text)) {
    return "无法连接模型服务（ECONNREFUSED），请检查本地监听端口。";
  }
  return "无法连接模型服务，请检查 API 地址后重试。";
}
