# OBS Plugin Installer

OBS Plugin Installer is a Tauri desktop MVP for safely discovering, installing, and updating a curated set of OBS Studio plugins without manually unpacking archives or guessing where OBS lives on disk.

## Product scope

This app is intentionally a focused desktop utility, not a marketplace or backend product.

It covers:

- first-time OBS detection
- curated plugin discovery
- plugin details and compatibility messaging
- one-click install for supported archive packages
- guided installer/package fallback for external vendor packages
- installed plugin tracking
- update-ready plugin view
- safe local persistence

It does not include:

- accounts
- billing
- backend services
- live catalog scraping
- developer submissions
- telemetry

## Stack

- Tauri v2
- React
- TypeScript
- Vite
- Tailwind CSS
- Rust commands for filesystem, downloads, extraction, validation, and local state

## Run locally

### Prerequisites

- Node.js 20+
- npm
- Rust toolchain (`rustup`, `cargo`)
- Tauri system prerequisites for your OS

### Install dependencies

```bash
npm install
```

### Development

```bash
npm run dev
```

That starts Vite and launches the Tauri desktop shell.

### Frontend-only build

```bash
npm run build:ui
```

### Desktop build smoke

```bash
npm run build
```

This produces a debug, no-bundle Tauri build for local MVP verification.

### Release build

```bash
npm run build:release
```

This runs a full Tauri release build and produces distributable bundles under `src-tauri/target/release/bundle/`.

## GitHub release automation

This repository includes a GitHub Actions workflow at `.github/workflows/release.yml`.

### What triggers the build

- Publishing a GitHub Release triggers the release workflow automatically.
- `workflow_dispatch` is also enabled so you can test the workflow manually from the Actions tab.

### What the workflow does

For each published release, GitHub Actions:

- runs on GitHub-hosted `windows-latest`, `ubuntu-latest`, and `macos-latest` runners
- installs Node.js, Rust, and the required Tauri build dependencies
- installs npm dependencies with `npm ci`
- verifies that the version metadata matches across:
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- verifies that the GitHub release tag matches the app version
- builds Tauri release bundles
- uploads the generated desktop artifacts back to the GitHub Release page

### What files get uploaded

The workflow currently uploads the standard desktop distributables produced by Tauri for this project:

- Windows: `*.exe`, `*.msi`
- Linux: `*.AppImage`, `*.deb`
- macOS: `*.dmg`

Artifacts appear directly on the GitHub Release that triggered the workflow.

## Versioning

Release builds are tied to the app version with `scripts/check-release-version.mjs`.

Before creating a GitHub Release, make sure the version is updated consistently in:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Recommended tag format:

- `v0.1.0`

The workflow will fail if the published GitHub Release tag does not match the app version.

## Push to GitHub

If you have not connected this local repo to GitHub yet:

1. Create an empty GitHub repository.
2. Add it as the remote for this project.
3. Push your default branch.

Example:

```bash
git remote add origin https://github.com/<your-user-or-org>/<your-repo>.git
git branch -M main
git add .
git commit -m "Set up Tauri GitHub release automation"
git push -u origin main
```

## Create a release

Once the repo is on GitHub:

1. Bump the app version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit and push the version change.
3. Create and push a matching tag, for example:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Create or publish the GitHub Release for that tag.
5. Wait for the `Release` workflow to finish.
6. Download the generated Windows, Linux, and macOS assets from the release page.

## First release checklist

Before the first GitHub release, do these manual steps:

- create the GitHub repo and push the default branch
- confirm GitHub Actions are enabled for the repository
- make the app version consistent across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
- create the first tagged GitHub Release using the same version
- optionally update package metadata like repository URL or license later if you want richer public package metadata

## Signing notes

This pipeline is designed to work without code signing for the initial Windows, Linux, and macOS release flow.

If you add signing later, keep the workflow structure and add the appropriate secrets for your chosen signing setup. Common additions later include:

- Tauri updater signing secrets such as `TAURI_SIGNING_PRIVATE_KEY`
- platform-specific signing credentials for Windows or macOS

