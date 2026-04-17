## CURRENT

- Problem statement: Build a minimal CLI coding-agent harness in TypeScript, run with Bun, that calls OpenRouter for model responses and can use a tiny set of local tools.
- Scope boundaries: In scope for the first implementation is a single-process CLI, one agent loop, OpenRouter chat completion calls, and three tools only: `read`, `write`, and `bash`. Out of scope are memory systems, multi-agent orchestration, approval flows, streaming UX polish, sandboxing, retries, resumability, and production architecture.
- Minimal data model:
  - `user_input`: raw prompt text from the CLI
  - `message_history`: ordered chat messages sent to and received from the model
  - `tool_call`: requested tool name plus JSON arguments from the model
  - `tool_result`: stdout/stderr or file contents returned back into the loop
  - `run_state`: current turn status until the agent exits with a final text answer
- Data flow:
  - CLI reads prompt
  - harness sends prompt plus tool schemas to OpenRouter
  - model either returns text or asks for a tool
  - harness executes the tool locally and appends the result
  - loop repeats until final text is returned
- Lifecycle:
  - Create: `user_input`, assistant messages, tool calls, tool results
  - Read: local files through `read`, subprocess output through `bash`
  - Update: `message_history`, files through `write`
  - Discard: in-memory run state at process exit
- First implementation target: one runnable file plus minimal config that supports `bun run agent.ts "your prompt"` and visibly traces the request -> tool call -> tool result -> final answer path.

## RECENT

- Initial project definition based on user choices: OpenRouter, minimal local tools, Node + TypeScript executed with Bun.

## ARCHIVE
