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

type OpenRouterErrorBody = {
  error?: {
    message?: string;
    code?: number | string;
    metadata?: {
      raw?: string;
      provider_name?: string;
      is_byok?: boolean;
    };
  };
};

export class OpenRouterRequestError extends Error {
  status: number;
  providerMessage: string | null;

  constructor(status: number, message: string, providerMessage?: string | null) {
    super(message);
    this.name = "OpenRouterRequestError";
    this.status = status;
    this.providerMessage = providerMessage ?? null;
  }
}

function getErrorBody(value: unknown): OpenRouterErrorBody | null {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return null;
  }

  return value as OpenRouterErrorBody;
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

  const requestBody = {
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    stream: false,
  };

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  let parsedBody: OpenRouterChatCompletionResponse | OpenRouterErrorBody;

  try {
    parsedBody = JSON.parse(responseText) as
      | OpenRouterChatCompletionResponse
      | OpenRouterErrorBody;
  } catch {
    throw new Error(
      `OpenRouter returned a non-JSON response: ${responseText.slice(0, 500)}`,
    );
  }

  if (!response.ok) {
    const errorBody = getErrorBody(parsedBody);
    const providerMessage =
      errorBody?.error?.metadata?.raw ??
      errorBody?.error?.message ??
      responseText.slice(0, 500);

    throw new OpenRouterRequestError(
      response.status,
      `OpenRouter request failed with status ${response.status}.`,
      providerMessage,
    );
  }

  return parsedBody as OpenRouterChatCompletionResponse;
}
