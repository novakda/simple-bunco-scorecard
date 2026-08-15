/**
 * Telemetry tests.
 *
 * The property that matters most is the first one: with no collector configured
 * the app must behave exactly as it did before telemetry existed — no recording,
 * no listeners, no network. Everything shipped to /tools/bunco runs that path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const COLLECTOR = 'http://collector.test:31403'

async function loadFresh() {
  vi.resetModules()
  return (await import('./useTelemetry.js')).createTelemetry
}

describe('useTelemetry', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
    // jsdom has no fetch; every test that expects no network asserts on this spy.
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('when no collector is configured', () => {
    it('is inert and reports itself disabled', async () => {
      const createTelemetry = await loadFresh()
      const snapshot = vi.fn(() => ({ phase: 'playing' }))
      const t = createTelemetry(snapshot)

      expect(t.enabled).toBe(false)
      t.record('score', { points: 2 })
      expect(snapshot).not.toHaveBeenCalled()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('wrap returns the original function untouched', async () => {
      const createTelemetry = await loadFresh()
      const t = createTelemetry(() => ({}))
      const original = () => 'result'
      expect(t.wrap('name', original)).toBe(original)
    })

    it('stores nothing in localStorage', async () => {
      const createTelemetry = await loadFresh()
      createTelemetry(() => ({})).record('score')
      expect(window.localStorage.length).toBe(0)
    })
  })

  describe('when a collector is configured', () => {
    beforeEach(() => {
      window.localStorage.setItem('bunco-telemetry-collector', COLLECTOR)
    })

    it('records the state produced by the action, not the state before it', async () => {
      const createTelemetry = await loadFresh()
      let phase = 'playing'
      const t = createTelemetry(() => ({ phase }))

      const wrapped = t.wrap('endRound', () => {
        phase = 'round-end'
      })
      wrapped()

      const queued = JSON.parse(window.localStorage.getItem('bunco-telemetry-queue'))
      const last = queued[queued.length - 1]
      expect(last.action).toBe('endRound')
      expect(last.after.phase).toBe('round-end')
    })

    it('flags an action the app guarded into a no-op', async () => {
      const createTelemetry = await loadFresh()
      const t = createTelemetry(() => ({ phase: 'round-end' }))

      // Mirrors recordScore's `if (phase !== 'playing') return` guard.
      t.wrap('recordScore', () => {})(2, 'normal')

      const queued = JSON.parse(window.localStorage.getItem('bunco-telemetry-queue'))
      expect(queued[queued.length - 1].noop).toBe(true)
    })

    it('does not flag an action that changed state', async () => {
      const createTelemetry = await loadFresh()
      let rolls = 0
      const t = createTelemetry(() => ({ rolls }))
      t.wrap('recordScore', () => { rolls++ })(1, 'normal')

      const queued = JSON.parse(window.localStorage.getItem('bunco-telemetry-queue'))
      expect(queued[queued.length - 1].noop).toBeUndefined()
    })

    it('records a load event carrying the session id', async () => {
      const createTelemetry = await loadFresh()
      const t = createTelemetry(() => ({}))
      const queued = JSON.parse(window.localStorage.getItem('bunco-telemetry-queue'))
      expect(queued[0].action).toBe('load')
      expect(queued[0].sid).toBe(t.sid)
    })

    it('posts queued events to the collector', async () => {
      vi.useFakeTimers()
      const createTelemetry = await loadFresh()
      const t = createTelemetry(() => ({ phase: 'playing' }))
      t.record('score', { points: 2 })

      await vi.advanceTimersByTimeAsync(700)

      expect(globalThis.fetch).toHaveBeenCalled()
      const [url, init] = globalThis.fetch.mock.calls[0]
      expect(url).toBe(`${COLLECTOR}/events`)
      const body = JSON.parse(init.body)
      expect(body.sid).toBe(t.sid)
      expect(body.events.some((e) => e.action === 'score')).toBe(true)
    })

    it('keeps events queued when the collector is unreachable', async () => {
      vi.useFakeTimers()
      globalThis.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
      const createTelemetry = await loadFresh()
      const t = createTelemetry(() => ({}))
      t.record('score', { points: 1 })

      await vi.advanceTimersByTimeAsync(700)

      // Nothing is dropped — a dropped tailnet connection costs latency, not data.
      const queued = JSON.parse(window.localStorage.getItem('bunco-telemetry-queue'))
      expect(queued.length).toBeGreaterThanOrEqual(2)
      expect(queued.some((e) => e.action === 'score')).toBe(true)
    })

    it('measures the gap between events', async () => {
      vi.useFakeTimers()
      const createTelemetry = await loadFresh()
      const t = createTelemetry(() => ({}))
      vi.advanceTimersByTime(2500)
      t.record('score', {})

      const queued = JSON.parse(window.localStorage.getItem('bunco-telemetry-queue'))
      const scoreEvent = queued.find((e) => e.action === 'score')
      expect(scoreEvent.dt).toBeGreaterThanOrEqual(2500)
    })
  })

  describe('collector configuration', () => {
    it('is turned off by ?collector=off, clearing the stored value', async () => {
      window.localStorage.setItem('bunco-telemetry-collector', COLLECTOR)
      const url = new URL(window.location.href)
      url.searchParams.set('collector', 'off')
      window.history.replaceState({}, '', url)

      const createTelemetry = await loadFresh()
      expect(createTelemetry(() => ({})).enabled).toBe(false)
      expect(window.localStorage.getItem('bunco-telemetry-collector')).toBeNull()

      window.history.replaceState({}, '', '/')
    })

    it('is turned on by ?collector=URL and remembers it for later loads', async () => {
      const url = new URL(window.location.href)
      url.searchParams.set('collector', COLLECTOR)
      window.history.replaceState({}, '', url)

      const createTelemetry = await loadFresh()
      expect(createTelemetry(() => ({})).enabled).toBe(true)
      expect(window.localStorage.getItem('bunco-telemetry-collector')).toBe(COLLECTOR)

      window.history.replaceState({}, '', '/')
    })
  })
})
