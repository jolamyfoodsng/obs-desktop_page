import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReleaseAssetCatalog,
  classifyReleaseAsset,
  resolveManualFallbackForTarget,
  resolveSelectionForTarget,
  resolveSupportedTarget,
} from './update-server.ts'

let nextAssetId = 1

function createAsset(name: string) {
  const id = nextAssetId++
  return {
    id,
    name,
    size: 1024,
    browser_download_url: `https://example.test/download/${encodeURIComponent(name)}`,
    url: `https://example.test/api/assets/${id}`,
  }
}

function createRelease(tagName: string, assetNames: string[]) {
  nextAssetId = 1
  return {
    tag_name: tagName,
    name: tagName,
    draft: false,
    prerelease: false,
    html_url: 'https://example.test/release',
    assets: assetNames.map((name) => createAsset(name)),
  }
}

function getTarget(target: string, arch: string, bundleType: string) {
  const resolved = resolveSupportedTarget(target, arch, bundleType)
  assert.ok(resolved, `expected supported target for ${target}/${arch}/${bundleType}`)
  return resolved
}

test('macOS ARM64 chooses app.tar.gz for update and dmg for manual install', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.28.0', [
      'OBS.Plugin.Installer.app.tar.gz',
      'OBS.Plugin.Installer.app.tar.gz.sig',
      'OBS.Plugin.Installer_0.28.0_aarch64.dmg',
      'OBS.Plugin.Installer_0.28.0_x64.dmg',
    ]),
  )
  const target = getTarget('darwin', 'arm64', 'app')

  const selected = resolveSelectionForTarget(catalog, target)
  const manual = resolveManualFallbackForTarget(catalog, target)

  assert.equal(selected.kind, 'selected')
  assert.equal(selected.candidate?.asset.name, 'OBS.Plugin.Installer.app.tar.gz')
  assert.equal(selected.candidate?.signatureAsset.name, 'OBS.Plugin.Installer.app.tar.gz.sig')
  assert.equal(manual?.asset.name, 'OBS.Plugin.Installer_0.28.0_aarch64.dmg')
})

test('Windows x64 chooses the EXE installer over MSI for manual selection', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.28.0', [
      'OBS Plugin Installer Setup.exe',
      'OBS Plugin Installer Setup.exe.sig',
      'OBS.Plugin.Installer_0.28.0_x64_en-US.msi',
      'OBS.Plugin.Installer_0.28.0_x64_en-US.msi.sig',
    ]),
  )
  const updateTarget = getTarget('windows', 'x64', 'nsis')
  const manualTarget = getTarget('windows', 'x64', 'msi')

  const selected = resolveSelectionForTarget(catalog, updateTarget)
  const manual = resolveManualFallbackForTarget(catalog, manualTarget)

  assert.equal(selected.kind, 'selected')
  assert.equal(selected.candidate?.asset.name, 'OBS Plugin Installer Setup.exe')
  assert.equal(manual?.asset.name, 'OBS Plugin Installer Setup.exe')
})

test('Linux x64 chooses DEB for deb flows and AppImage for appimage flows', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.28.0', [
      'obs-plugin-installer_0.28.0_amd64.deb',
      'obs-plugin-installer_0.28.0_amd64.deb.sig',
      'obs-plugin-installer_0.28.0_amd64.AppImage',
      'obs-plugin-installer_0.28.0_amd64.AppImage.sig',
    ]),
  )

  const debTarget = getTarget('linux', 'amd64', 'deb')
  const appImageTarget = getTarget('linux', 'x86_64', 'appimage')

  const debSelected = resolveSelectionForTarget(catalog, debTarget)
  const debManual = resolveManualFallbackForTarget(catalog, debTarget)
  const appImageSelected = resolveSelectionForTarget(catalog, appImageTarget)
  const appImageManual = resolveManualFallbackForTarget(catalog, appImageTarget)

  assert.equal(debSelected.kind, 'selected')
  assert.equal(debSelected.candidate?.asset.name, 'obs-plugin-installer_0.28.0_amd64.deb')
  assert.equal(debManual?.asset.name, 'obs-plugin-installer_0.28.0_amd64.deb')

  assert.equal(appImageSelected.kind, 'selected')
  assert.equal(appImageSelected.candidate?.asset.name, 'obs-plugin-installer_0.28.0_amd64.AppImage')
  assert.equal(appImageManual?.asset.name, 'obs-plugin-installer_0.28.0_amd64.AppImage')
})

