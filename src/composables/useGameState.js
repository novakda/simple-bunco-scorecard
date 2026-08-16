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
  // Undo is a history stack, not a set of per-phase special cases. Every step
  // the player takes -- a roll, ending a round, committing it, starting a set --
  // pushes one entry, and undo pops it. See pushHistory() for why the entries
  // can be this small.
  history: [],
  schemaVersion: 2,
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
  // A schema-1 game saved before undo-as-history has no stack. It resumes with
  // an empty one: steps taken before this upgrade are not undoable, but the
  // game itself is intact and every step from here on is.
  //
  // The version is bumped WITH the migration, not left behind. A normalized
  // state still labelled v1 is worse than either honest value, because the next
  // migration cannot tell what it is actually looking at.
  if (!Array.isArray(state.value?.history)) {
    state.value.history = []
    state.value.schemaVersion = 2
  }

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

  // The globally last roll, whichever round it belongs to. Correct for
  // telemetry, which reports the roll the app just stored.
  const lastRoll = computed(() => {
    const rolls = state.value.rolls
    return rolls.length > 0 ? rolls[rolls.length - 1] : null
  })

  /**
   * The last roll OF THE ROUND YOU ARE IN, or null if this round has none yet.
   *
   * Anything asking "how did THIS round go" must use this and not lastRoll. A
   * freshly committed round has no rolls of its own, so lastRoll there still
   * belongs to the PREVIOUS round. That is exactly the trap that produced
   * #1106 in undoLast — where it deleted a completed round's Bunco — and it
   * caught the round-end screen too, which showed the celebration banner for a
   * Bunco scored in the round before.
   */
  const lastRollThisRound = computed(() => {
    const rolls = state.value.rolls
    for (let i = rolls.length - 1; i >= 0; i--) {
      const r = rolls[i]
      if (r.set === state.value.currentSet && r.round === state.value.currentRound) return r
    }
    return null
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Record one undoable step, taken BEFORE the state is changed.
   *
   * The entry is this small because every mutation in this file is either an
   * APPEND to rolls/results or a change to a scalar. Nothing ever edits an
   * earlier entry. So "the state before this step" is fully described by the
   * two array lengths plus the three scalars, and undo is a truncate and a
   * restore. That is exact, not an approximation -- and it is why undo now
   * covers commitRound and nextSet without either needing its own branch.
   */
  function pushHistory() {
    state.value.history.push({
      currentSet: state.value.currentSet,
      currentRound: state.value.currentRound,
      phase: state.value.phase,
      rollCount: state.value.rolls.length,
      resultCount: state.value.results.length,
    })
    // A full game is ~200 steps. This is a runaway guard, not a real limit.
    if (state.value.history.length > 1000) state.value.history.shift()
  }

  function recordScore(points, type) {
    if (state.value.phase !== 'playing') return
    pushHistory()

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
    // Guard added with undo-as-history: without it, endRound() while already in
    // round-end pushes a history entry for a step that changes nothing, and undo
    // then appears to do nothing when the player presses it.
    if (state.value.phase !== 'playing') return
    pushHistory()
    state.value.phase = 'round-end'
  }

  function commitRound(result) {
    // Nothing auto-advances any more, so this is only ever reached by an
    // explicit press. The guard stays because it is still the thing that stops
    // a double-tap from fabricating a result for a round that is not over.
    if (state.value.phase !== 'round-end') return
    pushHistory()

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
    pushHistory()

    if (state.value.currentSet === TOTAL_SETS) {
      state.value.phase = 'game-over'
    } else {
      state.value.currentSet++
      state.value.currentRound = 1
      state.value.phase = 'playing'
    }
  }

  /**
   * Step back over the last step, whatever that step was — a roll, ending a
   * round, committing it, starting a new set.
   *
   * This replaces four per-phase special cases that between them left three
   * transitions with no undo at all (commitRound, the move into set-end, and
   * nextSet), and made a fourth actively destructive: the old round-end branch
   * read rolls[rolls.length - 1], the GLOBAL last roll, and deleted it when it
   * was a Bunco. In a freshly committed round — which has no rolls of its own
   * yet — that is the PREVIOUS round's roll, so pressing End Round then Undo
   * silently stripped 21 points from a round that was already finished. The
   * branch written to make a mis-tapped Bunco recoverable was the one losing
   * Buncos.
   *
   * A stack cannot have that class of bug, because it never has to work out
   * what the last step was.
   */
  function undoLast() {
    const history = state.value.history
    if (!history || history.length === 0) return

    const prev = history.pop()
    // Every mutation is an append or a scalar change, so truncating to the
    // recorded lengths restores the arrays exactly.
    state.value.rolls.splice(prev.rollCount)
    state.value.results.splice(prev.resultCount)
    state.value.currentSet = prev.currentSet
    state.value.currentRound = prev.currentRound
    state.value.phase = prev.phase
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
    lastRollThisRound,
    ...actions,
    telemetry,
    _state: state,
  }
}
