## CURRENT

- The new runtime center will be a single in-process `SessionManager` that owns one volatile session, not the CLI entrypoint.
- `submitInput()` will append the user message into session state, emit `session.input_added`, and automatically start the runner if the session is idle.
- While the runner is active, later inputs are appended and left queued; the session stays single-threaded and processes work sequentially.
- The `SessionRunner` will execute the current bounded agent loop against OpenRouter and the existing `read`, `write`, and `exec` tools, but all progress will be surfaced as emitted events instead of direct inline CLI tracing.
- `getSnapshot()` will return the current full session state for debug inspection.
- Subscribers are session-scoped only in V1 and receive full payloads for every emitted event.
- Tool failures are data, not fatal boundaries: the failed result is appended into session history, emitted, and then the LLM gets another turn.
- The CLI remains as a debug client only: create session, submit input, subscribe to events, and print snapshots/events to the console.

## RECENT

- Rewrite target changed from "CLI with loop" to "server-style session runtime with debug CLI client".

## ARCHIVE
