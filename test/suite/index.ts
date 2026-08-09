import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "Test fixture workspace is open");

  const fixture = vscode.Uri.joinPath(workspaceFolder.uri, "example.moo");
  const document = await vscode.workspace.openTextDocument(fixture);
  await vscode.window.showTextDocument(document);

  const extension = vscode.extensions.getExtension("kruton.vscode-lambdamoo");
  assert.ok(extension, "LambdaMOO extension is installed in the test host");
  await extension.activate();

  assert.equal(extension.isActive, true);
  assert.equal(document.languageId, "lambdamoo");
  assert.ok(
    (await vscode.commands.getCommands(true)).includes("lambdamoo.restartLanguageServer"),
    "Restart language server command is registered",
  );

  const commentDocument = await vscode.workspace.openTextDocument({
    language: "lambdamoo",
    content: "  notify(player, \"Hello!\");\nnot a wrapped string;\n  \"indented string\";\n",
  });
  const editor = await vscode.window.showTextDocument(commentDocument);

  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand("lambdamoo.toggleLineComment");
  assert.equal(commentDocument.lineAt(0).text, '  "notify(player, \\"Hello!\\");";');

  await vscode.commands.executeCommand("lambdamoo.toggleLineComment");
  assert.equal(commentDocument.lineAt(0).text, '  notify(player, "Hello!");');

  editor.selection = new vscode.Selection(0, 0, 2, 0);
  await vscode.commands.executeCommand("lambdamoo.toggleBlockComment");
  assert.equal(commentDocument.lineAt(0).text, '  "notify(player, \\"Hello!\\");";');
  assert.equal(commentDocument.lineAt(1).text, '"not a wrapped string;";');

  editor.selection = new vscode.Selection(0, 0, 2, 0);
  await vscode.commands.executeCommand("lambdamoo.toggleBlockComment");
  assert.equal(commentDocument.lineAt(0).text, '  notify(player, "Hello!");');
  assert.equal(commentDocument.lineAt(1).text, "not a wrapped string;");

  editor.selection = new vscode.Selection(2, 0, 2, 0);
  await vscode.commands.executeCommand("lambdamoo.toggleLineComment");
  assert.equal(commentDocument.lineAt(2).text, "  indented string");
}
