import * as vscode from "vscode";

const lineCommentPattern = /^(\s*)"(.*)";$/;

function commentLine(text: string): string {
  const indentation = text.match(/^\s*/)?.[0] ?? "";
  const content = text.slice(indentation.length);
  return `${indentation}"${content.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}";`;
}

function uncommentLine(text: string): string {
  const match = lineCommentPattern.exec(text);
  if (!match) {
    return text;
  }

  return match[1] + match[2].replace(/\\(["\\])/g, "$1");
}

function selectedLineNumbers(editor: vscode.TextEditor): number[] {
  const lines = new Set<number>();
  for (const selection of editor.selections) {
    const endLine = selection.end.character === 0 && !selection.isEmpty
      ? selection.end.line - 1
      : selection.end.line;
    for (let line = selection.start.line; line <= endLine; line += 1) {
      lines.add(line);
    }
  }
  return [...lines].sort((left, right) => left - right);
}

async function toggleComment(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "lambdamoo") {
    return;
  }

  const lineNumbers = selectedLineNumbers(editor);
  const shouldUncomment = lineNumbers.every((lineNumber) =>
    lineCommentPattern.test(editor.document.lineAt(lineNumber).text)
  );

  await editor.edit((editBuilder) => {
    for (const lineNumber of lineNumbers) {
      const line = editor.document.lineAt(lineNumber);
      const replacement = shouldUncomment
        ? uncommentLine(line.text)
        : commentLine(line.text);
      editBuilder.replace(line.range, replacement);
    }
  });
}

export function registerCommentCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("lambdamoo.toggleLineComment", toggleComment),
    vscode.commands.registerCommand("lambdamoo.toggleBlockComment", toggleComment),
  );
}
