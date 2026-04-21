import {
  callOpenRouter,
  summarizeChoices,
  type OpenRouterMessage,
  type OpenRouterToolDefinition,
} from "../adapters/llm/openrouter";
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

export async function runAgentLoop(
  session: Session,
  emit: (type: SessionEvent["type"], payload: unknown) => void,
) {
  const iteration = 1;
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

    const absoluteIteration = session.iterationOffset + iteration;

    // This is the new hard stop: core records every tool the model requested,
    // emits them in model order, then waits. The client owns side effects; core
    // owns the transcript and will not call the model again until every result
    // for this assistant turn has been appended.
    session.pendingToolCalls = toolCalls.map((toolCall) => ({
      iteration: absoluteIteration,
      toolCall,
      resolved: false,
    }));
    session.status = "waiting_for_tool";

    for (const toolCall of toolCalls) {
      const args = parseToolArguments(toolCall);

      emit("tool.requested", {
        iteration: absoluteIteration,
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: args,
      });
    }

    return absoluteIteration;
  }
}
