import type {
  CatalogSnapshot,
  DeepWriteApi,
  LongBookAnalysisPreset,
  LongBookAnalysisTaskSnapshot,
  MaterialKind,
  MaterialLibrary,
  SkillKind,
  SkillLibrary
} from "@deepwrite/contracts/renderer";

const COMPLETE_LIBRARY_SPECS = {
  "plot-structure": {
    domain: "material",
    kind: "plot",
    suffix: "剧情结构"
  },
  character: { domain: "material", kind: "character", suffix: "人物" },
  "story-bible": {
    domain: "material",
    kind: "other",
    suffix: "作品设定集"
  },
  "method-distillation": {
    domain: "skill",
    kind: "general",
    suffix: "方法蒸馏"
  },
  style: { domain: "skill", kind: "style", suffix: "文风" }
} as const;

type CompletePresetId = keyof typeof COMPLETE_LIBRARY_SPECS;
type CompleteLibrary = MaterialLibrary | SkillLibrary;
const CATALOG_TITLE_LIMIT = 256;
const GROUP_SUFFIX = " · 完整拆书";
const LONGEST_LIBRARY_SUFFIX = " · 方法蒸馏";

export interface CompleteAnalysisPersistResult {
  groupTitle: string;
  written: number;
  createdLibraries: number;
}

export function completeAnalysisGroupTitle(sourceTitle: string): string {
  const sourceLimit =
    CATALOG_TITLE_LIMIT - GROUP_SUFFIX.length - LONGEST_LIBRARY_SUFFIX.length;
  return `${sourceTitle.trim().slice(0, sourceLimit)}${GROUP_SUFFIX}`;
}

function completeItems(input: {
  task: LongBookAnalysisTaskSnapshot;
  presets: readonly LongBookAnalysisPreset[];
}) {
  return Object.keys(COMPLETE_LIBRARY_SPECS).map((presetId) => {
    const item = input.task.items.find(
      (candidate) => candidate.presetId === presetId
    );
    const preset = input.presets.find((candidate) => candidate.id === presetId);
    if (!item?.result || !preset) {
      throw new Error(
        `“${item?.presetName ?? presetId}”尚未生成结果，请完成或重试后再归档。`
      );
    }
    const spec = COMPLETE_LIBRARY_SPECS[presetId as CompletePresetId];
    if (
      preset.output.domain !== spec.domain ||
      preset.output.kind !== spec.kind
    ) {
      throw new Error(`“${item.presetName}”的输出类型与完整拆书资料组不兼容。`);
    }
    return {
      item,
      preset,
      presetId: presetId as CompletePresetId,
      result: item.result,
      spec
    };
  });
}

function uniqueGroupByTitle<Group extends { title: string }>(
  groups: readonly Group[],
  title: string,
  label: string
): Group | undefined {
  const matches = groups.filter((group) => group.title === title);
  if (matches.length > 1) {
    throw new Error(`存在多个同名${label}“${title}”，请先整理后重试。`);
  }
  return matches[0];
}

function groupedIds(
  snapshot: CatalogSnapshot,
  domain: "material" | "skill"
): Set<string> {
  const groups =
    domain === "material" ? snapshot.materialGroups : snapshot.skillGroups;
  return new Set(
    groups.flatMap(
      (group) => Object.values(group.members).filter(Boolean) as string[]
    )
  );
}

function compatibleLibrary(
  library: CompleteLibrary,
  domain: "material" | "skill",
  kind: string
): boolean {
  return domain === "material"
    ? "materialKind" in library &&
        (library.materialKind === kind || library.materialKind === "mixed")
    : "skillKind" in library && library.skillKind === kind;
}

async function ensureLibraries(input: {
  api: DeepWriteApi;
  snapshot: CatalogSnapshot;
  groupTitle: string;
}): Promise<{
  libraries: Map<CompletePresetId, CompleteLibrary>;
  created: number;
}> {
  const materialGroup = uniqueGroupByTitle(
    input.snapshot.materialGroups,
    input.groupTitle,
    "素材分组"
  );
  const skillGroup = uniqueGroupByTitle(
    input.snapshot.skillGroups,
    input.groupTitle,
    "技能分组"
  );
  const materialGrouped = groupedIds(input.snapshot, "material");
  const skillGrouped = groupedIds(input.snapshot, "skill");
  const libraries = new Map<CompletePresetId, CompleteLibrary>();
  let created = 0;

  const plans = (
    Object.entries(COMPLETE_LIBRARY_SPECS) as Array<
      [CompletePresetId, (typeof COMPLETE_LIBRARY_SPECS)[CompletePresetId]]
    >
  ).map(([presetId, spec]) => {
    const memberId =
      spec.domain === "material"
        ? materialGroup?.members[spec.kind as MaterialKind]
        : skillGroup?.members[spec.kind as SkillKind];
    const candidates =
      spec.domain === "material"
        ? input.snapshot.materials
        : input.snapshot.skills;
    let library = memberId
      ? candidates.find(({ id }) => id === memberId)
      : undefined;
    if (
      memberId &&
      (!library || !compatibleLibrary(library, spec.domain, spec.kind))
    ) {
      throw new Error(
        `资料组“${input.groupTitle}”中的${spec.suffix}库已丢失或类型不兼容。`
      );
    }
    if (!library) {
      const expectedTitle = `${input.groupTitle} · ${spec.suffix}`;
      const unavailableIds =
        spec.domain === "material" ? materialGrouped : skillGrouped;
      const reusable = candidates.filter(
        (candidate) =>
          candidate.title === expectedTitle &&
          !unavailableIds.has(candidate.id) &&
          compatibleLibrary(candidate, spec.domain, spec.kind)
      );
      if (reusable.length > 1) {
        throw new Error(
          `存在多个可复用资料库“${expectedTitle}”，请先整理后重试。`
        );
      }
      library = reusable[0];
    }
    return {
      presetId,
      spec,
      library,
      name: `${input.groupTitle} · ${spec.suffix}`
    };
  });

  // Resolve every existing/reusable target before creating anything. A broken
  // later slot therefore cannot leave an avoidable partial set behind.
  for (const plan of plans) {
    let { library } = plan;
    if (!library) {
      const { name, spec } = plan;
      library =
        spec.domain === "material"
          ? ((await input.api.catalog.createLibrary({
              domain: "material",
              name,
              materialKind: spec.kind,
              libraryType: "long"
            })) ?? undefined)
          : ((await input.api.catalog.createLibrary({
              domain: "skill",
              name,
              skillKind: spec.kind,
              libraryType: "long"
            })) ?? undefined);
      if (!library) throw new Error(`未能创建“${name}”。`);
      created += 1;
    }
    libraries.set(plan.presetId, library);
  }
  return { libraries, created };
}

