import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import { registerCommentCommands } from "./comments";
import { registerRemoteFileSystem } from "./remoteFileSystem";
import { resolveDefinitionResult } from "./remoteNavigation";

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
    : [path.join(context.extensionPath, "bin", executableName())];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  registerCommentCommands(context);
  const remoteFileSystem = registerRemoteFileSystem(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("lambdamoo.restartLanguageServer", async () => {
      if (!client) {
        void vscode.window.showErrorMessage("LambdaMOO language server is not running.");
        return;
      }
      await client.stop();
      await client.start();
    }),
  );

  const command = findServer(context);
  if (!command) {
    void vscode.window.showErrorMessage(
      "LambdaMOO language server was not found. Set lambdamoo.server.path to a development build.",
    );
    return;
  }

  const serverOptions: ServerOptions = { command };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "lambdamoo" },
      { scheme: "moo" },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.moo"),
    },
    middleware: {
      provideDefinition: async (document, position, token, next) => resolveDefinitionResult(
        remoteFileSystem,
        await next(document, position, token),
      ),
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
