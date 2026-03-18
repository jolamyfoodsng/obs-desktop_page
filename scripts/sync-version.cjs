/**
 * sync-version.cjs — Keep package.json, tauri.conf.json, and Cargo.toml versions in sync.
 *
 * Usage:
 *   node scripts/sync-version.cjs
 *
 * Reads the version from package.json and writes it to:
 * - src-tauri/tauri.conf.json
 * - src-tauri/Cargo.toml
 */

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const pkgPath = path.join(rootDir, "package.json");
const tauriPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const cargoPath = path.join(rootDir, "src-tauri", "Cargo.toml");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));

let changed = false;

if (tauri.version !== pkg.version) {
  tauri.version = pkg.version;
  fs.writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);
  console.log(`✅ Synced tauri.conf.json version -> ${pkg.version}`);
  changed = true;
} else {
  console.log(`✅ tauri.conf.json already at ${pkg.version}`);
}

const cargoSource = fs.readFileSync(cargoPath, "utf8");
const cargoUpdated = cargoSource.replace(
  /^version\s*=\s*"[^"]+"$/m,
  `version = "${pkg.version}"`,
);

if (cargoUpdated !== cargoSource) {
  fs.writeFileSync(cargoPath, cargoUpdated);
  console.log(`✅ Synced Cargo.toml version -> ${pkg.version}`);
  changed = true;
} else {
  console.log(`✅ Cargo.toml already at ${pkg.version}`);
}

if (!changed) {
  console.log(`✅ Versions already in sync: ${pkg.version}`);
}
