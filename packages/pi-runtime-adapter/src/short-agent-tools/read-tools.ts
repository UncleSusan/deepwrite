import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  isProvisionalExpertDraftSectionId,
  type ExpertDraftSectionSnapshot,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import {
  readShortDocumentPage,
  recordShortDocumentPage,
  renderShortDocumentPageMetadata,
  SHORT_DOCUMENT_PAGE_DEFAULT_CHARACTERS,
  SHORT_DOCUMENT_PAGE_MAX_CHARACTERS,
  type ShortDocumentPage,
  type ShortDocumentReadCoverage
} from "./paging";
import { defineTool, literalUnion } from "./schema";
import {
  DRAFT_FILE_PARAMETER_VALUES,
  draftContentUnitLabel,
  draftFileLabel,
  draftUnitCounter,
  draftUnitLabel,
  lineColumnAt,
  orderedExpertSections,
  readableStageIds,
  stageLabel,
  textResult,
  toDraftFileKind,
  workspaceKindLabel,
  workspaceTitleLabel,
  type BuildWritingWorkspaceToolsInput,
  type DraftFileKind,
  type ExpertSectionMap
} from "./shared";

/**
 * Draft bodies enter the run snapshot without truncation, so one unbounded
 * batch read can exhaust the model context. Full reads are paged instead.
 */
const DRAFT_FULL_READ_CHARACTER_BUDGET = 60_000;
const DRAFT_FULL_READ_MAX_SECTIONS = 20;
const DRAFT_PREVIEW_EXCERPT_CHARACTERS = 200;

function fileSizeLabel(content: string): string {
  return content.length ? `${content.length.toLocaleString("zh-CN")} 字符` : "空";
}

function previewExcerpt(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= DRAFT_PREVIEW_EXCERPT_CHARACTERS * 2) return compact;
  return (
    `${compact.slice(0, DRAFT_PREVIEW_EXCERPT_CHARACTERS)}` +
    `……〔中间省略 ${(compact.length - DRAFT_PREVIEW_EXCERPT_CHARACTERS * 2).toLocaleString("zh-CN")} 字符〕……` +
    `${compact.slice(-DRAFT_PREVIEW_EXCERPT_CHARACTERS)}`
  );
}

function renderDraftSectionPreview(
  section: ExpertDraftSectionSnapshot,
  index: number,
  fields: readonly DraftFileKind[]
): string {
  const lines = [
    `${index + 1}. 【${section.title}】 section_id: ${section.id}`,
    `   字数要求: ${section.wordCountRequirement || "未设置"}`
  ];
  for (const field of fields) {
    const file = section[field];
    lines.push(`   ${draftFileLabel(field)}（${file.documentId}）：${fileSizeLabel(file.content)}`);
    if (file.content.trim()) {
      lines.push(`   摘录：${previewExcerpt(file.content)}`);
    }
  }
  return lines.join("\n");
}

function renderDraftSectionFull(
  section: ExpertDraftSectionSnapshot,
  index: number,
  fields: readonly DraftFileKind[],
  readCoverage: Map<string, ShortDocumentReadCoverage>,
  characterLimitPerFile?: number
): { text: string; fullyReadDocumentIds: string[] } {
  const fullyReadDocumentIds: string[] = [];
  const blocks = fields.map((field) => {
    const file = section[field];
    const page = readShortDocumentPage(
      file.content,
      0,
      characterLimitPerFile ?? SHORT_DOCUMENT_PAGE_MAX_CHARACTERS
    );
    if (recordShortDocumentPage(readCoverage, file.documentId, page)) {
      fullyReadDocumentIds.push(file.documentId);
    }
    return [
      `${draftFileLabel(field)}文件: ${file.title}（${file.documentId}）`,
      `${draftFileLabel(field)}版本: ${file.revision}`,
      renderShortDocumentPageMetadata(page),
      "",
      page.content || `（${draftFileLabel(field)}为空）`,
      ...(page.nextOffset !== null
        ? [
            "",
            `（该${draftFileLabel(field)}尚未读完；请仅指定该 section_id 和 include=["${field === "body" ? "body" : "character_state"}"]，并用 offset=${page.nextOffset} 继续分页读取。未完整读取的文件不能整体覆盖。）`
          ]
        : [])
    ].join("\n");
  });
  return {
    text: [
      `===== ${index + 1}. ${section.title} =====`,
      `section_id: ${section.id}`,
      `字数要求: ${section.wordCountRequirement || "未设置"}`,
      "",
      blocks.join("\n\n")
    ].join("\n"),
    fullyReadDocumentIds
  };
}

