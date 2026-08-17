import * as vscode from "vscode";
import {
  createClient,
  FileStat,
  ResponseDataDetailed,
  WebDAVClient,
  WebDAVClientError,
} from "webdav";
import { BoundedTtlCache, RequestCoalescer } from "./remoteCache";
import {
  canonicalObjectPath,
  classifyPreconditionFailure,
  invalidateKeys,
  isEditorMetadataPath,
  normalizeEtag,
  PreconditionContext,
  verbDefinitionPaths,
} from "./remoteFileSystemLogic";

const scheme = "moo";
const connectionsSetting = "connections";

type AdapterKind = "webdav";

export function preconditionFailedError(
  uri: vscode.Uri,
  context: PreconditionContext,
): vscode.FileSystemError {
  switch (classifyPreconditionFailure(context)) {
    case "remoteChanged":
      return vscode.FileSystemError.Unavailable(
        "The remote resource changed since it was loaded. Reload it before saving again.",
      );
    case "fileExists":
      return vscode.FileSystemError.FileExists(uri);
    case "preconditionFailed":
      return vscode.FileSystemError.Unavailable(`A precondition failed for ${uri.toString()}.`);
  }
}

function invalidateEtags(etags: Map<string, string>, ...uris: vscode.Uri[]): void {
  invalidateKeys(etags, ...uris.map((uri) => uri.toString()));
}

export interface ConnectionProfile {
  readonly authority: string;
  readonly adapter: AdapterKind;
  readonly endpoint: string;
  readonly username?: string;
}

interface RemoteAdapter {
  stat(path: string): Promise<FileStat>;
  readDirectory(path: string): Promise<FileStat[]>;
  readFile(path: string, etag?: string): Promise<FileReadResult>;
  writeFile(path: string, content: Uint8Array, overwrite: boolean, etag?: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  move(path: string, destination: string, overwrite: boolean): Promise<void>;
  copy(path: string, destination: string, overwrite: boolean): Promise<void>;
}

interface FileReadResult {
  readonly status: 200 | 304;
  readonly contents?: Uint8Array;
  readonly etag?: string;
}

interface ContentCacheEntry {
  readonly contents: Uint8Array;
  readonly etag?: string;
}

interface AdapterSession {
  readonly signature: string;
  readonly adapter: RemoteAdapter;
}

class WebDavAdapter implements RemoteAdapter {
  private readonly client: WebDAVClient;

  public constructor(profile: ConnectionProfile, password?: string) {
    this.client = createClient(profile.endpoint, {
      username: profile.username || undefined,
      password,
    });
  }

  public stat(path: string): Promise<FileStat> {
    return this.client.stat(path) as Promise<FileStat>;
  }

  public readDirectory(path: string): Promise<FileStat[]> {
    return this.client.getDirectoryContents(path) as Promise<FileStat[]>;
  }

  public async readFile(path: string, etag?: string): Promise<FileReadResult> {
    const response = await this.client.getFileContents(path, {
      details: true,
      headers: etag ? { "If-None-Match": etag } : undefined,
    }) as ResponseDataDetailed<Buffer | ArrayBuffer>;
    if (response.status === 304) {
      return { status: 304, etag };
    }
    if (response.status !== 200 || typeof response.data === "string") {
      throw new Error(`Unexpected WebDAV response for ${path}`);
    }
    const responseEtag = Object.entries(response.headers).find(
      ([name]) => name.toLowerCase() === "etag",
    )?.[1];
    return {
      status: 200,
      contents: new Uint8Array(response.data),
      etag: normalizeEtag(responseEtag),
    };
  }

  public writeFile(path: string, content: Uint8Array, overwrite: boolean, etag?: string): Promise<boolean> {
    return this.client.putFileContents(path, Uint8Array.from(content).buffer, {
      overwrite,
      headers: etag ? { "If-Match": etag } : undefined,
    });
  }

  public delete(path: string): Promise<void> {
    return this.client.deleteFile(path);
  }

  public move(path: string, destination: string, overwrite: boolean): Promise<void> {
    return this.client.moveFile(path, destination, { overwrite });
  }

