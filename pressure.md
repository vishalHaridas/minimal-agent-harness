## CURRENT

- Pressure point: session/event ordering is now the core correctness boundary. If sequence numbers or state transitions drift, debugging becomes harder than the current CLI loop.
- Pressure point: one-session-only keeps the rewrite small, but it also means every future multi-session feature will cross a real boundary later.
- Pressure point: queued input while running is simple, but it creates a clear fan-in point. Snapshot state must make queue contents and runner status obvious.
- Pressure point: full payload event logging is good for debugging, but it increases the chance of noisy output and duplicated large content between snapshot state and emitted events.
- Pressure point: tool failures now stay inside the loop by design. That improves resilience, but it can create long unproductive turns if the model keeps retrying badly.
- Pressure point: external provider limits are still on the hot path. A server shape does not remove rate limiting; it just makes it a session runtime concern instead of a CLI concern.

## RECENT

- User chose volatile in-memory state, automatic start on input, queued inputs, session-scoped subscriptions, and snapshot inspection. These choices keep V1 explicit but intentionally postpone durability and transport concerns.

## ARCHIVE
