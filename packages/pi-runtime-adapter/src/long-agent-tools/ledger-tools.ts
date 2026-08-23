import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  LongCommitChapterInputSchema,
  type LongContinuityFileRole,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { defineTool, textResult } from "./shared";
import { stableIdParameter, strictObject } from "./schemas";
import { longProposalResultSummary, type LongToolContext } from "./context";

const ROLE_TITLES: Record<LongContinuityFileRole, string> = {
  foreshadowing_changes: "伏笔变化",
  world_reveals: "世界观揭露",
  character_current_state: "人物当前状态",
  character_history: "人物历史轨迹",
  chapter_end_state: "章末状态",
  handoff: "接续包"
};

export function chapterForeshadowingCandidates(
  index: LongWorkspaceIndexSnapshot,
  chapterCardId: string
) {
  const placementById = new Map(
    index.plot.narrativePlacements.map((placement) => [placement.id, placement])
  );
  return index.plot.foreshadowing.flatMap((thread) =>
    thread.beats.flatMap((beat) => {
      const placement =
        beat.placementId === null
          ? undefined
          : placementById.get(beat.placementId);
      if (
        (beat.chapterCardId ?? placement?.chapterCardId ?? null) !==
        chapterCardId
      ) {
        return [];
      }
      return [{ thread, beat }];
    })
  );
}

export function buildLedgerCommitTool(ctx: LongToolContext): AgentTool {
  const {
    input,
    workspace,
    profile,
    loadActiveChapterMutationContext,
    readWholeDocument
  } = ctx;
  return defineTool({
    name: "propose_continuity_commit",
    label: "保存连续性记录",
    description:
      "为指定或当前已有正文、尚未记录的章节登记连续性记录。未选中章卡时必须提供 chapter_card_id。必须逐项提交本章伏笔总览候选触点的结果和正文证据；没有候选时传空数组。伏笔总览是设计源，本工具只核验既有触点，不新增伏笔线或触点。",
    parameters: strictObject({
      chapter_card_id: Type.Optional(stableIdParameter("chapter")),
      summary: Type.String({ minLength: 1, maxLength: 1_000 }),
      foreshadowing_touchpoint_decisions: Type.Array(
        strictObject({
          foreshadowing_id: stableIdParameter("foreshadow"),
          beat_id: stableIdParameter("beat"),
          status: StringEnum(["committed", "missed"] as const),
          evidence: Type.String({ minLength: 1, maxLength: 4_000 })
        }),
        { maxItems: 100_000 }
      )
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      const { index, projectRevision, activeChapterCardId, chapter } =
        await loadActiveChapterMutationContext(signal, params.chapter_card_id);
      if (chapter.bodyStatus !== "written") {
        throw new Error(
          "Only a chapter with saved body text can receive a continuity record."
        );
      }
      const summary = params.summary.trim();
      if (!summary) {
        throw new Error("Continuity commit summary must be non-empty.");
      }

      const candidates = chapterForeshadowingCandidates(
        index,
        activeChapterCardId
      );
      const candidateByBeatId = new Map(
        candidates.map((candidate) => [candidate.beat.id, candidate])
      );
      const receivedBeatIds = new Set<string>();
      for (const decision of params.foreshadowing_touchpoint_decisions) {
        if (receivedBeatIds.has(decision.beat_id)) {
          throw new Error(`伏笔触点 ${decision.beat_id} 不能重复提交决策。`);
        }
        receivedBeatIds.add(decision.beat_id);
        const candidate = candidateByBeatId.get(decision.beat_id);
        if (!candidate) {
          throw new Error(
            `伏笔触点 ${decision.beat_id} 不属于当前章节的既有候选。`
          );
        }
        if (candidate.thread.id !== decision.foreshadowing_id) {
          throw new Error(
            `伏笔触点 ${decision.beat_id} 不属于伏笔线 ${decision.foreshadowing_id}。`
          );
        }
      }
      if (receivedBeatIds.size !== candidateByBeatId.size) {
        throw new Error(
          "伏笔触点决策必须完整覆盖本章在伏笔总览中的既有候选，且不能包含其他触点。"
        );
      }

      const body = await readWholeDocument(
        chapter.body,
        index.revision,
        projectRevision,
        signal
      );
      const targets: Array<{
        role: LongContinuityFileRole;
        characterId: string | null;
        file: LongWorkspaceFileReference;
      }> = [
        {
          role: "chapter_end_state",
          characterId: null,
          file: chapter.characterState
        },
        { role: "handoff", characterId: null, file: chapter.handoff },
        ...(candidates.length > 0
          ? [
              {
                role: "foreshadowing_changes" as const,
                characterId: null,
                file: chapter.foreshadowingChanges
              }
            ]
          : []),
        ...(chapter.worldReveals
          ? [
              {
                role: "world_reveals" as const,
                characterId: null,
                file: chapter.worldReveals
              }
            ]
          : [])
      ];
      for (const entry of [...chapter.characterContinuity].sort((left, right) =>
        left.characterId.localeCompare(right.characterId)
      )) {
        targets.push(
          {
            role: "character_current_state",
            characterId: entry.characterId,
            file: entry.currentState
          },
          {
            role: "character_history",
            characterId: entry.characterId,
            file: entry.history
          }
        );
      }

      const continuityFiles: Array<{
        role: LongContinuityFileRole;
        characterId: string | null;
        content: string;
        file: LongWorkspaceFileReference;
      }> = [];
      for (const target of targets) {
        const live = await readWholeDocument(
          target.file,
          index.revision,
          projectRevision,
          signal
        );
        continuityFiles.push({
          role: target.role,
          characterId: target.characterId,
          content: live.content,
          file: live.file
        });
      }

      const missing = [
        ...(body.content.trim() ? [] : ["正文"]),
        ...continuityFiles.flatMap((file) =>
          file.content.trim()
            ? []
            : [
                file.characterId
                  ? `${file.characterId} / ${ROLE_TITLES[file.role]}`
                  : ROLE_TITLES[file.role]
              ]
        )
      ];
      if (missing.length > 0) {
        return textResult(
          `未登记归档：以下文本尚为空：${missing.join("、")}。`
        );
      }

      const commitInput = LongCommitChapterInputSchema.parse({
        mode: "text_files",
        bookId: workspace.bookId,
        chapterCardId: activeChapterCardId,
        chapterFileRevisions: { body: body.file.revision },
        continuityFileRevisions: continuityFiles.map(({ file }) => ({
          fileId: file.id,
          revision: file.revision
        })),
        foreshadowingBeatDecisions: Object.fromEntries(
          params.foreshadowing_touchpoint_decisions.map((decision) => [
            decision.beat_id,
            { status: decision.status, note: decision.evidence.trim() }
          ])
        ),
        commitMessage: summary,
        baseWorkspaceRevision: index.revision,
        baseProjectRevision: projectRevision
      });
      const title =
        index.plot.chapterCards.find(({ id }) => id === activeChapterCardId)
          ?.title ?? activeChapterCardId;
      return textResult(
        longProposalResultSummary(
          input,
          `仅已登记《${title}》连续性记录请求（${continuityFiles.length} 份连续性文件），当前尚未保存。客户端将在文件卡全部获批后尝试保存记录。`
        ),
        {
          kind: "long-ledger-commit-proposal",
          bookId: workspace.bookId,
          agentId: profile.id,
          input: commitInput,
          summary
        }
      );
    }
  });
}
