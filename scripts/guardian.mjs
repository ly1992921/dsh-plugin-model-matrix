/**
 * DeepSeek Harness Auto Plugin Healer & Guardian
 *
 * This daemon/watchdog runs in the background and continuously monitors:
 * 1. DeepSeek Harness installation folder for version upgrades or new app.asar
 * 2. Integrity of all custom workspace plugins:
 *    - dsh-plugin-model-matrix (Two-Bar Selector & Real-Time Status Lights)
 *    - dsh-nous-portal
 *    - dsh-opencode-zen
 *    - dsh-commandcode-settings
 * 3. Profile bundle registration & node_modules junctions
 * 4. Automatic non-destructive zero-risk byte-aligned re-patching upon detection of unpatched asar
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { autoHeal, inspectPluginStatus, getDshPaths } from './self-healer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CHECK_INTERVAL_MS = 10000 // Check every 10 seconds

console.log('═══════════════════════════════════════════════════════════')
console.log('  DeepSeek Harness Plugin Auto-Guardian & Self-Healer')
console.log('═══════════════════════════════════════════════════════════')

let lastAsarMtime = 0
let lastVersion = ''

function checkAndHeal() {
  try {
    const { appDir, desktopProfile } = getDshPaths()
    if (!appDir) return

    const asarPath = path.join(appDir, 'resources', 'app.asar')
    if (!fs.existsSync(asarPath)) return

    const stat = fs.statSync(asarPath)
    const mtime = stat.mtimeMs

    // Check status
    const status = inspectPluginStatus()

    const needsHeal =
      status.asarStatus === 'UNPATCHED_COMPATIBLE' ||
      !status.profileBundleRegistered ||
      !status.junctionExists ||
      status.conflicts.length > 0

    if (mtime !== lastAsarMtime || status.appVersion !== lastVersion || needsHeal) {
      console.log(`[${new Date().toLocaleTimeString()}] Target updated or anomaly detected:`)
      console.log(`  Version: ${status.appVersion}, Asar status: ${status.asarStatus}`)
      console.log(`  Bundle registered: ${status.profileBundleRegistered}, Junction: ${status.junctionExists}`)

      if (needsHeal) {
        console.log(`[${new Date().toLocaleTimeString()}] ▶ Triggering automatic self-healing...`)
        const result = autoHeal({ verbose: true })
        if (result.modified) {
          console.log(`[${new Date().toLocaleTimeString()}] 🎉 Auto-recovery completed successfully!`)
        }
      }

      lastAsarMtime = mtime
      lastVersion = status.appVersion
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Check error:`, err.message)
  }
}

// Initial check
checkAndHeal()

// Polling daemon loop
setInterval(checkAndHeal, CHECK_INTERVAL_MS)
console.log(`✔ Guardian is actively watching DSH at 10-second intervals.`)
