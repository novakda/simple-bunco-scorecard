/**
 * Full-game simulation tests.
 *
 * Plays complete simulated Bunco games against the real composable and checks the
 * results against independently-computed expectations and against the published
 * rules of Bunco.
 *
 * Rules reference (dicegamedepot.com/bunco-rules, mplgames.com/blog/how-to-play-bunco):
 *   - A set is one pass through targets 1-6. The ROUND NUMBER IS THE TARGET:
 *     round 1 rolls for 1s, round 3 rolls for 3s, and so on.
 *   - This group plays THREE sets, so a full game is 18 rounds.
 *   - Each die matching the round's target scores 1 point.
 *   - All three dice matching the target is a BUNCO and scores 21.
 *   - All three dice matching each other but NOT the target is a "mini Bunco", 5 points.
 *   - A round ends when a team at the head table reaches 21.
 *
 * Consequence used throughout: a roll of three dice can score 0, 1, or 2 by matching,
 * or 21 (Bunco), or 5 (mini Bunco). THREE MATCHING DICE IS NEVER WORTH 3 POINTS.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

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

const { useGameState } = await import('./useGameState.js')

function fresh() {
  vi.resetModules()
  return useGameState()
}

// ── Deterministic PRNG so failures are reproducible ────────────────────────────
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const SETS = 3       // the group plays three sets
const ROUNDS_PER_SET = 6  // each set is one pass through targets 1-6

/** Roll three physical dice. */
function rollDice(rand) {
  return [
    1 + Math.floor(rand() * 6),
    1 + Math.floor(rand() * 6),
    1 + Math.floor(rand() * 6),
  ]
}

/**
 * The correct score for a roll, per the published rules.
 * Returns { points, kind }.
 */
function scoreRoll(dice, target) {
  const allSame = dice[0] === dice[1] && dice[1] === dice[2]
  if (allSame && dice[0] === target) return { points: 21, kind: 'bunco' }
  if (allSame) return { points: 5, kind: 'mini' }
  return { points: dice.filter((d) => d === target).length, kind: 'normal' }
}

/**
 * Drive the app the way a player would for one roll, given the physical dice.
 * Mirrors the actual UI affordances: 0/1/2 buttons, BUNCO!, MINI-BUNCO.
 */
function tapForRoll(g, dice, target) {
  const { points, kind } = scoreRoll(dice, target)
  if (kind === 'bunco') g.recordScore(21, 'bunco')
  else if (kind === 'mini') g.recordScore(0, 'mini')
  else g.recordScore(points, 'normal')
  return { points, kind }
}

/**
 * Play one full game to completion, recording an independent ledger of what
 * SHOULD have happened. Returns { g, ledger }.
 */
function playFullGame(seed, { maxRollsPerRound = 40 } = {}) {
  const rand = rng(seed)
  const g = fresh()
  const ledger = { rolls: [], results: [], targetsSeen: [] }

  for (let set = 1; set <= SETS; set++) {
    for (let round = 1; round <= ROUNDS_PER_SET; round++) {
      ledger.targetsSeen.push({
        set,
        round,
        appTarget: g.targetNumber.value,
        // Per the rules, the target is the round number.
        correctTarget: round,
      })

      const target = g.targetNumber.value
      let roundPoints = 0
      let ended = false

      for (let i = 0; i < maxRollsPerRound && !ended; i++) {
        if (g.phase.value !== 'playing') break
        const dice = rollDice(rand)
        const { points, kind } = tapForRoll(g, dice, target)
        roundPoints += points
        ledger.rolls.push({ set, round, points, kind })
        if (kind === 'bunco') ended = true
        else if (roundPoints >= 21) ended = true
      }

      // Close the round the way the UI does.
      if (g.phase.value === 'playing') g.endRound()
      if (g.phase.value === 'round-end') {
        const result = roundPoints >= 21 ? 'W' : rand() < 0.5 ? 'L' : 'T'
        g.commitRound(result)
        ledger.results.push({ set, round, result })
      }
    }
    // Round 6 committed => 'set-end'. Advance to the next set.
    if (g.phase.value === 'set-end') g.nextSet()
  }

  return { g, ledger }
}

// ══════════════════════════════════════════════════════════════════════════════
// A. Structural integrity across many full games
// ══════════════════════════════════════════════════════════════════════════════

