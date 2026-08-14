import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import { registerCommentCommands } from "./comments";
import { createInProcessServer } from "./inProcessLsp";
import { registerRemoteFileSystem } from "./remoteFileSystem";
import { resolveDefinitionResult } from "./remoteNavigation";

let client: LanguageClient | undefined;

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

  const serverOptions: ServerOptions = createInProcessServer;
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
