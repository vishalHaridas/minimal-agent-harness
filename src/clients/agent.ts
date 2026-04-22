import path from "node:path";
import { SessionManager } from "../core/session-manager";
import { parseArgs, printTrace, promptForWorkspaceRoot } from "./cli-config";
import { fail, formatTopLevelError } from "./cli-errors";
import { createEventLogger } from "./event-logger";
import { runInteractiveClientSession } from "./prompt-input";
import { runDebug } from "./debug";

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

  if (hasDebugAction) {
    await runDebug(config);
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