function renderDraftDocumentPage(
  section: ExpertDraftSectionSnapshot,
  field: DraftFileKind,
  page: ShortDocumentPage
): string {
  const file = section[field];
  return [
    `===== ${section.title} =====`,
    `section_id: ${section.id}`,
    `字数要求: ${section.wordCountRequirement || "未设置"}`,
    `${draftFileLabel(field)}文件: ${file.title}（${file.documentId}）`,
    `${draftFileLabel(field)}版本: ${file.revision}`,
    renderShortDocumentPageMetadata(page),
    "",
    page.content || `（${draftFileLabel(field)}为空）`
  ].join("\n");
}

export function buildReadWorkspaceContentTool(
  input: BuildWritingWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>
): AgentTool {
  const allowed = readableStageIds(input);
  return defineTool({
    name: "read_workspace_content",
    label: "读取工作区内容",
    description: `分页读取当前${workspaceKindLabel(input)}某一阶段的实时内容。仅允许：${allowed
      .map((stageId) => `${stageLabel(input, stageId)}(${stageId})`)
      .join("、")}。每次只读取一个阶段；根据 next_offset 继续调用可读完整个文件。draft 只返回目录，章节原文使用 read_draft_sections。`,
    parameters: Type.Object({
      stage_id: literalUnion(allowed),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: SHORT_DOCUMENT_PAGE_MAX_CHARACTERS
        })
      )
    }),
    execute: async (_toolCallId, params) => {
      const stageId = String(params.stage_id) as ShortWorkspaceStageId;
      if (!allowed.includes(stageId)) {
        return textResult(
          `当前智能体不允许读取「${stageLabel(input, stageId)}」。`
        );
      }
      if (stageId === "draft") {
        const shared = input.sharedState;
        const orderedIds =
          shared?.expertSectionOrder ??
          input.workspace.expertDraft.sections.map((section) => section.id);
        const sections = orderedIds
          .map(
            (sectionId) =>
              shared?.expertSections.get(sectionId) ??
              input.workspace.expertDraft.sections.find(
                (section) => section.id === sectionId
              )
          )
          .filter((section): section is ExpertDraftSectionSnapshot => Boolean(section));
        const index = sections
          .map(
            (section, sectionIndex) =>
              `${sectionIndex + 1}. ${section.title}（${section.id}）` +
              `${isProvisionalExpertDraftSectionId(section.id) ? "〔本轮待创建〕" : ""}\n` +
              `   字数要求：${section.wordCountRequirement || "未设置"}\n` +
              `   正文文件：${section.body.title}（${section.body.documentId}）｜${fileSizeLabel(section.body.content)}\n` +
              `   人物状态文件：${section.characterState.title}（${section.characterState.documentId}）｜${fileSizeLabel(section.characterState.content)}`
          )
          .join("\n");
        const directoryRevision =
          shared?.expertDraftDirectoryBaseRevision ??
          input.workspace.expertDraft.revision;
        return textResult(
          `${workspaceTitleLabel(input)}：《${input.workspace.title}》\n【正文目录】（draft）\n` +
          `目录版本：${directoryRevision}\n` +
          `${draftUnitLabel(input)}数：${sections.length}\n\n${index}\n\n` +
          `这里只返回文件映射，不返回${draftUnitLabel(input)}原文。读取原文请调用 read_draft_sections：` +
          `整篇扫描用 mode=preview，需要精读或改写的${draftUnitLabel(input)}再用 mode=full。`
        );
      }
      const storedBody = stageBodies.get(stageId) ?? "";
      const requestedOffset = Number(params.offset ?? 0);
      const page = readShortDocumentPage(
        storedBody,
        requestedOffset,
        Number(params.max_characters ?? SHORT_DOCUMENT_PAGE_DEFAULT_CHARACTERS)
      );
      if (requestedOffset > page.totalCharacters) {
        return textResult(
          `未读取：offset ${requestedOffset} 超过「${stageLabel(input, stageId)}」总字符数 ${page.totalCharacters}。`
        );
      }
      return textResult(
        `${workspaceTitleLabel(input)}：《${input.workspace.title}》\n【${stageLabel(input, stageId)}】（${stageId}）\n` +
        `${renderShortDocumentPageMetadata(page)}\n\n${page.content || "该阶段当前文本为空。"}`
      );
    }
  });
}

