import * as vscode from "vscode";
import { LambdaMooFileSystem } from "./remoteFileSystem";

export const remoteDocumentInitializationOptions = {
  lambdamoo: { remoteDocuments: 1 },
};

interface RemoteDocumentClient {
  onRequest(method: string, handler: (params: { uri?: unknown }) => Promise<{ text: string }>): vscode.Disposable;
  onNotification(
    method: string,
    handler: (params: { uri?: unknown; canonicalUri?: unknown }) => void,
  ): vscode.Disposable;
}

async function replaceOpenDocument(uri: vscode.Uri, canonicalUri: vscode.Uri): Promise<void> {
  if (uri.toString() === canonicalUri.toString()) {
    return;
  }
  const document = vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.toString() === uri.toString(),
  );
  if (!document) {
    return;
  }
  if (document.isDirty) {
    const saved = vscode.workspace.onDidSaveTextDocument((candidate) => {
      if (candidate.uri.toString() === uri.toString()) {
        saved.dispose();
        closed.dispose();
        void replaceOpenDocument(uri, canonicalUri);
      }
    });
    const closed = vscode.workspace.onDidCloseTextDocument((candidate) => {
      if (candidate.uri.toString() === uri.toString()) {
        saved.dispose();
        closed.dispose();
      }
    });
    return;
  }

  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === uri.toString(),
  );
  await vscode.window.showTextDocument(canonicalUri, {
    preview: true,
    viewColumn: editor?.viewColumn,
  });
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter(
    (tab) => tab.input instanceof vscode.TabInputText
      && tab.input.uri.toString() === uri.toString(),
  );
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs);
  }
}

export function registerRemoteDocumentProtocol(
  context: vscode.ExtensionContext,
  client: RemoteDocumentClient,
  provider: LambdaMooFileSystem,
): void {
  context.subscriptions.push(
    client.onRequest("lambdamoo/readDocument", async ({ uri }) => {
      if (typeof uri !== "string") {
        throw new Error("lambdamoo/readDocument requires a URI");
      }
      const parsed = vscode.Uri.parse(uri, true);
      if (parsed.scheme !== "moo") {
        throw new Error("lambdamoo/readDocument only supports moo: URIs");
      }
      const open = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === parsed.toString(),
      );
      if (open) {
        return { text: open.getText() };
      }
      return { text: new TextDecoder().decode(await provider.readFile(parsed)) };
    }),
    client.onNotification("lambdamoo/canonicalizeDocument", ({ uri, canonicalUri }) => {
      if (typeof uri !== "string" || typeof canonicalUri !== "string") {
        return;
      }
      const parsed = vscode.Uri.parse(uri, true);
      const canonical = vscode.Uri.parse(canonicalUri, true);
      if (parsed.scheme !== "moo" || canonical.scheme !== "moo") {
        return;
      }
      void replaceOpenDocument(parsed, canonical);
    }),
  );
}
