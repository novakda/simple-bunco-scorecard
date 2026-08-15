import { computed } from 'vue'
import { useLocalStorage, useWakeLock } from '@vueuse/core'
import { createTelemetry } from './useTelemetry.js'

// A set is one full pass through targets 1-6. The group plays three sets.
export const ROUNDS_PER_SET = 6
export const TOTAL_SETS = 3

const defaultState = () => ({
  currentSet: 1,
  currentRound: 1,
  rolls: [],
  results: [],
  phase: 'playing',
  miniBuncoPoints: 5,
  schemaVersion: 1,
})

export function useGameState() {
  const state = useLocalStorage('bunco-game', defaultState(), {
    mergeDefaults: true,
    onError: (err) => {
      console.warn('bunco: storage error, resetting', err)
      state.value = defaultState()
    },
  })

  // Guard: ensure arrays exist (handles partial/legacy localStorage values)
  if (!Array.isArray(state.value?.rolls)) state.value = { ...defaultState(), ...state.value, rolls: [], results: [] }

  // useWakeLock() only wires up listeners — nothing holds the screen awake until
  // request() is called. Without this the phone sleeps between rolls mid-game.
  const { request: requestWakeLock } = useWakeLock()
  requestWakeLock('screen').catch(() => {
    // Unsupported browser, or the document isn't visible yet — @vueuse re-requests
    // on the next visibilitychange, so there's nothing to recover here.
  })

  // ── Computed ──────────────────────────────────────────────────────────────

  const currentSet = computed(() => state.value.currentSet)
  const currentRound = computed(() => state.value.currentRound)
  // The ROUND is the target: round 1 rolls for 1s, round 3 for 3s. A set is one
  // full pass through 1-6. Previously this read currentSet, which meant all six
  // rounds of a set showed the same target.
  const targetNumber = computed(() => state.value.currentRound)
  const phase = computed(() => state.value.phase)

  const roundPoints = computed(() =>
    state.value.rolls
      .filter(r => r.set === state.value.currentSet && r.round === state.value.currentRound)
      .reduce((sum, r) => sum + r.points, 0)
  )

  const pointsToWin = computed(() => Math.max(0, 21 - roundPoints.value))

  // How many rolls have been entered this round. A zero-point roll moves neither
  // the score nor anything else on screen, so without this the most common tap
  // in the game produces no visible change and you cannot tell it registered.
  const rollsThisRound = computed(() =>
    state.value.rolls.filter(
      r => r.set === state.value.currentSet && r.round === state.value.currentRound
    ).length
  )

  const setRollHistory = computed(() =>
    state.value.rolls.filter(r => r.set === state.value.currentSet)
  )

  const setResults = computed(() =>
    state.value.results.filter(r => r.set === state.value.currentSet)
  )

  const lastRoll = computed(() => {
    const rolls = state.value.rolls
    return rolls.length > 0 ? rolls[rolls.length - 1] : null
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  function recordScore(points, type) {
    if (state.value.phase !== 'playing') return

    const effectivePoints = type === 'mini' ? state.value.miniBuncoPoints : points
    state.value.rolls.push({
      set: state.value.currentSet,
      round: state.value.currentRound,
      points: effectivePoints,
      type,
    })

    if (type === 'bunco') {
      state.value.phase = 'round-end'
    }
  }

  function endRound() {
    state.value.phase = 'round-end'
  }

  function commitRound(result) {
    // Guard: the BUNCO! screen both auto-advances after 2s and accepts a tap.
    // Without this, a double-tap fabricates a result for the next round and skips it.
    if (state.value.phase !== 'round-end') return

    state.value.results.push({
      set: state.value.currentSet,
      round: state.value.currentRound,
      result,
    })

    if (state.value.currentRound === ROUNDS_PER_SET) {
      state.value.phase = 'set-end'
    } else {
      state.value.currentRound++
      state.value.phase = 'playing'
    }
  }

  function nextSet() {
    // Guard: unguarded, this skips the rest of the current set mid-play.
    if (state.value.phase !== 'set-end') return

    if (state.value.currentSet === TOTAL_SETS) {
      state.value.phase = 'game-over'
    } else {
      state.value.currentSet++
      state.value.currentRound = 1
      state.value.phase = 'playing'
    }
  }

  function undoLast() {
    const rolls = state.value.rolls
    const currentSetVal = state.value.currentSet
    const currentRoundVal = state.value.currentRound

    if (state.value.phase === 'round-end') {
      const last = rolls[rolls.length - 1]
      if (!last) {
        state.value.phase = 'playing'
        return
      }
      // A mis-tapped BUNCO! is the largest possible scoring error (21 points),
      // so it has to be recoverable: drop the roll and return to play.
      if (last.type === 'bunco') {
        rolls.splice(rolls.length - 1, 1)
        state.value.phase = 'playing'
        return
      }
      // Manual endRound() — cancel back to playing
      state.value.phase = 'playing'
      return
    }

    if (state.value.phase === 'playing') {
      const currentRoundRolls = rolls.filter(
        r => r.set === currentSetVal && r.round === currentRoundVal
      )
      if (currentRoundRolls.length === 0) return
      // Pop the last roll (mutate in place, not replace reference)
      const idx = rolls.lastIndexOf(currentRoundRolls[currentRoundRolls.length - 1])
      state.value.rolls.splice(idx, 1)
    }
  }

  function newGame() {
    const miniBuncoPoints = state.value.miniBuncoPoints
    state.value = { ...defaultState(), miniBuncoPoints }
  }

  function resetGame() {
    newGame()
  }

  // ── Telemetry ─────────────────────────────────────────────────────────────
  // Inert unless a collector is configured (see useTelemetry.js). When it is,
  // every action is logged with the state it produced, so a live session can be
  // diffed against a simulated one.
  const telemetry = createTelemetry(() => ({
    set: state.value.currentSet,
    round: state.value.currentRound,
    target: state.value.currentRound,
    phase: state.value.phase,
    roundPoints: roundPoints.value,
    rollsInRound: state.value.rolls.filter(
      r => r.set === state.value.currentSet && r.round === state.value.currentRound
    ).length,
    totalRolls: state.value.rolls.length,
    totalResults: state.value.results.length,
    // The roll as the app actually stored it — this is what gets diffed against
    // the expected roll, so it has to be the stored record, not the tap that
    // produced it (MINI-BUNCO taps 0 and stores 5).
    last: state.value.rolls.length
      ? { points: state.value.rolls[state.value.rolls.length - 1].points, type: state.value.rolls[state.value.rolls.length - 1].type }
      : null,
    lastResult: state.value.results.length
      ? state.value.results[state.value.results.length - 1].result
      : null,
  }))

  const actions = { recordScore, endRound, commitRound, nextSet, undoLast, newGame, resetGame }
  if (telemetry.enabled) {
    for (const name of Object.keys(actions)) {
      actions[name] = telemetry.wrap(name, actions[name])
    }
  }

  return {
    currentSet,
    currentRound,
    targetNumber,
    roundPoints,
    pointsToWin,
    rollsThisRound,
    setRollHistory,
    setResults,
    phase,
    lastRoll,
    ...actions,
    telemetry,
    _state: state,
  }
}
