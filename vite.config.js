import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Build identity, stamped into the bundle so a test result can be tied to the
// exact build it was produced against. A result without a build id is a result
// you cannot act on later.
function buildId() {
  let sha = 'nogit', dirty = ''
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) dirty = '+dirty'
  } catch {
    // Not a checkout (tarball, CI export). The timestamp still identifies it.
  }
  return `${sha}${dirty}@${new Date().toISOString()}`
}

export default defineConfig({
  base: '/tools/bunco/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
