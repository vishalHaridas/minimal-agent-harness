## CURRENT

- Pressure point: session/event ordering is now the core correctness boundary. If sequence numbers or state transitions drift, debugging becomes harder than the current CLI loop.
- Pressure point: one-session-only keeps the rewrite small, but it also means every future multi-session feature will cross a real boundary later.
- Pressure point: queued input while running is simple, but it creates a clear fan-in point. Snapshot state must make queue contents and runner status obvious.
- Pressure point: full payload event logging is good for debugging, but it increases the chance of noisy output and duplicated large content between snapshot state and emitted events.
- Pressure point: event replay on subscribe is now part of the observable contract. If replay order or payload shape drifts from live delivery, the CLI and future transports will diverge.
- Pressure point: the new `clients/core/adapters/shared` split is clearer, but `src/shared/session.ts` can become a dumping ground if unrelated cross-boundary types start accumulating there.
- Pressure point: tool failures now stay inside the loop by design. That improves resilience, but it can create long unproductive turns if the model keeps retrying badly.
- Pressure point: external provider limits are still on the hot path. A server shape does not remove rate limiting; it just makes it a session runtime concern instead of a CLI concern.
- Pressure point: multi-tool turns now depend on the pending list and CLI queue staying in the same order. If either side changes ordering, provider history can become invalid.
- Pressure point: the CLI executor is triggered from an event subscriber. That keeps the boundary visible, but future transports will need an explicit request/submit API instead of relying on in-process callback timing.
- Pressure point: turn ownership is now clearer, but `submitToolResult()` still triggers continuation after the final pending tool result. That is intentional for the in-process prototype, but a future transport may need an explicit scheduler instead.
- Pressure point: turn completion is represented by a process-local promise. That is simple for the CLI, but it will not survive restarts or distributed execution.

## RECENT

- Logging moved out of the runtime and into the CLI subscriber. That separation is correct, but it means event payloads are now the real presentation contract for every future client.
- Tool execution moved out of the runner and into the CLI. Multi-tool assistant turns now run sequentially through a client queue before the model resumes.
- Control-flow rewrite completed: the runner is now one model step, and the manager uses explicit turn completion instead of polling `waiting_for_tool`.
- Transition cleanup completed: tool request events now fire after the manager has applied the waiting status, reducing callback timing risk in the in-process CLI.

## ARCHIVE
