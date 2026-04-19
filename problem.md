## CURRENT

- Problem statement: Make the CLI easier to run by allowing `--cwd` to be omitted and prompting once for the working directory before the agent flow continues.
- Scope boundaries: In scope for this phase is a single stdin prompt fallback for the primary workspace root. Out of scope for this phase are prompts for extra allowed paths, prompt-history UX, validation beyond non-empty input, and broader loop redesign.
- Minimal data model:
  - `workspace_root`: primary directory the harness runs commands and path tools against
  - `cli_args`: optional `--cwd`, optional `--allow`, prompt text, and debug flags
  - `cwd_prompt`: one stdin question used only when `--cwd` is absent
- Data flow:
  - CLI parses args
  - if `--cwd` is present, resolve it immediately
  - if `--cwd` is absent, ask the user which directory to work on
  - harness continues with the resolved workspace root and existing tool/provider flow
- Lifecycle:
  - Create: resolved workspace root and one optional stdin answer
  - Read: CLI args and stdin text
  - Update: in-memory config before trace output begins
  - Discard: prompt interface and process-local config at exit
- First implementation target: patch `agent.ts` so the existing harness can prompt for the workspace root when `--cwd` is missing, without changing extra path handling.

## RECENT

- Logging was reduced to show only `reasoning` and `content` from OpenRouter choices instead of the raw provider body.
- Initial project definition based on user choices: OpenRouter, minimal local tools, Node + TypeScript executed with Bun.

## ARCHIVE
