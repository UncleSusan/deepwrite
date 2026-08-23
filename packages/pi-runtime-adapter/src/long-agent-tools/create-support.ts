import {
  EMPTY_LONG_MARKDOWN_REVISION,
  createEmptyLongMarkdownFileReference,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation
} from "@deepwrite/contracts";
import { contentRevision, type LongFileChangeInput } from "./proposals";
import type { LongCreateKind } from "./entity-registry";
import type { LongDocumentTarget } from "./target";

/** Flat, snake_case metadata accepted by `create` for every entity kind. */
export interface LongCreateMeta {
  title?: string;
  name?: string;
  aliases?: string[];
  type_id?: string;
  category_id?: string;
  volume_id?: string;
  arc_id?: string;
  primary_arc_id?: string | null;
  arc_ids?: string[];
  character_ids?: string[];
  character_id?: string;
  chapter_card_id?: string;
  document?: "current_state" | "history";
  event_id?: string;
  source_event_id?: string;
  target_event_id?: string;
  truth_event_id?: string | null;
  foreshadowing_id?: string;
  placement_id?: string;
  time_mode?: "exact" | "relative" | "sequence" | "unknown";
  time_label?: string;
  location?: string;
  type?: string;
  mode?: string;
  disclosure?: string;
  planned_span?: "local" | "within_volume" | "cross_volume";
  planned_scope?: string;
}

export interface LongCreateInput {
  kind: LongCreateKind;
  meta: LongCreateMeta;
  content: string;
  index: LongWorkspaceIndexSnapshot;
  timestamp: string;
  idSeed: string;
  activeChapterCardId?: string;
}

export interface LongCreateResult {
  operations: LongWorkspaceOperation[];
  changes: LongFileChangeInput[];
  createdId: string;
  label: string;
  action?: "create" | "write";
}

export function requireMeta<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`创建该对象必须提供 meta.${field}。`);
  }
  return value;
}

/** New files carry the revision of their initial content so Core can match it. */
export function newLongFile(
  id: string,
  path: string,
  timestamp: string,
  content: string
): LongWorkspaceFileReference {
  const file = createEmptyLongMarkdownFileReference(id, path, timestamp);
  return {
    ...file,
    revision: content ? contentRevision(content) : EMPTY_LONG_MARKDOWN_REVISION
  };
}

export function createChange(
  target: LongDocumentTarget,
  file: LongWorkspaceFileReference,
  content: string
): LongFileChangeInput {
  return {
    target: { ...target, file },
    operation: "create",
    beforeText: "",
    afterText: content,
    beforeRevision: null,
    nextRevision: file.revision,
    file
  };
}

/** Fill an already-indexed empty continuity file in the same create call. */
export function writeEmptyFileChange(
  target: LongDocumentTarget,
  file: LongWorkspaceFileReference,
  content: string,
  timestamp: string
): LongFileChangeInput {
  const nextRevision = content
    ? contentRevision(content)
    : EMPTY_LONG_MARKDOWN_REVISION;
  return {
    target: {
      ...target,
      file: { ...file, revision: nextRevision, updatedAt: timestamp }
    },
    operation: "write",
    beforeText: "",
    afterText: content,
    beforeRevision: file.revision,
    nextRevision,
    file
  };
}
