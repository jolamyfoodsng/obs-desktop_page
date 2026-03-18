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

## Feedback / requests backend

The desktop app now includes an in-app feedback screen backed by a lightweight Vercel Function.

### Chosen approach

- Vercel serverless API for the intake route, because this repo already ships Vercel functions for desktop updates
- Email relay delivery via Resend, because early-stage support traffic is usually best handled in a shared inbox instead of building a queue database too early
- No secrets in the Tauri client; the desktop app only posts JSON to the public support endpoint

### Support route

- `api/support.ts`
  - accepts `POST` JSON submissions
  - validates all incoming fields server-side
  - applies lightweight in-memory rate limiting
  - relays valid requests to the configured support inbox

Supported submission kinds:

- `problem-report`
- `general-feedback`
- `plugin-request`

### Required environment variables

Set these in the Vercel project used by the desktop app:

- `RESEND_API_KEY`
- `SUPPORT_INBOX_EMAIL`
- `SUPPORT_FROM_EMAIL`
- `VITE_SUPPORT_API_BASE_URL` for the desktop build, for example `https://updates.example.com`
- optional runtime override: `SUPPORT_API_BASE_URL`

Set `VITE_SUPPORT_API_BASE_URL` in the GitHub Actions repository variables too, otherwise packaged desktop releases will not have the production support endpoint baked into the frontend bundle. The Tauri app also now checks runtime `SUPPORT_API_BASE_URL` first and falls back to `TAURI_UPDATE_BASE_URL` when both APIs live on the same Vercel deployment.

### Production-safe MVP behavior

- all validation happens on the server
- plugin requests require a valid `http` or `https` URL
- reply emails are required so support can follow up on every submission
- submissions land in the support inbox for triage and follow-up

## Private update system

This app now supports a private, Vercel-backed update pipeline for Tauri v2.

### Architecture

1. GitHub Releases stay the source of truth for signed desktop artifacts.
2. A Vercel serverless API reads private release metadata using a server-side GitHub token.
3. The Tauri app talks only to the Vercel API.
4. The app blocks old builds when `currentVersion < minimumSupportedVersion`.

### Vercel API routes

These routes live in `api/` and are designed for Vercel Functions:

- `api/update.ts`
  - returns normalized release metadata
  - includes `latestVersion`, `minimumSupportedVersion`, release notes, and platform manifests
- `api/update/[target]/[arch]/[bundleType]/[currentVersion].ts`
  - returns the Tauri updater-compatible manifest for the current client
  - returns `204 No Content` when no update is available
- `api/download/[target]/[arch]/[bundleType]/[version].ts`
  - securely proxies the selected private GitHub Release asset to the app
  - keeps the GitHub token server-side only

The metadata route also returns actionable statuses for cases like:

- no installable asset for the current platform
- ambiguous assets
- source-only releases

### Required Vercel environment variables

Set these in the Vercel project:

- `GITHUB_TOKEN`
  - GitHub token with read access to the private desktop repo releases
- `GITHUB_OWNER`
  - repo owner or org
- `GITHUB_REPO`
  - repo name

Optional Vercel environment variables:

- `PUBLIC_BASE_URL`
  - public Vercel domain, for example `https://updates.example.com`
  - if omitted, the API derives it from the incoming request host
- `UPDATE_CHANNEL`
  - defaults metadata selection to `stable`
  - supported values in this implementation: `stable`, `beta`
- `MINIMUM_SUPPORTED_VERSION`
  - global fallback minimum supported version
  - defaults to `0.0.0` when not set

### Release frontmatter for forced updates

You can set the minimum supported version per release in the GitHub Release body:

```md
---
minimumSupportedVersion: 1.1.0
---

Bug fixes and installer improvements.
```

If that frontmatter is absent, the Vercel API falls back to `MINIMUM_SUPPORTED_VERSION`, then to `0.0.0`.

## Desktop updater behavior

### Launch flow

On app launch, the desktop app:

- loads local state
- checks the private update metadata route
- compares `currentVersion`, `latestVersion`, and `minimumSupportedVersion`
- decides one of:
  - no update
  - optional update
  - required update

### Optional updates

If `currentVersion < latestVersion` but `currentVersion >= minimumSupportedVersion`, the app shows a compact in-app update dialog with:

- `Update now`
- `Remind me later`

Downloads happen inside the app. After the download finishes, the user sees `Restart to finish updating`.

### Required updates

If `currentVersion < minimumSupportedVersion`, the app blocks normal usage behind a required update screen.

The required update screen only allows:

- `Update now`
- `Retry`

There is also a development-only bypass for local dev builds when the app is already in developer mode.

### Settings page

The Settings screen now includes:

- current app version
- current update channel
- `Check for updates`
- current update status
- selected asset and reason when an update is found

## GitHub release automation

This repository includes a GitHub Actions workflow at `.github/workflows/release.yml`.

### What triggers the build

- Every push to GitHub now triggers the workflow automatically.
- Push builds run on GitHub-hosted `windows-latest`, `ubuntu-latest`, and `macos-latest` runners.
- Pushes to `main` also publish a new GitHub release automatically after all platform builds succeed.
- Other branch pushes upload the compiled desktop bundles as GitHub Actions run artifacts.
- Pushing a version tag like `v0.2.0` triggers a release build and creates or updates the GitHub Release automatically.
- `workflow_dispatch` is also enabled so you can test the workflow manually from the Actions tab.

### What the workflow does

For every push and version-tag push, GitHub Actions:

- runs on GitHub-hosted `windows-latest`, `ubuntu-latest`, and `macos-latest` runners
- installs Node.js, Rust, and the required Tauri build dependencies
- installs npm dependencies with `npm ci`
- verifies that the version metadata matches across:
  - `package.json`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
