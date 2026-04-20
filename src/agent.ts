import path from "node:path";
import readline from "node:readline/promises";
import { OpenRouterRequestError } from "./openrouter";
import {
  SessionManager,
  type SessionEvent,
  type SessionSubscriber,
} from "./session-manager";
import { exec, read, write } from "./tools/index";
import type { ExecResult, ReadResult, WriteResult } from "./tools/index";

type CliConfig = {
  workspaceRoot: string | null;
  extraPaths: string[];
  prompt: string;
  debugExecCommand: string | null;
  debugExecTimeoutMs: number;
  debugReadPath: string | null;
  debugWritePath: string | null;
  debugWriteContent: string | null;
  model: string;
  hasApiKey: boolean;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
  throw new Error(message);
}

function formatTopLevelError(error: unknown) {
  if (error instanceof OpenRouterRequestError) {
    if (error.status === 429) {
      const detail = error.providerMessage
        ? error.providerMessage
        : "Rate limit reached. Retry shortly.";
      return `OpenRouter rate limit (429). ${detail}`;
    }

    const detail = error.providerMessage ? ` ${error.providerMessage}` : "";
    return `OpenRouter request failed (${error.status}).${detail}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function promptForWorkspaceRoot(): Promise<string> {
  // Keep the fallback explicit: if --cwd is missing, ask once on stdin.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await rl.question("Which directory should I work on? ")).trim();
  } finally {
    rl.close();
  }
}

function parseArgs(argv: string[]): CliConfig {
  let workspaceRoot = "";
  const extraPaths: string[] = [];
  let debugExecCommand: string | null = null;
  let debugExecTimeoutMs = 30_000;
  let debugReadPath: string | null = null;
  let debugWritePath: string | null = null;
  let debugWriteContent: string | null = null;
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--cwd") {
      workspaceRoot = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--allow") {
      const value = argv[index + 1] ?? "";
      if (value) {
        extraPaths.push(value);
      }
      index += 1;
      continue;
    }

    if (arg === "--read") {
      debugReadPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--exec") {
      debugExecCommand = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value < 1) {
        fail("Invalid --timeout-ms value.");
      }
      debugExecTimeoutMs = value;
      index += 1;
      continue;
    }

    if (arg === "--write") {
      debugWritePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--content") {
      debugWriteContent = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    promptParts.push(arg);
  }

  if (debugWritePath && debugWriteContent === null) {
    fail("Missing required --content for --write.");
  }

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
  const apiKey = process.env.OPENROUTER_API_KEY || "";

  return {
    workspaceRoot: workspaceRoot ? path.resolve(workspaceRoot) : null,
    extraPaths: extraPaths.map((value) => path.resolve(value)),
    prompt: promptParts.join(" "),
    debugExecCommand,
    debugExecTimeoutMs,
    debugReadPath,
    debugWritePath,
    debugWriteContent,
    model,
    hasApiKey: apiKey.length > 0,
  };
}

function printTrace(config: CliConfig) {
  console.log(`[harness] cwd=${config.workspaceRoot} model=${config.model}`);
  console.log("");
}

function quoteInline(value: string) {
  return JSON.stringify(value);
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeExecOutput(result: ExecResult) {
  const output = result.stdout || result.stderr || result.error || "";
  const collapsed = collapseWhitespace(output);

  if (!collapsed) {
    return result.ok ? "no output" : "command failed";
  }

  const fileMatch = collapsed.match(/(\d+)\s+File\(s\).*?(\d+)\s+Dir\(s\)/i);

  if (fileMatch) {
    const fileLabel = Number(fileMatch[1]) === 1 ? "file" : "files";
    const dirLabel = Number(fileMatch[2]) === 1 ? "subdir" : "subdirs";
    return `${fileMatch[1]} ${fileLabel}, ${fileMatch[2]} ${dirLabel}`;
  }

  return collapsed;
}

function summarizeReadResult(result: ReadResult) {
  if (!result.ok) {
    return collapseWhitespace(result.error ?? "read failed");
  }

  const suffix = result.truncated ? ", truncated" : "";
  return `${result.bytesRead} bytes${suffix}`;
}

function summarizeWriteResult(
  result: WriteResult & { patchSummary?: unknown[] },
) {
  if (!result.ok) {
    return collapseWhitespace(result.error ?? "write failed");
  }

  const operationCount =
    result.details?.length ?? result.patchSummary?.length ?? 0;
  const label = operationCount === 1 ? "change" : "changes";
  return `${result.bytesWritten} bytes, ${operationCount} ${label}`;
}

function summarizeToolResult(toolName: string, result: unknown) {
  if (toolName === "exec") {
    return summarizeExecOutput(result as ExecResult);
  }

  if (toolName === "read") {
    return summarizeReadResult(result as ReadResult);
  }

  if (toolName === "write") {
    return summarizeWriteResult(
      result as WriteResult & { patchSummary?: unknown[] },
    );
  }

  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof result.error === "string"
  ) {
    return collapseWhitespace(result.error);
  }

  return collapseWhitespace(JSON.stringify(result));
}

function logToolResult(iteration: number, toolName: string, result: unknown) {
  const ok =
    result &&
    typeof result === "object" &&
    "ok" in result &&
    result.ok === true;
  const status = (ok ? "ok" : "error").padEnd(16, " ");
  const exitCode =
    result &&
    typeof result === "object" &&
    "exitCode" in result &&
    typeof result.exitCode === "number"
      ? `  exit=${result.exitCode}`
      : "";

  console.log(
    `t${iteration}  ${toolName.padEnd(10, " ")} ${status}${exitCode}  ${summarizeToolResult(toolName, result)}`,
  );
}

function createEventLogger(): SessionSubscriber {
  // The CLI now reconstructs the old trace entirely from the session event
  // stream. That makes the runtime emit facts and leaves formatting here.
  return (event: SessionEvent) => {
    if (event.type === "tool.called") {
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : null;
      const iteration =
        payload && typeof payload.iteration === "number" ? payload.iteration : 0;
      const toolName =
        payload && typeof payload.toolName === "string" ? payload.toolName : "";
      const args =
        payload && payload.arguments && typeof payload.arguments === "object"
          ? (payload.arguments as Record<string, unknown>)
          : {};
      const command =
        typeof args.command === "string" ? args.command : JSON.stringify(args);

      console.log("---");
      console.log(
        `t${iteration}  assistant  tool_call ${toolName}   ${quoteInline(command)}`,
      );
      return;
    }

    if (event.type === "tool.completed") {
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : null;
      const iteration =
        payload && typeof payload.iteration === "number" ? payload.iteration : 0;
      const toolName =
        payload && typeof payload.toolName === "string" ? payload.toolName : "";
      const result = payload ? payload.result : null;

      logToolResult(iteration, toolName, result);
      return;
    }

    if (event.type === "assistant.message") {
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : null;
      const content =
        payload && (typeof payload.content === "string" || payload.content === null)
          ? payload.content
          : null;
      const toolCalls =
        payload && Array.isArray(payload.toolCalls) ? payload.toolCalls : [];

      // A tool-producing assistant turn is already represented by tool events.
      // The plain message is the user-facing terminal point worth printing.
      if (toolCalls.length === 0) {
        console.log("---");
        console.log(content ?? "(no content)");
        console.log("---");
      }
    }
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const hasDebugAction = Boolean(
    config.debugExecCommand || config.debugReadPath || config.debugWritePath,
  );

  if (!config.workspaceRoot) {
    const promptedWorkspaceRoot = await promptForWorkspaceRoot();

    if (!promptedWorkspaceRoot) {
      fail(
        "Missing working directory. Pass --cwd or enter a directory at the prompt.",
      );
    }

    config.workspaceRoot = path.resolve(promptedWorkspaceRoot);
  }

  const workspaceRoot = config.workspaceRoot;
  printTrace(config);

  if (config.debugExecCommand) {
    const result = await exec(
      workspaceRoot,
      config.debugExecCommand,
      config.debugExecTimeoutMs,
    );
    logToolResult(0, "exec", result);
  }

  if (config.debugReadPath) {
    const result = await read(
      {
        workspaceRoot,
        extraPaths: config.extraPaths,
      },
      config.debugReadPath,
    );
    logToolResult(0, "read", result);
  }

  if (config.debugWritePath && config.debugWriteContent !== null) {
    const result = await write(
      {
        workspaceRoot,
        extraPaths: config.extraPaths,
      },
      config.debugWritePath,
      config.debugWriteContent,
    );
    logToolResult(0, "write", result);
  }

  if (!config.prompt && hasDebugAction) {
    return;
  }

  const session = new SessionManager({
    workspaceRoot,
    extraPaths: config.extraPaths,
    model: config.model,
    prompt: config.prompt,
  });
  const unsubscribe = session.subscribe(createEventLogger());

  try {
    await session.runInteractiveSession();
  } finally {
    unsubscribe();
  }
}

try {
  await main();
} catch (error) {
  fail(formatTopLevelError(error));
}
