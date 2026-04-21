import readline from "node:readline/promises";
import type {
  Session,
  SessionEvent,
  SessionManagerConfig,
  SessionStatus,
  SessionSnapshot,
  SessionSubscriber,
  ToolResultSubmission,
} from "../shared/session";
import { runAgentStep, SYSTEM_PROMPT } from "./session-runner";

export class SessionManager {
  private readonly session: Session;
  private nextEventSeq: number;
  private pendingPrompt: string;
  private readonly subscribers: Set<SessionSubscriber>;
  private turnCompletion: Promise<void> | null;
  private resolveTurnCompletion: (() => void) | null;

  constructor(config: SessionManagerConfig) {
    const timestamp = new Date().toISOString();
    this.session = {
      id: "session-1",
      status: "idle",
      config: {
        workspaceRoot: config.workspaceRoot,
        extraPaths: config.extraPaths,
        model: config.model,
      },
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
      ],
      events: [],
      pendingToolCalls: [],
      iterationOffset: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastError: null,
    };
    this.nextEventSeq = 1;
    this.pendingPrompt = config.prompt;
    this.subscribers = new Set();
    this.turnCompletion = null;
    this.resolveTurnCompletion = null;
    this.emit("session.created", {
      model: this.session.config.model,
      workspaceRoot: this.session.config.workspaceRoot,
      extraPaths: this.session.config.extraPaths,
    });
  }

  private snapshotPayload(payload: unknown) {
    return structuredClone(payload);
  }

  private getLastMessageContent(role: "user" | "assistant") {
    for (let index = this.session.messages.length - 1; index >= 0; index -= 1) {
      const message = this.session.messages[index];

      if (message.role === role) {
        return message.content;
      }
    }

    return null;
  }

  private emit(type: SessionEvent["type"], payload: unknown) {
    const event: SessionEvent = {
      seq: this.nextEventSeq,
      sessionId: this.session.id,
      type,
      timestamp: new Date().toISOString(),
      payload: this.snapshotPayload(payload),
    };

    this.nextEventSeq += 1;
    this.session.events.push(event);
    this.session.updatedAt = event.timestamp;

    // The core runtime stores the event first, then fans it out to observers.
    // Replaying from session state later should produce the same visible order.
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Subscribers are observers only. Their failures should never reach the
        // session loop and change runtime behavior.
      }
    }
  }

  getSnapshot(): SessionSnapshot {
    return {
      id: this.session.id,
      status: this.session.status,
      iterationOffset: this.session.iterationOffset,
      messageCount: this.session.messages.length,
      eventCount: this.session.events.length,
      pendingToolCallIds: this.session.pendingToolCalls
        .filter((pending) => !pending.resolved)
        .map((pending) => pending.toolCall.id),
      lastUserMessage: this.getLastMessageContent("user"),
      lastAssistantMessage: this.getLastMessageContent("assistant"),
      lastError: this.session.lastError,
      updatedAt: this.session.updatedAt,
    };
  }

  subscribe(subscriber: SessionSubscriber) {
    // Subscription replays what already happened, including `session.created`,
    // and then joins the live stream for future events.
    for (const event of this.session.events) {
      subscriber(event);
    }

    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private addUserInput(prompt: string) {
    this.session.messages.push({
      role: "user",
      content: prompt,
    });
    this.emit("session.input_added", {
      prompt,
      messageCount: this.session.messages.length,
    });
  }

  private setStatus(status: SessionStatus) {
    this.session.status = status;
  }

  private startSession() {
    this.setStatus("running");
    this.turnCompletion = new Promise((resolve) => {
      this.resolveTurnCompletion = resolve;
    });
    this.emit("session.started", {
      iterationOffset: this.session.iterationOffset,
    });
  }

  private completeSession() {
    this.setStatus("completed");
    this.emit("session.completed", {
      iterationOffset: this.session.iterationOffset,
    });
    this.resolveTurnCompletion?.();
    this.turnCompletion = null;
    this.resolveTurnCompletion = null;
  }

  private failSession(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus("failed");
    this.session.lastError = message;
    this.emit("session.failed", {
      iterationOffset: this.session.iterationOffset,
      error: message,
    });
    this.resolveTurnCompletion?.();
    this.turnCompletion = null;
    this.resolveTurnCompletion = null;
  }

  private async runModelStep() {
    this.setStatus("running");

    try {
      const outcome = await runAgentStep(
        this.session,
        (type, payload) => this.emit(type, payload),
      );
      this.session.iterationOffset = outcome.iterationOffset;

      // This is the only place that decides whether the turn is done or paused.
      // Tool submission only changes transcript state; once the last result is
      // appended, it calls back here to advance the model again.
      if (outcome.type === "completed") {
        this.completeSession();
        return;
      }

      this.setStatus("waiting_for_tool");
      for (const toolRequest of outcome.toolRequests) {
        this.emit("tool.requested", toolRequest);
      }
    } catch (error) {
      this.failSession(error);
      throw error;
    }
  }

  private waitForTurnCompletion() {
    return this.turnCompletion ?? Promise.resolve();
  }

  async submitToolResult(submission: ToolResultSubmission) {
    const pending = this.session.pendingToolCalls[0];

    if (!pending) {
      throw new Error("No pending tool call is waiting for a result.");
    }

    if (pending.resolved) {
      throw new Error("Pending tool call has already been resolved.");
    }

    if (pending.toolCall.id !== submission.toolCallId) {
      throw new Error(
        `Tool result id ${submission.toolCallId} does not match next pending tool call ${pending.toolCall.id}.`,
      );
    }

    const toolName = pending.toolCall.function.name;
    pending.resolved = true;
    this.emit("tool.completed", {
      iteration: pending.iteration,
      toolCallId: pending.toolCall.id,
      toolName,
      result: submission.result,
    });

    // The model can only continue after the client-side side effect is turned
    // back into the provider's expected tool message shape.
    this.session.messages.push({
      role: "tool",
      tool_call_id: pending.toolCall.id,
      content: JSON.stringify(submission.result, null, 2),
    });

    this.session.pendingToolCalls.shift();

    // Old behavior was sequential: if the model requested A, B, and C in one
    // turn, the runtime appended tool result A, then B, then C, and only then
    // asked the model for the next assistant turn. Keeping that shape matters
    // because tool calls can depend on previous filesystem side effects.
    if (this.session.pendingToolCalls.length > 0) {
      return;
    }

    await this.runModelStep();
  }

  async runInteractiveSession() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      while (true) {
        const prompt = (this.pendingPrompt || (await rl.question(""))).trim();
        this.pendingPrompt = "";

        if (!prompt) {
          continue;
        }

        this.startSession();
        this.addUserInput(prompt);

        await this.runModelStep();
        await this.waitForTurnCompletion();
      }
    } finally {
      rl.close();
    }
  }
}
