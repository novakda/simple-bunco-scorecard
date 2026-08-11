import { describe, it, expect, beforeEach, vi } from 'vitest'

// Records every wake-lock request so a test can assert one actually happens.
// The previous mock was `useWakeLock: () => {}`, which swallowed the fact that the
// composable never called request() — the mock was the reason the no-op survived.
// vi.hoisted() is required: vi.mock factories run before module-body initialisation.
const { wakeLockRequests } = vi.hoisted(() => ({ wakeLockRequests: [] }))

// Mock @vueuse/core before importing the composable
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

// Re-import after mock is in place
const { useGameState, TOTAL_SETS } = await import('./useGameState.js')

function fresh() {
  vi.resetModules()
  return useGameState()
}

describe('useGameState — phase transition table', () => {
  let g

  beforeEach(() => {
    g = fresh()
  })

  // Row 1: playing + recordScore(21, 'bunco') → round-end
  it('bunco roll transitions playing → round-end', () => {
    g.recordScore(21, 'bunco')
    expect(g.phase.value).toBe('round-end')
    expect(g.lastRoll.value.type).toBe('bunco')
    expect(g.lastRoll.value.points).toBe(21)
  })

  // Row 2: playing + recordScore(n, 'mini') → playing, uses miniBuncoPoints
  it('mini-bunco stays in playing, uses miniBuncoPoints', () => {
    g.recordScore(0, 'mini')
    expect(g.phase.value).toBe('playing')
    expect(g.lastRoll.value.points).toBe(5)
    expect(g.lastRoll.value.type).toBe('mini')
  })

  // Row 3: playing + recordScore(n, 'normal') → playing
  it('normal roll stays in playing', () => {
    g.recordScore(2, 'normal')
    expect(g.phase.value).toBe('playing')
    expect(g.roundPoints.value).toBe(2)
  })

  // Row 4: phase!=='playing' + recordScore → no-op
  it('recordScore no-ops when phase is not playing', () => {
    g.endRound()
    const before = g._state.value.rolls.length
    g.recordScore(3, 'normal')
    expect(g._state.value.rolls.length).toBe(before)
    expect(g.phase.value).toBe('round-end')
  })

  // Row 5: playing + endRound() → round-end
  it('endRound transitions playing → round-end', () => {
    g.endRound()
    expect(g.phase.value).toBe('round-end')
  })

  // Row 6: playing + undoLast() with rolls → playing, pops last roll
  it('undoLast pops last roll in playing phase', () => {
    g.recordScore(1, 'normal')
    g.recordScore(2, 'normal')
    g.undoLast()
    expect(g.roundPoints.value).toBe(1)
    expect(g.phase.value).toBe('playing')
  })

  // Row 7: playing + undoLast() with no rolls → no-op
  it('undoLast no-ops when no rolls in current round', () => {
    g.undoLast()
    expect(g.phase.value).toBe('playing')
    expect(g._state.value.rolls.length).toBe(0)
  })

  // Row 8: round-end + commitRound, currentRound < 6 → playing, currentRound++
  it('commitRound advances round when currentRound < 6', () => {
    g.endRound()
    g.commitRound('W')
    expect(g.phase.value).toBe('playing')
    expect(g.currentRound.value).toBe(2)
  })

  // Row 9: round-end + commitRound, currentRound === 6 → set-end
  it('commitRound on round 6 transitions → set-end', () => {
    g._state.value.currentRound = 6
    g.endRound()
    g.commitRound('L')
    expect(g.phase.value).toBe('set-end')
  })

  // Row 10: round-end + undoLast, last roll is bunco → drop it, return to playing.
  // Previously a no-op, which made a mis-tapped BUNCO! (21 points, the largest
  // possible scoring error) the one mistake you could not take back.
  it('undoLast takes back a mis-tapped bunco', () => {
    g.recordScore(21, 'bunco')
    expect(g.phase.value).toBe('round-end')
    g.undoLast()
    expect(g.phase.value).toBe('playing')
    expect(g.roundPoints.value).toBe(0)
    expect(g.lastRoll.value).toBe(null)
  })

  // Row 11: round-end + undoLast, last roll not bunco → playing (cancel endRound)
  it('undoLast cancels manual endRound, returns to playing', () => {
    g.recordScore(2, 'normal')
    g.endRound()
    g.undoLast()
    expect(g.phase.value).toBe('playing')
    expect(g.roundPoints.value).toBe(2)
  })

  // Row 12: set-end + nextSet, currentSet < 6 → playing, currentSet++
  it('nextSet advances set when currentSet < 6', () => {
    g._state.value.currentRound = 6
    g.endRound()
    g.commitRound('W')
    expect(g.phase.value).toBe('set-end')
    g.nextSet()
    expect(g.phase.value).toBe('playing')
    expect(g.currentSet.value).toBe(2)
    expect(g.currentRound.value).toBe(1)
  })

  // Row 13: set-end + nextSet, on the final set → game-over.
  // The group plays THREE sets of 1-6, not six.
  it('nextSet on the final set transitions → game-over', () => {
    g._state.value.currentSet = TOTAL_SETS
    g._state.value.currentRound = 6
    g.endRound()
    g.commitRound('T')
    g.nextSet()
    expect(g.phase.value).toBe('game-over')
  })

  // Row 14: game-over + newGame() → playing, preserves miniBuncoPoints
  it('newGame resets to playing and preserves miniBuncoPoints', () => {
    g._state.value.miniBuncoPoints = 7
    g._state.value.phase = 'game-over'
    g.newGame()
    expect(g.phase.value).toBe('playing')
    expect(g._state.value.miniBuncoPoints).toBe(7)
    expect(g.currentSet.value).toBe(1)
    expect(g.currentRound.value).toBe(1)
    expect(g._state.value.rolls.length).toBe(0)
  })

  // Row 15: any + resetGame → playing, preserves miniBuncoPoints
  it('resetGame works from any phase', () => {
    g.recordScore(21, 'bunco')
    g.resetGame()
    expect(g.phase.value).toBe('playing')
    expect(g._state.value.rolls.length).toBe(0)
  })

  // Edge cases
  it('roundPoints accumulates across multiple rolls', () => {
    g.recordScore(1, 'normal')
    g.recordScore(3, 'normal')
    g.recordScore(0, 'mini') // 5 pts
    expect(g.roundPoints.value).toBe(9)
  })

  it('pointsToWin counts down correctly', () => {
    g.recordScore(3, 'normal')
    expect(g.pointsToWin.value).toBe(18)
  })

  it('pointsToWin floors at 0 not negative', () => {
    g.recordScore(21, 'bunco')
    expect(g.pointsToWin.value).toBe(0)
  })

  it('undoLast does not cross round boundaries', () => {
    g.endRound()
    g.commitRound('W') // advances to round 2
    g.recordScore(2, 'normal')
    g.undoLast()
    // Only the round 2 roll should be gone; round 1 result persists
    expect(g._state.value.results.length).toBe(1)
    expect(g.roundPoints.value).toBe(0)
  })

  it('setRollHistory filters to current set only', () => {
    g.recordScore(1, 'normal')
    g._state.value.rolls.push({ set: 2, round: 1, points: 3, type: 'normal' })
    expect(g.setRollHistory.value.every(r => r.set === 1)).toBe(true)
  })
})

describe('useGameState — screen wake lock', () => {
  it('requests a screen wake lock on init', () => {
    const before = wakeLockRequests.length
    fresh()
    // Regression guard: useWakeLock() alone acquires nothing — only request() does.
    // The phone must not sleep between rolls during a game.
    expect(wakeLockRequests.slice(before)).toEqual(['screen'])
  })
})
