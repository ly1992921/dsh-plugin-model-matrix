/**
 * High-reliability Self-Healing Engine for DeepSeek Harness Plugins.
 * Detects version updates, verifies compatibility, and automatically recovers
 * custom UI patches and bundle registrations without manual intervention.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')

export function getDshPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const desktopProfile = path.join(home, '.dsh', 'profiles', 'desktop')
  const localAppData = process.env.LOCALAPPDATA || ''

  const possibleAppDirs = [
    path.join(localAppData, 'Programs', 'DeepSeek Harness'),
    path.join('C:', 'Users', process.env.USERNAME || '', 'AppData', 'Local', 'Programs', 'DeepSeek Harness'),
    'C:\\Program Files\\DeepSeek Harness',
    'D:\\Program Files\\DeepSeek Harness'
  ]

  let appDir = null
  for (const dir of possibleAppDirs) {
    if (fs.existsSync(path.join(dir, 'resources', 'app.asar'))) {
      appDir = dir
      break
    }
  }

  return { home, desktopProfile, appDir }
}

export function readAsarHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const jsonLen = head.readUInt32LE(12)
  const baseOffset = 16 + jsonLen
  const headerBuf = Buffer.alloc(jsonLen)
  fs.readSync(fd, headerBuf, 0, jsonLen, 16)
  fs.closeSync(fd)
  const header = JSON.parse(headerBuf.toString('utf8'))
  return { header, jsonLen, baseOffset }
}

export function findFileInAsar(header, relativePath) {
  const parts = relativePath.split('/')
  let cur = header
  for (const p of parts) {
    if (!cur.files || !cur.files[p]) return null
    cur = cur.files[p]
  }
  return cur
}

export function inspectPluginStatus() {
  const { desktopProfile, appDir } = getDshPaths()
  const report = {
    appDir,
    desktopProfile,
    appVersion: 'unknown',
    asarPath: null,
    asarStatus: 'unknown', // 'PATCHED' | 'UNPATCHED_COMPATIBLE' | 'INCOMPATIBLE' | 'NOT_FOUND'
    profileBundleRegistered: false,
    junctionExists: false,
    conflicts: [],
    details: {}
  }

  if (!appDir) {
    report.asarStatus = 'NOT_FOUND'
    return report
  }

  const asarPath = path.join(appDir, 'resources', 'app.asar')
  report.asarPath = asarPath
  if (!fs.existsSync(asarPath)) {
    report.asarStatus = 'NOT_FOUND'
    return report
  }

  // 1. Inspect app.asar
  try {
    const { header, baseOffset } = readAsarHeader(asarPath)
    const pkgNode = findFileInAsar(header, 'dsh/package.json')
    const fd = fs.openSync(asarPath, 'r')

    if (pkgNode) {
      const pkgBuf = Buffer.alloc(pkgNode.size)
      fs.readSync(fd, pkgBuf, 0, pkgNode.size, baseOffset + parseInt(pkgNode.offset))
      const pkg = JSON.parse(pkgBuf.toString('utf8'))
      report.appVersion = pkg.version || 'unknown'
    }

    const clientNode = findFileInAsar(
      header,
      'dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'
    )

    if (!clientNode) {
      report.asarStatus = 'INCOMPATIBLE'
      report.details.error = 'model-selection client.js not found in asar'
    } else {
      const clientBuf = Buffer.alloc(clientNode.size)
      fs.readSync(fd, clientBuf, 0, clientNode.size, baseOffset + parseInt(clientNode.offset))
      const clientCode = clientBuf.toString('utf8')

      const isPatched = clientCode.includes('providerTriggerRef') && clientCode.includes('probeProvider')
      if (isPatched) {
        report.asarStatus = 'PATCHED'
      } else {
        const startMarker = '//#region lib/types/client/ModelSelect.js'
        const endMarker = '//#region lib/types/client/locales.js'
        const idx1 = clientCode.indexOf(startMarker)
        const idx2 = clientCode.indexOf(endMarker)

        if (idx1 !== -1 && idx2 !== -1) {
          const regionSize = idx2 - idx1
          report.asarStatus = 'UNPATCHED_COMPATIBLE'
          report.details = {
            targetSize: clientNode.size,
            targetOffset: parseInt(clientNode.offset),
            baseOffset,
            idx1,
            idx2,
            regionSize
          }
        } else {
          report.asarStatus = 'INCOMPATIBLE'
          report.details.error = 'Region markers not found in official client.js'
        }
      }
    }
    fs.closeSync(fd)
  } catch (err) {
    report.asarStatus = 'ERROR'
    report.details.error = err.message
  }

  // 2. Inspect profile package.json & bundles
  const pkgPath = path.join(desktopProfile, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const bundles = pkg?.dsh?.profile?.bundles || []
      report.profileBundleRegistered = bundles.includes('dsh-plugin-model-matrix')
    } catch {}
  }

  // 3. Inspect junction
  const linkPath = path.join(desktopProfile, 'node_modules', 'dsh-plugin-model-matrix')
  report.junctionExists = fs.existsSync(linkPath)

  // 4. Inspect conflicts
  const conflictPath = path.join(
    desktopProfile,
    'node_modules',
    '@deepseek-ai',
    'dsh-client-ui-model-selection'
  )
  if (fs.existsSync(conflictPath)) {
    report.conflicts.push(conflictPath)
  }

  return report
}

export function autoHeal(options = {}) {
  const { verbose = true } = options
  const log = (...args) => {
    if (verbose) console.log(...args)
  }

  log('═══ DeepSeek Harness Plugin Self-Healing ═══')
  const status = inspectPluginStatus()
  log(`App Directory   : ${status.appDir}`)
  log(`App Version     : ${status.appVersion}`)
  log(`Asar Status     : ${status.asarStatus}`)
  log(`Bundle Loaded   : ${status.profileBundleRegistered}`)
  log(`Junction Link   : ${status.junctionExists}`)

  let modified = false

  // Step 1: Cleanup conflicting packages
  if (status.conflicts.length > 0) {
    for (const conf of status.conflicts) {
      try {
        fs.rmSync(conf, { recursive: true, force: true })
        log(`✔ Removed conflicting package: ${conf}`)
        modified = true
      } catch (e) {
        log(`✖ Could not remove conflict: ${e.message}`)
      }
    }
  }

  // Step 2: Patch app.asar if unpatched and compatible
  if (status.asarStatus === 'UNPATCHED_COMPATIBLE') {
    log('\n▶ Performing zero-risk byte-aligned hot-patch to app.asar...')
    const asarPath = status.asarPath
    const bakPath = path.join(status.appDir, 'resources', 'app.asar.bak')

    // Create backup if not exists
    if (!fs.existsSync(bakPath)) {
      fs.copyFileSync(asarPath, bakPath)
      log(`✔ Created backup at: ${bakPath}`)
    }

    // Read injected code
    const injectFile = path.join(__dirname, 'injected_model_select.js')
    if (!fs.existsSync(injectFile)) {
      throw new Error(`Injected code template not found at: ${injectFile}`)
    }
    const newModelSelect = fs.readFileSync(injectFile, 'utf8')

    // Read clean code from asar
    const { baseOffset, details } = status
    const fd = fs.openSync(asarPath, 'r+')
    const cleanBuf = Buffer.alloc(details.targetSize)
    fs.readSync(fd, cleanBuf, 0, details.targetSize, details.baseOffset + details.targetOffset)
    const cleanOrigCode = cleanBuf.toString('utf8')

    const modifiedCode = cleanOrigCode.slice(0, details.idx1) + newModelSelect + '\n\t\t' + cleanOrigCode.slice(details.idx2)
    const modBytes = Buffer.from(modifiedCode, 'utf8')
    const diff = details.targetSize - modBytes.length

    if (diff < 0) {
      fs.closeSync(fd)
      throw new Error(`Modified code size (${modBytes.length}) exceeds target size (${details.targetSize})`)
    }

    const padding = Buffer.from('/*' + '*'.repeat(diff - 4) + '*/', 'utf8')
    const paddedBytes = Buffer.concat([modBytes, padding])

    if (paddedBytes.length !== details.targetSize) {
      fs.closeSync(fd)
      throw new Error(`Padded size (${paddedBytes.length}) does not match target (${details.targetSize})`)
    }

    fs.writeSync(fd, paddedBytes, 0, details.targetSize, details.baseOffset + details.targetOffset)
    fs.closeSync(fd)
    log(`✔ Successfully patched app.asar in-place with exact byte alignment!`)
    modified = true
  } else if (status.asarStatus === 'PATCHED') {
    log('✔ app.asar is already patched and healthy.')
  } else {
    log(`⚠ asar status is ${status.asarStatus}, skipping asar patch.`)
  }

  // Step 3: Register bundle in desktop profile
  const pkgPath = path.join(status.desktopProfile, 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.dependencies = pkg.dependencies || {}
    pkg.dsh = pkg.dsh || {}
    pkg.dsh.profile = pkg.dsh.profile || {}
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []

    let pkgDirty = false
    const linkStr = `link:${PLUGIN_ROOT.replace(/\\/g, '/')}`
    if (pkg.dependencies['dsh-plugin-model-matrix'] !== linkStr) {
      pkg.dependencies['dsh-plugin-model-matrix'] = linkStr
      pkgDirty = true
    }
    if (!pkg.dsh.profile.bundles.includes('dsh-plugin-model-matrix')) {
      pkg.dsh.profile.bundles.push('dsh-plugin-model-matrix')
      pkgDirty = true
    }

    if (pkgDirty) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
      log('✔ Registered dsh-plugin-model-matrix into profile package.json')
      modified = true
    } else {
      log('✔ Profile package.json already has bundle registration.')
    }
  }

  // Step 4: Ensure junction
  const linkPath = path.join(status.desktopProfile, 'node_modules', 'dsh-plugin-model-matrix')
  if (!fs.existsSync(linkPath)) {
    try {
      const nodeModulesDir = path.dirname(linkPath)
      if (!fs.existsSync(nodeModulesDir)) fs.mkdirSync(nodeModulesDir, { recursive: true })
      fs.symlinkSync(PLUGIN_ROOT, linkPath, 'junction')
      log(`✔ Created node_modules junction: ${linkPath}`)
      modified = true
    } catch (e) {
      log(`⚠ Could not create junction: ${e.message}`)
    }
  } else {
    log('✔ node_modules junction already exists.')
  }

  // Step 5: Save audit record
  const logDir = path.join(status.desktopProfile, '..', '..', 'logs')
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, 'self-healing.log')
  const entry = `[${new Date().toISOString()}] Version: ${status.appVersion}, Asar: ${status.asarStatus}, Healed: ${modified}\n`
  fs.appendFileSync(logFile, entry, 'utf8')

  log('\n🎉 Self-healing check completed.')
  return { modified, status }
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const res = autoHeal({ verbose: true })
    process.exit(0)
  } catch (err) {
    console.error('✖ Self-healing error:', err)
    process.exit(1)
  }
}
