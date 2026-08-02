import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

function executableName(): string {
  return process.platform === "win32" ? "moo-lsp-rs.exe" : "moo-lsp-rs";
}

function resolveConfiguredPath(configuredPath: string): string {
  const expanded = configuredPath.replace(/^~(?=$|[\\/])/, process.env.HOME ?? "~");
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(), expanded);
}

function findServer(context: vscode.ExtensionContext): string | undefined {
  const configuredPath = vscode.workspace
    .getConfiguration("lambdamoo")
    .get<string>("server.path", "")
    .trim();

  const candidates = configuredPath
    ? [resolveConfiguredPath(configuredPath)]
    : [
      path.join(context.extensionPath, "bin", executableName()),
      path.resolve(context.extensionPath, "..", "moo-lsp-rs", "target", "debug", executableName()),
      path.resolve(context.extensionPath, "..", "moo-lsp-rs", "target", "release", executableName()),
    ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const command = findServer(context);
  if (!command) {
    void vscode.window.showErrorMessage(
      "LambdaMOO language server was not found. Run 'npm run build:server' or set lambdamoo.server.path.",
    );
    return;
  }

  const serverOptions: ServerOptions = { command };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "lambdamoo" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.moo"),
    },
  };

  client = new LanguageClient(
    "lambdamooLanguageServer",
    "LambdaMOO Language Server",
    serverOptions,
    clientOptions,
  );
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
