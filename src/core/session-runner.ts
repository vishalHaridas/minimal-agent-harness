import {
  callOpenRouter,
  summarizeChoices,
  type OpenRouterMessage,
  type OpenRouterToolDefinition,
} from "../adapters/llm/openrouter";
import type { Session, SessionEvent, StepOutcome } from "../shared/session";

export const SYSTEM_PROMPT =
  "You are a local agent working inside the allowed workspace roots. You have access to a few tools";

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

export function parseToolArguments(toolCall: {
  function: { name: string; arguments: string };
}) {
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

export async function runAgentStep(
  session: Session,
  emit: (type: SessionEvent["type"], payload: unknown) => void,
): Promise<StepOutcome> {
  const iteration = 1;

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
    return {
      type: "completed",
      iterationOffset: session.iterationOffset + iteration,
    };
  }

  const absoluteIteration = session.iterationOffset + iteration;
  const toolRequests = toolCalls.map((toolCall) => ({
    iteration: absoluteIteration,
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    arguments: parseToolArguments(toolCall),
  }));

  // This is the step boundary: after one model response, core either has a
  // final assistant message or a batch of tool requests for the client to run.
  session.pendingToolCalls = toolCalls.map((toolCall) => ({
    iteration: absoluteIteration,
    toolCall,
    resolved: false,
  }));

  return {
    type: "waiting_for_tool",
    iterationOffset: absoluteIteration,
    toolRequests,
  };
}