test('Linux ARM64 chooses the arm64 DEB when both architectures exist', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.28.0', [
      'obs-plugin-installer_0.28.0_amd64.deb',
      'obs-plugin-installer_0.28.0_amd64.deb.sig',
      'obs-plugin-installer_0.28.0_arm64.deb',
      'obs-plugin-installer_0.28.0_arm64.deb.sig',
    ]),
  )
  const target = getTarget('linux', 'aarch64', 'deb')

  const selected = resolveSelectionForTarget(catalog, target)
  const manual = resolveManualFallbackForTarget(catalog, target)

  assert.equal(selected.kind, 'selected')
  assert.equal(selected.candidate?.asset.name, 'obs-plugin-installer_0.28.0_arm64.deb')
  assert.equal(manual?.asset.name, 'obs-plugin-installer_0.28.0_arm64.deb')
})

test('classification stays stable for inconsistent filenames', () => {
  const macUpdate = classifyReleaseAsset(createAsset('DesktopBuild.app.tar.gz'), '0.28.0')
  const windowsInstaller = classifyReleaseAsset(createAsset('OBS Plugin Installer Setup.exe'), '0.28.0')
  const versionedAppImage = classifyReleaseAsset(createAsset('OBS.Plugin.Installer.v0.16.0.AppImage'), '0.16.0')

  assert.deepEqual(
    {
      os: macUpdate.os,
      arch: macUpdate.arch,
      kind: macUpdate.kind,
      format: macUpdate.format,
      versionState: macUpdate.versionState,
    },
    {
      os: 'macos',
      arch: 'universal',
      kind: 'updater_bundle',
      format: 'app_tar_gz',
      versionState: 'absent',
    },
  )

  assert.deepEqual(
    {
      os: windowsInstaller.os,
      arch: windowsInstaller.arch,
      kind: windowsInstaller.kind,
      format: windowsInstaller.format,
    },
    {
      os: 'windows',
      arch: 'unknown',
      kind: 'installer',
      format: 'exe',
    },
  )

  assert.equal(versionedAppImage.canonicalName, 'obs.plugin.installer.v0.16.0.appimage')
  assert.equal(versionedAppImage.versionState, 'match')
})

test('signatures must match the exact selected updater asset', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.28.0', [
      'OBS.Plugin.Installer.app.tar.gz',
      'Some.Other.Asset.app.tar.gz.sig',
      'OBS.Plugin.Installer_0.28.0_aarch64.dmg',
    ]),
  )
  const target = getTarget('macos', 'aarch64', 'app')

  const selected = resolveSelectionForTarget(catalog, target)
  const manual = resolveManualFallbackForTarget(catalog, target)

  assert.equal(selected.kind, 'missing')
  assert.match(selected.message ?? '', /OBS\.Plugin\.Installer\.app\.tar\.gz/i)
  assert.match(selected.message ?? '', /OBS\.Plugin\.Installer\.app\.tar\.gz\.sig/i)
  assert.match(selected.message ?? '', /manual installer is available/i)
  assert.equal(manual?.asset.name, 'OBS.Plugin.Installer_0.28.0_aarch64.dmg')
})

test('stale filename versions do not block manual fallback selection', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.30.0', [
      'OBS.Plugin.Installer.app.tar.gz',
      'OBS.Plugin.Installer_0.29.0_aarch64.dmg',
      'OBS.Plugin.Installer_0.29.0_x64.dmg',
    ]),
  )
  const target = getTarget('darwin', 'arm64', 'app')

  const selected = resolveSelectionForTarget(catalog, target)
  const manual = resolveManualFallbackForTarget(catalog, target)

  assert.equal(selected.kind, 'missing')
  assert.match(selected.message ?? '', /OBS\.Plugin\.Installer\.app\.tar\.gz/i)
  assert.match(selected.message ?? '', /OBS\.Plugin\.Installer\.app\.tar\.gz\.sig/i)
  assert.match(selected.message ?? '', /manual installer is available/i)
  assert.equal(manual?.asset.name, 'OBS.Plugin.Installer_0.29.0_aarch64.dmg')
  assert.match(manual?.reason ?? '', /filename version differs from release tag/i)
})

