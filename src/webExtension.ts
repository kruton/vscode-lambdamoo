import { ProcessOptions, Wasm } from "@vscode/wasm-wasi/v1";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/browser";
import { createStdioOptions, startServer } from "./wasmLsp";

let client: LanguageClient | undefined;

function workspacePath(uri: vscode.Uri): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folders || !folder) {
    return undefined;
  }

  const relativePath = uri.path.slice(folder.uri.path.length).replace(/^\//, "");
  const root = folders.length === 1
    ? "/workspace"
    : `/workspaces/${folder.name}`;
  return `${root}/${relativePath}`;
}

function workspaceUri(path: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return undefined;
  }

  if (folders.length === 1 && (path === "/workspace" || path.startsWith("/workspace/"))) {
    return vscode.Uri.joinPath(folders[0].uri, path.slice("/workspace/".length));
  }

  for (const folder of folders) {
    const root = `/workspaces/${folder.name}`;
    if (path === root || path.startsWith(`${root}/`)) {
      return vscode.Uri.joinPath(folder.uri, path.slice(`${root}/`.length));
    }
  }
  return undefined;
}

function uriConverters(): NonNullable<LanguageClientOptions["uriConverters"]> {
  return {
    code2Protocol: (uri) => {
      const path = workspacePath(uri);
      return path ? vscode.Uri.file(path).toString() : uri.toString();
    },
    protocol2Code: (value) => {
      const uri = vscode.Uri.parse(value);
      return uri.scheme === "file" ? workspaceUri(uri.path) ?? uri : uri;
    },
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const wasm = await Wasm.load();
  const outputChannel = vscode.window.createOutputChannel(
    "LambdaMOO Language Server",
    { log: true },
  );
  context.subscriptions.push(outputChannel);

  const serverOptions: ServerOptions = async () => {
    const wasmUri = vscode.Uri.joinPath(context.extensionUri, "bin", "moo-lsp-rs.wasm");
    const module = await wasm.compile(wasmUri);
    const options: ProcessOptions = {
      stdio: createStdioOptions(),
      mountPoints: [{ kind: "workspaceFolder" }],
    };
    const process = await wasm.createProcess(
      "moo-lsp-rs",
      module,
      { initial: 160, maximum: 160, shared: true },
      options,
    );

    const decoder = new TextDecoder("utf-8");
    process.stderr?.onData((data) => outputChannel.append(decoder.decode(data)));
    return startServer(process);
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "lambdamoo" }],
    outputChannel,
    uriConverters: uriConverters(),
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
