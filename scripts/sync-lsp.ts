import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

type ArtifactManifest = {
  repository: string;
  version: string;
};

const archiveName = "moo-lsp-rs-web.tar.gz";
const archivePathInRelease = "web/moo-lsp-rs.wasm";
const wasmName = "moo-lsp-rs.wasm";
const execFileAsync = promisify(execFile);
const workspace = process.cwd();
const binDir = resolve(workspace, "bin");

function parseArgs(): { fromDir?: string } {
  const args = process.argv.slice(2);
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--from-dir" && args[1]) {
    return { fromDir: args[1] };
  }
  throw new Error("Usage: npm run sync:lsp [-- --from-dir <directory>]");
}

async function findWasm(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name === wasmName) return fullPath;
    if (entry.isDirectory()) {
      const found = await findWasm(fullPath);
      if (found) return found;
    }
  }
  return undefined;
}

async function copyFromLocalDir(localPath: string): Promise<void> {
  const resolvedPath = resolve(localPath);
  if (!(await stat(resolvedPath)).isDirectory()) {
    throw new Error(`Local path ${localPath} is not a directory`);
  }

  const sourcePath = await findWasm(resolvedPath);
  if (!sourcePath) throw new Error(`${wasmName} was not found in ${localPath}`);

  await mkdir(binDir, { recursive: true });
  await cp(sourcePath, resolve(binDir, wasmName));
  process.stdout.write(`Staged local ${wasmName} from ${sourcePath}\n`);
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
  process.stdout.write(`Downloaded ${basename(destination)}\n`);
}

async function main(): Promise<void> {
  const { fromDir } = parseArgs();
  if (fromDir) {
    await copyFromLocalDir(fromDir);
    return;
  }

  const manifest = JSON.parse(
    await readFile(resolve(workspace, "lsp-artifact.json"), "utf8"),
  ) as ArtifactManifest;
  const releaseBase = `https://github.com/${manifest.repository}/releases/download/${manifest.version}`;
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "vscode-lambdamoo-lsp-"));

  try {
    const checksumsPath = resolve(temporaryDirectory, "SHA256SUMS");
    const archivePath = resolve(temporaryDirectory, archiveName);
    await download(`${releaseBase}/SHA256SUMS`, checksumsPath);
    await download(`${releaseBase}/${archiveName}`, archivePath);

    const checksumLines = (await readFile(checksumsPath, "utf8")).split(/\r?\n/);
    const expectedLine = checksumLines.find((line) => line.trim().endsWith(` ${archiveName}`));
    if (!expectedLine) throw new Error(`${archiveName} is missing from SHA256SUMS`);

    const expected = expectedLine.trim().split(/\s+/)[0];
    const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${archiveName}: expected ${expected}, got ${actual}`);
    }

    if (process.env.CI) {
      await execFileAsync("gh", [
        "attestation",
        "verify",
        archivePath,
        "--repo",
        manifest.repository,
      ]);
    }

    const extractDir = resolve(temporaryDirectory, "extracted");
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);
    await mkdir(binDir, { recursive: true });
    await cp(resolve(extractDir, archivePathInRelease), resolve(binDir, wasmName));
    process.stdout.write(
      `Staged ${manifest.repository} ${manifest.version} to bin/${wasmName}\n`,
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

await main();
