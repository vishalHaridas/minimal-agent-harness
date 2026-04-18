import fs from "node:fs/promises";
import path from "node:path";

export const MAX_READ_BYTES = 12_000;

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

export type WriteResult = {
  ok: boolean;
  path: string;
  bytesWritten: number;
  details?: PatchResult[];
  error?: string;
};

type PatchResult = {
  operation: "add" | "delete" | "update" | "move";
  path: string;
  bytesWritten: number;
};

type ParsedPatch =
  | {
      operation: "add";
      path: string;
      content: string;
    }
  | {
      operation: "delete";
      path: string;
    }
  | {
      operation: "update";
      path: string;
      moveTo?: string;
      hunks: ParsedHunk[];
    };

type ParsedHunkLine = {
  operation: " " | "+" | "-";
  value: string;
};

type ParsedHunk = {
  lines: ParsedHunkLine[];
};

export function isWithinAllowedRoots(
  targetPath: string,
  allowedRoots: string[],
) {
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

export function looksLikeText(buffer: Buffer) {
  return !buffer.includes(0);
}

function splitLines(value: string) {
  const newline = value.includes("\r\n") ? "\r\n" : "\n";
  const normalized = value.replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const body = hasTrailingNewline ? normalized.slice(0, -1) : normalized;

  return {
    lines: body ? body.split("\n") : [],
    newline,
    hasTrailingNewline,
  };
}

function joinLines(
  lines: string[],
  newline: string,
  hasTrailingNewline: boolean,
) {
  const body = lines.join(newline);
  return hasTrailingNewline ? `${body}${newline}` : body;
}

export function resolveAllowedPath(context: ToolContext, targetPath: string) {
  const resolvedPath = path.resolve(context.workspaceRoot, targetPath);
  const allowedRoots = [context.workspaceRoot, ...context.extraPaths];

  if (!isWithinAllowedRoots(resolvedPath, allowedRoots)) {
    throw new Error(`Path is outside the allowed roots: ${targetPath}`);
  }

  return resolvedPath;
}

function parsePatchScript(patchText: string): ParsedPatch[] {
  const normalized = patchText.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines.at(-1) === "") {
    lines.pop();
  }

  if (lines[0] !== "*** Begin Patch") {
    throw new Error('Patch must start with "*** Begin Patch".');
  }

  if (lines.at(-1) !== "*** End Patch") {
    throw new Error('Patch must end with "*** End Patch".');
  }

  const patches: ParsedPatch[] = [];
  let index = 1;

  const isMarker = (value: string) => value.startsWith("*** ");

  while (index < lines.length - 1) {
    const line = lines[index];

    if (line.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length);
      const contentLines: string[] = [];
      index += 1;

      while (index < lines.length - 1 && !isMarker(lines[index])) {
        const contentLine = lines[index];
        if (!contentLine.startsWith("+")) {
          throw new Error(`Invalid add-file line for ${filePath}.`);
        }
        contentLines.push(contentLine.slice(1));
        index += 1;
      }

      patches.push({
        operation: "add",
        path: filePath,
        content: contentLines.join("\n"),
      });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      patches.push({
        operation: "delete",
        path: line.slice("*** Delete File: ".length),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const filePath = line.slice("*** Update File: ".length);
      let moveTo: string | undefined;
      const hunks: ParsedHunk[] = [];
      let hunkLines: ParsedHunkLine[] = [];
      index += 1;

      if (lines[index]?.startsWith("*** Move to: ")) {
        moveTo = lines[index].slice("*** Move to: ".length);
        index += 1;
      }

      while (index < lines.length - 1 && !isMarker(lines[index])) {
        const hunkLine = lines[index];

        if (hunkLine.startsWith("@@")) {
          if (hunkLines.length > 0) {
            hunks.push({ lines: hunkLines });
            hunkLines = [];
          }
          index += 1;
          continue;
        }

        const prefix = hunkLine[0];
        if (prefix !== " " && prefix !== "+" && prefix !== "-") {
          throw new Error(`Invalid hunk line for ${filePath}.`);
        }

        hunkLines.push({
          operation: prefix,
          value: hunkLine.slice(1),
        });
        index += 1;
      }

      if (hunkLines.length > 0) {
        hunks.push({ lines: hunkLines });
      }

      if (hunks.length === 0) {
        throw new Error(`Update for ${filePath} does not contain any hunks.`);
      }

      patches.push({
        operation: "update",
        path: filePath,
        moveTo,
        hunks,
      });
      continue;
    }

    throw new Error(`Unknown patch directive: ${line}`);
  }

  return patches;
}

function findMatch(lines: string[], target: string[]) {
  if (target.length === 0) {
    throw new Error("Hunk is missing old lines to match against.");
  }

  const matches: number[] = [];

  for (let index = 0; index <= lines.length - target.length; index += 1) {
    let matched = true;

    for (let offset = 0; offset < target.length; offset += 1) {
      if (lines[index + offset] !== target[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      matches.push(index);
    }
  }

  if (matches.length === 0) {
    throw new Error(
      "Hunk failed to apply because the expected context was not found.",
    );
  }

  if (matches.length > 1) {
    throw new Error("Hunk failed to apply because the context is ambiguous.");
  }

  return matches[0];
}

export function applyHunks(fileText: string, hunks: ParsedHunk[]) {
  const {
    lines: originalLines,
    newline,
    hasTrailingNewline,
  } = splitLines(fileText);
  let lines = originalLines;

  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((line) => line.operation !== "+")
      .map((line) => line.value);
    const newLines = hunk.lines
      .filter((line) => line.operation !== "-")
      .map((line) => line.value);
    const location = findMatch(lines, oldLines);

    lines = [
      ...lines.slice(0, location),
      ...newLines,
      ...lines.slice(location + oldLines.length),
    ];
  }

  return joinLines(lines, newline, hasTrailingNewline);
}

export async function readFileResult(
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

export async function writeFileResult(
  context: ToolContext,
  filePath: string,
  content: string,
): Promise<WriteResult> {
  const resolvedPath = path.resolve(context.workspaceRoot, filePath);

  try {
    const patches = parsePatchScript(content);
    const details: PatchResult[] = [];
    let totalBytesWritten = 0;

    for (const patch of patches) {
      if (patch.operation === "add") {
        const targetPath = resolveAllowedPath(context, patch.path);
        const existingStats = await fs.stat(targetPath).catch((error) => {
          const isMissingFile =
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT";

          if (isMissingFile) {
            return null;
          }

          throw error;
        });

        if (existingStats) {
          throw new Error(`File already exists: ${patch.path}`);
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, patch.content, "utf8");
        const bytesWritten = Buffer.byteLength(patch.content, "utf8");
        details.push({
          operation: "add",
          path: targetPath,
          bytesWritten,
        });
        totalBytesWritten += bytesWritten;
        continue;
      }

      if (patch.operation === "delete") {
        const targetPath = resolveAllowedPath(context, patch.path);
        const stats = await fs.stat(targetPath).catch((error) => {
          const isMissingFile =
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT";

          if (isMissingFile) {
            return null;
          }

          throw error;
        });

        if (!stats) {
          throw new Error(`File not found: ${patch.path}`);
        }

        await fs.unlink(targetPath);
        details.push({
          operation: "delete",
          path: targetPath,
          bytesWritten: 0,
        });
        continue;
      }

      const sourcePath = resolveAllowedPath(context, patch.path);
      const nextPath = patch.moveTo
        ? resolveAllowedPath(context, patch.moveTo)
        : sourcePath;
      const existingTarget = await fs.stat(nextPath).catch((error) => {
        const isMissingFile =
          error instanceof Error && "code" in error && error.code === "ENOENT";

        if (isMissingFile) {
          return null;
        }

        throw error;
      });

      if (patch.moveTo && nextPath !== sourcePath && existingTarget) {
        throw new Error(`Destination already exists: ${patch.moveTo}`);
      }

      const oldText = await fs.readFile(sourcePath, "utf8").catch((error) => {
        const isMissingFile =
          error instanceof Error && "code" in error && error.code === "ENOENT";

        if (isMissingFile) {
          throw new Error(`File not found: ${patch.path}`);
        }

        throw error;
      });
      const newText = applyHunks(oldText, patch.hunks);

      await fs.mkdir(path.dirname(nextPath), { recursive: true });
      await fs.writeFile(nextPath, newText, "utf8");
      if (patch.moveTo && nextPath !== sourcePath) {
        await fs.unlink(sourcePath);
      }

      const bytesWritten = Buffer.byteLength(newText, "utf8");
      details.push({
        operation: patch.moveTo ? "move" : "update",
        path: nextPath,
        bytesWritten,
      });
      totalBytesWritten += bytesWritten;
    }

    return {
      ok: true,
      path: resolvedPath,
      bytesWritten: totalBytesWritten,
      details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      path: resolvedPath,
      bytesWritten: 0,
      error: message,
    };
  }
}