async function ensureGroups(input: {
  api: DeepWriteApi;
  snapshot: CatalogSnapshot;
  groupTitle: string;
  libraries: ReadonlyMap<CompletePresetId, CompleteLibrary>;
}): Promise<void> {
  const materialMembers = {
    plot: input.libraries.get("plot-structure")!.id,
    character: input.libraries.get("character")!.id,
    other: input.libraries.get("story-bible")!.id
  };
  const skillMembers = {
    general: input.libraries.get("method-distillation")!.id,
    style: input.libraries.get("style")!.id
  };
  const materialGroup = uniqueGroupByTitle(
    input.snapshot.materialGroups,
    input.groupTitle,
    "素材分组"
  );
  const skillGroup = uniqueGroupByTitle(
    input.snapshot.skillGroups,
    input.groupTitle,
    "技能分组"
  );
  if (materialGroup) {
    await input.api.catalog.updateLibraryGroup({
      domain: "material",
      groupId: materialGroup.id,
      title: input.groupTitle,
      members: { ...materialGroup.members, ...materialMembers },
      ...(materialGroup.projectRevision === undefined
        ? {}
        : { baseProjectRevision: materialGroup.projectRevision })
    });
  } else {
    const created = await input.api.catalog.createLibraryGroup({
      domain: "material",
      name: input.groupTitle,
      members: materialMembers
    });
    if (!created) throw new Error("未能创建完整拆书素材分组。");
  }
  if (skillGroup) {
    await input.api.catalog.updateLibraryGroup({
      domain: "skill",
      groupId: skillGroup.id,
      title: input.groupTitle,
      members: { ...skillGroup.members, ...skillMembers },
      ...(skillGroup.projectRevision === undefined
        ? {}
        : { baseProjectRevision: skillGroup.projectRevision })
    });
  } else {
    const created = await input.api.catalog.createLibraryGroup({
      domain: "skill",
      name: input.groupTitle,
      members: skillMembers
    });
    if (!created) throw new Error("未能创建完整拆书技能分组。");
  }
}

async function writeResults(input: {
  api: DeepWriteApi;
  items: ReturnType<typeof completeItems>;
  libraries: ReadonlyMap<CompletePresetId, CompleteLibrary>;
}): Promise<number> {
  const latest = await input.api.catalog.snapshot();
  let written = 0;
  for (const { preset, presetId, result, spec } of input.items) {
    const target = input.libraries.get(presetId)!;
    const current =
      spec.domain === "material"
        ? latest.materials.find(({ id }) => id === target.id)
        : latest.skills.find(({ id }) => id === target.id);
    const existing = current?.entries.find(
      ({ title }) => title === result.title
    );
    if (existing) {
      await input.api.catalog.saveLibraryEntry({
        domain: spec.domain,
        libraryId: target.id,
        entryId: existing.id,
        title: result.title,
        content: result.body,
        ...(current?.projectRevision === undefined
          ? {}
          : { baseProjectRevision: current.projectRevision })
      });
    } else {
      const revision =
        current?.projectRevision === undefined
          ? {}
          : { baseProjectRevision: current.projectRevision };
      if (preset.output.domain === "material") {
        await input.api.catalog.createLibraryEntry({
          domain: "material",
          libraryId: target.id,
          title: result.title,
          content: result.body,
          stageId: preset.output.stageId,
          ...revision
        });
      } else {
        await input.api.catalog.createLibraryEntry({
          domain: "skill",
          libraryId: target.id,
          title: result.title,
          content: result.body,
          stageId: preset.output.stageId,
          ...revision
        });
      }
    }
    written += 1;
  }
  return written;
}

export async function persistCompleteAnalysisResults(input: {
  api: DeepWriteApi;
  task: LongBookAnalysisTaskSnapshot;
  presets: readonly LongBookAnalysisPreset[];
}): Promise<CompleteAnalysisPersistResult> {
  const items = completeItems(input);
  const snapshot = await input.api.catalog.snapshot();
  const groupTitle = completeAnalysisGroupTitle(input.task.sourceTitle);
  const ensured = await ensureLibraries({
    api: input.api,
    snapshot,
    groupTitle
  });
  await ensureGroups({
    api: input.api,
    snapshot,
    groupTitle,
    libraries: ensured.libraries
  });
  const written = await writeResults({
    api: input.api,
    items,
    libraries: ensured.libraries
  });
  return { groupTitle, written, createdLibraries: ensured.created };
}
