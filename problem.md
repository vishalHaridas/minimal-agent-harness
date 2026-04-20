## CURRENT

- Problem statement: Replace the CLI-centered agent harness with a small local server that owns agent sessions, emits session events, and can be embedded inside a monorepo as the LLM-configuration runtime.
- Scope boundaries: In scope for this phase are one process-local session manager, explicit event emission, a server API that starts/observes one volatile session, queued input handling, snapshot reads, and a debug-only CLI that talks to that server layer. Out of scope are distributed state, auth, multi-tenant isolation, retries, production persistence, resumability across restarts, and a broad plugin system.
- Minimal data model:
  - `session`: session id, status, config, timestamps, queued input state, and current turn state
  - `session_event`: append-only event with type, session id, sequence number, timestamp, and payload
  - `subscriber`: local listener attached to the single active session
  - `messages`: ordered chat history stored inside session state
  - `tool_call`: provider-emitted request containing tool name, call id, and JSON arguments
  - `tool_result`: local execution result serialized back into session state and emitted as an event
- Data flow:
  - client creates a session manager with model/tool/workspace configuration
  - client subscribes before execution so early events are not lost
  - caller submits input to that session
  - session manager appends a `session.input_added` event
  - runner executes the agent step loop for that session
  - each meaningful transition emits an event such as `session.started`, `llm.requested`, `llm.responded`, `tool.called`, `tool.completed`, `assistant.message`, `session.completed`, or `session.failed`
  - tool failures are appended into session history and emitted as events, then the LLM gets another turn
  - subscribers receive events live, can replay stored events on subscribe, and can also inspect the current session snapshot
- Lifecycle:
  - Create: session, initial config, and first input
  - Read: session state, event stream, provider response, and local tool state
  - Update: append messages, session status, and emitted events
  - Discard: process-local sessions at server shutdown
- First implementation target: establish explicit `clients`, `core`, `adapters`, and `shared` boundaries so the CLI stays a debug client and the runtime stops owning presentation concerns.

## RECENT

- The codebase now uses explicit boundaries: `src/clients` for the debug CLI, `src/core` for session runtime, `src/adapters` for OpenRouter and local tools, and `src/shared` for session contracts.
- Logging responsibility moved entirely to the client. The runtime now emits facts only, and the CLI reconstructs the trace by subscribing to session events.

## ARCHIVE
