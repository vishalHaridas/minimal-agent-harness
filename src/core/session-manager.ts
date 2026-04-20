import readline from "node:readline/promises";
import type {
  Session,
  SessionEvent,
  SessionManagerConfig,
  SessionSnapshot,
  SessionSubscriber,
} from "../shared/session";
import { runAgentLoop, SYSTEM_PROMPT } from "./session-runner";

export class SessionManager {
  private readonly session: Session;
  private nextEventSeq: number;
  private pendingPrompt: string;
  private readonly subscribers: Set<SessionSubscriber>;

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
      iterationOffset: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastError: null,
    };
    this.nextEventSeq = 1;
    this.pendingPrompt = config.prompt;
    this.subscribers = new Set();
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
          this.session.iterationOffset = await runAgentLoop(
            this.session,
            (type, payload) => this.emit(type, payload),
          );

          this.completeSession();
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
