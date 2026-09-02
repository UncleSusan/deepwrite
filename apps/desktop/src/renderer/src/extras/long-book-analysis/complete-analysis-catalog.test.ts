import { describe, expect, it, vi } from "vitest";
import type {
  CatalogSnapshot,
  CreateLibraryEntryInput,
  CreateLibraryGroupInput,
  CreateLibraryInput,
  DeepWriteApi,
  LongBookAnalysisPreset,
  LongBookAnalysisTaskSnapshot,
  MaterialLibrary,
  SaveLibraryEntryInput,
  SkillLibrary,
  UpdateLibraryGroupInput
} from "@deepwrite/contracts/renderer";
import {
  completeAnalysisGroupTitle,
  persistCompleteAnalysisResults
} from "./complete-analysis-catalog";

const NOW = "2026-09-01T08:00:00.000Z";

const presets: LongBookAnalysisPreset[] = [
  {
    id: "plot-structure",
    name: "剧情结构",
    description: "",
    systemPrompt: "",
    output: { domain: "material", kind: "plot", stageId: "pacing" }
  },
  {
    id: "character",
    name: "人物",
    description: "",
    systemPrompt: "",
    output: { domain: "material", kind: "character", stageId: "character" }
  },
  {
    id: "story-bible",
    name: "作品设定集",
    description: "",
    systemPrompt: "",
    output: { domain: "material", kind: "other", stageId: "other" }
  },
  {
    id: "method-distillation",
    name: "方法蒸馏",
    description: "",
    systemPrompt: "",
    output: { domain: "skill", kind: "general", stageId: "draft" }
  },
  {
    id: "style",
    name: "文风",
    description: "",
    systemPrompt: "",
    output: {
      domain: "skill",
      kind: "style",
      stageId: "expert_section_writer"
    }
  }
];

function task(): LongBookAnalysisTaskSnapshot {
  return {
    version: 1,
    id: "task-1",
    sourceId: "source-1",
    sourceTitle: "热门小说",
    scopeMode: "full",
    styleFullText: false,
    modelId: "model-1",
    thinkingLevel: "medium",
    status: "completed",
    items: presets.map((preset) => ({
      presetId: preset.id,
      presetName: preset.name,
      scopeMode: "full",
      chapterOrders: [1],
      status: "completed",
      completedUnits: 1,
      estimatedUnits: 1,
      targetLibraryId: "",
      result: { title: `${preset.name}结果`, body: `${preset.name}正文` }
    })),
    createdAt: NOW,
    updatedAt: NOW
  };
}

