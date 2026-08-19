/**
 * Every creative agent can inspect draft sections. Draft mutations remain
 * exclusive to the unified draft coordinator.
 */
const SHORT_WORKSPACE_DRAFT_TOOLS = [
  "write_draft_section",
  "replace_draft_section_text",
  "rename_draft_section",
  "delete_draft_section"
] as const;

export const SHORT_WORKSPACE_TOOL_MANIFEST = {
  standard: [
    "read_workspace_content",
    "search_workspace_text",
    "query_linked_material_entries",
    "load_skill",
    "list_characters",
    "search_characters",
    "read_character",
    "read_draft_sections",
    "write_workspace_editor",
    "replace_current_stage_text"
  ],
  characterRead: ["list_characters", "search_characters", "read_character"],
  characterWrite: [
    "create_character_file",
    "write_character_file",
    "edit_character_file",
    "rename_character_item",
    "move_character_item",
    "delete_character_file"
  ],
  plot: ["switch_storyline_stage"],
  draft: SHORT_WORKSPACE_DRAFT_TOOLS,
  coordinator: ["create_draft_sections", ...SHORT_WORKSPACE_DRAFT_TOOLS],
  sectionWriter: [...SHORT_WORKSPACE_DRAFT_TOOLS]
} as const;
