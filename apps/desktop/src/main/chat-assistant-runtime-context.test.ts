import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, createEnvelope } from "@deepwrite/contracts";

describe("chat assistant runtime context", () => {
  it("uses registered Core command discriminators for every authority query", () => {
    const mainSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const resolverSource = mainSource.slice(
      mainSource.indexOf("async function resolveChatAssistantRuntimeContext"),
      mainSource.indexOf("function usageRuntimeKey")
    );

    expect(resolverSource).toContain(
      'requireCorePayload(supervisor, "long.list", LongListBooksResultSchema)'
    );
    expect(resolverSource).not.toContain("long.listBooks");

    for (const type of ["catalog.index", "catalog.snapshot", "long.list"] as const) {
      expect(() =>
        CommandEnvelopeSchema.parse(
          createEnvelope(type, {}, {
            id: `cmd_chat_assistant_${type}`,
            correlationId: `cmd_chat_assistant_${type}`
          })
        )
      ).not.toThrow();
    }
  });
});
