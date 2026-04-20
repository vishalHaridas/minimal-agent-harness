import path from "node:path";
import readline from "node:readline/promises";
import {
  OpenRouterRequestError,
} from "./openrouter";
import { SessionManager } from "./session-manager";
import { logToolResult } from "./session-runner";
import { exec, read, write } from "./tools/index";

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

  await session.runInteractiveSession();
}

try {
  await main();
} catch (error) {
  fail(formatTopLevelError(error));
}
