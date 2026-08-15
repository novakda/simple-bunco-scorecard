// Serves rolllist.html (the tester's step list) on :31411.
//
// Re-reads the file on EVERY request with cache-control:no-store — that is deliberate. Regenerating
// the list with gen-rolllist.js and refreshing the browser picks up the new version with no restart,
// which is what makes iterating on the guide mid-session bearable.
//
// The path was an absolute reference to a background-agent job scratch dir
// (~/.claude/jobs/1feb7947/tmp/) that no longer exists — recovered as-found on 2026-08-15, fixed
// here to resolve next to this script instead.
const { createServer } = require('node:http')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const PORT = Number(process.env.PORT) || 31411
const FILE = process.env.ROLLLIST || join(__dirname, 'rolllist.html')

createServer((_q, s) => {
  // rolllist.html is GENERATED, so "missing" is the normal first-run state rather than an error.
  // Say what to run instead of throwing a stack at whoever opened the page.
  if (!existsSync(FILE)) {
    s.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      .end(`no roll list at ${FILE}\n\ngenerate it first:\n  node gen-rolllist.js ../telemetry/golden-game.json rolllist.html\n`)
    return
  }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    .end(readFileSync(FILE))
}).listen(PORT, '0.0.0.0', () => console.log(`rolllist on :${PORT}  <- ${FILE}`))
