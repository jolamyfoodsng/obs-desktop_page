import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json')
const updaterPubkeyPath = path.join(rootDir, 'src-tauri', 'updater.pub.key')

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
const updaterPubkey = readFileSync(updaterPubkeyPath, 'utf8').trim()

if (!updaterPubkey) {
  throw new Error('src-tauri/updater.pub.key is empty.')
}

const currentPubkey = tauriConfig.plugins?.updater?.pubkey ?? ''
if (currentPubkey === updaterPubkey) {
  process.exit(0)
}

tauriConfig.plugins ??= {}
tauriConfig.plugins.updater ??= {}
tauriConfig.plugins.updater.pubkey = updaterPubkey

writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8')
