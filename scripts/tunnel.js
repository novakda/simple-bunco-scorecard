#!/usr/bin/env node
/**
 * Puts the app and the telemetry collector behind HTTPS, and prints the one URL
 * to open on the phone.
 *
 * WHY THIS EXISTS AT ALL: the screen wake lock is a secure-context API. Over
 * plain HTTP the request in useGameState.js fails silently, the phone sleeps
 * mid-round, and the session you were measuring is the session you interrupted.
 * Tailnet HTTP is fine for a quick look; it is not fine for a 47-minute game.
 *
 * The second reason is mixed content: an HTTPS page cannot POST to an HTTP
 * collector. Tunnelling the app alone produces an app that loads beautifully
 * and records nothing, which is the worst of the available failures because it
 * looks like success. So both ends are tunnelled, or neither.
 *
 * Usage:
 *   npm run tunnel
 *   npm run tunnel -- --app-port 31410 --collector-port 31403
 *   npm run tunnel -- --no-collector     (app only; telemetry stays off)
 *
 * Every argument is named. A positional here would be a port or a path, and
 * those transpose silently into a different valid call.
 */
import { spawn } from 'node:child_process'
import { get } from 'node:http'

const DEFAULTS = {
  'app-port': 31410,
  'collector-port': 31403,
  base: '/tools/bunco/',
  collector: true,
}

function parseArgs(argv) {
  const out = { ...DEFAULTS }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      fail(`unexpected positional argument "${a}" — every option here is named (--app-port 31410)`)
    }
    const key = a.slice(2)
    if (key === 'no-collector') { out.collector = false; continue }
    if (key === 'help' || key === 'h') { usage(); process.exit(0) }
    if (!(key in DEFAULTS)) fail(`unknown option --${key}`)
    const val = argv[++i]
    if (val === undefined || val.startsWith('--')) fail(`--${key} needs a value`)
    out[key] = key.endsWith('port') ? Number(val) : val
    if (key.endsWith('port') && !Number.isInteger(out[key])) fail(`--${key} must be a port number, got "${val}"`)
  }
  return out
}

function usage() {
  console.log(`
  npm run tunnel -- [options]

    --app-port <n>        local port serving the built app   (default 31410)
    --collector-port <n>  local port of the telemetry collector (default 31403)
    --base <path>         base path the app is served at     (default /tools/bunco/)
    --no-collector        tunnel the app only; telemetry stays off
`)
}

function fail(msg) {
  console.error(`\x1b[31mtunnel: ${msg}\x1b[0m`)
  process.exit(1)
}

/**
 * Preflight by making a real request, not by checking that something is
 * listening. harness-guide/appserve.cjs prints its startup banner before it has
 * served anything, and throws on the first request when it was started without
 * a document root — so "the port is open" and "the server works" are genuinely
 * different facts here, and only the second one matters.
 */
function probe(port, path) {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path, timeout: 4000 }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
  })
}

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

function startTunnel(label, port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error(`${label}: no URL from cloudflared after 45s`)) }
    }, 45000)

    const scan = (buf) => {
      const m = String(buf).match(URL_RE)
      if (m && !settled) {
        settled = true
        clearTimeout(timer)
        resolve({ url: m[0], proc })
      }
    }
    proc.stdout.on('data', scan)
    proc.stderr.on('data', scan)
    proc.on('error', (e) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`${label}: ${e.message}`)) }
    })
    proc.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`${label}: cloudflared exited (${code})`)) }
    })
  })
}

const args = parseArgs(process.argv.slice(2))
const children = []

function shutdown() {
  for (const c of children) { try { c.kill() } catch { /* already gone */ } }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const appStatus = await probe(args['app-port'], args.base)
if (appStatus === null) {
  fail(`nothing is answering on http://localhost:${args['app-port']}${args.base}\n` +
       `        start it first:  npm run serve:app     (build first if dist/ is stale: npm run build)`)
}
if (appStatus >= 400) {
  fail(`http://localhost:${args['app-port']}${args.base} returned ${appStatus}\n` +
       `        the port is open but the server is not serving the app — check that it was given a document root`)
}
console.log(`  app        localhost:${args['app-port']}${args.base}  ${appStatus}`)

if (args.collector) {
  const cStatus = await probe(args['collector-port'], '/feed')
  if (cStatus === null) {
    fail(`the collector is not answering on http://localhost:${args['collector-port']}/feed\n` +
         `        start it first:  npm run collect\n` +
         `        or tunnel the app alone with --no-collector (telemetry will be off)`)
  }
  console.log(`  collector  localhost:${args['collector-port']}/feed  ${cStatus}`)
}

console.log('\n  opening cloudflare tunnels, this takes a few seconds...\n')

try {
  const app = await startTunnel('app', args['app-port'])
  children.push(app.proc)

  let phoneUrl = `${app.url}${args.base}`
  if (args.collector) {
    const col = await startTunnel('collector', args['collector-port'])
    children.push(col.proc)
    phoneUrl += `?collector=${col.url}`
    console.log(`  collector  ${col.url}`)
  }
  console.log(`  app        ${app.url}\n`)

  console.log('\x1b[1m  open this on the phone:\x1b[0m')
  console.log(`\x1b[36m  ${phoneUrl}\x1b[0m\n`)
  console.log('  HTTPS, so the screen wake lock works and the phone will not sleep mid-round.')
  if (!args.collector) console.log('  \x1b[33mtelemetry is OFF — nothing will be recorded.\x1b[0m')
  console.log('  Ctrl-C closes both tunnels. The URLs change every run; quick tunnels are ephemeral.\n')
} catch (e) {
  console.error(`\x1b[31mtunnel: ${e.message}\x1b[0m`)
  shutdown()
}
