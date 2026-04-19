## CURRENT

- The CLI now accepts a missing `--cwd` and pauses before trace output to ask for one working directory on stdin.
- The entered directory is trimmed, resolved to an absolute path, stored as the primary workspace root, and then reused by `exec`, `read`, `write`, and the LLM call flow.
- `--allow` behavior is unchanged: extra allowed roots are still opt-in flags only and are not prompted for interactively.

## RECENT

- Added a single interactive fallback so the harness can be launched without `--cwd`.

## ARCHIVE
