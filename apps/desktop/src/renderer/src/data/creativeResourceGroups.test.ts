import { describe, expect, it } from "vitest";
import type { CatalogIndexSnapshot } from "@deepwrite/contracts";
import type { CatalogWorkspaceProjection } from "./catalogWorkspace";
import type { ResourceTreeNode } from "../types/workspace";
import { mergeCreativeResourceGroups } from "./creativeResourceGroups";

function projection(): CatalogWorkspaceProjection {
  const materialLibrary = {
    id: "material-library",
    label: "剧情结构",
    catalogNodeType: "library" as const,
    libraryId: "material-library",
    materialKind: "plot" as const
  };
  const skillLibrary = {
    id: "skill-library",
    label: "方法蒸馏",
    catalogNodeType: "library" as const,
    libraryId: "skill-library",
    skillKind: "general" as const
  };
  return {
    resourceSections: [
      { id: "creation", label: "创作空间", icon: "book", nodes: [] },
      {
        id: "skill",
        label: "技能库",
        icon: "library",
        nodes: [
          {
            id: "skill-group-node",
            label: "参考书 · 完整拆书",
            catalogNodeType: "group",
            groupId: "skill-group",
            children: [skillLibrary]
          }
        ]
      },
      {
        id: "material",
        label: "素材库",
        icon: "archive",
        nodes: [
          {
            id: "material-group-node",
            label: "参考书 · 完整拆书",
            catalogNodeType: "group",
            groupId: "material-group",
            children: [materialLibrary]
          }
        ]
      }
    ],
    workspaceDocuments: [],
    draftDirectories: [],
    index: {
      resourceNodeById: new Map<string, ResourceTreeNode>([
        [materialLibrary.id, materialLibrary],
        [skillLibrary.id, skillLibrary]
      ]),
      workspaceDocumentById: new Map(),
      resourceIdByDocumentId: new Map(),
      resourceTargetDocumentIdById: new Map(),
      draftDirectoryById: new Map(),
      draftDirectoryByWorkspaceId: new Map(),
      preferredResourceIdByWorkspaceId: new Map(),
      workspaceIdByResourceId: new Map()
    }
  };
}

const snapshot = {
  materialGroups: [
    {
      id: "material-group",
      title: "参考书 · 完整拆书",
      members: { plot: "material-library" }
    }
  ],
  skillGroups: [
    {
      id: "skill-group",
      title: "参考书 · 完整拆书",
      members: { general: "skill-library" }
    }
  ]
} as unknown as CatalogIndexSnapshot;

describe("creative resource group projection", () => {
  it("combines same-title material and skill groups into one visible section", () => {
    const merged = mergeCreativeResourceGroups(snapshot, projection());
    const section = merged.resourceSections.find(
      ({ id }) => id === "resource-group"
    );
    const group = section?.nodes[0];

    expect(section?.label).toBe("创作资料组");
    expect(group?.children).toMatchObject([
      { libraryId: "material-library", libraryDomain: "material" },
      { libraryId: "skill-library", libraryDomain: "skill" }
    ]);
    expect(
      merged.resourceSections.find(({ id }) => id === "material")?.nodes
    ).toEqual([]);
    expect(
      merged.resourceSections.find(({ id }) => id === "skill")?.nodes
    ).toEqual([]);
    expect(merged.index.resourceNodeById.get(group!.id)).toBe(group);
  });
});
