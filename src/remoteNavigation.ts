import * as vscode from "vscode";
import { LambdaMooFileSystem } from "./remoteFileSystem";

type DefinitionResult = vscode.Definition | vscode.DefinitionLink[] | undefined | null;

async function resolveUri(
  provider: LambdaMooFileSystem,
  uri: vscode.Uri,
): Promise<vscode.Uri> {
  try {
    return await provider.resolveVerbDefinition(uri);
  } catch {
    return uri;
  }
}

export async function resolveDefinitionResult(
  provider: LambdaMooFileSystem,
  result: DefinitionResult,
): Promise<DefinitionResult> {
  if (!result) {
    return result;
  }
  if (!Array.isArray(result)) {
    return new vscode.Location(
      await resolveUri(provider, result.uri),
      result.range,
    );
  }
  if (result.length === 0) {
    return result;
  }
  if ("targetUri" in result[0]) {
    return Promise.all((result as vscode.DefinitionLink[]).map(async (definition) => (
      {
        ...definition,
        targetUri: await resolveUri(provider, definition.targetUri),
      }
    )));
  }
  return Promise.all((result as vscode.Location[]).map(async (definition) => (
    new vscode.Location(
      await resolveUri(provider, definition.uri),
      definition.range,
    )
  )));
}
