export type SkillFrontmatterErrorCode =
  | "missing-opening-delimiter"
  | "missing-closing-delimiter"
  | "missing-name"
  | "empty-name"
  | "missing-description"
  | "empty-description";

export type SkillFrontmatterParseResult =
  | {
      valid: true;
      name: string;
      description: string;
    }
  | {
      valid: false;
      code: SkillFrontmatterErrorCode;
      message: string;
    };

interface ParsedFrontmatterField {
  found: boolean;
  value: string;
}

function readField(lines: readonly string[], fieldName: string): ParsedFrontmatterField {
  const pattern = new RegExp(`^${fieldName}\\s*:(.*)$`);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) continue;
    return {
      found: true,
      value: (match[1] ?? "").trim()
    };
  }
  return { found: false, value: "" };
}

export function parseSkillFrontmatter(content: string): SkillFrontmatterParseResult {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return {
      valid: false,
      code: "missing-opening-delimiter",
      message: "技能格式错误 · 首行缺少 ---"
    };
  }

  const closingDelimiterIndex = lines.indexOf("---", 1);
  if (closingDelimiterIndex < 0) {
    return {
      valid: false,
      code: "missing-closing-delimiter",
      message: "技能格式错误 · 缺少结束分隔符 ---"
    };
  }

  const frontmatterLines = lines.slice(1, closingDelimiterIndex);
  const name = readField(frontmatterLines, "name");
  if (!name.found) {
    return {
      valid: false,
      code: "missing-name",
      message: "技能格式错误 · 缺少 name 字段"
    };
  }
  if (!name.value) {
    return {
      valid: false,
      code: "empty-name",
      message: "技能格式错误 · name 不能为空"
    };
  }

  const description = readField(frontmatterLines, "description");
  if (!description.found) {
    return {
      valid: false,
      code: "missing-description",
      message: "技能格式错误 · 缺少 description 字段"
    };
  }
  if (!description.value) {
    return {
      valid: false,
      code: "empty-description",
      message: "技能格式错误 · description 不能为空"
    };
  }

  return {
    valid: true,
    name: name.value,
    description: description.value
  };
}
