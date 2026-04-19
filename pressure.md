## CURRENT

- Pressure point: the main boundary rule is still central. The harness has one primary workspace plus optional extra paths, and every tool call now depends on that enforcement being correct.
- Pressure point: the agent loop is fully sequential. Multiple tool calls in one assistant turn are executed one by one, which is simple now but will become a latency bottleneck as tool usage grows.
- Pressure point: the `write` tool contract is now cleaner for the model, but it still depends on the model producing valid patch hunks with enough context for unambiguous application.
- Pressure point: external provider limits are now on the hot path. A live verification run reached OpenRouter successfully but stopped on HTTP `429`, so rate limiting is currently an execution boundary.
- Pressure point: `read` still uses a simple text heuristic and truncation cap. That keeps the code explicit, but it will become a quality boundary once encodings and larger files show up.

## RECENT

- Tightened the `write` schema so it matches the patch executor; the remaining risk is model quality in generating valid hunks, not a schema mismatch.

## ARCHIVE
