<template>
  <div class="round-history">
    <div v-if="roundSummaries.length === 0" class="empty">No rounds yet</div>
    <div
      v-for="item in roundSummaries"
      :key="item.round"
      class="history-row"
    >
      <span class="rnd-label">R{{ item.round }}</span>
      <span class="rnd-pts">{{ item.points }}pts</span>
      <span
        v-if="item.result"
        class="badge"
        :class="item.result.toLowerCase()"
      >{{ item.result }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  setRollHistory: Array,
  setResults: Array,
  currentRound: Number,
})

const roundSummaries = computed(() => {
  const maxRound = Math.max(
    props.currentRound,
    ...props.setRollHistory.map(r => r.round),
    ...props.setResults.map(r => r.round),
    0
  )
  const summaries = []
  for (let r = 1; r <= maxRound; r++) {
    const points = props.setRollHistory
      .filter(roll => roll.round === r)
      .reduce((sum, roll) => sum + roll.points, 0)
    const resultEntry = props.setResults.find(res => res.round === r)
    summaries.push({ round: r, points, result: resultEntry?.result ?? null })
  }
  return summaries
})
</script>

<style scoped>
.round-history {
  height: 80px;
  overflow-x: auto;
  overflow-y: hidden;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-top: 1px solid var(--surface);
}

.empty {
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-size: 13px;
  color: var(--text-lo);
}

.history-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 44px;
  flex-shrink: 0;
}

.rnd-label {
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-size: 11px;
  color: var(--text-lo);
}

.rnd-pts {
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-size: 13px;
  color: var(--text-hi);
  font-weight: 600;
}

.badge {
  font-family: 'Inter', 'Helvetica Neue', sans-serif;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
}

.badge.w { background: var(--win); color: #000; }
.badge.l { background: var(--loss); color: #fff; }
.badge.t { background: var(--tie); color: #fff; }
</style>
