/**
 * What the score-entry buttons can actually express, checked against the rules.
 *
 * Per Bunco rules, a roll of three dice against the round's target scores:
 *   0, 1 or 2  — by matching dice
 *   21         — all three match the target (BUNCO)
 *   5          — all three match each other but not the target (mini Bunco)
 *
 * There is no roll worth 3 points. A "3" button therefore cannot be tapped
 * correctly: the only way to get three matching dice is a Bunco, worth 21.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ScoreEntry from './ScoreEntry.vue'

function mountEntry() {
  const recorded = []
  const wrapper = mount(ScoreEntry, {
    props: {
      recordScore: (points, type) => recorded.push({ points, type }),
      undoLast: vi.fn(),
      endRound: vi.fn(),
    },
  })
  return { wrapper, recorded }
}

describe('ScoreEntry buttons vs the rules', () => {
  it('offers only point values a real roll can produce', () => {
    const { wrapper } = mountEntry()
    const labels = wrapper.findAll('button').map((b) => b.text())
    const numeric = labels.filter((l) => /^\d+$/.test(l)).map(Number)
    expect(
      numeric,
      'a plain roll can only score 0, 1 or 2 — three matching dice is a Bunco (21)',
    ).toEqual([0, 1, 2])
  })

  it('tapping the highest numeric button does not under-score a Bunco', () => {
    const { wrapper, recorded } = mountEntry()
    const numericButtons = wrapper.findAll('button').filter((b) => /^\d+$/.test(b.text()))
    const highest = numericButtons[numericButtons.length - 1]
    highest.trigger('click')
    const points = recorded.at(-1).points
    expect(
      points,
      `tapping "${highest.text()}" recorded ${points} points; three dice on the target is a Bunco worth 21`,
    ).toBeLessThanOrEqual(2)
  })

  it('BUNCO! records 21', () => {
    const { wrapper, recorded } = mountEntry()
    wrapper.findAll('button').find((b) => b.text().includes('BUNCO!')).trigger('click')
    expect(recorded.at(-1)).toEqual({ points: 21, type: 'bunco' })
  })

  it('MINI-BUNCO records the mini type', () => {
    const { wrapper, recorded } = mountEntry()
    wrapper.findAll('button').find((b) => b.text() === 'MINI-BUNCO').trigger('click')
    expect(recorded.at(-1).type).toBe('mini')
  })
})
