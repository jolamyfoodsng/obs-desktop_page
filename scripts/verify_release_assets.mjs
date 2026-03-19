import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    index += 1
  }
  return args
}

function walkFiles(rootDir) {
  const files = []
  const pending = [rootDir]

  while (pending.length > 0) {
    const current = pending.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }

  return files
}

const BUNDLE_RULES = {
  nsis: {
    folderName: 'nsis',
    label: 'Windows NSIS updater installer',
    matcher: (filePath) => filePath.toLowerCase().endsWith('.exe'),
    requiresSignature: true,
  },
  msi: {
    folderName: 'msi',
    label: 'Windows MSI updater installer',
    matcher: (filePath) => filePath.toLowerCase().endsWith('.msi'),
    requiresSignature: true,
  },
  appimage: {
    folderName: 'appimage',
    label: 'Linux AppImage updater bundle',
    matcher: (filePath) => filePath.endsWith('.AppImage'),
    requiresSignature: true,
  },
  deb: {
    folderName: 'deb',
    label: 'Linux DEB package',
    matcher: (filePath) => filePath.toLowerCase().endsWith('.deb'),
    requiresSignature: false,
  },
  app: {
    folderName: 'macos',
    label: 'macOS updater archive',
    matcher: (filePath) => filePath.toLowerCase().endsWith('.app.tar.gz'),
    requiresSignature: true,
  },
  dmg: {
    folderName: 'dmg',
    label: 'macOS DMG installer',
    matcher: (filePath) => filePath.toLowerCase().endsWith('.dmg'),
    requiresSignature: false,
  },
}

function normalizeBundles(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function relativePaths(rootDir, files) {
  return files.map((filePath) => path.relative(rootDir, filePath).split(path.sep).join('/'))
}

function normalizeVersion(version) {
  return String(version ?? '').trim().replace(/^v/i, '')
}

function readExpectedVersion(rootDir, explicitVersion) {
  if (explicitVersion) {
    return normalizeVersion(explicitVersion)
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  return normalizeVersion(packageJson.version)
}

function parsePlistString(plistSource, key) {
  const matcher = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`)
  return plistSource.match(matcher)?.[1]?.trim() ?? null
}

function readMacosBundleVersionFromArchive(filePath) {
  const listing = execFileSync('tar', ['-tzf', filePath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const infoPlistPath = listing.find((entry) => entry.endsWith('/Contents/Info.plist') && entry.includes('.app/'))
  if (!infoPlistPath) {
    throw new Error(`macOS updater archive is missing Contents/Info.plist: ${filePath}`)
  }

  const plistSource = execFileSync('tar', ['-xOf', filePath, infoPlistPath], { encoding: 'utf8' })
  const shortVersion = parsePlistString(plistSource, 'CFBundleShortVersionString')
  const buildVersion = parsePlistString(plistSource, 'CFBundleVersion')
  const reportedVersion = normalizeVersion(shortVersion ?? buildVersion)

  if (!reportedVersion) {
    throw new Error(`macOS updater archive does not declare CFBundleShortVersionString or CFBundleVersion: ${filePath}`)
  }

  return {
    infoPlistPath,
    shortVersion,
    buildVersion,
    reportedVersion,
  }
}

function verifyMacosArchiveVersions(rootDir, bundleFiles, expectedVersion) {
  if (!expectedVersion) {
    throw new Error('Could not determine the expected app version for macOS updater archive verification.')
  }

  for (const filePath of bundleFiles) {
    const archiveVersion = readMacosBundleVersionFromArchive(filePath)

    if (archiveVersion.reportedVersion !== expectedVersion) {
      throw new Error(
        `macOS updater archive version mismatch for ${path.relative(rootDir, filePath)}: ` +
          `archive reports ${archiveVersion.reportedVersion}, expected ${expectedVersion}.`,
      )
    }

    console.log(
      `[verify-release-assets] macOS updater archive version OK: ${path.relative(rootDir, filePath)} -> ${archiveVersion.reportedVersion}`,
    )
  }
}

function verifyBundle(rootDir, allFiles, bundleType, expectedVersion) {
  const rule = BUNDLE_RULES[bundleType]
  if (!rule) {
    throw new Error(`Unsupported bundle type: ${bundleType}`)
  }

  const bundleFiles = allFiles.filter((filePath) => {
    const normalized = filePath.split(path.sep).join('/').toLowerCase()
    return normalized.includes(`/${rule.folderName}/`) && !normalized.endsWith('.sig') && rule.matcher(filePath)
  })

  if (bundleFiles.length === 0) {
    throw new Error(`Missing ${rule.label} output in ${rootDir}.`)
  }

  const signatures = new Set(allFiles.filter((filePath) => filePath.toLowerCase().endsWith('.sig')))
  const missingSignatures = bundleFiles.filter((filePath) => !signatures.has(`${filePath}.sig`))

  if (rule.requiresSignature && missingSignatures.length > 0) {
    const relativeMissing = relativePaths(rootDir, missingSignatures)
    throw new Error(
      `Missing signature pair(s) for ${rule.label}: ${relativeMissing.map((filePath) => `${filePath}.sig`).join(', ')}`,
    )
  }

  console.log(`[verify-release-assets] ${rule.label}:`)
  for (const filePath of relativePaths(rootDir, bundleFiles)) {
    console.log(` - ${filePath}`)
    if (rule.requiresSignature) {
      console.log(` - ${filePath}.sig`)
    }
  }

  if (bundleType === 'app') {
    verifyMacosArchiveVersions(rootDir, bundleFiles, expectedVersion)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const rootDir = path.resolve(String(args.root ?? 'src-tauri/target/release/bundle'))
  const bundles = normalizeBundles(args.bundles)
  const expectedVersion = readExpectedVersion(process.cwd(), args['expected-version'])

  if (bundles.length === 0) {
    throw new Error('Pass --bundles with at least one bundle type.')
  }

  if (!fs.existsSync(rootDir)) {
    throw new Error(`Bundle directory does not exist: ${rootDir}`)
  }

  const allFiles = walkFiles(rootDir)
  console.log(`[verify-release-assets] inspecting ${allFiles.length} file(s) under ${rootDir}`)

  for (const bundleType of bundles) {
    verifyBundle(rootDir, allFiles, bundleType, expectedVersion)
  }
}

main()
