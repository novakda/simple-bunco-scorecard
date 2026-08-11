import { computed } from 'vue'
import { useLocalStorage, useWakeLock } from '@vueuse/core'

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
  const targetNumber = computed(() => state.value.currentSet)
  const phase = computed(() => state.value.phase)

  const roundPoints = computed(() =>
    state.value.rolls
      .filter(r => r.set === state.value.currentSet && r.round === state.value.currentRound)
      .reduce((sum, r) => sum + r.points, 0)
  )

  const pointsToWin = computed(() => Math.max(0, 21 - roundPoints.value))

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
    state.value.results.push({
      set: state.value.currentSet,
      round: state.value.currentRound,
      result,
    })

    if (state.value.currentRound === 6) {
      state.value.phase = 'set-end'
    } else {
      state.value.currentRound++
      state.value.phase = 'playing'
    }
  }

  function nextSet() {
    if (state.value.currentSet === 6) {
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
      if (!last) return
      // Bunco is not undoable
      if (last.type === 'bunco') return
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

  return {
    currentSet,
    currentRound,
    targetNumber,
    roundPoints,
    pointsToWin,
    setRollHistory,
    setResults,
    phase,
    lastRoll,
    recordScore,
    endRound,
    commitRound,
    nextSet,
    undoLast,
    newGame,
    resetGame,
    _state: state,
  }
}
