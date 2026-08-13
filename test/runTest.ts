import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";
import { spawnSync } from "node:child_process";
import path from "node:path";

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(__dirname, "../..");
  const vscodeExecutablePath = await downloadAndUnzipVSCode();
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  const install = spawnSync(
    cli,
    [
      ...cliArgs,
      "--install-extension",
      "ms-vscode.wasm-wasi-core",
    ],
    { encoding: "utf8", stdio: "inherit", shell: process.platform === "win32" },
  );
  assertSuccessfulInstall(install.status, install.error);

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: repositoryRoot,
    extensionTestsPath: path.join(repositoryRoot, ".test-out", "test", "suite", "index.js"),
    launchArgs: [path.join(repositoryRoot, "test", "fixture"), "--disable-workspace-trust"],
  });
}

function assertSuccessfulInstall(status: number | null, error: Error | undefined): void {
  if (error) throw error;
  if (status !== 0) throw new Error(`Installing extension dependencies failed with code ${status}`);
}

function runUnderVirtualDisplay(): boolean {
  if (process.platform !== "linux" || process.env.DISPLAY || process.env.LAMBDAMOO_TEST_XVFB) {
    return false;
  }
  const result = spawnSync("xvfb-run", ["-a", process.execPath, __filename], {
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, LAMBDAMOO_TEST_XVFB: "1" },
  });
  if (result.error) {
    throw new Error(
      "Extension tests require DISPLAY or xvfb-run on Linux.",
      { cause: result.error },
    );
  }
  process.exitCode = result.status ?? 1;
  return true;
}

try {
  if (!runUnderVirtualDisplay()) {
    main().catch((error: unknown) => {
      console.error("Extension tests failed:", error);
      process.exitCode = 1;
    });
  }
} catch (error) {
  console.error("Extension tests failed:", error);
  process.exitCode = 1;
}
