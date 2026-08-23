import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  ExternalSkillSelectionResultSchema,
  parseSkillMarkdown,
  type ExternalSkillSelectionResult,
  type ExternalSkillSourceKind
} from "@deepwrite/contracts";

const MAX_CATALOG_TITLE_LENGTH = 256;

export async function readExternalSkills(
  sourceKind: ExternalSkillSourceKind,
  selectedPath: string
): Promise<ExternalSkillSelectionResult> {
  const paths: string[] = [];
  const skipped = {
    invalidFormat: 0,
    unreadable: 0,
    invalidName: 0,
    contentTooLong: 0
  };

  if (sourceKind === "file") {
    if (basename(selectedPath) !== "SKILL.md") {
      skipped.invalidName += 1;
    } else {
      paths.push(selectedPath);
    }
  } else {
    const entries = await readdir(selectedPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (!entry.isDirectory()) continue;
      paths.push(join(selectedPath, entry.name, "SKILL.md"));
    }
  }

  const candidates: ExternalSkillSelectionResult["candidates"] = [];
  let scanned = sourceKind === "file" ? 1 : 0;
  for (const path of paths) {
    let content: string;
    try {
      content = await readFile(path, "utf8");
      if (sourceKind === "directory") scanned += 1;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      if (sourceKind === "directory") scanned += 1;
      skipped.unreadable += 1;
      continue;
    }
    const parsed = parseSkillMarkdown(content);
    if (!parsed.valid) {
      skipped.invalidFormat += 1;
      continue;
    }
    if (parsed.name.length > MAX_CATALOG_TITLE_LENGTH) {
      skipped.invalidName += 1;
      continue;
    }
    candidates.push({
      title: parsed.name,
      description: parsed.description,
      content
    });
  }

  return ExternalSkillSelectionResultSchema.parse({
    candidates,
    scanned,
    skipped
  });
}