export function buildSearchWorkspaceTextTool(
  input: BuildWritingWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  expertSections: ExpertSectionMap
): AgentTool {
  const allowed = readableStageIds(input);
  return defineTool({
    name: "search_workspace_text",
    label: "搜索工作区文本",
    description:
      `在当前智能体可读的${workspaceKindLabel(input)}阶段中按原文搜索，只返回命中位置和少量上下文；局部替换前可先用它定位准确原文。`,
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 600 }),
      stage_id: Type.Optional(literalUnion(allowed)),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      context_chars: Type.Optional(Type.Integer({ minimum: 10, maximum: 300 }))
    }),
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? "");
      const selected = params.stage_id
        ? [String(params.stage_id) as ShortWorkspaceStageId]
        : allowed;
      const maxMatches = Math.min(50, Math.max(1, Number(params.max_matches ?? 10)));
      const contextChars = Math.min(300, Math.max(10, Number(params.context_chars ?? 60)));
      const matches: string[] = [];
      for (const stageId of selected) {
        if (!allowed.includes(stageId)) continue;
        const sources = stageId === "draft"
          ? orderedExpertSections(input, expertSections).map((section) => ({
              label: `${section.title}（${section.id}）`,
              body: section.body.content
            }))
          : [{ label: `${stageLabel(input, stageId)}(${stageId})`, body: stageBodies.get(stageId) ?? "" }];
        for (const source of sources) {
          let cursor = 0;
          while (matches.length < maxMatches) {
            const index = source.body.indexOf(query, cursor);
            if (index < 0) break;
            const { line, column } = lineColumnAt(source.body, index);
            const start = Math.max(0, index - contextChars);
            const end = Math.min(
              source.body.length,
              index + query.length + contextChars
            );
            matches.push(
              `${source.label} ${line}:${column} ${start > 0 ? "…" : ""}${source.body.slice(start, end)}${end < source.body.length ? "…" : ""}`
            );
            cursor = index + Math.max(1, query.length);
          }
          if (matches.length >= maxMatches) break;
        }
      }
      const truncatedLabels = selected
        .filter((stageId) =>
          input.workspace.stages.some(
            (stage) => stage.stageId === stageId && stage.truncated
          )
        )
        .map((stageId) => stageLabel(input, stageId));
      const truncationNote = truncatedLabels.length
        ? `\n\n注意：${truncatedLabels.join("、")}仅搜索了本轮可见的前段快照，不能据此判断全文无匹配。`
        : "";
      return textResult(
        matches.length
          ? `${matches.join("\n\n")}${truncationNote}`
          : truncatedLabels.length
            ? `本轮可见快照中没有找到匹配文本。${truncationNote}`
            : "没有找到匹配文本。"
      );
    }
  });
}

