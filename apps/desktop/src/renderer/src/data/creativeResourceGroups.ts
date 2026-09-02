import type { CatalogIndexSnapshot } from "@deepwrite/contracts";
import type {
  CatalogWorkspaceProjection,
  CatalogWorkspaceProjectionIndex
} from "./catalogWorkspace";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";

interface GroupPair {
  title: string;
  materialGroupId: string;
  skillGroupId: string;
}

function pairedGroups(snapshot: CatalogIndexSnapshot): GroupPair[] {
  const materialsByTitle = new Map<string, string[]>();
  const skillsByTitle = new Map<string, string[]>();
  for (const group of snapshot.materialGroups) {
    const ids = materialsByTitle.get(group.title) ?? [];
    ids.push(group.id);
    materialsByTitle.set(group.title, ids);
  }
  for (const group of snapshot.skillGroups) {
    const ids = skillsByTitle.get(group.title) ?? [];
    ids.push(group.id);
    skillsByTitle.set(group.title, ids);
  }
  return [...materialsByTitle.entries()].flatMap(
    ([title, materialGroupIds]) => {
      if (!title.endsWith(" · 完整拆书")) return [];
      const skillGroupIds = skillsByTitle.get(title) ?? [];
      return materialGroupIds.length === 1 && skillGroupIds.length === 1
        ? [
            {
              title,
              materialGroupId: materialGroupIds[0]!,
              skillGroupId: skillGroupIds[0]!
            }
          ]
        : [];
    }
  );
}

function findGroupNode(
  section: ResourceTreeSection | undefined,
  groupId: string
): ResourceTreeNode | undefined {
  return section?.nodes.find(
    (node) => node.catalogNodeType === "group" && node.groupId === groupId
  );
}

function combinedNode(
  pair: GroupPair,
  materialNode: ResourceTreeNode,
  skillNode: ResourceTreeNode
): ResourceTreeNode {
  const children = [
    ...(materialNode.children ?? []).map((node) => ({
      ...node,
      libraryDomain: "material" as const
    })),
    ...(skillNode.children ?? []).map((node) => ({
      ...node,
      libraryDomain: "skill" as const
    }))
  ];
  return {
    id: `catalog:creative-group:${encodeURIComponent(pair.materialGroupId)}:${encodeURIComponent(pair.skillGroupId)}`,
    label: pair.title,
    icon: "folder",
    badge: String(children.length),
    catalogNodeType: "group",
    materialGroupId: pair.materialGroupId,
    skillGroupId: pair.skillGroupId,
    children
  };
}

function resourceNodeIndex(
  sections: readonly ResourceTreeSection[]
): ReadonlyMap<string, ResourceTreeNode> {
  const result = new Map<string, ResourceTreeNode>();
  const visit = (node: ResourceTreeNode): void => {
    if (!result.has(node.id)) result.set(node.id, node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const section of sections) {
    for (const node of section.nodes) visit(node);
  }
  return result;
}

function replaceResourceIndex(
  index: CatalogWorkspaceProjectionIndex,
  sections: readonly ResourceTreeSection[]
): CatalogWorkspaceProjectionIndex {
  return { ...index, resourceNodeById: resourceNodeIndex(sections) };
}

export function mergeCreativeResourceGroups(
  snapshot: CatalogIndexSnapshot,
  projection: CatalogWorkspaceProjection
): CatalogWorkspaceProjection {
  const pairs = pairedGroups(snapshot);
  if (pairs.length === 0) return projection;
  const materialSection = projection.resourceSections.find(
    ({ id }) => id === "material"
  );
  const skillSection = projection.resourceSections.find(
    ({ id }) => id === "skill"
  );
  const mergedNodes = pairs.flatMap((pair) => {
    const materialNode = findGroupNode(materialSection, pair.materialGroupId);
    const skillNode = findGroupNode(skillSection, pair.skillGroupId);
    return materialNode && skillNode
      ? [combinedNode(pair, materialNode, skillNode)]
      : [];
  });
  if (mergedNodes.length === 0) return projection;

  const materialIds = new Set(
    mergedNodes.map(({ materialGroupId }) => materialGroupId)
  );
  const skillIds = new Set(mergedNodes.map(({ skillGroupId }) => skillGroupId));
  const sections = projection.resourceSections.map((section) => ({
    ...section,
    nodes:
      section.id === "material"
        ? section.nodes.filter((node) => !materialIds.has(node.groupId))
        : section.id === "skill"
          ? section.nodes.filter((node) => !skillIds.has(node.groupId))
          : section.nodes
  }));
  const creationIndex = sections.findIndex(({ id }) => id === "creation");
  sections.splice(creationIndex + 1, 0, {
    id: "resource-group",
    label: "创作资料组",
    icon: "folder",
    nodes: mergedNodes
  });
  return {
    ...projection,
    resourceSections: sections,
    index: replaceResourceIndex(projection.index, sections)
  };
}
