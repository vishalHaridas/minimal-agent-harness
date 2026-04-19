import path from "node:path";
import readline from "node:readline/promises";
import {
  callOpenRouter,
  summarizeChoices,
  type OpenRouterMessage,
  type OpenRouterToolCall,
  type OpenRouterToolDefinition,
} from "./openrouter";
import { exec, read, summarizePatchScript, write } from "./tools/index";

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

const MAX_AGENT_ITERATIONS = 8;
const SYSTEM_PROMPT =
  "You are a local agent working inside the allowed workspace roots. Read files before patching them, send exact apply-patch text to the write tool, and never invent file contents, command output, or write results.";

const TOOL_DEFINITIONS: OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a text file inside the allowed workspace roots.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Path to the file, relative to the workspace root.",
          },
          maxReadBytes: {
            type: "number",
            description:
              "Optional maximum number of bytes to read from the file.",
          },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description:
        "Apply file edits inside the allowed workspace roots using one exact apply-patch script. Send only a single string field named patch. The patch must start with *** Begin Patch and end with *** End Patch, and every file change must be described inside that patch body using Add File, Update File, Delete File, and optional Move to directives.",
      parameters: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description:
              'A complete apply-patch script. For new files use "*** Add File: path". For edits use "*** Update File: path" followed by hunks with context lines prefixed by space and changes prefixed by + or -. For deletions use "*** Delete File: path".',
          },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec",
      description:
        "Run a shell command in the workspace root and capture stdout, stderr, and exit status.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute.",
          },
          timeoutMs: {
            type: "number",
            description: "Optional timeout in milliseconds.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
];

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
  console.log("minimal-agent-harness \n");
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

function parseToolArguments(toolCall: OpenRouterToolCall) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error(
      `Tool "${toolCall.function.name}" arguments were not valid JSON.`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Tool "${toolCall.function.name}" arguments must decode to an object.`,
    );
  }

  return parsed as Record<string, unknown>;
}

async function runToolCall(
  config: CliConfig,
  toolCall: OpenRouterToolCall,
): Promise<OpenRouterMessage> {
  const args = parseToolArguments(toolCall);
  const toolName = toolCall.function.name;
  const toolContext = {
    workspaceRoot: config.workspaceRoot!,
    extraPaths: config.extraPaths,
  };

  console.log("");
  console.log("tool call");
  console.log(
    JSON.stringify(
      {
        id: toolCall.id,
        name: toolName,
        arguments: args,
      },
      null,
      2,
    ),
  );

  let result: unknown;
  try {
    if (toolName === "read") {
      result = await read(
        toolContext,
        getRequiredString(args, "filePath", toolName),
        getOptionalPositiveNumber(args, "maxReadBytes"),
      );
    } else if (toolName === "write") {
      const patch = getRequiredString(args, "patch", toolName);
      const patchSummary = summarizePatchScript(patch);

      if (patchSummary.length === 0) {
        throw new Error('Tool "write" requires at least one patch operation.');
      }

      const writeResult = await write(
        toolContext,
        patchSummary[0].path,
        patch,
      );

      result = {
        ...writeResult,
        patchSummary,
      };
    } else if (toolName === "exec") {
      result = await exec(
        config.workspaceRoot!,
        getRequiredString(args, "command", toolName),
        getOptionalPositiveNumber(args, "timeoutMs"),
      );
    } else {
      result = {
        ok: false,
        error: `Unknown tool: ${toolName}`,
      };
    }
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  console.log("");
  console.log("tool result");
  console.log(JSON.stringify(result, null, 2));

  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result, null, 2),
  };
}

async function runAgentLoop(config: CliConfig) {
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: config.prompt,
    },
  ];

  for (let iteration = 1; iteration <= MAX_AGENT_ITERATIONS; iteration += 1) {
    console.log("");
    console.log(`agent iteration ${iteration}`);

    const response = await callOpenRouter({
      model: config.model,
      messages,
      tools: TOOL_DEFINITIONS,
    });
    const choice = response.choices?.[0];
    const assistantMessage = choice?.message;

    if (!assistantMessage) {
      fail("OpenRouter response did not include an assistant message.");
    }

    const nextAssistantMessage: OpenRouterMessage = {
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    };

    messages.push(nextAssistantMessage);

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      console.log("");
      console.log("assistant message");
      console.log(
        JSON.stringify(summarizeChoices(response)[0] ?? null, null, 2),
      );
      return;
    }

    for (const toolCall of toolCalls) {
      messages.push(await runToolCall(config, toolCall));
    }
  }

  fail(`Agent loop stopped after ${MAX_AGENT_ITERATIONS} iterations.`);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

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
    console.log("agent loop");
    await runAgentLoop(config);
  }
}

await main();
