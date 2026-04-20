# minimal-agent-harness

This is a small local agent harness built to better understand how these harnesses work.

It is intentionally minimal, but it already manages to do a lot:

- keep an interactive agent session running in the terminal
- send prompts to OpenRouter
- let the model call local tools
- read files
- apply patch-based writes
- run shell commands
- keep all of that scoped to the chosen workspace folder plus any explicitly allowed extra paths

Even in this small form, it gives the model a lot of control over a folder. That is the interesting part of the project: the harness is tiny, but the combination of `read`, `write`, and `exec` is already powerful.

## What It Does

At startup, the harness asks which folder it should work on.

After that, it stays in an interactive loop:

1. you enter a prompt
2. the harness sends the conversation and tool definitions to OpenRouter
3. the model can reply directly or request tool calls
4. tool calls run locally
5. results are sent back to the model
6. the loop continues until the model returns a final response
7. you can enter the next prompt

The session continues until you stop it with `Ctrl+C`.

## Important Files

```text
src/
  clients/
    agent.ts
  core/
    session-manager.ts
    session-runner.ts
  adapters/
    llm/
      openrouter.ts
    tools/
      exec.ts
      read.ts
      shared.ts
      write.ts
  shared/
    session.ts

package.json
tsconfig.json
eslint.config.js
.env.example
```

- `src/clients/agent.ts`: debug CLI entrypoint, terminal prompt loop, and event-driven console rendering
- `src/core/session-manager.ts`: in-memory session state, event storage, subscriptions, and snapshots
- `src/core/session-runner.ts`: bounded agent loop and tool-call orchestration
- `src/adapters/llm/openrouter.ts`: OpenRouter request/response handling and provider error formatting
- `src/adapters/tools/exec.ts`: local shell command execution
- `src/adapters/tools/read.ts`: text file reads
- `src/adapters/tools/write.ts`: patch-based file edits
- `src/adapters/tools/shared.ts`: allowed-path checks, patch parsing, and shared helpers
- `src/shared/session.ts`: shared session, event, and snapshot contracts
- `.env.example`: environment variable example

## How To Run

### 1. Install dependencies

```bash
bun install
```

### 2. Set environment variables

Create a `.env` file from `.env.example` and set at least:

```env
OPENROUTER_API_KEY=your_key_here
```

Optionally:

```env
OPENROUTER_MODEL=openai/gpt-oss-20b:free
```

### 3. Start the harness

```bash
bun run start
```

Then:

1. enter the folder to work on
2. enter prompts in the terminal
3. stop with `Ctrl+C`

## Notes

- `read` and `write` are restricted to the chosen workspace root and any extra `--allow` paths
- `write` only works through patch application, not arbitrary file overwrite requests from the model
- `exec` runs local shell commands, so this harness should be treated with care
