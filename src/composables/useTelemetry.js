/**
 * Session telemetry — an append-only event log for comparing a real play session
 * against a simulated one.
 *
 * INERT BY DEFAULT. Nothing is recorded and no network call is made unless a
 * collector URL is configured, so the deployed build at /tools/bunco behaves
 * exactly as it did before this file existed.
 *
 * Turn it on for a session by loading the app with a collector query param:
 *
 *     http://100.95.230.30:5173/tools/bunco/?collector=http://100.95.230.30:31403
 *
 * The URL is remembered in localStorage, so subsequent loads on that device stay
 * instrumented. Turn it off again with `?collector=off`.
 *
 * Events are queued and flushed on a short timer. If the collector is unreachable
 * the queue is held in localStorage and retried, so a dropped tailnet connection
 * costs you the latency, not the session.
 */

const COLLECTOR_KEY = 'bunco-telemetry-collector'
const QUEUE_KEY = 'bunco-telemetry-queue'
const FLUSH_MS = 600
const MAX_QUEUE = 500

function readCollector() {
  if (typeof window === 'undefined') return null

  let fromQuery = null
  try {
    fromQuery = new URLSearchParams(window.location.search).get('collector')
  } catch {
    // Malformed URL — fall through to whatever is stored.
  }

  try {
    if (fromQuery === 'off') {
      window.localStorage.removeItem(COLLECTOR_KEY)
      return null
    }
    if (fromQuery) {
      window.localStorage.setItem(COLLECTOR_KEY, fromQuery)
      return fromQuery
    }
    return window.localStorage.getItem(COLLECTOR_KEY)
  } catch {
    // Storage blocked (private mode). Honour the query param for this load only.
    return fromQuery && fromQuery !== 'off' ? fromQuery : null
  }
}

function randomId() {
  try {
    return crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  }
}

/**
 * @param {() => object} snapshot  Returns the state summary recorded with each
 *                                 event — called AFTER the action has run.
 */
export function createTelemetry(snapshot) {
  const collector = readCollector()

  // Disabled: hand back a no-op with the same shape so callers need no branching.
  if (!collector) {
    return { enabled: false, record: () => {}, wrap: (_name, fn) => fn, flush: () => Promise.resolve() }
  }

  const sid = randomId()
  const startedAt = Date.now()
  let seq = 0
  let lastAt = startedAt
  let timer = null
  let sending = false

  let queue = []
  try {
    const held = window.localStorage.getItem(QUEUE_KEY)
    if (held) queue = JSON.parse(held) || []
  } catch {
    queue = []
  }

  function persistQueue() {
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)))
    } catch {
      // Over quota or blocked — the in-memory queue still drains normally.
    }
  }

  async function flush() {
    if (sending || queue.length === 0) return
    sending = true
    const batch = queue.slice(0, MAX_QUEUE)
    try {
      const res = await fetch(`${collector}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid, events: batch }),
        keepalive: true,
      })
      if (!res.ok) throw new Error(`collector responded ${res.status}`)
      queue = queue.slice(batch.length)
      persistQueue()
    } catch {
      // Collector down or tailnet dropped. Keep the batch and retry on the next tick.
    } finally {
      sending = false
    }
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, FLUSH_MS)
  }

  function record(action, args = {}, extra = {}) {
    const now = Date.now()
    const event = {
      sid,
      seq: seq++,
      t: now,
      // Gap since the previous event — the raw material for the pacing report.
      dt: now - lastAt,
      sinceStart: now - startedAt,
      action,
      args,
      ...extra,
      after: snapshot(),
    }
    lastAt = now
    queue.push(event)
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
    persistQueue()
    schedule()
    return event
  }

  /**
   * Wrap a state action so every call is logged with the state it produced.
   * A call the composable's guards turned into a no-op is recorded as such —
   * a tap that visibly did nothing is a UX finding, not noise.
   */
  function wrap(name, fn) {
    return (...args) => {
      const before = JSON.stringify(snapshot())
      const out = fn(...args)
      const after = JSON.stringify(snapshot())
      record(name, args.length ? { args } : {}, before === after ? { noop: true } : {})
      return out
    }
  }

  if (typeof document !== 'undefined') {
    // Backgrounding the app is exactly the context switch under test, so both
    // edges of it are events in their own right.
    document.addEventListener('visibilitychange', () => {
      record('visibility', { state: document.visibilityState })
      if (document.visibilityState === 'hidden') flush()
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      try {
        const body = JSON.stringify({ sid, events: queue })
        navigator.sendBeacon?.(`${collector}/events`, new Blob([body], { type: 'application/json' }))
      } catch {
        // Nothing further to try on the way out.
      }
    })
  }

  record('load', {
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    screen: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
  })

  return { enabled: true, sid, record, wrap, flush }
}