  public copy(path: string, destination: string, overwrite: boolean): Promise<void> {
    return this.client.copyFile(path, destination, { overwrite });
  }
}

function normalizeProfile(value: unknown): ConnectionProfile | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.authority !== "string" ||
    candidate.authority !== candidate.authority.toLowerCase() ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(candidate.authority) ||
    candidate.adapter !== "webdav" ||
    typeof candidate.endpoint !== "string"
  ) {
    return undefined;
  }
  let endpoint: URL;
  try {
    endpoint = new URL(candidate.endpoint);
  } catch {
    return undefined;
  }
  if (!(endpoint.protocol === "https:" || endpoint.protocol === "http:")) {
    return undefined;
  }
  if (!endpoint.pathname.endsWith("/")) {
    endpoint.pathname += "/";
  }
  return {
    authority: candidate.authority,
    adapter: "webdav",
    endpoint: endpoint.toString(),
    username: typeof candidate.username === "string" && candidate.username
      ? candidate.username
      : undefined,
  };
}

function profiles(): ConnectionProfile[] {
  const values = vscode.workspace
    .getConfiguration("lambdamoo")
    .get<unknown[]>(connectionsSetting, []);
  const result: ConnectionProfile[] = [];
  const authorities = new Set<string>();
  for (const value of values) {
    const profile = normalizeProfile(value);
    if (profile && !authorities.has(profile.authority)) {
      result.push(profile);
      authorities.add(profile.authority);
    }
  }
  return result;
}

async function saveProfiles(values: ConnectionProfile[]): Promise<void> {
  await vscode.workspace
    .getConfiguration("lambdamoo")
    .update(connectionsSetting, values, vscode.ConfigurationTarget.Global);
}

function secretKey(profile: ConnectionProfile): string {
  return `lambdamoo.connection.password:${profile.authority}:${profile.username ?? ""}`;
}

async function promptForProfile(authority?: string, current?: ConnectionProfile): Promise<ConnectionProfile | undefined> {
  const enteredAuthority = authority ?? await vscode.window.showInputBox({
    title: current ? "Edit Remote MOO Connection" : "Add Remote MOO Connection",
    prompt: "Name used in moo://<authority>/ URIs",
    value: current?.authority,
    validateInput: (value) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)
      ? undefined
      : "Use a lowercase hostname-like authority.",
  });
  if (!enteredAuthority) {
    return undefined;
  }
  const endpoint = await vscode.window.showInputBox({
    title: "WebDAV Endpoint",
    prompt: "HTTP or HTTPS WebDAV prefix",
    value: current?.endpoint ?? `https://${enteredAuthority}/dav/`,
    validateInput: (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:"
          ? undefined
          : "The endpoint must use HTTP or HTTPS.";
      } catch {
        return "Enter a valid URL.";
      }
    },
  });
  if (!endpoint) {
    return undefined;
  }
  const username = await vscode.window.showInputBox({
    title: "WebDAV Username",
    prompt: "Leave empty for an anonymous connection",
    value: current?.username,
  });
  if (username === undefined) {
    return undefined;
  }
  return normalizeProfile({ authority: enteredAuthority, adapter: "webdav", endpoint, username });
}

