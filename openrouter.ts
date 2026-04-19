export type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
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
      tool_calls?: unknown[];
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
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

  // Read the raw body once, print it, then parse it with minimal reshaping.
  const responseText = await response.text();

  console.log("");
  console.log("openrouter response");
  console.log(`- status: ${response.status} ${response.statusText}`);
  console.log(responseText);

  let parsedBody: OpenRouterChatCompletionResponse;

  try {
    parsedBody = JSON.parse(responseText) as OpenRouterChatCompletionResponse;
  } catch {
    throw new Error("OpenRouter returned a non-JSON response.");
  }

  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed with status ${response.status}.`,
    );
  }

  return parsedBody;
}
