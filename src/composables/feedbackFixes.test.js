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

describe('the BUNCO screen must stay long enough to undo a mis-tap', () => {
  it('gives at least five seconds before auto-advancing', () => {
    const m = appSrc.match(/const BUNCO_AUTO_MS\s*=\s*(\d+)/)
    expect(m, 'BUNCO_AUTO_MS must be a named constant').toBeTruthy()
    expect(Number(m[1])).toBeGreaterThanOrEqual(5000)
  })

  it('shows the countdown rather than running it silently', () => {
    expect(appSrc).toMatch(/bunco-countdown/)
    expect(appSrc).toMatch(/buncoProgress/)
  })

  it('still auto-advances, so the screen is not a dead end', () => {
    expect(appSrc).toMatch(/setTimeout\(\(\) => commitRound\('W'\), BUNCO_AUTO_MS\)/)
  })
})
