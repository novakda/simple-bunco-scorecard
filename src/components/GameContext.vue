<template>
  <div class="game-context">
    <div class="meta-row">
      <span class="meta-label">Set {{ currentSet }}</span>
      <span class="meta-sep">/</span>
      <span class="meta-label">Round {{ currentRound }}</span>
    </div>
    <div class="hero-number">{{ targetNumber }}</div>
    <div class="rolling-label">Rolling for {{ targetNumber }}s</div>
    <div class="points-row">
      <span class="round-points">{{ roundPoints }}</span>
      <span class="points-to-win" v-if="pointsToWin > 0"> · {{ pointsToWin }} to win</span>
      <span class="points-to-win" v-else> · Go!</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  currentSet: Number,
  currentRound: Number,
  targetNumber: Number,
  roundPoints: Number,
  pointsToWin: Number,
})
</script>

<style scoped>
.game-context {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 16px;
  gap: 4px;
}

.meta-row {
  display: flex;
  gap: 6px;
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  color: var(--text-lo);
}

.meta-sep {
  color: var(--text-lo);
}

.meta-label {
  color: var(--text-lo);
}

.hero-number {
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  font-size: 72px;
  color: var(--accent);
  line-height: 1;
}

.rolling-label {
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  color: var(--text-mid);
}

.points-row {
  font-family: 'Oswald', 'Impact', sans-serif;
  font-weight: 700;
  font-size: 36px;
  color: var(--text-hi);
  line-height: 1;
  margin-top: 4px;
}

.points-to-win {
  font-size: 20px;
  color: var(--text-mid);
}
</style>
