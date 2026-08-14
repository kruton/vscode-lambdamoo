import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const desktop = process.argv.includes("--desktop");

async function main() {
  const outfile = desktop ? "out/extension.js" : "out/web/extension.js";
  const context = await esbuild.context({
    entryPoints: [desktop ? "src/extension.ts" : "src/webExtension.ts"],
    bundle: true,
    format: "cjs",
    platform: desktop ? "node" : "browser",
    target: "es2022",
    outfile,
    external: ["vscode"],
    banner: desktop
      ? { js: "const __mooLspImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" }
      : undefined,
    minify: production,
    sourcemap: production ? false : "linked",
    sourcesContent: false,
    define: {
      global: "globalThis",
      ...(desktop
        ? { "import.meta.url": "__mooLspImportMetaUrl" }
        : {}),
    },
  });

  if (desktop) {
    const wasmOutput = "out/raw/moo_lsp_rs_bg.wasm";
    await mkdir(dirname(wasmOutput), { recursive: true });
    await copyFile(
      "node_modules/@kruton/moo-lsp/raw/moo_lsp_rs_bg.wasm",
      wasmOutput,
    );
  }

  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
