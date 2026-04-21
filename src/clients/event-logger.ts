import type { ExecResult, ReadResult, WriteResult } from "../adapters/tools";
import type { SessionManager } from "../core/session-manager";
import type { SessionEvent, SessionSubscriber } from "../shared/session";
import type { CliConfig } from "./cli-config";
import { formatTopLevelError } from "./cli-errors";
import { submitClientToolResult } from "./tool-client";

function quoteInline(value: string) {
  return JSON.stringify(value);
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeExecOutput(result: ExecResult) {
  const output = result.stdout || result.stderr || result.error || "";
  const collapsed = collapseWhitespace(output);

  if (!collapsed) {
    return result.ok ? "no output" : "command failed";
  }

  const fileMatch = collapsed.match(/(\d+)\s+File\(s\).*?(\d+)\s+Dir\(s\)/i);

  if (fileMatch) {
    const fileLabel = Number(fileMatch[1]) === 1 ? "file" : "files";
    const dirLabel = Number(fileMatch[2]) === 1 ? "subdir" : "subdirs";
    return `${fileMatch[1]} ${fileLabel}, ${fileMatch[2]} ${dirLabel}`;
  }

  return collapsed;
}

function summarizeReadResult(result: ReadResult) {
  if (!result.ok) {
    return collapseWhitespace(result.error ?? "read failed");
  }

  const suffix = result.truncated ? ", truncated" : "";
  return `${result.bytesRead} bytes${suffix}`;
}

function summarizeWriteResult(
  result: WriteResult & { patchSummary?: unknown[] },
) {
  if (!result.ok) {
    return collapseWhitespace(result.error ?? "write failed");
  }

  const operationCount =
    result.details?.length ?? result.patchSummary?.length ?? 0;
  const label = operationCount === 1 ? "change" : "changes";
  return `${result.bytesWritten} bytes, ${operationCount} ${label}`;
}

function summarizeToolResult(toolName: string, result: unknown) {
  if (toolName === "exec") {
    return summarizeExecOutput(result as ExecResult);
  }

  if (toolName === "read") {
    return summarizeReadResult(result as ReadResult);
  }

  if (toolName === "write") {
    return summarizeWriteResult(
      result as WriteResult & { patchSummary?: unknown[] },
    );
  }

  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof result.error === "string"
  ) {
    return collapseWhitespace(result.error);
  }

  return collapseWhitespace(JSON.stringify(result));
}

export function logToolResult(
  iteration: number,
  toolName: string,
  result: unknown,
) {
  const ok =
    result &&
    typeof result === "object" &&
    "ok" in result &&
    result.ok === true;
  const status = (ok ? "ok" : "error").padEnd(16, " ");
  const exitCode =
    result &&
    typeof result === "object" &&
    "exitCode" in result &&
    typeof result.exitCode === "number"
      ? `  exit=${result.exitCode}`
      : "";

  console.log(
    `t${iteration}  ${toolName.padEnd(10, " ")} ${status}${exitCode}  ${summarizeToolResult(toolName, result)}`,
  );
}

export function createEventLogger(
  config: CliConfig,
  session: SessionManager,
): SessionSubscriber {
  // The CLI now has two jobs at the boundary: keep the human trace readable
  // and perform the one local side effect requested by core.
  let toolQueue = Promise.resolve();

  return (event: SessionEvent) => {
    if (event.type === "tool.requested") {
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : null;
      const iteration =
        payload && typeof payload.iteration === "number"
          ? payload.iteration
          : 0;
      const toolName =
        payload && typeof payload.toolName === "string" ? payload.toolName : "";
      const args =
        payload && payload.arguments && typeof payload.arguments === "object"
          ? (payload.arguments as Record<string, unknown>)
          : {};
      const command =
        typeof args.command === "string" ? args.command : JSON.stringify(args);

      console.log("---");
      console.log(
        `t${iteration}  assistant  tool_call ${toolName}   ${quoteInline(command)}`,
      );

      // Events are delivered synchronously, but tool execution is async. This
      // queue preserves the old runner behavior: tool calls from one assistant
      // turn run one after another in the same order the model emitted them.
      toolQueue = toolQueue.then(() =>
        submitClientToolResult(config, session, payload ?? {}).catch(
          (error: unknown) => {
            console.error(formatTopLevelError(error));
          },
        ),
      );
      void toolQueue.catch((error: unknown) => {
        if (error) {
          console.error(formatTopLevelError(error));
        }
      });
      return;
    }

    if (event.type === "tool.completed") {
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : null;
      const iteration =
        payload && typeof payload.iteration === "number"
          ? payload.iteration
          : 0;
      const toolName =
        payload && typeof payload.toolName === "string" ? payload.toolName : "";
      const result = payload ? payload.result : null;

      logToolResult(iteration, toolName, result);
      return;
    }

    if (event.type === "assistant.message") {
      const payload =
        event.payload && typeof event.payload === "object"
          ? (event.payload as Record<string, unknown>)
          : null;
      const content =
        payload &&
        (typeof payload.content === "string" || payload.content === null)
          ? payload.content
          : null;
      const toolCalls =
        payload && Array.isArray(payload.toolCalls) ? payload.toolCalls : [];

      // Tool-producing turns already surface through tool events. The plain
      // assistant message is the terminal user-facing output worth printing.
      if (toolCalls.length === 0) {
        console.log("---");
        console.log(content ?? "(no content)");
        console.log("---");
      }
    }
  };
}
