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
| `gen-rolllist.js` | reads `telemetry/golden-game.json`, emits `rolllist.html` — the step list the tester follows |
| `listserve.js` | 4-line static server for that HTML on `:31411` |
| `appserve.js` | serves the production `dist/` at its real base path `/tools/bunco/` on `:31410` |

`rolllist.html` is **generated output**, not source — regenerate it:

```bash
node gen-rolllist.js ../telemetry/golden-game.json rolllist.html
```

## Known issues in the recovered code

- **`listserve.js` has an absolute path baked in** to the now-deleted job directory
  (`/home/xhiris/.claude/jobs/1feb7947/tmp/rolllist.html`). It will not run until that is changed to
  a relative path. Left as recovered rather than silently patched, so the diff is honest.
- The guide polls the collector's `GET /feed` every 700ms to locate itself in the golden run, and
  posts mode changes to `POST /guide`. Those endpoints live in the committed
  `scripts/telemetry-collector.js`, so that side is intact.

## The gap this does not close

The guide only ever **displayed** state and logged the operator's strict/off toggle. There is no
channel back to the tester's device — during the session Dan was both phone and laptop, closing the
loop by hand. Steering a *second* person live is unbuilt, and is the open question tracked in work
item #1061.

## The lesson, which is the durable part

Work done in an agent job scratch directory is **not** work that has been kept. The session's own
notes flagged a case-study writeup with "copy somewhere durable before the job is cleaned" — that
one was **not** copied and is gone, surviving only as the description on work item #1058. This
directory exists because the same thing nearly happened twice.
