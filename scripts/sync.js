import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// __dirname = .../simple-bunco-scorecard/scripts/
const __dirname = dirname(fileURLToPath(import.meta.url))
const src = resolve(__dirname, '../dist')
const dest = resolve(__dirname, '../../pattern158-vue/public/tools/bunco')

if (!existsSync(resolve(src, 'index.html'))) {
  console.error('dist/index.html missing — aborting sync')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`Synced dist/ → ${dest}`)
