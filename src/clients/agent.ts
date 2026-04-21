import path from "node:path";
import { exec, read, write } from "../adapters/tools";
import { SessionManager } from "../core/session-manager";
import { parseArgs, printTrace, promptForWorkspaceRoot } from "./cli-config";
import { fail, formatTopLevelError } from "./cli-errors";
import { createEventLogger, logToolResult } from "./event-logger";
import { runInteractiveClientSession } from "./prompt-input";

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const hasDebugAction = Boolean(
    config.debugExecCommand || config.debugReadPath || config.debugWritePath,
  );

  if (!config.workspaceRoot) {
    const promptedWorkspaceRoot = await promptForWorkspaceRoot();

    if (!promptedWorkspaceRoot) {
      fail(
        "Missing working directory. Pass --cwd or enter a directory at the prompt.",
      );
    }

    config.workspaceRoot = path.resolve(promptedWorkspaceRoot);
  }

  const workspaceRoot = config.workspaceRoot;
  printTrace(config);

  if (config.debugExecCommand) {
    const result = await exec(
      workspaceRoot,
      config.debugExecCommand,
      config.debugExecTimeoutMs,
    );
    logToolResult(0, "exec", result);
  }

  if (config.debugReadPath) {
    const result = await read(
      {
        workspaceRoot,
        extraPaths: config.extraPaths,
      },
      config.debugReadPath,
    );
    logToolResult(0, "read", result);
  }

  if (config.debugWritePath && config.debugWriteContent !== null) {
    const result = await write(
      {
        workspaceRoot,
        extraPaths: config.extraPaths,
      },
      config.debugWritePath,
      config.debugWriteContent,
    );
    logToolResult(0, "write", result);
  }

  if (!config.prompt && hasDebugAction) {
    return;
  }

  const session = new SessionManager({
    workspaceRoot,
    extraPaths: config.extraPaths,
    model: config.model,
  });
  const unsubscribe = session.subscribe(createEventLogger(config, session));

  try {
    await runInteractiveClientSession(session, config.prompt);
  } finally {
    unsubscribe();
  }
}

try {
  await main();
} catch (error) {
  fail(formatTopLevelError(error));
}