test('platform selection tolerates realistic filename variations across macOS, Windows, and Linux', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.16.0', [
      'OBS.Plugin.Installer.app.tar.gz',
      'OBS.Plugin.Installer.app.tar.gz.sig',
      'OBS Plugin Installer_0.16.0_x64-setup.exe',
      'OBS Plugin Installer_0.16.0_x64-setup.exe.sig',
      'OBS.Plugin.Installer.0.16.0.exe',
      'OBS.Plugin.Installer.0.16.0.exe.sig',
      'OBS Plugin Installer_0.16.0_amd64.deb',
      'OBS Plugin Installer_0.16.0_amd64.deb.sig',
      'OBS.Plugin.Installer.v0.16.0.AppImage',
      'OBS.Plugin.Installer.v0.16.0.AppImage.sig',
    ]),
  )

  const macTarget = getTarget('darwin', 'arm64', 'app')
  const windowsTarget = getTarget('windows', 'x64', 'nsis')
  const linuxDebTarget = getTarget('linux', 'amd64', 'deb')
  const linuxAppImageTarget = getTarget('linux', 'x86_64', 'appimage')

  const macSelected = resolveSelectionForTarget(catalog, macTarget)
  const windowsSelected = resolveSelectionForTarget(catalog, windowsTarget)
  const linuxDebSelected = resolveSelectionForTarget(catalog, linuxDebTarget)
  const linuxAppImageSelected = resolveSelectionForTarget(catalog, linuxAppImageTarget)

  assert.equal(macSelected.kind, 'selected')
  assert.equal(macSelected.candidate?.asset.name, 'OBS.Plugin.Installer.app.tar.gz')
  assert.equal(macSelected.candidate?.signatureAsset.name, 'OBS.Plugin.Installer.app.tar.gz.sig')

  assert.equal(windowsSelected.kind, 'selected')
  assert.equal(windowsSelected.candidate?.asset.name, 'OBS Plugin Installer_0.16.0_x64-setup.exe')
  assert.equal(windowsSelected.candidate?.signatureAsset.name, 'OBS Plugin Installer_0.16.0_x64-setup.exe.sig')

  assert.equal(linuxDebSelected.kind, 'selected')
  assert.equal(linuxDebSelected.candidate?.asset.name, 'OBS Plugin Installer_0.16.0_amd64.deb')

  assert.equal(linuxAppImageSelected.kind, 'selected')
  assert.equal(linuxAppImageSelected.candidate?.asset.name, 'OBS.Plugin.Installer.v0.16.0.AppImage')
})

test('duplicate upload suffixes do not break updater bundle signature pairing', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.30.0', [
      'OBS.Plugin.Installer.app.1.tar.gz',
      'OBS.Plugin.Installer.app.tar.gz',
      'OBS.Plugin.Installer.app.tar.gz.1.sig',
    ]),
  )
  const target = getTarget('darwin', 'arm64', 'app')

  const selected = resolveSelectionForTarget(catalog, target)

  assert.equal(selected.kind, 'selected')
  assert.equal(selected.candidate?.asset.name, 'OBS.Plugin.Installer.app.tar.gz')
  assert.equal(selected.candidate?.signatureAsset.name, 'OBS.Plugin.Installer.app.tar.gz.1.sig')
})

test('equally valid update candidates are reported as ambiguous instead of chosen arbitrarily', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.16.0', [
      'A.exe',
      'A.exe.sig',
      'B.exe',
      'B.exe.sig',
    ]),
  )
  const target = getTarget('windows', 'x64', 'nsis')

  const selected = resolveSelectionForTarget(catalog, target)

  assert.equal(selected.kind, 'ambiguous')
  assert.match(selected.message ?? '', /multiple compatible windows executable updater/i)
  assert.match(selected.message ?? '', /A\.exe/i)
  assert.match(selected.message ?? '', /B\.exe/i)
})

test('manual-only releases produce a precise error and still expose fallback installers', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.28.0', [
      'OBS.Plugin.Installer_0.28.0_aarch64.dmg',
      'OBS.Plugin.Installer_0.28.0_x64.dmg',
    ]),
  )
  const target = getTarget('darwin', 'arm64', 'app')

  const selected = resolveSelectionForTarget(catalog, target)
  const manual = resolveManualFallbackForTarget(catalog, target)

  assert.equal(selected.kind, 'missing')
  assert.match(selected.message ?? '', /only manual installer assets exist/i)
  assert.equal(manual?.asset.name, 'OBS.Plugin.Installer_0.28.0_aarch64.dmg')
})

test('source-only releases are excluded from selection', () => {
  const catalog = buildReleaseAssetCatalog(
    createRelease('v0.28.0', [
      'Source code (zip)',
      'Source code (tar.gz)',
    ]),
  )
  const target = getTarget('linux', 'x64', 'appimage')

  const selected = resolveSelectionForTarget(catalog, target)
  const manual = resolveManualFallbackForTarget(catalog, target)

  assert.equal(selected.kind, 'source-only')
  assert.match(selected.message ?? '', /source or non-installable assets/i)
  assert.equal(manual, null)
})
