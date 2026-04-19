## CURRENT

- Pressure point: the main boundary rule is already visible. The harness needs one primary workspace plus optional extra paths, and every tool will need to enforce that consistently.
- Pressure point: prompting for `--cwd` improves CLI ergonomics, but it also introduces an interactive branch that will matter once non-interactive automation and test coverage expand.
- Pressure point: keeping the model "vanilla" reduces prompt complexity, but pushes more responsibility into the harness loop and tool schemas.
- Pressure point: `read` uses a simple text heuristic and truncation cap. That keeps the code explicit, but it will become a quality boundary once encodings and larger files show up.

## RECENT

- Added an interactive workspace-root fallback; this is simple now, but it is a future boundary for automation and scripted runs.
- Added the first tool pressure note: path boundary enforcement is simple, but text detection and truncation are obvious future breakpoints.

## ARCHIVE
