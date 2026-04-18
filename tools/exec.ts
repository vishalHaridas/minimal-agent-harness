import { exec as childExec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(childExec);

export type ExecResult = {
  ok: boolean;
  command: string;
  cwd: string;
  shell: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
};

export async function exec(
  workspaceRoot: string,
  command: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  const shell =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : "/bin/sh";

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workspaceRoot,
      shell,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    return {
      ok: true,
      command,
      cwd: workspaceRoot,
      shell,
      stdout,
      stderr,
      exitCode: 0,
      timedOut: false,
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };
    const isTimeout =
      execError.signal === "SIGTERM" &&
      execError.killed === true &&
      execError.code === null;

    return {
      ok: false,
      command,
      cwd: workspaceRoot,
      shell,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: typeof execError.code === "number" ? execError.code : null,
      timedOut: isTimeout,
      error: execError.message,
    };
  }
}
