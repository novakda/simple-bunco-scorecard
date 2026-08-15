#!/usr/bin/env node
/**
 * Telemetry collector — receives events from a live phone session, appends them
 * to an NDJSON file, and diffs each one against the golden game as it arrives.
 *
 *   node scripts/telemetry-collector.js --golden telemetry/golden-game.json
 *
 * Then load the app on the phone with the collector pointed at this machine:
 *
 *   http://<tailnet-ip>:5173/tools/bunco/?collector=http://<tailnet-ip>:31403
 *
 * The terminal shows a line per tap: what was expected, what the app recorded,
 * and whether they agree. A mismatch is a scoring defect; a long gap is a UX
 * finding. Ctrl-C prints the session report.
 *
 * No dependencies — plain node:http so it starts instantly and never drifts.
 */
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i > -1 && args[i + 1] ? args[i + 1] : fallback
}

const PORT = Number(arg('--port', '31403'))
const GOLDEN = arg('--golden', 'telemetry/golden-game.json')
const REPLAY = arg('--replay', null)
// In replay mode the report sits beside the log being replayed, and no new
// session file is created.
const OUT = REPLAY || arg('--out', `telemetry/session-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`)

let golden = null
try {
  golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
} catch {
  console.warn(`! no golden game at ${GOLDEN} — recording only, no live comparison`)
}

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true })
if (!REPLAY) writeFileSync(OUT, '')

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

// Running round total after each golden roll, so the state left behind by an
// undo can be VERIFIED against the golden game rather than merely counted.
const goldenRunning = []
if (golden) {
  let run = 0, curKey = null
  for (const r of golden.expectedRolls) {
    const k = r.set + ':' + r.round
    if (k !== curKey) { curKey = k; run = 0 }
    run += r.points
    goldenRunning.push(run)
  }
}

// Prompts issued by the guide, so a prompted undo can be told apart from a
// spontaneous one. Retained in the log either way — correcting the run must not
// erase the evidence of what went wrong.
let lastPrompt = null

const stats = {
  events: 0,
  taps: 0,
  matches: 0,
  mismatches: [],
  undos: 0,
  noops: 0,
  backgrounded: 0,
  gaps: [],
  rounds: 0,
  undosPrompted: 0,
  undosSpontaneous: 0,
  undoVerified: 0,
  undoBad: [],
  prompts: 0,
  resultMatches: 0,
  resultMismatches: [],
  firstAt: null,
  lastAt: null,
}

let prevTotalRolls = 0
let prevTotalResults = 0
let buildId = null

function describeExpected(e) {
  if (!e) return 'nothing (past the end of the golden game)'
  return `${e.type === 'normal' ? `${e.points} pt` : e.type === 'mini' ? 'MINI-BUNCO (5)' : 'BUNCO (21)'}`
}

