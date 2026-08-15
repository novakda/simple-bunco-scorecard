# Session telemetry

Play a simulated game on the phone and have the laptop tell you, tap by tap,
whether the app agrees with what should have happened.

There are two halves. The **offline** half needs no phone and runs in CI: a
golden game is played through the real composable and its state is asserted
against the simulation. The **live** half is the one that answers questions the
tests cannot — how the app feels to use at a table, where you fumble a tap, how
long you sit on the BUNCO screen, what happens when you put the phone down.

Nothing here runs in the deployed build. Telemetry is inert unless a collector
URL is configured, so `/tools/bunco` behaves exactly as it did before.

## The runbook

**1. Generate a golden game.**

```sh
npm run golden
```

Writes `telemetry/golden-game.json`. The `--find` flag (already in the script)
searches for a seed whose game contains a Bunco, at least three mini-Buncos, and
a tie — a random game routinely has none of them, which would leave the
celebration screen, the MINI-BUNCO button, and the TIE path untested.

The file lists, round by round, the dice you rolled and the button to tap for
each. It also carries the W/L/T for every round, worked out by simulating all
four seats, so the round results are honest rather than invented.

**2. Start the collector on the laptop.**

```sh
npm run collect
```

Listens on `:31403`, binds `0.0.0.0` so the phone can reach it, appends every
event to `telemetry/session-<timestamp>.ndjson`, and diffs each one against the
golden game as it arrives. Ctrl-C prints the session report.

**3. Serve the app on the tailnet.**

```sh
npm run dev:tailnet
```

**4. Open it on the phone**, pointing at the collector:

```
http://<tailnet-ip>:5173/tools/bunco/?collector=http://<tailnet-ip>:31403
```

The collector URL is remembered, so later loads on that phone stay instrumented.
Turn it off with `?collector=off`.

**5. Play the golden game**, entering each roll from the list. The laptop prints
a line per tap.

## Reading the output

```
s2r5   OK  roll  90  MINI-BUNCO (5)  round total 13   +4.2s
s2r5   XX  roll  91  expected 2 pt, app recorded 1 pt (normal)
s3r1   DEAD TAP recordScore did nothing (phase round-end)
s3r1   app backgrounded after 31.4s
```

- `OK` / `XX` — the app's stored roll against the golden one. An `XX` is a
  scoring defect or a mis-tap; the log tells you which, because a mis-tap is
  usually followed by an `undo`.
- `DEAD TAP` — you pressed something and the app's guards swallowed it. Not a
  crash, and invisible in the UI, which is exactly why it is worth recording.
- `app backgrounded` — the context switch itself, timed.

The report at the end covers both axes:

```
correctness: 176/176 rolls and 18/18 round results matched the golden game
pacing: 47.3 min, median 3.1s between taps, p90 9.4s, slowest 74.2s
friction: 4 undo(s), 1 dead tap(s), backgrounded 6 time(s)
```

Correctness is a pass/fail. Pacing and friction are the UX findings — a p90 far
above the median means something intermittently makes you stop and think, and
the slowest gap usually points at a screen you had to work out.

## Re-running a saved session

```sh
npm run replay -- telemetry/session-2026-08-14T19-04-11.ndjson
```

Same comparison code as the live diff, so the two cannot disagree. Useful after
changing the scoring rules: replay an old session and see what the change would
have done to a real game.

## What gets recorded

One event per action, carrying the state the action produced:

```json
{
  "sid": "a1b2c3d4", "seq": 42, "t": 1755213600000, "dt": 3120,
  "action": "recordScore",
  "after": {
    "set": 2, "round": 5, "target": 5, "phase": "playing",
    "roundPoints": 13, "rollsInRound": 7, "totalRolls": 90, "totalResults": 16,
    "last": { "points": 5, "type": "mini" }, "lastResult": "W"
  }
}
```

`after.last` is the roll **as the app stored it**, not the button that was
pressed — MINI-BUNCO taps 0 and stores 5, and the diff has to see the stored
value to be meaningful.

Events are queued and flushed on a short timer. If the collector is down or the
tailnet drops, the queue is held in `localStorage` and retried, so you lose
latency rather than the session.

## What is deliberately not here

No analytics service, no third party, no identifiers beyond a random per-load
session id. The log never leaves your tailnet.
