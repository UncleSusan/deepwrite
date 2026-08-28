import type { DeepWriteApi, WorkspaceType } from "@deepwrite/contracts";

export async function loadWritingContextForPrompt(
  catalog: DeepWriteApi["catalog"],
  bookId: string,
  workspaceType: WorkspaceType,
  warn?: (message: string) => void
): Promise<string | undefined> {
  const label = workspaceType === "script" ? "剧本" : "短篇";
  try {
    const result = await catalog.readWritingContext({ bookId });
    if (result.truncated) {
      warn?.(`${label}上下文过长，本轮只注入了截断后的 AGENTS.md。`);
    }
    return result.content;
  } catch (error: unknown) {
    warn?.(
      error instanceof Error
        ? `${label}上下文未注入：${error.message}`
        : `${label}上下文未注入，本轮仍会发送。`
    );
    return undefined;
  }
}