function handleEvent(ev) {
  stats.events++
  if (stats.firstAt === null) stats.firstAt = ev.t
  stats.lastAt = ev.t

  const a = ev.after || {}
  const where = `s${a.set ?? '?'}r${a.round ?? '?'}`

  if (ev.action === 'visibility') {
    if (ev.args?.state === 'hidden') stats.backgrounded++
    const tag = ev.args?.state === 'hidden' ? C.amber('app backgrounded') : C.cyan('app resumed')
    console.log(`${C.dim(where.padEnd(6))} ${tag} ${C.dim(`after ${(ev.dt / 1000).toFixed(1)}s`)}`)
    return
  }

  if (ev.action === 'load') {
    if (ev.args && ev.args.build) buildId = ev.args.build
    console.log(C.bold(`\n=== session ${ev.sid} started ===`))
    console.log(C.dim(`    build ${buildId || 'unknown'}`))
    if (ev.args && ev.args.ua) console.log(C.dim(`    ${ev.args.ua.slice(0, 90)}`))
    return
  }

  if (ev.noop) {
    stats.noops++
    console.log(
      `${C.dim(where.padEnd(6))} ${C.amber('DEAD TAP')} ${ev.action} did nothing (phase ${a.phase})`
    )
    return
  }

  // A roll was removed. This is both a RECOVERY (the run stays alive) and a live
  // exercise of the undo feature, so verify the state it left behind.
  if (a.totalRolls < prevTotalRolls) {
    const removed = prevTotalRolls - a.totalRolls
    stats.undos++
    const prompted = lastPrompt && (ev.t - lastPrompt.t) < 120000
    if (prompted) { stats.undosPrompted++; lastPrompt = null } else { stats.undosSpontaneous++ }

    // Verified: exactly one roll gone, and the round total now equals the golden
    // running total at the new position.
    let verdict = 'unchecked'
    if (golden) {
      const idx = a.totalRolls - 1
      const sameRound = idx >= 0 && golden.expectedRolls[idx] &&
        golden.expectedRolls[idx].set === a.set && golden.expectedRolls[idx].round === a.round
      const wantTotal = idx >= 0 && sameRound ? goldenRunning[idx] : 0
      if (removed === 1 && a.roundPoints === wantTotal) { verdict = 'verified'; stats.undoVerified++ }
      else {
        verdict = `UNEXPECTED (removed ${removed}, round total ${a.roundPoints}, golden says ${wantTotal})`
        stats.undoBad.push({ at: a.totalRolls, removed, got: a.roundPoints, want: wantTotal })
      }
    }
    const tag = prompted ? C.cyan('prompted') : C.amber('spontaneous')
    const vt = verdict === 'verified' ? C.green('verified') : verdict === 'unchecked' ? C.dim('unchecked') : C.red(verdict)
    console.log(`${C.dim(where.padEnd(6))} ${C.amber('UNDO')} ${tag} — back to ${a.totalRolls} rolls, ${vt}`)
    prevTotalRolls = a.totalRolls
    return
  }

  // A roll was added — this is the comparison that matters.
  if (a.totalRolls > prevTotalRolls) {
    prevTotalRolls = a.totalRolls
    stats.taps++
    stats.gaps.push(ev.dt)

    const idx = a.totalRolls - 1
    const exp = golden?.expectedRolls?.[idx]
    const got = a.last

    if (!golden) {
      console.log(`${C.dim(where.padEnd(6))} recorded ${got?.points} pt (${got?.type})`)
      return
    }

    const pointsOk = exp && got && exp.points === got.points
    const typeOk = exp && got && exp.type === got.type
    const placeOk = exp && exp.set === a.set && exp.round === a.round

    if (pointsOk && typeOk && placeOk) {
      stats.matches++
      console.log(
        `${C.dim(where.padEnd(6))} ${C.green('OK')}  roll ${String(idx + 1).padStart(3)}  ${describeExpected(exp).padEnd(14)} ${C.dim(`round total ${a.roundPoints}`)} ${C.dim(`+${(ev.dt / 1000).toFixed(1)}s`)}`
      )
    } else {
      const detail = !placeOk
        ? `expected this roll in s${exp?.set}r${exp?.round}, app recorded it in ${where}`
        : `expected ${describeExpected(exp)}, app recorded ${got?.points} pt (${got?.type})`
      stats.mismatches.push({ index: idx + 1, where, detail, expected: exp, got })
      console.log(`${C.dim(where.padEnd(6))} ${C.red('XX')}  roll ${String(idx + 1).padStart(3)}  ${C.red(detail)}`)
    }
    return
  }

  // A round was committed — check the W/L/T against the simulated table.
  if (a.totalResults > prevTotalResults) {
    prevTotalResults = a.totalResults
    stats.rounds++
    const idx = a.totalResults - 1
    const exp = golden?.expectedResults?.[idx]
    const got = a.lastResult
    if (!golden) {
      console.log(`${C.dim(where.padEnd(6))} round committed as ${got}`)
      return
    }
    if (exp && exp.result === got) {
      stats.resultMatches++
      console.log(`${C.dim(where.padEnd(6))} ${C.green('OK')}  round ${idx + 1} finished ${C.bold(got)}`)
    } else {
      stats.resultMismatches.push({ round: idx + 1, expected: exp?.result, got })
      console.log(
        `${C.dim(where.padEnd(6))} ${C.red('XX')}  round ${idx + 1} finished ${got}, golden game says ${exp?.result}`
      )
    }
    return
  }

  console.log(`${C.dim(where.padEnd(6))} ${C.dim(ev.action)} ${C.dim(`phase ${a.phase}`)}`)
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  // Live feed for the roll-list guide: current position + any wrong taps, so the
  // guide can follow the app instead of the player keeping two things in step.
  if (req.method === 'GET' && req.url.startsWith('/feed')) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({
        totalRolls: prevTotalRolls,
        totalResults: prevTotalResults,
        taps: stats.taps,
        matches: stats.matches,
        mismatches: stats.mismatches,
        undos: stats.undos,
        undosPrompted: stats.undosPrompted,
        undosSpontaneous: stats.undosSpontaneous,
        undoVerified: stats.undoVerified,
        undoBad: stats.undoBad,
        prompts: stats.prompts,
        deadTaps: stats.noops,
        lastAt: stats.lastAt,
      }))
    return
  }

  if (req.method === 'GET' && req.url === '/report') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(report(), null, 2))
    return
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`bunco telemetry collector\nwriting ${OUT}\n`)
    return
  }

  // Guide-side events (prompts, mode changes) go into the SAME append-only log,
  // tagged source:'guide', so the history records what the tester was told as
  // well as what they did.
  if (req.method === 'POST' && req.url === '/guide') {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy() })
    req.on('end', () => {
      try {
        const g = JSON.parse(body)
        const rec = { source: 'guide', t: Date.now(), ...g }
        appendFileSync(OUT, JSON.stringify(rec) + '\n')
        if (g.kind === 'prompt') {
          lastPrompt = rec
          stats.prompts++
          console.log(`${C.dim('guide '.padEnd(6))} ${C.cyan('PROMPT')} undo suggested at roll ${g.atRoll} — ${g.detail || ''}`)
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      } catch (err) {
        res.writeHead(400).end('{"ok":false}')
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/events') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 5e6) req.destroy()
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body)
        if (parsed.build && !buildId) buildId = parsed.build
        const { events } = parsed
        for (const ev of events || []) {
          appendFileSync(OUT, JSON.stringify(ev) + '\n')
          handleEvent(ev)
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      } catch (err) {
        console.error('bad payload:', err.message)
        res.writeHead(400).end('{"ok":false}')
      }
    })
    return
  }

  res.writeHead(404).end()
})

