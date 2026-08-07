# LambdaMOO Language Support

LambdaMOO Language Support is a Visual Studio Code extension for editing LambdaMOO (`.moo` or MOO code) source files. It provides syntax highlighting and code formatting.

## Installation

Open the **Extensions** view in Visual Studio Code, search for **LambdaMOO Language Support**, and select **Install**. You can also install it from:

* [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=kruton.vscode-lambdamoo)
* [Open VSX Registry](https://open-vsx.org/extension/kruton/vscode-lambdamoo)

## Development

Run `npm run compile` for the desktop extension and `npm run compile:web` for the browser bundle. The extension and language server are separate projects, so these commands only build the extension code.

When developing with VS Code, you can use "F5"" to trigger a workflow works with either "desktop" or "web" build. Leave `lambdamoo.server.path` empty to use the server bundled in a packaged extension, or set it to any local `moo-lsp-rs` executable to test a development build. The server checkout can live anywhere; changing the setting does not require a different build command.

The browser extension cannot execute an arbitrary host binary. It loads `bin/moo-lsp-rs.wasm` from the extension package. To test a development WebAssembly server, place that build at `bin/moo-lsp-rs.wasm` before running `npm run compile:web` or launching the web extension host.

## Related projects

- [kruton/moo-lsp-rs](https://github.com/kruton/moo-lsp-rs) — the LambdaMOO language server
- [kruton/tree-sitter-lambdamoo](https://github.com/kruton/tree-sitter-lambdamoo) — the LambdaMOO Tree-sitter grammar
