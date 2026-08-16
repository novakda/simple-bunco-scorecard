/**
 * Guards for the three defects found in the 2026-08-14 live session that were
 * about FEEDBACK rather than scoring — the app computed correctly throughout,
 * but did not tell the player enough to keep them in sync with reality.
 */
import { describe, it, expect, vi } from 'vitest'
import appSrc from '../App.vue?raw'
import gameContextSrc from '../components/GameContext.vue?raw'

vi.mock('@vueuse/core', () => {
  const { ref } = require('vue')
  return {
    useLocalStorage: (_k, initial) => ref(JSON.parse(JSON.stringify(initial))),
    useWakeLock: () => ({ request: () => Promise.resolve(), release: () => Promise.resolve() }),
  }
})
const { useGameState } = await import('./useGameState.js')

describe('a zero-point tap must still change something on screen', () => {
  it('counts every roll this round, including the scoreless ones', () => {
    const g = useGameState()
    expect(g.rollsThisRound.value).toBe(0)

    g.recordScore(0, 'normal')
    // The score has NOT moved — this counter is the only visible change.
    expect(g.roundPoints.value).toBe(0)
    expect(g.rollsThisRound.value).toBe(1)

    g.recordScore(0, 'normal')
    expect(g.roundPoints.value).toBe(0)
    expect(g.rollsThisRound.value).toBe(2)
  })

  it('resets the count at a round boundary', () => {
    const g = useGameState()
    g.recordScore(1, 'normal')
    g.recordScore(0, 'normal')
    expect(g.rollsThisRound.value).toBe(2)

    g.endRound()
    g.commitRound('L')
    expect(g.currentRound.value).toBe(2)
    expect(g.rollsThisRound.value).toBe(0)
  })

  it('drops back when a roll is undone', () => {
    const g = useGameState()
    g.recordScore(0, 'normal')
    g.recordScore(0, 'normal')
    g.undoLast()
    expect(g.rollsThisRound.value).toBe(1)
  })

  it('is rendered by GameContext', () => {
    expect(gameContextSrc).toMatch(/rollsThisRound/)
    expect(appSrc).toMatch(/:rollsThisRound="rollsThisRound"/)
  })

  it('restores a pressed state on buttons, which the tap-highlight reset removed', () => {
    expect(appSrc).toMatch(/button:active\s*\{/)
  })
})

describe('the round-end screen must show what you scored', () => {
  it('renders roundPoints alongside the W/L/T choice', () => {
    const roundEnd = appSrc.slice(appSrc.indexOf('isRoundEndPhase'), appSrc.indexOf('Set End'))
    expect(roundEnd).toMatch(/roundPoints/)
  })
})

/**
 * SUPERSEDED 2026-08-15. This block used to require the BUNCO auto-advance to
 * exist and to last at least five seconds -- the fix for #1054, which was a real
 * improvement on the original two.
 *
 * Live play then showed the timer was the wrong shape of fix. A longer window
 * makes it MORE likely the auto-advance fires while the player is still acting
 * on the celebration, so the app moves into the next round underneath them and
 * their next press lands somewhere they did not expect. That is #1104: a whole
 * round committed empty, unrecoverably.
 *
 * The auto-advance is now gone rather than retuned. A Bunco ends the round and
 * the round-end screen appears; nothing moves until the player presses. The
 * tests below assert the new contract, and deliberately assert the ABSENCE of
 * the timer, because a reintroduced one would bring #1104 back with it.
 */
describe('nothing advances the game on a timer', () => {
  it('has no BUNCO auto-advance timer at all', () => {
    expect(appSrc).not.toMatch(/BUNCO_AUTO_MS/)
    expect(appSrc, 'a timer must never commit a round').not.toMatch(
      /setTimeout\([^)]*commitRound/
    )
  })

  it('celebrates a Bunco on the same round-end screen, not a separate one', () => {
    // One screen, one way forward. Two screens with two ways forward is what
    // made "End Round" and "a Bunco ends the round" mean different things.
    expect(appSrc).toMatch(/isBuncoRound/)
    expect(appSrc).toMatch(/bunco-banner/)
    expect(appSrc, 'the celebration must not be its own overlay again').not.toMatch(
      /v-if="isBuncoPhase"/
    )
  })

  it('derives the celebration from THIS round, not the globally last roll', () => {
    // Source-level guard because the bug is in a computed in App.vue, and the
    // composable-level fuzzer cannot reach it. lastRoll is still imported and
    // still correct for telemetry; what must not come back is isBuncoRound
    // being derived from it.
    const decl = appSrc.slice(appSrc.indexOf('const isBuncoRound'))
    const body = decl.slice(0, decl.indexOf(')\n'))
    expect(body).toMatch(/lastRollThisRound/)
    expect(body, 'isBuncoRound must not read the unscoped lastRoll').not.toMatch(
      /lastRoll\.value/
    )
  })

  it('leaves the explicit W/L/T press as the only way out of round-end', () => {
    const roundEnd = appSrc.slice(appSrc.indexOf('isRoundEndPhase'), appSrc.indexOf('Set End'))
    expect(roundEnd).toMatch(/commitRound\('W'\)/)
    expect(roundEnd).toMatch(/commitRound\('L'\)/)
    expect(roundEnd).toMatch(/commitRound\('T'\)/)
    expect(roundEnd, 'undo must be reachable from the round-end screen').toMatch(/undoLast/)
  })
})