function pct(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

function report() {
  const durationMs = stats.lastAt && stats.firstAt ? stats.lastAt - stats.firstAt : 0
  return {
    file: OUT,
    build: buildId,
    golden: golden ? { seed: golden.seed, expectedRolls: golden.expectedRolls.length } : null,
    correctness: {
      tapsCompared: stats.taps,
      matches: stats.matches,
      mismatches: stats.mismatches,
      roundsCompared: stats.rounds,
      resultMatches: stats.resultMatches,
      resultMismatches: stats.resultMismatches,
    },
    ux: {
      sessionMinutes: +(durationMs / 60000).toFixed(1),
      medianGapSec: +(pct(stats.gaps, 50) / 1000).toFixed(2),
      p90GapSec: +(pct(stats.gaps, 90) / 1000).toFixed(2),
      slowestGapSec: +(Math.max(0, ...stats.gaps) / 1000).toFixed(2),
      undos: stats.undos,
      deadTaps: stats.noops,
      timesBackgrounded: stats.backgrounded,
    },
    recovery: {
      guidePrompts: stats.prompts,
      undosPrompted: stats.undosPrompted,
      undosSpontaneous: stats.undosSpontaneous,
      undoVerified: stats.undoVerified,
      undoAnomalies: stats.undoBad,
    },
    events: stats.events,
  }
}

function printReport() {
  const r = report()
  console.log(C.bold('\n\n=== session report ==='))
  console.log(`log:   ${r.file}`)
  console.log(`build: ${r.build || C.amber('unknown — rebuild so results tie to a version')}`)
  if (golden) {
    const bad = r.correctness.mismatches.length + r.correctness.resultMismatches.length
    console.log(
      bad === 0
        ? C.green(
            `correctness: ${r.correctness.matches}/${r.correctness.tapsCompared} rolls and ${r.correctness.resultMatches}/${r.correctness.roundsCompared} round results matched the golden game`
          )
        : C.red(`correctness: ${bad} mismatch(es)`)
    )
    for (const m of r.correctness.mismatches) console.log(C.red(`  roll ${m.index} (${m.where}): ${m.detail}`))
    for (const m of r.correctness.resultMismatches)
      console.log(C.red(`  round ${m.round}: app said ${m.got}, golden says ${m.expected}`))
  }
  console.log(
    `pacing: ${r.ux.sessionMinutes} min, median ${r.ux.medianGapSec}s between taps, p90 ${r.ux.p90GapSec}s, slowest ${r.ux.slowestGapSec}s`
  )
  console.log(
    `friction: ${r.ux.undos} undo(s), ${r.ux.deadTaps} dead tap(s), backgrounded ${r.ux.timesBackgrounded} time(s)`
  )
  const rec = r.recovery
  console.log(
    `recovery: ${rec.guidePrompts} prompt(s) -> ${rec.undosPrompted} prompted undo(s), ${rec.undosSpontaneous} spontaneous; ` +
    (rec.undoVerified === r.ux.undos && r.ux.undos > 0
      ? C.green(`all ${rec.undoVerified} undo(s) left correct state`)
      : rec.undoAnomalies.length
        ? C.red(`${rec.undoAnomalies.length} undo(s) left UNEXPECTED state`)
        : `${rec.undoVerified} verified`)
  )
  writeFileSync(OUT.replace(/\.ndjson$/, '-report.json'), JSON.stringify(r, null, 2))
  console.log(C.dim(`report written to ${OUT.replace(/\.ndjson$/, '-report.json')}`))
}

process.on('SIGINT', () => {
  printReport()
  process.exit(0)
})

// Re-run a saved session through the same comparison instead of listening.
// Same code path as the live diff, so the two can never disagree.
if (REPLAY) {
  const lines = readFileSync(REPLAY, 'utf8').split('\n').filter(Boolean)
  console.log(C.bold(`replaying ${lines.length} events from ${REPLAY}\n`))
  for (const line of lines) {
    try {
      handleEvent(JSON.parse(line))
    } catch {
      console.warn(C.amber('skipped an unparseable line'))
    }
  }
  printReport()
  process.exit(0)
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(C.bold(`bunco telemetry collector on :${PORT}`))
  console.log(`writing  ${OUT}`)
  console.log(golden ? `golden   ${GOLDEN} (seed ${golden.seed}, ${golden.expectedRolls.length} rolls)` : 'golden   none — recording only')
  console.log(C.dim('Ctrl-C for the session report\n'))
})
