import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

type ArtifactManifest = {
  repository: string;
  version: string;
};

type TargetSpec = {
  archive: string;
  internalPath: string;
  executable: string;
};

const TARGET_SPECS: Record<string, TargetSpec> = {
  "linux-x64": {
    archive: "moo-lsp-rs-linux-x64.tar.gz",
    internalPath: "linux-x64/moo-lsp-rs",
    executable: "moo-lsp-rs",
  },
  "linux-arm64": {
    archive: "moo-lsp-rs-linux-arm64.tar.gz",
    internalPath: "linux-arm64/moo-lsp-rs",
    executable: "moo-lsp-rs",
  },
  "linux-armhf": {
    archive: "moo-lsp-rs-linux-armhf.tar.gz",
    internalPath: "linux-armhf/moo-lsp-rs",
    executable: "moo-lsp-rs",
  },
  "alpine-x64": {
    archive: "moo-lsp-rs-alpine-x64.tar.gz",
    internalPath: "alpine-x64/moo-lsp-rs",
    executable: "moo-lsp-rs",
  },
  "alpine-arm64": {
    archive: "moo-lsp-rs-alpine-arm64.tar.gz",
    internalPath: "alpine-arm64/moo-lsp-rs",
    executable: "moo-lsp-rs",
  },
  "darwin-x64": {
    archive: "moo-lsp-rs-darwin-x64.tar.gz",
    internalPath: "darwin-x64/moo-lsp-rs",
    executable: "moo-lsp-rs",
  },
  "darwin-arm64": {
    archive: "moo-lsp-rs-darwin-arm64.tar.gz",
    internalPath: "darwin-arm64/moo-lsp-rs",
    executable: "moo-lsp-rs",
  },
  "win32-x64": {
    archive: "moo-lsp-rs-win32-x64.zip",
    internalPath: "win32-x64/moo-lsp-rs.exe",
    executable: "moo-lsp-rs.exe",
  },
  "win32-arm64": {
    archive: "moo-lsp-rs-win32-arm64.zip",
    internalPath: "win32-arm64/moo-lsp-rs.exe",
    executable: "moo-lsp-rs.exe",
  },
  web: {
    archive: "moo-lsp-rs-web.tar.gz",
    internalPath: "web/moo-lsp-rs.wasm",
    executable: "moo-lsp-rs.wasm",
  },
};

const execFileAsync = promisify(execFile);
const workspace = process.cwd();
const binDir = resolve(workspace, "bin");

function getHostTarget(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux") {
    if (arch === "x64") return "linux-x64";
    if (arch === "arm64") return "linux-arm64";
    if (arch === "arm") return "linux-armhf";
  } else if (platform === "darwin") {
    if (arch === "x64") return "darwin-x64";
    if (arch === "arm64") return "darwin-arm64";
  } else if (platform === "win32") {
    if (arch === "x64") return "win32-x64";
    if (arch === "arm64") return "win32-arm64";
  }
  throw new Error(`Unsupported host platform/architecture: ${platform}/${arch}`);
}

function parseArgs(): { targets: string[]; fromDir?: string } {
  const args = process.argv.slice(2);
  let fromDir: string | undefined;
  const targetArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from-dir") {
      fromDir = args[i + 1];
      if (!fromDir) throw new Error("--from-dir requires a directory path");
      i++;
    } else if (args[i] === "--target") {
      const target = args[i + 1];
      if (!target) throw new Error("--target requires a target name");
      targetArgs.push(target);
      i++;
    }
  }

  let targets: string[];
  if (targetArgs.length > 0) {
    if (targetArgs.includes("all")) {
      targets = Object.keys(TARGET_SPECS);
    } else {
      targets = targetArgs;
    }
  } else {
    const hostTarget = getHostTarget();
    targets = Array.from(new Set([hostTarget, "web"]));
  }

  return { targets, fromDir };
}

async function findFilesInDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFilesInDir(fullPath)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

