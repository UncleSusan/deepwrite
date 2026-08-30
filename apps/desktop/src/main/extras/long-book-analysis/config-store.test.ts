import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_BOOK_ANALYSIS_PRESETS,
  LongBookAnalysisConfigStore
} from "./config-store";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<{
  path: string;
  store: LongBookAnalysisConfigStore;
}> {
  const path = await mkdtemp(join(tmpdir(), "deepwrite-analysis-config-"));
  temporaryDirectories.push(path);
  return { path, store: new LongBookAnalysisConfigStore(path) };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("long-book analysis config store", () => {
  it("provides three independent default presets", async () => {
    const { store } = await createStore();
    const settings = await store.list();
    expect(settings.presets.map((preset) => preset.name)).toEqual([
      "剧情结构",
      "人物",
      "文风"
    ]);
    expect(settings.presets.every((preset) => preset.builtin)).toBe(true);
    expect(DEFAULT_LONG_BOOK_ANALYSIS_PRESETS[0].systemPrompt).toContain(
      "大剧情"
    );
  });

  it("serializes concurrent saves and can restore one modified default", async () => {
    const { store } = await createStore();
    const defaults = (await store.list()).presets.map(
      ({ builtin: _builtin, ...preset }) => preset
    );
    const first = defaults.map((preset) => ({
      ...preset,
      description: `${preset.description} A`
    }));
    const second = defaults.map((preset) => ({
      ...preset,
      description: `${preset.description} B`
    }));
    await Promise.all([
      store.save({ presets: first }),
      store.save({ presets: second })
    ]);
    expect((await store.list()).presets[0]?.description.endsWith("B")).toBe(
      true
    );
    expect((await store.reset("plot-structure")).presets[0]?.description).toBe(
      DEFAULT_LONG_BOOK_ANALYSIS_PRESETS[0].description
    );
  });

  it("falls back safely when the persisted JSON is damaged", async () => {
    const { path, store } = await createStore();
    const configPath = join(path, "config", "long-book-analysis-presets.json");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{damaged", "utf8");
    expect((await store.list()).presets).toHaveLength(3);
    expect(await readFile(configPath, "utf8")).toBe("{damaged");
  });
});
