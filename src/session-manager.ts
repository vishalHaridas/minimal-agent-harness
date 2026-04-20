import readline from "node:readline/promises";
import type { OpenRouterMessage } from "./openrouter";
import {
  runAgentLoop,
  SYSTEM_PROMPT,
  type SessionRunnerConfig,
} from "./session-runner";

export type SessionManagerConfig = SessionRunnerConfig & {
  prompt: string;
};

export class SessionManager {
  private readonly config: SessionManagerConfig;
  private readonly messages: OpenRouterMessage[];
  private iterationOffset: number;

  constructor(config: SessionManagerConfig) {
    this.config = config;
    this.messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
    ];
    this.iterationOffset = 0;
  }

  async runInteractiveSession() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    let pendingPrompt = this.config.prompt;

    try {
      while (true) {
        const prompt = (pendingPrompt || (await rl.question(""))).trim();
        pendingPrompt = "";

        if (!prompt) {
          continue;
        }

        this.messages.push({
          role: "user",
          content: prompt,
        });
        this.iterationOffset = await runAgentLoop(
          this.config,
          this.messages,
          this.iterationOffset,
        );
      }
    } finally {
      rl.close();
    }
  }
}