async function copyFromLocalDir(localPath: string): Promise<void> {
  const resolvedPath = resolve(localPath);
  const pathStat = await stat(resolvedPath);
  if (!pathStat.isDirectory()) {
    throw new Error(`Local path ${localPath} is not a directory`);
  }

  await mkdir(binDir, { recursive: true });
  const allFiles = await findFilesInDir(resolvedPath);
  const knownExecutables = new Set(["moo-lsp-rs", "moo-lsp-rs.exe", "moo-lsp-rs.wasm"]);
  let copiedCount = 0;

  for (const filePath of allFiles) {
    const fileName = basename(filePath);
    if (knownExecutables.has(fileName)) {
      const destPath = join(binDir, fileName);
      await cp(filePath, destPath);
      if (fileName !== "moo-lsp-rs.wasm" && process.platform !== "win32") {
        await chmod(destPath, 0o755);
      }
      process.stdout.write(`Copied ${fileName} to bin/${fileName}\n`);
      copiedCount++;
    }
  }

  if (copiedCount === 0) {
    throw new Error(`No moo-lsp-rs binaries found in ${localPath}`);
  }
  process.stdout.write(`Staged local LSP artifacts from ${localPath}\n`);
}

async function download(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  await writeFile(destPath, new Uint8Array(await response.arrayBuffer()));
  process.stdout.write(`Downloaded ${basename(destPath)}\n`);
}

async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      try {
        await execFileAsync("tar", ["-xf", archivePath, "-C", extractDir]);
      } catch {
        await execFileAsync("powershell", [
          "-Command",
          `Expand-Archive -Path "${archivePath}" -DestinationPath "${extractDir}" -Force`,
        ]);
      }
    } else {
      await execFileAsync("unzip", ["-q", archivePath, "-d", extractDir]);
    }
  } else {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);
  }
}

async function main(): Promise<void> {
  const { targets, fromDir } = parseArgs();

  if (fromDir) {
    await copyFromLocalDir(fromDir);
    return;
  }

  const manifest = JSON.parse(
    await readFile(resolve(workspace, "lsp-artifact.json"), "utf8"),
  ) as ArtifactManifest;

  for (const target of targets) {
    if (!TARGET_SPECS[target]) {
      throw new Error(`Unknown target: ${target}. Valid targets: ${Object.keys(TARGET_SPECS).join(", ")}`);
    }
  }

  await mkdir(binDir, { recursive: true });
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "vscode-lambdamoo-lsp-"));

  try {
    const releaseBase = `https://github.com/${manifest.repository}/releases/download/${manifest.version}`;
    const checksumsPath = resolve(temporaryDirectory, "SHA256SUMS");
    await download(`${releaseBase}/SHA256SUMS`, checksumsPath);

    const checksumContent = await readFile(checksumsPath, "utf8");
    const checksumLines = checksumContent.split(/\r?\n/);

    const downloadedArchives = new Set<string>();

    for (const target of targets) {
      const spec = TARGET_SPECS[target];
      const archiveName = spec.archive;
      const archivePath = resolve(temporaryDirectory, archiveName);

      if (!downloadedArchives.has(archiveName)) {
        await download(`${releaseBase}/${archiveName}`, archivePath);
        downloadedArchives.add(archiveName);

        const expectedLine = checksumLines.find((line) => line.trim().endsWith(` ${archiveName}`));
        if (!expectedLine) throw new Error(`${archiveName} is missing from SHA256SUMS`);
        const expected = expectedLine.trim().split(/\s+/)[0];
        const actual = createHash("sha256")
          .update(await readFile(archivePath))
          .digest("hex");

        if (actual !== expected) {
          throw new Error(
            `Checksum mismatch for ${archiveName}: expected ${expected}, got ${actual}`,
          );
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
      }

      const extractDir = resolve(temporaryDirectory, `extracted-${target}`);
      await mkdir(extractDir, { recursive: true });
      await extractArchive(archivePath, extractDir);

      const sourceBinaryPath = resolve(extractDir, spec.internalPath);
      const destBinaryPath = resolve(binDir, spec.executable);

      await cp(sourceBinaryPath, destBinaryPath);
      if (spec.executable !== "moo-lsp-rs.wasm" && process.platform !== "win32") {
        await chmod(destBinaryPath, 0o755);
      }

      process.stdout.write(`Staged ${manifest.repository} ${manifest.version} (${target}) to bin/${spec.executable}\n`);
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

await main();
