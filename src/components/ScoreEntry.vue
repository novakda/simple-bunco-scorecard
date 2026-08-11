<template>
  <div class="score-entry">
    <div class="number-grid">
      <button
        v-for="n in [0, 1, 2]"
        :key="n"
        class="score-btn number-btn"
        @click="recordScore(n, 'normal')"
      >{{ n }}</button>
    </div>
    <button class="score-btn bunco-btn" @click="recordScore(21, 'bunco')">BUNCO!</button>
    <button class="score-btn mini-btn" @click="recordScore(0, 'mini')">MINI-BUNCO</button>
    <div class="action-row">
      <button class="action-btn undo-btn" @click="undoLast">Undo</button>
      <button class="action-btn end-btn" @click="endRound">End Round</button>
    </div>
  </div>
</template>

<script setup>
// No `phase` prop: App.vue routes every non-'playing' phase to a full-screen
// overlay, so this component only ever renders while phase === 'playing'.
defineProps({
  recordScore: Function,
  undoLast: Function,
  endRound: Function,
})
</script>

<style scoped>
.score-entry {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
}

/* Three buttons: a plain roll can only score 0, 1 or 2 matching dice.
   Three on the target is a Bunco, which has its own button. */
.number-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.score-btn {
  border: none;
  border-radius: 12px;
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.number-btn {
  height: 64px;
  font-size: 28px;
  background: var(--surface);
  color: var(--text-hi);
}

.number-btn:active {
  background: var(--surface-hi);
}

.bunco-btn {
  height: 80px;
  font-size: 24px;
  background: var(--accent);
  color: var(--bg);
  letter-spacing: 0.05em;
}

.bunco-btn:active {
  filter: brightness(1.1);
}

.mini-btn {
  height: 56px;
  font-size: 18px;
  background: var(--accent-dim);
  color: var(--text-hi);
  letter-spacing: 0.04em;
}

.mini-btn:active {
  filter: brightness(1.15);
}

.action-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.action-btn {
  height: 48px;
  border: none;
  border-radius: 12px;
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  background: var(--surface);
  color: var(--text-mid);
  -webkit-tap-highlight-color: transparent;
}

.action-btn:active {
  background: var(--surface-hi);
  color: var(--text-hi);
}
</style>
