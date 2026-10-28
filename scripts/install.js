/**
 * One-click installer for dsh-plugin-model-matrix into DeepSeek Harness desktop profile.
 * Run with:
 *   node scripts/install.js
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(__dirname, '..')

const homeDir = process.env.USERPROFILE || process.env.HOME || ''
const profileDir = path.join(homeDir, '.dsh', 'profiles', 'desktop')
const pkgJsonPath = path.join(profileDir, 'package.json')
const patchPath = path.join(profileDir, 'cordis.patch.yml')

console.log('── Installing dsh-plugin-model-matrix ──')
console.log('Plugin source:', pluginDir)
console.log('Target profile:', profileDir)

if (!fs.existsSync(pkgJsonPath)) {
  console.error('Error: target profile package.json not found at:', pkgJsonPath)
  process.exit(1)
}

try {
  // 1. Update package.json dependencies and bundles
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  pkg.dependencies = pkg.dependencies || {}
  pkg.dependencies['dsh-plugin-model-matrix'] = `link:${pluginDir.replace(/\\/g, '/')}`

  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
  if (!pkg.dsh.profile.bundles.includes('dsh-plugin-model-matrix')) {
    pkg.dsh.profile.bundles.push('dsh-plugin-model-matrix')
  }

  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log('✔ Updated profile package.json with bundle reference')

  // 2. Ensure node_modules symlink/junction exists
  const nodeModulesDir = path.join(profileDir, 'node_modules')
  if (!fs.existsSync(nodeModulesDir)) fs.mkdirSync(nodeModulesDir, { recursive: true })
  const linkTarget = path.join(nodeModulesDir, 'dsh-plugin-model-matrix')
  if (!fs.existsSync(linkTarget)) {
    try {
      fs.symlinkSync(pluginDir, linkTarget, 'junction')
      console.log('✔ Created node_modules junction:', linkTarget)
    } catch (e) {
      console.warn('Note: Could not create junction directly:', e.message)
    }
  }

  console.log('\n🎉 Installation complete! Please reload DeepSeek Harness (F12 -> location.reload() or restart the app).')
} catch (err) {
  console.error('Installation failed:', err)
  process.exit(1)
}
