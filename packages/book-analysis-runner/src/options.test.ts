import { describe, expect, it } from "vitest";
import { parseOptions } from "./options";

describe("headless book analysis options", () => {
  it("uses the AutoDL Ollama defaults for a new job", () => {
    const options = parseOptions([
      "run",
      "--source",
      "book.txt",
      "--workspace",
      "job",
      "--model",
      "qwen3:30b"
    ]);
    expect(options.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(options.scopeMode).toBe("full");
    expect(options.contextWindow).toBe(32768);
  });

  it("requires the original model id for resume", () => {
    expect(() =>
      parseOptions(["run", "--workspace", "job", "--resume"])
    ).toThrow("--model");
  });
});
