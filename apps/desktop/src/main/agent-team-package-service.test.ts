import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, Dialog } from "electron";
import { AgentTeamConfigStore } from "./agent-team-config-store";
import {
  downloadAgentTeamPackage,
  installAgentTeamPackage
} from "./agent-team-package-service";

const roots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-agent-team-package-"));
  roots.add(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    [...roots].map((root) => rm(root, { recursive: true, force: true }))
  );
  roots.clear();
});

describe("agent team package service", () => {
  it("downloads a selected team and installs the uploaded archive", async () => {
    const root = await temporaryRoot();
    const store = new AgentTeamConfigStore(root);
    const source = (await store.list()).teams[0]!;
    const archivePath = join(root, "团队.deepwrite-team.zip");
    const dialog = {
      showSaveDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: archivePath
      }),
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: [archivePath]
      })
    } as unknown as Pick<Dialog, "showOpenDialog" | "showSaveDialog">;
    const window = {} as BrowserWindow;

    await expect(
      downloadAgentTeamPackage(
        window,
        dialog,
        store,
        { teamId: source.id },
        root
      )
    ).resolves.toEqual({ status: "saved", filePath: archivePath });
    const installed = await installAgentTeamPackage(
      window,
      dialog,
      store,
      root
    );

    expect(installed).toMatchObject({
      status: "installed",
      teamName: `${source.name} (2)`
    });
    if (installed.status === "installed") {
      expect(installed.catalog.teams).toHaveLength(4);
    }
  });
});
