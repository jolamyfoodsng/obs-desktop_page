import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function printHelp() {
  console.log(`Usage:
  npm run release -- <version>
  npm run release:dry -- <version>

Examples:
  npm run release -- 0.2.0
  npm run release -- v0.2.0
  npm run release:dry -- 0.2.0

What it does:
  1. Syncs version metadata across package.json, package-lock.json, tauri.conf.json, and Cargo.toml
  2. Verifies the release metadata
  3. Creates a git commit: release: v<version>
  4. Creates an annotated git tag: v<version>
  5. Pushes the branch and tag to origin

When the tag hits GitHub, Actions will build the desktop apps and create/update the GitHub Release automatically.
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const help = args.includes("--help") || args.includes("-h");
  const versionArg = args.find((arg) => !arg.startsWith("--")) ?? null;

  return { dryRun, help, versionArg };
}

function normalizeVersion(value) {
  return value.replace(/^v/, "").trim();
}

function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Invalid version "${version}". Use a semver value like 0.2.0 or v0.2.0.`,
    );
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  writeFileSync(
    path.join(rootDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function updateCargoVersion(relativePath, version) {
  const absolutePath = path.join(rootDir, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  const updated = source.replace(
    /^version\s*=\s*"[^"]+"$/m,
    `version = "${version}"`,
  );

  if (updated === source) {
    throw new Error(`Could not update the package version in ${relativePath}.`);
  }

  writeFileSync(absolutePath, updated, "utf8");
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runQuiet(command, args) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

function ensureCleanWorktree() {
  const status = runQuiet("git", ["status", "--porcelain"]);
  if (status) {
    throw new Error(
      "Your git working tree has uncommitted changes. Commit or stash them before running npm run release.",
    );
  }
}

function ensureOriginRemote() {
  const remote = runQuiet("git", ["remote", "get-url", "origin"]);
  if (!remote) {
    throw new Error("Git remote 'origin' is not configured.");
  }
}

function currentBranch() {
  const branch = runQuiet("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error("Could not determine the current git branch.");
  }

  return branch;
}

function ensureTagDoesNotExist(tag) {
  try {
    const existing = runQuiet("git", ["rev-parse", "--verify", "--quiet", tag]);
    if (existing) {
      throw new Error(`Git tag ${tag} already exists locally.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Git tag")) {
      throw error;
    }
  }

  const remoteTags = runQuiet("git", ["ls-remote", "--tags", "origin", tag]);
  if (remoteTags) {
    throw new Error(`Git tag ${tag} already exists on origin.`);
  }
}

function syncVersions(version, dryRun) {
  const packageJson = readJson("package.json");
  packageJson.version = version;
  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  tauriConfig.version = version;
  const packageLock = readJson("package-lock.json");
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }

  if (dryRun) {
    console.log(`[dry-run] Would set package.json version to ${version}`);
    console.log(`[dry-run] Would set package-lock.json version to ${version}`);
    console.log(`[dry-run] Would set src-tauri/tauri.conf.json version to ${version}`);
    console.log(`[dry-run] Would set src-tauri/Cargo.toml version to ${version}`);
    return;
  }

  writeJson("package.json", packageJson);
  writeJson("package-lock.json", packageLock);
  writeJson("src-tauri/tauri.conf.json", tauriConfig);
  updateCargoVersion("src-tauri/Cargo.toml", version);
}

function main() {
  const { dryRun, help, versionArg } = parseArgs(process.argv);

  if (help || !versionArg) {
    printHelp();
    process.exit(help ? 0 : 1);
  }

  const version = normalizeVersion(versionArg);
  const tag = `v${version}`;
  const branch = currentBranch();

  assertVersion(version);
  ensureOriginRemote();
  ensureTagDoesNotExist(tag);
  if (!dryRun) {
    ensureCleanWorktree();
  }

  syncVersions(version, dryRun);

  if (dryRun) {
    console.log(`[dry-run] Would run npm run check:release-version`);
    console.log(`[dry-run] Would commit release metadata as "release: ${tag}"`);
    console.log(`[dry-run] Would create annotated tag ${tag}`);
    console.log(`[dry-run] Would push ${branch} and ${tag} to origin`);
    return;
  }

  run(npmCommand(), ["run", "check:release-version"]);
  run("git", [
    "add",
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
  ]);
  run("git", ["commit", "-m", `release: ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
  run("git", ["push", "origin", branch]);
  run("git", ["push", "origin", tag]);

  console.log(`Release ${tag} created and pushed.`);
  console.log(
    "GitHub Actions will now build the desktop apps and create/update the GitHub Release automatically.",
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
