import { OpenRouterRequestError } from "../adapters/llm/openrouter";

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
  throw new Error(message);
}

export function formatTopLevelError(error: unknown) {
  if (error instanceof OpenRouterRequestError) {
    if (error.status === 429) {
      const detail = error.providerMessage
        ? error.providerMessage
        : "Rate limit reached. Retry shortly.";
      return `OpenRouter rate limit (429). ${detail}`;
    }

    const detail = error.providerMessage ? ` ${error.providerMessage}` : "";
    return `OpenRouter request failed (${error.status}).${detail}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
