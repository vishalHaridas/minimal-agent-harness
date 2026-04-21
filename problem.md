## CURRENT

- Problem statement: Shift the harness so the core/server owns the agent state machine and event log, while exactly one client executes tool calls after receiving tool-request events and sends structured tool results back so the loop can continue.
- Scope boundaries: In scope for this phase are one process-local session manager, explicit pause/resume points around tool requests, a client/server contract for tool requests and tool results, snapshot reads, and a debug-only CLI that acts as the first tool executor. Out of scope are distributed workers, auth, multi-tenant isolation, retries, production persistence, resumability across restarts, and a broad plugin system.
- Minimal data model:
  - `session`: session id, status, config, timestamps, queued input state, and current turn state
  - `session_event`: append-only event with type, session id, sequence number, timestamp, and payload
  - `subscriber`: local listener attached to the single active session
  - `messages`: ordered chat history stored inside session state
  - `pending_tool_call`: provider-emitted request containing tool name, call id, JSON arguments, and resolution state
  - `tool_result_submission`: client-originated result containing tool call id, result payload, and optional execution metadata
- Data flow:
  - client creates a session manager with model/tool/workspace configuration
  - client subscribes before execution so early events are not lost
  - caller submits input to that session
  - session manager appends a `session.input_added` event
  - runner executes the agent step loop until the provider returns either a final assistant reply or one or more tool calls
  - each tool call is emitted as a `tool.requested` event and stored as pending work
  - a client executes the requested tool locally and sends a `tool_result_submission` back to the server
  - the session manager validates that submission, appends a `tool.completed` event, writes the tool message into history, and resumes the LLM loop
  - each meaningful transition emits an event such as `session.started`, `llm.requested`, `llm.responded`, `tool.requested`, `tool.completed`, `assistant.message`, `session.completed`, or `session.failed`
  - subscribers receive events live, can replay stored events on subscribe, and can also inspect the current session snapshot
- Lifecycle:
  - Create: session, initial config, and first input
  - Read: session state, event stream, provider response, and pending tool calls
  - Update: append messages, pending tool state, session status, and emitted events
  - Discard: process-local sessions at server shutdown
- First implementation target: carve a hard execution boundary between `tool.requested` and `tool.completed` so the current CLI becomes the single client-side tool worker without changing the rest of the turn loop yet.

## RECENT

- The codebase now uses explicit boundaries: `src/clients` for the debug CLI, `src/core` for session runtime, `src/adapters` for OpenRouter and local tools, and `src/shared` for session contracts.
- Logging responsibility moved entirely to the client. The runtime now emits facts only, and the CLI reconstructs the trace by subscribing to session events.

## ARCHIVE
