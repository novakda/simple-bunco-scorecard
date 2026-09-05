<template>
  <!-- BUNCO! Celebration -->
  <!-- ONE round-end screen, whatever ended the round.
       A Bunco ends it by the rules; "End Round" ends it because the head table
       called it. Those used to be two screens with two different ways forward,
       and one of them moved on by itself. Now the Bunco just makes this screen
       celebratory: same score, same buttons, same explicit press. Nothing
       advances until the player says so. -->
  <div v-if="isRoundEndPhase" class="overlay-screen" :class="{ 'is-bunco': isBuncoRound }">
    <div v-if="isBuncoRound" class="bunco-banner">
      <div class="bunco-text">BUNCO!</div>
      <div class="bunco-sub">21 points</div>
    </div>
    <div class="overlay-title">Round {{ currentRound }} complete</div>
    <!-- The score you just spent a round accumulating, shown at the moment you
         are asked to judge the round. Without it there is nothing to check your
         own tally against, and commitRound cannot be undone. -->
    <div class="overlay-score">{{ roundPoints }} <span>points</span></div>
    <div class="overlay-subtitle">How did you finish?</div>
    <div class="wlt-row">
      <button class="wlt-btn win" @click="commitRound('W')">WIN</button>
      <button class="wlt-btn loss" @click="commitRound('L')">LOSS</button>
      <button class="wlt-btn tie" @click="commitRound('T')">TIE</button>
    </div>
    <button class="ghost-btn" @click="undoLast">← Undo</button>
  </div>

  <!-- Set End -->
  <div v-else-if="phase === 'set-end'" class="overlay-screen">
    <div class="overlay-title">Set {{ currentSet }} complete</div>
    <div class="set-summary">
      <div class="summary-row">
        <span>Rounds</span>
        <span>{{ setWins }}W · {{ setLosses }}L · {{ setTies }}T</span>
      </div>
      <div class="summary-row">
        <span>Points this set</span>
        <span>{{ setPoints }}</span>
      </div>
      <div class="summary-row">
        <span>Overall</span>
        <span>{{ totalWins }}W · {{ totalLosses }}L · {{ totalTies }}T · {{ totalPoints }}pts</span>
      </div>
    </div>
    <button class="primary-btn" @click="nextSet">
      {{ currentSet === TOTAL_SETS ? 'See Final Results' : 'Next Set →' }}
    </button>
  </div>

  <!-- Game Over -->
  <div v-else-if="phase === 'game-over'" class="overlay-screen game-over">
    <div class="overlay-title">Game Over</div>
    <div class="per-set-table">
      <div class="table-header">
        <span>Set</span><span>W</span><span>L</span><span>T</span><span>Pts</span>
      </div>
      <div v-for="s in TOTAL_SETS" :key="s" class="table-row">
        <span>{{ s }}</span>
        <span>{{ setWinsFor(s) }}</span>
        <span>{{ setLossesFor(s) }}</span>
        <span>{{ setTiesFor(s) }}</span>
        <span>{{ setPointsFor(s) }}</span>
      </div>
      <div class="table-row totals-row">
        <span>Total</span>
        <span>{{ totalWins }}</span>
        <span>{{ totalLosses }}</span>
        <span>{{ totalTies }}</span>
        <span>{{ totalPoints }}</span>
      </div>
    </div>
    <div class="buncos-stat">{{ totalBuncos }} Bunco{{ totalBuncos !== 1 ? 's' : '' }} scored</div>
    <button class="primary-btn" @click="newGame">New Game</button>
  </div>

  <!-- Playing -->
  <div v-else class="app-layout">
    <!-- First-open hint -->
    <div v-if="showHint" class="hint-bar" @click="dismissHint">
      Tap 0–2 for matching dice. Tap BUNCO! for three of the target. ✕
    </div>

    <GameContext
      :currentSet="currentSet"
      :currentRound="currentRound"
      :targetNumber="targetNumber"
      :roundPoints="roundPoints"
      :pointsToWin="pointsToWin"
      :rollsThisRound="rollsThisRound"
    />
    <ScoreEntry
      :recordScore="handleRecordScore"
      :undoLast="undoLast"
      :endRound="endRound"
    />
    <RoundHistory
      :setRollHistory="setRollHistory"
      :setResults="setResults"
      :currentRound="currentRound"
    />

    <!-- Reset: ghost button → inline confirm bar -->
    <div v-if="!confirmingReset" class="reset-row">
      <button class="ghost-btn reset-btn" @click="confirmingReset = true">New Game</button>
    </div>
    <div v-else class="reset-confirm-row">
      <button class="ghost-btn" @click="confirmingReset = false">Cancel</button>
      <button class="danger-btn" @click="handleNewGame">Yes, reset</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import GameContext from './components/GameContext.vue'
