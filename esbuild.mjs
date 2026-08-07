import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const desktop = process.argv.includes("--desktop");

async function main() {
  const context = await esbuild.context({
    entryPoints: [desktop ? "src/extension.ts" : "src/webExtension.ts"],
    bundle: true,
    format: "cjs",
    platform: desktop ? "node" : "browser",
    target: "es2022",
    outfile: desktop ? "out/extension.js" : "out/web/extension.js",
    external: ["vscode"],
    minify: production,
    sourcemap: production ? false : "linked",
    sourcesContent: false,
    define: {
      global: "globalThis",
    },
  });

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
