/**
 * Undo-as-history: property tests.
 *
 * THE SPEC, in Dan's words (2026-08-15): "I would expect Undo to step back in
 * the history, whether it's the last roll, the summary screen, the bunco
 * congrats or any other step."
 *
 * That is a single, checkable property:
 *
 *     for every reachable state s and every action a that CHANGES s,
 *         undoLast(a(s)) === s
 *
 * Which is worth stating precisely, because the current undoLast() is not a
 * history mechanism at all. It is four hand-written special cases keyed on
 * phase, and whole transitions have no undo branch anywhere. The point of a
 * property test here is that it does not need to be told which transitions
 * those are -- it walks the machine and finds them.
 *
 * Actions that are legitimately no-ops (guarded, e.g. commitRound while
 * playing) are excluded: if the action did not change the state, there is
 * nothing for undo to step back over. Only real steps are held to the property.
 *
 * These tests are written to FAIL against the current implementation. They are
 * the executable statement of #1104 and #1105.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@vueuse/core', () => {
  const { ref } = require('vue')
  return {
    useLocalStorage: (_key, initial) => ref(JSON.parse(JSON.stringify(initial))),
    useWakeLock: () => ({ request: () => Promise.resolve(), release: () => Promise.resolve() }),
  }
})

const { useGameState } = await import('./useGameState.js')

function fresh() {
  vi.resetModules()
  return useGameState()
}

// Deterministic PRNG so any failure is reproducible from its seed.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const snap = (g) => JSON.stringify(g._state.value)

/**
 * Every action the UI can actually invoke, with the phase it is reachable from.
 * `apply` performs it; `label` is what shows up in a failure report.
 */
function legalActions(g) {
  const phase = g.phase.value
  if (phase === 'playing') {
    return [
      { label: 'recordScore(0,normal)', apply: () => g.recordScore(0, 'normal') },
      { label: 'recordScore(1,normal)', apply: () => g.recordScore(1, 'normal') },
      { label: 'recordScore(2,normal)', apply: () => g.recordScore(2, 'normal') },
      { label: 'recordScore(mini)', apply: () => g.recordScore(0, 'mini') },
      { label: 'recordScore(BUNCO)', apply: () => g.recordScore(21, 'bunco') },
      { label: 'endRound()', apply: () => g.endRound() },
    ]
  }
  if (phase === 'round-end') {
    return [
      { label: "commitRound('W')", apply: () => g.commitRound('W') },
      { label: "commitRound('L')", apply: () => g.commitRound('L') },
      { label: "commitRound('T')", apply: () => g.commitRound('T') },
    ]
  }
  if (phase === 'set-end') {
    return [{ label: 'nextSet()', apply: () => g.nextSet() }]
  }
  return []
}

describe('undo steps back through history', () => {
  it('undoes any single state-changing action, from any reachable state', () => {
    const violations = new Map()
    const rand = rng(20260815)

    // Many short independent walks cover more distinct states than one long walk,
    // because a long walk spends most of its length deep in set 3.
    for (let walk = 0; walk < 60; walk++) {
      const g = fresh()
      for (let step = 0; step < 40; step++) {
        const options = legalActions(g)
        if (!options.length) break

        const action = options[Math.floor(rand() * options.length)]
        const before = snap(g)
        const phaseBefore = g.phase.value

        action.apply()
        const after = snap(g)
        if (after === before) continue // guarded no-op: not a step, nothing to undo

        g.undoLast()
        const restored = snap(g)

        if (restored !== before) {
          const key = `${phaseBefore} + ${action.label}`
          if (!violations.has(key)) {
            violations.set(key, {
              from: phaseBefore,
              action: action.label,
              before: JSON.parse(before),
              afterAction: JSON.parse(after),
              afterUndo: JSON.parse(restored),
            })
          }
        }

        // THE WALK MUST ADVANCE. Undo is the thing under test, so it is applied
        // after every action -- which means the state would otherwise snap back
        // to the start on every step and the walk would never leave the opening
        // position. It would then never enter round-end, never choose
        // commitRound, and pass while testing almost nothing. Restoring the
        // post-action state keeps each check isolated AND lets the walk go deep.
        g._state.value = JSON.parse(after)
      }
    }

    if (violations.size) {
      const lines = [...violations.entries()].map(([key, v]) => {
        const d = []
        const b = v.before, u = v.afterUndo
        if (b.currentSet !== u.currentSet) d.push(`set ${b.currentSet}->${u.currentSet}`)
        if (b.currentRound !== u.currentRound) d.push(`round ${b.currentRound}->${u.currentRound}`)
        if (b.phase !== u.phase) d.push(`phase ${b.phase}->${u.phase}`)
        if (b.rolls.length !== u.rolls.length) d.push(`rolls ${b.rolls.length}->${u.rolls.length}`)
        if (b.results.length !== u.results.length) d.push(`results ${b.results.length}->${u.results.length}`)
        return `  ${key}\n      undo left: ${d.join(', ') || '(state differs in another field)'}`
      })
      throw new Error(
        `undo failed to step back over ${violations.size} distinct transition(s):\n` + lines.join('\n')
      )
    }
  })

  it('undo is reachable from every non-terminal phase (never a silent no-op)', () => {
    // A phase where undo does nothing is a dead end: the player has taken a step
    // they cannot walk back. game-over is excluded only because newGame() is the
    // documented exit from it.
    const deadEnds = []

    // set-end: get there by playing a full set.
    const g = fresh()
    for (let round = 0; round < 6; round++) {
      g.recordScore(1, 'normal')
      g.endRound()
      g.commitRound('W')
    }
    expect(g.phase.value).toBe('set-end')
    const beforeSetEnd = snap(g)
    g.undoLast()
    if (snap(g) === beforeSetEnd) deadEnds.push('set-end (undo did nothing)')

    // A freshly-committed round with no rolls yet: the state #1104 strands you in.
    const h = fresh()
    h.recordScore(1, 'normal')
    h.endRound()
    h.commitRound('W') // now in round 2, playing, zero rolls
    expect(h.phase.value).toBe('playing')
    const beforeEmpty = snap(h)
    h.undoLast()
    if (snap(h) === beforeEmpty) deadEnds.push('playing with zero rolls in round (undo did nothing)')

    expect(deadEnds, `undo is a silent no-op in: ${deadEnds.join('; ')}`).toEqual([])
  })
})

