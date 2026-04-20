## CURRENT

- The codebase now has explicit top-level boundaries: `src/clients`, `src/core`, `src/adapters`, and `src/shared`.
- `src/core/session-manager.ts` owns one in-memory volatile session, event storage, event replay on subscribe, snapshot generation, and the interactive session loop.
- `src/core/session-runner.ts` owns the bounded agent loop and emits runtime facts for LLM requests, LLM responses, assistant messages, and tool calls/results.
- `src/adapters/llm/openrouter.ts` is the provider boundary and `src/adapters/tools/*` is the local capability boundary.
- `src/shared/session.ts` holds the session-facing contracts so the core files do not import each other in circles.
- Logging no longer happens inside the runtime. `src/clients/agent.ts` subscribes to session events and reconstructs the console trace from emitted payloads.
- `getSnapshot()` returns a compact session summary for inspection rather than exposing the mutable session object directly.
- Tool failures are still data, not fatal boundaries: the failed result is appended into session history, emitted, and then the LLM gets another turn.

## RECENT

- The subscriber phase completed: session events are stored in memory, replayed to late subscribers, and consumed by the CLI for logging.
- The structural rewrite phase completed: the flat `src/*.ts` layout was replaced by explicit client/core/adapter/shared boundaries.

## ARCHIVE
