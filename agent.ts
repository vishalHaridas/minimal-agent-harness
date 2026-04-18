import path from "node:path";
import { read, write } from "./tools/index";

type CliConfig = {
  workspaceRoot: string;
  extraPaths: string[];
  prompt: string;
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

function parseArgs(argv: string[]): CliConfig {
  let workspaceRoot = "";
  const extraPaths: string[] = [];
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

  if (!workspaceRoot) {
    fail("Missing required --cwd path.");
  }

  if (!debugReadPath && !debugWritePath && promptParts.length === 0) {
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
    workspaceRoot: path.resolve(workspaceRoot),
    extraPaths: extraPaths.map((value) => path.resolve(value)),
    prompt: promptParts.join(" "),
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
  console.log(`- debugReadPath: ${config.debugReadPath ?? "(none)"}`);
  console.log(`- debugWritePath: ${config.debugWritePath ?? "(none)"}`);
  console.log(`- debugWriteContent: ${config.debugWriteContent ?? "(none)"}`);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  printTrace(config);

  if (config.debugReadPath) {
    console.log("");
    console.log("read tool");
    const result = await read(
      {
        workspaceRoot: config.workspaceRoot,
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
        workspaceRoot: config.workspaceRoot,
        extraPaths: config.extraPaths,
      },
      config.debugWritePath,
      config.debugWriteContent,
    );
    console.log(JSON.stringify(result, null, 2));
  }
}

await main();
