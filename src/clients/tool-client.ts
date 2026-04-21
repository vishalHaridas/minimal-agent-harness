import { exec, read, summarizePatchScript, write } from "../adapters/tools";
import type { SessionManager } from "../core/session-manager";
import type { CliConfig } from "./cli-config";

function getRequiredString(
  args: Record<string, unknown>,
  key: string,
  toolName: string,
) {
  const value = args[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Tool "${toolName}" requires a non-empty string "${key}".`);
  }

  return value;
}

function getOptionalPositiveNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`Optional field "${key}" must be a positive number.`);
  }

  return value;
}

async function runClientTool(
  config: CliConfig,
  toolName: string,
  args: Record<string, unknown>,
) {
  const workspaceRoot = config.workspaceRoot;

  if (!workspaceRoot) {
    throw new Error("Missing workspace root for tool execution.");
  }

  const toolContext = {
    workspaceRoot,
    extraPaths: config.extraPaths,
  };

  if (toolName === "read") {
    return read(
      toolContext,
      getRequiredString(args, "filePath", toolName),
      getOptionalPositiveNumber(args, "maxReadBytes"),
    );
  }

  if (toolName === "write") {
    const patch = getRequiredString(args, "patch", toolName);
    const patchSummary = summarizePatchScript(patch);

    if (patchSummary.length === 0) {
      throw new Error('Tool "write" requires at least one patch operation.');
    }

    const writeResult = await write(toolContext, patchSummary[0].path, patch);

    return {
      ...writeResult,
      patchSummary,
    };
  }

  if (toolName === "exec") {
    return exec(
      workspaceRoot,
      getRequiredString(args, "command", toolName),
      getOptionalPositiveNumber(args, "timeoutMs"),
    );
  }

  return {
    ok: false,
    error: `Unknown tool: ${toolName}`,
  };
}

export async function submitClientToolResult(
  config: CliConfig,
  session: SessionManager,
  payload: Record<string, unknown>,
) {
  const toolCallId =
    typeof payload.toolCallId === "string" ? payload.toolCallId : "";
  const toolName = typeof payload.toolName === "string" ? payload.toolName : "";
  const args =
    payload.arguments && typeof payload.arguments === "object"
      ? (payload.arguments as Record<string, unknown>)
      : {};

  let result: unknown;
  try {
    result = await runClientTool(config, toolName, args);
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // The CLI is intentionally the only tool executor in this phase. The core
  // accepts only the current pending id, so a stale or duplicate submit fails.
  await session.submitToolResult({
    toolCallId,
    result,
  });
}