export class LambdaMooFileSystem implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly etags = new Map<string, string>();
  private readonly sessions = new Map<string, AdapterSession>();
  private readonly generations = new Map<string, number>();
  private readonly coalescer = new RequestCoalescer();
  private readonly stats = new BoundedTtlCache<string, FileStat>({ maxEntries: 10_000 });
  private readonly directories = new BoundedTtlCache<string, FileStat[]>({ maxEntries: 256 });
  private readonly contents = new BoundedTtlCache<string, ContentCacheEntry>({
    maxEntries: 32,
    maxWeight: 8 * 1024 * 1024,
    weight: (entry) => entry.contents.byteLength,
  });
  public readonly onDidChangeFile = this.changes.event;

  public constructor(private readonly secrets: vscode.SecretStorage) {}

  private async profile(authority: string): Promise<ConnectionProfile> {
    const existing = profiles().find((profile) => profile.authority === authority);
    if (existing) {
      return existing;
    }
    const setup = "Set Up Connection";
    const choice = await vscode.window.showErrorMessage(
      `No remote MOO connection is configured for '${authority}'.`,
      setup,
    );
    if (choice !== setup) {
      throw vscode.FileSystemError.Unavailable(`Unknown remote MOO connection: ${authority}`);
    }
    const created = await promptForProfile(authority);
    if (!created) {
      throw vscode.FileSystemError.Unavailable(`Connection setup was cancelled for ${authority}`);
    }
    await saveProfiles([...profiles(), created]);
    return created;
  }

  private adapter(profile: ConnectionProfile, password?: string): RemoteAdapter {
    switch (profile.adapter) {
      case "webdav":
        return new WebDavAdapter(profile, password);
    }
  }

  private sessionAdapter(profile: ConnectionProfile, password?: string): RemoteAdapter {
    const authority = profile.authority.toLowerCase();
    const signature = JSON.stringify([profile.adapter, profile.endpoint, profile.username, password]);
    const existing = this.sessions.get(authority);
    if (existing?.signature === signature) {
      return existing.adapter;
    }
    const adapter = this.adapter(profile, password);
    this.sessions.set(authority, { signature, adapter });
    return adapter;
  }

  private cacheTtlMs(): number {
    return Math.max(0, vscode.workspace.getConfiguration("lambdamoo").get<number>("webdav.cacheTtlMs", 5000));
  }

  private requestIdentity(uri: vscode.Uri): { authority: string; path: string; key: string } {
    const authority = uri.authority.toLowerCase();
    const path = canonicalObjectPath(uri.path) ?? (uri.path || "/");
    return { authority, path, key: `${authority}\n${path}` };
  }

  private generation(authority: string): number {
    return this.generations.get(authority) ?? 0;
  }

  public clearConnection(authority: string): void {
    const normalized = authority.toLowerCase();
    this.sessions.delete(normalized);
    this.invalidateReadCaches(normalized);
  }

  private invalidateReadCaches(authority: string): void {
    const normalized = authority.toLowerCase();
    const prefix = `${normalized}\n`;
    this.generations.set(normalized, this.generation(normalized) + 1);
    this.stats.deleteWhere((key) => key.startsWith(prefix));
    this.directories.deleteWhere((key) => key.startsWith(prefix));
    this.contents.deleteWhere((key) => key.startsWith(prefix));
    this.coalescer.deleteWhere((key) => key.includes(`\n${prefix}`));
  }

  public clearReadCaches(): void {
    const authorities = new Set([...this.sessions.keys(), ...this.generations.keys()]);
    for (const authority of authorities) {
      this.generations.set(authority, this.generation(authority) + 1);
    }
    this.stats.clear();
    this.directories.clear();
    this.contents.clear();
    this.coalescer.clear();
  }

  private async call<T>(
    uri: vscode.Uri,
    operation: (adapter: RemoteAdapter, path: string) => Promise<T>,
    preconditionFailed?: () => vscode.FileSystemError,
  ): Promise<T> {
    if (uri.scheme !== scheme || !uri.authority) {
      throw vscode.FileSystemError.Unavailable(uri);
    }
    if (isEditorMetadataPath(uri.path)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const profile = await this.profile(uri.authority.toLowerCase());
    const password = await this.secrets.get(secretKey(profile));
    const path = this.requestIdentity(uri).path;
    try {
      return await operation(this.sessionAdapter(profile, password), path);
    } catch (error) {
      const status = (error as WebDAVClientError).status;
      if (status === 401 && profile.username) {
        const replacement = await vscode.window.showInputBox({
          password: true,
          title: `Sign in to ${profile.authority}`,
          prompt: `Password for ${profile.username}`,
        });
        if (replacement !== undefined) {
          try {
            const replacementAdapter = this.adapter(profile, replacement);
            const result = await operation(replacementAdapter, path);
            await this.secrets.store(secretKey(profile), replacement);
            this.clearConnection(profile.authority);
            this.sessionAdapter(profile, replacement);
            return result;
          } catch (retryError) {
            error = retryError;
          }
        }
      }
      throw this.fileSystemError(uri, error, preconditionFailed);
    }
  }

  private fileSystemError(
    uri: vscode.Uri,
    error: unknown,
    preconditionFailed?: () => vscode.FileSystemError,
  ): vscode.FileSystemError {
    const status = (error as WebDAVClientError).status;
    if (status === 401 || status === 403) {
      if (status === 403 && /^\/object\/?$/.test(uri.path)) {
        return vscode.FileSystemError.NoPermissions(
          "This server does not allow enumerating all objects. Open a known /object/<id>/ path directly.",
        );
      }
      return vscode.FileSystemError.NoPermissions(uri);
    }
    if (status === 404) {
      return vscode.FileSystemError.FileNotFound(uri);
    }
    if (status === 412) {
      return preconditionFailed?.()
        ?? vscode.FileSystemError.Unavailable(`A precondition failed for ${uri.toString()}.`);
    }
    return vscode.FileSystemError.Unavailable(error instanceof Error ? error.message : String(error));
  }

  private fileType(stat: FileStat): vscode.FileType {
    return stat.type === "directory" ? vscode.FileType.Directory : vscode.FileType.File;
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const identity = this.requestIdentity(uri);
    let stat = this.stats.getFresh(identity.key);
    if (!stat) {
      const generation = this.generation(identity.authority);
      stat = await this.coalescer.run(`stat\n${identity.key}`, () => this.call(
        uri,
        (adapter, path) => adapter.stat(path),
      ));
      if (generation === this.generation(identity.authority)) {
        this.stats.set(identity.key, stat, this.cacheTtlMs());
      }
    }
    const etag = normalizeEtag(stat.etag);
    if (etag) {
      this.etags.set(uri.toString(), etag);
    } else {
      this.etags.delete(uri.toString());
    }
    const mtime = Date.parse(stat.lastmod);
    return {
      type: this.fileType(stat),
      ctime: 0,
      mtime: Number.isNaN(mtime) ? 0 : mtime,
      size: stat.size,
    };
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const identity = this.requestIdentity(uri);
    let entries = this.directories.getFresh(identity.key);
    if (!entries) {
      const generation = this.generation(identity.authority);
      entries = await this.coalescer.run(`directory\n${identity.key}`, () => this.call(
        uri,
        (adapter, path) => adapter.readDirectory(path),
      ));
      if (generation === this.generation(identity.authority)) {
        const ttl = this.cacheTtlMs();
        this.directories.set(identity.key, entries, ttl);
        const parent = identity.path === "/" ? "" : identity.path.replace(/\/$/, "");
        for (const entry of entries) {
          this.stats.set(`${identity.authority}\n${parent}/${entry.basename}`, entry, ttl);
        }
      }
    }
    return entries.map((entry) => [entry.basename, this.fileType(entry)]);
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const identity = this.requestIdentity(uri);
    const fresh = this.contents.getFresh(identity.key);
    if (fresh) {
      return fresh.contents.slice();
    }
    const result = await this.coalescer.run(`file\n${identity.key}`, async () => {
      const cached = this.contents.peek(identity.key);
      const generation = this.generation(identity.authority);
      const response = await this.call(
        uri,
        (adapter, path) => adapter.readFile(path, cached?.etag),
      );
      let value: ContentCacheEntry;
      if (response.status === 304) {
        if (!cached) {
          throw new Error(`WebDAV returned 304 without cached contents for ${uri.toString()}`);
        }
        value = cached;
      } else {
        if (!response.contents) {
          throw new Error(`WebDAV returned no contents for ${uri.toString()}`);
        }
        value = {
          contents: response.contents,
          etag: response.etag ?? normalizeEtag(this.stats.peek(identity.key)?.etag),
        };
      }
      if (generation === this.generation(identity.authority)) {
        if (value.contents.byteLength <= 1024 * 1024) {
          this.contents.set(identity.key, value, Math.min(this.cacheTtlMs(), 2000));
        } else {
          this.contents.delete(identity.key);
        }
      }
      return value.contents;
    });
    return result.slice();
  }

  public async resolveVerbDefinition(uri: vscode.Uri): Promise<vscode.Uri> {
    if (uri.scheme !== scheme) {
      return uri;
    }
    const paths = verbDefinitionPaths(uri.path);
    if (!paths) {
      return uri;
    }
    const contents = await this.readFile(uri.with({ path: paths.resolutionPath }));
    const definedOn = /^#(-?\d+)\s*$/.exec(new TextDecoder().decode(contents));
    if (!definedOn) {
      return uri;
    }
    return uri.with({ path: `/object/${definedOn[1]}/verb/${paths.verbName}` });
  }

  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    let exists = true;
    try {
      await this.stat(uri);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        exists = false;
      } else {
        throw error;
      }
    }
    if (exists && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }
    if (!exists && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const etag = this.etags.get(uri.toString());
    const written = await this.call(
      uri,
      (adapter, path) => adapter.writeFile(path, content, options.overwrite, etag),
      () => preconditionFailedError(uri, {
        kind: "write",
        exists,
        overwrite: options.overwrite,
        etag,
      }),
    );
    if (!written) {
      throw vscode.FileSystemError.FileExists(uri);
    }
    this.invalidateReadCaches(uri.authority);
    this.etags.delete(uri.toString());
    this.changes.fire([{ type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
  }

  public async delete(uri: vscode.Uri): Promise<void> {
    await this.call(uri, (adapter, path) => adapter.delete(path));
    this.invalidateReadCaches(uri.authority);
    this.etags.delete(uri.toString());
    this.changes.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  public async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    this.requireSameConnection(oldUri, newUri);
    await this.call(
      oldUri,
      (adapter, path) => adapter.move(
        path,
        canonicalObjectPath(newUri.path) ?? newUri.path,
        options.overwrite,
      ),
      () => preconditionFailedError(newUri, { kind: "destination", overwrite: options.overwrite }),
    );
    this.invalidateReadCaches(oldUri.authority);
    invalidateEtags(this.etags, oldUri, newUri);
    this.changes.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }

  public async copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    this.requireSameConnection(source, destination);
    await this.call(
      source,
      (adapter, path) => adapter.copy(
        path,
        canonicalObjectPath(destination.path) ?? destination.path,
        options.overwrite,
      ),
      () => preconditionFailedError(destination, { kind: "destination", overwrite: options.overwrite }),
    );
    this.invalidateReadCaches(source.authority);
    invalidateEtags(this.etags, destination);
    this.changes.fire([{ type: vscode.FileChangeType.Created, uri: destination }]);
  }

  private requireSameConnection(source: vscode.Uri, destination: vscode.Uri): void {
    if (source.authority.toLowerCase() !== destination.authority.toLowerCase()) {
      throw vscode.FileSystemError.Unavailable("Moving or copying between remote MOO connections is unsupported.");
    }
  }

  public createDirectory(): never {
    throw vscode.FileSystemError.NoPermissions("The remote MOO hierarchy is managed by its adapter.");
  }

  public watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  public dispose(): void {
    this.sessions.clear();
    this.clearReadCaches();
    this.generations.clear();
    this.changes.dispose();
  }
}

async function chooseProfile(placeHolder: string): Promise<ConnectionProfile | undefined> {
  const items = profiles().map((profile) => ({
    label: profile.authority,
    description: profile.endpoint,
    profile,
  }));
  return (await vscode.window.showQuickPick(items, { placeHolder }))?.profile;
}

async function addProfile(): Promise<ConnectionProfile | undefined> {
  const created = await promptForProfile();
  if (!created) {
    return undefined;
  }
  const current = profiles();
  if (current.some((profile) => profile.authority === created.authority)) {
    void vscode.window.showErrorMessage(`A connection named '${created.authority}' already exists.`);
    return undefined;
  }
  await saveProfiles([...current, created]);
  return created;
}

async function manageProfiles(
  secrets: vscode.SecretStorage,
  provider: LambdaMooFileSystem,
): Promise<void> {
  const action = await vscode.window.showQuickPick(
    ["Add Connection", "Edit Connection", "Remove Connection", "Sign In", "Sign Out"],
    { placeHolder: "Manage remote MOO connections" },
  );
  if (!action) {
    return;
  }
  if (action === "Add Connection") {
    await addProfile();
    return;
  }
  const selected = await chooseProfile(`${action}…`);
  if (!selected) {
    return;
  }
  if (action === "Edit Connection") {
    const edited = await promptForProfile(undefined, selected);
    if (!edited) {
      return;
    }
    const duplicate = profiles().some(
      (profile) => profile.authority === edited.authority && profile.authority !== selected.authority,
    );
    if (duplicate) {
      void vscode.window.showErrorMessage(`A connection named '${edited.authority}' already exists.`);
      return;
    }
    await saveProfiles(profiles().map((profile) => profile.authority === selected.authority ? edited : profile));
    provider.clearConnection(selected.authority);
    provider.clearConnection(edited.authority);
    if (secretKey(selected) !== secretKey(edited)) {
      await secrets.delete(secretKey(selected));
    }
  } else if (action === "Remove Connection") {
    await saveProfiles(profiles().filter((profile) => profile.authority !== selected.authority));
    await secrets.delete(secretKey(selected));
    provider.clearConnection(selected.authority);
  } else if (action === "Sign Out") {
    await secrets.delete(secretKey(selected));
    provider.clearConnection(selected.authority);
  } else {
    if (!selected.username) {
      void vscode.window.showInformationMessage(`${selected.authority} is configured for anonymous access.`);
      return;
    }
    const password = await vscode.window.showInputBox({
      password: true,
      title: `Sign in to ${selected.authority}`,
      prompt: selected.username ? `Password for ${selected.username}` : "Password",
    });
    if (password !== undefined) {
      try {
        await new WebDavAdapter(selected, password).stat("/");
        await secrets.store(secretKey(selected), password);
        provider.clearConnection(selected.authority);
        void vscode.window.showInformationMessage(`Signed in to ${selected.authority}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Could not sign in to ${selected.authority}: ${message}`);
      }
    }
  }
}

export function registerRemoteFileSystem(context: vscode.ExtensionContext): LambdaMooFileSystem {
  const provider = new LambdaMooFileSystem(context.secrets);
  context.subscriptions.push(
    provider,
    vscode.workspace.registerFileSystemProvider(scheme, provider, { isCaseSensitive: true }),
    vscode.commands.registerCommand("lambdamoo.openRemote", async () => {
      let profile = await chooseProfile("Select a remote MOO connection");
      profile ??= profiles().length === 0 ? await addProfile() : undefined;
      if (!profile) {
        return;
      }
      const uri = vscode.Uri.from({ scheme, authority: profile.authority, path: "/" });
      let provisionalPassword = false;
      if (profile.username && await context.secrets.get(secretKey(profile)) === undefined) {
        const password = await vscode.window.showInputBox({
          password: true,
          title: `Sign in to ${profile.authority}`,
          prompt: `Password for ${profile.username}`,
        });
        if (password === undefined) {
          return;
        }
        await context.secrets.store(secretKey(profile), password);
        provisionalPassword = true;
      }
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to ${profile.authority}…`,
          },
          () => provider.stat(uri),
        );
      } catch (error) {
        if (provisionalPassword) {
          await context.secrets.delete(secretKey(profile));
          provider.clearConnection(profile.authority);
        }
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Could not connect to ${profile.authority}: ${message}`);
        return;
      }
      if (!vscode.workspace.getWorkspaceFolder(uri)) {
        vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders?.length ?? 0,
          0,
          { uri, name: profile.authority },
        );
      }
    }),
    vscode.commands.registerCommand(
      "lambdamoo.manageRemoteConnections",
      () => manageProfiles(context.secrets, provider),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("lambdamoo.webdav.cacheTtlMs")) {
        provider.clearReadCaches();
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.uri.scheme === scheme && document.languageId !== "lambdamoo") {
        void vscode.languages.setTextDocumentLanguage(document, "lambdamoo");
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor || editor.document.uri.scheme !== scheme) {
        return;
      }
      const path = canonicalObjectPath(editor.document.uri.path);
      if (!path) {
        return;
      }
      const ownedUri = editor.document.uri;
      await vscode.window.showTextDocument(ownedUri.with({ path }), {
        preview: true,
        viewColumn: editor.viewColumn,
      });
      const ownedTabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter(
        (tab) => tab.input instanceof vscode.TabInputText
          && tab.input.uri.toString() === ownedUri.toString(),
      );
      if (ownedTabs.length > 0) {
        await vscode.window.tabGroups.close(ownedTabs);
      }
    }),
  );
  return provider;
}