export function buildReadDraftSectionsTool(
  input: BuildWritingWorkspaceToolsInput,
  expertSections: ExpertSectionMap,
  readExpertFileIds: Set<string>,
  readCoverage: Map<string, ShortDocumentReadCoverage>
): AgentTool {
  return defineTool({
    name: "read_draft_sections",
    label:
      input.workspaceType === "script" ? "读取剧集正文" : "读取正文章节",
    description:
      `按 section_id 批量读取${draftContentUnitLabel(input)}文件，按目录顺序返回。` +
      "mode=preview 只返回标题、字数和首尾摘录，用于整篇扫描定位；" +
      `mode=full 的批量读取单次最多 ${DRAFT_FULL_READ_MAX_SECTIONS} ${draftUnitCounter(input)}且合计不超过 ${DRAFT_FULL_READ_CHARACTER_BUDGET.toLocaleString("zh-CN")} 个字符。` +
      "单个超长文件请只指定一个 section_id 和一种 include，并根据 next_offset 使用 offset、max_characters 连续分页读取。" +
      `只有被 mode=full 完整读取的文件才获得整${draftUnitCounter(input)}覆盖权限。`,
    parameters: Type.Object({
      section_ids: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
        minItems: 1,
        maxItems: 100
      }),
      include: Type.Optional(
        Type.Array(literalUnion(DRAFT_FILE_PARAMETER_VALUES), {
          minItems: 1,
          maxItems: DRAFT_FILE_PARAMETER_VALUES.length
        })
      ),
      mode: Type.Optional(literalUnion(["full", "preview"] as const)),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_characters: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: SHORT_DOCUMENT_PAGE_MAX_CHARACTERS
        })
      )
    }),
    execute: async (_toolCallId, params) => {
      const requested = (params.section_ids as string[])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      const requestedIds = new Set(requested);
      const includeValues = Array.isArray(params.include) && params.include.length
        ? (params.include as string[]).map((value) => String(value))
        : ["body"];
      const fields = DRAFT_FILE_PARAMETER_VALUES.filter((value) =>
        includeValues.includes(value)
      ).map(toDraftFileKind);
      if (fields.length === 0) fields.push("body");

      const targets = orderedExpertSections(input, expertSections).filter((section) =>
        requestedIds.has(section.id)
      );
      const missing = requested.filter(
        (sectionId) => !targets.some((section) => section.id === sectionId)
      );
      if (targets.length === 0) {
        return textResult(
          `没有找到这些${draftContentUnitLabel(input)}：${missing.join("、")}。当前目录：${orderedExpertSections(
            input,
            expertSections
          )
            .map((section) => `${section.title}（${section.id}）`)
            .join("、")}`
        );
      }

      const directoryRevision =
        input.sharedState?.expertDraftDirectoryBaseRevision ??
        input.workspace.expertDraft.revision;
      const header = [
        `${workspaceTitleLabel(input)}：《${input.workspace.title}》`,
        `正文目录版本：${directoryRevision}`
      ];
      const missingNote = missing.length
        ? [`\n没有找到这些 section_id：${missing.join("、")}。`]
        : [];

      if (String(params.mode ?? "full") === "preview") {
        const previews = targets.map((section, index) =>
          renderDraftSectionPreview(section, index, fields)
        );
        return textResult(
          [
            ...header,
            `预览 ${targets.length} ${draftUnitCounter(input)}（${fields.map(draftFileLabel).join("、")}）。预览不算完整读取，改写前仍需对目标${draftUnitLabel(input)}使用 mode=full。`,
            "",
            previews.join("\n\n"),
            ...missingNote
          ].join("\n")
        );
      }

      const explicitPagination =
        params.offset !== undefined || params.max_characters !== undefined;
      if (explicitPagination) {
        if (requested.length !== 1 || fields.length !== 1) {
          return textResult(
            "未读取：分页读取必须只指定一个 section_id，并且 include 只能包含 body 或 character_state 其中一种。"
          );
        }
        const section = targets[0]!;
        const field = fields[0]!;
        const file = section[field];
        const requestedOffset = Number(params.offset ?? 0);
        const page = readShortDocumentPage(
          file.content,
          requestedOffset,
          Number(params.max_characters ?? SHORT_DOCUMENT_PAGE_DEFAULT_CHARACTERS)
        );
        if (requestedOffset > page.totalCharacters) {
          return textResult(
            `未读取：offset ${requestedOffset} 超过「${section.title}」${draftFileLabel(field)}总字符数 ${page.totalCharacters}。`
          );
        }
        if (recordShortDocumentPage(readCoverage, file.documentId, page)) {
          readExpertFileIds.add(file.documentId);
        }
        return textResult(
          [...header, renderDraftDocumentPage(section, field, page), ...missingNote].join(
            "\n"
          )
        );
      }

      const rendered: string[] = [];
      let usedCharacters = 0;
      let fullyReadFiles = 0;
      let cutoffIndex = targets.length;
      for (const [index, section] of targets.entries()) {
        const cost = fields.reduce(
          (total, field) => total + section[field].content.length,
          0
        );
        const first = index === 0;
        if (
          !first &&
          (rendered.length >= DRAFT_FULL_READ_MAX_SECTIONS ||
            usedCharacters + cost > DRAFT_FULL_READ_CHARACTER_BUDGET)
        ) {
          cutoffIndex = index;
          break;
        }
        const oversizedAlone = first && cost > DRAFT_FULL_READ_CHARACTER_BUDGET;
        const block = renderDraftSectionFull(
          section,
          index,
          fields,
          readCoverage,
          oversizedAlone
            ? Math.floor(DRAFT_FULL_READ_CHARACTER_BUDGET / fields.length)
            : undefined
        );
        block.fullyReadDocumentIds.forEach((documentId) => {
          readExpertFileIds.add(documentId);
          fullyReadFiles += 1;
        });
        rendered.push(block.text);
        usedCharacters += cost;
      }

      const skipped = targets.slice(cutoffIndex);
      const skippedNote = skipped.length
        ? [
            `\n本次未读取 ${skipped.length} ${draftUnitCounter(input)}（已达单次读取上限）：${skipped
              .map((section) => `${section.title}（${section.id}）`)
              .join("、")}。请再次调用 read_draft_sections 继续分批读取。`
          ]
        : [];
      return textResult(
        [
          ...header,
          `本次返回 ${rendered.length} ${draftUnitCounter(input)}的${fields.map(draftFileLabel).join("和")}；已完整读取 ${fullyReadFiles} 个文件。批量内容成本约 ${usedCharacters.toLocaleString("zh-CN")} 字符。`,
          "",
          rendered.join("\n\n"),
          ...skippedNote,
          ...missingNote
        ].join("\n")
      );
    }
  });
}
