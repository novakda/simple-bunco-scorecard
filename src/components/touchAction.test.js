/**
 * Regression guard for the double-tap-zoom defect found in the 2026-08-14 live
 * session, where iOS swallowed rapid taps and the run desynced at roll 43.
 *
 * This is a SOURCE-level assertion on purpose. jsdom does not apply a component
 * stylesheet or compute `touch-action`, so mounting the component and reading
 * the computed style would pass whether or not the rule exists — a test that
 * cannot fail. Reading the source is honest about what is actually checked.
 */
import { describe, it, expect } from 'vitest'
import appSrc from '../App.vue?raw'
import indexHtml from '../../index.html?raw'

describe('double-tap zoom must not be able to swallow taps', () => {
  it('sets touch-action: manipulation on buttons in the global (unscoped) style block', () => {
    const globalStyle = appSrc.slice(appSrc.indexOf('<style>'))
    expect(globalStyle).toMatch(/button[^{]*\{[^}]*touch-action:\s*manipulation/s)
  })

  it('covers the tap targets that are not buttons', () => {
    // The BUNCO celebration and the first-run hint bar are divs with @click,
    // so a rule scoped to `button` alone would leave them exposed.
    expect(appSrc).toMatch(/\.bunco-celebration[^{]*\{[^}]*touch-action:\s*manipulation/s)
    expect(appSrc).toMatch(/\.hint-bar[^{]*\{[^}]*touch-action:\s*manipulation/s)
  })

  it('does not disable pinch zoom, which would be a WCAG 1.4.4 regression', () => {
    expect(indexHtml).not.toMatch(/user-scalable\s*=\s*no/)
    expect(indexHtml).not.toMatch(/maximum-scale\s*=\s*1/)
  })
})
