## CURRENT

- The codebase now has explicit top-level boundaries: `src/clients`, `src/core`, `src/adapters`, and `src/shared`.
- `src/core/session-manager.ts` owns one in-memory volatile session, event storage, event replay on subscribe, snapshot generation, and the interactive session loop.
- `src/core/session-runner.ts` owns one model step through `runAgentStep()` and returns a `StepOutcome` after emitting runtime facts for LLM requests, LLM responses, and assistant messages.
- Tool execution is now split at an explicit boundary: `session-runner` returns pending tool request payloads, `SessionManager` transitions to `waiting_for_tool` and emits `tool.requested`, then the CLI executes local tools and submits results through `SessionManager.submitToolResult()`.
- `SessionManager` owns the pending tool list, validates that submitted results arrive in model order, appends provider-shaped tool messages, and resumes the LLM loop only after all tool calls from the assistant turn are complete.
- `src/adapters/llm/openrouter.ts` is the provider boundary and `src/adapters/tools/*` is the local capability boundary.
- `src/shared/session.ts` holds the session-facing contracts so the core files do not import each other in circles.
- Logging no longer happens inside the runtime. `src/clients/agent.ts` subscribes to session events and reconstructs the console trace from emitted payloads.
- `getSnapshot()` returns a compact session summary for inspection rather than exposing the mutable session object directly.
- Tool failures are still data when they happen inside the client executor: the failed result is submitted, appended into session history, emitted, and then the LLM gets another turn.
- Multiple tool calls from one assistant turn still run sequentially. The manager emits all requests from the `StepOutcome`, the CLI queues execution in event order, and the manager resumes the model only after the pending list is empty.
- `SessionManager.runModelStep()` is now the central turn driver. It calls one model step, completes the turn on a completed `StepOutcome`, or transitions to waiting before emitting tool requests.
- `runInteractiveSession()` starts a turn and waits on the turn-completion promise. It no longer polls `waiting_for_tool`.

## RECENT

- The subscriber phase completed: session events are stored in memory, replayed to late subscribers, and consumed by the CLI for logging.
- The structural rewrite phase completed: the flat `src/*.ts` layout was replaced by explicit client/core/adapter/shared boundaries.
- The first client-executed tool phase completed: local `read`, `write`, and `exec` calls moved out of the runner and into the CLI event handler.
- The control-flow rewrite phase completed: `runAgentLoop()` became `runAgentStep()`, the waiter loop was replaced by explicit turn completion, and the model step now returns `StepOutcome`.
- Transition cleanup completed: `SessionManager.runModelStep()` owns the waiting status transition before client-visible tool request events are emitted.

## ARCHIVE
