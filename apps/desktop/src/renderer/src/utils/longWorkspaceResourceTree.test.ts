import { describe, expect, it } from "vitest";
import type { LongBookSummary } from "@deepwrite/contracts";
import source from "./longWorkspaceResourceTree.ts?raw";
import {
  longNavigationNodeId,
  projectLongWorkspaceNavigation
} from "./longWorkspaceResourceTree";

function summaryFixture(): LongBookSummary {
  return {
    id: "longbook_tree",
    title: "资源树测试",
    navigation: {
      worldbuilding: [],
      characterTypes: [
        { id: "supporting", title: "配角", order: 2 },
        { id: "protagonist", title: "主角", order: 1 }
      ],
      characters: [
        { id: "character_two", group: "supporting" },
        { id: "character_one", group: "protagonist" },
        { id: "character_three", group: "supporting" }
      ],
      volumes: [
        { id: "volume_two", title: "第二卷", order: 2 },
        { id: "volume_one", title: "第一卷", order: 1 }
      ],
      arcs: [
        { id: "arc_two", volumeId: "volume_two", title: "剧情二", order: 1 },
        { id: "arc_one", volumeId: "volume_one", title: "剧情一", order: 1 },
        { id: "arc_three", volumeId: "volume_one", title: "剧情三", order: 2 }
      ],
      chapterCards: [
        {
          id: "chapter_two",
          volumeId: "volume_one",
          title: "第二章",
          narrativeOrder: 2,
          bodyStatus: "empty"
        },
        {
          id: "chapter_three",
          volumeId: "volume_two",
          title: "第三章",
          narrativeOrder: 1,
          bodyStatus: "empty"
        },
        {
          id: "chapter_one",
          volumeId: "volume_one",
          title: "第一章",
          narrativeOrder: 1,
          bodyStatus: "empty"
        }
      ],
      counts: {
        worldbuildingCategories: 0,
        characters: 3,
        arcs: 3,
        volumes: 2,
        chapterCards: 3,
        foreshadowingThreads: 0,
        committedChapters: 0
      }
    }
  } as unknown as LongBookSummary;
}

describe("long workspace resource-tree projection", () => {
  it("keeps group counts and ordered volume/chapter output", () => {
    const roots = projectLongWorkspaceNavigation(summaryFixture());
    const characters = roots.find(({ label }) => label === "人物设计");
    expect(characters?.children?.slice(1).map(({ label, badge }) => ({ label, badge })))
      .toEqual([
        { label: "主角", badge: "1" },
        { label: "配角", badge: "2" }
      ]);

    const plot = roots.find(({ label }) => label === "剧情设计");
    const plotPoints = plot?.children?.find(({ label }) => label === "剧情点");
    expect(plotPoints?.children?.map(({ label, badge }) => ({ label, badge })))
      .toEqual([
        { label: "第一卷", badge: "2 点" },
        { label: "第二卷", badge: "1 点" }
      ]);

    const draft = roots.find(({ label }) => label === "正文");
    expect(draft?.children?.map(({ label }) => label)).toEqual([
      "第一卷",
      "第二卷"
    ]);
    expect(draft?.children?.[0]?.children?.map(({ label }) => label)).toEqual([
      "第一章",
      "第二章"
    ]);
    expect(longNavigationNodeId("longbook_tree", "chapter:chapter_one"))
      .toBe("long-book:longbook_tree:chapter:chapter_one");
  });

  it("indexes repeated group and volume relationships before projection", () => {
    expect(source).toContain("const characterCountByGroup = new Map");
    expect(source).toContain("const arcCountByVolume = new Map");
    expect(source).toContain("const chaptersByVolume = new Map");
    expect(source).not.toContain("book.navigation.characters.filter(");
    expect(source).not.toContain("book.navigation.arcs.filter(");
    expect(source).not.toContain("book.navigation.chapterCards\n        .filter(");
  });
});
