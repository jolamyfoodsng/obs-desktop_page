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

function verifyBundle(rootDir, allFiles, bundleType) {
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
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const rootDir = path.resolve(String(args.root ?? 'src-tauri/target/release/bundle'))
  const bundles = normalizeBundles(args.bundles)

  if (bundles.length === 0) {
    throw new Error('Pass --bundles with at least one bundle type.')
  }

  if (!fs.existsSync(rootDir)) {
    throw new Error(`Bundle directory does not exist: ${rootDir}`)
  }

  const allFiles = walkFiles(rootDir)
  console.log(`[verify-release-assets] inspecting ${allFiles.length} file(s) under ${rootDir}`)

  for (const bundleType of bundles) {
    verifyBundle(rootDir, allFiles, bundleType)
  }
}

main()
