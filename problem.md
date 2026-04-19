## CURRENT

- Problem statement: Build the first ugly-prototype provider step for the minimal CLI harness: a raw OpenRouter chat completion call that is easy to trace, debug, and verify before adding the tool loop.
- Scope boundaries: In scope for this phase is a single OpenRouter request path, minimal message input, raw response output, and explicit debug logging so the API call can be tested end-to-end. Out of scope for this phase are tool execution, the agent loop, streaming, retries, abstractions, provider fallbacks, and production cleanup.
- Minimal data model:
  - `provider_input`: `model` plus ordered `messages`
  - `provider_request`: raw JSON body sent to OpenRouter
  - `provider_response`: raw parsed JSON returned by OpenRouter
  - `provider_trace`: debug output showing request body, HTTP status, and response body
- Data flow:
  - CLI or harness builds `messages`
  - `openrouter.ts` sends `model + messages` to OpenRouter chat completions
  - provider returns parsed JSON with minimal reshaping
  - harness prints trace output so the request/response can be inspected directly
- Lifecycle:
  - Create: request body, response body, trace lines
  - Read: env vars for API key/model and HTTP response body
  - Update: none beyond in-memory variables for a single request
  - Discard: all provider state at process exit
- First implementation target: one `openrouter.ts` entry point plus minimal `agent.ts` wiring that can send a prompt to OpenRouter and let the developer verify the integration by inspecting the exact request/response path.

## RECENT

- Initial project definition based on user choices: OpenRouter, minimal local tools, Node + TypeScript executed with Bun.

## ARCHIVE
