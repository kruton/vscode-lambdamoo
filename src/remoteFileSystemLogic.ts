export type PreconditionContext =
  | { readonly kind: "write"; readonly exists: boolean; readonly overwrite: boolean; readonly etag?: string }
  | { readonly kind: "destination"; readonly overwrite: boolean };

export type PreconditionFailure = "remoteChanged" | "fileExists" | "preconditionFailed";

export function normalizeEtag(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^(?:W\/)?"[^"\r\n]*"$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("W/")) {
    return `W/"${trimmed.slice(2).replace(/"/g, "")}"`;
  }
  return `"${trimmed.replace(/"/g, "")}"`;
}

export function classifyPreconditionFailure(context: PreconditionContext): PreconditionFailure {
  if (context.kind === "write" && context.exists && context.overwrite && context.etag) {
    return "remoteChanged";
  }
  if (
    (context.kind === "write" && !context.exists && !context.overwrite)
    || (context.kind === "destination" && !context.overwrite)
  ) {
    return "fileExists";
  }
  return "preconditionFailed";
}

export function invalidateKeys<T>(values: Map<string, T>, ...keys: string[]): void {
  for (const key of keys) {
    values.delete(key);
  }
}

export interface VerbDefinitionPaths {
  readonly verbName: string;
  readonly resolutionPath: string;
}

export function isEditorMetadataPath(path: string): boolean {
  return path === "/.vscode" || path.startsWith("/.vscode/");
}

export function canonicalObjectPath(path: string): string | undefined {
  const match = /^\/owned\/(-?\d+)(\/.*)?$/.exec(path);
  if (!match) {
    return undefined;
  }
  return `/object/${match[1]}${match[2] ?? ""}`;
}

export function verbDefinitionPaths(path: string): VerbDefinitionPaths | undefined {
  const match = /^(.*)\/verb\/([^/]+)$/.exec(path);
  if (!match) {
    return undefined;
  }
  const [, objectPath, verbName] = match;
  return {
    verbName,
    resolutionPath: `${objectPath}/resolve/verb/${verbName}/defined-on`,
  };
}