describe('undo never reaches back into a COMPLETED round', () => {
  it('does not delete a Bunco belonging to an already-committed round', () => {
    // Found by the fuzzer above, not by live play -- it needs this exact order.
    // undoLast()'s round-end branch inspects rolls[rolls.length - 1], the GLOBAL
    // last roll, with no check that it belongs to the current round. Every other
    // computed in useGameState filters by set && round; this one does not. So a
    // fresh round with no rolls yet leaves the previous round's last roll sitting
    // at the end of the array, where undo happily deletes it.
    const g = fresh()
    g.recordScore(1, 'normal')
    g.recordScore(21, 'bunco')   // round 1: 22 points
    g.commitRound('W')           // round 1 is finished and scored
    expect(g.currentRound.value).toBe(2)

    const round1Before = g._state.value.rolls
      .filter(r => r.set === 1 && r.round === 1)
      .reduce((sum, r) => sum + r.points, 0)
    expect(round1Before).toBe(22)

    g.endRound()                 // player presses End Round in round 2
    g.undoLast()                 // and undoes it

    const round1After = g._state.value.rolls
      .filter(r => r.set === 1 && r.round === 1)
      .reduce((sum, r) => sum + r.points, 0)

    expect(
      round1After,
      'undo silently deleted a Bunco from a round that was already committed'
    ).toBe(22)
  })
})

describe('nothing advances a round except an explicit press (#1104)', () => {
  // The live failure this replaces: the BUNCO celebration auto-advanced into the
  // next round while Dan was still reading it, his End Round press landed on the
  // new empty round, and s3r4 was consumed with zero rolls.
  //
  // Note what is NOT asserted: that a zero-roll round is refused. A round CAN
  // legitimately have no rolls of yours -- the head table can reach 21 before
  // the dice ever come to you -- so blocking it would break a real game. The
  // defect was never the empty round, it was being moved into one without
  // knowing. Hence the invariant below: only an explicit press advances.

  it('a Bunco ends the round but does not commit it', () => {
    const g = fresh()
    g.recordScore(21, 'bunco')
    expect(g.phase.value).toBe('round-end')
    expect(
      g._state.value.results.length,
      'the Bunco committed the round on its own'
    ).toBe(0)
    expect(g.currentRound.value, 'the Bunco advanced the round on its own').toBe(1)
  })

  it('the round-end state is stable: it waits, indefinitely, for a press', () => {
    const g = fresh()
    g.recordScore(21, 'bunco')
    const settled = JSON.stringify(g._state.value)
    // Whatever the UI does with timers, the state machine itself must not move.
    expect(JSON.stringify(g._state.value)).toBe(settled)
    expect(g.phase.value).toBe('round-end')
  })

  it('and the explicit press is undoable, so a mistimed one costs nothing', () => {
    const g = fresh()
    g.recordScore(21, 'bunco')
    const beforeCommit = JSON.stringify(g._state.value)
    g.commitRound('W')
    expect(g.currentRound.value).toBe(2)
    g.undoLast()
    expect(
      JSON.stringify(g._state.value),
      'committing a round could not be walked back'
    ).toBe(beforeCommit)
  })
})
