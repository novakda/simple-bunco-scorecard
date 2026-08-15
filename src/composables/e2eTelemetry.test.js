/**
 * End-to-end: play a golden game through the real composable with telemetry
 * switched on, and check both halves of the loop.
 *
 *   1. The app's own state must match what the golden game predicted. This is
 *      the offline half of the comparison and needs no phone at all — a scoring
 *      defect fails here.
 *   2. The telemetry stream must carry enough to reconstruct that same verdict,
 *      because that stream is all the collector ever sees.
 *
 * The captured stream is written to telemetry/e2e-session.ndjson so it can be
 * pushed through the collector's own diff:
 *
 *   npm run replay -- telemetry/e2e-session.ndjson
 *
 * That closes the loop: same expectations, same comparison code, no phone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { buildGame, findSeed } from '../lib/goldenGame.js'

const COLLECTOR = 'http://collector.test:31403'

const { wakeLockRequests } = vi.hoisted(() => ({ wakeLockRequests: [] }))

vi.mock('@vueuse/core', () => {
  const { ref } = require('vue')
  return {
    useLocalStorage: (_key, initial) => ref(JSON.parse(JSON.stringify(initial))),
    useWakeLock: () => ({
      request: (type) => {
        wakeLockRequests.push(type)
        return Promise.resolve()
      },
      release: () => Promise.resolve(),
    }),
  }
})

/** Everything the collector receives, in order. */
const captured = []

async function freshGame() {
  vi.resetModules()
  captured.length = 0
  window.localStorage.clear()
  window.localStorage.setItem('bunco-telemetry-collector', COLLECTOR)
  globalThis.fetch = vi.fn(async (_url, init) => {
    for (const ev of JSON.parse(init.body).events) captured.push(ev)
    return { ok: true, status: 200 }
  })
  const { useGameState } = await import('./useGameState.js')
  return useGameState()
}

/**
 * Events belonging to this game only.
 *
 * A previous test's telemetry instance can still have a flush in flight, and its
 * closure resolves globalThis.fetch at call time, so it lands in whatever capture
 * array is current. Filtering by session id is what the collector does with
 * concurrent sessions anyway.
 */
function eventsFor(g) {
  return captured.filter((e) => e.sid === g.telemetry.sid)
}

/** Enter one roll the way the buttons do: BUNCO! and MINI-BUNCO are their own taps. */
function tap(g, roll) {
  if (roll.type === 'bunco') g.recordScore(21, 'bunco')
  else if (roll.type === 'mini') g.recordScore(0, 'mini')
  else g.recordScore(roll.points, 'normal')
}

/** Play a whole golden game through the app exactly as a player would. */
function playGame(g, golden) {
  for (const round of golden.rounds) {
    for (const roll of round.myRolls) tap(g, roll)

    // A Bunco has already moved the app to round-end; anything else needs the
    // End Round button before the W/L/T picker appears.
    if (g.phase.value === 'playing') g.endRound()
    g.commitRound(round.expectedResult)

    // Six rounds done means a set boundary, which needs its own tap to clear.
    if (g.phase.value === 'set-end') g.nextSet()
  }
}

describe('end-to-end: golden game through the real app', () => {
  let golden

  beforeEach(() => {
    golden = findSeed({ sets: 3, seat: 1 })
    expect(golden, 'a seed exercising bunco/mini/tie must exist').toBeTruthy()
  })

  it('the golden game is worth testing against', () => {
    expect(golden.summary.buncos).toBeGreaterThanOrEqual(1)
    expect(golden.summary.miniBuncos).toBeGreaterThanOrEqual(3)
    expect(golden.summary.results.T).toBeGreaterThanOrEqual(1)
    expect(golden.rounds).toHaveLength(18)
  })

  it("leaves the app holding exactly the golden game's rolls and results", async () => {
    const g = await freshGame()
    playGame(g, golden)

    expect(g._state.value.rolls).toEqual(golden.expectedRolls)
    expect(g._state.value.results).toEqual(golden.expectedResults)
    expect(g.phase.value).toBe('game-over')
  })

  it('agrees with the golden round totals round by round', async () => {
    const g = await freshGame()
    for (const round of golden.rounds) {
      for (const roll of round.myRolls) tap(g, roll)

      // roundPoints only counts this player's rolls, which is what the app shows.
      expect(
        g.roundPoints.value,
        `set ${round.set} round ${round.round} should total ${round.expectedRoundPoints}`
      ).toBe(round.expectedRoundPoints)

      if (g.phase.value === 'playing') g.endRound()
      g.commitRound(round.expectedResult)
      if (g.phase.value === 'set-end') g.nextSet()
    }
  })

  it('sends the collector a stream that reproduces every roll', async () => {
    const g = await freshGame()
    playGame(g, golden)
    await vi.waitFor(() => expect(eventsFor(g).length).toBeGreaterThan(golden.expectedRolls.length))

    // Rebuild the roll list from the telemetry alone — this is exactly what the
    // collector does, so if it can be done here it can be done there.
    const reconstructed = []
    let seen = 0
    for (const ev of eventsFor(g)) {
      const total = ev.after?.totalRolls ?? 0
      if (total > seen) {
        reconstructed.push({ ...ev.after.last, set: ev.after.set, round: ev.after.round })
        seen = total
      } else if (total < seen) {
        reconstructed.pop()
        seen = total
      }
    }

    expect(reconstructed).toEqual(
      golden.expectedRolls.map((r) => ({ points: r.points, type: r.type, set: r.set, round: r.round }))
    )
  })

  it('sends the collector every round result', async () => {
    const g = await freshGame()
    playGame(g, golden)
    await vi.waitFor(() => expect(eventsFor(g).length).toBeGreaterThan(golden.expectedRolls.length))

    const results = []
    let seen = 0
    for (const ev of eventsFor(g)) {
      const total = ev.after?.totalResults ?? 0
      if (total > seen) {
        results.push(ev.after.lastResult)
        seen = total
      }
    }
    expect(results).toEqual(golden.expectedResults.map((r) => r.result))
  })

  it('flags a mis-entered roll rather than silently accepting it', async () => {
    const g = await freshGame()
    const first = golden.rounds[0].myRolls[0]

    // Fat-finger the very first roll: tap a different number than the dice showed.
    const mistap = first.points === 2 ? 1 : first.points + 1
    g.recordScore(mistap, 'normal')

    const stored = g._state.value.rolls[0]
    expect(stored.points).toBe(mistap)
    expect(stored.points).not.toBe(first.points)

    // The telemetry carries the value the app STORED, which is what lets the
    // collector see that it drifted from the golden game.
    await vi.waitFor(() => expect(eventsFor(g).some((e) => e.after?.last)).toBe(true))
    const ev = eventsFor(g).find((e) => e.after?.last)
    expect(ev.after.last.points).toBe(stored.points)
    expect(ev.after.last.points).not.toBe(golden.expectedRolls[0].points)
  })

  it('writes the session log for the collector to replay', async () => {
    const g = await freshGame()
    playGame(g, golden)
    await vi.waitFor(() => expect(eventsFor(g).length).toBeGreaterThan(golden.expectedRolls.length))

    const mine = eventsFor(g)
    if (!existsSync('telemetry')) mkdirSync('telemetry', { recursive: true })
    writeFileSync('telemetry/e2e-session.ndjson', mine.map((e) => JSON.stringify(e)).join('\n') + '\n')
    writeFileSync('telemetry/e2e-golden.json', JSON.stringify(golden, null, 2))

    expect(mine.length).toBeGreaterThan(golden.expectedRolls.length)
  })
})
