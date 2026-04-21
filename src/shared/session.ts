import type { OpenRouterMessage } from "../adapters/llm/openrouter";
import type { OpenRouterToolCall } from "../adapters/llm/openrouter";

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
    | "tool.requested"
    | "tool.completed"
    | "assistant.message"
    | "session.completed"
    | "session.failed";
  timestamp: string;
  payload: unknown;
};

export type PendingToolCall = {
  iteration: number;
  toolCall: OpenRouterToolCall;
  resolved: boolean;
};

export type ToolResultSubmission = {
  toolCallId: string;
  result: unknown;
};

export type SessionStatus =
  | "idle"
  | "running"
  | "waiting_for_tool"
  | "completed"
  | "failed";

export type Session = {
  id: string;
  status: SessionStatus;
  config: SessionRunnerConfig;
  messages: OpenRouterMessage[];
  events: SessionEvent[];
  pendingToolCalls: PendingToolCall[];
  iterationOffset: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
};

export type SessionSnapshot = {
  id: string;
  status: SessionStatus;
  iterationOffset: number;
  messageCount: number;
  eventCount: number;
  pendingToolCallIds: string[];
  lastUserMessage: string | null;
  lastAssistantMessage: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type SessionSubscriber = (event: SessionEvent) => void;
