## CURRENT

- The CLI now builds a short two-sentence `system` prompt plus the user prompt, sends both to OpenRouter, and advertises three local tools: `read`, `write`, and `exec`.
- The harness runs a bounded sequential agent loop: append the assistant message, execute any returned tool calls locally, append `tool` messages with JSON-stringified results, and repeat until the assistant returns without tool calls.
- The `write` tool now takes one model-facing input named `patch`. The harness validates that patch using the local apply-patch parser, derives the touched paths from the patch itself, and returns the parsed patch summary alongside the write result.
- `read`, `write`, and `exec` still use the existing local implementations and workspace-root restrictions; the new loop only changes how the model can request them.
- `--allow` behavior is unchanged: extra allowed roots are still opt-in flags only and are not prompted for interactively.

## RECENT

- Tightened the `write` tool contract from `filePath` plus patch content to a single `patch` string that matches the real apply-patch executor.

## ARCHIVE
