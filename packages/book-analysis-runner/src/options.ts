import { resolve } from "node:path";
import type { LongBookAnalysisScopeMode } from "@deepwrite/contracts";

export interface RunnerOptions {
  source?: string;
  sourceKind: "txt" | "directory";
  workspace: string;
  modelId: string;
  baseUrl: string;
  scopeMode: LongBookAnalysisScopeMode;
  styleFullText: boolean;
  contextWindow: number;
  maxTokens: number;
  temperature: number;
  archive?: string;
  resume: boolean;
}

const DEFAULTS = {
  sourceKind: "txt" as const,
  baseUrl: "http://127.0.0.1:11434/v1",
  scopeMode: "full" as const,
  contextWindow: 32_768,
  maxTokens: 8_192,
  temperature: 0.3
};

function required(
  values: Record<string, string | boolean>,
  name: string
): string {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option: --${name}`);
  }
  return value.trim();
}

function numberOption(
  values: Record<string, string | boolean>,
  name: string,
  fallback: number
): number {
  const value = values[name];
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid --${name} value.`);
  return number;
}

export function usage(): string {
  return [
    "deepwrite-book-analysis run --source <path> --workspace <path> --model <ollama-model-id>",
    "deepwrite-book-analysis run --workspace <path> --model <ollama-model-id> --resume",
    "Options: --source-kind txt|directory --base-url <url> --scope opening|sampled|full",
    "         --style-full-text --context-window <tokens> --max-tokens <tokens>",
    "         --temperature 0..2 --archive <path>"
  ].join("\n");
}

export function parseOptions(argv: readonly string[]): RunnerOptions {
  if (argv[0] !== "run") throw new Error(usage());
  const values: Record<string, string | boolean> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--"))
      throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (["resume", "style-full-text"].includes(name)) {
      values[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for --${name}`);
    values[name] = value;
    index += 1;
  }
  const resume = values.resume === true;
  const scope = (values.scope as string | undefined) ?? DEFAULTS.scopeMode;
  if (!["opening", "sampled", "full"].includes(scope)) {
    throw new Error("--scope must be opening, sampled, or full.");
  }
  const sourceKind =
    (values["source-kind"] as string | undefined) ?? DEFAULTS.sourceKind;
  if (sourceKind !== "txt" && sourceKind !== "directory") {
    throw new Error("--source-kind must be txt or directory.");
  }
  const workspace = resolve(required(values, "workspace"));
  const source = values.source ? resolve(String(values.source)) : undefined;
  if (!resume && !source)
    throw new Error("--source is required unless --resume is used.");
  return {
    ...(source ? { source } : {}),
    sourceKind,
    workspace,
    modelId: required(values, "model"),
    baseUrl: (
      (values["base-url"] as string | undefined) ?? DEFAULTS.baseUrl
    ).replace(/\/$/, ""),
    scopeMode: scope as LongBookAnalysisScopeMode,
    styleFullText: values["style-full-text"] === true,
    contextWindow: numberOption(
      values,
      "context-window",
      DEFAULTS.contextWindow
    ),
    maxTokens: numberOption(values, "max-tokens", DEFAULTS.maxTokens),
    temperature: numberOption(values, "temperature", DEFAULTS.temperature),
    ...(values.archive ? { archive: resolve(String(values.archive)) } : {}),
    resume
  };
}
