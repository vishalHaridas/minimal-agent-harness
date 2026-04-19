export type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenRouterToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
};

export type OpenRouterChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
      reasoning_details?: unknown[];
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type CallOpenRouterInput = {
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterToolDefinition[];
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function summarizeChoices(response: OpenRouterChatCompletionResponse) {
  return (response.choices ?? []).map((choice) => ({
    finishReason: choice.finish_reason ?? null,
    reasoning: choice.message?.reasoning ?? null,
    content: choice.message?.content ?? null,
    toolCalls: choice.message?.tool_calls ?? [],
  }));
}

export async function callOpenRouter(
  input: CallOpenRouterInput,
): Promise<OpenRouterChatCompletionResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY || "";

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY.");
  }

  // Keep the request body explicit so Phase 1 shows the raw provider contract.
  const requestBody = {
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    stream: false,
  };

  console.log("");
  console.log("openrouter request");
  console.log(`- url: ${OPENROUTER_URL}`);
  console.log(`- model: ${input.model}`);
  console.log(stringifyJson(requestBody));

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  // Read the body once, then log only the fields that matter for inspection.
  const responseText = await response.text();

  let parsedBody: OpenRouterChatCompletionResponse;

  try {
    parsedBody = JSON.parse(responseText) as OpenRouterChatCompletionResponse;
  } catch {
    throw new Error(
      `OpenRouter returned a non-JSON response: ${responseText.slice(0, 500)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed with status ${response.status}: ${responseText.slice(0, 500)}`,
    );
  }

  console.log("");
  console.log("openrouter response");
  console.log(`- status: ${response.status} ${response.statusText}`);
  console.log(
    stringifyJson({
      choices: summarizeChoices(parsedBody),
    }),
  );

  return parsedBody;
}