function harness() {
  const snapshot = {
    schemaVersion: 1,
    revision: 1,
    creativePlotStages: [],
    books: [],
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    updatedAt: NOW
  } as unknown as CatalogSnapshot;
  let sequence = 0;
  const createLibrary = vi.fn(async (input: CreateLibraryInput) => {
    sequence += 1;
    if (input.domain === "material") {
      const library = {
        id: `material-${sequence}`,
        title: input.name,
        materialType: "long",
        materialKind:
          input.domain === "material" ? input.materialKind : "other",
        parentGenre: "",
        subGenre: "",
        overview: "",
        entries: [],
        projectRevision: 0,
        createdAt: NOW,
        updatedAt: NOW
      } as MaterialLibrary;
      snapshot.materials.push(library);
      return library;
    }
    const library = {
      id: `skill-${sequence}`,
      title: input.name,
      skillType: "long",
      skillKind: input.domain === "skill" ? input.skillKind : "other",
      overview: "",
      isBuiltin: false,
      entries: [],
      projectRevision: 0,
      createdAt: NOW,
      updatedAt: NOW
    } as SkillLibrary;
    snapshot.skills.push(library);
    return library;
  });
  const createLibraryGroup = vi.fn(async (input: CreateLibraryGroupInput) => {
    const group = {
      id: `${input.domain}-group-1`,
      title: input.name,
      members: input.members,
      projectRevision: 0,
      createdAt: NOW,
      updatedAt: NOW
    };
    if (input.domain === "material") snapshot.materialGroups.push(group);
    else snapshot.skillGroups.push(group);
    return group;
  });
  const updateLibraryGroup = vi.fn(async (input: UpdateLibraryGroupInput) => {
    const groups =
      input.domain === "material"
        ? snapshot.materialGroups
        : snapshot.skillGroups;
    const group = groups.find(({ id }) => id === input.groupId)!;
    Object.assign(group, {
      title: input.title ?? group.title,
      members: input.members,
      projectRevision: (group.projectRevision ?? 0) + 1
    });
    return group;
  });
  const createLibraryEntry = vi.fn(async (input: CreateLibraryEntryInput) => {
    const libraries =
      input.domain === "material" ? snapshot.materials : snapshot.skills;
    const library = libraries.find(({ id }) => id === input.libraryId)!;
    const entry = {
      id: `entry-${input.libraryId}`,
      stageId: input.stageId,
      title: input.title,
      body: input.content,
      createdAt: NOW,
      updatedAt: NOW
    };
    library.entries.push(entry as never);
    return entry;
  });
  const saveLibraryEntry = vi.fn(async (input: SaveLibraryEntryInput) => {
    const libraries =
      input.domain === "material" ? snapshot.materials : snapshot.skills;
    const library = libraries.find(({ id }) => id === input.libraryId)!;
    const entry = library.entries.find(({ id }) => id === input.entryId)!;
    Object.assign(entry, { title: input.title, body: input.content });
    return entry;
  });
  const api = {
    catalog: {
      snapshot: vi.fn(async () => structuredClone(snapshot)),
      createLibrary,
      createLibraryGroup,
      updateLibraryGroup,
      createLibraryEntry,
      saveLibraryEntry
    }
  } as unknown as DeepWriteApi;
  return {
    api,
    snapshot,
    createLibrary,
    createLibraryGroup,
    updateLibraryGroup,
    createLibraryEntry,
    saveLibraryEntry
  };
}

describe("complete analysis catalog persistence", () => {
  it("keeps generated group and child library titles within catalog limits", () => {
    const title = completeAnalysisGroupTitle("长".repeat(300));
    expect(title.endsWith(" · 完整拆书")).toBe(true);
    expect(`${title} · 方法蒸馏`.length).toBeLessThanOrEqual(256);
  });

  it("creates five dedicated libraries and one visible same-title group pair", async () => {
    const state = harness();
    const result = await persistCompleteAnalysisResults({
      api: state.api,
      task: task(),
      presets
    });

    expect(result).toEqual({
      groupTitle: "热门小说 · 完整拆书",
      written: 5,
      createdLibraries: 5
    });
    expect(state.createLibrary).toHaveBeenCalledTimes(5);
    expect(state.createLibraryGroup).toHaveBeenCalledTimes(2);
    expect(state.snapshot.materialGroups[0]?.title).toBe(
      state.snapshot.skillGroups[0]?.title
    );
    expect(state.createLibraryEntry).toHaveBeenCalledTimes(5);
  });

  it("reuses the group and updates matching entries on repeated archive", async () => {
    const state = harness();
    const input = { api: state.api, task: task(), presets };
    await persistCompleteAnalysisResults(input);
    const second = await persistCompleteAnalysisResults(input);

    expect(second.createdLibraries).toBe(0);
    expect(state.createLibrary).toHaveBeenCalledTimes(5);
    expect(state.createLibraryGroup).toHaveBeenCalledTimes(2);
    expect(state.updateLibraryGroup).toHaveBeenCalledTimes(2);
    expect(state.createLibraryEntry).toHaveBeenCalledTimes(5);
    expect(state.saveLibraryEntry).toHaveBeenCalledTimes(5);
  });

  it("validates all five results before mutating the catalog", async () => {
    const state = harness();
    const incomplete = task();
    delete incomplete.items[4]!.result;

    await expect(
      persistCompleteAnalysisResults({
        api: state.api,
        task: incomplete,
        presets
      })
    ).rejects.toThrow("尚未生成结果");
    expect(state.createLibrary).not.toHaveBeenCalled();
    expect(state.createLibraryGroup).not.toHaveBeenCalled();
  });
});