Unsigned release automation is intentionally not blocked by those future signing steps.

## Project structure

```text
src/
  components/
  data/
    plugins.json
  lib/
  pages/
  stores/
  types/
src-tauri/
  src/
    commands/
      detect_obs.rs
      extract_archive.rs
      install_plugin.rs
      plugin_paths.rs
      state.rs
      store.rs
      validate_obs.rs
    models/
      plugin.rs
      state.rs
    utils/
      catalog.rs
      errors.rs
    lib.rs
    main.rs
public/
  screenshots/
scripts/
  check-release-version.mjs
  import_obs_resources.py
```

## What is fully implemented

- Tauri + React desktop architecture with Rust command handlers
- typed frontend-to-backend bridge using Tauri `invoke` and event listeners
- local curated catalog in `src/data/plugins.json`
- setup flow with automatic OBS detection and manual folder selection
- Rust-side OBS path validation
- local JSON persistence for:
  - selected OBS path
  - setup completion state
  - installed plugin history
  - install method and package metadata
- install progress events with:
  - preparing
  - downloading
  - extracting
  - inspecting
  - installing
  - completed
  - failed
- safe archive extraction with path traversal protection
- archive layout inspection before copying files
- overwrite conflict detection before reinstall/update
- Installed and Updates views based on tracked installs
- guided external package flow for vendor installers or distro packages

## Automated vs guided installs

### Fully automated in this MVP

- Windows ZIP installs for:
  - Move Transition
  - Advanced Scene Switcher
  - Multiple RTMP Output
  - Tuna
- macOS `.tar.xz` bundle install for:
  - Advanced Scene Switcher

### Guided package flow

These packages are downloaded and opened for the user, but the app does not claim the vendor flow completed automatically:

- Windows `.exe`
- macOS `.pkg`
- Linux `.deb`

### Guide-only

- StreamFX is intentionally guide-only because the latest upstream release currently does not ship direct binary assets in the curated flow used by this MVP.

## Supported OBS detection

### Windows

- common install roots under Program Files and Local AppData
- manual folder selection for custom locations
- portable/custom installs are handled conservatively

### macOS

- `/Applications/OBS.app`
- `~/Applications/OBS.app`
- manual selection of `OBS.app` or the OBS support folder

### Linux

- common native installs under `/usr` and `/usr/local`
- manual selection of `/usr`, `/usr/local`, or `~/.config/obs-studio`
- user plugin target under `~/.config/obs-studio/plugins`

### Linux assumptions

This MVP is intentionally conservative on Linux.

- native installs are the primary supported path
- guided `.deb` packages are supported for curated plugins
- Flatpak-style installs are detected, but automatic archive copying is not promised
- distro/package-manager-specific variations outside the common native path are treated as manual/guided rather than guessed

## Safe limitations

- automatic Linux archive remapping is intentionally limited to avoid unsafe assumptions
- guided external packages are tracked as `manual-step`, not falsely marked as fully installed
- update detection is based on the local install history recorded by this app
- the curated catalog is static and version-pinned in the repo

## Local state

The app stores its state as JSON under the app config directory resolved by Tauri for the current OS.

Stored data includes:

- selected OBS path
- setup completion state
- installed plugin records
- install timestamps
- install kind (`full` vs `guided`)
- package identifiers and download paths where relevant

## Curated starter catalog

The current MVP catalog includes:

- Move Transition
- Advanced Scene Switcher
- Multiple RTMP Output
- Tuna
- StreamFX

## Verification run in this workspace

These checks passed locally:

```bash
npm run lint
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
npm run build:ui
npm run build
```

## Notes on current build artifacts

- `dist/` is the current Vite renderer build output
- an older `dist-electron/` artifact may still exist from the previous Electron iteration, but it is unused by the Tauri app

## Next sensible improvements

- safe uninstall using tracked file manifests
- richer OBS version detection from the local installation
- more package-layout fixtures and automated Rust tests
- macOS DMG flow and broader native package support
- stronger Linux packaging heuristics per distro family
