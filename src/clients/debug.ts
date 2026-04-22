import { read, write, exec } from "../adapters/tools";
import { CliConfig } from "./cli-config";
import { logToolResult } from "./event-logger";

export async function runDebug(config: CliConfig) {
  if (config.debugExecCommand) {
    const result = await exec(
      config.workspaceRoot!,
      config.debugExecCommand!,
      config.debugExecTimeoutMs,
    );
    logToolResult(0, "exec", result);
  }

  if (config.debugReadPath) {
    const result = await read(
      {
        workspaceRoot: config.workspaceRoot!,
        extraPaths: config.extraPaths,
      },
      config.debugReadPath,
    );
    logToolResult(0, "read", result);
  }

  if (config.debugWritePath && config.debugWriteContent !== null) {
    const result = await write(
      {
        workspaceRoot: config.workspaceRoot!,
        extraPaths: config.extraPaths,
      },
      config.debugWritePath,
      config.debugWriteContent,
    );
    logToolResult(0, "write", result);
  }
}
