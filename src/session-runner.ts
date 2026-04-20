import {
  callOpenRouter,
  summarizeChoices,
  type OpenRouterMessage,
  type OpenRouterToolCall,
  type OpenRouterToolDefinition,
} from "./openrouter";
import type { ExecResult, ReadResult, WriteResult } from "./tools/index";
import { exec, read, summarizePatchScript, write } from "./tools/index";

export type SessionRunnerConfig = {
  workspaceRoot: string;
  extraPaths: string[];
  model: string;
};

export const SYSTEM_PROMPT =
  "You are a local agent working inside the allowed workspace roots. Read files before patching them, send exact apply-patch text to the write tool, and never invent file contents, command output, or write results.";

export const TOOL_DEFINITIONS: OpenRouterToolDefinition[] = [
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

function logAssistantToolCall(iteration: number, toolCall: OpenRouterToolCall) {
  const args = parseToolArguments(toolCall);
  const command =
    typeof args.command === "string" ? args.command : JSON.stringify(args);

  console.log(
    `t${iteration}  assistant  tool_call ${toolCall.function.name}   ${quoteInline(command)}`,
  );
}

export function logToolResult(
  iteration: number,
  toolName: string,
  result: unknown,
) {
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

function logAssistantFinal(responseText: string | null) {
  console.log("---");
  console.log(responseText ?? "(no content)");
  console.log("---");
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
  config: SessionRunnerConfig,
  iteration: number,
  toolCall: OpenRouterToolCall,
): Promise<OpenRouterMessage> {
  const args = parseToolArguments(toolCall);
  const toolName = toolCall.function.name;
  const toolContext = {
    workspaceRoot: config.workspaceRoot,
    extraPaths: config.extraPaths,
  };
  console.log("---");
  logAssistantToolCall(iteration, toolCall);

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

      const writeResult = await write(toolContext, patchSummary[0].path, patch);

      result = {
        ...writeResult,
        patchSummary,
      };
    } else if (toolName === "exec") {
      result = await exec(
        config.workspaceRoot,
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

  logToolResult(iteration, toolName, result);

  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result, null, 2),
  };
}

export async function runAgentLoop(
  config: SessionRunnerConfig,
  messages: OpenRouterMessage[],
  iterationOffset = 0,
) {
  let iteration = 1;
  while (true) {
    const response = await callOpenRouter({
      model: config.model,
      messages,
      tools: TOOL_DEFINITIONS,
    });
    const choice = response.choices?.[0];
    const assistantMessage = choice?.message;

    if (!assistantMessage) {
      throw new Error("OpenRouter response did not include an assistant message.");
    }

    const nextAssistantMessage: OpenRouterMessage = {
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    };

    messages.push(nextAssistantMessage);

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      logAssistantFinal(summarizeChoices(response)[0]?.content ?? null);
      return iterationOffset + iteration;
    }

    for (const toolCall of toolCalls) {
      messages.push(
        await runToolCall(config, iterationOffset + iteration, toolCall),
      );
    }

    iteration += 1;
  }
}
