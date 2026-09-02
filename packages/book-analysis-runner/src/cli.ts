#!/usr/bin/env node
import { parseOptions, usage } from "./options";
import { runHeadlessBookAnalysis } from "./runner";

async function main(): Promise<void> {
  if (["--help", "-h", "help"].includes(process.argv[2] ?? "")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const archive = await runHeadlessBookAnalysis(
    parseOptions(process.argv.slice(2))
  );
  process.stdout.write(`${archive}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
