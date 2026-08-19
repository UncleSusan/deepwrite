import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IPC command requestId handling", () => {
  it("main preserves raw command id on early rejects and surfaces validation issues", () => {
    const source = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("function extractCommandRequestId");
    expect(source).toContain("function summarizeCommandValidationIssues");
    expect(source).toContain("const requestId = extractCommandRequestId(rawCommand)");
    expect(source).toContain("mainWindow.isDestroyed()");
    expect(source).not.toContain("requestId: \"unknown\"");
    expect(source).toContain('return "unknown"');
    expect(source).toContain("Command envelope failed schema validation.");
  });

  it("preload surfaces rejected IPC errors instead of masking them as requestId mismatches", () => {
    const source = readFileSync(
      new URL("../preload/invoke.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("const expectedRequestId = command.id");
    expect(source).toContain('if (result.status === "rejected")');
    expect(source).toContain(
      "`IPC result requestId does not match command id. expected=${expectedRequestId} actual=${result.requestId}`"
    );
    expect(source).not.toContain(
      'throw new Error("IPC result requestId does not match command id.");'
    );
  });

  it("routes screenplay creation through preload, main, and the core utility", () => {
    const catalogSource = readFileSync(
      new URL("./ipc/catalog-commands.ts", import.meta.url),
      "utf8"
    );
    const sessionSource = readFileSync(
      new URL("./ipc/session-commands.ts", import.meta.url),
      "utf8"
    );
    const preloadSource = readFileSync(
      new URL("../preload/catalog-api.ts", import.meta.url),
      "utf8"
    );
    const coreSource = readFileSync(
      new URL("../utilities/core-entry.ts", import.meta.url),
      "utf8"
    );

    expect(preloadSource).toContain("async function createScriptBook");
    expect(preloadSource).toContain('"catalog.createScriptBook"');
    expect(catalogSource).toContain('"catalog.createScriptBookAtPath"');
    expect(catalogSource).toContain("ScriptBookSchema.parse(result.payload)");
    expect(coreSource).toContain(
      'command.type === "catalog.createScriptBookAtPath"'
    );
    expect(coreSource).toContain("catalogStore.createScriptBook(");
    expect(sessionSource).toContain(
      "command.payload.workspaceContext?.scriptWorkspace"
    );
    expect(sessionSource).toContain("creativeWorkspaceType");
    expect(sessionSource).toContain(
      "creativeWorkspace,\n                creativeWorkspaceType"
    );
    expect(sessionSource).toContain("{ scriptAgentProfile: agentProfile }");
  });

  it("routes idempotent draft-section batches through preload, main, and core", () => {
    const catalogSource = readFileSync(
      new URL("./ipc/catalog-commands.ts", import.meta.url),
      "utf8"
    );
    const preloadSource = readFileSync(
      new URL("../preload/catalog-api.ts", import.meta.url),
      "utf8"
    );
    const coreSource = readFileSync(
      new URL("../utilities/core-entry.ts", import.meta.url),
      "utf8"
    );

    expect(preloadSource).toContain("async function createDraftSections");
    expect(preloadSource).toContain('"catalog.createDraftSections"');
    expect(catalogSource).toContain(
      'command.type === "catalog.createDraftSections"'
    );
    expect(catalogSource).toContain(
      "CreateDraftSectionsResultSchema.parse(result.payload)"
    );
    expect(coreSource).toContain(
      "await catalogStore.createDraftSections(command.payload)"
    );
  });

  it("routes remote model listing through preload and main", () => {
    const modelSource = readFileSync(
      new URL("./ipc/model-commands.ts", import.meta.url),
      "utf8"
    );
    const preloadSource = readFileSync(
      new URL("../preload/session-models-api.ts", import.meta.url),
      "utf8"
    );
    const preloadFacadeSource = readFileSync(
      new URL("../preload/index.ts", import.meta.url),
      "utf8"
    );

    expect(preloadSource).toContain("async function listRemoteModels");
    expect(preloadSource).toContain('"models.listRemote"');
    expect(preloadFacadeSource).toContain("listRemote: listRemoteModels");
    expect(modelSource).toContain('command.type === "models.listRemote"');
    expect(modelSource).toContain("resolveDraftApiKey(");
    expect(modelSource).toContain("listRemoteModels({");
    expect(modelSource).toContain("RemoteModelListResultSchema.parse({ models })");
  });

  it("routes metadata index and on-demand document reads through every boundary", () => {
    const catalogSource = readFileSync(
      new URL("./ipc/catalog-commands.ts", import.meta.url),
      "utf8"
    );
    const preloadSource = readFileSync(
      new URL("../preload/catalog-api.ts", import.meta.url),
      "utf8"
    );
    const apiSource = readFileSync(
      new URL("../../../../packages/contracts/src/preload-api.ts", import.meta.url),
      "utf8"
    );
    const coreSource = readFileSync(
      new URL("../utilities/core-entry.ts", import.meta.url),
      "utf8"
    );
    const initialization = coreSource.slice(
      coreSource.indexOf("async function requireCatalogStore"),
      coreSource.indexOf("async function handleCatalogCommand")
    );

    expect(apiSource).toContain("index(): Promise<CatalogIndexSnapshot>");
    expect(apiSource).toContain(
      "readDocument(input: CatalogReadDocumentInput): Promise<CatalogReadDocumentResult>"
    );
    expect(preloadSource).toContain("async function getCatalogIndex");
    expect(preloadSource).toContain("async function readCatalogDocument");
    expect(preloadSource).toContain('"catalog.index"');
    expect(preloadSource).toContain('"catalog.readDocument"');
    expect(catalogSource).toContain('command.type === "catalog.index"');
    expect(catalogSource).toContain('command.type === "catalog.readDocument"');
    expect(catalogSource).toContain("CatalogIndexSnapshotSchema.parse(result.payload)");
    expect(catalogSource).toContain("CatalogReadDocumentResultSchema.parse(result.payload)");
    expect(coreSource).toContain("await catalogStore.indexSnapshot()");
    expect(coreSource).toContain("await catalogStore.readDocument(command.payload)");
    expect(initialization).toContain("await existingFolderStore.indexSnapshot()");
    expect(initialization).toContain("await folderStore.indexSnapshot()");
    expect(initialization).not.toContain("existingFolderStore.snapshot()");
    expect(initialization).not.toContain("folderStore.snapshot()");
  });

  it("bounds editor index, reads, saves, and snapshots instead of waiting forever", () => {
    const catalogSource = readFileSync(
      new URL("./ipc/catalog-commands.ts", import.meta.url),
      "utf8"
    );
    const catalogForwarding = catalogSource.slice(
      catalogSource.indexOf('command.type === "catalog.index"')
    );

    expect(catalogForwarding).toContain("catalogCommandTimeoutMs(command.type)");
    expect(catalogForwarding).toContain(
      "error instanceof UtilityCommandTimeoutError"
    );
    expect(catalogForwarding).toContain('code: timedOut ? "catalog.command_timeout"');
    expect(catalogForwarding).not.toContain(
      'supervisor.requestCommand("core", command, 0)'
    );
  });
});
