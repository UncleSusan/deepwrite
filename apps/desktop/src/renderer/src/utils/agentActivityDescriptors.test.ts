import {
  DEFAULT_LIBRARY_AGENT_SETTINGS,
  DEFAULT_LONG_AGENT_SETTINGS,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  type LongBookSummary
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import type {
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import { createResourceTreeLookup } from "./resourceTreeLookup";
import { longNavigationNodeId } from "./longWorkspaceResourceTree";
import { resolveAgentActivityDescriptor } from "./agentActivityDescriptors";

const emptyTree = createResourceTreeLookup([]);
const defaults = {
  workspaceAgents: [
    DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
    DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS
  ],
  longAgents: DEFAULT_LONG_AGENT_SETTINGS,
  libraryAgents: DEFAULT_LIBRARY_AGENT_SETTINGS,
  longBooks: [] as LongBookSummary[]
};

describe("resolveAgentActivityDescriptor", () => {
  it("maps short-form and library controllers back to visible resources", () => {
    const character: WorkspaceDocument = {
      id: "character-overview",
      domain: "creation",
      title: "人物概览",
      eyebrow: "短篇",
      path: ["测试短篇", "人物", "概览"],
      content: "",
      workspaceId: "book-one",
      workspaceType: "short",
      workspaceTitle: "测试短篇",
      stageId: "character_design"
    };
    const skill: WorkspaceDocument = {
      id: "skill-entry",
      domain: "skill",
      title: "节奏控制",
      eyebrow: "技能",
      path: ["写作技能库", "节奏控制"],
      content: "",
      libraryId: "skill-library"
    };
    const sections: ResourceTreeSection[] = [
      {
        id: "creation",
        label: "创作",
        icon: "book",
        nodes: [
          {
            id: "character-node",
            label: "人物概览",
            targetDocumentId: character.id
          }
        ]
      },
      {
        id: "skill",
        label: "技能",
        icon: "library",
        nodes: [
          {
            id: "skill-node",
            label: "节奏控制",
            targetDocumentId: skill.id
          }
        ]
      }
    ];
    const sources = {
      ...defaults,
      documents: [character, skill],
      resourceTree: createResourceTreeLookup(sections)
    };

    expect(
      resolveAgentActivityDescriptor("book-one:character_design", sources)
    ).toMatchObject({
      agentLabel: "人物",
      contextLabel: "测试短篇 · 人物概览",
      targetResourceId: "character-node"
    });
    expect(
      resolveAgentActivityDescriptor("library:skill:skill-library", sources)
    ).toMatchObject({
      agentLabel: "技能库管理智能体",
      contextLabel: "写作技能库 · 节奏控制",
      targetResourceId: "skill-node"
    });
  });

  it("resolves automatic long-form runs to their chapter or root", () => {
    const bookId = "long book";
    const rootId = longNavigationNodeId(bookId, "root:draft");
    const chapterId = longNavigationNodeId(bookId, "draft:chapter-one");
    const resourceTree = createResourceTreeLookup([
      {
        id: "creation",
        label: "创作",
        icon: "book",
        nodes: [
          {
            id: rootId,
            label: "正文",
            longBookId: bookId,
            workspaceType: "long",
            longWorkspaceSelection: {
              key: "root:draft",
              root: "draft",
              title: "正文",
              breadcrumbs: ["测试长篇", "正文"],
              files: [],
              preferredRole: "content",
              description: ""
            },
            children: [
              {
                id: chapterId,
                label: "第一章",
                longBookId: bookId,
                workspaceType: "long",
                longWorkspaceSelection: {
                  key: "draft:chapter-one",
                  root: "draft",
                  title: "第一章",
                  breadcrumbs: ["测试长篇", "正文", "第一章"],
                  files: [],
                  preferredRole: "content",
                  description: "",
                  chapterCardId: "chapter-one"
                }
              }
            ]
          }
        ]
      }
    ]);
    const descriptor = resolveAgentActivityDescriptor(
      [
        "long",
        encodeURIComponent(bookId),
        "draft",
        "draft",
        encodeURIComponent("chapter-one")
      ].join(":"),
      {
        ...defaults,
        documents: [],
        resourceTree,
        longBooks: [{ id: bookId, title: "测试长篇" } as LongBookSummary]
      }
    );

    expect(descriptor).toMatchObject({
      agentLabel: "写手智能体",
      contextLabel: "测试长篇 · 正文",
      targetResourceId: chapterId
    });
  });

  it("returns no descriptor for unknown non-workspace controllers", () => {
    expect(
      resolveAgentActivityDescriptor("general", {
        ...defaults,
        documents: [],
        resourceTree: emptyTree
      })
    ).toBeUndefined();
  });
});
