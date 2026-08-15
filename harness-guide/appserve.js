// Serves the production bundle at its real base path, /tools/bunco/.
const { createServer } = require('node:http')
const { readFileSync, existsSync, statSync } = require('node:fs')
const { join, extname, normalize } = require('node:path')
const ROOT = process.argv[2]
const BASE = '/tools/bunco'
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
               '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' }
createServer((req, res) => {
  let url = (req.url || '/').split('?')[0]
  if (url === '/' || url === BASE) { res.writeHead(302, { location: BASE + '/' }).end(); return }
  let rel = url.startsWith(BASE + '/') ? url.slice(BASE.length + 1) : url.replace(/^\//, '')
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, '')
  let file = join(ROOT, rel)
  if (!rel || !existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html')
  const body = readFileSync(file)
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(body)
}).listen(31410, '127.0.0.1', () => console.log('app on 127.0.0.1:31410' + BASE + '/'))
