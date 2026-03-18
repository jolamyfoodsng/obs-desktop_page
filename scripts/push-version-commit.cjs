/**
 * push-version-commit.cjs — Commit synced version files and push the current branch.
 *
 * Usage:
 *   node scripts/push-version-commit.cjs
 *
 * Commit message format:
 *   v<package.json version>
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const pkgPath = path.join(rootDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;
const commitMessage = `v${version}`;

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });
}

function runQuiet(command, args) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  }).trim();
}

function hasOrigin() {
  try {
    return Boolean(runQuiet("git", ["remote", "get-url", "origin"]));
  } catch {
    return false;
  }
}

function currentBranch() {
  const branch = runQuiet("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error("Could not determine the current git branch.");
  }

  return branch;
}

try {
  if (!hasOrigin()) {
    throw new Error("Git remote 'origin' is not configured.");
  }

  const branch = currentBranch();

  run("git", [
    "add",
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    ".github/workflows/release.yml",
  ]);

  run("git", ["commit", "-m", commitMessage]);

  try {
    run("git", ["push", "origin", branch]);
  } catch {
    run("git", ["push", "-u", "origin", branch]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
