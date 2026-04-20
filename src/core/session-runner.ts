import {
  callOpenRouter,
  summarizeChoices,
  type OpenRouterMessage,
  type OpenRouterToolCall,
  type OpenRouterToolDefinition,
} from "../adapters/llm/openrouter";
import { exec, read, summarizePatchScript, write } from "../adapters/tools";
import type { Session, SessionEvent } from "../shared/session";

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
  session: Session,
  iteration: number,
  toolCall: OpenRouterToolCall,
  emit: (type: SessionEvent["type"], payload: unknown) => void,
): Promise<OpenRouterMessage> {
  const args = parseToolArguments(toolCall);
  const toolName = toolCall.function.name;
  const toolContext = {
    workspaceRoot: session.config.workspaceRoot,
    extraPaths: session.config.extraPaths,
  };
  emit("tool.called", {
    iteration,
    toolCallId: toolCall.id,
    toolName,
    arguments: args,
  });

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
        session.config.workspaceRoot,
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

  emit("tool.completed", {
    iteration,
    toolCallId: toolCall.id,
    toolName,
    result,
  });

  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result, null, 2),
  };
}

export async function runAgentLoop(
  session: Session,
  emit: (type: SessionEvent["type"], payload: unknown) => void,
) {
  let iteration = 1;
  while (true) {
    emit("llm.requested", {
      iteration: session.iterationOffset + iteration,
      messageCount: session.messages.length,
      messages: session.messages,
      model: session.config.model,
    });
    const response = await callOpenRouter({
      model: session.config.model,
      messages: session.messages,
      tools: TOOL_DEFINITIONS,
    });
    const choice = response.choices?.[0];
    const assistantMessage = choice?.message;
    emit("llm.responded", {
      iteration: session.iterationOffset + iteration,
      summary: summarizeChoices(response)[0] ?? null,
    });

    if (!assistantMessage) {
      throw new Error(
        "OpenRouter response did not include an assistant message.",
      );
    }

    const nextAssistantMessage: OpenRouterMessage = {
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    };

    session.messages.push(nextAssistantMessage);
    emit("assistant.message", {
      iteration: session.iterationOffset + iteration,
      content: nextAssistantMessage.content,
      toolCalls: nextAssistantMessage.tool_calls ?? [],
    });

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return session.iterationOffset + iteration;
    }

    for (const toolCall of toolCalls) {
      session.messages.push(
        await runToolCall(
          session,
          session.iterationOffset + iteration,
          toolCall,
          emit,
        ),
      );
    }

    iteration += 1;
  }
}
