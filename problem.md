## CURRENT

- Problem statement: Replace the current one-shot LLM call with a minimal agent loop that can expose local tools to the model, execute requested tool calls, and continue until the model returns a final assistant message.
- Scope boundaries: In scope for this phase are OpenRouter tool-call request/response wiring, a small local tool registry for `read`, `write`, and `exec`, loop control in the CLI, and trace output that makes each step inspectable. Out of scope are streaming, retries, multi-turn chat UX, tool parallelism, approval flows, and new tools.
- Minimal data model:
  - `messages`: ordered chat history including `user`, `assistant`, and `tool` messages
  - `tool_definitions`: the JSON schemas advertised to the provider for `read`, `write`, and `exec`
  - `tool_call`: provider-emitted request containing tool name, call id, and JSON arguments
  - `tool_result`: local execution result serialized back into a `tool` message
  - `loop_state`: current iteration count and stop condition
- Data flow:
  - CLI parses args and resolves the workspace root
  - harness creates initial `messages` with the user prompt
  - provider receives `messages` plus `tool_definitions`
  - if the provider returns tool calls, the harness executes them locally and appends `tool` messages
  - harness calls the provider again with the expanded history
  - loop stops when the provider returns an assistant message without tool calls or a max-iteration guard is reached
- Lifecycle:
  - Create: initial messages, tool definitions, and loop state
  - Read: provider response, tool call arguments, and local filesystem/process state
  - Update: append assistant/tool messages and advance iteration count
  - Discard: process-local loop state at exit
- First implementation target: patch `openrouter.ts` and `agent.ts` to support one explicit tool-call loop using the existing `read`, `write`, and `exec` implementations without introducing new abstraction layers.

## RECENT

- Logging was reduced to show only `reasoning` and `content` from OpenRouter choices instead of the raw provider body.
- Initial project definition based on user choices: OpenRouter, minimal local tools, Node + TypeScript executed with Bun.

## ARCHIVE