import ScoreEntry from './components/ScoreEntry.vue'
import RoundHistory from './components/RoundHistory.vue'
import { useGameState, TOTAL_SETS } from './composables/useGameState.js'

const {
  currentSet, currentRound, targetNumber, roundPoints, pointsToWin, rollsThisRound,
  setRollHistory, setResults, phase, lastRoll, lastRollThisRound,
  recordScore, endRound, commitRound, nextSet, undoLast, newGame,
  _state,
} = useGameState()

const confirmingReset = ref(false)

function handleRecordScore(points, type) {
  confirmingReset.value = false
  recordScore(points, type)
}

function handleNewGame() {
  confirmingReset.value = false
  newGame()
}

// NOTHING ADVANCES ON A TIMER ANY MORE.
//
// A Bunco ends the round by the rules; "End Round" ends it because the head
// table called it. Those were two different code paths landing in two different
// places, and the whole family of round defects lived in that gap: the timer
// advanced into the next round while the player was still reading the
// celebration, so their next press landed on a round they did not know they
// were in, and committed it empty.
//
// Both paths now converge: the round ends, a screen appears, and the player
// presses to advance. The Bunco gets its celebration — it just has to be
// dismissed rather than dismissing itself. One consistent move, no race.
const isRoundEndPhase = computed(() => phase.value === 'round-end')
// Scoped to THIS round, not the globally last roll. With lastRoll, ending a
// round that has no rolls of its own showed the celebration for a Bunco scored
// in the PREVIOUS round — the same unscoped-lookup mistake as #1106, made one
// layer up while fixing #1106. The state-machine fuzzer could not see it,
// because it never rendered anything.
const isBuncoRound = computed(
  () => phase.value === 'round-end' && lastRollThisRound.value?.type === 'bunco'
)

watch(isBuncoRound, (val) => {
  if (val && navigator.vibrate) navigator.vibrate(200)
})

// Set/game summaries
const allResults = computed(() => _state.value.results)
const allRolls = computed(() => _state.value.rolls)

const setWins = computed(() => setResults.value.filter(r => r.result === 'W').length)
const setLosses = computed(() => setResults.value.filter(r => r.result === 'L').length)
const setTies = computed(() => setResults.value.filter(r => r.result === 'T').length)
const setPoints = computed(() => setRollHistory.value.reduce((s, r) => s + r.points, 0))

const totalWins = computed(() => allResults.value.filter(r => r.result === 'W').length)
const totalLosses = computed(() => allResults.value.filter(r => r.result === 'L').length)
const totalTies = computed(() => allResults.value.filter(r => r.result === 'T').length)
const totalPoints = computed(() => allRolls.value.reduce((s, r) => s + r.points, 0))
const totalBuncos = computed(() => allRolls.value.filter(r => r.type === 'bunco').length)

function setWinsFor(s) { return allResults.value.filter(r => r.set === s && r.result === 'W').length }
function setLossesFor(s) { return allResults.value.filter(r => r.set === s && r.result === 'L').length }
function setTiesFor(s) { return allResults.value.filter(r => r.set === s && r.result === 'T').length }
function setPointsFor(s) { return allRolls.value.filter(r => r.set === s).reduce((sum, r) => sum + r.points, 0) }

// First-open hint
const showHint = ref(false)
function dismissHint() { showHint.value = false; localStorage.setItem('bunco-first-seen', '1') }
onMounted(() => {
  if (!localStorage.getItem('bunco-first-seen')) showHint.value = true
})
</script>

<style>
@import './assets/tokens.css';

/* iOS treats a quick second tap on an element as double-tap-to-zoom and swallows
   the tap. Every control here is tapped in fast succession during a round, so
   the gesture costs real inputs — and a lost tap is invisible, because a
   zero-point roll does not move the score either. A live session on 2026-08-14
   desynced from the golden game at roll 43 for exactly this reason.

   `manipulation` disables the double-tap-zoom gesture on these elements ONLY.
   Pinch-zoom still works across the page, so this does not take away the
   resize affordance the way `user-scalable=no` on the viewport would (WCAG
   1.4.4). Applied to `button` rather than to each class so controls added
   later inherit it. */
button,
.overlay-screen,
.hint-bar {
  touch-action: manipulation;
}

/* .score-btn clears -webkit-tap-highlight-color, which removes the only default
   confirmation iOS gives a tap. Combined with a zero-point roll not moving the
   score, the most common tap in the game produced no feedback at all. This puts
   an immediate one back, without the highlight bleeding outside the radius. */
button:active {
  transform: scale(0.97);
  filter: brightness(1.25);
}
@media (prefers-reduced-motion: reduce) {
  button:active { transform: none; }
}