- verifies that the GitHub release tag matches the app version
- builds Tauri release bundles
- generates updater signatures because `bundle.createUpdaterArtifacts` is enabled
- uploads installer artifacts and `.sig` files to the workflow run on normal branch pushes
- creates a new release entry after successful `main` builds using the current app version and GitHub Actions run number
- uploads both installer artifacts and `.sig` files to a GitHub Release automatically when the pushed ref is a version tag like `v0.2.0`

### Simple version bump flow

If you want the app to bump version numbers, commit, push, and let GitHub Actions compile automatically on push, use:

```bash
npm run release:patch
```

or:

```bash
npm run release:minor
npm run release:major
```

Those commands will:

- bump `package.json` and `package-lock.json`
- sync `src-tauri/tauri.conf.json`
- sync `src-tauri/Cargo.toml`
- create a git commit named like `v0.2.0`
- push the current branch to `origin`

After the push reaches GitHub, Actions will automatically build the desktop apps and upload the bundles to the workflow run artifacts.

You can also run the version sync alone:

```bash
npm run sync:version
```

### Tagged release flow

If you also want GitHub to create or update a Release page and attach the built installers automatically, use:

Run:

```bash
npm run release -- 0.2.0
```

That command will:

- sync the app version across `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
- verify the release metadata
- create a git commit named `release: v0.2.0`
- create an annotated git tag `v0.2.0`
- push the branch and tag to `origin`

After the tag reaches GitHub, Actions will:

- build Windows, Linux, and macOS bundles
- create or update a GitHub Release named `Release v0.2.0`
- attach the generated installers and signature files automatically

If you want to preview the steps without changing anything, run:

```bash
npm run release:dry -- 0.2.0
```

### GitHub Actions variables and secrets

Set these on the GitHub repo before running release builds:

- repository variables:
  - `TAURI_UPDATE_BASE_URL`
    - public Vercel update server URL, for example `https://updates.example.com`
  - `TAURI_UPDATER_PUBLIC_KEY`
    - public updater signing key used by the Tauri client
- repository secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
    - private updater signing key
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
    - password for the signing key, if used

Optional GitHub Actions variable:

- `TAURI_UPDATE_BUNDLE_TYPE`
  - this implementation defaults Windows metadata to `nsis`, Linux to `appimage`, and macOS to `app`
  - the real updater install path still uses Tauri's own runtime bundle type during manifest checks

### What files the Vercel API expects

The update server expects the GitHub Release to contain signed installer assets such as:

- Windows:
  - `*.exe`
  - `*.msi`
  - matching `*.sig`
- Linux:
  - `*.AppImage`
  - `*.deb`
  - `*.rpm` if you add RPM builds later
  - matching `*.sig`
- macOS scaffold:
  - `*.app.tar.gz`
  - matching `*.sig`

This implementation intentionally ignores source-code archives when installable binaries exist.

### Push builds vs release builds

- On a normal `git push` to a non-`main` branch, the workflow compiles Windows, Linux, and macOS bundles and stores them in the GitHub Actions run under `Artifacts`.
- On a `git push` to `main`, the workflow compiles Windows, Linux, and macOS bundles, then automatically creates a new release entry for that build and marks it as the latest release.
- On a pushed version tag like `v0.2.0`, the workflow compiles those bundles and attaches them directly to the GitHub Release page.
- If signing secrets are not configured yet, the workflow can still be used for compile verification, but updater signing-dependent release distribution may need those secrets before you ship to users.

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

4. Wait for the `Desktop Builds` workflow to finish.
5. Download the generated Windows, Linux, and macOS assets from the release page.

If you do not want to create a versioned tag yet, simply push to `main` and the workflow will publish a new successful release build automatically.

## First release checklist

Before the first GitHub release, do these manual steps:

- create the GitHub repo and push the default branch
- confirm GitHub Actions are enabled for the repository
- make the app version consistent across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
- optionally create the first tagged GitHub Release using the same version if you want a permanent versioned release in addition to the automatic `main` build releases
- optionally update package metadata like repository URL or license later if you want richer public package metadata

## Local and production testing

### Test the Vercel API locally

1. Export the required Vercel environment variables locally.
2. Run the Vercel Functions locally with:

```bash
vercel dev
```

3. Verify the metadata route manually:

```bash
curl "http://localhost:3000/api/update?currentVersion=0.1.0&target=windows&arch=x86_64&bundleType=nsis"
```

### Test the desktop app locally

Set these environment variables before starting the Tauri app locally:

- `TAURI_UPDATE_BASE_URL`
- `TAURI_UPDATER_PUBLIC_KEY`
- optional `TAURI_UPDATE_BUNDLE_TYPE`

Then run:

```bash
npm run dev
```

Recommended local checks:

- optional update:
  - run a build below the newest release version
  - confirm the optional in-app prompt appears
- forced update:
  - publish or pin a release whose `minimumSupportedVersion` is higher than the local app version
  - confirm the required update screen blocks the app
- missing asset:
  - test a release without a platform asset and confirm the message is actionable

### Production verification

Before shipping a new release:

- confirm the GitHub Release contains the expected installer files and `.sig` files
- confirm the Vercel metadata route returns the correct `latestVersion`
- confirm the Tauri dynamic updater route returns `204` for current builds and `200` for older ones
- test one Windows and one Linux installation end-to-end:
  - check
  - download
  - apply
  - restart

## Signing and final production setup

This updater flow is production-minded, but you still need real release-signing inputs in GitHub Actions:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if your key uses one

You may also still want platform-native signing later:

- Windows code signing
- macOS notarization and signing

The updater flow is already structured so those later steps can be layered on without changing the Vercel API contract.

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
