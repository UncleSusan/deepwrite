import { describe, expect, it } from "vitest";
import { modelConnectionErrorMessage } from "./ollamaConnectionError";

const autodl = {
  provider: "ollama",
  deploymentTarget: "autodl-ollama" as const
};

describe("modelConnectionErrorMessage", () => {
  it.each([
    [new Error("fetch failed: ECONNREFUSED"), "SSH 隧道尚未建立"],
    [new Error("request timed out"), "Ollama 请求超时"],
    [new Error("model qwen not found"), "模型尚未导入"],
    [new Error("CUDA out of memory"), "GPU 显存不足"],
    [new Error("HTTP 503"), "Ollama 服务未正常响应"],
    [new Error("connection reset"), "Ollama 服务未正常响应"]
  ])("classifies AutoDL Ollama failures", (error, expected) => {
    expect(
      modelConnectionErrorMessage(autodl, error, "模型连接测试失败。")
    ).toContain(expected);
  });

  it("classifies the localized remote-list network error", () => {
    expect(
      modelConnectionErrorMessage(
        autodl,
        new Error("无法连接模型服务，请检查 API 地址后重试。"),
        "failed"
      )
    ).toContain("SSH 隧道尚未建立");
  });

  it("keeps local Ollama guidance separate from AutoDL tunnels", () => {
    expect(
      modelConnectionErrorMessage(
        { provider: "ollama" },
        new Error("fetch failed"),
        "failed"
      )
    ).toContain("本机 Ollama");
  });

  it("leaves non-Ollama provider errors unchanged", () => {
    expect(
      modelConnectionErrorMessage(
        { provider: "custom" },
        new Error("models.test_failed: provider rejected request"),
        "failed"
      )
    ).toBe("provider rejected request");
  });
});