.overlay-score {
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  font-size: 56px;
  line-height: 1;
  color: var(--accent);
  margin: 4px 0 12px;
  font-variant-numeric: tabular-nums;
}
.overlay-score span {
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-weight: 400;
  font-size: 16px;
  color: var(--text-mid);
}

/* The countdown that used to live here is gone with the auto-advance: there is
   no deadline left to make legible. The celebration is now a banner on the
   round-end screen rather than a screen of its own, so a Bunco is still an
   event without being a different way forward. */
.bunco-banner {
  text-align: center;
  margin-bottom: 8px;
  animation: bunco-pop 0.45s ease-out;
}
.overlay-screen.is-bunco {
  background: var(--accent);
  color: var(--bg);
}
.overlay-screen.is-bunco .overlay-title,
.overlay-screen.is-bunco .overlay-subtitle,
.overlay-screen.is-bunco .overlay-score,
.overlay-screen.is-bunco .overlay-score span {
  color: var(--bg);
}
@keyframes bunco-pop {
  from { transform: scale(0.8); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .bunco-banner { animation: none; }
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 480px;
  margin: 0 auto;
}

/* Hint bar */
.hint-bar {
  background: var(--surface);
  color: var(--text-mid);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  padding: 10px 16px;
  text-align: center;
  cursor: pointer;
}

.bunco-text {
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  font-size: clamp(56px, 16vw, 96px);
  line-height: 1;
  color: var(--bg);
  animation: bunco-pulse 0.6s ease-in-out infinite alternate;
}

@keyframes bunco-pulse {
  from { transform: scale(1); }
  to   { transform: scale(1.05); }
}

.bunco-sub {
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  color: var(--bg);
  opacity: 0.7;
  margin-top: 4px;
}

/* The round-end screen's own "← Undo" now serves the Bunco case too, so the
   dedicated .bunco-undo button is gone. One undo control, one meaning. */
.overlay-screen.is-bunco .ghost-btn {
  color: var(--bg);
  opacity: 0.8;
}

/* Overlay screens (W/L/T, set-end, game-over) */
.overlay-screen {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  gap: 24px;
  max-width: 480px;
  margin: 0 auto;
}

.overlay-title {
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  font-size: 36px;
  color: var(--text-hi);
  text-align: center;
}

.overlay-subtitle {
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  color: var(--text-mid);
  margin-top: -16px;
}

/* W/L/T buttons */
.wlt-row {
  display: flex;
  gap: 12px;
  width: 100%;
}

.wlt-btn {
  flex: 1;
  height: 64px;
  border: none;
  border-radius: 12px;
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  font-size: 22px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.wlt-btn.win  { background: var(--win);  color: #000; }
.wlt-btn.loss { background: var(--loss); color: #fff; }
.wlt-btn.tie  { background: var(--tie);  color: #fff; }

.ghost-btn {
  background: none;
  border: 1px solid var(--surface-hi);
  border-radius: 12px;
  color: var(--text-mid);
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  padding: 10px 24px;
  cursor: pointer;
}

/* Set summary */
.set-summary {
  width: 100%;
  background: var(--surface);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  color: var(--text-hi);
}

.summary-row span:first-child { color: var(--text-mid); }

/* Per-set table */
.game-over {
  justify-content: flex-start;
  padding-top: 0;
  border-top: 4px solid var(--accent);
}

.buncos-stat {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: var(--accent);
  font-weight: 600;
  text-align: center;
}

.per-set-table {
  width: 100%;
  background: var(--surface);
  border-radius: 12px;
  overflow: hidden;
}

.table-header, .table-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
  padding: 10px 16px;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
}

.table-header {
  color: var(--text-lo);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--bg);
}

.table-row { color: var(--text-hi); }
.table-row:nth-child(odd) { background: var(--surface-hi); }

.totals-row {
  border-top: 1px solid var(--bg);
  font-weight: 600;
  color: var(--accent);
}

/* Primary button */
.primary-btn {
  width: 100%;
  height: 56px;
  border: none;
  border-radius: 12px;
  background: var(--accent);
  color: var(--bg);
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  font-size: 20px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.primary-btn:active { filter: brightness(1.1); }

/* Reset button */
.reset-row {
  display: flex;
  justify-content: center;
  padding: 8px 16px 16px;
}

.reset-btn {
  font-size: 13px;
  padding: 8px 20px;
  color: var(--text-lo);
  border-color: var(--surface-hi);
}

.reset-confirm-row {
  display: flex;
  gap: 12px;
  padding: 8px 16px 16px;
}

.reset-confirm-row .ghost-btn,
.reset-confirm-row .danger-btn {
  flex: 1;
  height: 44px;
}

.danger-btn {
  background: var(--loss);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
</style>
