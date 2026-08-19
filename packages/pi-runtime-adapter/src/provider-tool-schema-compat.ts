import type { Context } from "@earendil-works/pi-ai";

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyObjectBranches(
  schema: Record<string, unknown>,
  keyword: "anyOf" | "oneOf" | "allOf"
): boolean {
  const branches = schema[keyword];
  return (
    Array.isArray(branches) &&
    branches.length > 0 &&
    branches.every(
      (branch) => isSchemaRecord(branch) && branch.type === "object"
    )
  );
}

function stringLiteralUnion(
  schema: Record<string, unknown>
): { keyword: "anyOf" | "oneOf"; values: string[] } | undefined {
  if (
    (schema.type !== undefined && schema.type !== "string") ||
    schema.enum !== undefined
  ) {
    return undefined;
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches) || branches.length < 2) continue;
    const values: string[] = [];
    let matches = true;
    for (const branch of branches) {
      if (
        !isSchemaRecord(branch) ||
        branch.type !== "string" ||
        typeof branch.const !== "string" ||
        Object.keys(branch).some((key) => key !== "type" && key !== "const")
      ) {
        matches = false;
        break;
      }
      values.push(branch.const);
    }
    if (matches && new Set(values).size === values.length) {
      return { keyword, values };
    }
  }
  return undefined;
}

/**
 * TypeBox represents literal string unions as `anyOf` branches containing one
 * `const` each. They validate correctly, but a plain string enum is easier for
 * non-strict tool-calling providers to follow and produces clearer schemas.
 * Rewrite only the exact lossless form and leave semantic unions untouched.
 */
function normalizeProviderSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const normalized = value.map((item) => {
      const next = normalizeProviderSchemaNode(item);
      changed ||= next !== item;
      return next;
    });
    return changed ? normalized : value;
  }
  if (!isSchemaRecord(value)) return value;

  const literalUnion = stringLiteralUnion(value);
  if (literalUnion) {
    const normalized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === literalUnion.keyword) continue;
      normalized[key] = normalizeProviderSchemaNode(child);
    }
    normalized.type = "string";
    normalized.enum = literalUnion.values;
    return normalized;
  }

  let changed = false;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = normalizeProviderSchemaNode(child);
    normalized[key] = next;
    changed ||= next !== child;
  }
  return changed ? normalized : value;
}

/**
 * Provider function tools always receive a JSON object as their arguments.
 * TypeBox object unions serialize as a root-level anyOf without an explicit
 * type, which OpenAI-compatible APIs reject before the model can run. Repair
 * only unions/intersections whose every branch is already an object; reject
 * every other non-object root locally instead of sending an invalid request.
 */
export function normalizeProviderToolParameterSchema(
  toolName: string,
  value: unknown
): Record<string, unknown> {
  if (!isSchemaRecord(value)) {
    throw new Error(
      `工具“${toolName}”的参数 schema 必须是 JSON Schema 对象，当前根节点无效。`
    );
  }
  let objectRoot = value;
  if (value.type !== "object") {
    const canDeclareObjectRoot =
      (value.type === undefined || value.type === null) &&
      (["anyOf", "oneOf", "allOf"] as const).some((keyword) =>
        hasOnlyObjectBranches(value, keyword)
      );
    if (canDeclareObjectRoot) {
      objectRoot = { ...value, type: "object" };
    } else {
      const actualType =
        value.type === undefined || value.type === null
          ? "未声明"
          : JSON.stringify(value.type);
      throw new Error(
        `工具“${toolName}”的参数 schema 根节点必须声明 type: "object"，当前为 ${actualType}。`
      );
    }
  }
  return normalizeProviderSchemaNode(objectRoot) as Record<string, unknown>;
}

export function enforceProviderToolSchemaCompatibility(
  context: Context
): Context {
  if (!context.tools?.length) return context;
  let changed = false;
  const tools = context.tools.map((tool) => {
    const parameters = normalizeProviderToolParameterSchema(
      tool.name,
      tool.parameters
    ) as typeof tool.parameters;
    if (parameters === tool.parameters) return tool;
    changed = true;
    return { ...tool, parameters };
  });
  return changed ? { ...context, tools } : context;
}
