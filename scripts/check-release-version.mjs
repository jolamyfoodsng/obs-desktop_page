import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function readJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

function readCargoPackageVersion(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/);
  let inPackageSection = false;

  for (const line of lines) {
    if (/^\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      continue;
    }

    if (inPackageSection && /^\[[^\]]+\]\s*$/.test(line)) {
      break;
    }

    if (inPackageSection) {
      const versionMatch = line.match(/^version\s*=\s*"([^"]+)"/);

      if (versionMatch) {
        return versionMatch[1];
      }
    }
  }

  throw new Error(`Could not find package version in ${relativePath}`);
}

function normalizeTag(tag) {
  return tag.replace(/^refs\/tags\//, "").replace(/^v/, "");
}

try {
  const packageJsonVersion = readJson("package.json").version;
  const tauriVersion = readJson("src-tauri/tauri.conf.json").version;
  const cargoVersion = readCargoPackageVersion("src-tauri/Cargo.toml");

  const uniqueVersions = new Set([packageJsonVersion, tauriVersion, cargoVersion]);

  if (uniqueVersions.size !== 1) {
    throw new Error(
      [
        "Version metadata is out of sync.",
        `package.json: ${packageJsonVersion}`,
        `src-tauri/tauri.conf.json: ${tauriVersion}`,
        `src-tauri/Cargo.toml: ${cargoVersion}`,
      ].join("\n"),
    );
  }

  const releaseTag = (process.env.RELEASE_TAG || "").trim();

  if (releaseTag) {
    const normalizedTag = normalizeTag(releaseTag);

    if (normalizedTag !== packageJsonVersion) {
      throw new Error(
        `Release tag ${releaseTag} does not match app version ${packageJsonVersion}. ` +
          "Use a tag like v0.1.0 after updating the app version metadata.",
      );
    }
  }

  console.log(`Release metadata is aligned at version ${packageJsonVersion}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
