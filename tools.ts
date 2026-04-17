import fs from "node:fs/promises";
import path from "node:path";

const MAX_READ_BYTES = 12_000;

export type ToolContext = {
  workspaceRoot: string;
  extraPaths: string[];
};

export type ReadResult = {
  ok: boolean;
  path: string;
  truncated: boolean;
  bytesRead: number;
  maxBytes: number;
  content?: string;
  error?: string;
};

function isWithinAllowedRoots(targetPath: string, allowedRoots: string[]) {
  for (const root of allowedRoots) {
    const relative = path.relative(root, targetPath);
    if (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    ) {
      return true;
    }
  }

  return false;
}

function looksLikeText(buffer: Buffer) {
  return !buffer.includes(0);
}

export async function read(
  context: ToolContext,
  filePath: string,
  maxReadBytes?: number,
): Promise<ReadResult> {
  const effectiveMaxReadBytes = maxReadBytes ?? MAX_READ_BYTES;
  const resolvedPath = path.resolve(context.workspaceRoot, filePath);
  const allowedRoots = [context.workspaceRoot, ...context.extraPaths];

  if (!isWithinAllowedRoots(resolvedPath, allowedRoots)) {
    return {
      ok: false,
      path: resolvedPath,
      truncated: false,
      bytesRead: 0,
      maxBytes: effectiveMaxReadBytes,
      error: "Path is outside the allowed roots.",
    };
  }

  let handle: fs.FileHandle | undefined;

  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      return {
        ok: false,
        path: resolvedPath,
        truncated: false,
        bytesRead: 0,
        maxBytes: effectiveMaxReadBytes,
        error: "Path is not a file.",
      };
    }

    handle = await fs.open(resolvedPath, "r");
    const buffer = Buffer.alloc(effectiveMaxReadBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, bytesRead);

    if (!looksLikeText(slice)) {
      return {
        ok: false,
        path: resolvedPath,
        truncated: false,
        bytesRead,
        maxBytes: effectiveMaxReadBytes,
        error: "File does not look like text.",
      };
    }

    const truncated = bytesRead > effectiveMaxReadBytes;
    const contentBytes = truncated
      ? slice.subarray(0, effectiveMaxReadBytes)
      : slice;

    return {
      ok: true,
      path: resolvedPath,
      truncated,
      bytesRead: contentBytes.length,
      maxBytes: effectiveMaxReadBytes,
      content: contentBytes.toString("utf8"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      path: resolvedPath,
      truncated: false,
      bytesRead: 0,
      maxBytes: effectiveMaxReadBytes,
      error: message,
    };
  } finally {
    await handle?.close();
  }
}
