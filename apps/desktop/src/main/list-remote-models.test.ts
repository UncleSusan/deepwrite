import { describe, expect, it } from "vitest";
import {
  listRemoteModels,
  parseRemoteModelList,
  resolveRemoteModelsUrl
} from "./list-remote-models";

describe("listRemoteModels", () => {
  it("builds OpenAI-compatible, Anthropic, and Google list endpoints", () => {
    expect(
      resolveRemoteModelsUrl({
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1/",
        apiKey: "sk-test",
        provider: "custom"
      })
    ).toBe("https://api.example.test/v1/models");
    expect(
      resolveRemoteModelsUrl({
        api: "anthropic-messages",
        baseUrl: "https://api.example.test",
        apiKey: "sk-test",
        provider: "anthropic"
      })
    ).toBe("https://api.example.test/v1/models");
    expect(
      resolveRemoteModelsUrl({
        api: "google-generative-ai",
        baseUrl: "https://generativelanguage.example.test/v1beta",
        apiKey: "sk-test",
        provider: "google"
      })
    ).toBe("https://generativelanguage.example.test/v1beta/models?key=sk-test");
  });

  it("parses OpenAI, Anthropic, and Google list payloads", () => {
    expect(
      parseRemoteModelList({
        data: [{ id: "writer-b" }, { id: "writer-a" }, { id: "writer-a" }]
      })
    ).toEqual([{ id: "writer-a" }, { id: "writer-b" }]);
    expect(
      parseRemoteModelList({
        data: [{ id: "claude-test", display_name: "Claude Test" }]
      })
    ).toEqual([{ id: "claude-test", label: "Claude Test" }]);
    expect(
      parseRemoteModelList({
        models: [{ name: "models/gemini-flash", displayName: "Gemini Flash" }]
      })
    ).toEqual([{ id: "gemini-flash", label: "Gemini Flash" }]);
  });

  it("fetches and returns available model ids", async () => {
    const requested: Array<{ url: string; authorization: string | null }> = [];
    const models = await listRemoteModels(
      {
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1",
        apiKey: "sk-test-only",
        provider: "custom"
      },
      async (url, init) => {
        requested.push({
          url,
          authorization: new Headers(init?.headers).get("Authorization")
        });
        return Response.json({
          data: [{ id: "model-b" }, { id: "model-a" }]
        });
      }
    );

    expect(requested).toEqual([
      {
        url: "https://api.example.test/v1/models",
        authorization: "Bearer sk-test-only"
      }
    ]);
    expect(models).toEqual([{ id: "model-a" }, { id: "model-b" }]);
  });

  it("allows Ollama without an API key", async () => {
    const models = await listRemoteModels(
      {
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
        provider: "ollama"
      },
      async (url, init) => {
        expect(url).toBe("http://127.0.0.1:11434/v1/models");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer ollama"
        );
        return Response.json({ data: [{ id: "llama3" }] });
      }
    );

    expect(models).toEqual([{ id: "llama3" }]);
  });

  it("preserves the Ollama network signal needed to distinguish tunnel and service failures", async () => {
    const input = {
      api: "openai-completions" as const,
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      provider: "ollama"
    };
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED"
    });
    await expect(
      listRemoteModels(input, async () => {
        throw new TypeError("fetch failed", { cause: refused });
      })
    ).rejects.toThrow("ECONNREFUSED");

    const closed = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET"
    });
    await expect(
      listRemoteModels(input, async () => {
        throw new TypeError("fetch failed", { cause: closed });
      })
    ).rejects.toThrow("Ollama 未正常响应");
  });

  it("rejects missing credentials before making a request", async () => {
    await expect(
      listRemoteModels({
        api: "openai-completions",
        baseUrl: "",
        apiKey: "sk-test",
        provider: "custom"
      })
    ).rejects.toThrow("请先填写 API 地址");
    await expect(
      listRemoteModels({
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1",
        apiKey: "",
        provider: "custom"
      })
    ).rejects.toThrow("请先填写 API Key");
  });

  it("maps unauthorized responses to a key error", async () => {
    await expect(
      listRemoteModels(
        {
          api: "openai-completions",
          baseUrl: "https://api.example.test/v1",
          apiKey: "sk-test-only",
          provider: "custom"
        },
        async () => new Response("denied", { status: 401 })
      )
    ).rejects.toThrow("密钥无效或没有权限拉取模型列表。");
  });
});
