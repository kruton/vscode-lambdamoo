# Repository Guidelines

## Project Structure & Module Organization

This repository contains a VS Code extension for LambdaMOO language support. Extension metadata and contributions live in `package.json`; editor behavior such as comments, brackets, and indentation is defined in `language-configuration.json`. TypeScript configuration is in `tsconfig.json`.

Place extension source in `src/`, with `src/extension.ts` as the expected activation entry point. The compiler writes generated JavaScript and source maps to `out/`; do not edit or commit generated files unless the release process explicitly requires them. Packaged language-server binaries belong in `bin/`. When tests are added, keep them under `src/test/` or a top-level `test/` directory and mirror the source layout.

## Build, Test, and Development Commands

- `npm install` installs dependencies exactly as described by `package-lock.json`.
- `npm run compile` type-checks strict TypeScript and emits the extension into `out/`.
- `npm run watch` recompiles continuously during development.
- `npm run compile:web` type-checks and bundles the browser extension.
- `npm run check` compiles both the desktop and browser extensions.
- `npm run vscode:prepublish` performs the production prepublish compile.

There is currently no extension test runner or lint script. Add the corresponding `package.json` scripts when introducing either capability. For manual validation, set `lambdamoo.server.path` to a local development server when needed, open the project in VS Code, and press `F5`; the launch task builds the extension before starting an Extension Development Host.

## Coding Style & Naming Conventions

Use strict TypeScript targeting ES2022 and NodeNext modules. Follow the existing JSON style: two-space indentation, double quotes, and trailing newlines. Use `camelCase` for variables and functions, `PascalCase` for classes and types, and descriptive lowercase filenames such as `languageClient.ts`. Prefer small modules, explicit types at public boundaries, and `async`/`await` for asynchronous work.

## Testing Guidelines

Add regression coverage with every behavioral fix. Name tests after the unit under test, for example `src/test/languageClient.test.ts`, and keep fixtures focused and minimal. Until a test runner is configured, document reproducible manual checks in the pull request and verify `npm run compile` succeeds.

## Commit & Pull Request Guidelines

No repository commit history is currently available to establish a local convention. Use concise, imperative subjects such as `Add LambdaMOO client activation`, and keep each commit focused. Pull requests should explain the user-visible change, list validation performed, and link relevant issues. Include screenshots or short recordings for editor UI changes, and call out changes to packaged binaries or extension metadata.
