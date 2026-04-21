import readline from "node:readline/promises";
import type {
  Session,
  SessionEvent,
  SessionManagerConfig,
  SessionSnapshot,
  SessionSubscriber,
  ToolResultSubmission,
} from "../shared/session";
import { runAgentLoop, SYSTEM_PROMPT } from "./session-runner";

export class SessionManager {
  private readonly session: Session;
  private nextEventSeq: number;
  private pendingPrompt: string;
  private readonly subscribers: Set<SessionSubscriber>;
  private toolWaiter: (() => void) | null;

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
    this.toolWaiter = null;
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

  private startSession() {
    this.session.status = "running";
    this.emit("session.started", {
      iterationOffset: this.session.iterationOffset,
    });
  }

  private completeSession() {
    this.session.status = "completed";
    this.emit("session.completed", {
      iterationOffset: this.session.iterationOffset,
    });
  }

  private failSession(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.session.status = "failed";
    this.session.lastError = message;
    this.emit("session.failed", {
      iterationOffset: this.session.iterationOffset,
      error: message,
    });
  }

  private async runTurnUntilBlockedOrComplete() {
    this.session.status = "running";
    this.session.iterationOffset = await runAgentLoop(
      this.session,
      (type, payload) => this.emit(type, payload),
    );

    // `waiting_for_tool` means the runner intentionally paused after emitting
    // one or more requests. Completion only means no tool work is left for the
    // current assistant turn.
    if (this.session.pendingToolCalls.length === 0) {
      this.completeSession();
    }
  }

  private waitForToolResult() {
    if (this.session.status !== "waiting_for_tool") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.toolWaiter = resolve;
    });
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

    try {
      await this.runTurnUntilBlockedOrComplete();
      this.toolWaiter?.();
      this.toolWaiter = null;
    } catch (error) {
      this.failSession(error);
      this.toolWaiter?.();
      this.toolWaiter = null;
      throw error;
    }
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

        try {
          await this.runTurnUntilBlockedOrComplete();
          while (this.session.status === "waiting_for_tool") {
            await this.waitForToolResult();
          }
        } catch (error) {
          this.failSession(error);
          throw error;
        }
      }
    } finally {
      rl.close();
    }
  }
}
