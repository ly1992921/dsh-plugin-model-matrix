/**
 * Automated acceptance check for dsh-plugin-model-matrix.
 * Run with:
 *   node scripts/test.js
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

console.log('── Running verification for dsh-plugin-model-matrix ──\n')

let failures = 0
const check = (title, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`${condition ? '  ✔ OK  ' : '  ✖ FAIL'} ${title}${detail ? ` (${detail})` : ''}`)
}

// 1. Files existence check
const requiredFiles = [
  'package.json',
  'cordis.patch.yml',
  'index.js',
  'client.js',
  'LICENSE',
  'README.md',
  'src/ui/ModelSelect.js',
  'src/ui/styles.js',
  'src/core/probe.js',
  'src/core/store.js',
  'src/core/api.js',
  'src/settings/settings-page.js',
  'locale/zh.json',
  'locale/en.json'
]

for (const rel of requiredFiles) {
  const p = path.join(rootDir, rel)
  check(`File exists: ${rel}`, fs.existsSync(p))
}

// 2. package.json valid check
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
  check('package.json valid JSON', typeof pkg.name === 'string', pkg.name)
  check('package.json dsh bundle declared', Array.isArray(pkg.dsh?.bundle?.patch) || typeof pkg.dsh?.bundle?.patch === 'string')
} catch (e) {
  check('package.json valid JSON', false, e.message)
}

// 3. Locales valid check
for (const lang of ['zh', 'en']) {
  try {
    const loc = JSON.parse(fs.readFileSync(path.join(rootDir, 'locale', `${lang}.json`), 'utf8'))
    check(`locale/${lang}.json valid`, typeof loc.name === 'string')
  } catch (e) {
    check(`locale/${lang}.json valid`, false, e.message)
  }
}

console.log(`\nResults: ${failures === 0 ? 'ALL VERIFICATIONS PASSED!' : `${failures} checks failed.`}`)
process.exit(failures === 0 ? 0 : 1)
