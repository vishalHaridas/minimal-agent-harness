import {
  Editor,
  ProcessTerminal,
  TUI,
  type EditorTheme,
  type SelectListTheme,
} from "@mariozechner/pi-tui";
import type { SessionManager } from "../core/session-manager";

const passthrough = (value: string) => value;

const selectListTheme: SelectListTheme = {
  selectedPrefix: passthrough,
  selectedText: passthrough,
  description: passthrough,
  scrollInfo: passthrough,
  noMatch: passthrough,
};

const editorTheme: EditorTheme = {
  borderColor: passthrough,
  selectList: selectListTheme,
};

async function readPrompt() {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const editor = new Editor(tui, editorTheme);

  tui.addChild(editor);
  tui.setFocus(editor);

  return new Promise<string>((resolve) => {
    editor.onSubmit = (text) => {
      editor.addToHistory(text);
      editor.setText(text);
      tui.requestRender();
      resolve(text);
    };

    tui.start();
  }).finally(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await terminal.drainInput(150, 25);
    tui.stop();
  });
}

function ignoreTerminalInput() {
  const terminal = new ProcessTerminal();

  terminal.start(
    () => {},
    () => {},
  );

  return async () => {
    await terminal.drainInput(150, 25);
    terminal.stop();
  };
}

async function submitPromptFromClient(session: SessionManager, prompt: string) {
  const input = prompt.trim();

  if (!input) {
    return;
  }

  const stopIgnoringInput = ignoreTerminalInput();

  try {
    await session.submitPrompt(input);
  } finally {
    await stopIgnoringInput();
  }
}

export async function runInteractiveClientSession(
  session: SessionManager,
  initialPrompt: string,
) {
  let pendingPrompt = initialPrompt;

  while (true) {
    const prompt = pendingPrompt || (await readPrompt());
    pendingPrompt = "";

    await submitPromptFromClient(session, prompt);
  }
}