describe('full game simulation — structure', () => {
  const SEEDS = Array.from({ length: 50 }, (_, i) => 1000 + i)

  it('every game reaches game-over after 3 sets of 6 rounds', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      expect(g.phase.value, `seed ${seed}`).toBe('game-over')
    }
  })

  it('records exactly 18 round results per game', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      expect(g._state.value.results.length, `seed ${seed}`).toBe(SETS * ROUNDS_PER_SET)
    }
  })

  it('every set has exactly 6 results', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      for (let s = 1; s <= SETS; s++) {
        const n = g._state.value.results.filter((r) => r.set === s).length
        expect(n, `seed ${seed} set ${s}`).toBe(6)
      }
    }
  })

  it('no result is ever recorded for a round outside 1..6', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      for (const r of g._state.value.results) {
        expect(r.round).toBeGreaterThanOrEqual(1)
        expect(r.round).toBeLessThanOrEqual(6)
      }
    }
  })

  it('scoring is refused once the game is over', () => {
    const { g } = playFullGame(2026)
    const before = g._state.value.rolls.length
    g.recordScore(3, 'normal')
    g.recordScore(21, 'bunco')
    expect(g._state.value.rolls.length).toBe(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// B. Arithmetic — app totals vs an independent ledger
// ══════════════════════════════════════════════════════════════════════════════

describe('full game simulation — arithmetic', () => {
  const SEEDS = Array.from({ length: 50 }, (_, i) => 5000 + i)

  it('total points equal the independent sum of every roll', () => {
    for (const seed of SEEDS) {
      const { g, ledger } = playFullGame(seed)
      const appTotal = g._state.value.rolls.reduce((s, r) => s + r.points, 0)
      const expected = ledger.rolls.reduce((s, r) => s + r.points, 0)
      expect(appTotal, `seed ${seed}`).toBe(expected)
    }
  })

  it('per-set point totals match the ledger', () => {
    for (const seed of SEEDS) {
      const { g, ledger } = playFullGame(seed)
      for (let s = 1; s <= SETS; s++) {
        const appSet = g._state.value.rolls
          .filter((r) => r.set === s)
          .reduce((sum, r) => sum + r.points, 0)
        const expSet = ledger.rolls
          .filter((r) => r.set === s)
          .reduce((sum, r) => sum + r.points, 0)
        expect(appSet, `seed ${seed} set ${s}`).toBe(expSet)
      }
    }
  })

  it('bunco count matches the ledger', () => {
    for (const seed of SEEDS) {
      const { g, ledger } = playFullGame(seed)
      const appBuncos = g._state.value.rolls.filter((r) => r.type === 'bunco').length
      const expBuncos = ledger.rolls.filter((r) => r.kind === 'bunco').length
      expect(appBuncos, `seed ${seed}`).toBe(expBuncos)
    }
  })

  it('a Bunco is always worth exactly 21', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      for (const r of g._state.value.rolls.filter((x) => x.type === 'bunco')) {
        expect(r.points).toBe(21)
      }
    }
  })

  it('a mini Bunco is always worth exactly 5', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      for (const r of g._state.value.rolls.filter((x) => x.type === 'mini')) {
        expect(r.points).toBe(5)
      }
    }
  })

  it('no roll ever scores a negative number of points', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      for (const r of g._state.value.rolls) expect(r.points).toBeGreaterThanOrEqual(0)
    }
  })

  it('W/L/T tallies across all sets sum to every round played', () => {
    for (const seed of SEEDS) {
      const { g } = playFullGame(seed)
      const res = g._state.value.results
      const w = res.filter((r) => r.result === 'W').length
      const l = res.filter((r) => r.result === 'L').length
      const t = res.filter((r) => r.result === 'T').length
      expect(w + l + t, `seed ${seed}`).toBe(SETS * ROUNDS_PER_SET)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// C. The target number — checked against the published rules
// ══════════════════════════════════════════════════════════════════════════════

describe('target number follows the round, per Bunco rules', () => {
  it('round N rolls for Ns, in every set', () => {
    const { ledger } = playFullGame(7)
    const wrong = ledger.targetsSeen.filter((t) => t.appTarget !== t.correctTarget)
    const sample = wrong
      .slice(0, 6)
      .map((t) => `set ${t.set} round ${t.round}: app says ${t.appTarget}, rules say ${t.correctTarget}`)
    expect(
      wrong.length,
      `target number is wrong in ${wrong.length}/${SETS * ROUNDS_PER_SET} rounds. Examples:\n  ${sample.join('\n  ')}`,
    ).toBe(0)
  })

  it('a full game rolls for each of 1..6 once per set', () => {
    const { ledger } = playFullGame(11)
    const counts = {}
    for (const t of ledger.targetsSeen) counts[t.appTarget] = (counts[t.appTarget] ?? 0) + 1
    expect(counts).toEqual({ 1: SETS, 2: SETS, 3: SETS, 4: SETS, 5: SETS, 6: SETS })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// D. Roll scoring semantics — what the buttons can express
// ══════════════════════════════════════════════════════════════════════════════

describe('scoring semantics vs the rules', () => {
  it('three dice matching the target scores 21, never 3', () => {
    const target = 4
    const { points, kind } = scoreRoll([target, target, target], target)
    expect({ points, kind }).toEqual({ points: 21, kind: 'bunco' })
  })

  it('the UI never needs a "3 matching dice" button worth 3 points', () => {
    // Enumerate every possible roll of three dice against every target and
    // collect the legitimate point values for a plain (non-three-of-a-kind) roll.
    const legit = new Set()
    for (let target = 1; target <= 6; target++) {
      for (let a = 1; a <= 6; a++)
        for (let b = 1; b <= 6; b++)
          for (let c = 1; c <= 6; c++) {
            const { points, kind } = scoreRoll([a, b, c], target)
            if (kind === 'normal') legit.add(points)
          }
    }
    // A "normal" roll can only ever be worth 0, 1 or 2.
    expect([...legit].sort()).toEqual([0, 1, 2])
  })

  it('mini Bunco is scored as 5 regardless of the number rolled', () => {
    for (let face = 1; face <= 6; face++) {
      for (let target = 1; target <= 6; target++) {
        if (face === target) continue
        expect(scoreRoll([face, face, face], target).points).toBe(5)
      }
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// E. Undo — fuzzed against full games
// ══════════════════════════════════════════════════════════════════════════════

describe('undo under simulation', () => {
  it('undo never removes a roll from a previous round', () => {
    // UPDATED 2026-08-15 with the move to undo-as-history. The invariant in the
    // name is unchanged and still the point; the old body asserted something
    // stronger and wrong -- that undo in a fresh round is a NO-OP -- which held
    // only because undo could not step back over commitRound at all. Ten presses
    // now walk ten steps back, as they should. What must never happen is undo
    // reaching PAST the current round to delete a completed round's roll, which
    // is exactly what the old implementation did with a Bunco (see #1106).
    const rand = rng(31337)
    const g = fresh()
    for (let i = 0; i < 5; i++) g.recordScore(1, 'normal')
    g.endRound()
    const beforeCommit = g._state.value.rolls.map((r) => `${r.set}-${r.round}-${r.points}`)
    g.commitRound('W')
    expect(g.currentRound.value).toBe(2)
    expect(g.rollsThisRound.value).toBe(0)

    // One undo steps back over the commit only: round 1's rolls are untouched.
    g.undoLast()
    expect(g.currentRound.value).toBe(1)
    expect(g._state.value.rolls.map((r) => `${r.set}-${r.round}-${r.points}`)).toEqual(beforeCommit)
    void rand
  })

  it('undo removes exactly one roll at a time', () => {
    const g = fresh()
    g.recordScore(2, 'normal')
    g.recordScore(1, 'normal')
    g.recordScore(2, 'normal')
    expect(g.roundPoints.value).toBe(5)
    g.undoLast()
    expect(g.roundPoints.value).toBe(3)
    g.undoLast()
    expect(g.roundPoints.value).toBe(2)
    g.undoLast()
    expect(g.roundPoints.value).toBe(0)
    g.undoLast()
    expect(g.roundPoints.value).toBe(0)
  })

  it('roundPoints never goes negative under heavy undo fuzzing', () => {
    const rand = rng(99)
    const g = fresh()
    for (let i = 0; i < 2000; i++) {
      const roll = rand()
      if (roll < 0.5 && g.phase.value === 'playing') g.recordScore(1 + Math.floor(rand() * 2), 'normal')
      else if (roll < 0.8) g.undoLast()
      else if (roll < 0.9 && g.phase.value === 'playing') g.endRound()
      else if (g.phase.value === 'round-end') g.commitRound('W')
      expect(g.roundPoints.value).toBeGreaterThanOrEqual(0)
      expect(g.pointsToWin.value).toBeGreaterThanOrEqual(0)
    }
  })

  it('a mis-tapped Bunco can be undone', () => {
    const g = fresh()
    g.recordScore(1, 'normal')
    g.recordScore(21, 'bunco')
    expect(g.roundPoints.value).toBe(22)
    g.undoLast()
    expect(
      g.roundPoints.value,
      'tapping BUNCO! by mistake should be recoverable — it is the largest possible scoring error',
    ).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// F. Phase machine
// ══════════════════════════════════════════════════════════════════════════════

describe('phase machine under simulation', () => {
  const LEGAL = new Set(['playing', 'round-end', 'set-end', 'game-over'])

  it('phase is always one of the four legal values', () => {
    const rand = rng(4242)
    const g = fresh()
    for (let i = 0; i < 3000; i++) {
      const r = rand()
      if (r < 0.4) g.recordScore(Math.floor(rand() * 3), 'normal')
      else if (r < 0.5) g.recordScore(21, 'bunco')
      else if (r < 0.6) g.recordScore(0, 'mini')
      else if (r < 0.7) g.endRound()
      else if (r < 0.85) g.commitRound(['W', 'L', 'T'][Math.floor(rand() * 3)])
      else if (r < 0.95) g.nextSet()
      else g.undoLast()
      expect(LEGAL.has(g.phase.value), `illegal phase ${g.phase.value} at step ${i}`).toBe(true)
      expect(g.currentRound.value).toBeGreaterThanOrEqual(1)
      expect(g.currentSet.value).toBeGreaterThanOrEqual(1)
    }
  })

  it('the set counter never exceeds the configured total', () => {
    const g = fresh()
    for (let i = 0; i < 200; i++) g.nextSet()
    expect(g.currentSet.value).toBeLessThanOrEqual(SETS)
  })

  it('the round counter never exceeds 6', () => {
    const g = fresh()
    for (let i = 0; i < 200; i++) {
      g.endRound()
      g.commitRound('W')
    }
    expect(g.currentRound.value).toBeLessThanOrEqual(6)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// F2. Double-commit — the BUNCO! screen has both a 2s auto-advance and a tap
// ══════════════════════════════════════════════════════════════════════════════

describe('double commitRound for one round', () => {
  it('committing twice must not record two results for the same round', () => {
    const g = fresh()
    g.recordScore(21, 'bunco') // -> round-end
    expect(g.phase.value).toBe('round-end')

    // App.vue arms a 2000ms setTimeout(commitRound('W')) AND lets the user tap
    // the celebration screen to advance early. If both land, this is what happens.
    g.commitRound('W')
    g.commitRound('W')

    const round1 = g._state.value.results.filter((r) => r.set === 1 && r.round === 1)
    expect(
      round1.length,
      'the BUNCO! screen can auto-advance and be tapped; a duplicate commit must be ignored',
    ).toBe(1)
  })

  it('committing twice must not skip a round', () => {
    const g = fresh()
    g.recordScore(21, 'bunco')
    g.commitRound('W')
    g.commitRound('W')
    expect(g.currentRound.value, 'a duplicate commit skipped a round').toBe(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// G. New game resets everything
// ══════════════════════════════════════════════════════════════════════════════

describe('new game after a full game', () => {
  it('clears rolls, results, set and round', () => {
    const { g } = playFullGame(777)
    expect(g._state.value.results.length).toBe(SETS * ROUNDS_PER_SET)
    g.newGame()
    expect(g._state.value.rolls).toEqual([])
    expect(g._state.value.results).toEqual([])
    expect(g.currentSet.value).toBe(1)
    expect(g.currentRound.value).toBe(1)
    expect(g.phase.value).toBe('playing')
    expect(g.roundPoints.value).toBe(0)
    expect(g.pointsToWin.value).toBe(21)
  })
})
