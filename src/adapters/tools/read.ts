import { type ReadResult, type ToolContext, readFileResult } from "./shared";

export type { ReadResult, ToolContext };

export async function read(
  context: ToolContext,
  filePath: string,
  maxReadBytes?: number,
): Promise<ReadResult> {
  return readFileResult(context, filePath, maxReadBytes);
}
