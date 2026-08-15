# harness-guide — recovered 2026-08-15

The live "guide" half of the 2026-08-14 telemetry test session. **This code was very nearly lost.**

It was written with `cat > … <<'JSEOF'` heredocs directly into a background-agent job scratch
directory (`~/.claude/jobs/1feb7947/tmp/`), never committed, and that directory has since been
cleaned. Recovered by parsing the heredoc bodies back out of the session transcript
(`projects/-home-xhiris--claude-skills-PAIUpgrade/1feb7947-*.jsonl`). All three files pass
`node --check`.

The committed half of that session — `useTelemetry.js`, `goldenGame.js`, `generate-golden.js`,
`telemetry-collector.js`, `TELEMETRY.md` — was merged as PR #3 and was never at risk. Only the guide
lived outside the repo.

## What each file is

| file | role |
|---|---|
| `gen-rolllist.cjs` | reads `telemetry/golden-game.json`, emits `rolllist.html` — the step list the tester follows |
| `listserve.cjs` | 4-line static server for that HTML on `:31411` |
| `appserve.cjs` | serves the production `dist/` at its real base path `/tools/bunco/` on `:31410` |

`rolllist.html` is **generated output**, not source — regenerate it:

```bash
node gen-rolllist.cjs ../telemetry/golden-game.json rolllist.html
```

## Known issues in the recovered code

- **Fixed after recovery:** `listserve` had an absolute path baked in to the now-deleted job
  directory. It now resolves `rolllist.html` next to the script (`ROLLLIST` env var overrides,
  `PORT` too) and returns a 503 telling you what to run when the file has not been generated yet.
- **Renamed `.js` → `.cjs`.** All three files use `require`, which worked in the job scratch dir
  because it had no `package.json`. This repo declares `"type": "module"`, so as `.js` they threw
  `ReferenceError: require is not defined in ES module scope` — the recovery was inert until this
  was found. Renaming is the smaller change than rewriting three files to ESM.
- **The live-sync half was missing, and this line used to claim it was not.** The sentence here
  previously read that the guide polls `GET /feed` every 700ms and posts mode changes to
  `POST /guide` — true of the *collector*, which has both endpoints, but **not** of the recovered
  generator, which emitted a guide that advanced only by keypress. The recovery had pulled back the
  generator's original heredoc body; the sync arrived later in that session as four separate
  string-replacement patches applied to the scratch copy, and those were never part of any heredoc.
  So the reconstructed guide was the *hand-advanced* version — precisely the method whose desync is
  method finding #1055, the one that turned one dropped input into 46 rolls read as failures.
  **Restored 2026-08-15** from the same transcript (lines 1473, 1554, 1570, 1631), reapplied as 19
  anchored replacements each asserted to match exactly once. What came back: `tapsBefore` /
  `resultsBefore` on every step so a feed reading locates the guide in the run; the 700ms poll and
  auto-advance; the live banner; the running round total on each row; undo detection that flags a
  still-recoverable tap; and the STRICT/OBSERVE mode toggle that logs its prompts to the collector so
  a prompted undo stays distinguishable from a spontaneous one. Verified in a real browser: posting a
  single golden-matching tap moved the guide from "tap 1 of 9" to "tap 2 of 9" with no keypress.

## The gap this does not close

The guide **reads** the app's state and **displays** it. There is no channel back to the tester's
device — during the session Dan was both phone and laptop, closing the loop by hand. Steering a
*second* person live is unbuilt, and is the open question tracked in work item #1061.

Note the asymmetry the sync does and does not fix: the guide can now follow the app, so a dropped
input no longer desyncs the two surfaces. It still cannot make the phone do anything, so a wrong tap
is *flagged* on the laptop and must be *undone* on the phone by a human who is looking at both.

## The lesson, which is the durable part

Work done in an agent job scratch directory is **not** work that has been kept. The session's own
notes flagged a case-study writeup with "copy somewhere durable before the job is cleaned" — that
one was **not** copied and is gone, surviving only as the description on work item #1058. This
directory exists because the same thing nearly happened twice.
