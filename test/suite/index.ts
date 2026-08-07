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
}
