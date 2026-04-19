import path from "node:path";
import readline from "node:readline/promises";
import {
  callOpenRouter,
  summarizeChoices,
  type OpenRouterMessage,
} from "./openrouter";
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

  if (
    !debugExecCommand &&
    !debugReadPath &&
    !debugWritePath &&
    promptParts.length === 0
  ) {
    fail(
      'Missing prompt text. Example: bun run agent.ts --cwd . "summarize this folder"',
    );
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
  console.log("minimal-agent-harness");
  console.log("");
  console.log("trace");
  console.log(`- workspaceRoot: ${config.workspaceRoot}`);
  console.log(
    `- extraPaths: ${config.extraPaths.length === 0 ? "(none)" : config.extraPaths.join(", ")}`,
  );
  console.log(`- model: ${config.model}`);
  console.log(
    `- openrouterApiKey: ${config.hasApiKey ? "present" : "missing"}`,
  );
  console.log(`- prompt: ${config.prompt || "(none)"}`);
  console.log(`- debugExecCommand: ${config.debugExecCommand ?? "(none)"}`);
  console.log(`- debugExecTimeoutMs: ${config.debugExecTimeoutMs}`);
  console.log(`- debugReadPath: ${config.debugReadPath ?? "(none)"}`);
  console.log(`- debugWritePath: ${config.debugWritePath ?? "(none)"}`);
  console.log(`- debugWriteContent: ${config.debugWriteContent ?? "(none)"}`);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  if (!config.workspaceRoot) {
    const promptedWorkspaceRoot = await promptForWorkspaceRoot();

    if (!promptedWorkspaceRoot) {
      fail("Missing working directory. Pass --cwd or enter a directory at the prompt.");
    }

    config.workspaceRoot = path.resolve(promptedWorkspaceRoot);
  }

  const workspaceRoot = config.workspaceRoot;
  printTrace(config);

  if (config.debugExecCommand) {
    console.log("");
    console.log("exec tool");
    const result = await exec(
      workspaceRoot,
      config.debugExecCommand,
      config.debugExecTimeoutMs,
    );
    console.log(JSON.stringify(result, null, 2));
  }

  if (config.debugReadPath) {
    console.log("");
    console.log("read tool");
    const result = await read(
      {
        workspaceRoot,
        extraPaths: config.extraPaths,
      },
      config.debugReadPath,
    );
    console.log(JSON.stringify(result, null, 2));
  }

  if (config.debugWritePath && config.debugWriteContent !== null) {
    console.log("");
    console.log("write tool");
    const result = await write(
      {
        workspaceRoot,
        extraPaths: config.extraPaths,
      },
      config.debugWritePath,
      config.debugWriteContent,
    );
    console.log(JSON.stringify(result, null, 2));
  }

  if (config.prompt) {
    console.log("");
    console.log("llm call");

    // Phase 1 keeps the message history to one user message so the provider
    // request/response path is easy to inspect before the tool loop exists.
    const messages: OpenRouterMessage[] = [
      {
        role: "user",
        content: config.prompt,
      },
    ];

    const response = await callOpenRouter({
      model: config.model,
      messages,
    });

    console.log("");
    console.log("assistant message");
    console.log(JSON.stringify(summarizeChoices(response)[0] ?? null, null, 2));
  }
}

await main();
