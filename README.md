# LambdaMOO Language Support

LambdaMOO Language Support is a Visual Studio Code extension for editing LambdaMOO (`.moo` or MOO code) source files. It provides syntax highlighting and code formatting.

## Installation

Open the **Extensions** view in Visual Studio Code, search for **LambdaMOO Language Support**, and select **Install**. You can also install it from:

* [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=kruton.vscode-lambdamoo)
* [Open VSX Registry](https://open-vsx.org/extension/kruton/vscode-lambdamoo)

## Remote objects

Run **LambdaMOO: Manage Remote MOO Connections** to add a connection that maps a `moo://` authority to a WebDAV endpoint and to manage its credentials. Connection metadata is stored in the `lambdamoo.connections` user setting; passwords are stored in VS Code's encrypted, machine-local secret storage. Run **LambdaMOO: Open Remote MOO** to add a configured connection to the Explorer.

Remote resources use transport-independent URIs such as `moo://codepoint/object/123/verb/look`. The URI path maps directly beneath the configured WebDAV endpoint. Verb files can be opened and saved directly. Properties are directories whose typed value children, such as `/property/name/string` or `/property/name/object-id`, are the editable files. Inherited resources and metadata remain read-only when enforced by the server. The language client includes the `moo:` scheme, so document locations returned by `moo-lsp-rs` are handled by the same remote filesystem provider.

Properties are directories containing `type`, `object-id`, and, for object-valued properties, an `object/` traversal directory. Use `object/` for every referenced-object traversal segment; the older `obj/` spelling is not supported. For example, `moo://codepoint/object/0/property/local/object/property/webdav/object/verb/handle` follows `$local` to `$local.webdav` and opens its `handle` verb.

## Development

Run `npm run compile` for the desktop extension and `npm run compile:web` for the browser bundle. The extension and language server are separate projects, so these commands only build the extension code.

Both the desktop and browser extensions use the WebAssembly language server supplied by `@kruton/moo-lsp` and run it in process, so they do not require platform-specific executables or separately downloaded server artifacts. When developing with VS Code, press `F5` to launch the desktop extension development host.

## Related projects

- [kruton/moo-lsp-rs](https://github.com/kruton/moo-lsp-rs) — the LambdaMOO language server
- [kruton/tree-sitter-lambdamoo](https://github.com/kruton/tree-sitter-lambdamoo) — the LambdaMOO Tree-sitter grammar
