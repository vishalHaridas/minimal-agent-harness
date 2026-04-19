import { type ToolContext, type WriteResult, writeFileResult } from "./shared";

export type { ToolContext, WriteResult };

export async function write(
  context: ToolContext,
  filePath: string,
  content: string,
): Promise<WriteResult> {
  return writeFileResult(context, filePath, content);
}
