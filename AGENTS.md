# AGENTS

## General Behavior

- Prioritize execution over discussion
- Keep solutions explicit, minimal, and easy to trace
- Avoid introducing abstractions unless strictly necessary
- Build in small, verifiable steps

---

## Project Memory (.md files)

When using project memory files (`problem.md`, `system.md`, `pressure.md`):

- Prefer reading the smallest useful section before expanding scope

- Read order:
  1. `## CURRENT`
  2. `## RECENT` (only if needed)
  3. `## ARCHIVE` (only if deeper history is required)

- Do NOT load entire files by default

- Entries may have IDs (e.g., P1, S2):
  - Use search/grep to find older references only when needed

- When updating:
  - Keep `## CURRENT` as the canonical summary
  - `## RECENT` = short delta only
  - Move older entries to `## ARCHIVE`
  - Avoid duplication across sections
