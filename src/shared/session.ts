import type { OpenRouterMessage } from "../adapters/llm/openrouter";

export type SessionRunnerConfig = {
  workspaceRoot: string;
  extraPaths: string[];
  model: string;
};

export type SessionManagerConfig = SessionRunnerConfig & {
  prompt: string;
};

export type SessionEvent = {
  seq: number;
  sessionId: string;
  type:
    | "session.created"
    | "session.input_added"
    | "session.started"
    | "llm.requested"
    | "llm.responded"
    | "tool.called"
    | "tool.completed"
    | "assistant.message"
    | "session.completed"
    | "session.failed";
  timestamp: string;
  payload: unknown;
};

export type Session = {
  id: string;
  status: "idle" | "running" | "completed" | "failed";
  config: SessionRunnerConfig;
  messages: OpenRouterMessage[];
  events: SessionEvent[];
  iterationOffset: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
};

export type SessionSnapshot = {
  id: string;
  status: "idle" | "running" | "completed" | "failed";
  iterationOffset: number;
  messageCount: number;
  eventCount: number;
  lastUserMessage: string | null;
  lastAssistantMessage: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type SessionSubscriber = (event: SessionEvent) => void;
